/**
 * Durable half of certificate issuance (#111), mirroring `registry-store.ts`'s shape but kept
 * fully separate: a distinct set of tables, never touching `registry_intents` or
 * `registry_attempts`, so the existing report-registry gate is untouched by this ticket.
 */
import { sql } from "drizzle-orm";
import { keccak256, parseTransaction, recoverTransactionAddress } from "viem";
import { CertificateBudgetError, positiveBudgetWei, type CertificateBudgetPolicy } from "./certificate-budget";
import type { CertificateIssuanceIntent, CertificateMintObservation, Hex } from "../../shared/certificate-nft";

type Executor = { execute: (query: any) => Promise<unknown> };
export type CertificateDatabase = Executor & { transaction: <T>(run: (tx: Executor) => Promise<T>) => Promise<T> };

const rows = (result: any): any[] => result.rows ?? result;
export type CertificateAttempt = { raw: Hex; hash: Hex; signature: Hex; nonce: number };

export function createCertificateStore(db: CertificateDatabase) {
  const get = async (institution: string, id: string): Promise<CertificateIssuanceIntent | null> => {
    const row = rows(await db.execute(sql`SELECT intent FROM certificate_intents WHERE institution_id=${institution} AND id=${id}`))[0];
    return row ? JSON.parse(row.intent) : null;
  };
  return {
    get,
    async ensureSchema() {
      for (const statement of [
        `CREATE TABLE IF NOT EXISTS certificate_intents (institution_id TEXT NOT NULL, id TEXT NOT NULL, activity_id TEXT NOT NULL,
         intent TEXT NOT NULL, content_canonical TEXT NOT NULL, content_salt TEXT NOT NULL, created_at BIGINT NOT NULL,
         PRIMARY KEY(institution_id,id))`,
        `CREATE TABLE IF NOT EXISTS certificate_relayer_nonces (deployment TEXT PRIMARY KEY, next_nonce BIGINT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS certificate_attempts (institution_id TEXT NOT NULL, intent_id TEXT NOT NULL, raw TEXT NOT NULL,
         hash TEXT NOT NULL, signature TEXT NOT NULL, nonce BIGINT NOT NULL, PRIMARY KEY(institution_id,intent_id))`,
        `CREATE TABLE IF NOT EXISTS certificate_service_budgets (scope TEXT PRIMARY KEY, reserved_wei TEXT NOT NULL)`,
        `ALTER TABLE certificate_attempts ADD COLUMN IF NOT EXISTS budget_scope TEXT`,
        `ALTER TABLE certificate_attempts ADD COLUMN IF NOT EXISTS reserved_wei TEXT`,
      ]) await db.execute(sql.raw(statement));
    },
    /** Content stays server-side: the salt in particular must never reach an HTTP response. */
    async create(intent: CertificateIssuanceIntent, activityId: string, contentCanonical: string, contentSalt: string, now: number): Promise<CertificateIssuanceIntent> {
      await db.execute(sql`INSERT INTO certificate_intents (institution_id,id,activity_id,intent,content_canonical,content_salt,created_at)
        VALUES (${intent.certification.institutionId},${intent.id},${activityId},${JSON.stringify(intent)},${contentCanonical},${contentSalt},${now}) ON CONFLICT DO NOTHING`);
      return (await get(intent.certification.institutionId, intent.id))!;
    },
    async list(institution: string, activityId?: string): Promise<CertificateIssuanceIntent[]> {
      return rows(await db.execute(sql`SELECT intent FROM certificate_intents
        WHERE institution_id=${institution} AND (${activityId ?? null}::text IS NULL OR activity_id=${activityId ?? null}) ORDER BY id`))
        .map((r) => JSON.parse(r.intent));
    },
    async content(institution: string, id: string): Promise<{ canonical: string; salt: string } | null> {
      const row = rows(await db.execute(sql`SELECT content_canonical, content_salt FROM certificate_intents WHERE institution_id=${institution} AND id=${id}`))[0];
      return row ? { canonical: row.content_canonical, salt: row.content_salt } : null;
    },
    async attempt(institution: string, id: string): Promise<CertificateAttempt | null> {
      return rows(await db.execute(sql`SELECT raw,hash,signature,nonce FROM certificate_attempts WHERE institution_id=${institution} AND intent_id=${id}`))[0] ?? null;
    },
    /**
     * Lock by chain + relayer (not institution/contract), reserve before signing, and commit
     * liability, signed bytes and nonce together before broadcasting. Reserved ceilings are
     * NEVER refunded, even after confirmation/revert: reorgs and mempool retries remain safe.
     * This is conservative lifetime liability, not measured gas expenditure or donor money.
     */
    async reserve(institution: string, id: string, deployment: string, pendingNonce: number, policy: CertificateBudgetPolicy, build: (nonce: number) => Promise<CertificateAttempt>) {
      const maxWei = positiveBudgetWei(policy.maxWei);
      const reservationWei = positiveBudgetWei(policy.reservationWei);
      return db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO certificate_service_budgets(scope,reserved_wei) VALUES (${policy.scope},'0') ON CONFLICT DO NOTHING`);
        const budget = rows(await tx.execute(sql`SELECT reserved_wei FROM certificate_service_budgets WHERE scope=${policy.scope} FOR UPDATE`))[0];
        const existing = rows(await tx.execute(sql`SELECT raw,hash,signature,nonce FROM certificate_attempts WHERE institution_id=${institution} AND intent_id=${id}`))[0];
        // Exact-byte retries must remain possible even after the configured budget is exhausted.
        if (existing) return existing as CertificateAttempt;
        let reserved = BigInt(budget.reserved_wei);
        if (reserved < 0n) throw new CertificateBudgetError("Catatan anggaran sertifikat tidak sah.");
        // Additive migration: old signed bytes may still be spendable. Recover their actual
        // chain/sender and maximum liability rather than silently starting an empty budget.
        const legacy = rows(await tx.execute(sql`SELECT institution_id,intent_id,raw,hash FROM certificate_attempts WHERE budget_scope IS NULL`));
        for (const row of legacy) {
          let scope: string;
          let liability: bigint;
          try {
            if (keccak256(row.raw) !== row.hash) throw new Error("hash mismatch");
            const transaction = parseTransaction(row.raw);
            if (!["legacy", "eip2930", "eip1559"].includes(transaction.type ?? "") || !transaction.chainId || !transaction.gas) throw new Error("unsupported legacy liability");
            const sender = await recoverTransactionAddress({ serializedTransaction: row.raw });
            scope = `${transaction.chainId}:${sender.toLowerCase()}`;
            const fee = transaction.maxFeePerGas ?? transaction.gasPrice;
            if (fee === undefined || fee < 0n || (transaction.value ?? 0n) < 0n) throw new Error("missing fee");
            liability = transaction.gas * fee + (transaction.value ?? 0n);
          } catch {
            throw new CertificateBudgetError("Anggaran sertifikat diblokir: transaksi lama tidak dapat diverifikasi dengan aman.");
          }
          if (scope !== policy.scope) continue;
          const updated = rows(await tx.execute(sql`UPDATE certificate_attempts SET budget_scope=${scope},reserved_wei=${liability.toString()}
            WHERE institution_id=${row.institution_id} AND intent_id=${row.intent_id} AND budget_scope IS NULL RETURNING intent_id`));
          if (updated.length) reserved += liability;
        }
        if (reserved + reservationWei > maxWei) throw new CertificateBudgetError();
        await tx.execute(sql`UPDATE certificate_service_budgets SET reserved_wei=${(reserved + reservationWei).toString()} WHERE scope=${policy.scope}`);
        await tx.execute(sql`INSERT INTO certificate_relayer_nonces(deployment,next_nonce) VALUES (${deployment},${pendingNonce}) ON CONFLICT DO NOTHING`);
        const lock = rows(await tx.execute(sql`SELECT next_nonce FROM certificate_relayer_nonces WHERE deployment=${deployment} FOR UPDATE`))[0];
        const nonce = Math.max(pendingNonce, Number(lock.next_nonce));
        const attempt = await build(nonce);
        await tx.execute(sql`INSERT INTO certificate_attempts(institution_id,intent_id,raw,hash,signature,nonce,budget_scope,reserved_wei)
          VALUES (${institution},${id},${attempt.raw},${attempt.hash},${attempt.signature},${nonce},${policy.scope},${reservationWei.toString()})`);
        await tx.execute(sql`UPDATE certificate_relayer_nonces SET next_nonce=${nonce + 1} WHERE deployment=${deployment}`);
        return attempt;
      });
    },
    async observe(intent: CertificateIssuanceIntent, observation: CertificateMintObservation, hash?: Hex): Promise<CertificateIssuanceIntent> {
      const next = { ...intent, observation, ...(hash ? { transactionHash: hash } : {}) };
      await db.execute(sql`UPDATE certificate_intents SET intent=${JSON.stringify(next)} WHERE institution_id=${intent.certification.institutionId} AND id=${intent.id}`);
      return next;
    },
  };
}
export type CertificateStore = ReturnType<typeof createCertificateStore>;

import { sql } from "drizzle-orm";
import type { GeneratedZKProof } from "./zk-proof-service";
import { randomUUID } from "node:crypto";

export type PublicationState = "QUEUED" | "PROVING" | "SUBMITTING" | "PENDING" | "CONFIRMED" | "RETRY" | "BUDGET_EXHAUSTED" | "BLOCKED" | "REVERTED" | "UNCONFIRMED";
export type ZkBudget = { id: string; maxAttempts: number; maxWei: string; gasLimit: string; maxFeePerGas: string; confirmations: number };
export type Publication = {
  id: string; batchId: string; institutionId: string; contributionId: string | null; version: number;
  status: PublicationState; attempts: number; artifactId: string | null; proof: GeneratedZKProof | null;
  rawTransaction: `0x${string}` | null; txHash: `0x${string}` | null; blockHash: string | null;
  blockNumber: number | null; error: string | null; notified: boolean;
};
export type SignedPublicationAttempt = {
  operationId: string; attempt: number; artifactId: string;
  rawTransaction: `0x${string}`; txHash: `0x${string}`; status: PublicationState;
};
const rows = (result: any): any[] => result.rows ?? result;
function map(r: any): Publication {
  return { id: r.id, batchId: r.batch_id, institutionId: r.institution_id, contributionId: r.contribution_id,
    version: Number(r.version), status: r.status, attempts: Number(r.attempts), artifactId: r.artifact_id,
    proof: r.proof_json ? JSON.parse(r.proof_json) : null, rawTransaction: r.raw_transaction, txHash: r.tx_hash,
    blockHash: r.block_hash, blockNumber: r.block_number == null ? null : Number(r.block_number), error: r.error, notified: r.notified };
}
export function createZkPublicationStore(db: any) {
  return {
    async ensureSchema() {
      await db.execute(sql.raw(`DROP INDEX IF EXISTS zk_publication_receipt_unique`));
      for (const statement of `CREATE TABLE IF NOT EXISTS zk_publication_budgets (
        id TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, reserved_wei NUMERIC(78,0) NOT NULL DEFAULT 0,
        lease_token TEXT, lease_until BIGINT NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS zk_publications (
        id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES zk_contribution_batches(id),
        institution_id TEXT NOT NULL REFERENCES institutions(id), contribution_id TEXT REFERENCES contributions(id),
        version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'QUEUED', attempts INTEGER NOT NULL DEFAULT 0,
        artifact_id TEXT, proof_json TEXT, raw_transaction TEXT, tx_hash TEXT, block_hash TEXT, block_number BIGINT,
        error TEXT, notified BOOLEAN NOT NULL DEFAULT false, updated_at BIGINT NOT NULL);
        CREATE TABLE IF NOT EXISTS zk_publication_approvals (
        id BIGSERIAL PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES zk_contribution_batches(id),
        snapshot_root TEXT NOT NULL, account TEXT NOT NULL, mandate_id TEXT NOT NULL, mandate_version INTEGER NOT NULL, approved_at BIGINT NOT NULL);
        CREATE TABLE IF NOT EXISTS zk_publication_attempts (
        operation_id TEXT NOT NULL REFERENCES zk_publications(id), attempt INTEGER NOT NULL,
        status TEXT NOT NULL, artifact_id TEXT, tx_hash TEXT, raw_transaction TEXT, error TEXT, updated_at BIGINT NOT NULL,
        PRIMARY KEY(operation_id, attempt));
        CREATE UNIQUE INDEX IF NOT EXISTS zk_publication_receipt_batch_unique ON zk_publications(batch_id, contribution_id, version) WHERE contribution_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS zk_publication_root_unique ON zk_publications(batch_id) WHERE contribution_id IS NULL;`.split(";").filter(s => s.trim())) await db.execute(sql.raw(statement));
    },
    async acquire(id: string, now: number) {
      const token = randomUUID();
      const result = await db.execute(sql`INSERT INTO zk_publication_budgets(id, lease_token, lease_until)
        VALUES (${id}, ${token}, ${now + 300}) ON CONFLICT(id) DO UPDATE SET lease_token = EXCLUDED.lease_token, lease_until = EXCLUDED.lease_until
        WHERE zk_publication_budgets.lease_until <= ${now} RETURNING id`);
      return rows(result).length ? token : null;
    },
    async owns(id: string, token: string, now: number) {
      return rows(await db.execute(sql`SELECT id FROM zk_publication_budgets WHERE id = ${id} AND lease_token = ${token} AND lease_until > ${now}`)).length === 1;
    },
    async release(id: string, token: string) {
      await db.execute(sql`UPDATE zk_publication_budgets SET lease_token = NULL, lease_until = 0 WHERE id = ${id} AND lease_token = ${token}`);
    },
    async approve(batch: { id: string; institutionId: string; merkleRoot: string }, account: string, mandateId: string, mandateVersion: number, now: number) {
      await db.transaction(async (tx: any) => {
        const b = rows(await tx.execute(sql`SELECT * FROM zk_contribution_batches WHERE id = ${batch.id} AND institution_id = ${batch.institutionId} FOR UPDATE`))[0];
        if (!b || ["SUPERSEDED", "ABANDONED"].includes(b.status) || b.merkle_root !== batch.merkleRoot) throw new Error("SNAPSHOT_CHANGED");
        const items = rows(await tx.execute(sql`SELECT i.contribution_id, i.witness_data_json, c.version, c.status FROM zk_contribution_batch_items i
          JOIN contributions c ON c.id = i.contribution_id WHERE i.batch_id = ${batch.id} FOR UPDATE OF c`));
        if (!items.length || items.some(r => r.status !== 'ENDORSED' || Number(r.version) !== JSON.parse(r.witness_data_json).version)) throw new Error("SNAPSHOT_CHANGED");
        for (const item of items) {
          const conflict = rows(await tx.execute(sql`SELECT p.batch_id FROM zk_publications p
            JOIN zk_contribution_batches cb ON cb.id = p.batch_id
            WHERE p.contribution_id = ${item.contribution_id} AND p.version = ${Number(item.version)}
            AND p.batch_id <> ${batch.id} AND cb.status NOT IN ('SUPERSEDED', 'ABANDONED')
            AND NOT EXISTS (SELECT 1 FROM zk_contribution_batches succ WHERE succ.predecessor_batch_id = cb.id)`))[0];
          if (conflict) throw new Error("RECEIPT_ALREADY_QUEUED");
        }
        if (b.predecessor_batch_id) {
          await tx.execute(sql`UPDATE zk_publications SET status = 'BLOCKED', error = 'Batch digantikan oleh versi koreksi baru.', updated_at = ${now}
            WHERE batch_id = ${b.predecessor_batch_id} AND status IN ('QUEUED','PROVING','RETRY','BUDGET_EXHAUSTED')`);
        }
        const approvalChanged = b.endorsed_by !== account || b.endorsement_mandate_id !== mandateId || Number(b.endorsement_mandate_version) !== mandateVersion;
        if (approvalChanged) {
          await tx.execute(sql`INSERT INTO zk_publication_approvals(batch_id,snapshot_root,account,mandate_id,mandate_version,approved_at)
            VALUES (${batch.id},${batch.merkleRoot},${account},${mandateId},${mandateVersion},${now})`);
          await tx.execute(sql`UPDATE zk_contribution_batches SET endorsed_by = ${account}, endorsement_mandate_id = ${mandateId},
            endorsement_mandate_version = ${mandateVersion}, endorsed_at = ${now}, updated_at = ${now} WHERE id = ${batch.id}`);
          await tx.execute(sql`UPDATE zk_publications SET status = 'QUEUED', error = NULL, updated_at = ${now}
            WHERE batch_id = ${batch.id} AND status IN ('BLOCKED','RETRY','BUDGET_EXHAUSTED')`);
        }
        for (const item of [null, ...items]) {
          const id = item
            ? (Number(b.version) === 1 && !b.replaces_draft_id ? `receipt:${item.contribution_id}:${item.version}` : `receipt:${batch.id}:${item.contribution_id}:${item.version}`)
            : `root:${batch.id}`;
          await tx.execute(sql`INSERT INTO zk_publications(id,batch_id,institution_id,contribution_id,version,updated_at)
            VALUES (${id},${batch.id},${batch.institutionId},${item?.contribution_id ?? null},${item ? Number(item.version) : Number(b.version)},${now}) ON CONFLICT(id) DO NOTHING`);
        }
      });
    },
    async list(institutionId?: string, batchId?: string) {
      return rows(await db.execute(sql`SELECT * FROM zk_publications
        WHERE (${institutionId ?? null}::text IS NULL OR institution_id = ${institutionId ?? null})
        AND (${batchId ?? null}::text IS NULL OR batch_id = ${batchId ?? null}) ORDER BY updated_at, id`)).map(map);
    },
    async retiredTransactions(): Promise<SignedPublicationAttempt[]> {
      return rows(await db.execute(sql`SELECT a.* FROM zk_publication_attempts a
        JOIN zk_publications p ON p.id = a.operation_id
        WHERE a.raw_transaction IS NOT NULL AND a.raw_transaction IS DISTINCT FROM p.raw_transaction`))
        .map(r => ({ operationId: r.operation_id, attempt: Number(r.attempt), artifactId: r.artifact_id,
          rawTransaction: r.raw_transaction, txHash: r.tx_hash, status: r.status }));
    },
    async saveRecoveredAttempt(attempt: SignedPublicationAttempt, op: Publication, budgetId: string, token: string, now: number) {
      const updated = rows(await db.execute(sql`UPDATE zk_publication_attempts SET status = ${op.status},
        error = ${op.error}, updated_at = ${now}
        WHERE operation_id = ${attempt.operationId} AND attempt = ${attempt.attempt}
        AND EXISTS (SELECT 1 FROM zk_publication_budgets WHERE id = ${budgetId} AND lease_token = ${token} AND lease_until > ${now})
        RETURNING operation_id`));
      if (!updated.length) throw new Error("LEASE_LOST");
    },
    async reserve(budget: ZkBudget, token: string, op: Publication, now: number) {
      return db.transaction(async (tx: any) => {
        const reserved = rows(await tx.execute(sql`UPDATE zk_publication_budgets SET attempts = attempts + 1,
          reserved_wei = reserved_wei + ${BigInt(budget.gasLimit) * BigInt(budget.maxFeePerGas)}::numeric
          WHERE id = ${budget.id} AND lease_token = ${token} AND lease_until > ${now}
          AND attempts < ${budget.maxAttempts} AND reserved_wei + ${BigInt(budget.gasLimit) * BigInt(budget.maxFeePerGas)}::numeric <= ${budget.maxWei}::numeric RETURNING id`));
        if (!reserved.length) return false;
        await tx.execute(sql`UPDATE zk_publications SET attempts = attempts + 1, status = 'PROVING', updated_at = ${now} WHERE id = ${op.id}`);
        return true;
      });
    },
    async save(op: Publication, budgetId: string, token: string, now: number) {
      await db.transaction(async (db: any) => {
        await db.execute(sql`SELECT id FROM zk_contribution_batches WHERE id = ${op.batchId} FOR UPDATE`);
        const updated = rows(await db.execute(sql`UPDATE zk_publications SET status = ${op.status}, artifact_id = ${op.artifactId},
          proof_json = ${op.proof ? JSON.stringify(op.proof) : null}, raw_transaction = ${op.rawTransaction}, tx_hash = ${op.txHash},
          block_hash = ${op.blockHash}, block_number = ${op.blockNumber}, error = ${op.error}, notified = ${op.notified}, updated_at = ${now}
          WHERE id = ${op.id}
          AND (${op.rawTransaction}::text IS NULL OR EXISTS (
            SELECT 1 FROM zk_contribution_batches b WHERE b.id = zk_publications.batch_id AND b.status <> 'ABANDONED'))
          AND EXISTS (SELECT 1 FROM zk_publication_budgets WHERE id = ${budgetId} AND lease_token = ${token} AND lease_until > ${now}) RETURNING id`));
        if (!updated.length) throw new Error("LEASE_LOST");
        await db.execute(sql`INSERT INTO zk_publication_attempts(operation_id,attempt,status,artifact_id,tx_hash,raw_transaction,error,updated_at)
          SELECT id,attempts,status,artifact_id,tx_hash,raw_transaction,error,updated_at FROM zk_publications WHERE id = ${op.id}
          ON CONFLICT(operation_id,attempt) DO UPDATE SET status = EXCLUDED.status,
          artifact_id = COALESCE(EXCLUDED.artifact_id, zk_publication_attempts.artifact_id),
          tx_hash = COALESCE(EXCLUDED.tx_hash, zk_publication_attempts.tx_hash),
          raw_transaction = COALESCE(EXCLUDED.raw_transaction, zk_publication_attempts.raw_transaction),
          error = EXCLUDED.error, updated_at = EXCLUDED.updated_at`);
      });
    },
    async retry(institutionId: string, batchId: string, now: number) {
      await db.execute(sql`UPDATE zk_publications SET raw_transaction = CASE WHEN status = 'REVERTED' THEN NULL ELSE raw_transaction END,
        tx_hash = CASE WHEN status = 'REVERTED' THEN NULL ELSE tx_hash END, status = 'QUEUED', error = NULL, updated_at = ${now}
        WHERE institution_id = ${institutionId} AND batch_id = ${batchId} AND status IN ('RETRY','BUDGET_EXHAUSTED','BLOCKED','UNCONFIRMED','REVERTED')`);
    },
  };
}
export type ZkPublicationStore = ReturnType<typeof createZkPublicationStore>;

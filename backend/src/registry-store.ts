import { createRecoveryStore, persistObservation } from "./registry-recovery-store";
import { sql } from "drizzle-orm";
import type { EvidenceDatabase } from "./evidence-store";
import type { AttestationIntent, RecordingIntent, Hex, RecordingObservation } from "../../shared/report-registry";

const rows = (result: any): any[] => result.rows ?? result;
export type RegistryAttempt = { raw: Hex; hash: Hex; signature: Hex; nonce: number };
/** Recording and publication share the authorization payload; attestation carries its own statement. */
export type StoredIntent = RecordingIntent | AttestationIntent;
export type IntentKind = "RECORDING" | "ATTESTATION";
export type IntentOf<K extends IntentKind> = K extends "ATTESTATION" ? AttestationIntent : RecordingIntent;
/** Which institution and package an intent belongs to, whichever action it carries. */
export const isAttestation = (intent: StoredIntent): intent is AttestationIntent => "statement" in intent;
export const subjectOf = (intent: StoredIntent) => isAttestation(intent) ? intent.statement : intent.authorization;
export const kindOf = (intent: StoredIntent): IntentKind => isAttestation(intent) ? "ATTESTATION" : "RECORDING";
export function createRegistryStore(db: EvidenceDatabase) {
  /**
   * Reads one intent, and refuses to hand back an intent of another kind.
   *
   * Retry identities are chosen by the caller and live in one id space per
   * institution, so a publication and an attestation can ask for the same name.
   * Returning the wrong one would let a signature be reviewed against a payload
   * it was never meant for.
   */
  const get = async <K extends IntentKind = "RECORDING">(institution: string, id: string, kind?: K): Promise<IntentOf<K> | null> => {
    const row = rows(await db.execute(sql`SELECT intent, kind FROM registry_intents WHERE institution_id=${institution} AND id=${id}`))[0];
    if (!row) return null;
    if ((row.kind ?? "RECORDING") !== (kind ?? "RECORDING")) return null;
    return JSON.parse(row.intent);
  };
  const takenByOtherKind = async (institution: string, id: string, kind: IntentKind): Promise<boolean> => {
    const row = rows(await db.execute(sql`SELECT kind FROM registry_intents WHERE institution_id=${institution} AND id=${id}`))[0];
    return !!row && (row.kind ?? "RECORDING") !== kind;
  };
  const recovery = createRecoveryStore(db);
  return {
    recovery,
    async ensureSchema() {
      for (const statement of [
        `CREATE UNIQUE INDEX IF NOT EXISTS report_packages_owner_id ON report_packages(institution_id, id)`,
        `CREATE TABLE IF NOT EXISTS registry_intents (institution_id TEXT NOT NULL, id TEXT NOT NULL, package_id TEXT NOT NULL, intent TEXT NOT NULL,
         PRIMARY KEY(institution_id,id), FOREIGN KEY(institution_id,package_id) REFERENCES report_packages(institution_id,id))`,
        `CREATE TABLE IF NOT EXISTS registry_relayer_nonces (deployment TEXT PRIMARY KEY, next_nonce BIGINT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS registry_nonce_allocations (institution_id TEXT NOT NULL, intent_id TEXT NOT NULL, deployment TEXT NOT NULL, nonce BIGINT NOT NULL,
          PRIMARY KEY(institution_id,intent_id), UNIQUE(deployment,nonce), FOREIGN KEY(institution_id,intent_id) REFERENCES registry_intents(institution_id,id))`,
        `CREATE TABLE IF NOT EXISTS registry_attempts (institution_id TEXT NOT NULL, intent_id TEXT NOT NULL, raw TEXT NOT NULL, hash TEXT NOT NULL, signature TEXT NOT NULL, nonce BIGINT NOT NULL,
         PRIMARY KEY(institution_id,intent_id), FOREIGN KEY(institution_id,intent_id) REFERENCES registry_intents(institution_id,id))`,
        // Added for attestations; existing rows are recording or publication intents.
        `ALTER TABLE registry_intents ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'RECORDING'`,
      ]) await db.execute(sql.raw(statement));
      await recovery.ensureSchema();
    },
    get,
    takenByOtherKind,
    /** The kind comes from the intent, never from the caller: a mislabelled row would be read back wrong. */
    async create<T extends StoredIntent>(intent: T): Promise<T> {
      const subject = subjectOf(intent), kind = kindOf(intent);
      await db.execute(sql`INSERT INTO registry_intents (institution_id,id,package_id,intent,kind)
        VALUES (${subject.institutionId},${intent.id},${subject.packageId},${JSON.stringify(intent)},${kind}) ON CONFLICT DO NOTHING`);
      return (await get(subject.institutionId, intent.id, kind)) as T;
    },
    async list<K extends IntentKind = "RECORDING">(institution: string, packageId: string, kind?: K): Promise<IntentOf<K>[]> {
      return rows(await db.execute(sql`SELECT intent FROM registry_intents
        WHERE institution_id=${institution} AND package_id=${packageId} AND COALESCE(kind,'RECORDING')=${kind ?? "RECORDING"} ORDER BY id`)).map(r => JSON.parse(r.intent));
    },
    async attempt(institution: string, id: string): Promise<RegistryAttempt | null> {
      return rows(await db.execute(sql`SELECT raw,hash,signature,nonce FROM registry_attempts WHERE institution_id=${institution} AND intent_id=${id}`))[0] ?? null;
    },
    /** Commit intent-bound nonce allocation before build opens its durable budget transaction. */
    async reserve(institution: string, id: string, deployment: string, pendingNonce: number, build: (nonce: number) => Promise<RegistryAttempt>) {
      const allocation = await db.transaction(async tx => {
        await tx.execute(sql`INSERT INTO registry_relayer_nonces(deployment,next_nonce) VALUES (${deployment},${pendingNonce}) ON CONFLICT DO NOTHING`);
        const lock = rows(await tx.execute(sql`SELECT next_nonce FROM registry_relayer_nonces WHERE deployment=${deployment} FOR UPDATE`))[0];
        const existing = rows(await tx.execute(sql`SELECT raw,hash,signature,nonce FROM registry_attempts WHERE institution_id=${institution} AND intent_id=${id}`))[0];
        if (existing) return { attempt: existing as RegistryAttempt };
        const allocated = rows(await tx.execute(sql`SELECT deployment,nonce FROM registry_nonce_allocations WHERE institution_id=${institution} AND intent_id=${id}`))[0];
        // An unfinished allocation may already have signed bytes in the budget store.
        // Never delete/reassign it or skip past it: its owning intent must recover first.
        const unfinished = rows(await tx.execute(sql`SELECT a.nonce FROM registry_nonce_allocations a
          LEFT JOIN registry_attempts r ON r.institution_id=a.institution_id AND r.intent_id=a.intent_id
          WHERE a.deployment=${deployment} AND r.intent_id IS NULL ORDER BY a.nonce LIMIT 1`))[0];
        if (unfinished && (!allocated || BigInt(unfinished.nonce) < BigInt(allocated.nonce)))
          throw new Error("Alokasi nonce relay sebelumnya harus dipulihkan sebelum pengesahan lain.");
        if (allocated) {
          if (allocated.deployment !== deployment) throw new Error("Deployment relay berubah.");
          return { nonce: Number(allocated.nonce) };
        }
        const nonce = Math.max(pendingNonce, Number(lock.next_nonce));
        if (!Number.isSafeInteger(nonce) || nonce < 0 || nonce >= Number.MAX_SAFE_INTEGER) throw new Error("Nonce relay tidak sah.");
        await tx.execute(sql`INSERT INTO registry_nonce_allocations(institution_id,intent_id,deployment,nonce) VALUES(${institution},${id},${deployment},${nonce})`);
        await tx.execute(sql`UPDATE registry_relayer_nonces SET next_nonce=${nonce + 1} WHERE deployment=${deployment}`);
        return { nonce };
      });
      if (allocation.attempt) return allocation.attempt;
      // The chain's committed budget reservation serializes signing and retains the
      // bytes; a different payload for this nonce cannot obtain another reservation.
      const attempt = await build(allocation.nonce!);
      await db.execute(sql`INSERT INTO registry_attempts(institution_id,intent_id,raw,hash,signature,nonce)
        VALUES (${institution},${id},${attempt.raw},${attempt.hash},${attempt.signature},${allocation.nonce!}) ON CONFLICT DO NOTHING`);
      const stored = rows(await db.execute(sql`SELECT raw,hash,signature,nonce FROM registry_attempts WHERE institution_id=${institution} AND intent_id=${id}`))[0] as RegistryAttempt;
      if (stored.raw !== attempt.raw || stored.hash !== attempt.hash || stored.signature !== attempt.signature) throw new Error("Retry relay berbeda dari transaksi tersimpan.");
      return stored;
    },
    async observe<T extends StoredIntent>(intent: T, observation: RecordingObservation, hash?: Hex): Promise<T> {
      const next = { ...intent, observation, ...(hash ? { transactionHash: hash } : {}) };
      const institution = subjectOf(intent).institutionId;
      if (hash ?? intent.transactionHash) await db.transaction(tx => persistObservation(tx, { intent, observation, hash: (hash ?? intent.transactionHash)! }));
      else await db.execute(sql`UPDATE registry_intents SET intent=${JSON.stringify(next)} WHERE institution_id=${institution} AND id=${intent.id}`);
      return next;
    },
  };
}
export type RegistryStore = ReturnType<typeof createRegistryStore>;

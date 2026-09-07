import { sql } from "drizzle-orm";
import type { EvidenceDatabase } from "./evidence-store";
import type { RecordingIntent, Hex, RecordingObservation } from "../../shared/report-registry";

const rows = (result: any): any[] => result.rows ?? result;
export type RegistryAttempt = { raw: Hex; hash: Hex; signature: Hex; nonce: number };
export function createRegistryStore(db: EvidenceDatabase) {
  const get = async (institution: string, id: string): Promise<RecordingIntent | null> => {
    const row = rows(await db.execute(sql`SELECT intent FROM registry_intents WHERE institution_id=${institution} AND id=${id}`))[0];
    return row ? JSON.parse(row.intent) : null;
  };
  return {
    async ensureSchema() {
      for (const statement of [
        `CREATE UNIQUE INDEX IF NOT EXISTS report_packages_owner_id ON report_packages(institution_id, id)`,
        `CREATE TABLE IF NOT EXISTS registry_intents (institution_id TEXT NOT NULL, id TEXT NOT NULL, package_id TEXT NOT NULL, intent TEXT NOT NULL,
         PRIMARY KEY(institution_id,id), FOREIGN KEY(institution_id,package_id) REFERENCES report_packages(institution_id,id))`,
        `CREATE TABLE IF NOT EXISTS registry_relayer_nonces (deployment TEXT PRIMARY KEY, next_nonce BIGINT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS registry_attempts (institution_id TEXT NOT NULL, intent_id TEXT NOT NULL, raw TEXT NOT NULL, hash TEXT NOT NULL, signature TEXT NOT NULL, nonce BIGINT NOT NULL,
         PRIMARY KEY(institution_id,intent_id), FOREIGN KEY(institution_id,intent_id) REFERENCES registry_intents(institution_id,id))`,
      ]) await db.execute(sql.raw(statement));
    },
    get,
    async create(intent: RecordingIntent) {
      await db.execute(sql`INSERT INTO registry_intents (institution_id,id,package_id,intent)
        VALUES (${intent.authorization.institutionId},${intent.id},${intent.authorization.packageId},${JSON.stringify(intent)}) ON CONFLICT DO NOTHING`);
      return (await get(intent.authorization.institutionId, intent.id))!;
    },
    async list(institution: string, packageId: string): Promise<RecordingIntent[]> {
      return rows(await db.execute(sql`SELECT intent FROM registry_intents WHERE institution_id=${institution} AND package_id=${packageId} ORDER BY id`)).map(r => JSON.parse(r.intent));
    },
    async attempt(institution: string, id: string): Promise<RegistryAttempt | null> {
      return rows(await db.execute(sql`SELECT raw,hash,signature,nonce FROM registry_attempts WHERE institution_id=${institution} AND intent_id=${id}`))[0] ?? null;
    },
    /** Lock the deployment's nonce allocation and persist signed bytes before any broadcast. */
    async reserve(institution: string, id: string, deployment: string, pendingNonce: number, build: (nonce: number) => Promise<RegistryAttempt>) {
      return db.transaction(async tx => {
        await tx.execute(sql`INSERT INTO registry_relayer_nonces(deployment,next_nonce) VALUES (${deployment},${pendingNonce}) ON CONFLICT DO NOTHING`);
        const lock = rows(await tx.execute(sql`SELECT next_nonce FROM registry_relayer_nonces WHERE deployment=${deployment} FOR UPDATE`))[0];
        const existing = rows(await tx.execute(sql`SELECT raw,hash,signature,nonce FROM registry_attempts WHERE institution_id=${institution} AND intent_id=${id}`))[0];
        if (existing) return existing as RegistryAttempt;
        const nonce = Math.max(pendingNonce, Number(lock.next_nonce));
        const attempt = await build(nonce);
        await tx.execute(sql`INSERT INTO registry_attempts(institution_id,intent_id,raw,hash,signature,nonce)
          VALUES (${institution},${id},${attempt.raw},${attempt.hash},${attempt.signature},${nonce})`);
        await tx.execute(sql`UPDATE registry_relayer_nonces SET next_nonce=${nonce + 1} WHERE deployment=${deployment}`);
        return attempt;
      });
    },
    async observe(intent: RecordingIntent, observation: RecordingObservation, hash?: Hex) {
      const next = { ...intent, observation, ...(hash ? { transactionHash: hash } : {}) };
      await db.execute(sql`UPDATE registry_intents SET intent=${JSON.stringify(next)} WHERE institution_id=${intent.authorization.institutionId} AND id=${intent.id}`);
      return next;
    },
  };
}
export type RegistryStore = ReturnType<typeof createRegistryStore>;

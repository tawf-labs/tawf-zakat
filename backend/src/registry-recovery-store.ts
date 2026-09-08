/** Durable canonical projection and append-only observations; signed attempts are never deleted. */
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { EvidenceDatabase } from "./evidence-store";
import { subjectOf, type StoredIntent } from "./registry-store";
import type { RecordingObservation, Hex } from "../../shared/report-registry";

const rows = (result: any): any[] => result.rows ?? result;
export type RecoveryCheckpoint = { blockNumber: string; blockHash: Hex; policy: string; checkedAt: number };
export type RegistryEvent = { chainId: number; registry: string; transactionHash: Hex; logIndex: number; blockNumber: string; blockHash: Hex; event: string };
export type RecoveredIntent = { intent: StoredIntent; observation: RecordingObservation; hash: Hex };
type Transaction = Parameters<Parameters<EvidenceDatabase["transaction"]>[0]>[0];

export async function persistObservation(tx: Transaction, { intent, observation, hash }: RecoveredIntent) {
  const institution = subjectOf(intent).institutionId;
  const deployment = `${intent.domain.chainId}:${intent.domain.verifyingContract.toLowerCase()}`;
  const encoded = JSON.stringify(observation);
  const identity = createHash("sha256").update(`${hash}:${encoded}`).digest("hex");
  await tx.execute(sql`INSERT INTO registry_observations (deployment,institution_id,intent_id,identity,hash,observation)
    VALUES (${deployment},${institution},${intent.id},${identity},${hash},${encoded}) ON CONFLICT DO NOTHING`);
  // Keep JSON wire ordering stable for existing domain consumers and merge under a row lock.
  const current = rows(await tx.execute(sql`SELECT intent FROM registry_intents WHERE institution_id=${institution} AND id=${intent.id} FOR UPDATE`))[0];
  if (!current) throw new Error("Percobaan registry tidak ditemukan.");
  const next = { ...JSON.parse(current.intent), observation, transactionHash: hash };
  await tx.execute(sql`UPDATE registry_intents SET intent=${JSON.stringify(next)} WHERE institution_id=${institution} AND id=${intent.id}`);
}

export function createRecoveryStore(db: EvidenceDatabase) {
  return {
    async ensureSchema() {
      for (const statement of [
        `CREATE TABLE IF NOT EXISTS registry_observations (deployment TEXT NOT NULL, institution_id TEXT NOT NULL, intent_id TEXT NOT NULL,
          identity TEXT NOT NULL, hash TEXT NOT NULL, observation TEXT NOT NULL, sequence BIGSERIAL NOT NULL,
          observed_at BIGINT NOT NULL DEFAULT (extract(epoch from clock_timestamp()) * 1000)::bigint, PRIMARY KEY(deployment,institution_id,intent_id,identity))`,
        `CREATE TABLE IF NOT EXISTS registry_checkpoints (deployment TEXT NOT NULL, institution_id TEXT NOT NULL, checkpoint TEXT,
          PRIMARY KEY(deployment,institution_id))`,
        `CREATE TABLE IF NOT EXISTS registry_events (deployment TEXT NOT NULL, institution_id TEXT NOT NULL, hash TEXT NOT NULL,
          log_index INTEGER NOT NULL, block_hash TEXT NOT NULL, event TEXT NOT NULL, canonical BOOLEAN NOT NULL,
          PRIMARY KEY(deployment,institution_id,hash,log_index,block_hash))`,
      ]) await db.execute(sql.raw(statement));
    },
    async institutions(): Promise<string[]> {
      return rows(await db.execute(sql`SELECT DISTINCT institution_id FROM registry_intents ORDER BY institution_id`)).map(r => r.institution_id);
    },
    async intents(institution: string): Promise<StoredIntent[]> {
      return rows(await db.execute(sql`SELECT intent FROM registry_intents WHERE institution_id=${institution} ORDER BY id`)).map(r => JSON.parse(r.intent));
    },
    async read(deployment: string, institution: string) {
      return db.transaction(async tx => {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
        const checkpoint = rows(await tx.execute(sql`SELECT checkpoint FROM registry_checkpoints WHERE deployment=${deployment} AND institution_id=${institution}`))[0]?.checkpoint;
        const events = rows(await tx.execute(sql`SELECT event,canonical FROM registry_events WHERE deployment=${deployment} AND institution_id=${institution} ORDER BY hash,log_index,block_hash`));
        const observations = rows(await tx.execute(sql`SELECT intent_id,hash,observation,observed_at FROM registry_observations WHERE deployment=${deployment} AND institution_id=${institution} ORDER BY sequence`));
        return { checkpoint: checkpoint ? JSON.parse(checkpoint) as RecoveryCheckpoint : null,
          events: events.map(r => ({ ...JSON.parse(r.event), canonical: r.canonical })),
          observations: observations.map(r => ({ intentId: r.intent_id, transactionHash: r.hash, observedAt: Number(r.observed_at), observation: JSON.parse(r.observation) as RecordingObservation })) };
      });
    },
    async commit(deployment: string, institution: string, expected: RecoveryCheckpoint | null, checkpoint: RecoveryCheckpoint,
      events: RegistryEvent[], observations: RecoveredIntent[], replay: boolean) {
      await db.transaction(async tx => {
        await tx.execute(sql`INSERT INTO registry_checkpoints(deployment,institution_id) VALUES (${deployment},${institution}) ON CONFLICT DO NOTHING`);
        const current = rows(await tx.execute(sql`SELECT checkpoint FROM registry_checkpoints WHERE deployment=${deployment} AND institution_id=${institution} FOR UPDATE`))[0]?.checkpoint;
        if ((current ?? null) !== (expected ? JSON.stringify(expected) : null)) throw new Error("Checkpoint berubah; ulangi pemeriksaan.");
        if (replay) await tx.execute(sql`UPDATE registry_events SET canonical=false WHERE deployment=${deployment} AND institution_id=${institution}`);
        for (const event of events) await tx.execute(sql`INSERT INTO registry_events(deployment,institution_id,hash,log_index,block_hash,event,canonical)
          VALUES (${deployment},${institution},${event.transactionHash},${event.logIndex},${event.blockHash},${JSON.stringify(event)},true)
          ON CONFLICT(deployment,institution_id,hash,log_index,block_hash) DO UPDATE SET canonical=true`);
        for (const observation of observations) await persistObservation(tx, observation);
        // Last write, in the SAME transaction. Any failure above or here rolls everything back.
        await tx.execute(sql`UPDATE registry_checkpoints SET checkpoint=${JSON.stringify(checkpoint)} WHERE deployment=${deployment} AND institution_id=${institution}`);
      });
    },
  };
}

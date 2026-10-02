/**
 * Kunci periode laporan terbit (ADR-0042 keputusan 6, #129).
 *
 * A published period report froze the operational costs of its period: once the registry
 * confirms the publication, a cost row it covered may no longer change silently. The
 * publication state lives in the on-chain registry, which the disbursement store cannot
 * read, so the moment a confirmed publication is observed is turned into a local lock row
 * that cost corrections check.
 *
 * Only a report whose source was frozen from the internal realization stream holds cost
 * rows (in its provenance), so only such a report locks. A row is covered when it was
 * recorded inside the report's period and no later than the frozen source's cut-off: the
 * same `inPeriod`/`byCutOff` test `realization-source.ts` applied when it froze them.
 */

import { sql } from "drizzle-orm";
import { keccak256, toHex } from "viem";
import type { Hex, RecordingIntent } from "../../shared/report-registry";
import { periodBounds } from "./ledger-rows";
import type { ReportingPeriod } from "./reconciliation";
import { DISBURSEMENT_REALIZATION_FORMAT } from "./realization-source";

type Executor = { execute: (query: any) => Promise<any> };
const rowsOf = (result: any): any[] => (Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : []);

/** Created by whichever store starts first: the registry writes locks, the disbursement store reads them. */
export const PERIOD_LOCK_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS report_period_locks (
     institution_id TEXT NOT NULL,
     package_id TEXT NOT NULL,
     intent_id TEXT NOT NULL,
     report_id TEXT NOT NULL,
     version TEXT NOT NULL,
     period_kind TEXT NOT NULL,
     period_year INTEGER NOT NULL,
     from_seconds BIGINT NOT NULL,
     to_seconds BIGINT NOT NULL,
     cut_off_seconds BIGINT NOT NULL,
     transaction_hash TEXT NOT NULL,
     locked_at BIGINT NOT NULL,
     PRIMARY KEY (institution_id, package_id)
   );`,
] as const;

export type PeriodLock = {
  packageId: string;
  reportId: string;
  version: string;
  period: ReportingPeriod;
  fromSeconds: number;
  toSeconds: number;
  cutOffSeconds: number;
  lockedAt: number;
};

const PUBLISH_ACTION = keccak256(toHex("PUBLISH_REPORT"));

/** The window `realization-source.ts` froze cost rows from: in the period, and no later than the cut-off. */
export function lockWindow(period: ReportingPeriod, cutOff: string) {
  const bounds = periodBounds(period);
  const fromSeconds = Math.floor(bounds.from.getTime() / 1000);
  const toSeconds = Math.floor(bounds.to.getTime() / 1000);
  const cutOffMs = Date.parse(cutOff);
  return { fromSeconds, toSeconds, cutOffSeconds: Number.isFinite(cutOffMs) ? Math.floor(cutOffMs / 1000) : toSeconds };
}

/** Whether a cost row recorded at `recordedAt` is part of what the locked report published. */
export const covers = (lock: PeriodLock, recordedAt: number) =>
  recordedAt >= lock.fromSeconds && recordedAt < lock.toSeconds && recordedAt <= lock.cutOffSeconds;

/** The locks covering a row, latest publication first. */
export const locksCovering = (locks: PeriodLock[], recordedAt: number) =>
  locks.filter((lock) => covers(lock, recordedAt)).sort((a, b) => b.lockedAt - a.lockedAt);

const PERIOD_LABELS: Record<string, string> = { SEMESTER: "Semester I", AKHIR_TAHUN: "Akhir Tahun" };
export const periodLabel = (period: ReportingPeriod) => `${PERIOD_LABELS[period.kind] ?? period.kind} ${period.year}`;

/**
 * Follows one observation of a registry intent. A confirmed publication of a package whose
 * source is the internal realization stream adds its lock, once; a publication the chain
 * later drops (a reorg, a revert) takes its lock away again. Draft packages, evidence
 * recordings and attestations never lock. Runs inside the transaction that stores the
 * observation, so a lock exists exactly when the confirmed observation does.
 */
export async function followPublication(tx: Executor, intent: RecordingIntent, state: string, hash: Hex) {
  const { institutionId, packageId, reportId, version, action } = intent.authorization;
  if (action !== PUBLISH_ACTION) return;
  if (state === "INCLUDED") return;
  if (state !== "CONFIRMED") {
    await tx.execute(sql`DELETE FROM report_period_locks WHERE institution_id = ${institutionId} AND intent_id = ${intent.id}`);
    return;
  }
  const sources = rowsOf(await tx.execute(sql`
    SELECT s.manifest_json FROM report_packages p
    JOIN evidence_sources s ON s.preparation_id = p.preparation_id
    WHERE p.institution_id = ${institutionId} AND p.id = ${packageId} AND s.status = 'READ'
  `));
  const frozen = sources
    .map((row) => JSON.parse(row.manifest_json))
    .find((manifest) => manifest.origin === "INTERNAL_LEDGER" && manifest.format === DISBURSEMENT_REALIZATION_FORMAT);
  if (!frozen) return;
  const window = lockWindow(frozen.period, frozen.cutOff);
  await tx.execute(sql`
    INSERT INTO report_period_locks (
      institution_id, package_id, intent_id, report_id, version, period_kind, period_year,
      from_seconds, to_seconds, cut_off_seconds, transaction_hash, locked_at
    ) VALUES (
      ${institutionId}, ${packageId}, ${intent.id}, ${reportId}, ${version}, ${frozen.period.kind}, ${frozen.period.year},
      ${window.fromSeconds}, ${window.toSeconds}, ${window.cutOffSeconds}, ${hash}, extract(epoch from clock_timestamp())::bigint
    )
    ON CONFLICT (institution_id, package_id) DO NOTHING
  `);
}

export async function loadPeriodLocks(executor: Executor, institutionId: string): Promise<PeriodLock[]> {
  return rowsOf(await executor.execute(sql`
    SELECT * FROM report_period_locks WHERE institution_id = ${institutionId} ORDER BY locked_at ASC, package_id ASC
  `)).map((row) => ({
    packageId: row.package_id,
    reportId: row.report_id,
    version: row.version,
    period: { kind: row.period_kind, year: Number(row.period_year) } as ReportingPeriod,
    fromSeconds: Number(row.from_seconds),
    toSeconds: Number(row.to_seconds),
    cutOffSeconds: Number(row.cut_off_seconds),
    lockedAt: Number(row.locked_at),
  }));
}

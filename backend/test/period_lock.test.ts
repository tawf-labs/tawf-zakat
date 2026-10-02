/**
 * Kunci periode laporan terbit (#129): which registry observations lock cost rows, and
 * which rows a lock covers. Real SQL; the confirmed-publication path over a real registry
 * is in `disbursement_realization_source_api.test.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { keccak256, toHex, type Hex } from "viem";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore } from "../src/tenancy-store";
import { createEvidenceStore } from "../src/evidence-store";
import { createRegistryStore } from "../src/registry-store";
import { covers, followPublication, loadPeriodLocks, lockWindow, type PeriodLock } from "../src/period-lock";
import { DISBURSEMENT_REALIZATION_FORMAT } from "../src/realization-source";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import type { RecordingIntent } from "../../shared/report-registry";

const SINAR = "lpz-sinar-amanah";
const PERIOD = { kind: "AKHIR_TAHUN" as const, year: 2026 };
const CUT_OFF = "2026-10-01T00:00:00.000Z";
const HASH = `0x${"44".repeat(32)}` as Hex;

let database: TestWorkspaceDatabase;
const execute = (query: any) => database.handle().execute(query);

/** A frozen preparation and its package; its source frozen from the realization stream, or pasted. */
async function packageWith(id: string, origin: "INTERNAL_LEDGER" | "PASTE") {
  await execute(sql`
    INSERT INTO evidence_preparations (
      id, institution_id, prepared_by, label, period_kind, period_year, currency_unit, outcome,
      commitment, commitment_scheme, commitment_salt, canonical_snapshot, public_summary_json, created_at
    ) VALUES (${`prep-${id}`}, ${SINAR}, 'amil', 'Laporan', 'AKHIR_TAHUN', 2026, 'IDR', 'RECONCILED', 'c', 's', 'salt', '{}', '{}', 0)
  `);
  const manifest = {
    role: "SOURCE", origin, period: PERIOD, cutOff: CUT_OFF,
    format: origin === "INTERNAL_LEDGER" ? DISBURSEMENT_REALIZATION_FORMAT : "baris-ledger",
  };
  await execute(sql`
    INSERT INTO evidence_sources (preparation_id, role, status, manifest_json, rows_json, row_count)
    VALUES (${`prep-${id}`}, 'SOURCE', 'READ', ${JSON.stringify(manifest)}, '[]', 0)
  `);
  await execute(sql`
    INSERT INTO report_packages (id, institution_id, preparation_id, canonical, digest)
    VALUES (${id}, ${SINAR}, ${`prep-${id}`}, '{}', '0x00')
  `);
}

const intentFor = (packageId: string, action = "PUBLISH_REPORT") => ({
  id: `intent-${packageId}`,
  authorization: { action: keccak256(toHex(action)), institutionId: SINAR, packageId, reportId: "laporan-2026", version: "1" },
}) as unknown as RecordingIntent;

const observe = (intent: RecordingIntent, state: string) =>
  database.handle().transaction((tx: any) => followPublication(tx, intent, state, HASH));

describe("Kunci periode laporan terbit (#129)", () => {
  beforeAll(async () => {
    database = await createTestWorkspaceDatabase();
    await createWorkspaceStore(database.handle()).ensureSchema();
    await createEvidenceStore(database.handle()).ensureSchema();
    await createRegistryStore(database.handle()).ensureSchema();
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await database.reset();
    await execute(sql`TRUNCATE TABLE report_period_locks`);
    for (const inst of SYNTHETIC_INSTITUTIONS) await createWorkspaceStore(database.handle()).upsertInstitution(institutionRecordOf(inst));
  });

  it("locks once on a confirmed publication of a report frozen from the realization stream", async () => {
    await packageWith("pkg-real", "INTERNAL_LEDGER");
    const intent = intentFor("pkg-real");
    for (const state of ["PREPARED", "SUBMITTED", "INCLUDED"]) await observe(intent, state);
    expect(await loadPeriodLocks(database.handle(), SINAR)).toEqual([]);

    await observe(intent, "CONFIRMED");
    await observe(intent, "CONFIRMED");
    const locks = await loadPeriodLocks(database.handle(), SINAR);
    expect(locks.map(({ lockedAt: _lockedAt, ...lock }) => lock)).toEqual([{
      packageId: "pkg-real", reportId: "laporan-2026", version: "1", period: PERIOD,
      ...lockWindow(PERIOD, CUT_OFF),
    }]);

    // A recheck that finds the publication still being confirmed leaves the lock alone.
    await observe(intent, "INCLUDED");
    expect(await loadPeriodLocks(database.handle(), SINAR)).toHaveLength(1);
  });

  it("never locks from a reverted publication, an evidence recording or a pasted source; a dropped publication releases", async () => {
    await packageWith("pkg-reverted", "INTERNAL_LEDGER");
    await observe(intentFor("pkg-reverted"), "REVERTED");
    await packageWith("pkg-recorded", "INTERNAL_LEDGER");
    await observe(intentFor("pkg-recorded", "RECORD_EVIDENCE"), "CONFIRMED");
    await packageWith("pkg-pasted", "PASTE");
    await observe(intentFor("pkg-pasted"), "CONFIRMED");
    expect(await loadPeriodLocks(database.handle(), SINAR)).toEqual([]);

    await packageWith("pkg-reorg", "INTERNAL_LEDGER");
    await observe(intentFor("pkg-reorg"), "CONFIRMED");
    expect(await loadPeriodLocks(database.handle(), SINAR)).toHaveLength(1);
    await observe(intentFor("pkg-reorg"), "NONCANONICAL");
    expect(await loadPeriodLocks(database.handle(), SINAR)).toEqual([]);
  });

  it("covers a row recorded inside the period and no later than the frozen cut-off", () => {
    const lock: PeriodLock = {
      packageId: "p", reportId: "r", version: "1", period: PERIOD, lockedAt: 0, ...lockWindow(PERIOD, CUT_OFF),
    };
    const at = (iso: string) => Date.parse(iso) / 1000;
    expect(covers(lock, at("2026-01-01T00:00:00Z"))).toBe(true);
    expect(covers(lock, at("2026-10-01T00:00:00Z"))).toBe(true);
    expect(covers(lock, at("2026-10-01T00:00:01Z"))).toBe(false);
    expect(covers(lock, at("2025-12-31T23:59:59Z"))).toBe(false);
    // Without a usable cut-off, the whole period is covered, as the realization source reads it.
    expect(lockWindow(PERIOD, "bukan tanggal").cutOffSeconds).toBe(at("2027-01-01T00:00:00Z"));
  });
});

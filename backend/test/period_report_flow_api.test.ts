/**
 * Laporan periode dari data aplikasi (ADR-0043, #130): daftar laporan, pratinjau
 * langkah 2, dan kunci data dari stream realisasi internal - lewat API nyata di atas
 * SQL nyata. The wizard asks only for a period and a cut-off; everything it freezes
 * is checked here against the realizations and costs actually recorded.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { createDisbursementStore } from "../src/disbursement-store";
import { createEvidenceStore } from "../src/evidence-store";
import { createContributionStore } from "../src/contribution-store";
import { createActivityStore } from "../src/activity-store";
import { createEncryptedFileStore } from "../src/evidence-files";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { DISBURSEMENT_REALIZATION_FORMAT } from "../src/realization-source";
import { NOT_COMPARED_NOTE, summarizePeriodReports, type PackageRow, type PreparationRow } from "../src/period-report-flow";
import { PROVENANCE_FILE_NAMES } from "../../shared/realization-provenance";
import {
  adminSinar, amilSinar, EVIDENCE, get, NOW, post, publishedProposal, readerSinar, realize, REPORTS, SINAR, seedInstitution, signIn, YEAR,
} from "./helpers/period-report-fixture";

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let tempDir: string;

/** Two programs, three handovers, one panjar with a cost against it and one direct cost. */
async function recordPeriod() {
  const admin = await signIn(adminSinar);
  const amil = await signIn(amilSinar);
  const zakat = await publishedProposal(admin, amil, { program: "Santunan Zakat", fundType: "ZAKAT", lines: [
    { id: "aid-uang", beneficiaryId: "ben-1", name: "Mustahik Satu", value: { kind: "MONEY", amountRequestedIdr: "1000000" } },
    { id: "aid-beras", beneficiaryId: "ben-2", name: "Mustahik Dua", value: { kind: "GOODS", unit: "kg", quantityRequested: "25" } },
  ] });
  const infak = await publishedProposal(admin, amil, { program: "Jumat Berkah", fundType: "INFAK", lines: [
    { id: "aid-infak", beneficiaryId: "ben-3", name: "Mustahik Tiga", value: { kind: "MONEY", amountRequestedIdr: "500000" } },
  ] });
  await realize(zakat, [
    { aidLineId: "aid-uang", beneficiaryId: "ben-1", method: "CASH", amountIdr: "1000000" },
    { aidLineId: "aid-beras", beneficiaryId: "ben-2", method: "GOODS_HANDOVER", quantity: "25", unit: "kg" },
  ], amil);
  await realize(infak, [{ aidLineId: "aid-infak", beneficiaryId: "ben-3", method: "CASH", amountIdr: "500000" }], amil);

  const panjar = await post(`/proposals/${zakat.id}/operational-costs/panjar`, {
    operationId: crypto.randomUUID(), holderOfficerId: "off-amil", amountIdr: "300000", purpose: "Distribusi", cashOutRef: "BKK-001",
    issuedOn: new Date(NOW * 1000).toISOString().slice(0, 10),
  }, amil);
  expect(panjar.status).toBe(201);
  const panjarId = (await panjar.json()).panjar.id;
  const costs = await post(`/proposals/${zakat.id}/operational-costs/items`, { operationId: crypto.randomUUID(), items: [
    { spentOn: new Date(NOW * 1000).toISOString().slice(0, 10), purpose: "Sewa mobil", amountIdr: "200000", payee: "Rental", fundingSource: { kind: "PANJAR", panjarId } },
    { spentOn: new Date(NOW * 1000).toISOString().slice(0, 10), purpose: "Fotokopi", amountIdr: "15000", payee: "Fotocopy Jaya", fundingSource: { kind: "KAS_LEMBAGA" } },
  ] }, amil);
  expect(costs.status).toBe(201);
  return { admin, amil };
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "period-report-flow-"));
  database = await createTestWorkspaceDatabase();
  store = createWorkspaceStore(database.handle());
});

beforeEach(async () => {
  await database.reset();
  const db = database.handle();
  const disbursement = createDisbursementStore(db);
  const evidence = createEvidenceStore(db);
  const activities = createActivityStore(db);
  await store.ensureSchema();
  await disbursement.ensureSchema();
  await evidence.ensureSchema();
  await createContributionStore(db).ensureSchema();
  await activities.ensureSchema();
  configureWorkspace({
    store, disbursement, evidence, activities, files: createEncryptedFileStore({ directory: tempDir, key: Buffer.alloc(32, 9) }),
    ethCall: async () => "0x", now: () => Math.floor(Date.now() / 1000), sessionTtlSeconds: 3600, challengeTtlSeconds: 300,
  });
  await seedInstitution(store);
});

afterAll(async () => {
  resetWorkspace();
  await database.close();
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

describe("Laporan periode dari data aplikasi (#130)", () => {
  it("langkah 2 menampilkan data aplikasi per jenis dana, barang, penerima, biaya, dan bukti belum lengkap", async () => {
    const { amil } = await recordPeriod();
    const res = await get(`${REPORTS}/preview?periodKind=AKHIR_TAHUN&year=${YEAR}`, amil);
    expect(res.status).toBe(200);
    const { preview } = await res.json();
    expect(preview.byFundType).toEqual([
      { fundType: "INFAK_SEDEKAH", amountIdr: "500000" },
      { fundType: "ZAKAT", amountIdr: "1000000" },
    ]);
    expect(preview.totalIdr).toBe("1500000");
    expect(preview.goods).toEqual([{ unit: "kg", quantity: "25", handovers: 1 }]);
    expect(preview.recipients).toBe(3);
    expect(preview.handovers).toBe(3);
    expect(preview.costs).toEqual({
      directIdr: "15000", fromAdvanceIdr: "200000", totalIdr: "215000", advancesIdr: "300000", unaccountedAdvancesIdr: "100000",
    });
    // No handover has its evidence yet: all three are listed, none dropped.
    expect(preview.incompleteEvidence.map((r: any) => r.recipient).sort()).toEqual(["Mustahik Dua", "Mustahik Satu", "Mustahik Tiga"]);
    expect(preview.afterCutOff).toBe(0);
  });

  it("batas data lebih awal mengecualikan realisasi sesudahnya sebagai belum terperiksa", async () => {
    const { amil } = await recordPeriod();
    const cutOff = new Date((NOW - 3 * 3600) * 1000).toISOString();
    const { preview } = await (await get(`${REPORTS}/preview?periodKind=AKHIR_TAHUN&year=${YEAR}&cutOff=${encodeURIComponent(cutOff)}`, amil)).json();
    expect(preview.handovers).toBe(0);
    expect(preview.afterCutOff).toBe(3);
  });

  it("kunci data membekukan snapshot bersumber realisasi di kedua sisi dan menyatakan tidak dibandingkan dengan pembukuan", async () => {
    const { amil } = await recordPeriod();
    const res = await post(REPORTS, { period: { kind: "AKHIR_TAHUN", year: YEAR } }, amil);
    expect(res.status).toBe(201);
    const { preparation } = await res.json();

    expect(preparation.label).toBe(`Laporan penyaluran Akhir tahun ${YEAR}`);
    expect(preparation.currencyUnit).toBe("IDR");
    expect(preparation.outcome).toBe("RECONCILED");
    expect(preparation.findings).toEqual([]);
    for (const role of ["CLAIM", "SOURCE"]) {
      const side = preparation.sources.find((s: any) => s.role === role);
      expect(side.status).toBe("READ");
      expect(side.manifest.origin).toBe("INTERNAL_LEDGER");
      expect(side.manifest.format).toBe(DISBURSEMENT_REALIZATION_FORMAT);
      expect(side.manifest.balanceSheet).toBe("ON");
      expect(side.rows.map((r: any) => r.amount).sort()).toEqual(["1000000", "500000"]);
    }
    const claim = preparation.sources.find((s: any) => s.role === "CLAIM");
    expect(claim.manifest.label).toBe("Data aplikasi (tanpa rekap pembukuan)");
    expect(claim.manifest.note).toContain(NOT_COMPARED_NOTE);
    expect(preparation.snapshot.coverageNotes[0]).toBe(NOT_COMPARED_NOTE);
    expect(preparation.files.map((f: any) => f.fileName).sort()).toEqual(
      [PROVENANCE_FILE_NAMES.CLAIM, PROVENANCE_FILE_NAMES.SOURCE].sort()
    );
    expect(preparation.files.every((f: any) => f.storageStatus === "STORED")).toBe(true);

    // The validator still examines it, and the limit travels into the report's disclosure.
    const review = await (await get(`${EVIDENCE}/${preparation.id}/reports/review`, amil)).json();
    expect(review.blockers).toEqual([]);
    expect(review.limitations).toContain(NOT_COMPARED_NOTE);
    expect(review.figures.length).toBeGreaterThan(0);
  });

  it("menolak batas data di masa depan, periode tak dikenal, dan pembaca tanpa kewenangan menyiapkan", async () => {
    const { amil } = await recordPeriod();
    const future = new Date((NOW + 86400) * 1000).toISOString();
    const ahead = await post(REPORTS, { period: { kind: "AKHIR_TAHUN", year: YEAR }, cutOff: future }, amil);
    expect(ahead.status).toBe(400);
    expect((await ahead.json()).error).toContain("Batas data tidak boleh sesudah saat ini");
    expect((await post(REPORTS, { period: { kind: "TRIWULAN", year: YEAR } }, amil)).status).toBe(400);
    const reader = await signIn(readerSinar);
    expect((await post(REPORTS, { period: { kind: "AKHIR_TAHUN", year: YEAR } }, reader)).status).toBe(403);
    // Reading the list and the preview is open to every member.
    expect((await get(REPORTS, reader)).status).toBe(200);
  });

  it("daftar memberi satu kartu per periode dengan status dan batas data dari satu endpoint", async () => {
    const { amil } = await recordPeriod();
    expect((await (await get(REPORTS, amil)).json()).reports).toEqual([]);

    const cutOff = new Date((NOW - 60) * 1000).toISOString();
    const first = (await (await post(REPORTS, { period: { kind: "AKHIR_TAHUN", year: YEAR }, cutOff }, amil)).json()).preparation;
    await post(REPORTS, { period: { kind: "SEMESTER", year: YEAR } }, amil);

    let { reports } = await (await get(REPORTS, amil)).json();
    expect(reports.map((r: any) => [r.name, r.status])).toEqual([[`Akhir tahun ${YEAR}`, "DRAF"], [`Semester I ${YEAR}`, "DRAF"]]);
    expect(reports[0]).toMatchObject({ cutOff, preparationId: first.id, fromApp: true, comparedWithBookkeeping: false, published: null });

    // A frozen package the validator passed: ready to publish.
    const review = await (await get(`${EVIDENCE}/${first.id}/reports/review`, amil)).json();
    const draft = (await (await post(`${EVIDENCE}/${first.id}/reports`, {
      mode: "HUMAN", reportId: `laporan-penyaluran-akhir-tahun-${YEAR}`, version: "1", disclosure: review.disclosure,
      draft: { narrative: "Penyaluran sesuai data aplikasi.", claims: review.figures.map((f: any) => ({ name: f.name, amount: f.value.amount, unit: f.value.unit })) },
    }, amil)).json()).package;
    expect(draft.verdict.outcome).toBe("LOLOS");
    const frozen = (await (await post(`${EVIDENCE}/${first.id}/reports/${draft.id}/freeze`, {}, amil)).json()).package;
    ({ reports } = await (await get(REPORTS, amil)).json());
    expect(reports[0].status).toBe("SIAP_TERBIT");

    // A confirmed publication leaves its lock (#129): published, version 1.
    await database.handle().execute(sql`
      INSERT INTO report_period_locks (institution_id, package_id, intent_id, report_id, version, period_kind, period_year,
        from_seconds, to_seconds, cut_off_seconds, transaction_hash, locked_at)
      VALUES (${SINAR}, ${frozen.id}, 'intent-1', ${frozen.reportId}, '1', 'AKHIR_TAHUN', ${YEAR}, 0, 0, 0, '0x00', ${NOW})
    `);
    ({ reports } = await (await get(REPORTS, amil)).json());
    expect(reports[0].status).toBe("TERBIT");
    expect(reports[0].published).toMatchObject({ packageId: frozen.id, version: "1" });

    // Data locked again after publication: a correction is under way.
    await Bun.sleep(1100);
    await post(REPORTS, { period: { kind: "AKHIR_TAHUN", year: YEAR } }, amil);
    ({ reports } = await (await get(REPORTS, amil)).json());
    expect(reports[0].status).toBe("DIKOREKSI");
    expect(reports[0].preparations).toHaveLength(2);
  });
});

describe("summarizePeriodReports", () => {
  const prep = (id: string, createdAt: number, extra: Partial<PreparationRow> = {}): PreparationRow => ({
    id, periodKind: "AKHIR_TAHUN", periodYear: 2026, createdAt,
    source: { origin: "INTERNAL_LEDGER", format: DISBURSEMENT_REALIZATION_FORMAT, cutOff: "2026-10-01T00:00:00.000Z" },
    claim: { origin: "INTERNAL_LEDGER", format: DISBURSEMENT_REALIZATION_FORMAT },
    ...extra,
  });
  const pkg = (id: string, preparationId: string, extra: Partial<PackageRow> = {}): PackageRow => ({
    id, preparationId, status: "FROZEN", reportId: "r", version: "1", outcome: "LOLOS", ...extra,
  });

  it("paket beku yang belum lolos atau milik data lama tidak membuat laporan siap diterbitkan", () => {
    const [failed] = summarizePeriodReports({ preparations: [prep("a", 1)], packages: [pkg("p", "a", { outcome: "DITOLAK" })], locks: [] });
    expect(failed!.status).toBe("DRAF");
    const [stale] = summarizePeriodReports({ preparations: [prep("a", 1), prep("b", 2)], packages: [pkg("p", "a")], locks: [] });
    expect(stale!.status).toBe("DRAF");
    expect(stale!.preparationId).toBe("b");
  });

  it("sumber tempel lama tampil sebagai laporan yang bukan dari data aplikasi tetapi dibandingkan", () => {
    const [legacy] = summarizePeriodReports({
      preparations: [prep("a", 1, { source: { origin: "PASTE", format: "baris-ledger", cutOff: "x" }, claim: { origin: "PASTE", format: "baris-ledger" } })],
      packages: [], locks: [],
    });
    expect(legacy).toMatchObject({ fromApp: false, comparedWithBookkeeping: true, cutOff: "x" });
  });
});

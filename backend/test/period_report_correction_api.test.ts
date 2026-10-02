/**
 * Laporan periode: koreksi laporan terbit (ADR-0043, #133), over the real API, real SQL
 * and a local Anvil registry. Version 1 is published; a cost row it locked is corrected
 * under the report-correction statement (#129) and a new handover is recorded; the period
 * is locked again, and step 4 shows each figure before and after, the cut-off of each
 * version and the costs. Version 2 is published succeeding version 1 on the registry, and
 * version 1 stays readable as superseded.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { createDisbursementStore } from "../src/disbursement-store";
import { createEvidenceStore } from "../src/evidence-store";
import { createContributionStore } from "../src/contribution-store";
import { createActivityStore } from "../src/activity-store";
import { createEncryptedFileStore } from "../src/evidence-files";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import {
  get, post, publishedProposal, realize, recordOneHandover, REPORTS, SINAR, seedInstitution, YEAR,
} from "./helpers/period-report-fixture";
import { startPeriodReportRegistry } from "./helpers/period-report-registry";

let anvil: Awaited<ReturnType<typeof startPeriodReportRegistry>>;
let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let registry: Awaited<ReturnType<Awaited<ReturnType<typeof startPeriodReportRegistry>>["runtime"]>>;
let tempDir: string;

const REPORT_ID = `laporan-penyaluran-akhir-tahun-${YEAR}`;
const NARRATIVE = "Lembaga menyalurkan bantuan kepada mustahik sesuai data yang tercatat di aplikasi.";

beforeAll(async () => {
  anvil = await startPeriodReportRegistry(18633);
  tempDir = await mkdtemp(join(tmpdir(), "period-report-correction-"));
  database = await createTestWorkspaceDatabase();
  store = createWorkspaceStore(database.handle());
}, 30000);

beforeEach(async () => {
  await database.reset();
  const db = database.handle();
  const disbursement = createDisbursementStore(db);
  const evidence = createEvidenceStore(db);
  const activities = createActivityStore(db);
  for (const s of [store, disbursement, evidence, createContributionStore(db), activities]) await s.ensureSchema();
  registry = await anvil.runtime(db);
  configureWorkspace({
    store, disbursement, evidence, activities, files: createEncryptedFileStore({ directory: tempDir, key: Buffer.alloc(32, 9) }),
    ethCall: registry.chain.accountSignatureCall, now: () => Math.floor(Date.now() / 1000), sessionTtlSeconds: 3600, challengeTtlSeconds: 300,
    registry,
  });
  await seedInstitution(store);
});

afterAll(async () => {
  resetWorkspace();
  await database.close();
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  await anvil.stop();
});

const lockPeriod = async (token: string) =>
  (await (await post(REPORTS, { period: { kind: "AKHIR_TAHUN", year: YEAR } }, token)).json()).preparation as { id: string };

describe("Laporan periode: koreksi laporan terbit (#133)", () => {
  it("koreksi menampilkan sebelum → sesudah dan terbit sebagai versi 2 yang merujuk versi 1 di registry", async () => {
    const { amil, admin, draft } = await recordOneHandover();
    const costs = `/proposals/${draft.id}/operational-costs`;
    const recorded = await post(`${costs}/items`, { operationId: crypto.randomUUID(), items: [{
      spentOn: `${YEAR}-01-10`, purpose: "Bensin", amountIdr: "100000", payee: "SPBU 34.153", fundingSource: { kind: "KAS_LEMBAGA" },
    }] }, amil);
    expect(recorded.status).toBe(201);
    const cost = (await recorded.json()).results[0].item;

    // Version 1, published.
    await Bun.sleep(1100);
    const first = await lockPeriod(amil);
    const v1 = (await (await post(`${REPORTS}/${first.id}/report`, { narrative: NARRATIVE, disclosed: true }, amil)).json()).package;
    expect(v1).toMatchObject({ status: "FROZEN", version: "1", predecessor: null });
    expect((await anvil.publish(v1, amil)).observation.state).toBe("CONFIRMED");
    let [report] = (await (await get(REPORTS, amil)).json()).reports;
    expect(report.status).toBe("TERBIT");
    expect(report.versions).toEqual([{ packageId: v1.id, version: "1", publishedAt: expect.any(Number), superseded: false }]);

    // The locked cost row changes only under the report-correction statement (#129); a new handover arrives.
    await Bun.sleep(1100);
    const correctCost = (extra: Record<string, unknown>) => post(`${costs}/items/${cost.id}/correct`, {
      operationId: crypto.randomUUID(), expectedVersion: 1, reason: "Struk tertulis lebih kecil",
      item: { spentOn: `${YEAR}-01-10`, purpose: "Bensin", amountIdr: "90000", payee: "SPBU 34.153", fundingSource: { kind: "KAS_LEMBAGA" } },
      ...extra,
    }, amil);
    expect((await correctCost({})).status).toBe(409);
    expect((await correctCost({ forReportCorrection: v1.id })).status).toBe(200);
    const second = await publishedProposal(admin, amil, { program: "Sembako", fundType: "ZAKAT", lines: [
      { id: "aid-2", beneficiaryId: "ben-2", name: "Mustahik Dua", value: { kind: "MONEY", amountRequestedIdr: "500000" } },
    ] });
    await realize(second, [{ aidLineId: "aid-2", beneficiaryId: "ben-2", method: "CASH", amountIdr: "500000", reportedAt: Math.floor(Date.now() / 1000) - 60 }], amil);

    // Locking the period again starts the correction; version 1 is still the official one until version 2 is.
    await Bun.sleep(1100);
    const relocked = await lockPeriod(amil);
    [report] = (await (await get(REPORTS, amil)).json()).reports;
    expect(report.status).toBe("DIKOREKSI");
    expect(report.versions.map((v: any) => [v.version, v.superseded])).toEqual([["1", false]]);

    // Step 4: predecessor and next version filled in, each figure before and after, the cut-offs and the costs.
    const material = await (await get(`${REPORTS}/${relocked.id}/report`, amil)).json();
    expect(material.identity).toEqual({ reportId: REPORT_ID, version: "2", predecessor: v1.id });
    expect(material.correctionRequired).toBe(true);
    const { correction } = material;
    expect(correction.predecessor).toEqual({ packageId: v1.id, version: "1" });
    const change = (name: string) => correction.figures.find((f: any) => f.name === name);
    expect(change("SOURCE.total")).toMatchObject({
      label: "Total disalurkan menurut data aplikasi", state: "BERUBAH",
      before: { amount: "1000000", unit: "IDR" }, after: { amount: "1500000", unit: "IDR" },
    });
    expect(change("rekonsiliasi.selisih").state).toBe("TETAP");
    expect(Date.parse(correction.cutOff.after)).toBeGreaterThan(Date.parse(correction.cutOff.before));
    expect(correction.costs).toEqual({ before: "100000", after: "90000" });

    // A correction needs its reason; with one it is frozen as version 2 succeeding version 1.
    expect((await post(`${REPORTS}/${relocked.id}/report`, { narrative: NARRATIVE, disclosed: true }, amil)).status).toBe(400);
    const v2 = (await (await post(`${REPORTS}/${relocked.id}/report`, {
      narrative: NARRATIVE, disclosed: true, correctionReason: "Biaya bensin salah ketik dan satu penyerahan tercatat terlambat.",
    }, amil)).json()).package;
    expect(v2).toMatchObject({
      status: "FROZEN", reportId: REPORT_ID, version: "2", predecessor: v1.id,
      correctionReason: "Biaya bensin salah ketik dan satu penyerahan tercatat terlambat.", verdict: { outcome: "LOLOS" },
    });

    // Published: the registry records version 2 with version 1 as its predecessor, and makes it official.
    expect((await anvil.publish(v2, amil)).observation.state).toBe("CONFIRMED");
    const onChain: any = await registry.chain.publishedVersion(SINAR, REPORT_ID, "2");
    expect(onChain.institution.packageId).toBe(v2.id);
    expect(onChain.institution.predecessor).toBe(v1.id);
    expect(await registry.chain.officialLine(SINAR, REPORT_ID)).toEqual({ packageId: v2.id, version: "2" });

    // Version 2 is current; version 1 stays readable, superseded.
    [report] = (await (await get(REPORTS, amil)).json()).reports;
    expect(report.status).toBe("TERBIT");
    expect(report.published).toMatchObject({ packageId: v2.id, version: "2" });
    expect(report.versions.map((v: any) => [v.packageId, v.version, v.superseded])).toEqual([[v2.id, "2", false], [v1.id, "1", true]]);

    // A further correction succeeds version 2.
    await Bun.sleep(1100);
    const third = await lockPeriod(amil);
    const next = await (await get(`${REPORTS}/${third.id}/report`, amil)).json();
    expect(next.identity).toEqual({ reportId: REPORT_ID, version: "3", predecessor: v2.id });
    expect(next.correction.predecessor).toEqual({ packageId: v2.id, version: "2" });
  }, 90000);

  it("laporan pertama tidak membawa perbandingan koreksi", async () => {
    const { amil } = await recordOneHandover();
    // Semester I: nothing of it is published on this suite's chain.
    const locked = (await (await post(REPORTS, { period: { kind: "SEMESTER", year: YEAR } }, amil)).json()).preparation;
    const material = await (await get(`${REPORTS}/${locked.id}/report`, amil)).json();
    expect(material.identity.predecessor).toBeNull();
    expect(material.correction).toBeNull();
  });
});

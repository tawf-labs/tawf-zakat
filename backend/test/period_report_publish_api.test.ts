/**
 * Laporan periode langkah 4–5 (ADR-0043, #131): kunci data → tulis → periksa →
 * terbitkan, over the real API, real SQL and a local Anvil registry. Staff never type
 * a report id, version, predecessor or figure: the flow fills them, and a publication
 * confirmed by the registry locks the period's operational costs (#129).
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
import { evidenceTypedData } from "../../shared/report-registry";
import { NOT_COMPARED_NOTE } from "../src/period-report-flow";
import {
  adminSinar, amilSinar, EVIDENCE, get, post, readerSinar, recordOneHandover, REPORTS, SINAR, seedInstitution, signIn, YEAR,
} from "./helpers/period-report-fixture";
import { startPeriodReportRegistry } from "./helpers/period-report-registry";

let anvil: Awaited<ReturnType<typeof startPeriodReportRegistry>>;
let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let tempDir: string;

const NARRATIVE = "Lembaga menyalurkan bantuan kepada mustahik sesuai data yang tercatat di aplikasi.";

beforeAll(async () => {
  anvil = await startPeriodReportRegistry(18631);
  tempDir = await mkdtemp(join(tmpdir(), "period-report-publish-"));
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
  const registry = await anvil.runtime(db);
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

/** Prepares, signs and relays the publication of a frozen package, then mines past the confirmations. */
async function publish(saved: any, token: string) {
  const path = `${EVIDENCE}/${saved.preparationId}/reports/${saved.id}/publication`;
  const prepared = await post(path, { retryId: crypto.randomUUID(), digest: saved.digest }, token);
  expect(prepared.status).toBe(201);
  const { intent } = await prepared.json();
  const signature = await amilSinar.signTypedData(evidenceTypedData(intent.domain, intent.authorization));
  const sent = await post(`${path}/${intent.id}/submit`, { signature }, token);
  expect(sent.status).toBe(200);
  await anvil.mine();
  await anvil.mine();
  // Reading the intent observes the chain; a confirmed publication is stored with its period lock.
  return (await (await get(`${path}/${intent.id}`, token)).json()).intent;
}

describe("Laporan periode: tinjau, tulis, periksa, terbitkan (#131)", () => {
  it("mengisi identitas dari periode dan registry, memeriksa narasi, membekukan, dan menerbitkan dengan kunci periode", async () => {
    const { amil } = await recordOneHandover();
    const locked = (await (await post(REPORTS, { period: { kind: "AKHIR_TAHUN", year: YEAR } }, amil)).json()).preparation;

    // Step 4 material: identity from the period, version 1, human figure labels, limits as sentences.
    let material = await (await get(`${REPORTS}/${locked.id}/report`, amil)).json();
    expect(material.identity).toEqual({ reportId: `laporan-penyaluran-akhir-tahun-${YEAR}`, version: "1", predecessor: null });
    expect(material.correctionRequired).toBe(false);
    expect(material.comparedWithBookkeeping).toBe(false);
    expect(material.publicationAvailable).toBe(true);
    expect(material.ready).toBeNull();
    const byName = Object.fromEntries(material.figures.map((f: any) => [f.name, f.label]));
    expect(byName["SOURCE.total"]).toBe("Total disalurkan menurut data aplikasi");
    expect(byName["SOURCE.ZAKAT.ON"]).toBe("Zakat mal disalurkan menurut data aplikasi");
    expect(byName["CLAIM.ZAKAT.ON"]).toBe("Zakat mal disalurkan pada sisi pembanding (data aplikasi, tanpa rekap pembukuan)");
    expect(byName["rekonsiliasi.selisih"]).toBe("Selisih sisi pembanding dikurangi data aplikasi");
    expect(material.figures.every((f: any) => f.label !== f.name)).toBe(true);
    expect(material.limitations).toContain(NOT_COMPARED_NOTE);

    // The disclosure statement is required.
    const undisclosed = await post(`${REPORTS}/${locked.id}/report`, { narrative: NARRATIVE, disclosed: false }, amil);
    expect(undisclosed.status).toBe(400);

    // A rupiah amount the report does not hold: not passed, with a reason staff can act on.
    const leaked = await (await post(`${REPORTS}/${locked.id}/report`, {
      narrative: "Total penyaluran mencapai Rp 2.500.000 pada periode ini.", disclosed: true,
    }, amil)).json();
    expect(leaked.package.status).toBe("DRAFT");
    expect(leaked.package.verdict.outcome).toBe("DITOLAK");
    expect(leaked.reasons).toHaveLength(1);
    expect(leaked.reasons[0]).toContain("Narasi menyebut angka");
    expect((await (await get(REPORTS, amil)).json()).reports[0].status).toBe("DRAF");

    // A narrative quoting the report's own figure passes and is frozen at once.
    const passed = await (await post(`${REPORTS}/${locked.id}/report`, {
      narrative: `${NARRATIVE} Total yang disalurkan Rp1.000.000.`, disclosed: true,
    }, amil)).json();
    expect(passed.reasons).toEqual([]);
    expect(passed.package).toMatchObject({
      status: "FROZEN", reportId: `laporan-penyaluran-akhir-tahun-${YEAR}`, version: "1", predecessor: null,
      verdict: { outcome: "LOLOS" },
    });
    expect(passed.package.draft.claims.map((c: any) => c.name).sort()).toEqual(material.figures.map((f: any) => f.name).sort());
    material = await (await get(`${REPORTS}/${locked.id}/report`, amil)).json();
    expect(material.ready.id).toBe(passed.package.id);
    expect((await (await get(REPORTS, amil)).json()).reports[0].status).toBe("SIAP_TERBIT");

    // Step 5 through the existing relay: confirmed, published, and the period's costs locked.
    const intent = await publish(passed.package, amil);
    expect(intent.observation.state).toBe("CONFIRMED");
    const [report] = (await (await get(REPORTS, amil)).json()).reports;
    expect(report.status).toBe("TERBIT");
    expect(report.published).toMatchObject({ packageId: passed.package.id, version: "1" });
    const locks = await database.handle().execute(sql`SELECT package_id, version FROM report_period_locks WHERE institution_id = ${SINAR}`);
    const rows = Array.isArray(locks) ? locks : (locks as any).rows;
    expect(rows.map((r: any) => [r.package_id, r.version])).toEqual([[passed.package.id, "1"]]);

    // Locking the period again continues the official line: version 2 succeeding version 1, with a reason.
    await Bun.sleep(1100);
    const relocked = (await (await post(REPORTS, { period: { kind: "AKHIR_TAHUN", year: YEAR } }, amil)).json()).preparation;
    const correction = await (await get(`${REPORTS}/${relocked.id}/report`, amil)).json();
    expect(correction.identity).toEqual({ reportId: `laporan-penyaluran-akhir-tahun-${YEAR}`, version: "2", predecessor: passed.package.id });
    expect(correction.correctionRequired).toBe(true);
    const noReason = await post(`${REPORTS}/${relocked.id}/report`, { narrative: NARRATIVE, disclosed: true }, amil);
    expect(noReason.status).toBe(400);
    expect((await noReason.json()).error).toContain("alasan koreksi");
  }, 60000);

  it("bantuan AI mengisi narasi saja; kegagalannya dinyatakan tanpa menyentuh angka", async () => {
    const { amil } = await recordOneHandover();
    const locked = (await (await post(REPORTS, { period: { kind: "AKHIR_TAHUN", year: YEAR } }, amil)).json()).preparation;
    const stub = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ claims: [], narrative: "Narasi usulan AI." }) } }],
    }) });
    const saved = { key: process.env.DEEPSEEK_API_KEY, url: process.env.DEEPSEEK_BASE_URL };
    try {
      process.env.DEEPSEEK_API_KEY = "kunci-uji";
      process.env.DEEPSEEK_BASE_URL = stub.url.toString();
      const suggested = await post(`${REPORTS}/${locked.id}/report/narrative`, {}, amil);
      expect(suggested.status).toBe(200);
      expect((await suggested.json()).narrative).toBe("Narasi usulan AI.");
      delete process.env.DEEPSEEK_API_KEY;
      const down = await post(`${REPORTS}/${locked.id}/report/narrative`, {}, amil);
      expect(down.status).toBe(503);
      expect((await down.json()).error).toContain("Tulis narasi sendiri");
    } finally {
      if (saved.key === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = saved.key;
      if (saved.url === undefined) delete process.env.DEEPSEEK_BASE_URL; else process.env.DEEPSEEK_BASE_URL = saved.url;
      stub.stop(true);
    }
  });

  it("hanya petugas yang menulis paket laporan", async () => {
    const { amil } = await recordOneHandover();
    const locked = (await (await post(REPORTS, { period: { kind: "AKHIR_TAHUN", year: YEAR } }, amil)).json()).preparation;
    for (const account of [adminSinar, readerSinar]) {
      const token = await signIn(account);
      expect((await post(`${REPORTS}/${locked.id}/report`, { narrative: NARRATIVE, disclosed: true }, token)).status).toBe(403);
      expect((await get(`${REPORTS}/${locked.id}/report`, token)).status).toBe(200);
    }
  });
});

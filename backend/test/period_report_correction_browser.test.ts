/**
 * Koreksi laporan terbit di browser (ADR-0043, issue #133): version 1 is published over
 * the API, a handover arrives afterwards, and the officer corrects the report in the real
 * workspace UI — *Buat koreksi* on the current version, the same wizard on a fixed period,
 * the before → after table, a required reason, and publication as version 2 while version
 * 1 stays readable as *Dikoreksi*. Real API and SQL, a local Anvil registry and a synthetic
 * wallet that signs as the institution's endorsing account. Opt-in like the other browser
 * suites: skipped unless REGISTRY_BROWSER_MODULE points at playwright-core.
 * PERIOD_REPORT_SCREENSHOTS keeps screenshots; PERIOD_REPORT_CSS_URL styles them.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore } from "../src/tenancy-store";
import { createDisbursementStore } from "../src/disbursement-store";
import { createContributionStore } from "../src/contribution-store";
import { createEvidenceStore } from "../src/evidence-store";
import { createEncryptedFileStore } from "../src/evidence-files";
import { createActivityStore } from "../src/activity-store";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import {
  amilSinar, post, publishedProposal, realize, recordOneHandover, REPORTS, SINAR, seedInstitution, YEAR,
} from "./helpers/period-report-fixture";
import { startPeriodReportRegistry } from "./helpers/period-report-registry";

let database: TestWorkspaceDatabase;
let tempDir: string;
let anvil: Awaited<ReturnType<typeof startPeriodReportRegistry>> | null = null;

describe("Koreksi laporan terbit di browser (#133)", () => {
  beforeAll(async () => {
    if (!process.env.REGISTRY_BROWSER_MODULE) return;
    anvil = await startPeriodReportRegistry(18634);
    tempDir = await mkdtemp(join(tmpdir(), "period-report-correction-browser-"));
    database = await createTestWorkspaceDatabase(process.env.PERIOD_REPORT_TEST_DATABASE_URL);
    const db = database.handle();
    const store = createWorkspaceStore(db), disbursement = createDisbursementStore(db), activities = createActivityStore(db);
    const contributions = createContributionStore(db), evidence = createEvidenceStore(db);
    for (const s of [store, disbursement, contributions, activities, evidence]) await s.ensureSchema();
    const registry = await anvil.runtime(db);
    configureWorkspace({
      store, disbursement, activities, contributions, evidence, registry,
      files: createEncryptedFileStore({ directory: tempDir, key: Buffer.alloc(32, 7) }),
      ethCall: registry.chain.accountSignatureCall, now: () => Math.floor(Date.now() / 1000), sessionTtlSeconds: 3600, challengeTtlSeconds: 300,
    });
    await seedInstitution(store);
  }, 30000);

  afterAll(async () => {
    if (!anvil) return;
    resetWorkspace();
    await database.close();
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await anvil.stop();
  });

  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("membuat koreksi dari versi terbit, meninjau sebelum → sesudah, dan menerbitkan versi 2", async () => {
    // Version 1, published over the API; then a handover recorded after it.
    const { admin, amil } = await recordOneHandover();
    await Bun.sleep(1100);
    const first = (await (await post(REPORTS, { period: { kind: "AKHIR_TAHUN", year: YEAR } }, amil)).json()).preparation;
    const v1 = (await (await post(`${REPORTS}/${first.id}/report`, {
      narrative: "Lembaga menyalurkan Rp1.000.000 kepada mustahik.", disclosed: true,
    }, amil)).json()).package;
    expect((await anvil!.publish(v1, amil)).observation.state).toBe("CONFIRMED");
    const later = await publishedProposal(admin, amil, { program: "Sembako", fundType: "ZAKAT", lines: [
      { id: "aid-2", beneficiaryId: "ben-2", name: "Mustahik Dua", value: { kind: "MONEY", amountRequestedIdr: "500000" } },
    ] });
    await realize(later, [{ aidLineId: "aid-2", beneficiaryId: "ben-2", method: "CASH", amountIdr: "500000", reportedAt: Math.floor(Date.now() / 1000) - 60 }], amil);
    await Bun.sleep(1100);

    const built = await Bun.build({
      entrypoints: [new URL("../../frontend/test/officer-smoke.tsx", import.meta.url).pathname],
      target: "browser",
      define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "" }) },
    });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const bundle = await built.outputs[0]!.text();
    const css = process.env.PERIOD_REPORT_CSS_URL ? await (await fetch(process.env.PERIOD_REPORT_CSS_URL)).text() : "";
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/") return new Response('<!doctype html><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
        if (path === "/app.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
        if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
        if (path === "/wallet-rpc") {
          const { method, params } = await req.json();
          if (["eth_accounts", "eth_requestAccounts"].includes(method)) return Response.json([amilSinar.address]);
          if (method === "eth_chainId") return Response.json("0x7a69");
          if (method === "eth_signTypedData_v4") return Response.json(await amilSinar.signTypedData(JSON.parse(params[1])));
          return Response.json(null);
        }
        return app.fetch(req);
      },
    });

    const shots = process.env.PERIOD_REPORT_SCREENSHOTS;
    const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let mining: ReturnType<typeof setInterval> | undefined;
    try {
      browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      const shot = async (name: string) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true }); };
      page.setDefaultTimeout(15000);
      await page.goto(server.url.toString());
      await page.getByRole("button", { name: /^0x/ }).waitFor();
      await page.getByLabel("Pengelola Zakat", { exact: true }).selectOption(SINAR);
      await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();
      await page.getByRole("heading", { name: "LPZ Sinar Amanah (sintetis)" }).first().waitFor();
      await page.getByRole("navigation", { name: "Bagian ruang kerja" }).getByRole("button", { name: "Bukti & laporan" }).click();

      // The published card: version 1 is current, and only it offers a correction.
      const card = page.getByRole("button", { name: new RegExp(`Laporan penyaluran Akhir tahun ${YEAR}`) });
      await card.getByText("Terbit · versi 1").waitFor();
      await card.click();
      const versions = page.getByRole("region", { name: "Versi terbit" });
      await versions.getByText("Berlaku").waitFor();
      await shot("20-terbit-versi-1");
      await versions.getByRole("button", { name: "Buat koreksi" }).click();

      // The same wizard on a fixed period, explaining the version it corrects and the locked cost rows.
      const wizard = page.getByRole("region", { name: `Koreksi laporan penyaluran Akhir tahun ${YEAR}` });
      await wizard.getByText(/Versi 1 laporan ini sudah terbit/).waitFor();
      await wizard.getByText(/sebagai versi 2 yang menggantikan versi 1/).waitFor();
      expect(await wizard.getByRole("radio", { name: /Semester I/ }).count()).toBe(0);
      const costs = wizard.getByRole("region", { name: "Baris biaya yang terkunci laporan" });
      await costs.getByText(/pernyataan bahwa perubahan itu untuk versi koreksi laporan ini/).waitFor();
      await costs.getByRole("button", { name: "Buka Biaya operasional di Penyaluran" }).waitFor();
      await shot("21-koreksi-langkah-1");
      await wizard.getByRole("button", { name: "Lanjut: lihat data" }).click();
      await wizard.getByText("Rp1.500.000").first().waitFor();
      await wizard.getByRole("button", { name: "Kunci data laporan" }).click();

      // Step 4: version 2 succeeding version 1, each figure before and after, the cut-off change in words.
      const review = page.getByRole("region", { name: `Tinjau dan terbitkan Akhir tahun ${YEAR}` });
      await review.getByText(/Versi 2, mengoreksi versi 1 yang sudah terbit/).waitFor();
      const changes = review.getByRole("region", { name: "Perubahan dibanding versi 1" });
      const total = changes.getByRole("row", { name: /Total disalurkan menurut data aplikasi/ });
      await total.getByRole("cell", { name: "Rp1.000.000" }).waitFor();
      await total.getByRole("cell", { name: "Rp1.500.000" }).waitFor();
      await total.getByRole("cell", { name: "berubah" }).waitFor();
      await changes.getByText(/Batas data berubah dari/).waitFor();
      expect(await changes.getByText(/CLAIM\.|SOURCE\./).count()).toBe(0);
      await shot("22-sebelum-sesudah");

      // The reason is required before the check can run.
      await review.getByLabel("Narasi laporan").fill("Lembaga menyalurkan Rp1.500.000 kepada mustahik pada periode ini.");
      await review.getByLabel(/Saya menyertakan seluruh sumber/).check();
      const check = review.getByRole("button", { name: "Periksa laporan" });
      expect(await check.isDisabled()).toBe(true);
      await review.getByLabel(/Alasan koreksi/).fill("Satu penyerahan tercatat sesudah versi 1 terbit.");
      await check.click();
      await review.getByText("Hasil pemeriksaan otomatis: lolos").waitFor();

      // Published as version 2.
      const publish = review.getByRole("region", { name: "Sahkan dan terbitkan" });
      await publish.getByLabel(/Saya mengesahkan penerbitan laporan ini/).check();
      await publish.getByRole("button", { name: "Sahkan dan terbitkan" }).click();
      mining = setInterval(() => { void anvil!.mine().catch(() => {}); }, 500);
      await publish.getByText("Terbit", { exact: true }).waitFor({ timeout: 30000 });
      await card.getByText("Terbit · versi 2").waitFor({ timeout: 15000 });
      await review.getByRole("button", { name: "Tutup" }).click();

      // Version 1 stays readable as Dikoreksi; only version 2 offers a correction.
      const v1Row = versions.getByRole("listitem").filter({ hasText: "Versi 1" });
      const v2Row = versions.getByRole("listitem").filter({ hasText: "Versi 2" });
      await v1Row.getByText("Dikoreksi").waitFor();
      await v1Row.getByRole("link", { name: "Lihat ringkasan publik" }).waitFor();
      await v2Row.getByText("Berlaku").waitFor();
      expect(await v1Row.getByRole("button", { name: "Buat koreksi" }).count()).toBe(0);
      expect(await versions.getByRole("button", { name: "Buat koreksi" }).count()).toBe(1);
      await shot("23-versi-2-terbit");

      // The cost notice leads to Penyaluran, where locked cost rows are corrected.
      await v2Row.getByRole("button", { name: "Buat koreksi" }).click();
      await page.getByRole("button", { name: "Buka Biaya operasional di Penyaluran" }).click();
      await page.getByRole("heading", { name: "Penyaluran" }).first().waitFor();

      expect(errors).toEqual([]);
    } finally {
      if (mining) clearInterval(mining);
      await browser?.close();
      server.stop(true);
    }
  }, 150_000);
});

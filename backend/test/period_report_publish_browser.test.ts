/**
 * Laporan periode langkah 4–5 di browser (ADR-0043, issue #131): kunci data → tinjau
 * dan tulis → periksa → sahkan dan terbitkan, with the real workspace UI bundle, the
 * real API and SQL, a local Anvil registry and a synthetic wallet that signs as the
 * institution's endorsing account. Opt-in like the other browser suites: skipped
 * unless REGISTRY_BROWSER_MODULE points at playwright-core. PERIOD_REPORT_SCREENSHOTS
 * keeps screenshots; PERIOD_REPORT_CSS_URL styles them.
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
import { amilSinar, recordOneHandover, SINAR, seedInstitution, YEAR } from "./helpers/period-report-fixture";
import { startPeriodReportRegistry } from "./helpers/period-report-registry";

let database: TestWorkspaceDatabase;
let tempDir: string;
let anvil: Awaited<ReturnType<typeof startPeriodReportRegistry>> | null = null;

describe("Laporan periode langkah 4–5 di browser (#131)", () => {
  beforeAll(async () => {
    if (!process.env.REGISTRY_BROWSER_MODULE) return;
    anvil = await startPeriodReportRegistry(18632);
    tempDir = await mkdtemp(join(tmpdir(), "period-report-publish-browser-"));
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

  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("menulis, memeriksa, lalu mengesahkan dan menerbitkan tanpa isian teknis", async () => {
    await recordOneHandover();

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

      // Steps 1–2, then straight on to step 4.
      await page.getByRole("button", { name: "Laporan periode baru" }).click();
      await page.getByRole("button", { name: "Lanjut: lihat data" }).click();
      await page.getByRole("button", { name: "Kunci data laporan" }).click();
      const wizard = page.getByRole("region", { name: `Tinjau dan terbitkan Akhir tahun ${YEAR}` });

      // Step 4: human labels, read-only figures, limits as sentences, identity filled in.
      const app_ = wizard.getByRole("region", { name: "Data dari aplikasi" });
      await app_.getByRole("cell", { name: "Total disalurkan menurut data aplikasi" }).waitFor();
      await app_.getByRole("cell", { name: "Rp1.000.000" }).first().waitFor();
      await wizard.getByText(`laporan-penyaluran-akhir-tahun-${YEAR}`).waitFor();
      await wizard.getByRole("region", { name: "Batas pemeriksaan" }).getByText(/tidak dibandingkan dengan pembukuan bendahara/).waitFor();
      expect(await wizard.getByText(/CLAIM\.|SOURCE\./).count()).toBe(0);
      expect(await wizard.locator("input:not([type=checkbox])").count()).toBe(0);

      // A narrative with a figure the report does not hold: not passed, with the reason.
      const narrative = wizard.getByLabel("Narasi laporan");
      await narrative.fill("Total penyaluran mencapai Rp 2.500.000.");
      await wizard.getByLabel(/Saya menyertakan seluruh sumber/).check();
      await shot("10-tinjau-tulis");
      await wizard.getByRole("button", { name: "Periksa laporan" }).click();
      await wizard.getByText("Hasil pemeriksaan otomatis: belum lolos").waitFor();
      await wizard.getByText(/Narasi menyebut angka "Rp 2\.500\.000"/).waitFor();
      await shot("11-belum-lolos");

      // Corrected: passes, frozen, and step 5 opens.
      await narrative.fill("Lembaga menyalurkan Rp1.000.000 kepada mustahik pada periode ini.");
      await wizard.getByRole("button", { name: "Periksa laporan" }).click();
      await wizard.getByText("Hasil pemeriksaan otomatis: lolos").waitFor();
      const publish = wizard.getByRole("region", { name: "Sahkan dan terbitkan" });
      await publish.getByLabel(/Saya mengesahkan penerbitan laporan ini/).check();
      await shot("12-siap-terbit");

      // Step 5: the endorsing account signs; waiting for confirmation, then published.
      await publish.getByRole("button", { name: "Sahkan dan terbitkan" }).click();
      await publish.getByText("Menunggu konfirmasi").waitFor();
      await shot("13-menunggu-konfirmasi");
      mining = setInterval(() => { void anvil!.mine().catch(() => {}); }, 500);
      await publish.getByText("Terbit", { exact: true }).waitFor({ timeout: 30000 });
      await publish.getByRole("link", { name: "Lihat ringkasan publik" }).waitFor();
      await page.getByRole("button", { name: new RegExp(`Laporan penyaluran Akhir tahun ${YEAR}`) }).getByText("Terbit · versi 1").waitFor({ timeout: 15000 });
      await shot("14-terbit");

      expect(errors).toEqual([]);
    } finally {
      if (mining) clearInterval(mining);
      await browser?.close();
      server.stop(true);
    }
  }, 120_000);
});

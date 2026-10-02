/**
 * Laporan periode di browser (ADR-0043, issue #130): daftar → periode → kunci data,
 * with the real workspace UI bundle over the real API and SQL and a synthetic wallet.
 * Opt-in like the other browser suites: skipped unless REGISTRY_BROWSER_MODULE points
 * at playwright-core. PERIOD_REPORT_SCREENSHOTS keeps a screenshot of each step, and
 * PERIOD_REPORT_CSS_URL (e.g. the Vite dev server's `/src/styles.css?direct`) styles them.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore } from "../src/tenancy-store";
import { createDisbursementStore } from "../src/disbursement-store";
import { createContributionStore } from "../src/contribution-store";
import { createEvidenceStore } from "../src/evidence-store";
import { createEncryptedFileStore } from "../src/evidence-files";
import { createActivityStore } from "../src/activity-store";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";

const BASE = "http://localhost:3001/api/workspace";
const SINAR = "lpz-sinar-amanah";
const adminSinar = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
const amilSinar = privateKeyToAccount(`0x${"22".repeat(32)}` as Hex);
const NOW = Math.floor(Date.now() / 1000);
const YEAR = new Date(NOW * 1000).getUTCFullYear();

let database: TestWorkspaceDatabase;
let tempDir: string;

const request = (path: string, init: RequestInit = {}) => app.fetch(new Request(`${BASE}${path}`, init));
const post = (path: string, body: unknown, token: string) =>
  request(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

async function signIn(account: typeof amilSinar): Promise<string> {
  const minted = await request("/challenge", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ institutionId: SINAR, account: account.address }),
  });
  const { challenge, typedData } = await minted.json();
  const signature = await account.signTypedData({
    ...typedData,
    message: { ...typedData.message, issuedAt: BigInt(typedData.message.issuedAt), expiresAt: BigInt(typedData.message.expiresAt) },
  });
  const session = await request("/session", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nonce: challenge.nonce, signature }),
  });
  return (await session.json()).token;
}

describe("Laporan periode di browser (#130)", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "period-report-browser-"));
    database = await createTestWorkspaceDatabase(process.env.PERIOD_REPORT_TEST_DATABASE_URL);
    const db = database.handle();
    const store = createWorkspaceStore(db), disbursement = createDisbursementStore(db), activities = createActivityStore(db);
    const contributions = createContributionStore(db), evidence = createEvidenceStore(db);
    for (const s of [store, disbursement, contributions, activities, evidence]) await s.ensureSchema();
    configureWorkspace({
      store, disbursement, activities, contributions, evidence, files: createEncryptedFileStore({ directory: tempDir, key: Buffer.alloc(32, 7) }),
      ethCall: async () => "0x", now: () => Math.floor(Date.now() / 1000), sessionTtlSeconds: 3600, challengeTtlSeconds: 300,
    });
    for (const inst of SYNTHETIC_INSTITUTIONS) await store.upsertInstitution(institutionRecordOf(inst));
    await store.upsertMembership({ institutionId: SINAR, account: adminSinar.address, role: "ADMIN" });
    await store.upsertMembership({ institutionId: SINAR, account: amilSinar.address, role: "OFFICER" });
    for (const [id, displayName, account] of [["off-admin", "Admin Sinar", adminSinar], ["off-amil", "Amil Sinar", amilSinar]] as const) {
      await store.createOfficerProfile({
        id, institutionId: SINAR, displayName, account: account.address, role: id === "off-admin" ? "ADMIN" : "OFFICER", actor: adminSinar.address, now: NOW,
      });
    }
    for (const [officerId, fn] of [["off-admin", "MANAGE_PROGRAMS"], ["off-amil", "PREPARE_PROPOSALS"], ["off-amil", "RECORD_REALIZATION"]] as const) {
      await store.grantMandate({ institutionId: SINAR, actor: adminSinar.address, now: NOW, mandate: {
        officerId, function: fn, scopeType: "ALL_PROGRAMS", assignmentRef: `SK/${fn}`, validFrom: NOW - 1000, validUntil: NOW + 86400 * 30,
      } });
    }
  });

  afterAll(async () => {
    resetWorkspace();
    await database.close();
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("membuat laporan periode: daftar → periode → kunci data, detail teknis tertutup", async () => {
    // One handover recorded on a proposal published on the institution's internal decision.
    const admin = await signIn(adminSinar);
    const amil = await signIn(amilSinar);
    const programId = (await (await post("/programs", {
      name: "Jumat Berkah", purpose: "Santunan", fundType: "ZAKAT", scope: "Tangerang Selatan", referenceCeiling: "10000000",
    }, admin)).json()).program.id;
    const draft = (await (await post("/proposals", {
      expectedVersion: 0, operationId: crypto.randomUUID(), programId, originOfRequest: "Data RT", purpose: "Santunan Jumat",
      personInCharge: "Bendahara", aidPeriod: { start: `${YEAR}-01-01`, end: `${YEAR}-12-31` },
      beneficiaries: [{ id: "ben-1", name: "Mustahik Satu", asnaf: "Fakir", addressOrScope: "RT 03",
        identityBasis: { kind: "NIK", value: "3674010101010001" }, guardian: null, paymentRecipient: null }],
      aidLines: [{ id: "aid-1", beneficiaryId: "ben-1", aidType: "Uang tunai", period: `${YEAR}-01`, value: { kind: "MONEY", amountRequestedIdr: "1000000" } }],
    }, amil)).json()).draft;
    await post(`/proposals/${draft.id}/documents`, {
      category: "RECIPIENT_VERIFICATION", fileName: "ba.txt", mimeType: "text/plain", beneficiaryId: null,
      contentBase64: Buffer.from("Berita acara").toString("base64"),
    }, amil);
    const published = await (await post(`/proposals/${draft.id}/publish`, {
      operationId: crypto.randomUUID(), expectedVersion: draft.version, decisionReference: "Rapat pengurus", decisionDate: `${YEAR}-01-02`,
    }, amil)).json();
    expect((await post(`/proposals/${draft.id}/realizations`, {
      operationId: crypto.randomUUID(), expectedVersion: published.draft.version,
      items: [{ aidLineId: "aid-1", beneficiaryId: "ben-1", method: "CASH", amountIdr: "1000000", reportedAt: NOW - 3600 }],
    }, amil)).status).toBe(201);

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
    try {
      browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      const shot = async (name: string) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true }); };
      page.setDefaultTimeout(10000);
      await page.goto(server.url.toString());
      await page.getByRole("button", { name: /^0x/ }).waitFor();
      await page.getByLabel("Pengelola Zakat", { exact: true }).selectOption(SINAR);
      await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();
      await page.getByRole("heading", { name: "LPZ Sinar Amanah (sintetis)" }).first().waitFor();
      await page.getByRole("navigation", { name: "Bagian ruang kerja" }).getByRole("button", { name: "Bukti & laporan" }).click();

      // The list comes first; nothing technical and no browser file input on the main screen.
      await page.getByRole("heading", { name: "Laporan periode" }).waitFor();
      await page.getByText("Belum ada laporan periode.", { exact: false }).waitFor();
      expect(await page.locator('input[type="file"]').count()).toBe(0);
      await shot("01-daftar-kosong");

      // Step 1: period, year and cut-off - nothing about rupiah or balance sheets.
      await page.getByRole("button", { name: "Laporan periode baru" }).click();
      const wizard = page.getByRole("region", { name: "Laporan periode baru" });
      await wizard.getByRole("radio", { name: /Akhir tahun/ }).check();
      expect(await wizard.getByRole("combobox", { name: "Tahun" }).inputValue()).toBe(String(YEAR));
      await wizard.getByText("Data yang dicatat sesudah batas ini tidak masuk laporan dan tidak dianggap tidak ada.").waitFor();
      expect(await wizard.getByRole("radio", { name: "Sekarang" }).isChecked()).toBe(true);
      expect(await wizard.getByText(/neraca|USDC|JSON/i).count()).toBe(0);
      await shot("02-periode");
      await wizard.getByRole("button", { name: "Lanjut: lihat data" }).click();

      // Step 2: the app's data in staff language.
      await wizard.getByText(`Akhir tahun ${YEAR}`, { exact: true }).waitFor();
      await wizard.getByText("Rp1.000.000").first().waitFor();
      await wizard.getByText("1 orang").waitFor();
      await wizard.getByText("1 penyerahan buktinya belum lengkap").waitFor();
      await wizard.getByRole("region", { name: "Disalurkan per jenis dana" }).getByText("Zakat").waitFor();
      await shot("03-data-aplikasi");
      await wizard.getByRole("button", { name: "Kunci data laporan" }).click();

      // Back on the list: one card, a draft, its cut-off; technical details closed until asked for.
      await page.getByRole("status").filter({ hasText: "Data laporan dikunci." }).waitFor();
      const card = page.getByRole("button", { name: new RegExp(`Laporan penyaluran Akhir tahun ${YEAR}`) });
      await card.getByText("Draf", { exact: true }).waitFor();
      await card.getByText(/^Batas data /).waitFor();
      await page.getByText("Angka disusun dari data aplikasi dan tidak dibandingkan dengan pembukuan bendahara.").waitFor();
      const summary = page.getByText("Detail teknis", { exact: true });
      expect(await summary.evaluate((el: HTMLElement) => (el.parentElement as HTMLDetailsElement).open)).toBe(false);
      expect(await page.getByText(/Commitment/).count()).toBe(0);
      await shot("04-daftar-draf");

      await summary.click();
      await page.getByText(/^Commitment /).waitFor();
      await page.getByText("Data aplikasi (tanpa rekap pembukuan)").first().waitFor();
      await shot("05-detail-teknis");

      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      server.stop(true);
    }
  }, 120_000);
});

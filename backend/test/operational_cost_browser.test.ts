/**
 * Tab Biaya Operasional in a real browser (ADR-0042, issue #127): the real workspace UI
 * bundle, the real API over real SQL, and a synthetic wallet. Opt-in like the other
 * browser suites: skipped unless REGISTRY_BROWSER_MODULE points at playwright-core.
 * Set OPERATIONAL_COST_SCREENSHOTS to a directory to keep screenshots of each step, and
 * OPERATIONAL_COST_CSS_URL to the app's compiled stylesheet (e.g. the Vite dev server's
 * `/src/styles.css?direct`) so the page, and the screenshots, look as they do in the app.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sql } from "drizzle-orm";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore } from "../src/tenancy-store";
import { createDisbursementStore } from "../src/disbursement-store";
import { createContributionStore } from "../src/contribution-store";
import { createEncryptedFileStore } from "../src/evidence-files";
import { createActivityStore } from "../src/activity-store";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";

const BASE = "http://localhost:3001/api/workspace";
const SINAR = "lpz-sinar-amanah";
const adminSinar = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
const amilSinar = privateKeyToAccount(`0x${"22".repeat(32)}` as Hex);
const NOW = Math.floor(Date.now() / 1000);

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

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode("struk sintetis")]);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64",
);

describe("Tab Biaya Operasional di browser (#127)", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "operational-cost-browser-"));
    database = await createTestWorkspaceDatabase(process.env.OPERATIONAL_COST_TEST_DATABASE_URL);
    const store = createWorkspaceStore(database.handle());
    const disbursement = createDisbursementStore(database.handle());
    const activities = createActivityStore(database.handle());
    await store.ensureSchema();
    await disbursement.ensureSchema();
    await createContributionStore(database.handle()).ensureSchema();
    await activities.ensureSchema();
    configureWorkspace({
      store, disbursement, activities, files: createEncryptedFileStore({ directory: tempDir, key: Buffer.alloc(32, 7) }),
      ethCall: async () => "0x", now: () => Math.floor(Date.now() / 1000), sessionTtlSeconds: 3600, challengeTtlSeconds: 300,
    });
    for (const inst of SYNTHETIC_INSTITUTIONS) await store.upsertInstitution(institutionRecordOf(inst));
    await store.upsertMembership({ institutionId: SINAR, account: adminSinar.address, role: "ADMIN" });
    await store.upsertMembership({ institutionId: SINAR, account: amilSinar.address, role: "OFFICER" });
    for (const [id, displayName, account] of [
      ["off-admin", "Admin Sinar", adminSinar], ["off-amil", "Amil Sinar", amilSinar], ["off-ahmad", "Ahmad", null], ["off-siti", "Siti", null],
    ] as const) {
      await store.createOfficerProfile({
        id, institutionId: SINAR, displayName, ...(account ? { account: account.address, role: id === "off-admin" ? "ADMIN" as const : "OFFICER" as const } : {}),
        actor: adminSinar.address, now: NOW,
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

  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("pastes, records, corrects, voids, reimburses and attaches nota photos", async () => {
    // A proposal published on the institution's internal decision.
    const admin = await signIn(adminSinar);
    const amil = await signIn(amilSinar);
    const programId = (await (await post("/programs", {
      name: "Jumat Berkah", purpose: "Santunan", fundType: "INFAK", scope: "Tangerang Selatan", referenceCeiling: "10000000",
    }, admin)).json()).program.id;
    const draft = (await (await post("/proposals", {
      expectedVersion: 0, operationId: crypto.randomUUID(), programId, originOfRequest: "Data RT", purpose: "Santunan Jumat",
      personInCharge: "Bendahara", aidPeriod: { start: "2026-09-01", end: "2026-09-30" },
      beneficiaries: [{ id: "ben-1", name: "Mustahik 1", asnaf: "Fakir", addressOrScope: "RT 03",
        identityBasis: { kind: "NIK", value: "3674010101010001" }, guardian: null, paymentRecipient: null }],
      aidLines: [{ id: "aid-1", beneficiaryId: "ben-1", aidType: "Uang tunai", period: "2026-09", value: { kind: "MONEY", amountRequestedIdr: "1000000" } }],
    }, amil)).json()).draft;
    await post(`/proposals/${draft.id}/documents`, {
      category: "RECIPIENT_VERIFICATION", fileName: "ba.txt", mimeType: "text/plain", beneficiaryId: null,
      contentBase64: Buffer.from("Berita acara").toString("base64"),
    }, amil);
    const published = await post(`/proposals/${draft.id}/publish`, {
      operationId: crypto.randomUUID(), expectedVersion: draft.version, decisionReference: "Rapat pengurus", decisionDate: "2026-09-27",
    }, amil);
    expect(published.status).toBe(200);

    // A biaya the retired modal recorded, carried over on the next start (#128).
    await database.handle().execute(sql`
      INSERT INTO disbursement_realization_expenses (
        id, institution_id, proposal_id, advance_id, amount_idr, purpose, payee, document_ref, recorded_by_officer_id, recorded_at
      ) VALUES ('exp-lama', ${SINAR}, ${draft.id}, NULL, '15000', 'Fotokopi daftar penerima', 'Fotocopy Jaya', 'KW-LAMA-9', 'off-amil', ${NOW - 86400})
    `);
    await createDisbursementStore(database.handle()).ensureSchema();

    const built = await Bun.build({
      entrypoints: [new URL("../../frontend/test/officer-smoke.tsx", import.meta.url).pathname],
      target: "browser",
      define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "" }) },
    });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const bundle = await built.outputs[0]!.text();
    const css = process.env.OPERATIONAL_COST_CSS_URL ? await (await fetch(process.env.OPERATIONAL_COST_CSS_URL)).text() : "";
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

    const shots = process.env.OPERATIONAL_COST_SCREENSHOTS;
    const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      const shot = async (name: string) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: false }); };
      page.setDefaultTimeout(10000);
      await page.goto(server.url.toString());
      await page.getByRole("button", { name: /^0x/ }).waitFor();
      await page.getByLabel("Pengelola Zakat", { exact: true }).selectOption(SINAR);
      await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();
      await page.getByRole("heading", { name: "LPZ Sinar Amanah (sintetis)" }).first().waitFor();
      await page.getByRole("button", { name: /Penyaluran/ }).first().click();
      await page.getByLabel("Program bantuan").selectOption({ label: "Jumat Berkah" });
      await page.getByRole("button", { name: /Santunan Jumat/ }).click();

      // The banner's button brings the tab forward.
      await page.getByRole("button", { name: "Biaya operasional", exact: true }).click();
      await page.getByRole("tab", { name: "Biaya operasional", selected: true }).waitFor();

      // Lembar Panjar: Siti carries Rp300.000 into the field.
      await page.getByRole("tab", { name: /^Panjar/ }).click();
      const panjarForm = page.getByRole("form", { name: "Keluarkan panjar" });
      await panjarForm.getByLabel("Petugas pemegang").selectOption({ label: "Siti" });
      await panjarForm.getByLabel("Nominal (Rp)").fill("300000");
      await panjarForm.getByLabel("Keperluan").fill("Jumat Berkah");
      await panjarForm.getByLabel("No. bukti kas keluar").fill("BKK-001");
      await panjarForm.getByRole("button", { name: "Keluarkan panjar", exact: true }).click();
      await page.getByText("Siti · panjar Rp 300.000 (BKK-001) · terpakai Rp 0 · sisa Rp 300.000").waitFor();

      // Lembar Biaya: paste four rows from Excel into the draft row.
      await page.getByRole("tab", { name: /^Biaya \(/ }).click();
      const grid = page.getByRole("grid", { name: "Biaya operasional" });
      // The carried-over row is locked above the draft row; paste into the draft.
      await grid.getByRole("gridcell").and(page.locator(':not([aria-readonly="true"])')).first().click();
      await page.evaluate((tsv: string) => {
        const data = new DataTransfer();
        data.setData("text/plain", tsv);
        window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data }));
      }, [
        "28/09/2026\tSewa mobil pick-up\t1\thari\t300.000\t\tRental Pak Udin\tKW-012\tTalangan Ahmad",
        "28/09/2026\tBensin\t10\tliter\t10.000\t\tSPBU 34.153\tSTR-0457\ttalangan ahmad",
        "28/09/2026\tKantong plastik\t\t\t\t250.000\tToko Jaya\t\tPanjar Siti · BKK-001",
        "28/09/2026\tTali rafia\t\t\t\t100.000\tToko Jaya\t\tPanjar Siti · BKK-001",
      ].join("\n"));
      await grid.getByRole("gridcell", { name: "100000" }).first().waitFor();
      await shot("01-drafts-pasted");

      // The fourth row overdraws the panjar: only the server knows, and it stays a flagged draft.
      await page.getByRole("button", { name: "Catat 4 baris" }).first().click();
      await page.getByText("Ahmad · talangan Rp 400.000 belum diganti").waitFor();
      await page.getByText(/terpakai Rp 250\.000 · sisa Rp 50\.000/).waitFor();
      expect(await grid.locator('td[aria-readonly="true"]', { hasText: "Tali rafia" }).count()).toBe(0);
      expect(await grid.locator("th[title*='melebihi sisa panjar']").count()).toBe(1);
      // Row 5 of the grid: the carried-over row and the three just recorded sit above it.
      await page.getByText(/^Baris 5: Sumber dana: Biaya melebihi sisa panjar BKK-001/).waitFor();
      expect(await grid.locator('td[aria-readonly="true"]', { hasText: "Bensin" }).count()).toBe(1);
      await shot("02-recorded-locked");

      // Koreksi: the old values open, a reason is required, the row is marked and keeps its history.
      await grid.getByRole("gridcell", { name: "Bensin" }).click();
      await page.getByRole("button", { name: "Koreksi", exact: true }).first().click();
      const correction = page.getByRole("dialog", { name: "Koreksi baris biaya" });
      await correction.getByLabel("Harga (Rp)").fill("11000");
      await correction.getByLabel("Harga (Rp)").blur();
      expect(await correction.getByLabel("Total (Rp)").inputValue()).toBe("110000");
      await correction.getByLabel(/Alasan koreksi/).fill("Struk tertulis Rp11.000 per liter");
      await shot("03-correction");
      await correction.getByRole("button", { name: "Simpan koreksi" }).click();
      await correction.waitFor({ state: "detached" });
      await grid.getByText("dikoreksi").waitFor();
      await grid.getByRole("gridcell", { name: "Bensin" }).click();
      await page.getByRole("button", { name: "Riwayat", exact: true }).first().click();
      const history = page.getByRole("dialog", { name: "Riwayat baris biaya" });
      await history.getByText(/Versi 2 · Dikoreksi/).waitFor();
      await history.getByText("Alasan: Struk tertulis Rp11.000 per liter").waitFor();
      await history.getByRole("button", { name: "Tutup" }).first().click();

      // Batalkan baris: struck through, no longer counted, the panjar is whole again.
      await grid.getByRole("gridcell", { name: "Kantong plastik" }).click();
      await page.getByRole("button", { name: "Batalkan baris", exact: true }).first().click();
      const voiding = page.getByRole("dialog", { name: "Batalkan baris biaya?" });
      await voiding.getByLabel(/Alasan pembatalan/).fill("Input dobel, plastik sudah ada di nota lain");
      await voiding.getByRole("button", { name: "Batalkan baris" }).click();
      await voiding.waitFor({ state: "detached" });
      await page.getByText(/terpakai Rp 0 · sisa Rp 300\.000/).waitFor();
      expect(await grid.locator("td.line-through", { hasText: "Kantong plastik" }).count()).toBe(1);

      // Tandai sudah diganti: Ahmad's talangan is paid back.
      await page.getByRole("button", { name: "Tandai sudah diganti" }).click();
      const reimburse = page.getByRole("dialog", { name: /Tandai talangan Ahmad/ });
      await reimburse.getByText("Total diganti: Rp 410.000").waitFor();
      await reimburse.getByLabel("Rujukan pembayaran").fill("Transfer BSI 8812");
      await reimburse.getByRole("button", { name: "Tandai sudah diganti" }).click();
      await reimburse.waitFor({ state: "detached" });
      await page.getByText(/Ahmad · talangan lunas · Rp 410\.000 sudah diganti/).waitFor();

      // Lembar Nota: the two numbers typed in the grid became notas; photos are matched by file name.
      await page.getByRole("tab", { name: /^Nota/ }).click();
      await page.getByRole("cell", { name: "KW-012", exact: true }).waitFor();
      await page.getByRole("row", { name: /KW-LAMA-9.*data lama tanpa lampiran/ }).waitFor();
      await page.locator('input[type="file"][multiple]').first().setInputFiles([
        { name: "KW-012.jpg", mimeType: "image/jpeg", buffer: Buffer.from(JPG) },
        { name: "STR-0457 belakang.png", mimeType: "image/png", buffer: PNG },
        { name: "IMG_2041.jpg", mimeType: "image/jpeg", buffer: Buffer.from(JPG) },
      ]);
      await page.getByText("→ nota STR-0457").waitFor();
      await page.getByText("tidak cocok dengan nomor nota mana pun").waitFor();
      await shot("04-bulk-upload");
      await page.getByRole("button", { name: "Unggah 2 berkas" }).click();
      await page.getByRole("button", { name: "1 berkas" }).first().waitFor();

      // The nota column opens the attachment; it is evidence now, so its file cannot be deleted.
      await page.getByRole("tab", { name: /^Biaya \(/ }).click();
      await grid.getByRole("gridcell", { name: /STR-0457 📎1/ }).dblclick();
      const files = page.getByRole("dialog", { name: /STR-0457/ });
      await files.getByText(/sudah menjadi bukti baris biaya tercatat/).waitFor();
      expect(await files.getByRole("button", { name: /Hapus/ }).count()).toBe(0);
      await files.getByRole("button", { name: /Lihat/ }).click();
      await files.getByRole("img", { name: "Foto STR-0457 belakang.png" }).waitFor();
      await shot("05-nota-files");
      await files.getByRole("button", { name: "Tutup" }).last().click();

      // Fullscreen keeps unrecorded drafts.
      await page.getByRole("button", { name: "Perluas" }).click();
      await page.getByRole("grid", { name: "Biaya operasional" }).getByRole("gridcell", { name: "Tali rafia" }).waitFor();
      await shot("06-fullscreen");
      await page.getByRole("button", { name: "Perkecil" }).click();

      // On a phone the sheet is cards.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByText("Sewa mobil pick-up · Rp 300.000").waitFor();
      await page.getByRole("group", { name: "Baris draf" }).first().waitFor();
      await page.getByText("Sewa mobil pick-up · Rp 300.000").scrollIntoViewIfNeeded();
      await shot("07-mobile");

      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      server.stop(true);
    }
  }, 120_000);
});

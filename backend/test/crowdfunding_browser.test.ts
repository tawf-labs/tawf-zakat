/** Real crowdfunding UI -> HTTP API -> transactional PGlite. Only gateway is a fixture.
 * Opt in: NODE_ENV=test CROWDFUNDING_BROWSER=1 bun test test/crowdfunding_browser.test.ts
 * Starts/stops its own loopback API and Vite; never uses environment database/RPC keys.
 */
import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createServer } from "node:net";
import { createCrowdfundingStore } from "../src/crowdfunding-store";
import { createCrowdfundingRoutes } from "../src/routes/crowdfunding";
import type { CampaignRuntime } from "../src/crowdfunding";
import { CampaignGatewayError } from "../src/crowdfunding-midtrans";

async function freePort(): Promise<number> {
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
  const address = socket.address();
  if (!address || typeof address === "string") throw new Error("No loopback port");
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return address.port;
}

test.skipIf(process.env.CROWDFUNDING_BROWSER !== "1")("real browser submits, revises, approves, publishes and pays through isolated API", async () => {
  if (process.env.NODE_ENV !== "test") throw new Error("Browser integration requires NODE_ENV=test");
  const db = new PGlite();
  await db.exec(await Bun.file(new URL("../migrations/crowdfunding.sql", import.meta.url)).text());
  const store = createCrowdfundingStore(db);
  const password = "synthetic-browser-passphrase";
  await store.transaction(async state => {
    state.users.operator = { id: "operator", name: "Operator Fixture", email: "operator@example.test", kind: "INDIVIDUAL", role: "OPERATOR", passwordHash: await Bun.password.hash(password) };
  });
  let settled = false;
  let checkoutCreated = false;
  const checkoutAttempts: string[] = [];
  const runtime: CampaignRuntime = { store, documentKey: Buffer.alloc(32, 17), chain: null, gateway: {
    async create(id) {
      checkoutAttempts.push(id);
      if (checkoutAttempts.length === 1) throw new CampaignGatewayError("UNAVAILABLE");
      checkoutCreated = true;
      return { token: `fixture-${id}`, redirectUrl: "https://app.sandbox.midtrans.com/snap/v4/redirection/fixture-only" };
    },
    async status(id) {
      if (!checkoutCreated) throw new CampaignGatewayError("NOT_FOUND");
      return { order_id: id, currency: "IDR", gross_amount: "50000.00", transaction_status: settled ? "settlement" : "pending", fraud_status: "accept" };
    },
    verify() { return false; },
  } };
  const app = new Hono();
  app.use("*", cors());
  app.get("/health", c => c.json({ deploymentPending: false }));
  app.route("/api/crowdfunding", createCrowdfundingRoutes(runtime));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const vite = Bun.spawn(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: new URL("../../frontend/", import.meta.url).pathname,
    env: { ...process.env, NODE_ENV: "development", PORT: String(port), VITE_API_BASE_URL: `http://127.0.0.1:${server.port}` },
    stdout: "pipe", stderr: "pipe",
  });
  const stdout = new Response(vite.stdout).text();
  const stderr = new Response(vite.stderr).text();
  let browser: any;
  try {
    let ready = false;
    for (let i = 0; i < 180; i++) {
      try { ready = (await fetch(base, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Vite startup */ }
      if (ready) break;
      if (vite.exitCode !== null) throw new Error(`Vite exited: ${await stderr}`);
      await Bun.sleep(500);
    }
    if (!ready) {
      vite.kill(); await vite.exited;
      throw new Error(`Owned Vite did not start: ${(await stdout).slice(-4000)} ${(await stderr).slice(-4000)}`);
    }
    const { chromium } = await import(process.env.CROWDFUNDING_BROWSER_MODULE || new URL("../../frontend/node_modules/playwright/index.mjs", import.meta.url).href);
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium" });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    // No external services/fonts/checkout are needed; do not contact live dependencies.
    await context.route("**/*", (route: any) => {
      const url = new URL(route.request().url());
      // Stand-in for Midtrans Snap.js: records what the page asks the popup to pay.
      if (url.hostname === "app.sandbox.midtrans.com" && url.pathname === "/snap/snap.js") return route.fulfill({ contentType: "text/javascript", body: "window.__snapPay = window.__snapPay || []; window.snap = { pay: (token, callbacks) => window.__snapPay.push({ token, callbacks: Object.keys(callbacks) }) };" });
      return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    page.setDefaultTimeout(15000);
    const visible = (text: string) => page.getByText(text, { exact: false }).first().waitFor({ state: "visible" });
    const login = async (email: string) => {
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Kata sandi").fill(password);
      await page.getByRole("button", { name: "Masuk", exact: true }).click();
    };
    const logout = () => page.getByRole("button", { name: "Keluar", exact: true }).click();
    const title = "Fixture integrasi: ruang belajar";
    await page.goto(`${base}/galang-dana`);
    await page.getByRole("button", { name: "Belum punya akun? Daftar" }).click();
    await page.getByLabel("Nama lengkap").fill("Penggalang Fixture");
    await page.getByLabel("Jenis penggalang").selectOption("ORGANIZATION");
    await page.getByLabel("Nama organisasi").fill("Organisasi Fixture");
    await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
    await page.getByLabel("Kata sandi").fill(password);
    await page.getByRole("button", { name: "Daftar sebagai penggalang" }).click();
    await page.getByRole("button", { name: "+ Buat kampanye" }).click();
    for (const [label, value] of [
      ["Judul kampanye", title], ["Ringkasan publik", "Kampanye sintetis untuk pengujian."],
      ["Cerita lengkap (publik)", "Cerita sintetis kebutuhan ruang belajar."],
      ["Nama penerima manfaat (privat)", "RAHASIA-PENERIMA"], ["Hubungan dengan penerima manfaat", "Pendamping"],
      ["Rincian rencana anggaran", "Pengadaan buku satu juta rupiah."], ["Rencana distribusi dan pelaporan", "Mitra membagikan buku dan melaporkan bukti."],
      ["Target dana (Rp)", "1000000"], ["Tanggal akhir", "2099-12-31"],
    ]) await page.getByLabel(label!, { exact: true }).fill(value!);
    await page.getByLabel("Saya memiliki persetujuan").check();
    await page.getByRole("button", { name: "Simpan draf proposal" }).click();
    await visible("Dokumen pendukung privat");
    await page.getByLabel("Unggah dokumen").setInputFiles({ name: "bukti.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nfixture-private-evidence") });
    await visible("Unduh bukti.pdf");
    await page.getByRole("button", { name: "Ajukan untuk review" }).click();
    await visible("Proposal yang diajukan");
    expect(await store.transaction(s => Object.values(s.campaigns)[0].status)).toBe("SUBMITTED");
    const campaignId = await store.transaction(s => Object.values(s.campaigns)[0].id as string);
    expect((await app.request(`/api/crowdfunding/campaigns/${campaignId}`)).status).toBe(404);
    await logout(); await login("operator@example.test");
    await page.getByRole("button", { name: new RegExp(title) }).click();
    await page.getByLabel("Catatan keputusan").fill("Mohon rinci jumlah buku.");
    const revisionResponse = page.waitForResponse((r: any) => r.request().method() === "POST" && r.url().endsWith(`${campaignId}/review`));
    await page.getByRole("button", { name: "Minta revisi" }).click();
    expect((await revisionResponse).status()).toBe(200);
    expect(await store.transaction(s => s.campaigns[campaignId].status)).toBe("REVISION_REQUESTED");
    await visible("Mohon rinci jumlah buku.");
    await logout(); await login("owner@example.test");
    await page.getByRole("button", { name: new RegExp(title) }).click();
    await page.getByLabel("Rincian rencana anggaran", { exact: true }).fill("100 buku @ Rp10.000 = Rp1.000.000.");
    const edited = page.waitForResponse((r: any) => r.request().method() === "PATCH" && r.url().endsWith(campaignId));
    await page.getByRole("button", { name: "Simpan draf proposal" }).click();
    expect((await edited).status()).toBe(200);
    await page.getByRole("button", { name: "Ajukan untuk review" }).click();
    await visible("Proposal yang diajukan");
    await logout(); await login("operator@example.test");
    await page.getByRole("button", { name: new RegExp(title) }).click();
    for (const label of ["Identitas penggalang diperiksa", "Persetujuan penerima manfaat diperiksa", "Kebutuhan dan bukti pendukung diperiksa", "Rencana anggaran diperiksa", "Rencana distribusi diperiksa"]) await page.getByLabel(label, { exact: true }).check();
    await page.getByLabel("Referensi pemeriksaan kepatuhan").fill("FIXTURE-NOT-A-LEGAL-PERMIT");
    await page.getByLabel("Catatan keputusan").fill("Dokumen sintetis sudah ditelaah.");
    await page.getByRole("button", { name: "Setujui proposal" }).click();
    await visible("Siap dipublikasikan");
    await page.getByRole("button", { name: "Terbitkan kampanye" }).click();
    await visible("Buka halaman publik");
    await logout();
    await page.goto(`${base}/kampanye/${campaignId}`);
    await visible("Cerita di balik harapan");
    expect(await page.getByText("RAHASIA-PENERIMA").count()).toBe(0);
    await page.getByLabel("Tampilkan sebagai anonim").check();
    await page.getByLabel("Doa atau dukungan").fill("Semoga ruang belajarnya segera terwujud.");
    await visible("Belum ada donasi yang terkonfirmasi");
    await page.getByRole("button", { name: "Lanjut ke pembayaran" }).click();
    await visible("GATEWAY_ERROR");
    const paymentId = await store.transaction(s => Object.values(s.payments)[0].id as string);
    await page.reload(); await visible("GATEWAY_ERROR");
    await page.getByRole("button", { name: "Coba lagi checkout yang sama" }).click();
    await visible("PENDING");
    expect(checkoutAttempts).toEqual([paymentId, paymentId]);
    // The recovered checkout opens the Snap popup for the same payment, as the zakat flow does.
    await page.waitForFunction(() => (window as any).__snapPay?.length === 1);
    expect(await page.evaluate(() => (window as any).__snapPay[0])).toEqual({ token: `fixture-${paymentId}`, callbacks: ["onSuccess", "onPending", "onError", "onClose"] });
    await page.getByRole("button", { name: "Bayar Sekarang" }).click();
    await page.waitForFunction(() => (window as any).__snapPay?.length === 2);
    expect(await store.transaction(s => Object.keys(s.payments).length)).toBe(1);
    expect(await store.transaction(s => s.campaigns[campaignId].collectedAmount)).toBe(0);
    settled = true;
    await page.getByRole("button", { name: "Periksa status pembayaran" }).click();
    await visible("PAID");
    expect(await store.transaction(s => s.campaigns[campaignId].collectedAmount)).toBe(50000);
    // The donor wall lists the confirmed donation: unnamed because anonymous, amount and prayer shown.
    const wall = page.locator("#donatur-doa");
    await wall.getByText("Semoga ruang belajarnya segera terwujud.").waitFor();
    expect((await wall.innerText()).replace(/\s/g, "")).toContain("HambaAllah");
    expect((await wall.innerText()).replace(/\s/g, "")).toContain("Rp50.000");
    if (process.env.CROWDFUNDING_SCREENSHOT_DIR) await wall.screenshot({ path: `${process.env.CROWDFUNDING_SCREENSHOT_DIR}/donor-wall.png` });
    await page.reload(); await visible("PAID");
    await page.getByRole("button", { name: "Periksa status pembayaran" }).click();
    await visible("PAID");
    expect(await store.transaction(s => s.campaigns[campaignId].donationCount)).toBe(1);
    const publicCampaign = await (await app.request(`/api/crowdfunding/campaigns/${campaignId}`)).json() as any;
    expect(publicCampaign.campaign.version).toBe(2);
    expect(publicCampaign.campaign.chainStatus).toBe("UNCONFIGURED");
    expect(publicCampaign.campaign.beneficiaryName).toBeUndefined();
    expect(publicCampaign.campaign.documents).toBeUndefined();
    expect(await store.transaction(s => Object.values(s.outbox).length)).toBe(3);
    // The donor verifies the donation from the receipt code. Chain evidence shows only once recorded.
    const shot = async (name: string) => { if (process.env.CROWDFUNDING_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.CROWDFUNDING_SCREENSHOT_DIR}/${name}.png`, fullPage: true }); };
    await visible(paymentId);
    await page.getByRole("link", { name: "Verifikasi donasi ini" }).click();
    await page.getByRole("heading", { name: "Bukti Donasi Kampanye" }).waitFor();
    await visible("Donasi Terkonfirmasi");
    const proof = page.locator("main");
    expect((await proof.innerText()).replace(/\s/g, "")).toContain("Rp50.000");
    expect(await proof.getByRole("link", { name: title }).getAttribute("href")).toBe(`/kampanye/${campaignId}`);
    expect(await page.getByText("blockchain", { exact: false }).count()).toBe(0);
    expect(await page.getByText("Semoga ruang belajarnya").count()).toBe(0);
    const { drainCampaignOutbox } = await import("../src/crowdfunding");
    runtime.chain = { async record() { return { transactionHash: `0x${"ab".repeat(32)}` }; } };
    await drainCampaignOutbox(runtime, true);
    await page.getByRole("button", { name: "Cek Status" }).click();
    await visible("Tercatat di blockchain");
    await visible(`0x${"ab".repeat(32)}`);
    await shot("verify-donation");
    runtime.chain = null;
    await page.getByLabel("Referensi kontribusi").fill("CF-00000000-0000-4000-8000-000000000000");
    await page.getByRole("button", { name: "Cek Status" }).click();
    await visible("Kontribusi Tidak Ditemukan");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${base}/kampanye`); await visible(title);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    vite.kill(); await vite.exited;
    await Promise.all([stdout, stderr]);
    server.stop(true);
    await db.close();
  }
}, 180000);

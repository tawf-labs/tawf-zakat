/** Kabar (published directly) & laporan realisasi (examined first) through the real UI -> HTTP API -> transactional PGlite.
 * Opt in: NODE_ENV=test CROWDFUNDING_BROWSER=1 bun test test/crowdfunding_updates_browser.test.ts
 * Starts/stops its own loopback API and Vite; never uses environment database/RPC keys.
 * Set CROWDFUNDING_SCREENSHOT_DIR to keep screenshots of the public section.
 */
import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createServer } from "node:net";
import { createCrowdfundingStore } from "../src/crowdfunding-store";
import { createCrowdfundingRoutes } from "../src/routes/crowdfunding";
import type { CampaignRuntime } from "../src/crowdfunding";

async function freePort(): Promise<number> {
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
  const address = socket.address();
  if (!address || typeof address === "string") throw new Error("No loopback port");
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return address.port;
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test.skipIf(process.env.CROWDFUNDING_BROWSER !== "1")("real browser publishes news directly and a realization report after operator examination", async () => {
  if (process.env.NODE_ENV !== "test") throw new Error("Browser integration requires NODE_ENV=test");
  const db = new PGlite();
  await db.exec(await Bun.file(new URL("../migrations/crowdfunding.sql", import.meta.url)).text());
  const store = createCrowdfundingStore(db);
  const password = "synthetic-browser-passphrase";
  await store.transaction(async state => {
    state.users.operator = { id: "operator", name: "Operator Fixture", email: "operator@example.test", kind: "INDIVIDUAL", role: "OPERATOR", passwordHash: await Bun.password.hash(password) };
  });
  const runtime: CampaignRuntime = { store, documentKey: Buffer.alloc(32, 17), chain: null, gateway: {
    async create(id) { return { token: `fixture-${id}`, redirectUrl: "https://app.sandbox.midtrans.com/snap/v4/redirection/fixture-only" }; },
    async status(id) { return { order_id: id, currency: "IDR", gross_amount: "50000.00", transaction_status: "settlement", fraud_status: "accept" }; },
    verify() { return false; },
  } };
  const routes = createCrowdfundingRoutes(runtime);
  const call = async (path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) => {
    const response = await routes.request(path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json() as any;
    if (!response.ok) throw new Error(`${method} ${path}: ${data.error}`);
    return data;
  };
  // Proposal, review and payment are covered by crowdfunding_browser.test.ts; seed them through the API.
  const title = "Fixture laporan: ruang belajar";
  const owner = await call("/auth/register", "POST", { name: "Penggalang Fixture", email: "owner@example.test", password, kind: "INDIVIDUAL" });
  const operatorSession = await call("/auth/login", "POST", { email: "operator@example.test", password });
  const asOwner = { Authorization: `Bearer ${owner.token}` }; const asOperator = { Authorization: `Bearer ${operatorSession.token}` };
  const campaignId = (await call("/campaigns", "POST", { title, summary: "Kampanye sintetis untuk pengujian.", story: "Cerita sintetis.", category: "EDUCATION", targetAmount: 1000000, endsAt: "2099-12-31T00:00:00.000Z", beneficiaryName: "RAHASIA-PENERIMA", relationship: "Pendamping", budgetPlan: "Buku.", distributionPlan: "Mitra membagikan buku.", consent: true }, asOwner)).campaign.id as string;
  await call(`/campaigns/${campaignId}/submit`, "POST", undefined, asOwner);
  await call(`/campaigns/${campaignId}/review`, "POST", { expectedVersion: 1, decision: "APPROVE", notes: "Ditelaah.", checks: { identity: true, consent: true, needs: true, budget: true, distribution: true }, complianceReference: "FIXTURE-NOT-A-LEGAL-PERMIT" }, asOperator);
  await call(`/campaigns/${campaignId}/publish`, "POST", { expectedVersion: 1 }, asOperator);
  // A second proposal already waits for review, so the operator worklist has somewhere to move on to.
  const waitingTitle = "Fixture antrean: dapur umum";
  const waitingId = (await call("/campaigns", "POST", { title: waitingTitle, summary: "Kampanye sintetis kedua.", story: "Cerita sintetis.", category: "HUMANITARIAN", targetAmount: 2000000, endsAt: "2099-12-31T00:00:00.000Z", beneficiaryName: "RAHASIA-PENERIMA", relationship: "Pendamping", budgetPlan: "Bahan makanan.", distributionPlan: "Relawan membagikan makanan.", consent: true }, asOwner)).campaign.id as string;
  await call(`/campaigns/${waitingId}/submit`, "POST", undefined, asOwner);
  const payment = (await call(`/campaigns/${campaignId}/donations`, "POST", { amount: 50000, donorName: "Donatur", isAnonymous: true })).payment;
  expect((await call(`/payments/${payment.id}`, "GET", undefined, { "X-Payment-Token": payment.accessToken })).payment.status).toBe("PAID");

  const app = new Hono();
  app.use("*", cors());
  app.get("/health", c => c.json({ deploymentPending: false }));
  app.route("/api/crowdfunding", routes);
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
    for (let i = 0; i < 180 && !ready; i++) {
      try { ready = (await fetch(base, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Vite startup */ }
      if (vite.exitCode !== null) throw new Error(`Vite exited: ${await stderr}`);
      if (!ready) await Bun.sleep(500);
    }
    if (!ready) throw new Error(`Owned Vite did not start: ${(await stdout).slice(-4000)}`);
    const { chromium } = await import(process.env.CROWDFUNDING_BROWSER_MODULE || new URL("../../frontend/node_modules/playwright/index.mjs", import.meta.url).href);
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium" });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await context.route("**/*", (route: any) => {
      const url = new URL(route.request().url());
      return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    // The first navigation also pays for Vite's cold dependency optimization.
    page.setDefaultTimeout(30000);
    const visible = (text: string) => page.getByText(text, { exact: false }).first().waitFor({ state: "visible" });
    const login = async (email: string) => {
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Kata sandi").fill(password);
      await page.getByRole("button", { name: "Masuk", exact: true }).click();
      await page.getByRole("button", { name: new RegExp(title) }).click();
    };
    const logout = () => page.getByRole("button", { name: "Keluar", exact: true }).click();
    const shot = async (name: string) => { if (process.env.CROWDFUNDING_SCREENSHOT_DIR) await page.locator("#kabar-laporan, #section-updates").first().screenshot({ path: `${process.env.CROWDFUNDING_SCREENSHOT_DIR}/${name}.png` }); };
    const report = "Pembelian 30 buku pelajaran";

    await page.goto(`${base}/galang-dana`);
    await login("owner@example.test");
    // Kabar: the fundraiser publishes directly, no operator step.
    await page.getByRole("button", { name: "Tulis kabar atau laporan" }).click();
    await page.getByLabel("Judul", { exact: true }).fill("Kelas pertama dimulai");
    await page.getByLabel("Isi kabar untuk publik").fill("Kegiatan belajar sudah berjalan.");
    await page.getByRole("button", { name: "Simpan draf" }).click();
    await page.getByLabel("Unggah foto").setInputFiles({ name: "kelas.png", mimeType: "image/png", buffer: PNG });
    await visible("Akan tampil ke publik");
    await page.getByRole("button", { name: "Terbitkan kabar" }).click();
    await visible("Kabar terbit di halaman publik kampanye.");
    expect((await call(`/campaigns/${campaignId}`)).campaign.updates).toMatchObject([{ kind: "NEWS", status: "PUBLISHED", attachments: [{ name: "kelas.png" }] }]);

    // Laporan realisasi: examined by an operator before it becomes public.
    await page.getByRole("button", { name: "Tulis kabar atau laporan" }).click();
    await page.getByLabel(/^Jenis/).selectOption("REALIZATION");
    await page.getByLabel("Judul", { exact: true }).fill(report);
    await page.getByLabel("Nominal yang digunakan (Rp)").fill("30000");
    await page.getByLabel("Tanggal pelaksanaan").fill("2026-01-15");
    await page.getByLabel("Penggunaan dana dan hasil kegiatan").fill("Buku dibeli dan dibagikan kepada siswa.");
    await page.getByRole("button", { name: "Simpan draf" }).click();
    await visible("Draf tersimpan");
    await page.getByLabel("Unggah lampiran").setInputFiles({ name: "kuitansi.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nfixture-private-receipt") });
    await visible("Unduh kuitansi.pdf");
    await page.getByLabel("Sifat lampiran berikutnya").selectOption("PUBLIC");
    await page.getByLabel("Unggah lampiran").setInputFiles({ name: "kegiatan.png", mimeType: "image/png", buffer: PNG });
    await visible("Diusulkan publik");
    await page.getByRole("button", { name: "Ajukan untuk diperiksa" }).click();
    await visible("Menunggu pemeriksaan");
    await shot("owner-submitted");
    expect((await call(`/campaigns/${campaignId}`)).campaign.updates).toHaveLength(1);
    await logout();

    // Operator worklist: longest-waiting first, searchable, and it opens the report at its section.
    await page.getByLabel("Email", { exact: true }).fill("operator@example.test");
    await page.getByLabel("Kata sandi").fill(password);
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    const queue = page.locator(".cf-queue");
    await queue.getByRole("button", { name: "Perlu tindakan 2" }).waitFor();
    expect(await queue.locator(".cf-queue-item strong").allInnerTexts()).toEqual([waitingTitle, title]);
    await queue.getByRole("button", { name: "Semua kampanye 2" }).click();
    await queue.getByLabel("Cari judul atau penggalang").fill("dapur");
    expect(await queue.locator(".cf-queue-item strong").allInnerTexts()).toEqual([waitingTitle]);
    await queue.getByLabel("Cari judul atau penggalang").fill("");
    await queue.getByRole("button", { name: "Laporan 1" }).click();
    if (process.env.CROWDFUNDING_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.CROWDFUNDING_SCREENSHOT_DIR}/operator-queue.png` });
    await queue.getByRole("button", { name: new RegExp(report) }).click();
    await visible("Pemeriksaan operator");
    await page.waitForFunction(() => { const top = document.getElementById("section-updates")?.getBoundingClientRect().top ?? 9999; return top < window.innerHeight; });
    await page.getByLabel(/Tampilkan kegiatan\.png/).check();
    await page.getByLabel("Catatan pemeriksaan (privat)").fill("CATATAN-INTERNAL sesuai kuitansi.");
    await shot("operator-review");
    await page.getByRole("button", { name: "Terbitkan", exact: true }).click();
    // Nothing else is pending on this campaign, so the next waiting item opens by itself.
    await visible("Menampilkan item berikutnya dalam antrean.");
    await page.getByRole("heading", { name: waitingTitle }).waitFor();
    await page.getByLabel("Catatan keputusan").waitFor();
    await queue.getByRole("button", { name: "Laporan 0" }).waitFor();
    await logout();

    await page.goto(`${base}/kampanye/${campaignId}`);
    await visible(report);
    const section = page.locator("#kabar-laporan");
    expect((await section.innerText()).toLowerCase()).toContain("laporan realisasi");
    expect((await section.innerText()).replace(/\s/g, "")).toContain("Rp30.000");
    expect(await page.getByText("CATATAN-INTERNAL").count()).toBe(0);
    expect(await page.getByText("kuitansi.pdf").count()).toBe(0);
    await visible("Kelas pertama dimulai");
    expect(await section.innerText()).toContain("ditulis penggalang");
    await page.waitForFunction(() => { const images = [...document.querySelectorAll<HTMLImageElement>("#kabar-laporan img")]; return images.length === 2 && images.every(image => image.naturalWidth === 1); });
    await shot("public-desktop");
    await page.setViewportSize({ width: 375, height: 812 });
    await visible(report);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot("public-mobile");
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    vite.kill(); await vite.exited;
    await Promise.all([stdout, stderr]);
    server.stop(true);
    await db.close();
  }
}, 180000);

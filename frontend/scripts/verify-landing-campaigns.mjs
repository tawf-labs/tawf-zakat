// Isolated browser fixtures: no database writes, real payments, or chain calls.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.env.FRONTEND_URL || "http://127.0.0.1:3000";
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.setDefaultNavigationTimeout(30000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("requestfailed", request => { if (request.url().includes("good.svg")) console.log("Image request failure", request.failure()); });
let mode = "loading", release;
let requests = 0;
const campaign = {
  id: "landing-fixture", title: "Buku untuk Ruang Belajar", summary: "Kampanye fixture untuk pengujian, bukan penggalangan nyata.",
  story: "Cerita kampanye fixture.", category: "EDUCATION", targetAmount: 1000000, collectedAmount: 250000, donationCount: 2,
  endsAt: "2099-12-31T00:00:00Z", status: "PUBLISHED", version: 1,
  organizer: { name: "Penggalang Fixture", kind: "ORGANIZATION", organizationName: "Organisasi Fixture" },
  chainStatus: "UNCONFIGURED", coverImageUrl: "https://fixture.invalid/broken.jpg",
  beneficiaryName: "PRIVATE_SENTINEL", documents: [{ id: "private-document" }],
};
await context.addInitScript(() => sessionStorage.setItem("zkt.crowdfunding.session", "private-test-session"));
await context.route("**/*", async route => {
  const url = new URL(route.request().url());
  const send = (json, status = 200) => route.fulfill({ status, json, headers: { "access-control-allow-origin": "*" } });
  if (url.pathname === "/api/crowdfunding/campaigns") {
    requests++;
    assert.equal(route.request().headers().authorization, undefined, "public landing must not send session token");
    if (mode === "loading") await new Promise(resolve => { release = resolve; });
    if (mode === "error") return send({ success: false, error: "Fixture error" }, 503);
    return send({ success: true, campaigns: mode === "empty" ? [] : [
      { ...campaign, id: "closed", status: "CLOSED" },
      { ...campaign, id: "expired", endsAt: "2000-01-01T00:00:00Z" },
      campaign,
      { ...campaign, id: "second", title: "Kampanye Kedua", coverImageUrl: "https://fixture.invalid/good.svg" },
      { ...campaign, id: "third", title: "Kampanye Ketiga", collectedAmount: 1500000 },
      { ...campaign, id: "fourth", title: "Kampanye Keempat" },
    ] });
  }
  if (url.pathname === "/api/crowdfunding/campaigns/landing-fixture") return send({ success: true, campaign });
  if (url.href === "https://fixture.invalid/good.svg") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#1b765e"/></svg>', headers: { "access-control-allow-origin": "*" } });
  if (url.pathname === "/health") return send({ deploymentPending: true });
  if (url.pathname.startsWith("/api/")) return send({ batches: [], proposals: [] });
  if (url.host !== new URL(base).host) return route.abort();
  return route.continue();
});
try {
  await page.goto(base);
  const section = page.locator("#kampanye-infak");
  await section.getByText("Memuat kampanye infak…", { exact: true }).waitFor();
  for (let attempt = 0; !release && attempt < 150; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(release, `Campaign request did not reach fixture; requests=${requests}; errors=${JSON.stringify(errors)}`);
  mode = "success";
  release();
  await section.getByRole("heading", { name: campaign.title, exact: true }).waitFor();
  assert.match(await page.locator("h1").innerText(), /Berbagi kebaikan/);
  assert.equal(await page.getByRole("link", { name: "Donasi Sekarang" }).getAttribute("href"), "/kampanye");
  assert.equal(await page.getByRole("link", { name: "Tunaikan Zakat", exact: true }).getAttribute("href"), "/donasi");
  assert.equal(await page.getByRole("link", { name: "Dukung pendidikan" }).getAttribute("href"), "/kampanye?kategori=EDUCATION");
  assert.doesNotMatch(await page.locator("main").innerText(), /DPS|Dewan Pengawas|Auditor|Ringkasan Kas/i);
  assert.equal(await page.getByText("Menunggu Deployment Baru").count(), 0);
  assert.equal(await section.locator("article").count(), 3);
  assert.equal(await section.getByText("Kampanye Keempat").count(), 0);
  assert.equal(await section.getByText("PRIVATE_SENTINEL").count(), 0);
  assert.doesNotMatch(await section.innerText(), /8 Asnaf|Verifikasi DPS|BAST/);
  assert.match(await section.innerText(), /Organisasi Fixture/);
  assert.match(await section.innerText(), /250.000/);
  assert.equal(await section.locator("progress").first().getAttribute("value"), "25");
  assert.equal(await section.locator("progress").last().getAttribute("value"), "100");
  await section.evaluate(el => el.scrollIntoView());
  await section.locator("article").first().getByText("Foto kampanye belum tersedia").waitFor();
  const loadedImage = section.getByRole("img", { name: "Kampanye Kedua", exact: true });
  await loadedImage.scrollIntoViewIfNeeded();
  await loadedImage.evaluate(img => img.complete ? Promise.resolve() : new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; }));
  assert.equal(await loadedImage.evaluate(img => img.naturalWidth > 0), true, "valid campaign image must load");
  assert.equal(await section.getByRole("link", { name: "Lihat Semua Kampanye" }).getAttribute("href"), "/kampanye");
  assert.equal(await section.getByRole("link", { name: "Galang Dana" }).getAttribute("href"), "/galang-dana");
  const detail = section.getByRole("link", { name: `Lihat Kampanye: ${campaign.title}`, exact: true });
  await detail.focus();
  assert.equal(await detail.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: campaign.title, exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/kampanye/landing-fixture");
  await page.goto(base);
  await section.getByRole("heading", { name: campaign.title, exact: true }).waitFor();
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await section.evaluate(el => el.scrollWidth <= el.clientWidth), true, `section overflow at ${width}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `page overflow at ${width}`);
  }
  mode = "empty";
  await page.reload();
  await section.getByText(/Belum ada kampanye infak aktif/).waitFor();
  mode = "error";
  await page.reload();
  await section.getByRole("alert").waitFor();
  mode = "success";
  await section.getByRole("button", { name: "Coba Lagi" }).click();
  await section.getByRole("heading", { name: campaign.title, exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "PASS", campaignRequests: requests, checks: ["hero copy and CTAs", "no DPS/auditor claims", "public gate bypass", "public-only request", "3 active cards", "private fields hidden", "real amounts", "accessible progress", "image fallback", "CTA links", "keyboard detail navigation", "375/768/1024/1440 no overflow", "loading", "empty", "error/retry", "no page errors"] }));
} finally { await browser.close(); }

// Local browser fixtures only: no real Midtrans requests, funds, or blockchain.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
});
const base = process.env.FRONTEND_URL || "http://127.0.0.1:3000";
const key = "zkt.crowdfunding.payment.race-campaign";
const campaign = {
  id: "race-campaign",
  title: "Fixture payment race",
  summary: "Pengujian lokal",
  story: "Cerita fixture",
  category: "EDUCATION",
  targetAmount: 1000000,
  collectedAmount: 0,
  donationCount: 0,
  endsAt: "2030-12-31T00:00:00Z",
  status: "PUBLISHED",
  version: 1,
  organizer: { name: "Fixture", kind: "INDIVIDUAL" },
  chainStatus: "UNCONFIGURED",
};
const payment = (id, status) => ({
  id,
  status,
  amount: 50000,
  accessToken: `secret-${id}`,
  redirectUrl: "https://app.sandbox.midtrans.com/snap/v4/redirection/fixture",
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function scenario(kind) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const started = deferred(),
    release = deferred();
  let creates = 0;
  if (kind === "late-status")
    await context.addInitScript(
      ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
      { key, value: payment("old-A", "PAID") },
    );
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.hostname.includes("midtrans") ||
      url.hostname.includes("walletconnect") ||
      url.hostname.includes("googleapis") ||
      url.hostname.includes("gstatic")
    )
      return route.abort();
    if (!url.pathname.startsWith("/api/crowdfunding")) return route.continue();
    if (request.method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "*",
        },
      });
    const send = (data, status = 200) =>
      route.fulfill({
        status,
        headers: { "access-control-allow-origin": "*" },
        json: { success: status < 400, ...data },
      });
    const path = url.pathname.slice("/api/crowdfunding".length);
    if (path === "/campaigns") return send({ campaigns: [campaign] });
    if (path === "/campaigns/race-campaign") return send({ campaign });
    if (path === "/payments/old-A") {
      started.resolve();
      await release.promise;
      return send({ payment: payment("old-A", "PAID") });
    }
    if (path.endsWith("/donors")) return send({ total: 0, donors: [] });
    if (path.endsWith("/donations")) {
      creates++;
      if (kind !== "late-status") {
        started.resolve();
        await release.promise;
      }
      return kind === "leave-502"
        ? send(
            {
              error: "Fixture timeout with recoverable order",
              payment: payment("new-B", "GATEWAY_ERROR"),
            },
            502,
          )
        : send({ payment: payment("new-B", "PENDING") });
    }
    if (path === "/payments/new-B")
      return send({
        payment: payment(
          "new-B",
          kind === "leave-502" ? "GATEWAY_ERROR" : "PENDING",
        ),
      });
    return send({ error: "Unexpected fixture endpoint" }, 404);
  });
  try {
    await page.goto(`${base}/kampanye/race-campaign`);
    await page.getByRole("heading", { name: campaign.title }).waitFor();
    if (kind === "late-status") {
      await page.getByText("PAID", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Periksa status pembayaran" })
        .click();
      await started.promise;
    }
    await page.getByLabel("Tampilkan sebagai anonim").check();
    await page
      .getByRole("button", { name: /Lanjut ke pembayaran/ })
      .click();
    if (kind === "late-status") {
      await page.getByText("PENDING", { exact: true }).waitFor();
      const response = page.waitForResponse((r) =>
        r.url().endsWith("/payments/old-A"),
      );
      release.resolve();
      await response;
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await page.getByText("PENDING", { exact: true }).waitFor();
      assert.equal(await page.getByText("PAID", { exact: true }).count(), 0);
    } else {
      await started.promise;
      await page.getByRole("link", { name: "← Semua kampanye" }).click();
      await page.getByRole("link", { name: /Fixture payment race/ }).click();
      await page.getByRole("heading", { name: campaign.title }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Menyiapkan pembayaran…" })
          .isDisabled(),
        true,
        "SPA remount must retain in-flight checkout ownership",
      );
      assert.equal(creates, 1);
      await page.getByRole("link", { name: "← Semua kampanye" }).click();
      const response = page.waitForResponse((r) =>
        r.url().endsWith("/donations"),
      );
      release.resolve();
      await response;
      await page.waitForFunction(
        (key) => JSON.parse(sessionStorage.getItem(key) || "{}").id === "new-B",
        key,
      );
      await page.getByRole("link", { name: /Fixture payment race/ }).click();
      await page
        .getByText(kind === "leave-502" ? "GATEWAY_ERROR" : "PENDING", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: /Lanjut ke pembayaran/ })
          .isDisabled(),
        true,
      );
    }
    const stored = await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)),
      key,
    );
    assert.equal(stored.id, "new-B");
    assert.equal(stored.accessToken, "secret-new-B");
    assert.equal(creates, 1);
    assert.deepEqual(errors, []);
    console.log(`PASS payment race fixture: ${kind}`);
  } finally {
    release.resolve();
    await context.close();
  }
}
try {
  await scenario("late-status");
  await scenario("leave-success");
  await scenario("leave-502");
} finally {
  await browser.close();
}

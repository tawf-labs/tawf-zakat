// Browser contract smoke test. ALL campaign/payment responses below are local fixtures.
// This does not call Midtrans or prove a real payment/chain transaction.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
});
const context = await browser.newContext({
  viewport: { width: 1366, height: 900 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const base = process.env.FRONTEND_URL || "http://127.0.0.1:3000";
let mode = "public",
  role = "FUNDRAISER",
  paid = false;
let campaign = {
  id: "fixture-campaign",
  title: "Fixture: buku untuk ruang belajar",
  summary: "Data pengujian lokal, bukan kampanye nyata.",
  story: "Cerita pengujian yang menjelaskan kebutuhan buku dan ruang belajar.",
  category: "EDUCATION",
  targetAmount: 10000000,
  collectedAmount: 250000,
  donationCount: 2,
  endsAt: "2030-12-31T00:00:00.000Z",
  status: "PUBLISHED",
  version: 1,
  organizer: { name: "Penggalang Fixture", kind: "INDIVIDUAL" },
  chainStatus: "UNCONFIGURED",
  beneficiaryName: "Penerima Privat Fixture",
  relationship: "Pendamping",
  budgetPlan: "Buku: Rp 10.000.000",
  distributionPlan: "Distribusi ke ruang belajar",
  consent: true,
  documents: [],
  reviewNotes: [],
  history: [],
};
const actions = [];
let checkoutRetries = 0;
let accountB = false;
let delayDetail = false;
let releaseDetail;
let detailStarted;
let detailStartedPromise = new Promise((resolve) => {
  detailStarted = resolve;
});
let publishedSnapshot;
let publicRace = false;
let releasePublic;
let publicStarted;
const publicStartedPromise = new Promise((resolve) => {
  publicStarted = resolve;
});
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (
    url.hostname === "app.sandbox.midtrans.com" ||
    url.hostname.includes("walletconnect") ||
    url.hostname.includes("googleapis") ||
    url.hostname.includes("gstatic")
  )
    return route.abort();
  if (url.pathname === "/health")
    return route.fulfill({ json: { deploymentPending: true } });
  if (!url.pathname.startsWith("/api/crowdfunding")) return route.continue();
  const path = url.pathname.slice("/api/crowdfunding".length),
    request = route.request(),
    method = request.method();
  if (method === "OPTIONS")
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
      json: { success: status < 400, ...data },
      headers: { "access-control-allow-origin": "*" },
    });
  const user = {
    id: "fixture-user",
    name: "Akun Fixture",
    email: "fixture@example.test",
    kind: "INDIVIDUAL",
    role,
  };
  if (path === "/campaigns" && method === "GET")
    return mode === "error"
      ? send({ error: "Layanan fixture tidak tersedia" }, 503)
      : send({
          campaigns:
            mode === "empty"
              ? []
              : publicRace
                ? [
                    campaign,
                    { ...campaign, id: "fixture-b", title: "Fixture public B" },
                  ]
                : [campaign],
        });
  if (path === "/auth/login" || path === "/auth/register") {
    actions.push({ path, body: request.postDataJSON() });
    accountB = request.postDataJSON().email === "account-b@example.test";
    return send({
      token: accountB ? "fixture-session-b" : "fixture-session",
      user: accountB
        ? { ...user, id: "account-b", name: "Akun B", role: "FUNDRAISER" }
        : user,
    });
  }
  if (path === "/auth/me") return send({ user });
  if (path === "/auth/logout") return send({});
  if (path === "/mine" || path === "/review")
    return send({ campaigns: accountB ? [] : [campaign] });
  if (path === "/review/queue")
    return send({
      campaigns: [
        {
          id: campaign.id,
          title: campaign.title,
          status: campaign.status,
          version: campaign.version,
          organizer: "Akun Fixture",
          updatedAt: "2030-01-01T00:00:00.000Z",
          tasks: ["SUBMITTED", "APPROVED"].includes(campaign.status)
            ? [
                {
                  type: campaign.status === "SUBMITTED" ? "PROPOSAL" : "PUBLISH",
                  since: "2030-01-01T00:00:00.000Z",
                },
              ]
            : [],
        },
      ],
    });
  if (path.endsWith("/donors")) return send({ total: 0, donors: [] });
  if (path === "/campaigns" && method === "POST") {
    const body = request.postDataJSON();
    assert.equal(body.coverImageUrl, undefined);
    assert.equal(body.consent, true);
    campaign = { ...campaign, ...body, status: "DRAFT", version: 0 };
    actions.push({ path, body });
    return send({ campaign });
  }
  if (path.endsWith("/donations")) {
    const body = request.postDataJSON();
    assert.equal(body.amount, 50000);
    actions.push({ path, body });
    return send(
      {
        error: "Fixture gateway timeout",
        payment: {
          id: "fixture-payment",
          status: "GATEWAY_ERROR",
          amount: body.amount,
          accessToken: "fixture-payment-secret",
        },
      },
      502,
    );
  }
  if (path === "/payments/fixture-payment/retry") {
    assert.equal(method, "POST");
    assert.equal(
      request.headers()["x-payment-token"],
      "fixture-payment-secret",
    );
    checkoutRetries++;
    actions.push({ path });
    if (checkoutRetries === 1)
      return send(
        {
          error: "Fixture checkout masih gagal",
          payment: {
            id: "fixture-payment",
            amount: 50000,
            status: "GATEWAY_ERROR",
          },
        },
        502,
      );
    return send({
      payment: {
        id: "fixture-payment",
        amount: 50000,
        status: "PENDING",
        redirectUrl:
          "https://app.sandbox.midtrans.com/snap/v4/redirection/fixture-only",
      },
    });
  }
  if (path === "/payments/fixture-payment") {
    assert.equal(
      request.headers()["x-payment-token"],
      "fixture-payment-secret",
    );
    return send({
      payment: {
        id: "fixture-payment",
        amount: 50000,
        status: paid
          ? "PAID"
          : checkoutRetries >= 2
            ? "PENDING"
            : "GATEWAY_ERROR",
      },
    });
  }
  if (path.endsWith("/documents")) {
    actions.push({ path, body: request.postDataJSON() });
    campaign.documents = [{ id: "fixture-document", name: "evidence.pdf" }];
    return send({ campaign });
  }
  if (path.endsWith("/submit")) {
    campaign = {
      ...campaign,
      status: "SUBMITTED",
      version: campaign.version + 1,
    };
    return send({ campaign });
  }
  if (path.endsWith("/review")) {
    const body = request.postDataJSON();
    assert.equal(body.expectedVersion, campaign.version);
    actions.push({ path, body });
    campaign = {
      ...campaign,
      status:
        body.decision === "REQUEST_REVISION"
          ? "REVISION_REQUESTED"
          : "APPROVED",
      reviewNotes: [body],
    };
    return send({ campaign });
  }
  if (path.endsWith("/publish")) {
    const body = request.postDataJSON();
    assert.equal(body.expectedVersion, campaign.version);
    actions.push({ path, body });
    campaign = { ...campaign, status: "PUBLISHED" };
    publishedSnapshot = structuredClone(campaign);
    return send({ campaign });
  }
  if (path.endsWith("/reopen")) {
    const body = request.postDataJSON();
    assert.equal(body.expectedVersion, campaign.version);
    assert.ok(body.reason.trim());
    actions.push({ path, body });
    campaign = { ...campaign, status: "REVISION_REQUESTED" };
    return send({ campaign });
  }
  if (path === "/campaigns/fixture-b")
    return send({
      campaign: {
        ...campaign,
        id: "fixture-b",
        title: "Fixture public B",
        story: "Cerita kampanye B",
        status: "PUBLISHED",
      },
    });
  if (path === "/campaigns/fixture-campaign") {
    if (publicRace && !request.headers().authorization) {
      publicStarted();
      await new Promise((resolve) => {
        releasePublic = resolve;
      });
      return send({
        campaign: {
          ...campaign,
          title: "LATE-PUBLIC-A",
          story: "LATE-STORY-A",
        },
      });
    }
    if (delayDetail && request.headers().authorization) {
      const snapshot = {
        ...campaign,
        title: "PRIVATE-ACCOUNT-A",
        beneficiaryName: "SECRET-ACCOUNT-A",
      };
      detailStarted();
      await new Promise((resolve) => {
        releaseDetail = resolve;
      });
      return send({ campaign: snapshot });
    }
    if (
      !request.headers().authorization &&
      publishedSnapshot &&
      campaign.status !== "PUBLISHED"
    )
      return send({
        campaign: { ...publishedSnapshot, status: campaign.status },
      });
    if (method === "PATCH")
      campaign = { ...campaign, ...request.postDataJSON() };
    return send({ campaign });
  }
  return send({ error: `Unmocked fixture endpoint ${path}` }, 404);
});
const visible = async (text) =>
  page.getByText(text, { exact: false }).first().waitFor({ state: "visible" });
try {
  await page.goto(`${base}/kampanye`);
  await visible(campaign.title);
  assert.equal(await page.getByText("Menunggu Deployment Baru").count(), 0);
  assert.equal(await page.getByText("Penerima Privat Fixture").count(), 0);
  await page.getByLabel("Cari kampanye atau penggalang").fill("tak ditemukan");
  await visible("Belum ada hasil yang sesuai");
  await page.getByLabel("Cari kampanye atau penggalang").fill("");
  await page.getByRole("link", { name: /Fixture: buku/ }).click();
  await visible("Cerita di balik harapan");
  assert.equal(await page.getByText("Penerima Privat Fixture").count(), 0);
  await page.getByLabel("Tampilkan sebagai anonim").check();
  await page
    .getByRole("button", { name: /Lanjut ke pembayaran/ })
    .click();
  await visible("GATEWAY_ERROR");
  await page.reload();
  await visible("GATEWAY_ERROR");
  await page
    .getByRole("button", { name: "Coba lagi checkout yang sama" })
    .click();
  await visible("Fixture checkout masih gagal");
  await page
    .getByRole("button", { name: "Coba lagi checkout yang sama" })
    .click();
  await visible("PENDING");
  assert.equal(
    actions.filter((action) => action.path.endsWith("/donations")).length,
    1,
  );
  assert.equal(checkoutRetries, 2);
  assert.equal(
    await page
      .getByRole("link", { name: /Buka (Pembayaran Midtrans|Midtrans Sandbox)/ })
      .getAttribute("rel"),
    "noopener noreferrer",
  );
  await page.reload();
  await visible("PENDING");
  paid = true;
  await page.getByRole("button", { name: "Periksa status pembayaran" }).click();
  await visible("PAID");
  await page.goto(`${base}/galang-dana`);
  await page.getByRole("button", { name: "Belum punya akun? Daftar" }).click();
  await page.getByLabel("Nama lengkap").fill("Akun Fixture");
  await page.getByLabel("Jenis penggalang").selectOption("ORGANIZATION");
  await page.getByLabel("Nama organisasi").fill("Organisasi Fixture");
  assert.equal(
    await page.getByRole("option", { name: /operator/i }).count(),
    0,
  );
  await page.getByLabel("Email", { exact: true }).fill("fixture@example.test");
  await page.getByLabel("Kata sandi").fill("fixture-passphrase");
  await page.getByRole("button", { name: "Daftar sebagai penggalang" }).click();
  await page.getByRole("button", { name: "+ Buat kampanye" }).click();
  for (const [label, limit] of [
    ["Nama penerima manfaat (privat)", 200],
    ["Hubungan dengan penerima manfaat", 500],
    ["Judul kampanye", 160],
    ["Ringkasan publik", 500],
    ["Cerita lengkap (publik)", 20000],
  ])
    assert.equal(
      await page.getByLabel(label, { exact: true }).getAttribute("maxlength"),
      String(limit),
    );
  for (const [label, value] of [
    ["Judul kampanye", "Fixture proposal baru"],
    ["Ringkasan publik", "Ringkasan proposal fixture."],
    ["Cerita lengkap (publik)", "Cerita lengkap proposal fixture untuk tes."],
    ["Nama penerima manfaat (privat)", "Penerima Privat Fixture"],
    ["Hubungan dengan penerima manfaat", "Pendamping"],
    ["Rincian rencana anggaran", "Anggaran buku sebesar satu juta rupiah."],
    [
      "Rencana distribusi dan pelaporan",
      "Distribusi melalui pendamping kelas.",
    ],
    ["Target dana (Rp)", "1000000"],
    ["Tanggal akhir", "2030-12-31"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel("Saya memiliki persetujuan").check();
  await page.getByRole("button", { name: "Simpan draf proposal" }).click();
  await visible("Dokumen pendukung privat");
  await page.getByLabel("Unggah dokumen").setInputFiles({
    name: "evidence.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nfixture"),
  });
  await visible("Unduh evidence.pdf");
  await page.getByRole("button", { name: "Ajukan untuk review" }).click();
  await visible("Proposal yang diajukan");
  await page.getByRole("button", { name: "Keluar", exact: true }).click();
  role = "OPERATOR";
  await page.getByLabel("Email", { exact: true }).fill("operator@example.test");
  await page.getByLabel("Kata sandi").fill("fixture-passphrase");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.getByRole("button", { name: /Fixture proposal baru/ }).click();
  await visible("Review privat operator");
  assert.equal(
    await page.getByRole("button", { name: "Setujui proposal" }).isDisabled(),
    true,
  );
  await page
    .getByLabel("Catatan keputusan")
    .fill("Mohon perbaiki rincian anggaran.");
  await page.getByRole("button", { name: "Minta revisi" }).click();
  await visible("Mohon perbaiki rincian anggaran.");
  await page.getByRole("button", { name: "Keluar", exact: true }).click();
  role = "FUNDRAISER";
  await page.getByLabel("Email", { exact: true }).fill("fixture@example.test");
  await page.getByLabel("Kata sandi").fill("fixture-passphrase");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.getByRole("button", { name: /Fixture proposal baru/ }).click();
  await page
    .getByLabel("Rincian rencana anggaran", { exact: true })
    .fill("Anggaran revisi fixture");
  await page.getByRole("button", { name: "Simpan draf proposal" }).click();
  await visible("Perbaiki proposal");
  await page.getByRole("button", { name: "Ajukan untuk review" }).click();
  await visible("Proposal yang diajukan");
  await page.getByRole("button", { name: "Keluar", exact: true }).click();
  role = "OPERATOR";
  await page.getByLabel("Email", { exact: true }).fill("operator@example.test");
  await page.getByLabel("Kata sandi").fill("fixture-passphrase");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.getByRole("button", { name: /Fixture proposal baru/ }).click();
  await visible("Review privat operator");
  for (const label of [
    "Identitas penggalang diperiksa",
    "Persetujuan penerima manfaat diperiksa",
    "Kebutuhan dan bukti pendukung diperiksa",
    "Rencana anggaran diperiksa",
    "Rencana distribusi diperiksa",
  ])
    await page.getByLabel(label, { exact: true }).check();
  await page
    .getByLabel("Referensi pemeriksaan kepatuhan")
    .fill("FIXTURE-REVIEW-ONLY");
  await page
    .getByLabel("Catatan keputusan")
    .fill("Pemeriksaan fixture lengkap.");
  await page.getByRole("button", { name: "Setujui proposal" }).click();
  await visible("Siap dipublikasikan");
  await page.getByRole("button", { name: "Terbitkan kampanye" }).click();
  await visible("Buka halaman publik");
  await page
    .getByLabel("Alasan revisi material")
    .fill("Perubahan kebutuhan penerima manfaat");
  await page.getByRole("button", { name: "Minta revisi material" }).click();
  await page.getByText("Perlu revisi · VERSI", { exact: false }).waitFor();
  await page.goto(`${base}/kampanye/fixture-campaign`);
  await visible("Kampanye ini tidak menerima donasi saat ini.");
  assert.equal(
    await page
      .getByRole("button", { name: /Lanjut ke pembayaran/ })
      .count(),
    0,
  );
  await page.goto(`${base}/kelola-kampanye`);
  await visible("Antrean & kampanye");
  delayDetail = true;
  // Nothing awaits the operator on a campaign sent back for revision; it lives in the archive tab.
  await page.getByRole("button", { name: /Semua kampanye/ }).click();
  await page.getByRole("button", { name: /Fixture proposal baru/ }).click();
  await detailStartedPromise;
  await page.getByRole("button", { name: "Keluar", exact: true }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill("account-b@example.test");
  await page.getByLabel("Kata sandi").fill("fixture-passphrase");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await visible("Akun B");
  const oldResponse = page.waitForResponse((response) =>
    response.url().endsWith("/campaigns/fixture-campaign"),
  );
  releaseDetail();
  await oldResponse;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.equal(
    await page.getByText("PRIVATE-ACCOUNT-A", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByText("SECRET-ACCOUNT-A", { exact: true }).count(),
    0,
  );
  await visible("Belum ada kampanye.");
  delayDetail = false;
  publicRace = true;
  await page.goto(`${base}/kampanye`);
  await page.getByRole("link", { name: /Fixture proposal baru/ }).click();
  await publicStartedPromise;
  await page.getByRole("link", { name: "← Semua kampanye" }).click();
  await page.getByRole("link", { name: /Fixture public B/ }).click();
  await visible("Cerita kampanye B");
  const stalePublicResponse = page.waitForResponse((response) =>
    response.url().endsWith("/campaigns/fixture-campaign"),
  );
  releasePublic();
  await stalePublicResponse;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.equal(await page.getByText("LATE-PUBLIC-A").count(), 0);
  await visible("Cerita kampanye B");
  await page.getByLabel("Tampilkan sebagai anonim").check();
  await page
    .getByRole("button", { name: /Lanjut ke pembayaran/ })
    .click();
  await visible("GATEWAY_ERROR");
  assert.equal(
    actions.filter((action) => action.path.endsWith("/donations")).at(-1).path,
    "/campaigns/fixture-b/donations",
  );
  publicRace = false;
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/kampanye`);
  await visible("Fixture proposal baru");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "mobile horizontal overflow",
  );
  await page.getByRole("button", { name: "Buka menu" }).click();
  await page
    .getByRole("navigation", { name: "Navigasi seluler" })
    .getByRole("link", { name: "Galang dana" })
    .waitFor();
  mode = "empty";
  await page.goto(`${base}/kampanye`);
  await visible("Cerita baik berikutnya sedang dipersiapkan");
  mode = "error";
  await page.reload();
  await visible("Layanan fixture tidak tersedia");
  assert.deepEqual(errors, [], "uncaught browser errors");
  console.log(
    `PASS: fixture browser smoke — public/search/privacy, same-ID checkout 502/retry/reload/server-paid, organization signup, field limits, proposal/upload/submit, owner revision, version-bound approval/publish/reopen, paused public snapshot, late account-A and public-campaign-A isolation, mobile 375px, empty/error. ${actions.length} fixture actions. No real gateway or blockchain was used.`,
  );
} catch (error) {
  console.error(
    "Fixture failure page:",
    await page.locator("main").innerText(),
  );
  throw error;
} finally {
  await browser.close();
}

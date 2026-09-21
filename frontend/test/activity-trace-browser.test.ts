import { expect, it } from "bun:test";
import type { ActivityTrackView, AmilTrace, DonorTrace } from "../../shared/activity-trace";

// Controlled HTTP responses exercise rendering/retry at the browser seam. Real SQL, proof and
// EVM behavior belongs to backend/test/activity_trace_journey.test.ts, not these failure fixtures.
it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("trace distinguishes refund and NFT lifecycle, links exact versions and preserves unreadable sources", async () => {
  const build = await Bun.build({
    entrypoints: [new URL("./activity-trace-smoke.tsx", import.meta.url).pathname],
    target: "browser", define: { "import.meta.env": "{}" },
  });
  if (!build.success) throw new Error(build.logs.join("\n"));
  const bundle = await build.outputs[0]!.text();
  const cssBuild = Bun.spawn(["bun", new URL("./build-smoke-css.ts", import.meta.url).pathname], { stdout: "pipe", stderr: "pipe" });
  const css = await new Response(cssBuild.stdout).text();
  if (await cssBuild.exited !== 0) throw new Error(await new Response(cssBuild.stderr).text());
  const now = Math.floor(Date.now() / 1000);
  const track: ActivityTrackView = {
    identity: { activityId: "activity-one", proposalId: "proposal-one", proposalVersion: 1, activityVersion: 1, name: "Bantuan pangan", currencyUnit: "IDR", observedAt: now },
    distribution: { status: "OK", data: { proposalStatus: "PARTIALLY_REALIZED", isRemainderClosed: false, recordedRealizations: 1, unitSummaries: [{ aidType: "Beras", unit: "kg", approved: "10", realized: "4", remaining: "6" }], committedAidIdr: "0", hasUnvaluedGoods: true } },
    funds: { status: "OK", data: { currencyUnit: "IDR", totalAllocatedAmount: "500000", totalRealizedMoneyIdr: "100000", totalExpensesIdr: "0", totalAdvancesIdr: "0", unaccountedAdvancesIdr: "0", totalCommittedAidIdr: "0", totalContributionShortfall: "0", totalOverCommitmentIdr: "0", availabilityStatus: "AVAILABLE", availabilityReason: "Dana tercatat dari alokasi kontribusi." } },
    confirmation: { status: "OK", data: { total: 1, confirmed: 0, disputed: 0, unconfirmed: 1 } },
    certificates: { status: "OK", data: { lines: [], pendingCount: 0 } },
    summary: { status: "OK", data: { headline: "IN_PROGRESS", openItems: ["CONFIRMATION_PENDING"] } },
  };
  const claimLimits = { pooled: "Dana kontribusi digabung; bukan alokasi ke penerima tertentu.", receipt: "Receipt bukan bukti fisik penerimaan.", certificate: "NFT bukan laporan periode dua pengesahan.", report: "Snapshot historis tidak menggantikan status terkini." };
  const trace: DonorTrace = {
    contribution: { id: "contribution-one", version: 1, status: "ENDORSED", receivedAt: now, corrections: [], proof: { status: "PENDING" }, proofMatchesContributionVersion: null },
    activities: [{ allocationId: "allocation-one", allocatedAmountExact: "300000", currencyUnit: "IDR", fundType: "ZAKAT", allocatedAt: now, allocatedAgainstVersion: 1, allocationBasis: "CURRENT", pooledAllocationCount: 2, track }],
    changes: [{ kind: "REALLOCATED", amountExact: "100000", currencyUnit: "IDR", toActivityName: "Bantuan sekolah", at: now, reason: "Sisa bantuan dialihkan sesuai peruntukan." }],
    refunds: { status: "OK", data: [] },
    receiptVerifierPath: "/api/receipt-verification/contribution-one", claimLimits,
  };
  const amil: AmilTrace = { activity: track, reportSources: { status: "OK", data: [] }, claimLimits };
  const requests: Array<{ path: string; authorization: string | null }> = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "text/javascript" } });
    if (path === "/smoke.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
    if (path === "/") return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/smoke.css"><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
    if (path === "/bootstrap") return Response.json({ workspaceToken: "test-workspace-session", activityId: "activity-one", donorSession: { token: "test-donor-session", contributionId: "contribution-one", expiresAt: now + 3600 } });
    if (path === "/api/workspace") return Response.json({ account: "test-operator", institution: { id: "institution-one" }, role: "OFFICER" });
    requests.push({ path, authorization: request.headers.get("authorization") });
    if (path === "/api/donor/contributions/contribution-one/trace") return Response.json({ success: true, trace: { ...trace, operatorAccount: "PRIVATE-MARKER" } });
    if (path === "/api/workspace/activities/activity-one/trace") return Response.json({ success: true, trace: amil });
    return new Response("Not found", { status: 404 });
  } });
  const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
  const browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(4000);
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.goto(server.url.toString());
    const donor = page.getByTestId("donor");
    await donor.getByText("Sisa bantuan dialihkan sesuai peruntukan.", { exact: false }).waitFor();
    const reload = donor.getByRole("button", { name: "Muat ulang penelusuran" });
    const refresh = async () => { await reload.focus(); await page.keyboard.press("Enter"); };
    trace.refunds = { status: "OK", data: [{ id: "refund-one", status: "DECIDED", amountExact: "50000", currencyUnit: "IDR", decidedAt: now, paidAt: null }] };
    await refresh();
    await donor.getByText("Pengembalian diputuskan; belum dibayar", { exact: true }).waitFor();
    expect(await donor.getByText("Pengembalian sudah dibayar", { exact: true }).count()).toBe(0);
    trace.refunds.data[0] = { ...trace.refunds.data[0]!, status: "PAID", paidAt: now + 10 };
    await refresh();
    await donor.getByText("Pengembalian sudah dibayar", { exact: true }).waitFor();
    expect(await donor.getByText("Pengembalian diputuskan; belum dibayar", { exact: true }).count()).toBe(0);
    trace.refunds.data[0] = { ...trace.refunds.data[0]!, status: "CANCELLED", paidAt: null };
    await refresh();
    await donor.getByText("Keputusan pengembalian dibatalkan", { exact: true }).waitFor();
    expect(await donor.getByText("Pengembalian sudah dibayar", { exact: true }).count()).toBe(0);
    trace.refunds = { status: "UNAVAILABLE", reason: "Catatan pengembalian tidak dapat dibaca." };
    await refresh();
    await donor.getByRole("status").filter({ hasText: "Catatan pengembalian tidak dapat dibaca." }).waitFor();
    expect(await donor.getByText("Belum ada keputusan pengembalian.", { exact: true }).count()).toBe(0);
    track.certificates = { status: "OK", data: { pendingCount: 1, lines: [{ certificateId: "certificate-one", issuance: { state: "REVERTED", reason: "Transaksi penerbitan gagal." }, published: null }] } };
    await refresh();
    await donor.getByText("Penerbitan gagal", { exact: true }).waitFor();
    expect(await donor.getByText("Belum terbit", { exact: true }).count()).toBe(0);
    track.certificates.data.lines[0]!.issuance = { state: "SUBMITTED", reason: null };
    await refresh();
    await donor.getByText("Penerbitan diajukan; menunggu konfirmasi", { exact: true }).waitFor();
    const verifierPath = "/sertifikat?institutionId=institution-one&certificateId=certificate-one&version=1";
    track.certificates.data.lines[0] = { certificateId: "certificate-one", issuance: { state: "CONFIRMED", reason: null }, published: { version: "1", validity: "DISPUTED", observationState: "CONFIRMED", replacementState: "NONE", scopeStatus: "DISPUTED", issuer: `0x${"1".repeat(40)}`, contentDigest: `0x${"2".repeat(64)}`, verifierPath, totals: { confirmedCount: 0, disputedCount: 1, unconfirmedCount: 0 } } };
    await refresh();
    await donor.getByText("Diperselisihkan", { exact: true }).waitFor();
    const verify = donor.getByRole("link", { name: "Periksa sertifikat versi 1" });
    await verify.waitFor();
    expect(await verify.getAttribute("href")).toBe(verifierPath);
    expect(await donor.getByText(`0x${"1".repeat(40)}`, { exact: true }).count()).toBe(1);
    expect(await donor.getByText(`0x${"2".repeat(64)}`, { exact: true }).count()).toBe(1);
    await verify.focus();
    expect(await verify.evaluate((link: HTMLElement) => document.activeElement === link)).toBe(true);
    const amilPanel = page.getByTestId("amil");
    amil.reportSources = { status: "OK", data: [{ status: "UNAVAILABLE", preparationId: "report-one", role: "SOURCE", label: "Laporan kegiatan", reason: "Hubungan kegiatan belum dapat diperiksa pada snapshot ini." }] };
    await amilPanel.getByRole("button", { name: "Muat ulang penelusuran" }).click();
    await amilPanel.getByRole("alert").filter({ hasText: "Hubungan kegiatan belum dapat diperiksa" }).waitFor();
    expect(await amilPanel.getByText("Kegiatan ini belum dibekukan dalam paket laporan mana pun.").count()).toBe(0);
    expect(await page.content()).not.toContain("PRIVATE-MARKER");
    expect(requests.find((r) => r.path.includes("/donor/"))?.authorization).toBe("Bearer test-donor-session");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await server.stop(true);
  }
}, 30000);

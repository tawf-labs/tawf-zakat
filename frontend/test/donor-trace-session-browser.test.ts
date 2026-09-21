import { expect, it } from "bun:test";

for (const rejectedStatus of [401, 403]) {
  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)(`trace-only ${rejectedStatus} clears the real donor session and requires OTP again`, async () => {
    const build = await Bun.build({
      entrypoints: [new URL("./donor-session-smoke.tsx", import.meta.url).pathname],
      target: "browser", define: { "import.meta.env": "{}" },
    });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const bundle = await build.outputs[0]!.text();
    const now = Math.floor(Date.now() / 1000);
    const contributionId = "contribution-session-test";
    const contribution = {
      id: contributionId, version: 1, receivedAt: now, amountExact: "500000", currencyUnit: "IDR",
      fundType: "ZAKAT", purpose: "Bantuan", status: "ENDORSED", sourceChannel: "BANK_TRANSFER",
      sourceReference: "PRIVATE-REFERENCE", donorName: "PRIVATE-DONOR-NAME", donorContactMasked: "08***01",
      reconciledAt: now, endorsedAt: now, corrections: [], zkProof: { status: "PENDING" },
    };
    let revoked = false;
    let contributionReads = 0;
    let allocationReads = 0;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "text/javascript" } });
      if (path === "/") return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
      if (path === "/api/donor/channel") return Response.json({ available: true });
      if (path === "/api/donor/otp-challenge") return Response.json({ challengeId: "challenge-one", expiresAt: now + 300, resendAvailableAt: now });
      if (path === "/api/donor/session") {
        const body = await request.json() as { challengeId: string; otpCode: string };
        if (body.challengeId !== "challenge-one" || body.otpCode !== "123456") return Response.json({ error: "Kode tidak sesuai" }, { status: 400 });
        return Response.json({ sessionToken: "test-session", contributionId, expiresAt: now + 3600 });
      }
      if (path.startsWith("/api/public/receipt-verification/")) return Response.json({ verification: { status: "PENDING", onChainConfirmed: false } });
      if (request.headers.get("authorization") !== "Bearer test-session") return new Response(null, { status: 401 });
      if (path === `/api/donor/contributions/${contributionId}`) {
        contributionReads++;
        return Response.json({ contribution });
      }
      if (path === `/api/donor/contributions/${contributionId}/allocations`) {
        allocationReads++;
        return Response.json({ allocations: [] });
      }
      if (path === `/api/donor/contributions/${contributionId}/trace`) {
        if (revoked) return Response.json({ error: "Sesi dicabut; verifikasi OTP ulang." }, { status: rejectedStatus });
        return Response.json({ trace: {
          contribution: { ...contribution, proof: contribution.zkProof, proofMatchesContributionVersion: null },
          activities: [], changes: [], refunds: { status: "OK", data: [] },
          claimLimits: { pooled: "Dana gabungan", receipt: "Receipt bukan bukti fisik", certificate: "NFT bukan laporan", report: "Snapshot historis" },
          receiptVerifierPath: `/api/public/receipt-verification/${contributionId}`,
        } });
      }
      return new Response(null, { status: 404 });
    } });
    const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
    const browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      page.setDefaultTimeout(4000);
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(server.url.toString());
      await page.getByRole("button", { name: "Kirim Kode OTP", exact: true }).click();
      await page.getByLabel("Masukkan 6 digit kode yang dikirim ke kontak terdaftar").fill("123456");
      await page.getByRole("button", { name: "Verifikasi", exact: true }).click();
      await page.getByText("PRIVATE-DONOR-NAME", { exact: true }).waitFor();
      await page.getByText("Belum Ada Alokasi Kegiatan", { exact: true }).waitFor();
      const refresh = page.getByRole("button", { name: "Muat ulang penelusuran" });
      await refresh.waitFor();
      expect(await page.evaluate(() => sessionStorage.length)).toBe(1);
      revoked = true;
      await refresh.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Kirim Kode OTP", exact: true }).waitFor();
      await page.getByText("Sesi dicabut; verifikasi OTP ulang.", { exact: true }).waitFor();
      expect(await page.getByText("Sesi Donatur Aktif", { exact: true }).count()).toBe(0);
      expect(await page.content()).not.toContain("PRIVATE-DONOR-NAME");
      expect(await page.content()).not.toContain("PRIVATE-REFERENCE");
      expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
      // Neither older query discovered the rejection: this must be driven by the trace alone.
      expect(contributionReads).toBe(1);
      expect(allocationReads).toBe(1);
      await page.reload();
      await page.getByRole("button", { name: "Kirim Kode OTP", exact: true }).waitFor();
      expect(await page.content()).not.toContain("PRIVATE-DONOR-NAME");
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.stop(true);
    }
  }, 30000);
}

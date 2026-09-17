import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import app from "../src/index";
import { runSeeder } from "../src/seed";
import { dbService } from "../src/db/index";
import { MerkleTree } from "../src/merkle";

const API = "http://localhost:3001";
const SEEDED = { trxId: "TRX-20260824-001", donorName: "Budi Santoso", salt: "salt_budi_123", amountIDR: 2500000 };
const LOOKUP_ROUTES = ["/api/public/contributions/", "/api/donations/", "/api/donations/status/"];
const FAKE_IDS = ["TRX-20260824-9999", "TRX-FAKE-99999", "USDC-FAKE0000", "USDC-A1B2C3D4"];

const get = (path: string, headers: Record<string, string> = {}) => app.fetch(new Request(`${API}${path}`, { headers }));
const verifyReceipt = (payload: unknown) =>
  app.fetch(new Request(`${API}/api/verify-receipt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));

describe("public contribution lookup", () => {
  beforeAll(async () => {
    await runSeeder();
  });

  afterEach(() => {
    (dbService.getDonationByTrxId as any).mockRestore?.();
    (dbService.getProofForTrx as any).mockRestore?.();
    (dbService.getBatchByNumber as any).mockRestore?.();
  });

  it("answers NOT_FOUND for transaction-shaped TRX- and USDC- IDs on every lookup route, without a record", async () => {
    for (const route of LOOKUP_ROUTES) {
      for (const id of FAKE_IDS) {
        const res = await get(`${route}${id}`);
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body).toEqual({ success: false, lookupStatus: "NOT_FOUND" });
      }
    }
  });

  it("never exposes donor name, amount, salt, QR or contact for a named donor on any lookup route", async () => {
    for (const route of LOOKUP_ROUTES) {
      const res = await get(`${route}${SEEDED.trxId}`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(SEEDED.donorName);
      expect(text).not.toContain(SEEDED.salt);
      expect(text).not.toContain(String(SEEDED.amountIDR));
      expect(text).not.toMatch(/qrString|qrUrl|donorName|amountIDR|contact/);

      const { contribution, lookupStatus } = JSON.parse(text);
      expect(lookupStatus).toBe("FOUND");
      expect(contribution.owner).toBe("UNPROVEN");
      expect(contribution.restricted).toEqual(["DONOR_NAME", "AMOUNT", "SALT", "CONTACT", "DOCUMENTS"]);
    }
  });

  it("keeps a new named donor's QR and amount off the payment status route", async () => {
    const created = await app.fetch(new Request(`${API}/api/donations/fiat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ donorName: "Siti Terbuka", isAnonymous: false, amountIDR: 1234567 }),
    }));
    const { trxId } = await created.json();
    const text = await (await get(`/api/donations/status/${trxId}`)).text();
    expect(text).not.toContain("Siti Terbuka");
    expect(text).not.toContain("1234567");
    expect(text).not.toContain("qr");
  });

  it("returns the same redacted record whatever authorization a caller presents", async () => {
    const anonymous = await (await get(`/api/public/contributions/${SEEDED.trxId}`)).json();
    for (const headers of [{ Authorization: "Bearer someone-elses-session" }, { Authorization: "Basic YWRtaW46YWRtaW4=" }]) {
      expect(await (await get(`/api/public/contributions/${SEEDED.trxId}`, headers)).json()).toEqual(anonymous);
    }
  });

  it("labels proof kinds separately: Merkle inclusion from the server's batch record, no ZK proof", async () => {
    const { contribution } = await (await get(`/api/public/contributions/${SEEDED.trxId}`)).json();
    expect(contribution.status).toBe("BATCHED");
    expect(contribution.paidAt).not.toBeNull();
    expect(contribution.membershipProof.type).toBe("MERKLE_INCLUSION");
    expect(contribution.membershipProof.siblings.length).toBeGreaterThan(0);
    expect(contribution.batch.rootSource).toBe("SERVER_RECORD");
    expect(contribution.batch.versionStatus).toBe("UNTRACKED");
    expect(contribution.zkProof).toEqual({ status: "NOT_AVAILABLE" });
  });

  it("answers UNAVAILABLE, not NOT_FOUND, when the record store fails", async () => {
    spyOn(dbService, "getDonationByTrxId").mockRejectedValue(new Error("connection reset"));
    for (const route of LOOKUP_ROUTES) {
      const res = await get(`${route}${SEEDED.trxId}`);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ success: false, lookupStatus: "UNAVAILABLE" });
    }
  });
});

describe("owner receipt check", () => {
  beforeAll(async () => {
    await runSeeder();
  });

  afterEach(() => {
    (dbService.getProofForTrx as any).mockRestore?.();
    (dbService.getBatchByNumber as any).mockRestore?.();
  });

  it("confirms a genuine receipt by recomputing inclusion against the batch record", async () => {
    const res = await verifyReceipt(SEEDED);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checkedBy).toBe("SERVER");
    expect(body.proofType).toBe("MERKLE_INCLUSION");
    expect(body.isValid).toBe(true);
    expect(body.zkProof).toEqual({ status: "NOT_AVAILABLE" });
    expect(MerkleTree.verifyProof(body.leaf, body.proof, body.batch.merkleRoot)).toBe(true);
  });

  it("rejects an altered amount, a wrong salt and an unknown ID with the same answer shape", async () => {
    const answers = [];
    for (const payload of [
      { ...SEEDED, amountIDR: 999999999 },
      { ...SEEDED, salt: "wrong_salt" },
      { ...SEEDED, trxId: "TRX-20260824-9999" },
    ]) {
      const body = await (await verifyReceipt(payload)).json();
      expect(body.isValid).toBe(false);
      expect(body.proof).toEqual([]);
      expect(body.batch).toBeNull();
      answers.push(Object.keys(body).sort());
    }
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });

  it("rejects a stored proof that no longer matches the batch root on record", async () => {
    const batch = await dbService.getBatchByNumber(1);
    spyOn(dbService, "getBatchByNumber").mockResolvedValue({ ...batch!, merkleRoot: `0x${"ab".repeat(32)}` });
    const body = await (await verifyReceipt(SEEDED)).json();
    expect(body.isValid).toBe(false);
  });

  it("answers 503 instead of a verdict when the proof store fails", async () => {
    spyOn(dbService, "getProofForTrx").mockRejectedValue(new Error("store offline"));
    const res = await verifyReceipt(SEEDED);
    expect(res.status).toBe(503);
    expect((await res.json()).isValid).toBeUndefined();
  });

  it("requires all three receipt fields and a positive whole amount", async () => {
    for (const payload of [{ trxId: SEEDED.trxId }, { ...SEEDED, amountIDR: -5 }, { ...SEEDED, amountIDR: "abc" }]) {
      expect((await verifyReceipt(payload)).status).toBe(400);
    }
  });
});

describe("verification page in a browser", () => {
  beforeAll(async () => {
    await runSeeder();
  });

  it("bundles the verification page for the browser", async () => {
    const built = await Bun.build({
      entrypoints: [new URL("../../frontend/test/verification-smoke.tsx", import.meta.url).pathname],
      target: "browser",
      define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "" }) },
    });
    if (!built.success) throw new Error(built.logs.join("\n"));
  });

  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)(
    "browser: found record, owner check, fake ID, API failure and network failure never show success",
    async () => {
      const built = await Bun.build({
        entrypoints: [new URL("../../frontend/test/verification-smoke.tsx", import.meta.url).pathname],
        target: "browser",
        define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "" }) },
      });
      if (!built.success) throw new Error(built.logs.join("\n"));
      const bundle = await built.outputs[0]!.text();
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(req) {
          const path = new URL(req.url).pathname;
          if (path === "/") return new Response('<!doctype html><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
          if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
          return app.fetch(req);
        },
      });
      const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
      try {
        browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
        const page = await browser.newPage();
        page.setDefaultTimeout(10000);
        page.on("pageerror", (error: Error) => console.error("Verification browser:", error.message));
        await page.route("**/api/public/contributions/TRX-API-FAIL", (route: any) => route.fulfill({ status: 500, body: "{}" }));
        await page.route("**/api/public/contributions/TRX-NET-FAIL", (route: any) => route.abort());

        await page.goto(`${server.url}?trxId=${SEEDED.trxId}`);
        await page.getByRole("heading", { name: "Catatan Kontribusi" }).waitFor();
        expect(await page.getByText(SEEDED.donorName).count()).toBe(0);
        expect(await page.getByText(/Muzakki|Terverifikasi/).count()).toBe(0);

        await page.getByText("Cocokkan dengan kuitansi Anda").click();
        await page.getByLabel("Kode rahasia kuitansi").fill("wrong_salt");
        await page.getByLabel("Nominal (Rp)").fill(String(SEEDED.amountIDR));
        await page.getByRole("button", { name: "Cocokkan Kuitansi" }).click();
        await page.getByText(/Kuitansi tidak cocok/).waitFor();

        await page.getByLabel("Kode rahasia kuitansi").fill(SEEDED.salt);
        await page.getByRole("button", { name: "Cocokkan Kuitansi" }).click();
        await page.getByText(/Kuitansi cocok dengan catatan batch #/).waitFor();

        await page.route("**/api/verify-receipt", (route: any) => route.fulfill({ status: 503, body: "{}" }));
        await page.getByLabel("Nominal (Rp)").fill("1");
        await page.getByRole("button", { name: "Cocokkan Kuitansi" }).click();
        await page.getByText(/Pemeriksaan belum dapat dilakukan/).waitFor();
        expect(await page.getByText(/Kuitansi cocok/).count()).toBe(0);

        const search = async (id: string) => {
          await page.getByLabel("Referensi kontribusi").fill(id);
          await page.getByRole("button", { name: "Cek Status" }).click();
        };
        await search("USDC-A1B2C3D4");
        await page.getByRole("heading", { name: "Kontribusi Tidak Ditemukan" }).waitFor();
        for (const id of ["TRX-API-FAIL", "TRX-NET-FAIL"]) {
          await search(id);
          await page.getByRole("heading", { name: "Status Belum Dapat Diperiksa" }).waitFor();
          expect(await page.getByRole("heading", { name: "Catatan Kontribusi" }).count()).toBe(0);
        }
      } finally {
        await browser?.close();
        server.stop(true);
      }
    },
    60000,
  );
});

import { describe, expect, it, beforeAll } from "bun:test";
import app from "../src/index";
import { runSeeder } from "../src/seed";
import { MerkleTree, computeDonationLeaf } from "../src/merkle";

describe("Honest Verification & Privacy Protection (GH Issue #101 & Spec #100)", () => {
  beforeAll(async () => {
    await runSeeder();
  });

  describe("AC1 & AC3: Fake IDs & Public Lookup Privacy Protection", () => {
    it("GET /api/public/contributions/:id should return 404 for fake TRX- or USDC- IDs, never fake success", async () => {
      for (const fakeId of ["TRX-FAKE-99999", "TRX-20260824-NONEXISTENT", "USDC-FAKE-0000", "RANDOM-12345"]) {
        const res = await app.fetch(
          new Request(`http://localhost:3001/api/public/contributions/${fakeId}`)
        );
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.contribution).toBeUndefined();
        expect(body.mockReceipt).toBeUndefined();
      }
    });

    it("GET /api/donations/:trxId should return 404 for fake IDs, without generating mock data", async () => {
      const res = await app.fetch(
        new Request("http://localhost:3001/api/donations/TRX-FAKE-99999")
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.success).toBe(false);
    });

    it("GET /api/public/contributions/:id for legitimate transaction must NOT leak donorName, salt, private amount, or documents", async () => {
      const knownId = "TRX-20260824-001";
      const res = await app.fetch(
        new Request(`http://localhost:3001/api/public/contributions/${knownId}`)
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.contribution).toBeDefined();

      const c = body.contribution;
      expect(c.trxId).toBe(knownId);

      // Privacy checks: NEVER expose private donor name, salt, or private amount to public lookup
      expect(c.donorName).toBeNull();
      expect(c.salt).toBeNull();
      expect(c.amountIDR).toBeNull();
      expect(c.contact).toBeUndefined();
      expect(c.files).toBeUndefined();

      // Limitations must be honestly stated
      expect(Array.isArray(c.limitations)).toBe(true);
      expect(c.limitations).toContain("DONOR_NAME_RESTRICTED");
      expect(c.limitations).toContain("SALT_RESTRICTED");
      expect(c.limitations).toContain("AMOUNT_RESTRICTED");

      // Lifecycle status must be genuine
      expect(["PENDING", "PAID", "BATCHED"]).toContain(c.status);
    });

    it("GET /api/donations/:trxId sanitizes sensitive fields on public read", async () => {
      const knownId = "TRX-20260824-001";
      const res = await app.fetch(
        new Request(`http://localhost:3001/api/donations/${knownId}`)
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      const item = body.donation || body.contribution;
      expect(item).toBeDefined();
      expect(item.salt).toBeNull();
    });
  });

  describe("AC2: Proof Type Differentiation & Real Verification Outcomes", () => {
    it("Distinguishes Merkle Tree proof from ZK Proof and Signature", async () => {
      const knownId = "TRX-20260824-001";
      const res = await app.fetch(
        new Request(`http://localhost:3001/api/public/contributions/${knownId}`)
      );
      const body = await res.json();
      const c = body.contribution;

      // Merkle tree proof type
      expect(c.proofType).toBe("MERKLE_TREE");
      // ZK is explicitly pending in this phase (ADR-0034, Ticket #108), NEVER conflated with Merkle
      expect(c.zkStatus).toBe("PENDING");
    });

    it("POST /api/verify-receipt returns isValid: true ONLY when leaf matches root with real Merkle proof", async () => {
      const validPayload = {
        trxId: "TRX-20260824-001",
        salt: "salt_budi_123",
        amountIDR: 2500000,
      };

      const res = await app.fetch(
        new Request("http://localhost:3001/api/verify-receipt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validPayload),
        })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.isValid).toBe(true);
      expect(body.proofType).toBe("MERKLE_TREE");
      expect(body.zkStatus).toBe("PENDING");
      expect(body.leaf.startsWith("0x")).toBe(true);
      expect(body.merkleRoot.startsWith("0x")).toBe(true);
      expect(Array.isArray(body.proof)).toBe(true);
      expect(body.proof.length).toBeGreaterThan(0);

      // Verify mathematically using MerkleTree.verifyProof
      const verified = MerkleTree.verifyProof(body.leaf, body.proof, body.merkleRoot);
      expect(verified).toBe(true);
    });

    it("POST /api/verify-receipt rejects altered amount or wrong salt (isValid: false), never manufactures success", async () => {
      // Altered amount
      const alteredAmountPayload = {
        trxId: "TRX-20260824-001",
        salt: "salt_budi_123",
        amountIDR: 999999999, // tampered amount
      };

      const resAmount = await app.fetch(
        new Request("http://localhost:3001/api/verify-receipt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(alteredAmountPayload),
        })
      );

      expect(resAmount.status).toBe(200);
      const bodyAmount = await resAmount.json();
      expect(bodyAmount.isValid).toBe(false);

      // Altered salt
      const alteredSaltPayload = {
        trxId: "TRX-20260824-001",
        salt: "wrong_tampered_salt",
        amountIDR: 2500000,
      };

      const resSalt = await app.fetch(
        new Request("http://localhost:3001/api/verify-receipt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(alteredSaltPayload),
        })
      );

      expect(resSalt.status).toBe(200);
      const bodySalt = await resSalt.json();
      expect(bodySalt.isValid).toBe(false);
    });

    it("POST /api/verify-receipt requires all 3 receipt credentials", async () => {
      const incompletePayload = {
        trxId: "TRX-20260824-001",
        // missing salt and amountIDR
      };

      const res = await app.fetch(
        new Request("http://localhost:3001/api/verify-receipt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(incompletePayload),
        })
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });
  });

  describe("AC4: Access Control & No Expansion of Document Access", () => {
    it("Refuses unauthenticated access to restricted evidence files without leaking document contents", async () => {
      const res = await app.fetch(
        new Request("http://localhost:3001/api/evidence/some-prep-id/files/file-1")
      );
      expect([401, 503]).toContain(res.status);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });
  });

  describe("AC5: Truthful Status Contract for API/UI", () => {
    it("Public lookup response includes structured status: FOUND, NOT_FOUND, or UNAVAILABLE", async () => {
      // 1. Found
      const foundRes = await app.fetch(
        new Request("http://localhost:3001/api/public/contributions/TRX-20260824-001")
      );
      expect(foundRes.status).toBe(200);
      const foundJson = await foundRes.json();
      expect(foundJson.lookupStatus).toBe("FOUND");

      // 2. Not Found
      const notFoundRes = await app.fetch(
        new Request("http://localhost:3001/api/public/contributions/TRX-NOT-FOUND-000")
      );
      expect(notFoundRes.status).toBe(404);
      const notFoundJson = await notFoundRes.json();
      expect(notFoundJson.lookupStatus).toBe("NOT_FOUND");
    });
  });

  describe("AC6: Preservation of Report Verifications and Browser Smoke Build", () => {
    it("GET /api/public/reports/:packageId returns honest 404 for unknown report package, never mock report", async () => {
      const res = await app.fetch(
        new Request("http://localhost:3001/api/public/reports/pkg-nonexistent-12345")
      );
      expect([404, 503]).toContain(res.status);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it("Bun browser build succeeds for verification-smoke.tsx without error", async () => {
      const smokePath = new URL("../../frontend/test/verification-smoke.tsx", import.meta.url).pathname;
      const buildResult = await Bun.build({
        entrypoints: [smokePath],
        target: "browser",
        define: {
          "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "http://127.0.0.1:3001" }),
        },
      });
      expect(buildResult.success).toBe(true);
      expect(buildResult.outputs.length).toBeGreaterThan(0);
      const outputText = await buildResult.outputs[0]!.text();
      expect(outputText.length).toBeGreaterThan(100);
    });
  });
});

import { describe, expect, it, beforeAll } from "bun:test";
import app from "../src/index";
import { runSeeder } from "../src/seed";

describe("Backend API Endpoints", () => {
  beforeAll(async () => {
    await runSeeder();
  });
  it("GET /health should return status ok", async () => {
    const res = await app.fetch(new Request("http://localhost:3001/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("GET /api/batches should return seeded batches", async () => {
    const res = await app.fetch(new Request("http://localhost:3001/api/batches"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.totalBatches).toBeGreaterThan(0);
    expect(body.batches[0].merkleRoot.startsWith("0x")).toBe(true);
  });

  it("POST /api/verify-receipt should return valid proof for seeded transaction", async () => {
    const payload = {
      trxId: "TRX-20260824-001",
      salt: "salt_budi_123",
      amountIDR: 2500000,
    };

    const res = await app.fetch(
      new Request("http://localhost:3001/api/verify-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isValid).toBe(true);
    expect(body.leaf.startsWith("0x")).toBe(true);
    expect(body.proof.length).toBeGreaterThan(0);
    expect(body.merkleRoot.startsWith("0x")).toBe(true);
  });

  it("GET /api/proposals should return proposals list", async () => {
    const res = await app.fetch(new Request("http://localhost:3001/api/proposals"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.proposals)).toBe(true);
  });

  it("POST /api/disbursement/upload-proof should return beneficiary hash and IPFS CID", async () => {
    const payload = {
      beneficiaryName: "Ahmad Mustahik",
      beneficiaryNIK: "3201019999990001",
      asnafCategory: "Fakir",
      amount: 1500000,
      currency: "IDR",
      description: "Santunan beras",
    };

    const res = await app.fetch(
      new Request("http://localhost:3001/api/disbursement/upload-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.beneficiaryHash.startsWith("0x")).toBe(true);
    expect(body.ipfsProofCID.startsWith("Qm")).toBe(true);
  });
});

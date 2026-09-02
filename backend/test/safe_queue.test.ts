import { describe, it, expect } from "bun:test";
import app from "../src/index";
import { getSafeInfo, getSafePendingTransactions } from "../src/safe";

describe("Safe.global DPS Multi-Sig Queue Integration (Ticket #32)", () => {
  it("should fetch live Safe info from Sepolia Safe Transaction Service", async () => {
    const safeInfo = await getSafeInfo();
    expect(safeInfo).toBeDefined();
    expect(safeInfo.address.toLowerCase()).toBe("0xb4e4253e2affdc0710cb9394b8c4e935f11b00f1".toLowerCase());
    expect(safeInfo.threshold).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(safeInfo.owners)).toBe(true);
    expect(safeInfo.owners.length).toBeGreaterThanOrEqual(1);
  }, 10000);

  it("should provide API endpoint GET /api/safe/info", async () => {
    const res = await app.fetch(new Request("http://localhost:3001/api/safe/info"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.safe.address).toBeDefined();
    expect(data.safe.threshold).toBeDefined();
    expect(Array.isArray(data.safe.owners)).toBe(true);
  }, 10000);

  it("should provide API endpoint GET /api/safe/pending to track multisig queue signatures", async () => {
    const res = await app.fetch(new Request("http://localhost:3001/api/safe/pending"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.pendingTransactions)).toBe(true);
    expect(data.safeThreshold).toBeDefined();
  }, 10000);
});

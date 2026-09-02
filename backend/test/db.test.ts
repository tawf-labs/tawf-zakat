import { describe, expect, it } from "bun:test";
import { donations, merkleBatches, disbursementProposals } from "../src/db/schema";
import { dbService } from "../src/db/index";

describe("Drizzle Schema & DB Service", () => {
  it("should define valid table structures for Drizzle ORM", () => {
    expect(donations).toBeDefined();
    expect(merkleBatches).toBeDefined();
    expect(disbursementProposals).toBeDefined();
  });

  it("should record a donation through dbService and return valid record", async () => {
    const record = {
      trxId: `TRX-TEST-${Date.now()}`,
      donorName: "Muzakki Test",
      isAnonymous: false,
      salt: "salt_test_123",
      amountIDR: 1500000,
      timestamp: new Date().toISOString(),
    };

    const saved = await dbService.recordDonation(record, 1);
    expect(saved.trxId).toBe(record.trxId);
    expect(saved.amountIDR).toBe(1500000);
  });

  it("should retrieve batches and proposals from dbService", async () => {
    const batches = await dbService.getBatches();
    const proposals = await dbService.getProposals();

    expect(Array.isArray(batches)).toBe(true);
    expect(Array.isArray(proposals)).toBe(true);
  });
});

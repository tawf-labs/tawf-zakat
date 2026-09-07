import { afterAll, describe, expect, it } from "bun:test";
import { db, dbService } from "../src/db/index";
import { dataStore } from "../src/store";

afterAll(async () => {
  await db?.$client.end({ timeout: 0 });
});

describe("Database isolation during automated tests", () => {
  it("never creates a persistent database client in test mode", () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(db === null).toBe(true);
  });

  it("records test donations only in the in-memory store", async () => {
    const trxId = "TEST-ISOLATED-DATABASE";
    try {
      const record = await dbService.recordDonation({
        trxId, donorName: "Synthetic test", isAnonymous: true,
        amountIDR: 123, salt: "test-only", timestamp: "2026-09-08T00:00:00.000Z",
      });
      expect(record.trxId).toBe(trxId);
      expect(dataStore.getDonation(trxId)?.amountIDR).toBe(123);
      expect(db === null).toBe(true);
    } finally {
      dataStore.donations.delete(trxId);
    }
  });

  it("excludes onchain USDC deposits from the fiat settlement queue", async () => {
    const ids = ["TEST-QUEUE-USDC", "TEST-QUEUE-QRIS"];
    try {
      for (const [index, paymentMethod] of ["USDC", "QRIS"].entries()) {
        await dbService.recordDonation({
          trxId: ids[index]!, donorName: "", isAnonymous: true,
          amountIDR: 100, salt: "test-only", timestamp: "2026-09-08T00:00:00.000Z",
          status: "PAID", paymentMethod,
        });
      }
      const queue = await dbService.getUnbatchedPaidDonations();
      expect(queue.some((row) => row.trxId === ids[0])).toBe(false);
      expect(queue.some((row) => row.trxId === ids[1])).toBe(true);
    } finally {
      for (const id of ids) dataStore.donations.delete(id);
    }
  });
});

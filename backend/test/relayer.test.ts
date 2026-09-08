import { describe, expect, it } from "bun:test";
import app from "../src/index";
import { settleBatchOnChain } from "../src/relayer";
import { dataStore } from "../src/store";
import { isolateProtocolStore } from "./helpers/protocol-fixture";

describe("Unconfigured live relayer fails closed", () => {
  isolateProtocolStore();
  it("returns failure without fabricating a transaction hash", async () => {
    const result = await settleBatchOnChain(91001, `0x${"12".repeat(32)}`, 1000000, false);
    expect(result.success).toBe(false);
    expect(result.txHash).toBe("");
    expect(result.explorerUrl).toBe("");
    expect(result.error).toContain("private key");
  });
  it("returns a settlement error and preserves the pending queue", async () => {
    dataStore.recordDonation({ trxId: "test-relayer", donorName: "Test", isAnonymous: true,
      salt: "test", amountIDR: 1000000, status: "PAID", paymentMethod: "QRIS",
      timestamp: "2026-09-09T00:00:00.000Z" });
    const before = structuredClone([...dataStore.donations]);
    const response = await app.fetch(new Request("http://localhost/api/relayer/settle-batch", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    }));
    expect(response.status).toBe(500);
    expect((await response.json()).success).toBe(false);
    expect([...dataStore.donations]).toEqual(before);
    expect(dataStore.batches.size).toBe(0);
  });
});

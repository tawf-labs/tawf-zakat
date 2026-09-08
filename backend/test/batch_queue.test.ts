import { describe, expect, it, spyOn } from "bun:test";
import app from "../src/index";
import * as relayer from "../src/relayer";
import { dataStore } from "../src/store";
import { dbService } from "../src/db/index";
import { computeDonationLeaf, MerkleTree, type DonationRecord } from "../src/merkle";
import { isolateProtocolStore } from "./helpers/protocol-fixture";

const txHash = `0x${"12".repeat(32)}`;
const post = () => app.fetch(new Request("http://localhost/api/relayer/settle-batch", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: '{"batchId":91001}',
}));
function donation(trxId: string, overrides: Partial<DonationRecord> = {}) {
  return { trxId, donorName: "Test", isAnonymous: true, amountIDR: 1500000,
    salt: "test-salt", timestamp: "2026-09-09T00:00:00.000Z", status: "PAID" as const,
    paymentMethod: "QRIS", ...overrides };
}

describe("Fiat settlement queue", () => {
  isolateProtocolStore();

  for (const kind of ["empty", "USDC", "PENDING", "already batched"] as const) {
    it(`rejects an ineligible queue (${kind}) without broadcasting or changing donations`, async () => {
      if (kind !== "empty") dataStore.recordDonation(donation("excluded", {
        paymentMethod: kind === "USDC" ? "USDC" : "QRIS",
        status: kind === "PENDING" ? "PENDING" : "PAID",
      }), kind === "already batched" ? 123 : undefined);
      const before = structuredClone([...dataStore.donations]);
      const broadcast = spyOn(relayer, "settleBatchOnChain").mockResolvedValue({ success: false, txHash: "", explorerUrl: "", error: "Must not broadcast" });
      try {
        expect((await post()).status).toBe(409);
        expect(broadcast).not.toHaveBeenCalled();
        expect([...dataStore.donations]).toEqual(before);
        expect(dataStore.batches.size).toBe(0);
        expect(dataStore.batchTrees.size).toBe(0);
      } finally { broadcast.mockRestore(); }
    });
  }

  for (const detached of [false, true]) {
    it(`commits only eligible paid fiat donations after confirmation (${detached ? "detached DB rows" : "memory queue"})`, async () => {
      const paid = donation("paid");
      dataStore.recordDonation(paid);
      dataStore.recordDonation(donation("pending", { status: "PENDING" }));
      dataStore.recordDonation(donation("usdc", { paymentMethod: "USDC" }));
      dataStore.recordDonation(donation("old"), 123);
      // The DB path returns detached rows, unlike the memory path.
      const queue = detached ? spyOn(dbService, "getUnbatchedPaidDonations").mockResolvedValue([structuredClone(paid)]) : undefined;
      const broadcast = spyOn(relayer, "settleBatchOnChain").mockResolvedValue({ success: true, txHash, explorerUrl: `https://sepolia.arbiscan.io/tx/${txHash}` });
      try {
        const response = await post();
        expect(response.status).toBe(200);
        const body = await response.json();
        const root = new MerkleTree([computeDonationLeaf(paid.trxId, paid.salt, paid.amountIDR)]).getRoot();
        expect(broadcast).toHaveBeenCalledWith(91001, root, paid.amountIDR, true);
        expect(body.itemCount).toBe(1);
        expect(body.onChainConfirmed).toBe(true);
        expect(dataStore.getDonation("paid")).toMatchObject({ status: "BATCHED", batchId: 91001 });
        expect(dataStore.getDonation("pending")?.status).toBe("PENDING");
        expect(dataStore.getDonation("usdc")?.batchId).toBeUndefined();
        expect(dataStore.getDonation("old")?.batchId).toBe(123);
        expect(dataStore.batches.get(91001)?.txHash).toBe(txHash);
      } finally { queue?.mockRestore(); broadcast.mockRestore(); }
    });

  }

  it("leaves eligible donations unbatched when broadcasting fails", async () => {
    dataStore.recordDonation(donation("paid"));
    const before = structuredClone([...dataStore.donations]);
    const broadcast = spyOn(relayer, "settleBatchOnChain").mockResolvedValue({ success: false, txHash: "", explorerUrl: "", error: "RPC unavailable" });
    try {
      const response = await post();
      expect(response.status).toBe(500);
      expect((await response.json()).error).toBe("RPC unavailable");
      expect([...dataStore.donations]).toEqual(before);
      expect(dataStore.batches.size).toBe(0);
      expect(dataStore.batchTrees.size).toBe(0);
    } finally { broadcast.mockRestore(); }
  });
});

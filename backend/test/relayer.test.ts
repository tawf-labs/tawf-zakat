import { describe, expect, it } from "bun:test";
import app from "../src/index";
import { settleBatchOnChain } from "../src/relayer";
import { computeDonationLeaf, MerkleTree } from "../src/merkle";

describe("Onchain Relayer Engine", () => {
  it("should generate root and return valid txHash structure from relayer", async () => {
    const leaf = computeDonationLeaf("TRX-TEST-1", "salt_1", 1000000);
    const tree = new MerkleTree([leaf]);
    const root = tree.getRoot();

    const testBatchId = Math.floor(10000 + Math.random() * 90000);
    const result = await settleBatchOnChain(testBatchId, root, 1000000, false);

    expect(result.success).toBe(true);
    expect(result.txHash.startsWith("0x")).toBe(true);
    expect(result.explorerUrl.includes("sepolia.etherscan.io")).toBe(true);
  });

  it("POST /api/relayer/settle-batch should execute settlement and return onchain confirmation", async () => {
    const dynamicBatchId = Math.floor(100000 + Math.random() * 900000);
    const res = await app.fetch(
      new Request("http://localhost:3001/api/relayer/settle-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: dynamicBatchId }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.merkleRoot.startsWith("0x")).toBe(true);
    expect(body.txHash.startsWith("0x")).toBe(true);
    expect(body.explorerUrl.includes("sepolia.etherscan.io")).toBe(true);
  });
});

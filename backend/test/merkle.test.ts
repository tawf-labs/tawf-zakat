import { describe, expect, it } from "bun:test";
import { MerkleTree, computeDonationLeaf } from "../src/merkle";

describe("MerkleTree Engine", () => {
  it("should compute leaf correctly", () => {
    const leaf = computeDonationLeaf("TRX-001", "salt123", 500000);
    expect(leaf.startsWith("0x")).toBe(true);
    expect(leaf.length).toBe(66);
  });

  it("should generate root and verify valid proof for all leaves", () => {
    const donations = [
      { trxId: "TRX-101", salt: "saltA", amount: 100000 },
      { trxId: "TRX-102", salt: "saltB", amount: 250000 },
      { trxId: "TRX-103", salt: "saltC", amount: 500000 },
      { trxId: "TRX-104", salt: "saltD", amount: 1000000 },
      { trxId: "TRX-105", salt: "saltE", amount: 750000 },
    ];

    const leaves = donations.map((d) => computeDonationLeaf(d.trxId, d.salt, d.amount));
    const tree = new MerkleTree(leaves);
    const root = tree.getRoot();

    expect(root.startsWith("0x")).toBe(true);

    // Verify proof for every single leaf
    for (let i = 0; i < leaves.length; i++) {
      const proof = tree.getProof(i);
      const isValid = MerkleTree.verifyProof(leaves[i], proof, root);
      expect(isValid).toBe(true);
    }
  });

  it("should reject tampered leaf or fake proof", () => {
    const leaves = [
      computeDonationLeaf("TRX-1", "salt1", 100000),
      computeDonationLeaf("TRX-2", "salt2", 200000),
      computeDonationLeaf("TRX-3", "salt3", 300000),
    ];

    const tree = new MerkleTree(leaves);
    const root = tree.getRoot();
    const proof0 = tree.getProof(0);

    // Fake leaf with different amount
    const fakeLeaf = computeDonationLeaf("TRX-1", "salt1", 999999);
    const isValid = MerkleTree.verifyProof(fakeLeaf, proof0, root);
    expect(isValid).toBe(false);
  });
});

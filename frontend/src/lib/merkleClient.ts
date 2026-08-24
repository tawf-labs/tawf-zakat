import { keccak256, encodePacked, concatHex, type Hex } from "viem";

export function computeDonationLeaf(trxId: string, salt: string, amountIDR: number): Hex {
  return keccak256(
    encodePacked(
      ["string", "string", "uint256"],
      [trxId, salt, BigInt(amountIDR)]
    )
  );
}

export function hashPair(a: Hex, b: Hex): Hex {
  return a.toLowerCase() < b.toLowerCase()
    ? keccak256(concatHex([a, b]))
    : keccak256(concatHex([b, a]));
}

export function verifyClientProof(leaf: Hex, proof: Hex[], root: Hex): boolean {
  let computedHash = leaf;

  for (const proofElement of proof) {
    computedHash = hashPair(computedHash, proofElement);
  }

  return computedHash.toLowerCase() === root.toLowerCase();
}

import { keccak256, encodePacked, concatHex, type Hex } from "viem";

export interface DonationRecord {
  trxId: string;
  donorName: string;
  isAnonymous: boolean;
  salt: string;
  amountIDR: number;
  timestamp: string;
  status?: "PENDING" | "PAID" | "BATCHED";
  paymentMethod?: string;
  qrString?: string;
  qrUrl?: string;
  paidAt?: string;
}

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

export class MerkleTree {
  public leaves: Hex[];
  public layers: Hex[][];

  constructor(leaves: Hex[]) {
    if (leaves.length === 0) {
      throw new Error("Cannot create MerkleTree with empty leaves");
    }
    this.leaves = leaves;
    this.layers = this.buildLayers(leaves);
  }

  private buildLayers(leaves: Hex[]): Hex[][] {
    const layers: Hex[][] = [leaves];
    let currentLayer = leaves;

    while (currentLayer.length > 1) {
      const nextLayer: Hex[] = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];
        const right = i + 1 < currentLayer.length ? currentLayer[i + 1] : left;
        nextLayer.push(hashPair(left, right));
      }
      layers.push(nextLayer);
      currentLayer = nextLayer;
    }

    return layers;
  }

  public getRoot(): Hex {
    return this.layers[this.layers.length - 1][0];
  }

  public getProof(leafIndex: number): Hex[] {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error("Leaf index out of bounds");
    }

    const proof: Hex[] = [];
    let index = leafIndex;

    for (let layerIndex = 0; layerIndex < this.layers.length - 1; layerIndex++) {
      const currentLayer = this.layers[layerIndex];
      const isRight = index % 2 === 1;
      const pairIndex = isRight ? index - 1 : index + 1;

      if (pairIndex < currentLayer.length) {
        proof.push(currentLayer[pairIndex]);
      } else {
        proof.push(currentLayer[index]);
      }

      index = Math.floor(index / 2);
    }

    return proof;
  }

  public static verifyProof(leaf: Hex, proof: Hex[], root: Hex): boolean {
    let computedHash = leaf;

    for (const proofElement of proof) {
      computedHash = hashPair(computedHash, proofElement);
    }

    return computedHash.toLowerCase() === root.toLowerCase();
  }
}

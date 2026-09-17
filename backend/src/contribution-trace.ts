import type { Hex } from "viem";
import { dbService } from "./db/index";
import { computeDonationLeaf, MerkleTree, type DonationRecord } from "./merkle";

export type ContributionStatus = "PENDING" | "PAID" | "BATCHED";
export type RestrictedField = "DONOR_NAME" | "AMOUNT" | "SALT" | "CONTACT" | "DOCUMENTS";

/** The server's own batch record; no chain read backs these values. */
export interface BatchRecord {
  batchId: number;
  merkleRoot: Hex | null;
  anchorTxHash: string | null;
  rootSource: "SERVER_RECORD";
  versionStatus: "UNTRACKED";
}

export interface PublicContribution {
  trxId: string;
  status: ContributionStatus;
  recordedAt: string;
  paidAt: string | null;
  batch: BatchRecord | null;
  membershipProof: { type: "MERKLE_INCLUSION"; siblings: Hex[] } | null;
  zkProof: { status: "NOT_AVAILABLE" };
  owner: "UNPROVEN";
  restricted: RestrictedField[];
}

export type ContributionLookup =
  | { lookupStatus: "FOUND"; contribution: PublicContribution }
  | { lookupStatus: "NOT_FOUND" }
  | { lookupStatus: "UNAVAILABLE" };

export type ReceiptCheck = {
  checkedBy: "SERVER";
  proofType: "MERKLE_INCLUSION";
  isValid: boolean;
  leaf: Hex;
  proof: Hex[];
  batch: BatchRecord | null;
  zkProof: { status: "NOT_AVAILABLE" };
};

const RESTRICTED: RestrictedField[] = ["DONOR_NAME", "AMOUNT", "SALT", "CONTACT", "DOCUMENTS"];
const NO_ZK_PROOF = { status: "NOT_AVAILABLE" } as const;

type StoredDonation = DonationRecord & { batchId?: number };

async function readBatch(batchId: number | undefined): Promise<BatchRecord | null> {
  if (!batchId) return null;
  const batch = await dbService.getBatchByNumber(Number(batchId));
  return {
    batchId: Number(batchId),
    merkleRoot: (batch?.merkleRoot as Hex) ?? null,
    anchorTxHash: batch?.txHash ?? null,
    rootSource: "SERVER_RECORD",
    versionStatus: "UNTRACKED",
  };
}

async function toPublicContribution(donation: StoredDonation): Promise<PublicContribution> {
  const batch = await readBatch(donation.batchId);
  const stored = batch ? await dbService.getProofForTrx(donation.trxId, donation.salt, donation.amountIDR) : null;
  return {
    trxId: donation.trxId,
    status: (donation.status as ContributionStatus) || "PENDING",
    recordedAt: donation.timestamp,
    paidAt: donation.paidAt ?? null,
    batch,
    membershipProof: stored?.proof.length ? { type: "MERKLE_INCLUSION", siblings: stored.proof as Hex[] } : null,
    zkProof: NO_ZK_PROOF,
    owner: "UNPROVEN",
    restricted: RESTRICTED,
  };
}

export async function lookupContribution(
  trxId: string,
  beforeProjection?: (donation: StoredDonation) => Promise<void>,
): Promise<ContributionLookup> {
  try {
    const donation = await dbService.getDonationByTrxId(trxId);
    if (!donation) return { lookupStatus: "NOT_FOUND" };
    await beforeProjection?.(donation);
    return { lookupStatus: "FOUND", contribution: await toPublicContribution(donation) };
  } catch (error) {
    console.error("Contribution lookup failed:", error);
    return { lookupStatus: "UNAVAILABLE" };
  }
}

export async function checkReceipt(trxId: string, salt: string, amountIDR: number): Promise<ReceiptCheck> {
  const leaf = computeDonationLeaf(trxId, salt, amountIDR);
  const stored = await dbService.getProofForTrx(trxId, salt, amountIDR);
  const batch = stored ? await readBatch(stored.batchId) : null;
  const proof = (stored?.proof ?? []) as Hex[];
  const isValid = Boolean(batch?.merkleRoot && proof.length > 0 && MerkleTree.verifyProof(leaf, proof, batch.merkleRoot));
  return { checkedBy: "SERVER", proofType: "MERKLE_INCLUSION", isValid, leaf, proof: isValid ? proof : [], batch: isValid ? batch : null, zkProof: NO_ZK_PROOF };
}

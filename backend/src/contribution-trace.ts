import type { Hex } from "viem";
import { dbService } from "./db/index";
import { computeDonationLeaf, MerkleTree, type DonationRecord } from "./merkle";
import { maskContact } from "./donor-access";

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
  hasContact?: boolean;
  contactMasked?: string | null;
  contributionId?: string;
  institutionId?: string;
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
    if (donation) {
      await beforeProjection?.(donation);
      return { lookupStatus: "FOUND", contribution: await toPublicContribution(donation) };
    }

    const contrib = await dbService.getContributionByIdOrRef(trxId);
    if (contrib) {
      const publicContrib: PublicContribution = {
        trxId: contrib.sourceReference || contrib.id,
        status: (contrib.status === "RECEIVED" ? "PENDING" : (contrib.status === "REJECTED" ? "PENDING" : "PAID")) as ContributionStatus,
        recordedAt: new Date(Number(contrib.receivedAt) * 1000).toISOString(),
        paidAt: contrib.reconciledAt ? new Date(Number(contrib.reconciledAt) * 1000).toISOString() : null,
        batch: null,
        membershipProof: null,
        zkProof: NO_ZK_PROOF,
        owner: "UNPROVEN",
        restricted: RESTRICTED,
        hasContact: Boolean(contrib.donorContact && contrib.donorContact.trim().length > 0),
        contactMasked: contrib.donorContact ? maskContact(contrib.donorContact) : null,
        contributionId: contrib.id,
        institutionId: contrib.institutionId,
      };
      return { lookupStatus: "FOUND", contribution: publicContrib };
    }

    return { lookupStatus: "NOT_FOUND" };
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

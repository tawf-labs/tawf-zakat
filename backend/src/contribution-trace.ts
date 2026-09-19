import type { Hex } from "viem";
import { dbService } from "./db/index";
import { computeDonationLeaf, MerkleTree, type DonationRecord } from "./merkle";
import type { ContributionStatus } from "./contribution";
import { workspaceRuntime } from "./workspace-runtime";

/**
 * What the public page may say about a record. Online donations move
 * PENDING -> PAID -> BATCHED; contributions an institution recorded (ticket
 * #102) keep their own states, REJECTED included, rather than being folded
 * into a donation state that says something else.
 */
export type PublicContributionStatus =
  | "PENDING"
  | "PAID"
  | "BATCHED"
  | "RECEIVED"
  | "RECONCILED"
  | "ENDORSED"
  | "REJECTED";

/** Only an institution-recorded contribution can be opened by its donor through OTP (#104). */
export type PublicRecordKind = "ONLINE_DONATION" | "INSTITUTION_CONTRIBUTION";
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
  recordKind: PublicRecordKind;
  status: PublicContributionStatus;
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
    recordKind: "ONLINE_DONATION",
    status: (donation.status as PublicContributionStatus) || "PENDING",
    recordedAt: donation.timestamp,
    paidAt: donation.paidAt ?? null,
    batch,
    membershipProof: stored?.proof.length ? { type: "MERKLE_INCLUSION", siblings: stored.proof as Hex[] } : null,
    zkProof: NO_ZK_PROOF,
    owner: "UNPROVEN",
    restricted: RESTRICTED,
  };
}

/**
 * The public face of an institution-recorded contribution: its reference and
 * state only. The contribution ID, institution and contact stay behind OTP.
 */
function toPublicInstitutionContribution(
  reference: string,
  state: { status: ContributionStatus; receivedAt: number }
): PublicContribution {
  const receivedAt = new Date(state.receivedAt * 1000).toISOString();
  return {
    trxId: reference,
    recordKind: "INSTITUTION_CONTRIBUTION",
    status: state.status,
    recordedAt: receivedAt,
    paidAt: state.status === "REJECTED" ? null : receivedAt,
    batch: null,
    membershipProof: null,
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

    // Institution-recorded contributions (#102) live in the workspace database.
    const state = await workspaceRuntime()?.donorAccess?.publicState(trxId);
    if (state) {
      return { lookupStatus: "FOUND", contribution: toPublicInstitutionContribution(trxId, state) };
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

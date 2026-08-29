import { type Hex } from "viem";
import { type DonationRecord, MerkleTree, computeDonationLeaf } from "./merkle";

export interface SettledBatch {
  batchId: number;
  merkleRoot: Hex;
  totalAmountIDR: number;
  itemCount: number;
  settledAt: string;
  txHash?: string;
}

export interface ProposalRecord {
  proposalId: number;
  currencyType: 0 | 1; // 0 = IDR, 1 = USDC
  amount: number;
  asnafCategory: number; // 0=Fakir, 1=Miskin, 2=Amil, 3=Mualaf, 4=Riqab, 5=Gharimin, 6=Fisabilillah, 7=Ibnu Sabil
  asnafLabel: string;
  beneficiaryName: string;
  beneficiaryNIKMasked: string;
  beneficiaryHash: Hex;
  ipfsProofCID: string;
  disbursementReceiptCID?: string;
  periodId: number;
  usdcRecipient?: string;
  approvalCount: number;
  approvedBy: string[];
  status: "Pending" | "Approved" | "Executed" | "Cancelled";
  cancelReason?: string;
  txHash?: string;
  // Ex-Post Auditor Attestation (Ticket #33)
  auditStatus?: "PENDING" | "AUDITED_WTP" | "DISPUTED";
  auditorAddress?: string;
  auditorName?: string;
  auditReportCID?: string;
  auditOpinion?: "WTP" | "WDP" | "DISPUTED" | "CLEAN";
  auditNotes?: string;
  auditedAt?: string;
  auditTxHash?: string;
}

class ProtocolDataStore {
  public donations: Map<string, DonationRecord & { batchId?: number }> = new Map();
  public batches: Map<number, SettledBatch> = new Map();
  public batchTrees: Map<number, MerkleTree> = new Map();
  public proposals: Map<number, ProposalRecord> = new Map();

  constructor() {}

  public recordDonation(donation: DonationRecord, batchId?: number) {
    this.donations.set(donation.trxId, {
      status: "PENDING",
      ...donation,
      batchId,
    });
  }

  public getDonation(trxId: string) {
    return this.donations.get(trxId) || null;
  }

  public updateDonationStatus(trxId: string, status: "PENDING" | "PAID" | "BATCHED", paidAt?: string) {
    const existing = this.donations.get(trxId);
    if (existing) {
      existing.status = status;
      if (paidAt) {
        existing.paidAt = paidAt;
      }
      this.donations.set(trxId, existing);
      return existing;
    }
    return null;
  }

  public settleBatch(batchId: number, donationList: DonationRecord[], txHash?: string): SettledBatch {
    const leaves = donationList.map((d) => computeDonationLeaf(d.trxId, d.salt, d.amountIDR));
    const tree = new MerkleTree(leaves);
    const root = tree.getRoot();
    const totalAmount = donationList.reduce((acc, d) => acc + d.amountIDR, 0);

    const batch: SettledBatch = {
      batchId,
      merkleRoot: root,
      totalAmountIDR: totalAmount,
      itemCount: donationList.length,
      settledAt: new Date().toISOString(),
      txHash,
    };

    this.batches.set(batchId, batch);
    this.batchTrees.set(batchId, tree);

    for (const d of donationList) {
      this.donations.set(d.trxId, { ...d, batchId });
    }

    return batch;
  }

  public getProofForTrx(trxId: string, salt: string, amountIDR: number) {
    const record = this.donations.get(trxId);
    if (!record || record.batchId === undefined) {
      return null;
    }

    const batch = this.batches.get(record.batchId);
    const tree = this.batchTrees.get(record.batchId);
    if (!batch || !tree) {
      return null;
    }

    const leaf = computeDonationLeaf(trxId, salt, amountIDR);
    const leafIndex = tree.leaves.findIndex((l) => l.toLowerCase() === leaf.toLowerCase());

    if (leafIndex === -1) {
      return null;
    }

    const proof = tree.getProof(leafIndex);
    return {
      batchId: record.batchId,
      merkleRoot: batch.merkleRoot,
      leaf,
      proof,
      isValid: MerkleTree.verifyProof(leaf, proof, batch.merkleRoot),
    };
  }
}

export const dataStore = new ProtocolDataStore();

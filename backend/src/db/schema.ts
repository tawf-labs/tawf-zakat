import { pgTable, serial, text, integer, bigint, boolean, timestamp } from "drizzle-orm/pg-core";

// 1. Merkle Batches Table
export const merkleBatches = pgTable("merkle_batches", {
  id: serial("id").primaryKey(),
  batchNumber: integer("batch_number").notNull().unique(),
  merkleRoot: text("merkle_root").notNull(),
  totalAmountIDR: bigint("total_amount_idr", { mode: "number" }).notNull(),
  itemCount: integer("item_count").notNull(),
  txHash: text("tx_hash"),
  status: text("status").notNull().default("pending"), // 'pending' | 'settled_onchain'
  settledAt: timestamp("settled_at").defaultNow(),
});

// 2. Donations Table
export const donations = pgTable("donations", {
  id: serial("id").primaryKey(),
  trxId: text("trx_id").notNull().unique(),
  donorName: text("donor_name").notNull(),
  isAnonymous: boolean("is_anonymous").notNull().default(false),
  amountIDR: bigint("amount_idr", { mode: "number" }).notNull(),
  salt: text("salt").notNull(),
  status: text("status").notNull().default("PENDING"), // 'PENDING' | 'PAID' | 'BATCHED'
  paymentMethod: text("payment_method").notNull().default("QRIS"),
  qrString: text("qr_string"),
  qrUrl: text("qr_url"),
  batchId: integer("batch_id"),
  createdAt: timestamp("created_at").defaultNow(),
  paidAt: timestamp("paid_at"),
});

// 3. Disbursement Proposals Table
export const disbursementProposals = pgTable("disbursement_proposals", {
  id: serial("id").primaryKey(),
  proposalIdOnChain: integer("proposal_id_on_chain").notNull(),
  currencyType: integer("currency_type").notNull().default(0), // 0: IDR, 1: USDC
  amount: bigint("amount", { mode: "number" }).notNull(),
  asnafCategory: text("asnaf_category").notNull(),
  beneficiaryName: text("beneficiary_name").notNull(),
  beneficiaryNIKMasked: text("beneficiary_nik_masked").notNull(),
  beneficiaryHash: text("beneficiary_hash").notNull(),
  ipfsProofCID: text("ipfs_proof_cid").notNull(),
  periodId: integer("period_id").notNull(),
  status: text("status").notNull().default("Pending"), // 'Pending' | 'Approved' | 'Executed' | 'Cancelled'
  cancelReason: text("cancel_reason"),
  approvalCount: integer("approval_count").notNull().default(1),
  approvedBy: text("approved_by").notNull().default('["Amil Internal"]'), // JSON string array
  createdAt: timestamp("created_at").defaultNow(),
  executedAt: timestamp("executed_at"),
});

export type MerkleBatch = typeof merkleBatches.$inferSelect;
export type NewMerkleBatch = typeof merkleBatches.$inferInsert;

export type Donation = typeof donations.$inferSelect;
export type NewDonation = typeof donations.$inferInsert;

export type DisbursementProposal = typeof disbursementProposals.$inferSelect;
export type NewDisbursementProposal = typeof disbursementProposals.$inferInsert;

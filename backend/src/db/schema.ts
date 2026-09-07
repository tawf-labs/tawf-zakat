import { pgTable, serial, text, integer, bigint, boolean, timestamp } from "drizzle-orm/pg-core";

// 1. Merkle Batches Table
export const merkleBatches = pgTable("merkle_batches", {
  id: serial("id").primaryKey(),
  batchNumber: integer("batch_number").notNull().unique(),
  merkleRoot: text("merkle_root").notNull(),
  totalAmountIDR: bigint("total_amount_idr", { mode: "number" }).notNull(),
  // Historical onchain batches do not expose their donation count.
  itemCount: integer("item_count"),
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
  proposalIdOnChain: integer("proposal_id_on_chain").notNull().unique(),
  currencyType: integer("currency_type").notNull().default(0), // 0: IDR, 1: USDC
  amount: bigint("amount", { mode: "number" }).notNull(),
  asnafCategory: text("asnaf_category").notNull(),
  beneficiaryName: text("beneficiary_name").notNull(),
  beneficiaryNIKMasked: text("beneficiary_nik_masked").notNull(),
  beneficiaryHash: text("beneficiary_hash").notNull(),
  ipfsProofCID: text("ipfs_proof_cid").notNull(),
  disbursementReceiptCID: text("disbursement_receipt_cid"),
  periodId: integer("period_id").notNull(),
  status: text("status").notNull().default("Pending"), // 'Pending' | 'Approved' | 'Executed' | 'Cancelled'
  cancelReason: text("cancel_reason"),
  approvalCount: integer("approval_count").notNull().default(1),
  approvedBy: text("approved_by").notNull().default('["Amil Internal"]'), // JSON string array
  txHash: text("tx_hash"),
  // Ex-Post Auditor Attestation (Ticket #33)
  auditStatus: text("audit_status").notNull().default("PENDING"), // 'PENDING' | 'AUDITED_WTP' | 'DISPUTED'
  auditorAddress: text("auditor_address"),
  auditorName: text("auditor_name"),
  auditReportCID: text("audit_report_cid"),
  auditOpinion: text("audit_opinion"), // 'WTP' | 'WDP' | 'DISPUTED' | 'CLEAN'
  auditNotes: text("audit_notes"),
  auditedAt: timestamp("audited_at"),
  auditTxHash: text("audit_tx_hash"),
  laiDocumentCID: text("lai_document_cid"),
  financialStatementsCID: text("financial_statements_cid"),
  // Safe.global Multi-Sig Queue Tracking
  safeStatus: text("safe_status").default("IDLE"), // 'IDLE' | 'PENDING_SAFE_SIGNATURES' | 'EXECUTED_ONCHAIN'
  safeConfirmationsCount: integer("safe_confirmations_count").default(0),
  safeConfirmationsRequired: integer("safe_confirmations_required").default(2),
  createdAt: timestamp("created_at").defaultNow(),
  executedAt: timestamp("executed_at"),
});

// 4. Indexer State Checkpoint Table
export const indexerState = pgTable("indexer_state", {
  id: serial("id").primaryKey(),
  indexerKey: text("indexer_key").notNull().unique().default("sepolia_zakat_l1"),
  lastIndexedBlock: integer("last_indexed_block").notNull().default(11569000),
  lastSyncAt: timestamp("last_sync_at").defaultNow(),
  status: text("status").notNull().default("SYNCING"), // 'SYNCING' | 'SYNCED' | 'ERROR'
  totalEventsIndexed: integer("total_events_indexed").notNull().default(0),
});

// 5. On-Chain Events Immutable Audit Log Table
export const onchainEvents = pgTable("onchain_events", {
  id: serial("id").primaryKey(),
  txHash: text("tx_hash").notNull(),
  blockNumber: integer("block_number").notNull(),
  logIndex: integer("log_index").notNull().default(0),
  eventName: text("event_name").notNull(),
  contractAddress: text("contract_address").notNull(),
  argsJson: text("args_json").notNull(), // JSON serialized event args
  createdAt: timestamp("created_at").defaultNow(),
});

// 6. Role Members Registry Table
export const roleMembers = pgTable("role_members", {
  id: serial("id").primaryKey(),
  roleHash: text("role_hash").notNull(),
  roleName: text("role_name").notNull(), // 'DEFAULT_ADMIN_ROLE' | 'SHARIA_SUPERVISOR_ROLE' | 'AUDITOR_ROLE' | 'RELAYER_ROLE'
  accountAddress: text("account_address").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  grantedAtBlock: integer("granted_at_block"),
  revokedAtBlock: integer("revoked_at_block"),
  txHash: text("tx_hash"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type MerkleBatch = typeof merkleBatches.$inferSelect;
export type NewMerkleBatch = typeof merkleBatches.$inferInsert;

export type Donation = typeof donations.$inferSelect;
export type NewDonation = typeof donations.$inferInsert;

export type DisbursementProposal = typeof disbursementProposals.$inferSelect;
export type NewDisbursementProposal = typeof disbursementProposals.$inferInsert;

export type IndexerState = typeof indexerState.$inferSelect;
export type NewIndexerState = typeof indexerState.$inferInsert;

export type OnchainEvent = typeof onchainEvents.$inferSelect;
export type NewOnchainEvent = typeof onchainEvents.$inferInsert;

export type RoleMember = typeof roleMembers.$inferSelect;
export type NewRoleMember = typeof roleMembers.$inferInsert;

// 7. Auditor Identity Registry Table
// One-time onboarding record per KAP/auditor wallet — the single source of truth
// for the human-readable identity behind an AUDITOR_ROLE address. Attestations
// pull auditorName/licenseProofCID from here instead of accepting free-typed input.
export const auditorProfiles = pgTable("auditor_profiles", {
  id: serial("id").primaryKey(),
  accountAddress: text("account_address").notNull().unique(),
  name: text("name").notNull(),
  kapLicenseNumber: text("kap_license_number").notNull(),
  licenseProofCID: text("license_proof_cid").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  registeredBy: text("registered_by").notNull(),
  registeredAt: timestamp("registered_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type AuditorProfile = typeof auditorProfiles.$inferSelect;
export type NewAuditorProfile = typeof auditorProfiles.$inferInsert;

// 8. Institutional Workspace Tenancy (Spec #68, ticket #69)
// Declared here so `drizzle-kit` knows these tables are managed rather than
// stray. The runtime creates them from `WORKSPACE_SCHEMA_STATEMENTS` in
// `../tenancy-store.ts`, which is idempotent and additive; that file remains
// the source of truth for the constraints Drizzle cannot express here — the
// partial unique index on one active membership per account, and the composite
// foreign key that stops a cross-institution session being stored at all.
export const institutions = pgTable("institutions", {
  id: text("id").primaryKey(),
  legalName: text("legal_name").notNull(),
  scopeUnit: text("scope_unit").notNull(),
  scopeLevel: text("scope_level").notNull(),
  mandateNote: text("mandate_note").notNull(),
  // Fixture institutions carry the label in the row, not only in a comment.
  isSynthetic: boolean("is_synthetic").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const institutionMemberships = pgTable("institution_memberships", {
  id: serial("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  accountAddress: text("account_address").notNull(),
  role: text("role").notNull(), // 'ADMIN' | 'OFFICER' | 'READER'
  // Deactivated rows are kept: rotation preserves history, it does not delete it.
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workspaceChallenges = pgTable("workspace_challenges", {
  nonce: text("nonce").primaryKey(),
  institutionId: text("institution_id").notNull(),
  accountAddress: text("account_address").notNull(),
  purpose: text("purpose").notNull(),
  issuedAt: bigint("issued_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  consumedAt: bigint("consumed_at", { mode: "number" }),
});

export const workspaceSessions = pgTable("workspace_sessions", {
  // The SHA-256 of the bearer token. The token itself is never stored.
  tokenHash: text("token_hash").primaryKey(),
  institutionId: text("institution_id").notNull(),
  accountAddress: text("account_address").notNull(),
  role: text("role").notNull(),
  issuedAt: bigint("issued_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  revokedAt: bigint("revoked_at", { mode: "number" }),
});

// 9. Period Evidence Preparations (Spec #68, ticket #70)
// Declared here so `drizzle-kit` knows these tables are managed. The runtime
// creates them from `EVIDENCE_SCHEMA_STATEMENTS` in `../evidence-store.ts`,
// which stays the source of truth for the CHECK constraints Drizzle cannot
// express here - the ones that stop an unread source holding rows, and stop a
// file row claiming to be both stored and failed.
export const evidencePreparations = pgTable("evidence_preparations", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull(),
  preparedBy: text("prepared_by").notNull(),
  label: text("label").notNull(),
  periodKind: text("period_kind").notNull(),
  periodYear: integer("period_year").notNull(),
  currencyUnit: text("currency_unit").notNull(), // 'IDR' | 'USDC_6DP'
  outcome: text("outcome").notNull(), // 'RECONCILED' | 'INCOMPLETE'
  commitment: text("commitment").notNull(),
  commitmentScheme: text("commitment_scheme").notNull(),
  // Restricted: what an authorised reader verifies the commitment with, and
  // what stops anyone else guessing a low-entropy source from it.
  commitmentSalt: text("commitment_salt").notNull(),
  canonicalSnapshot: text("canonical_snapshot").notNull(),
  resultJson: text("result_json"),
  publicSummaryJson: text("public_summary_json").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const evidenceSources = pgTable("evidence_sources", {
  preparationId: text("preparation_id").notNull(),
  role: text("role").notNull(), // 'CLAIM' | 'SOURCE'
  status: text("status").notNull(), // 'READ' | 'MISSING' | 'FAILED'
  detail: text("detail"),
  manifestJson: text("manifest_json").notNull(),
  rowsJson: text("rows_json").notNull(),
  rowCount: integer("row_count").notNull(),
});

export const evidenceFindings = pgTable("evidence_findings", {
  preparationId: text("preparation_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  kind: text("kind").notNull(),
  entryKey: text("entry_key").notNull(),
  bucket: text("bucket").notNull(),
  deltaAmount: text("delta_amount").notNull(),
  deltaUnit: text("delta_unit").notNull(),
  claimAmount: text("claim_amount"),
  sourceAmount: text("source_amount"),
  label: text("label"),
});

export const evidenceFiles = pgTable("evidence_files", {
  id: text("id").primaryKey(),
  preparationId: text("preparation_id").notNull(),
  institutionId: text("institution_id").notNull(),
  role: text("role").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  contentSha256: text("content_sha256"),
  storageStatus: text("storage_status").notNull(), // 'STORED' | 'FAILED'
  // The private locator. Never leaves the deployment.
  storageRef: text("storage_ref"),
  failureReason: text("failure_reason"),
});

export type EvidencePreparation = typeof evidencePreparations.$inferSelect;
export type EvidenceSource = typeof evidenceSources.$inferSelect;
export type EvidenceFinding = typeof evidenceFindings.$inferSelect;
export type EvidenceFile = typeof evidenceFiles.$inferSelect;

export type Institution = typeof institutions.$inferSelect;
export type NewInstitution = typeof institutions.$inferInsert;

export type InstitutionMembership = typeof institutionMemberships.$inferSelect;
export type NewInstitutionMembership = typeof institutionMemberships.$inferInsert;

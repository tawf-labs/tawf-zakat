import { pgTable, primaryKey, serial, text, integer, bigint, boolean, timestamp } from "drizzle-orm/pg-core";

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
  // USDC deposit identity and native amount (ticket #67). Nullable because a
  // fiat donation has none and a legacy USDC row never captured one; the columns
  // are added by an explicit migration, not at boot. Text rather than bigint:
  // the driver hands a bigint column back as a JavaScript number, and a deposit
  // amount must survive past 2^53 minor units intact.
  amountUsdc6dp: text("amount_usdc_6dp"),
  depositChainId: integer("deposit_chain_id"),
  depositContract: text("deposit_contract"),
  depositTxHash: text("deposit_tx_hash"),
  depositLogIndex: integer("deposit_log_index"),
});

// 3. Disbursement Proposals Table
export const disbursementProposals = pgTable("disbursement_proposals", {
  id: serial("id").primaryKey(),
  proposalIdOnChain: integer("proposal_id_on_chain").notNull().unique(),
  currencyType: integer("currency_type").notNull().default(0), // 0: IDR, 1: USDC
  amount: bigint("amount", { mode: "number" }).notNull(),
  // The same amount, exactly, in the unit `currencyType` names (ticket #80).
  // Text rather than bigint: the driver returns a bigint column as a JavaScript
  // number, which is why the chain reader has to refuse anything past 2^53.
  amountExact: text("amount_exact"),
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

export const officerProfiles = pgTable("officer_profiles", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  displayName: text("display_name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type OfficerProfileRow = typeof officerProfiles.$inferSelect;
export type NewOfficerProfileRow = typeof officerProfiles.$inferInsert;

export const institutionMemberships = pgTable("institution_memberships", {
  id: serial("id").primaryKey(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  accountAddress: text("account_address").notNull(),
  role: text("role").notNull(), // 'ADMIN' | 'OFFICER' | 'READER'
  officerId: text("officer_id").references(() => officerProfiles.id),
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

export const evidenceDrafts = pgTable("evidence_drafts", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  createdBy: text("created_by").notNull(),
  label: text("label").notNull(),
  periodKind: text("period_kind").notNull(),
  periodYear: integer("period_year").notNull(),
  currencyUnit: text("currency_unit").notNull(),
  balanceSheetScope: text("balance_sheet_scope").notNull(),
  tolerance: text("tolerance"),
  claimDataJson: text("claim_data_json").notNull(),
  sourceDataJson: text("source_data_json").notNull(),
  filesJson: text("files_json").notNull().default("[]"),
  issuesJson: text("issues_json").notNull().default("[]"),
  version: integer("version").notNull().default(1),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export type EvidenceDraft = typeof evidenceDrafts.$inferSelect;
export type NewEvidenceDraft = typeof evidenceDrafts.$inferInsert;

export type Institution = typeof institutions.$inferSelect;
export type NewInstitution = typeof institutions.$inferInsert;

export type InstitutionMembership = typeof institutionMemberships.$inferSelect;
export type NewInstitutionMembership = typeof institutionMemberships.$inferInsert;

// 10. Program bantuan and Pengajuan drafts (Spec #86, ticket #89)
// Declared here so `drizzle-kit` knows these tables are managed. The runtime
// creates them from `DISBURSEMENT_SCHEMA_STATEMENTS` in `../disbursement-store.ts`,
// which stays the source of truth.
export const programs = pgTable("programs", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  name: text("name").notNull(),
  purpose: text("purpose").notNull(),
  fundType: text("fund_type").notNull(),
  scope: text("scope").notNull(),
  referenceCeiling: text("reference_ceiling"),
  status: text("status").notNull().default("ACTIVE"), // 'ACTIVE' | 'ARCHIVED'
  createdBy: text("created_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const proposalDrafts = pgTable("proposal_drafts", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  programId: text("program_id").references(() => programs.id),
  createdBy: text("created_by").notNull(),
  originOfRequest: text("origin_of_request").notNull().default(""),
  purpose: text("purpose").notNull().default(""),
  aidPeriodJson: text("aid_period_json"),
  personInCharge: text("person_in_charge").notNull().default(""),
  beneficiariesJson: text("beneficiaries_json").notNull().default("[]"),
  aidLinesJson: text("aid_lines_json").notNull().default("[]"),
  issuesJson: text("issues_json").notNull().default("[]"),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("DRAFT"),
  submittedAt: bigint("submitted_at", { mode: "number" }),
  submittedBy: text("submitted_by"),
  examinedAt: bigint("examined_at", { mode: "number" }),
  examinedBy: text("examined_by"),
  examinationNotes: text("examination_notes"),
  examinationChecklistJson: text("examination_checklist_json"),
  revisionReason: text("revision_reason"),
  withdrawalReason: text("withdrawal_reason"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export type ProgramRow = typeof programs.$inferSelect;
export type NewProgramRow = typeof programs.$inferInsert;

export type ProposalDraftRow = typeof proposalDrafts.$inferSelect;
export type NewProposalDraftRow = typeof proposalDrafts.$inferInsert;


export const proposalDraftOperations = pgTable("proposal_draft_operations", {
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  account: text("account").notNull(),
  operationId: text("operation_id").notNull(),
  requestHash: text("request_hash").notNull(),
  resultJson: text("result_json"),
}, table => [primaryKey({ columns: [table.institutionId, table.account, table.operationId] })]);

// 11. Operational Mandates and Institutional Endorsement Accounts (Spec #86, ticket #90)
export const operationalMandates = pgTable("operational_mandates", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  officerId: text("officer_id").notNull().references(() => officerProfiles.id),
  accountAddress: text("account_address"),
  function: text("function").notNull(),
  scopeType: text("scope_type").notNull(),
  programId: text("program_id").references(() => programs.id),
  validFrom: bigint("valid_from", { mode: "number" }).notNull(),
  validUntil: bigint("valid_until", { mode: "number" }).notNull(),
  assignmentRef: text("assignment_ref").notNull(),
  nominalLimit: text("nominal_limit"),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  createdBy: text("created_by").notNull(),
});

export const institutionalEndorsementAccounts = pgTable("institutional_endorsement_accounts", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  accountAddress: text("account_address").notNull(),
  label: text("label").notNull(),
  authorizedOfficerIds: text("authorized_officer_ids").notNull().default("[]"),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  createdBy: text("created_by").notNull(),
});

export type OperationalMandateRow = typeof operationalMandates.$inferSelect;
export type NewOperationalMandateRow = typeof operationalMandates.$inferInsert;

export type InstitutionalEndorsementAccountRow = typeof institutionalEndorsementAccounts.$inferSelect;
export type NewInstitutionalEndorsementAccountRow = typeof institutionalEndorsementAccounts.$inferInsert;


export const proposalDraftContributors = pgTable("proposal_draft_contributors", {
  draftId: text("draft_id").notNull().references(() => proposalDrafts.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  account: text("account").notNull(),
  officerId: text("officer_id").references(() => officerProfiles.id),
}, table => [primaryKey({ columns: [table.draftId, table.version, table.account] })]);

// 12. Proposal Documents, Versions, and History (Spec #86, ticket #91)
export const proposalDocuments = pgTable("proposal_documents", {
  id: text("id").primaryKey(),
  proposalId: text("proposal_id").notNull().references(() => proposalDrafts.id, { onDelete: "cascade" }),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  beneficiaryId: text("beneficiary_id"),
  category: text("category").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  contentSha256: text("content_sha256").notNull(),
  storageStatus: text("storage_status").notNull(),
  storageRef: text("storage_ref"),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const proposalVersions = pgTable("proposal_versions", {
  proposalId: text("proposal_id").notNull().references(() => proposalDrafts.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  status: text("status").notNull(),
  dataJson: text("data_json").notNull(),
  documentsJson: text("documents_json").notNull().default("[]"),
  recurringWarningsJson: text("recurring_warnings_json").notNull().default("[]"),
  submittedBy: text("submitted_by"),
  submittedAt: bigint("submitted_at", { mode: "number" }),
  examinationJson: text("examination_json"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
}, table => [primaryKey({ columns: [table.proposalId, table.version] })]);

export const proposalHistory = pgTable("proposal_history", {
  id: serial("id").primaryKey(),
  proposalId: text("proposal_id").notNull().references(() => proposalDrafts.id, { onDelete: "cascade" }),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  version: integer("version").notNull(),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  action: text("action").notNull(),
  actorAccount: text("actor_account").notNull(),
  actorOfficerId: text("actor_officer_id").references(() => officerProfiles.id),
  reason: text("reason"),
  notes: text("notes"),
  occurredAt: bigint("occurred_at", { mode: "number" }).notNull(),
});

export const institutionDisbursementPolicies = pgTable("institution_disbursement_policies", {
  institutionId: text("institution_id").primaryKey().references(() => institutions.id),
  requireProposalLetter: boolean("require_proposal_letter").notNull().default(true),
  requireIdentityDoc: boolean("require_identity_doc").notNull().default(true),
  requireAlternativeIdProof: boolean("require_alternative_id_proof").notNull().default(true),
  requireGuardianProof: boolean("require_guardian_proof").notNull().default(true),
  warnRecurringAid: boolean("warn_recurring_aid").notNull().default(true),
  sopRequiresMultiSignerQuorum: boolean("sop_requires_multi_signer_quorum").notNull().default(false),
  version: integer("version").notNull().default(1),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  updatedBy: text("updated_by").notNull(),
});

// Ticket #93: institutional decisions and their single-use signing challenges
export const proposalDecisions = pgTable("proposal_decisions", {
  id: text("id").primaryKey(),
  proposalId: text("proposal_id").notNull().references(() => proposalDrafts.id, { onDelete: "cascade" }),
  proposalVersion: integer("proposal_version").notNull(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  action: text("action").notNull(), // 'APPROVE' | 'REJECT'
  decisionReference: text("decision_reference").notNull(),
  decisionDate: text("decision_date").notNull(),
  decisionDocumentId: text("decision_document_id").notNull(),
  decisionDocumentSha256: text("decision_document_sha256").notNull(),
  notes: text("notes"),
  rejectionReason: text("rejection_reason"),
  rightsDigest: text("rights_digest").notNull(),
  operatorOfficerId: text("operator_officer_id").notNull().references(() => officerProfiles.id),
  operatorAccount: text("operator_account").notNull(),
  signerAccount: text("signer_account").notNull(),
  mandateId: text("mandate_id").notNull().references(() => operationalMandates.id),
  signature: text("signature").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const proposalDecisionDocuments = pgTable("proposal_decision_documents", {
  id: text("id").primaryKey(),
  proposalId: text("proposal_id").notNull().references(() => proposalDrafts.id, { onDelete: "cascade" }),
  proposalVersion: integer("proposal_version").notNull(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  contentSha256: text("content_sha256").notNull(),
  storageRef: text("storage_ref").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const proposalDecisionChallenges = pgTable("proposal_decision_challenges", {
  nonce: text("nonce").primaryKey(),
  proposalId: text("proposal_id").notNull(),
  proposalVersion: integer("proposal_version").notNull(),
  institutionId: text("institution_id").notNull(),
  operatorOfficerId: text("operator_officer_id").notNull(),
  operatorAccount: text("operator_account").notNull(),
  signerAccount: text("signer_account").notNull(),
  action: text("action").notNull(),
  rightsDigest: text("rights_digest").notNull(),
  decisionReference: text("decision_reference").notNull(),
  decisionDate: text("decision_date").notNull(),
  decisionDocumentId: text("decision_document_id").notNull(),
  decisionDocumentSha256: text("decision_document_sha256").notNull(),
  mandateId: text("mandate_id").notNull(),
  mandateValidUntil: bigint("mandate_valid_until", { mode: "number" }).notNull(),
  issuedAt: bigint("issued_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  consumedAt: bigint("consumed_at", { mode: "number" }),
});

export type ProposalDocumentRow = typeof proposalDocuments.$inferSelect;
export type ProposalVersionRow = typeof proposalVersions.$inferSelect;
export type ProposalHistoryRow = typeof proposalHistory.$inferSelect;
export type InstitutionDisbursementPolicyRow = typeof institutionDisbursementPolicies.$inferSelect;
export type ProposalDecisionRow = typeof proposalDecisions.$inferSelect;
export type NewProposalDecisionRow = typeof proposalDecisions.$inferInsert;
export type ProposalDecisionChallengeRow = typeof proposalDecisionChallenges.$inferSelect;
export type NewProposalDecisionChallengeRow = typeof proposalDecisionChallenges.$inferInsert;

// 13. Contributions and Tabular Imports (Spec #100, Ticket #102)
export const contributions = pgTable("contributions", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  sourceChannel: text("source_channel").notNull(), // 'BANK_TRANSFER' | 'QRIS' | 'CASH' | 'CRYPTO_USDC' | 'DIRECT' | 'OTHER'
  sourceReference: text("source_reference").notNull(),
  currencyUnit: text("currency_unit").notNull(), // 'IDR' | 'USDC_6DP'
  amountExact: text("amount_exact").notNull(), // exact integer string
  fundType: text("fund_type").notNull(), // JENIS_DANA: 'ZAKAT' | 'FITRAH' | 'INFAK_SEDEKAH' | 'KURBAN' | 'DSKL'
  purpose: text("purpose").notNull().default(""),
  receivedAt: bigint("received_at", { mode: "number" }).notNull(),
  donorName: text("donor_name"),
  donorContact: text("donor_contact"),
  status: text("status").notNull().default("RECEIVED"), // 'RECEIVED' | 'RECONCILED' | 'ENDORSED' | 'REJECTED'
  reconciledAt: bigint("reconciled_at", { mode: "number" }),
  reconciledBy: text("reconciled_by"),
  reconciliationProofRef: text("reconciliation_proof_ref"),
  reconciliationNotes: text("reconciliation_notes"),
  endorsedAt: bigint("endorsed_at", { mode: "number" }),
  endorsedBy: text("endorsed_by"),
  endorsementMandateId: text("endorsement_mandate_id"),
  endorsementNotes: text("endorsement_notes"),
  unqualifiedReason: text("unqualified_reason"),
  version: integer("version").notNull().default(1),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  createdBy: text("created_by").notNull(),
});

export const contributionHistory = pgTable("contribution_history", {
  id: serial("id").primaryKey(),
  contributionId: text("contribution_id").notNull().references(() => contributions.id, { onDelete: "cascade" }),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  version: integer("version").notNull(),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  action: text("action").notNull(),
  actorAccount: text("actor_account").notNull(),
  actorOfficerId: text("actor_officer_id").references(() => officerProfiles.id),
  reason: text("reason"),
  notes: text("notes"),
  occurredAt: bigint("occurred_at", { mode: "number" }).notNull(),
});

export const contributionOperations = pgTable("contribution_operations", {
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  account: text("account").notNull(),
  operationId: text("operation_id").notNull(),
  requestHash: text("request_hash").notNull(),
  resultJson: text("result_json"),
}, table => [primaryKey({ columns: [table.institutionId, table.account, table.operationId] })]);

export const contributionImportDrafts = pgTable("contribution_import_drafts", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  createdBy: text("created_by").notNull(),
  fileName: text("file_name").notNull(),
  currencyUnit: text("currency_unit").notNull(),
  rawRowsCount: integer("raw_rows_count").notNull(),
  validRowsCount: integer("valid_rows_count").notNull(),
  invalidRowsCount: integer("invalid_rows_count").notNull(),
  totalValidAmount: text("total_valid_amount").notNull(),
  rowsJson: text("rows_json").notNull().default("[]"),
  issuesJson: text("issues_json").notNull().default("[]"),
  status: text("status").notNull().default("DRAFT"), // 'DRAFT' | 'COMMITTED' | 'DISCARDED'
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const contributionDocuments = pgTable("contribution_documents", {
  id: text("id").primaryKey(),
  contributionId: text("contribution_id").references(() => contributions.id, { onDelete: "cascade" }),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  category: text("category").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  contentSha256: text("content_sha256").notNull(),
  storageStatus: text("storage_status").notNull(),
  storageRef: text("storage_ref"),
  createdBy: text("created_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export type ContributionRow = typeof contributions.$inferSelect;
export type NewContributionRow = typeof contributions.$inferInsert;

export type ContributionHistoryRow = typeof contributionHistory.$inferSelect;
export type NewContributionHistoryRow = typeof contributionHistory.$inferInsert;

export type ContributionImportDraftRow = typeof contributionImportDrafts.$inferSelect;
export type NewContributionImportDraftRow = typeof contributionImportDrafts.$inferInsert;

export type ContributionDocumentRow = typeof contributionDocuments.$inferSelect;
export type NewContributionDocumentRow = typeof contributionDocuments.$inferInsert;

// 14. Distribution Activities and Allocations (Spec #100, Ticket #103)
// Mirrors ACTIVITY_SCHEMA_STATEMENTS in activity-store.ts, which is what creates them.
export const distributionActivities = pgTable("distribution_activities", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  proposalId: text("proposal_id").notNull().references(() => proposalDrafts.id),
  proposalVersion: integer("proposal_version").notNull(),
  programId: text("program_id").notNull().references(() => programs.id),
  programFundType: text("program_fund_type").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  targetAmount: text("target_amount").notNull(),
  targetIsPartial: boolean("target_is_partial").notNull(),
  currencyUnit: text("currency_unit").notNull().default("IDR"),
  status: text("status").notNull().default("ACTIVE"), // 'ACTIVE'
  version: integer("version").notNull().default(1),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  createdBy: text("created_by").notNull(),
});

export const contributionAllocations = pgTable("contribution_allocations", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  contributionId: text("contribution_id").notNull().references(() => contributions.id),
  activityId: text("activity_id").notNull().references(() => distributionActivities.id),
  currencyUnit: text("currency_unit").notNull(),
  amountExact: text("amount_exact").notNull(),
  fundType: text("fund_type").notNull(),
  purpose: text("purpose").notNull().default(""),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("ACTIVE"), // 'ACTIVE'
  allocatedAt: bigint("allocated_at", { mode: "number" }).notNull(),
  allocatedBy: text("allocated_by").notNull(),
  allocatedByOfficerId: text("allocated_by_officer_id").references(() => officerProfiles.id),
  contributionVersion: integer("contribution_version").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const allocationHistory = pgTable("allocation_history", {
  id: serial("id").primaryKey(),
  allocationId: text("allocation_id").notNull().references(() => contributionAllocations.id),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  contributionId: text("contribution_id").notNull().references(() => contributions.id),
  activityId: text("activity_id").notNull().references(() => distributionActivities.id),
  version: integer("version").notNull(),
  contributionVersion: integer("contribution_version").notNull(),
  action: text("action").notNull(), // 'ALLOCATE'
  actorAccount: text("actor_account").notNull(),
  actorOfficerId: text("actor_officer_id").references(() => officerProfiles.id),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  amountExact: text("amount_exact").notNull(),
  reason: text("reason").notNull(),
  occurredAt: bigint("occurred_at", { mode: "number" }).notNull(),
});

export const activityOperations = pgTable("activity_operations", {
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  account: text("account").notNull(),
  operationId: text("operation_id").notNull(),
  requestHash: text("request_hash").notNull(),
  resultJson: text("result_json"),
}, table => [primaryKey({ columns: [table.institutionId, table.account, table.operationId] })]);

export type DistributionActivityRow = typeof distributionActivities.$inferSelect;
export type NewDistributionActivityRow = typeof distributionActivities.$inferInsert;

export type ContributionAllocationRow = typeof contributionAllocations.$inferSelect;
export type NewContributionAllocationRow = typeof contributionAllocations.$inferInsert;

export type AllocationHistoryRow = typeof allocationHistory.$inferSelect;
export type NewAllocationHistoryRow = typeof allocationHistory.$inferInsert;

// 15. Disbursement Realization and Payment Evidence (Spec #86, Ticket #94)
// Append-only facts: nothing cascades on delete, and status changes bump `version`
// alongside a history row (document, allocation, challenge, examination).
export const disbursementRealizations = pgTable("disbursement_realizations", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  proposalId: text("proposal_id").notNull().references(() => proposalDrafts.id),
  proposalVersion: integer("proposal_version").notNull(),
  aidLineId: text("aid_line_id").notNull(),
  beneficiaryId: text("beneficiary_id").notNull(),
  batchGroupId: text("batch_group_id"),
  paymentRecipientJson: text("payment_recipient_json"),
  method: text("method").notNull(), // 'BANK_TRANSFER' | 'CASH' | 'GOODS_HANDOVER'
  amountIdr: text("amount_idr"),
  quantity: text("quantity"),
  unit: text("unit"),
  reportedAt: bigint("reported_at", { mode: "number" }).notNull(),
  recordedAt: bigint("recorded_at", { mode: "number" }).notNull(),
  operatorAccount: text("operator_account").notNull(),
  operatorOfficerId: text("operator_officer_id").notNull().references(() => officerProfiles.id),
  notes: text("notes"),
  evidenceStatus: text("evidence_status").notNull().default("EVIDENCE_PENDING"), // 'EVIDENCE_PENDING' | 'EVIDENCE_COMPLETE'
  confirmationStatus: text("confirmation_status").notNull().default("UNCONFIRMED"), // 'UNCONFIRMED' | 'CONFIRMED' | 'DISPUTED'
  confirmationMethod: text("confirmation_method"), // 'OTP' | 'BAST_EXAMINED'
  version: integer("version").notNull().default(1),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const disbursementRealizationDocuments = pgTable("disbursement_realization_documents", {
  id: text("id").primaryKey(),
  seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  proposalId: text("proposal_id").notNull().references(() => proposalDrafts.id),
  realizationId: text("realization_id").notNull().references(() => disbursementRealizations.id),
  batchGroupId: text("batch_group_id"),
  documentType: text("document_type").notNull(), // 'PAYMENT_PROOF' | 'RECEIPT_OR_BAST' | 'SUPPORTING_PHOTO'
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  contentSha256: text("content_sha256").notNull(),
  storageRef: text("storage_ref").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

/** The explicit per-realization amount a (group) document evidences. */
export const disbursementRealizationDocumentAllocations = pgTable("disbursement_realization_document_allocations", {
  documentId: text("document_id").notNull().references(() => disbursementRealizationDocuments.id),
  realizationId: text("realization_id").notNull().references(() => disbursementRealizations.id),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  amountIdr: text("amount_idr"),
  quantity: text("quantity"),
  unit: text("unit"),
}, table => [primaryKey({ columns: [table.documentId, table.realizationId] })]);

export const disbursementRealizationChallenges = pgTable("disbursement_realization_challenges", {
  nonce: text("nonce").primaryKey(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  proposalId: text("proposal_id").notNull().references(() => proposalDrafts.id),
  proposalVersion: integer("proposal_version").notNull(),
  realizationId: text("realization_id").notNull().references(() => disbursementRealizations.id),
  realizationVersion: integer("realization_version").notNull(),
  beneficiaryId: text("beneficiary_id").notNull(),
  contactHint: text("contact_hint").notNull(),
  confirmerJson: text("confirmer_json"),
  aidType: text("aid_type").notNull(),
  amountIdr: text("amount_idr"),
  quantity: text("quantity"),
  unit: text("unit"),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  issuedAt: bigint("issued_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  consumedAt: bigint("consumed_at", { mode: "number" }),
});

export const disbursementRealizationBastExaminations = pgTable("disbursement_realization_bast_examinations", {
  id: text("id").primaryKey(),
  realizationId: text("realization_id").notNull().references(() => disbursementRealizations.id),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  verifierOfficerId: text("verifier_officer_id").notNull().references(() => officerProfiles.id),
  verifierAccount: text("verifier_account").notNull(),
  notes: text("notes").notNull(),
  verifiedAt: bigint("verified_at", { mode: "number" }).notNull(),
});

export const disbursementRealizationDisputes = pgTable("disbursement_realization_disputes", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  proposalId: text("proposal_id").notNull().references(() => proposalDrafts.id),
  realizationId: text("realization_id").notNull().references(() => disbursementRealizations.id),
  aidLineId: text("aid_line_id").notNull(),
  complainantType: text("complainant_type").notNull(), // 'BENEFICIARY' | 'OFFICER' | 'AUDITOR'
  subject: text("subject").notNull(), // 'RECEIPT' | 'AMOUNT'
  reason: text("reason").notNull(),
  disputedAmountIdr: text("disputed_amount_idr"),
  disputedQuantity: text("disputed_quantity"),
  disputedUnit: text("disputed_unit"),
  status: text("status").notNull().default("OPEN"), // 'OPEN' | 'EXAMINED' | 'RESOLVED'
  recordedByOfficerId: text("recorded_by_officer_id").notNull().references(() => officerProfiles.id),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const disbursementRealizationDisputeExaminations = pgTable("disbursement_realization_dispute_examinations", {
  id: text("id").primaryKey(),
  seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
  disputeId: text("dispute_id").notNull().references(() => disbursementRealizationDisputes.id),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  outcome: text("outcome").notNull(), // 'EXAMINED' | 'RESOLVED'
  notes: text("notes").notNull(),
  examinerOfficerId: text("examiner_officer_id").notNull().references(() => officerProfiles.id),
  examinerAccount: text("examiner_account").notNull(),
  examinedAt: bigint("examined_at", { mode: "number" }).notNull(),
});

export const disbursementRealizationAdvances = pgTable("disbursement_realization_advances", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  proposalId: text("proposal_id").notNull().references(() => proposalDrafts.id),
  officerId: text("officer_id").notNull().references(() => officerProfiles.id),
  officerAccount: text("officer_account").notNull(),
  amountIdr: text("amount_idr").notNull(),
  purpose: text("purpose").notNull(),
  reference: text("reference").notNull(),
  issuedAt: bigint("issued_at", { mode: "number" }).notNull(),
});

export const disbursementRealizationExpenses = pgTable("disbursement_realization_expenses", {
  id: text("id").primaryKey(),
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  proposalId: text("proposal_id").notNull().references(() => proposalDrafts.id),
  advanceId: text("advance_id").references(() => disbursementRealizationAdvances.id),
  amountIdr: text("amount_idr").notNull(),
  purpose: text("purpose").notNull(),
  payee: text("payee").notNull(),
  documentRef: text("document_ref").notNull(),
  recordedByOfficerId: text("recorded_by_officer_id").notNull().references(() => officerProfiles.id),
  recordedAt: bigint("recorded_at", { mode: "number" }).notNull(),
});

export const disbursementRealizationOperations = pgTable("disbursement_realization_operations", {
  institutionId: text("institution_id").notNull().references(() => institutions.id),
  account: text("account").notNull(),
  operationId: text("operation_id").notNull(),
  requestHash: text("request_hash").notNull(),
  resultJson: text("result_json"),
}, table => [primaryKey({ columns: [table.institutionId, table.account, table.operationId] })]);

export type DisbursementRealizationRow = typeof disbursementRealizations.$inferSelect;
export type NewDisbursementRealizationRow = typeof disbursementRealizations.$inferInsert;

export type DisbursementRealizationDocumentRow = typeof disbursementRealizationDocuments.$inferSelect;
export type NewDisbursementRealizationDocumentRow = typeof disbursementRealizationDocuments.$inferInsert;

export type DisbursementRealizationChallengeRow = typeof disbursementRealizationChallenges.$inferSelect;
export type NewDisbursementRealizationChallengeRow = typeof disbursementRealizationChallenges.$inferInsert;

export type DisbursementRealizationDisputeRow = typeof disbursementRealizationDisputes.$inferSelect;
export type NewDisbursementRealizationDisputeRow = typeof disbursementRealizationDisputes.$inferInsert;

export type DisbursementRealizationAdvanceRow = typeof disbursementRealizationAdvances.$inferSelect;
export type NewDisbursementRealizationAdvanceRow = typeof disbursementRealizationAdvances.$inferInsert;

export type DisbursementRealizationExpenseRow = typeof disbursementRealizationExpenses.$inferSelect;
export type NewDisbursementRealizationExpenseRow = typeof disbursementRealizationExpenses.$inferInsert;

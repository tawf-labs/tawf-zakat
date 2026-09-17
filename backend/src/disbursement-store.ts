/** Durable institution-scoped programs and versioned proposal drafts.
 * Save/delete and their retry result commit together. A retry returns the original
 * result, even after later edits; a new operation must use the current version.
 */

import { sql } from "drizzle-orm";
import {
  DEFAULT_DISBURSEMENT_POLICY,
  evaluateRecurringAidWarnings,
  validateProposalForSubmission,
  type AidLine,
  type Beneficiary,
  type DisbursementPolicy,
  type ExaminationChecklist,
  type FundType,
  type ProgramRecord,
  type ProgramStatus,
  type ProposalCompletenessIssue,
  type DecisionBinding,
  type ProposalDecisionAction,
  type ProposalDecisionChallenge,
  type ProposalDecisionDocument,
  type ProposalDecisionInput,
  type ProposalDecisionRecord,
  type ProposalDocumentCategory,
  type ProposalDocumentRecord,
  type ProposalHistoryAction,
  type ProposalHistoryRecord,
  type ProposalIssue,
  type ProposalStatus,
  type RecurringAidMatch,
  type RecurringAidWarning,
} from "./disbursement";

export type DisbursementDatabase = {
  execute: (query: any) => Promise<any>;
  transaction: <T>(run: (tx: { execute: (query: any) => Promise<any> }) => Promise<T>) => Promise<T>;
};

export type StoredProposalDraft = {
  id: string;
  institutionId: string;
  programId: string | null;
  createdBy: string;
  originOfRequest: string;
  purpose: string;
  aidPeriod: { start: string; end: string } | null;
  personInCharge: string;
  beneficiaries: Beneficiary[];
  aidLines: AidLine[];
  issues: ProposalIssue[];
  version: number;
  status: ProposalStatus;
  submittedAt: number | null;
  submittedBy: string | null;
  examinedAt: number | null;
  examinedBy: string | null;
  examinationNotes: string | null;
  examinationChecklist: ExaminationChecklist | null;
  revisionReason: string | null;
  withdrawalReason: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ProposalDraftSummary = {
  id: string;
  programId: string | null;
  originOfRequest: string;
  purpose: string;
  beneficiaryCount: number;
  issueCount: number;
  version: number;
  status: ProposalStatus;
  submittedAt: number | null;
  examinedAt: number | null;
  updatedAt: number;
};

/**
 * Thrown when a save loses the optimistic-concurrency race: either the
 * `expectedVersion` is stale, or the id already belongs to another
 * institution. Both mean nothing was written, so nothing is reported saved.
 */
export class ProposalDraftConflictError extends Error {
  constructor(readonly draftId: string) {
    super(
      `Draf pengajuan "${draftId}" sudah diubah pihak lain sejak versi yang Anda muat, ` +
        `atau id tersebut sudah dipakai lembaga lain. Muat ulang draf sebelum menyimpan lagi.`
    );
    this.name = "ProposalDraftConflictError";
  }
}

export class ProposalStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalStateConflictError";
  }
}

export class ProposalSubmissionIncompleteError extends Error {
  constructor(readonly issues: ProposalCompletenessIssue[]) {
    super("Pengajuan belum lengkap atau belum memenuhi kebijakan dokumen lembaga.");
    this.name = "ProposalSubmissionIncompleteError";
  }
}

/** The challenge was spent - by a replay or by a concurrent submission - before this decision committed. */
export class DecisionChallengeSpentError extends Error {
  constructor() {
    super("Tantangan pengesahan sudah digunakan. Minta tantangan baru sebelum menandatangani ulang.");
    this.name = "DecisionChallengeSpentError";
  }
}

export type DraftOperation = { id: string; account: string; requestHash: string };
export type ProposalContributor = { account: string; officerId: string | null; version: number };

type DraftGuard = (draft: StoredProposalDraft) => void;
const materialContents = (draft: Pick<StoredProposalDraft, "programId" | "originOfRequest" | "purpose" | "aidPeriod" | "personInCharge" | "beneficiaries" | "aidLines">) => JSON.stringify([
  draft.programId, draft.originOfRequest, draft.purpose, draft.aidPeriod,
  draft.personInCharge, draft.beneficiaries, draft.aidLines,
]);

export class DraftOperationConflictError extends Error {
  constructor() {
    super("Identitas penyimpanan sudah digunakan untuk isi berbeda. Muat ulang draf sebelum melanjutkan.");
  }
}

/** The unique insert waits for an in-flight retry before reading its committed result. */
async function mutateOnce<T>(db: DisbursementDatabase, institutionId: string, operation: DraftOperation,
  mutate: (tx: { execute: (query: any) => Promise<any> }) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    const inserted = rowsOf(await tx.execute(sql`
      INSERT INTO proposal_draft_operations (institution_id, account, operation_id, request_hash)
      VALUES (${institutionId}, ${operation.account}, ${operation.id}, ${operation.requestHash})
      ON CONFLICT DO NOTHING RETURNING operation_id
    `));
    if (!inserted.length) {
      const previous = rowsOf(await tx.execute(sql`
        SELECT request_hash, result_json FROM proposal_draft_operations
        WHERE institution_id = ${institutionId} AND account = ${operation.account} AND operation_id = ${operation.id}
      `))[0];
      if (!previous || previous.request_hash !== operation.requestHash) throw new DraftOperationConflictError();
      return JSON.parse(previous.result_json) as T;
    }
    const result = await mutate(tx);
    await tx.execute(sql`
      UPDATE proposal_draft_operations SET result_json = ${JSON.stringify(result)}
      WHERE institution_id = ${institutionId} AND account = ${operation.account} AND operation_id = ${operation.id}
    `);
    return result;
  });
}

const rowsOf = (result: any): any[] =>
  Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];

const asSeconds = (value: unknown): number => Number(value);

const programFrom = (row: any): ProgramRecord => ({
  id: row.id,
  institutionId: row.institution_id,
  name: row.name,
  purpose: row.purpose,
  fundType: row.fund_type as FundType,
  scope: row.scope,
  referenceCeiling: row.reference_ceiling ?? null,
  status: row.status as ProgramStatus,
  createdBy: row.created_by,
  createdAt: asSeconds(row.created_at),
  updatedAt: asSeconds(row.updated_at),
});

const draftFrom = (row: any): StoredProposalDraft => ({
  id: row.id,
  institutionId: row.institution_id,
  programId: row.program_id ?? null,
  createdBy: row.created_by,
  originOfRequest: row.origin_of_request,
  purpose: row.purpose,
  aidPeriod: row.aid_period_json ? JSON.parse(row.aid_period_json) : null,
  personInCharge: row.person_in_charge,
  beneficiaries: JSON.parse(row.beneficiaries_json ?? "[]"),
  aidLines: JSON.parse(row.aid_lines_json ?? "[]"),
  issues: JSON.parse(row.issues_json ?? "[]"),
  version: Number(row.version),
  status: (row.status as ProposalStatus) || "DRAFT",
  submittedAt: row.submitted_at ? asSeconds(row.submitted_at) : null,
  submittedBy: row.submitted_by ?? null,
  examinedAt: row.examined_at ? asSeconds(row.examined_at) : null,
  examinedBy: row.examined_by ?? null,
  examinationNotes: row.examination_notes ?? null,
  examinationChecklist: row.examination_checklist_json ? JSON.parse(row.examination_checklist_json) : null,
  revisionReason: row.revision_reason ?? null,
  withdrawalReason: row.withdrawal_reason ?? null,
  createdAt: asSeconds(row.created_at),
  updatedAt: asSeconds(row.updated_at),
});

const proposalSummaryFrom = (row: any): ProposalDraftSummary => ({
  id: row.id, programId: row.program_id ?? null,
  originOfRequest: row.origin_of_request, purpose: row.purpose,
  beneficiaryCount: JSON.parse(row.beneficiaries_json || "[]").length,
  issueCount: JSON.parse(row.issues_json || "[]").length,
  version: Number(row.version), status: row.status || "DRAFT",
  submittedAt: row.submitted_at == null ? null : asSeconds(row.submitted_at),
  examinedAt: row.examined_at == null ? null : asSeconds(row.examined_at),
  updatedAt: asSeconds(row.updated_at),
});

type QueueAccess = (target: Pick<StoredProposalDraft, "programId" | "aidLines">) => boolean;
const permittedRows = (rows: any[], allows: QueueAccess) => rows.filter(row => allows({
  programId: row.program_id ?? null, aidLines: JSON.parse(row.aid_lines_json || "[]"),
}));

async function editableDocumentDraft(tx: { execute: DisbursementDatabase["execute"] },
  institutionId: string, proposalId: string, expectedVersion: number, guard: DraftGuard) {
  const row = rowsOf(await tx.execute(sql`
    SELECT * FROM proposal_drafts WHERE id = ${proposalId} AND institution_id = ${institutionId} FOR UPDATE
  `))[0];
  if (!row || Number(row.version) !== expectedVersion) throw new ProposalDraftConflictError(proposalId);
  const draft = draftFrom(row);
  guard(draft);
  if (draft.status !== "DRAFT" && draft.status !== "REVISION_REQUIRED") {
    throw new ProposalStateConflictError("Lampiran hanya dapat diubah pada draf atau pengajuan yang perlu revisi.");
  }
  return draft;
}

const documentFrom = (row: any): ProposalDocumentRecord => ({
  id: row.id,
  proposalId: row.proposal_id,
  institutionId: row.institution_id,
  beneficiaryId: row.beneficiary_id ?? null,
  category: row.category as ProposalDocumentCategory,
  fileName: row.file_name,
  mimeType: row.mime_type,
  sizeBytes: Number(row.size_bytes),
  contentSha256: row.content_sha256,
  storageStatus: row.storage_status as "STORED" | "FAILED",
  storageRef: row.storage_ref ?? null,
  version: Number(row.version),
  createdBy: row.created_by,
  createdAt: asSeconds(row.created_at),
});

const policyFrom = (row: any, institutionId: string): DisbursementPolicy => {
  if (!row) return DEFAULT_DISBURSEMENT_POLICY(institutionId);
  return {
    institutionId: row.institution_id,
    requireProposalLetter: Boolean(row.require_proposal_letter),
    requireIdentityDoc: Boolean(row.require_identity_doc),
    requireAlternativeIdProof: Boolean(row.require_alternative_id_proof),
    requireGuardianProof: Boolean(row.require_guardian_proof),
    warnRecurringAid: Boolean(row.warn_recurring_aid),
    sopRequiresMultiSignerQuorum: Boolean(row.sop_requires_multi_signer_quorum),
    version: Number(row.version),
    updatedAt: asSeconds(row.updated_at),
    updatedBy: row.updated_by,
  };
};

const decisionRecordFrom = (row: any): ProposalDecisionRecord => ({
  id: row.id,
  proposalId: row.proposal_id,
  proposalVersion: Number(row.proposal_version),
  institutionId: row.institution_id,
  action: row.action as ProposalDecisionAction,
  decisionReference: row.decision_reference,
  decisionDate: row.decision_date,
  decisionDocumentId: row.decision_document_id,
  decisionDocumentSha256: row.decision_document_sha256,
  notes: row.notes ?? null,
  rejectionReason: row.rejection_reason ?? null,
  rightsDigest: row.rights_digest,
  operatorOfficerId: row.operator_officer_id,
  operatorAccount: row.operator_account,
  signerAccount: row.signer_account,
  mandateId: row.mandate_id,
  signature: row.signature,
  createdAt: asSeconds(row.created_at),
});

const decisionChallengeFrom = (row: any): ProposalDecisionChallenge => ({
  nonce: row.nonce as `0x${string}`,
  proposalId: row.proposal_id,
  proposalVersion: Number(row.proposal_version),
  institutionId: row.institution_id,
  operatorOfficerId: row.operator_officer_id,
  operatorAccount: row.operator_account,
  signerAccount: row.signer_account,
  action: row.action as ProposalDecisionAction,
  rightsDigest: row.rights_digest as `0x${string}`,
  decisionReference: row.decision_reference,
  decisionDate: row.decision_date,
  decisionDocumentId: row.decision_document_id,
  decisionDocumentSha256: row.decision_document_sha256 as `0x${string}`,
  mandateId: row.mandate_id,
  mandateValidUntil: asSeconds(row.mandate_valid_until),
  issuedAt: asSeconds(row.issued_at),
  expiresAt: asSeconds(row.expires_at),
  consumedAt: row.consumed_at == null ? null : asSeconds(row.consumed_at),
});

const decisionDocumentFrom = (row: any): ProposalDecisionDocument => ({
  id: row.id,
  proposalId: row.proposal_id,
  proposalVersion: Number(row.proposal_version),
  institutionId: row.institution_id,
  fileName: row.file_name,
  mimeType: row.mime_type,
  sizeBytes: Number(row.size_bytes),
  contentSha256: row.content_sha256 as `0x${string}`,
  storageRef: row.storage_ref,
  uploadedBy: row.uploaded_by,
  createdAt: asSeconds(row.created_at),
});

const historyFrom = (row: any): ProposalHistoryRecord => ({
  id: Number(row.id),
  proposalId: row.proposal_id,
  institutionId: row.institution_id,
  version: Number(row.version),
  fromStatus: row.from_status as ProposalStatus,
  toStatus: row.to_status as ProposalStatus,
  action: row.action as ProposalHistoryAction,
  actorAccount: row.actor_account,
  actorOfficerId: row.actor_officer_id ?? null,
  reason: row.reason ?? null,
  notes: row.notes ?? null,
  occurredAt: asSeconds(row.occurred_at),
});

/** Idempotent schema evolution and historical attribution backfill from durable save receipts. */
export const DISBURSEMENT_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS programs (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     name TEXT NOT NULL,
     purpose TEXT NOT NULL,
     fund_type TEXT NOT NULL,
     scope TEXT NOT NULL,
     reference_ceiling TEXT,
     status TEXT NOT NULL DEFAULT 'ACTIVE',
     created_by TEXT NOT NULL,
     created_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL,
     CONSTRAINT programs_status_known CHECK (status IN ('ACTIVE', 'ARCHIVED'))
   );`,
  `CREATE INDEX IF NOT EXISTS programs_by_institution ON programs (institution_id, updated_at DESC);`,
  `CREATE TABLE IF NOT EXISTS proposal_drafts (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     program_id TEXT REFERENCES programs (id),
     created_by TEXT NOT NULL,
     origin_of_request TEXT NOT NULL DEFAULT '',
     purpose TEXT NOT NULL DEFAULT '',
     aid_period_json TEXT,
     person_in_charge TEXT NOT NULL DEFAULT '',
     beneficiaries_json TEXT NOT NULL DEFAULT '[]',
     aid_lines_json TEXT NOT NULL DEFAULT '[]',
     issues_json TEXT NOT NULL DEFAULT '[]',
     version INTEGER NOT NULL DEFAULT 1,
     created_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS proposal_drafts_by_institution ON proposal_drafts (institution_id, updated_at DESC);`,
  `ALTER TABLE proposal_drafts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'DRAFT';`,
  `ALTER TABLE proposal_drafts ADD COLUMN IF NOT EXISTS submitted_at BIGINT;`,
  `ALTER TABLE proposal_drafts ADD COLUMN IF NOT EXISTS submitted_by TEXT;`,
  `ALTER TABLE proposal_drafts ADD COLUMN IF NOT EXISTS examined_at BIGINT;`,
  `ALTER TABLE proposal_drafts ADD COLUMN IF NOT EXISTS examined_by TEXT;`,
  `ALTER TABLE proposal_drafts ADD COLUMN IF NOT EXISTS examination_notes TEXT;`,
  `ALTER TABLE proposal_drafts ADD COLUMN IF NOT EXISTS examination_checklist_json TEXT;`,
  `ALTER TABLE proposal_drafts ADD COLUMN IF NOT EXISTS revision_reason TEXT;`,
  `ALTER TABLE proposal_drafts ADD COLUMN IF NOT EXISTS withdrawal_reason TEXT;`,
  `CREATE INDEX IF NOT EXISTS proposal_drafts_by_status ON proposal_drafts (institution_id, status, updated_at DESC);`,
  `CREATE TABLE IF NOT EXISTS proposal_documents (
     id TEXT PRIMARY KEY,
     proposal_id TEXT NOT NULL REFERENCES proposal_drafts(id) ON DELETE CASCADE,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     beneficiary_id TEXT,
     category TEXT NOT NULL,
     file_name TEXT NOT NULL,
     mime_type TEXT NOT NULL,
     size_bytes INTEGER NOT NULL,
     content_sha256 TEXT NOT NULL,
     storage_status TEXT NOT NULL,
     storage_ref TEXT,
     version INTEGER NOT NULL DEFAULT 1,
     created_by TEXT NOT NULL,
     created_at BIGINT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS proposal_documents_by_proposal ON proposal_documents (institution_id, proposal_id, version);`,
  `CREATE TABLE IF NOT EXISTS proposal_versions (
     proposal_id TEXT NOT NULL REFERENCES proposal_drafts(id) ON DELETE CASCADE,
     version INTEGER NOT NULL,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     status TEXT NOT NULL,
     data_json TEXT NOT NULL,
     documents_json TEXT NOT NULL DEFAULT '[]',
     recurring_warnings_json TEXT NOT NULL DEFAULT '[]',
     submitted_by TEXT,
     submitted_at BIGINT,
     examination_json TEXT,
     created_at BIGINT NOT NULL,
     PRIMARY KEY (proposal_id, version)
   );`,
  `CREATE TABLE IF NOT EXISTS proposal_history (
     id SERIAL PRIMARY KEY,
     proposal_id TEXT NOT NULL REFERENCES proposal_drafts(id) ON DELETE CASCADE,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     version INTEGER NOT NULL,
     from_status TEXT NOT NULL,
     to_status TEXT NOT NULL,
     action TEXT NOT NULL,
     actor_account TEXT NOT NULL,
     actor_officer_id TEXT REFERENCES officer_profiles(id),
     reason TEXT,
     notes TEXT,
     occurred_at BIGINT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS proposal_history_by_proposal ON proposal_history (institution_id, proposal_id, occurred_at ASC);`,
  `CREATE TABLE IF NOT EXISTS institution_disbursement_policies (
     institution_id TEXT PRIMARY KEY REFERENCES institutions (id),
     require_proposal_letter BOOLEAN NOT NULL DEFAULT TRUE,
     require_identity_doc BOOLEAN NOT NULL DEFAULT TRUE,
     require_alternative_id_proof BOOLEAN NOT NULL DEFAULT TRUE,
     require_guardian_proof BOOLEAN NOT NULL DEFAULT TRUE,
     warn_recurring_aid BOOLEAN NOT NULL DEFAULT TRUE,
     version INTEGER NOT NULL DEFAULT 1,
     updated_at BIGINT NOT NULL,
     updated_by TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS proposal_draft_operations (
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     account TEXT NOT NULL,
     operation_id TEXT NOT NULL,
     request_hash TEXT NOT NULL,
     result_json TEXT,
     PRIMARY KEY (institution_id, account, operation_id)
   );`,
  `CREATE TABLE IF NOT EXISTS proposal_draft_contributors (
     draft_id TEXT NOT NULL REFERENCES proposal_drafts(id) ON DELETE CASCADE,
     version INTEGER NOT NULL,
     account TEXT NOT NULL,
     officer_id TEXT REFERENCES officer_profiles(id),
     PRIMARY KEY (draft_id, version, account)
   );`,
  // Recover existing attribution from durable save receipts, including inactive memberships.
  // Account-to-person bindings cannot be reassigned by the membership store.
  `INSERT INTO proposal_draft_contributors (draft_id, version, account, officer_id)
   SELECT d.id, 1, LOWER(d.created_by), m.officer_id
   FROM proposal_drafts d LEFT JOIN institution_memberships m
     ON m.institution_id = d.institution_id AND m.account_address = LOWER(d.created_by)
   ON CONFLICT DO NOTHING;`,
  `INSERT INTO proposal_draft_contributors (draft_id, version, account, officer_id)
   SELECT d.id, (o.result_json::jsonb->>'version')::integer, LOWER(o.account), m.officer_id
   FROM proposal_draft_operations o
   JOIN proposal_drafts d ON d.institution_id = o.institution_id AND d.id = o.result_json::jsonb->>'id'
   LEFT JOIN institution_memberships m ON m.institution_id = o.institution_id AND m.account_address = LOWER(o.account)
   WHERE jsonb_typeof(o.result_json::jsonb) = 'object'
     AND (o.result_json::jsonb->>'version')::integer <= d.version
     AND NOT EXISTS (SELECT 1 FROM proposal_draft_contributors c WHERE c.draft_id = d.id
       AND c.version = (o.result_json::jsonb->>'version')::integer)
   ON CONFLICT DO NOTHING;`,
  `ALTER TABLE institution_disbursement_policies ADD COLUMN IF NOT EXISTS sop_requires_multi_signer_quorum BOOLEAN NOT NULL DEFAULT FALSE;`,
  `CREATE TABLE IF NOT EXISTS proposal_decisions (
     id TEXT PRIMARY KEY,
     proposal_id TEXT NOT NULL REFERENCES proposal_drafts(id) ON DELETE CASCADE,
     proposal_version INTEGER NOT NULL,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     action TEXT NOT NULL,
     decision_reference TEXT NOT NULL,
     decision_date TEXT NOT NULL,
     decision_document_id TEXT NOT NULL,
     decision_document_sha256 TEXT NOT NULL,
     notes TEXT,
     rejection_reason TEXT,
     rights_digest TEXT NOT NULL,
     operator_officer_id TEXT NOT NULL REFERENCES officer_profiles(id),
     operator_account TEXT NOT NULL,
     signer_account TEXT NOT NULL,
     mandate_id TEXT NOT NULL REFERENCES operational_mandates(id),
     signature TEXT NOT NULL,
     created_at BIGINT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS proposal_decisions_by_proposal ON proposal_decisions (institution_id, proposal_id, created_at DESC);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS proposal_decisions_one_per_version ON proposal_decisions (proposal_id, proposal_version);`,
  `CREATE TABLE IF NOT EXISTS proposal_decision_challenges (
     nonce TEXT PRIMARY KEY,
     proposal_id TEXT NOT NULL,
     proposal_version INTEGER NOT NULL,
     institution_id TEXT NOT NULL,
     operator_officer_id TEXT NOT NULL,
     operator_account TEXT NOT NULL,
     signer_account TEXT NOT NULL,
     action TEXT NOT NULL,
     rights_digest TEXT NOT NULL,
     decision_reference TEXT NOT NULL,
     decision_date TEXT NOT NULL,
     decision_document_id TEXT NOT NULL,
     decision_document_sha256 TEXT NOT NULL,
     mandate_id TEXT NOT NULL,
     mandate_valid_until BIGINT NOT NULL,
     issued_at BIGINT NOT NULL,
     expires_at BIGINT NOT NULL,
     consumed_at BIGINT
   );`,
  `CREATE TABLE IF NOT EXISTS proposal_decision_documents (
     id TEXT PRIMARY KEY,
     proposal_id TEXT NOT NULL REFERENCES proposal_drafts(id) ON DELETE CASCADE,
     proposal_version INTEGER NOT NULL,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     file_name TEXT NOT NULL,
     mime_type TEXT NOT NULL,
     size_bytes INTEGER NOT NULL,
     content_sha256 TEXT NOT NULL,
     storage_ref TEXT NOT NULL,
     uploaded_by TEXT NOT NULL,
     created_at BIGINT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS proposal_decision_challenges_by_proposal ON proposal_decision_challenges (institution_id, proposal_id, nonce);`,
] as const;

export function createDisbursementStore(db: DisbursementDatabase) {
  return {
    async ensureSchema(): Promise<void> {
      for (const statement of DISBURSEMENT_SCHEMA_STATEMENTS) {
        await db.execute(sql.raw(statement));
      }
    },

    async createProgram(input: {
      id: string;
      institutionId: string;
      name: string;
      purpose: string;
      fundType: FundType;
      scope: string;
      referenceCeiling: string | null;
      createdBy: string;
      now: number;
    }): Promise<ProgramRecord> {
      const row = rowsOf(
        await db.execute(sql`
          INSERT INTO programs (
            id, institution_id, name, purpose, fund_type, scope, reference_ceiling,
            status, created_by, created_at, updated_at
          ) VALUES (
            ${input.id}, ${input.institutionId}, ${input.name}, ${input.purpose}, ${input.fundType},
            ${input.scope}, ${input.referenceCeiling}, 'ACTIVE', ${input.createdBy}, ${input.now}, ${input.now}
          )
          RETURNING *
        `)
      )[0];
      return programFrom(row);
    },

    async getProgram(institutionId: string, id: string): Promise<ProgramRecord | null> {
      const row = rowsOf(
        await db.execute(sql`SELECT * FROM programs WHERE id = ${id} AND institution_id = ${institutionId}`)
      )[0];
      return row ? programFrom(row) : null;
    },

    /** Archived programs are returned too - they "tetap terbaca untuk sejarah". */
    async listPrograms(institutionId: string): Promise<ProgramRecord[]> {
      const rows = rowsOf(
        await db.execute(
          sql`SELECT * FROM programs WHERE institution_id = ${institutionId} ORDER BY updated_at DESC, id DESC`
        )
      );
      return rows.map(programFrom);
    },

    async setProgramStatus(
      institutionId: string,
      id: string,
      status: ProgramStatus,
      now: number
    ): Promise<ProgramRecord | null> {
      const row = rowsOf(
        await db.execute(sql`
          UPDATE programs SET status = ${status}, updated_at = ${now}
          WHERE id = ${id} AND institution_id = ${institutionId}
          RETURNING *
        `)
      )[0];
      return row ? programFrom(row) : null;
    },

    async saveProposalDraft(
      draft: Pick<StoredProposalDraft, "id" | "institutionId" | "createdBy" | "programId" | "originOfRequest" | "purpose" | "aidPeriod" | "personInCharge" | "beneficiaries" | "aidLines" | "issues" | "createdAt" | "updatedAt">,
      expectedVersion: number,
      operation: DraftOperation,
      authorizeExisting: DraftGuard
    ): Promise<StoredProposalDraft> {
      return mutateOnce(db, draft.institutionId, operation, async tx => {
        const current = rowsOf(await tx.execute(sql`
          SELECT * FROM proposal_drafts WHERE id = ${draft.id} AND institution_id = ${draft.institutionId} FOR UPDATE
        `))[0];
        if (current) {
          const currentDraft = draftFrom(current);
          if (
            currentDraft.status === "SUBMITTED" ||
            currentDraft.status === "UNDER_EXAMINATION" ||
            currentDraft.status === "READY_FOR_DECISION"
          ) {
            throw new ProposalStateConflictError(
              `Pengajuan berstatus "${currentDraft.status}" tidak dapat diubah langsung. Tarik pengajuan atau tunggu hasil pemeriksaan.`
            );
          }
          authorizeExisting(currentDraft);
        }
        const written = rowsOf(await tx.execute(expectedVersion === 0 ? sql`
          INSERT INTO proposal_drafts (
            id, institution_id, program_id, created_by, origin_of_request, purpose,
            aid_period_json, person_in_charge, beneficiaries_json, aid_lines_json,
            issues_json, version, status, created_at, updated_at
          ) VALUES (
            ${draft.id}, ${draft.institutionId}, ${draft.programId}, ${draft.createdBy},
            ${draft.originOfRequest}, ${draft.purpose}, ${draft.aidPeriod ? JSON.stringify(draft.aidPeriod) : null},
            ${draft.personInCharge}, ${JSON.stringify(draft.beneficiaries)}, ${JSON.stringify(draft.aidLines)},
            ${JSON.stringify(draft.issues)}, 1, 'DRAFT', ${draft.createdAt}, ${draft.updatedAt}
          ) ON CONFLICT (id) DO NOTHING RETURNING *
        ` : sql`
          UPDATE proposal_drafts SET
            program_id = ${draft.programId}, origin_of_request = ${draft.originOfRequest},
            purpose = ${draft.purpose}, aid_period_json = ${draft.aidPeriod ? JSON.stringify(draft.aidPeriod) : null},
            person_in_charge = ${draft.personInCharge}, beneficiaries_json = ${JSON.stringify(draft.beneficiaries)},
            aid_lines_json = ${JSON.stringify(draft.aidLines)}, issues_json = ${JSON.stringify(draft.issues)},
            version = version + 1, updated_at = ${draft.updatedAt}
          WHERE id = ${draft.id} AND institution_id = ${draft.institutionId} AND version = ${expectedVersion}
          RETURNING *
        `));
        if (!written.length) throw new ProposalDraftConflictError(draft.id);
        const saved = draftFrom(written[0]);
        if (current && materialContents(draftFrom(current)) === materialContents(draft)) {
          await tx.execute(sql`
            INSERT INTO proposal_draft_contributors (draft_id, version, account, officer_id)
            SELECT draft_id, ${saved.version}, account, officer_id FROM proposal_draft_contributors
            WHERE draft_id = ${saved.id} AND version = ${expectedVersion}
          `);
        } else {
          // Attribution is committed with the actual version; it never depends on an active membership later.
          await tx.execute(sql`
            INSERT INTO proposal_draft_contributors (draft_id, version, account, officer_id)
            VALUES (${saved.id}, ${saved.version}, ${operation.account.toLowerCase()},
              (SELECT officer_id FROM institution_memberships WHERE institution_id = ${draft.institutionId}
                AND account_address = ${operation.account.toLowerCase()}))
          `);
        }
        return saved;
      });
    },

    async getProposalDraft(institutionId: string, id: string): Promise<StoredProposalDraft | null> {
      const row = rowsOf(
        await db.execute(sql`SELECT * FROM proposal_drafts WHERE id = ${id} AND institution_id = ${institutionId}`)
      )[0];
      return row ? draftFrom(row) : null;
    },

    async proposalContributors(institutionId: string, id: string): Promise<ProposalContributor[]> {
      return rowsOf(await db.execute(sql`
        SELECT c.account, c.officer_id, c.version FROM proposal_draft_contributors c
        JOIN proposal_drafts d ON d.id = c.draft_id
        WHERE d.id = ${id} AND d.institution_id = ${institutionId} AND c.version <= d.version
      `)).map(row => ({ account: row.account, officerId: row.officer_id ?? null, version: Number(row.version) }));
    },

    async listProposalDrafts(institutionId: string, programId?: string): Promise<ProposalDraftSummary[]> {
      const rows = rowsOf(
        programId
          ? await db.execute(sql`
              SELECT id, program_id, origin_of_request, purpose, beneficiaries_json, issues_json, version, status, submitted_at, examined_at, updated_at
              FROM proposal_drafts WHERE institution_id = ${institutionId} AND program_id = ${programId}
              ORDER BY updated_at DESC, id DESC
            `)
          : await db.execute(sql`
              SELECT id, program_id, origin_of_request, purpose, beneficiaries_json, issues_json, version, status, submitted_at, examined_at, updated_at
              FROM proposal_drafts WHERE institution_id = ${institutionId}
              ORDER BY updated_at DESC, id DESC
            `)
      );
      return rows.map((row) => ({
        id: row.id,
        programId: row.program_id ?? null,
        originOfRequest: row.origin_of_request,
        purpose: row.purpose,
        beneficiaryCount: (JSON.parse(row.beneficiaries_json || "[]") as unknown[]).length,
        issueCount: (JSON.parse(row.issues_json || "[]") as unknown[]).length,
        version: Number(row.version),
        status: (row.status as ProposalStatus) || "DRAFT",
        submittedAt: row.submitted_at ? asSeconds(row.submitted_at) : null,
        examinedAt: row.examined_at ? asSeconds(row.examined_at) : null,
        updatedAt: asSeconds(row.updated_at),
      }));
    },

    async deleteProposalDraft(institutionId: string, id: string, expectedVersion: number,
      operation: DraftOperation, authorizeExisting: DraftGuard): Promise<boolean> {
      return mutateOnce(db, institutionId, operation, async tx => {
        // Lock before checking the version so an edit/delete race cannot silently win.
        const existing = rowsOf(await tx.execute(sql`
          SELECT * FROM proposal_drafts WHERE id = ${id} AND institution_id = ${institutionId} FOR UPDATE
        `))[0];
        if (!existing) return false;
        authorizeExisting(draftFrom(existing));
        if (Number(existing.version) !== expectedVersion) throw new ProposalDraftConflictError(id);
        if (existing.status !== "DRAFT" || rowsOf(await tx.execute(sql`
          SELECT 1 FROM proposal_versions WHERE proposal_id = ${id} LIMIT 1
        `)).length) {
          throw new ProposalStateConflictError("Pengajuan yang sudah diajukan harus ditarik dengan alasan; riwayatnya tidak boleh dihapus.");
        }
        await tx.execute(sql`DELETE FROM proposal_drafts WHERE id = ${id} AND institution_id = ${institutionId} AND version = ${expectedVersion}`);
        return true;
      });
    },

    // -----------------------------------------------------------------------
    // Policy
    // -----------------------------------------------------------------------

    async getInstitutionPolicy(institutionId: string): Promise<DisbursementPolicy> {
      const row = rowsOf(
        await db.execute(
          sql`SELECT * FROM institution_disbursement_policies WHERE institution_id = ${institutionId}`
        )
      )[0];
      return policyFrom(row, institutionId);
    },

    async saveInstitutionPolicy(
      policy: DisbursementPolicy,
      expectedVersion: number
    ): Promise<DisbursementPolicy> {
      const existing = rowsOf(
        await db.execute(
          sql`SELECT * FROM institution_disbursement_policies WHERE institution_id = ${policy.institutionId} FOR UPDATE`
        )
      )[0];
      if (existing) {
        if (Number(existing.version) !== expectedVersion) {
          throw new ProposalStateConflictError("Versi kebijakan lembaga sudah berubah. Muat ulang sebelum menyimpan.");
        }
        const updated = rowsOf(
          await db.execute(sql`
            UPDATE institution_disbursement_policies SET
              require_proposal_letter = ${policy.requireProposalLetter},
              require_identity_doc = ${policy.requireIdentityDoc},
              require_alternative_id_proof = ${policy.requireAlternativeIdProof},
              require_guardian_proof = ${policy.requireGuardianProof},
              warn_recurring_aid = ${policy.warnRecurringAid},
              sop_requires_multi_signer_quorum = ${Boolean(policy.sopRequiresMultiSignerQuorum)},
              version = version + 1,
              updated_at = ${policy.updatedAt},
              updated_by = ${policy.updatedBy}
            WHERE institution_id = ${policy.institutionId} AND version = ${expectedVersion}
            RETURNING *
          `)
        )[0];
        return policyFrom(updated, policy.institutionId);
      } else {
        const inserted = rowsOf(
          await db.execute(sql`
            INSERT INTO institution_disbursement_policies (
              institution_id, require_proposal_letter, require_identity_doc,
              require_alternative_id_proof, require_guardian_proof, warn_recurring_aid,
              sop_requires_multi_signer_quorum, version, updated_at, updated_by
            ) VALUES (
              ${policy.institutionId}, ${policy.requireProposalLetter}, ${policy.requireIdentityDoc},
              ${policy.requireAlternativeIdProof}, ${policy.requireGuardianProof}, ${policy.warnRecurringAid},
              ${Boolean(policy.sopRequiresMultiSignerQuorum)}, 1, ${policy.updatedAt}, ${policy.updatedBy}
            ) RETURNING *
          `)
        )[0];
        return policyFrom(inserted, policy.institutionId);
      }
    },

    // -----------------------------------------------------------------------
    // Documents
    // -----------------------------------------------------------------------

    async saveProposalDocument(doc: ProposalDocumentRecord, guard: DraftGuard): Promise<ProposalDocumentRecord> {
      return db.transaction(async tx => {
        const draft = await editableDocumentDraft(tx, doc.institutionId, doc.proposalId, doc.version, guard);
        if (doc.beneficiaryId && !draft.beneficiaries.some(b => b.id === doc.beneficiaryId)) {
          throw new ProposalStateConflictError("Penerima lampiran sudah berubah. Muat ulang pengajuan.");
        }
        const row = rowsOf(
          await tx.execute(sql`
            INSERT INTO proposal_documents (
              id, proposal_id, institution_id, beneficiary_id, category, file_name,
              mime_type, size_bytes, content_sha256, storage_status, storage_ref,
              version, created_by, created_at
            ) VALUES (
              ${doc.id}, ${doc.proposalId}, ${doc.institutionId}, ${doc.beneficiaryId},
              ${doc.category}, ${doc.fileName}, ${doc.mimeType}, ${doc.sizeBytes},
              ${doc.contentSha256}, ${doc.storageStatus}, ${doc.storageRef},
              ${doc.version}, ${doc.createdBy}, ${doc.createdAt}
            ) RETURNING *
          `)
        )[0];
        return documentFrom(row);
      });
    },

    async listProposalDocuments(
      institutionId: string,
      proposalId: string,
      version?: number
    ): Promise<ProposalDocumentRecord[]> {
      if (version !== undefined) {
        const frozen = rowsOf(await db.execute(sql`
          SELECT documents_json FROM proposal_versions
          WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId} AND version = ${version}
        `))[0];
        if (frozen) return JSON.parse(frozen.documents_json);
      }
      const rows = rowsOf(
        version !== undefined
          ? await db.execute(sql`
              SELECT * FROM proposal_documents
              WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId} AND version <= ${version}
              ORDER BY created_at ASC
            `)
          : await db.execute(sql`
              SELECT * FROM proposal_documents
              WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId}
              ORDER BY created_at ASC
            `)
      );
      return rows.map(documentFrom);
    },

    async getProposalDocument(
      institutionId: string,
      proposalId: string,
      documentId: string
    ): Promise<ProposalDocumentRecord | null> {
      const row = rowsOf(
        await db.execute(sql`
          SELECT * FROM proposal_documents
          WHERE id = ${documentId} AND proposal_id = ${proposalId} AND institution_id = ${institutionId}
        `)
      )[0];
      return row ? documentFrom(row) : null;
    },

    async deleteProposalDocument(
      institutionId: string,
      proposalId: string,
      documentId: string,
      expectedVersion: number,
      guard: DraftGuard
    ): Promise<boolean> {
      return db.transaction(async tx => {
        await editableDocumentDraft(tx, institutionId, proposalId, expectedVersion, guard);
        const deleted = rowsOf(
          await tx.execute(sql`
            DELETE FROM proposal_documents
            WHERE id = ${documentId} AND proposal_id = ${proposalId} AND institution_id = ${institutionId}
            RETURNING id
          `)
        );
        return deleted.length > 0;
      });
    },

    // -----------------------------------------------------------------------
    // Recurring Aid Lookup
    // -----------------------------------------------------------------------

    async findRecurringAidMatches(
      institutionId: string,
      proposalId: string,
      beneficiaries: Beneficiary[]
    ): Promise<RecurringAidMatch[]> {
      const otherProposals = rowsOf(
        await db.execute(sql`
          SELECT p.id, p.program_id, pr.name as program_name, p.status, p.aid_period_json, p.beneficiaries_json
          FROM proposal_drafts p
          LEFT JOIN programs pr ON pr.id = p.program_id
          WHERE p.institution_id = ${institutionId}
            AND p.id != ${proposalId}
            AND p.status IN ('SUBMITTED', 'UNDER_EXAMINATION', 'READY_FOR_DECISION', 'APPROVED')
        `)
      );

      const matches: RecurringAidMatch[] = [];
      for (const op of otherProposals) {
        const bList = JSON.parse(op.beneficiaries_json || "[]") as Beneficiary[];
        const period = op.aid_period_json ? JSON.parse(op.aid_period_json) : null;
        for (const ob of bList) {
          matches.push({
            proposalId: op.id,
            programId: op.program_id ?? null,
            programName: op.program_name ?? "Program tanpa judul",
            aidPeriod: period,
            status: op.status as ProposalStatus,
            beneficiaryId: ob.id,
            beneficiaryName: ob.name,
            nik: ob.identityBasis.kind === "NIK" ? ob.identityBasis.value : null,
            alternativeDesc: ob.identityBasis.kind === "ALTERNATIVE" ? ob.identityBasis.description : null,
          });
        }
      }
      return matches;
    },

    // -----------------------------------------------------------------------
    // Lifecycle Transitions (Submit, Withdraw, Examine, Return, Mark Ready)
    // -----------------------------------------------------------------------

    async submitProposalDraft(
      institutionId: string,
      proposalId: string,
      expectedVersion: number,
      operation: DraftOperation,
      actor: { account: string; officerId: string | null },
      now: number
    ): Promise<{ draft: StoredProposalDraft; warnings: RecurringAidWarning[] }> {
      return mutateOnce(db, institutionId, operation, async tx => {
        const currentRaw = rowsOf(
          await tx.execute(sql`
            SELECT * FROM proposal_drafts WHERE id = ${proposalId} AND institution_id = ${institutionId} FOR UPDATE
          `)
        )[0];
        if (!currentRaw) throw new ProposalDraftConflictError(proposalId);
        const current = draftFrom(currentRaw);
        if (current.version !== expectedVersion) throw new ProposalDraftConflictError(proposalId);
        if (current.status !== "DRAFT" && current.status !== "REVISION_REQUIRED") {
          throw new ProposalStateConflictError(`Pengajuan berstatus "${current.status}" tidak dapat diajukan kembali.`);
        }

        const policyRow = rowsOf(
          await tx.execute(
            sql`SELECT * FROM institution_disbursement_policies WHERE institution_id = ${institutionId}`
          )
        )[0];
        const policy = policyFrom(policyRow, institutionId);

        const docRows = rowsOf(
          await tx.execute(
            sql`SELECT * FROM proposal_documents WHERE proposal_id = ${proposalId} AND institution_id = ${institutionId}`
          )
        );
        const docs = docRows.map(documentFrom);

        const completenessIssues = validateProposalForSubmission(
          {
            programId: current.programId,
            originOfRequest: current.originOfRequest,
            purpose: current.purpose,
            aidPeriod: current.aidPeriod,
            personInCharge: current.personInCharge,
            beneficiaries: current.beneficiaries,
            aidLines: current.aidLines,
          },
          docs,
          policy
        );
        if (completenessIssues.length > 0) {
          throw new ProposalSubmissionIncompleteError(completenessIssues);
        }

        // Check recurring aid
        const otherProposals = rowsOf(
          await tx.execute(sql`
            SELECT p.id, p.program_id, pr.name as program_name, p.status, p.aid_period_json, p.beneficiaries_json
            FROM proposal_drafts p
            LEFT JOIN programs pr ON pr.id = p.program_id
            WHERE p.institution_id = ${institutionId}
              AND p.id != ${proposalId}
              AND p.status IN ('SUBMITTED', 'UNDER_EXAMINATION', 'READY_FOR_DECISION', 'APPROVED')
          `)
        );
        const matches: RecurringAidMatch[] = [];
        for (const op of otherProposals) {
          const bList = JSON.parse(op.beneficiaries_json || "[]") as Beneficiary[];
          const period = op.aid_period_json ? JSON.parse(op.aid_period_json) : null;
          for (const ob of bList) {
            matches.push({
              proposalId: op.id,
              programId: op.program_id ?? null,
              programName: op.program_name ?? "Program tanpa judul",
              aidPeriod: period,
              status: op.status as ProposalStatus,
              beneficiaryId: ob.id,
              beneficiaryName: ob.name,
              nik: ob.identityBasis.kind === "NIK" ? ob.identityBasis.value : null,
              alternativeDesc: ob.identityBasis.kind === "ALTERNATIVE" ? ob.identityBasis.description : null,
            });
          }
        }
        const warnings = policy.warnRecurringAid ? evaluateRecurringAidWarnings(current.beneficiaries, matches) : [];

        const dataSnapshot = {
          programId: current.programId,
          originOfRequest: current.originOfRequest,
          purpose: current.purpose,
          aidPeriod: current.aidPeriod,
          personInCharge: current.personInCharge,
          beneficiaries: current.beneficiaries,
          aidLines: current.aidLines,
          issues: current.issues,
        };

        // A document-only revision is still a new submission. Never replace a frozen version.
        const alreadySubmitted = rowsOf(await tx.execute(sql`
          SELECT 1 FROM proposal_versions WHERE proposal_id = ${proposalId} AND version = ${current.version}
        `)).length > 0;
        const submittedVersion = current.version + (alreadySubmitted ? 1 : 0);
        if (alreadySubmitted) await tx.execute(sql`
          INSERT INTO proposal_draft_contributors (draft_id, version, account, officer_id)
          SELECT draft_id, ${submittedVersion}, account, officer_id FROM proposal_draft_contributors
          WHERE draft_id = ${proposalId} AND version = ${current.version}
          ON CONFLICT DO NOTHING
        `);
        await tx.execute(sql`
          INSERT INTO proposal_versions (
            proposal_id, version, institution_id, status, data_json, documents_json,
            recurring_warnings_json, submitted_by, submitted_at, created_at
          ) VALUES (
            ${proposalId}, ${submittedVersion}, ${institutionId}, 'SUBMITTED',
            ${JSON.stringify(dataSnapshot)}, ${JSON.stringify(docs)},
            ${JSON.stringify(warnings)}, ${actor.account}, ${now}, ${now}
          )
        `);

        const updatedRaw = rowsOf(
          await tx.execute(sql`
            UPDATE proposal_drafts SET
              version = ${submittedVersion}, status = 'SUBMITTED', examined_at = NULL, examined_by = NULL, submitted_at = ${now}, submitted_by = ${actor.account},
              revision_reason = NULL, withdrawal_reason = NULL, examination_notes = NULL,
              examination_checklist_json = NULL, updated_at = ${now}
            WHERE id = ${proposalId} AND institution_id = ${institutionId} AND version = ${expectedVersion}
            RETURNING *
          `)
        )[0];

        await tx.execute(sql`
          INSERT INTO proposal_history (
            proposal_id, institution_id, version, from_status, to_status, action,
            actor_account, actor_officer_id, reason, notes, occurred_at
          ) VALUES (
            ${proposalId}, ${institutionId}, ${submittedVersion}, ${current.status},
            'SUBMITTED', 'SUBMIT', ${actor.account}, ${actor.officerId}, NULL, NULL, ${now}
          )
        `);

        return { draft: draftFrom(updatedRaw), warnings };
      });
    },

    async withdrawProposal(
      institutionId: string,
      proposalId: string,
      reason: string,
      expectedVersion: number,
      operation: DraftOperation,
      actor: { account: string; officerId: string | null },
      now: number
    ): Promise<StoredProposalDraft> {
      return mutateOnce(db, institutionId, operation, async tx => {
        const currentRaw = rowsOf(
          await tx.execute(sql`
            SELECT * FROM proposal_drafts WHERE id = ${proposalId} AND institution_id = ${institutionId} FOR UPDATE
          `)
        )[0];
        if (!currentRaw) throw new ProposalDraftConflictError(proposalId);
        const current = draftFrom(currentRaw);
        if (current.version !== expectedVersion) throw new ProposalDraftConflictError(proposalId);
        if (current.status !== "SUBMITTED" && current.status !== "UNDER_EXAMINATION") {
          throw new ProposalStateConflictError(`Pengajuan berstatus "${current.status}" tidak dapat ditarik.`);
        }

        const updatedRaw = rowsOf(
          await tx.execute(sql`
            UPDATE proposal_drafts SET
              status = 'WITHDRAWN', withdrawal_reason = ${reason}, updated_at = ${now}
            WHERE id = ${proposalId} AND institution_id = ${institutionId} AND version = ${expectedVersion}
            RETURNING *
          `)
        )[0];

        await tx.execute(sql`
          INSERT INTO proposal_history (
            proposal_id, institution_id, version, from_status, to_status, action,
            actor_account, actor_officer_id, reason, notes, occurred_at
          ) VALUES (
            ${proposalId}, ${institutionId}, ${current.version}, ${current.status},
            'WITHDRAWN', 'WITHDRAW', ${actor.account}, ${actor.officerId}, ${reason}, NULL, ${now}
          )
        `);

        return draftFrom(updatedRaw);
      });
    },

    async startProposalExamination(
      institutionId: string,
      proposalId: string,
      expectedVersion: number,
      operation: DraftOperation,
      actor: { account: string; officerId: string | null },
      now: number
    ): Promise<StoredProposalDraft> {
      return mutateOnce(db, institutionId, operation, async tx => {
        const currentRaw = rowsOf(
          await tx.execute(sql`
            SELECT * FROM proposal_drafts WHERE id = ${proposalId} AND institution_id = ${institutionId} FOR UPDATE
          `)
        )[0];
        if (!currentRaw) throw new ProposalDraftConflictError(proposalId);
        const current = draftFrom(currentRaw);
        if (current.version !== expectedVersion) throw new ProposalDraftConflictError(proposalId);
        if (current.status !== "SUBMITTED") {
          throw new ProposalStateConflictError(`Pengajuan berstatus "${current.status}" tidak dalam antrean menunggu pemeriksaan.`);
        }

        const updatedRaw = rowsOf(
          await tx.execute(sql`
            UPDATE proposal_drafts SET
              status = 'UNDER_EXAMINATION', examined_by = ${actor.officerId}, examined_at = ${now}, updated_at = ${now}
            WHERE id = ${proposalId} AND institution_id = ${institutionId} AND version = ${expectedVersion}
            RETURNING *
          `)
        )[0];

        await tx.execute(sql`
          INSERT INTO proposal_history (
            proposal_id, institution_id, version, from_status, to_status, action,
            actor_account, actor_officer_id, reason, notes, occurred_at
          ) VALUES (
            ${proposalId}, ${institutionId}, ${current.version}, ${current.status},
            'UNDER_EXAMINATION', 'START_EXAMINATION', ${actor.account}, ${actor.officerId}, NULL, NULL, ${now}
          )
        `);

        return draftFrom(updatedRaw);
      });
    },

    async returnProposalForRevision(
      institutionId: string,
      proposalId: string,
      reason: string,
      expectedVersion: number,
      operation: DraftOperation,
      actor: { account: string; officerId: string | null },
      now: number
    ): Promise<StoredProposalDraft> {
      return mutateOnce(db, institutionId, operation, async tx => {
        const currentRaw = rowsOf(
          await tx.execute(sql`
            SELECT * FROM proposal_drafts WHERE id = ${proposalId} AND institution_id = ${institutionId} FOR UPDATE
          `)
        )[0];
        if (!currentRaw) throw new ProposalDraftConflictError(proposalId);
        const current = draftFrom(currentRaw);
        if (current.version !== expectedVersion) throw new ProposalDraftConflictError(proposalId);
        if (current.status !== "UNDER_EXAMINATION" && current.status !== "SUBMITTED") {
          throw new ProposalStateConflictError(`Pengajuan berstatus "${current.status}" tidak dapat dikembalikan untuk revisi.`);
        }

        const updatedRaw = rowsOf(
          await tx.execute(sql`
            UPDATE proposal_drafts SET
              status = 'REVISION_REQUIRED', revision_reason = ${reason}, updated_at = ${now}
            WHERE id = ${proposalId} AND institution_id = ${institutionId} AND version = ${expectedVersion}
            RETURNING *
          `)
        )[0];

        await tx.execute(sql`
          INSERT INTO proposal_history (
            proposal_id, institution_id, version, from_status, to_status, action,
            actor_account, actor_officer_id, reason, notes, occurred_at
          ) VALUES (
            ${proposalId}, ${institutionId}, ${current.version}, ${current.status},
            'REVISION_REQUIRED', 'RETURN_FOR_REVISION', ${actor.account}, ${actor.officerId}, ${reason}, NULL, ${now}
          )
        `);

        return draftFrom(updatedRaw);
      });
    },

    async markProposalReady(
      institutionId: string,
      proposalId: string,
      checklist: ExaminationChecklist,
      expectedVersion: number,
      operation: DraftOperation,
      actor: { account: string; officerId: string | null },
      now: number
    ): Promise<StoredProposalDraft> {
      return mutateOnce(db, institutionId, operation, async tx => {
        const currentRaw = rowsOf(
          await tx.execute(sql`
            SELECT * FROM proposal_drafts WHERE id = ${proposalId} AND institution_id = ${institutionId} FOR UPDATE
          `)
        )[0];
        if (!currentRaw) throw new ProposalDraftConflictError(proposalId);
        const current = draftFrom(currentRaw);
        if (current.version !== expectedVersion) throw new ProposalDraftConflictError(proposalId);
        if (current.status !== "UNDER_EXAMINATION" && current.status !== "SUBMITTED") {
          throw new ProposalStateConflictError(`Pengajuan berstatus "${current.status}" tidak dalam pemeriksaan.`);
        }

        if (!checklist.administrativeChecksOk || !checklist.eligibilityChecksOk ||
          (current.beneficiaries.some(b => b.identityBasis.kind === "ALTERNATIVE") && !checklist.alternativeIdReviewed)) {
          throw new ProposalSubmissionIncompleteError([{
            scope: "proposal", rowIndex: null, field: "checklist",
            message: "Pemeriksaan administrasi, kelayakan, dan identitas alternatif wajib diselesaikan.",
          }]);
        }
        const updatedRaw = rowsOf(
          await tx.execute(sql`
            UPDATE proposal_drafts SET
              status = 'READY_FOR_DECISION', examined_by = ${actor.officerId}, examined_at = ${now}, examination_notes = ${checklist.notes},
              examination_checklist_json = ${JSON.stringify(checklist)}, updated_at = ${now}
            WHERE id = ${proposalId} AND institution_id = ${institutionId} AND version = ${expectedVersion}
            RETURNING *
          `)
        )[0];

        await tx.execute(sql`
          UPDATE proposal_versions SET
            status = 'READY_FOR_DECISION', examination_json = ${JSON.stringify(checklist)}
          WHERE proposal_id = ${proposalId} AND version = ${current.version}
        `);

        await tx.execute(sql`
          INSERT INTO proposal_history (
            proposal_id, institution_id, version, from_status, to_status, action,
            actor_account, actor_officer_id, reason, notes, occurred_at
          ) VALUES (
            ${proposalId}, ${institutionId}, ${current.version}, ${current.status},
            'READY_FOR_DECISION', 'MARK_READY', ${actor.account}, ${actor.officerId},
            NULL, ${checklist.notes}, ${now}
          )
        `);

        return draftFrom(updatedRaw);
      });
    },

    // -----------------------------------------------------------------------
    // Queues & History
    // -----------------------------------------------------------------------

    async listExaminerQueue(
      institutionId: string,
      programIdFilter: string | null | undefined,
      allows: QueueAccess
    ): Promise<ProposalDraftSummary[]> {
      const rows = rowsOf(
        programIdFilter
          ? await db.execute(sql`
              SELECT id, program_id, origin_of_request, purpose, beneficiaries_json, aid_lines_json, issues_json, version, status, submitted_at, examined_at, updated_at
              FROM proposal_drafts
              WHERE institution_id = ${institutionId}
                AND status IN ('SUBMITTED', 'UNDER_EXAMINATION')
                AND program_id = ${programIdFilter}
              ORDER BY COALESCE(submitted_at, updated_at) ASC, id ASC
            `)
          : await db.execute(sql`
              SELECT id, program_id, origin_of_request, purpose, beneficiaries_json, aid_lines_json, issues_json, version, status, submitted_at, examined_at, updated_at
              FROM proposal_drafts
              WHERE institution_id = ${institutionId}
                AND status IN ('SUBMITTED', 'UNDER_EXAMINATION')
              ORDER BY COALESCE(submitted_at, updated_at) ASC, id ASC
            `)
      );
      return permittedRows(rows, allows).map(proposalSummaryFrom);
    },

    async listRevisionQueue(
      institutionId: string,
      accountFilter: string | null | undefined,
      allows: QueueAccess
    ): Promise<ProposalDraftSummary[]> {
      const rows = rowsOf(
        accountFilter
          ? await db.execute(sql`
              SELECT id, program_id, origin_of_request, purpose, beneficiaries_json, aid_lines_json, issues_json, version, status, submitted_at, examined_at, updated_at
              FROM proposal_drafts
              WHERE institution_id = ${institutionId}
                AND (status = 'REVISION_REQUIRED' OR (status = 'DRAFT' AND issues_json != '[]'))
                AND LOWER(created_by) = ${accountFilter.toLowerCase()}
              ORDER BY updated_at DESC, id DESC
            `)
          : await db.execute(sql`
              SELECT id, program_id, origin_of_request, purpose, beneficiaries_json, aid_lines_json, issues_json, version, status, submitted_at, examined_at, updated_at
              FROM proposal_drafts
              WHERE institution_id = ${institutionId}
                AND (status = 'REVISION_REQUIRED' OR (status = 'DRAFT' AND issues_json != '[]'))
              ORDER BY updated_at DESC, id DESC
            `)
      );
      return permittedRows(rows, allows).map(proposalSummaryFrom);
    },

    async listProposalHistory(
      institutionId: string,
      proposalId: string
    ): Promise<ProposalHistoryRecord[]> {
      const rows = rowsOf(
        await db.execute(sql`
          SELECT * FROM proposal_history
          WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId}
          ORDER BY occurred_at ASC, id ASC
        `)
      );
      return rows.map(historyFrom);
    },

    async getProposalVersion(
      institutionId: string,
      proposalId: string,
      version: number
    ): Promise<{
      version: number;
      status: ProposalStatus;
      data: any;
      documents: ProposalDocumentRecord[];
      recurringWarnings: RecurringAidWarning[];
      submittedBy: string | null;
      submittedAt: number | null;
      examination: ExaminationChecklist | null;
      createdAt: number;
    } | null> {
      const row = rowsOf(
        await db.execute(sql`
          SELECT * FROM proposal_versions
          WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId} AND version = ${version}
        `)
      )[0];
      if (!row) return null;
      return {
        version: Number(row.version),
        status: row.status as ProposalStatus,
        data: JSON.parse(row.data_json),
        documents: JSON.parse(row.documents_json),
        recurringWarnings: JSON.parse(row.recurring_warnings_json),
        submittedBy: row.submitted_by ?? null,
        submittedAt: row.submitted_at ? asSeconds(row.submitted_at) : null,
        examination: row.examination_json ? JSON.parse(row.examination_json) : null,
        createdAt: asSeconds(row.created_at),
      };
    },

    // -----------------------------------------------------------------------
    // Keputusan lembaga (ticket #93)
    // -----------------------------------------------------------------------

    async createDecisionChallenge(binding: DecisionBinding): Promise<ProposalDecisionChallenge> {
      const row = rowsOf(
        await db.execute(sql`
          INSERT INTO proposal_decision_challenges (
            nonce, proposal_id, proposal_version, institution_id,
            operator_officer_id, operator_account, signer_account,
            action, rights_digest, decision_reference, decision_date,
            decision_document_id, decision_document_sha256,
            mandate_id, mandate_valid_until, issued_at, expires_at
          ) VALUES (
            ${binding.nonce.toLowerCase()}, ${binding.proposalId}, ${binding.proposalVersion}, ${binding.institutionId},
            ${binding.operatorOfficerId}, ${binding.operatorAccount.toLowerCase()}, ${binding.signerAccount.toLowerCase()},
            ${binding.action}, ${binding.rightsDigest}, ${binding.decisionReference}, ${binding.decisionDate},
            ${binding.decisionDocumentId}, ${binding.decisionDocumentSha256},
            ${binding.mandateId}, ${binding.mandateValidUntil}, ${binding.issuedAt}, ${binding.expiresAt}
          )
          RETURNING *
        `)
      )[0];
      return decisionChallengeFrom(row);
    },

    async saveDecisionDocument(document: ProposalDecisionDocument): Promise<ProposalDecisionDocument> {
      const row = rowsOf(
        await db.execute(sql`
          INSERT INTO proposal_decision_documents (
            id, proposal_id, proposal_version, institution_id, file_name, mime_type,
            size_bytes, content_sha256, storage_ref, uploaded_by, created_at
          ) VALUES (
            ${document.id}, ${document.proposalId}, ${document.proposalVersion}, ${document.institutionId},
            ${document.fileName}, ${document.mimeType}, ${document.sizeBytes}, ${document.contentSha256},
            ${document.storageRef}, ${document.uploadedBy.toLowerCase()}, ${document.createdAt}
          )
          RETURNING *
        `)
      )[0];
      return decisionDocumentFrom(row);
    },

    async getDecisionDocument(
      institutionId: string,
      proposalId: string,
      documentId: string
    ): Promise<ProposalDecisionDocument | null> {
      const row = rowsOf(
        await db.execute(sql`
          SELECT * FROM proposal_decision_documents
          WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId} AND id = ${documentId}
        `)
      )[0];
      return row ? decisionDocumentFrom(row) : null;
    },

    async readDecisionChallenge(nonce: string): Promise<ProposalDecisionChallenge | null> {
      const row = rowsOf(
        await db.execute(sql`
          SELECT * FROM proposal_decision_challenges
          WHERE nonce = ${nonce.toLowerCase()}
        `)
      )[0];
      return row ? decisionChallengeFrom(row) : null;
    },

    /**
     * Spends the challenge, applies the decided rights and records the decision in
     * one transaction: a failure leaves the challenge unspent, and a retry with the
     * same operation returns the committed result even though the nonce is spent.
     */
    async recordProposalDecision(
      institutionId: string,
      proposalId: string,
      decision: { input: ProposalDecisionInput; decidedLines: AidLine[]; challenge: ProposalDecisionChallenge },
      operation: DraftOperation,
      actor: { account: string; officerId: string },
      now: number
    ): Promise<{ draft: StoredProposalDraft; decision: ProposalDecisionRecord }> {
      const { input, decidedLines, challenge } = decision;
      return mutateOnce(db, institutionId, operation, async (tx) => {
        const spent = rowsOf(
          await tx.execute(sql`
            UPDATE proposal_decision_challenges SET consumed_at = ${now}
            WHERE nonce = ${challenge.nonce.toLowerCase()} AND consumed_at IS NULL
            RETURNING nonce
          `)
        )[0];
        if (!spent) throw new DecisionChallengeSpentError();

        const currentRaw = rowsOf(
          await tx.execute(sql`
            SELECT * FROM proposal_drafts
            WHERE id = ${proposalId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!currentRaw) throw new ProposalDraftConflictError(proposalId);
        const current = draftFrom(currentRaw);
        if (current.version !== input.expectedVersion) throw new ProposalDraftConflictError(proposalId);
        if (current.status !== "READY_FOR_DECISION") {
          throw new ProposalStateConflictError(
            `Pengajuan berstatus "${current.status}" tidak dalam status siap keputusan (READY_FOR_DECISION).`
          );
        }

        const nextStatus: ProposalStatus = input.action === "APPROVE" ? "APPROVED" : "REJECTED";

        const updatedRaw = rowsOf(
          await tx.execute(sql`
            UPDATE proposal_drafts SET
              status = ${nextStatus},
              aid_lines_json = ${JSON.stringify(decidedLines)},
              revision_reason = ${input.rejectionReason},
              updated_at = ${now}
            WHERE id = ${proposalId} AND institution_id = ${institutionId} AND version = ${input.expectedVersion}
            RETURNING *
          `)
        )[0];

        await tx.execute(sql`
          UPDATE proposal_versions SET status = ${nextStatus}
          WHERE proposal_id = ${proposalId} AND version = ${current.version}
        `);

        // The unique (proposal_id, proposal_version) index refuses a second decision for this version.
        const decisionRow = rowsOf(
          await tx.execute(sql`
            INSERT INTO proposal_decisions (
              id, proposal_id, proposal_version, institution_id, action,
              decision_reference, decision_date, decision_document_id, decision_document_sha256,
              notes, rejection_reason, rights_digest, operator_officer_id, operator_account, signer_account,
              mandate_id, signature, created_at
            ) VALUES (
              ${`dec-${crypto.randomUUID()}`}, ${proposalId}, ${current.version}, ${institutionId}, ${input.action},
              ${input.decisionReference}, ${input.decisionDate},
              ${challenge.decisionDocumentId}, ${challenge.decisionDocumentSha256},
              ${input.notes}, ${input.rejectionReason}, ${challenge.rightsDigest}, ${actor.officerId}, ${actor.account.toLowerCase()}, ${input.signerAccount.toLowerCase()},
              ${input.mandateId}, ${input.signature}, ${now}
            )
            RETURNING *
          `)
        )[0];

        const outcome = input.action === "APPROVE" ? "Disetujui" : "Ditolak";
        await tx.execute(sql`
          INSERT INTO proposal_history (
            proposal_id, institution_id, version, from_status, to_status, action,
            actor_account, actor_officer_id, reason, notes, occurred_at
          ) VALUES (
            ${proposalId}, ${institutionId}, ${current.version}, ${current.status},
            ${nextStatus}, ${input.action}, ${actor.account.toLowerCase()}, ${actor.officerId},
            ${input.rejectionReason}, ${input.notes ?? `Keputusan: ${outcome} (${input.decisionReference})`},
            ${now}
          )
        `);

        return {
          draft: draftFrom(updatedRaw),
          decision: decisionRecordFrom(decisionRow),
        };
      });
    },

    async getProposalDecision(
      institutionId: string,
      proposalId: string
    ): Promise<ProposalDecisionRecord | null> {
      const row = rowsOf(
        await db.execute(sql`
          SELECT * FROM proposal_decisions
          WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId}
          ORDER BY created_at DESC
          LIMIT 1
        `)
      )[0];
      return row ? decisionRecordFrom(row) : null;
    },

    /**
     * The committed result of an earlier operation, if any. A decision's retry must
     * reach it before the route's pre-checks, which a decided proposal no longer passes.
     */
    async getProposalDraftOperation(
      institutionId: string,
      account: string,
      operationId: string
    ): Promise<{ requestHash: string; resultJson: string } | null> {
      const row = rowsOf(
        await db.execute(sql`
          SELECT request_hash, result_json FROM proposal_draft_operations
          WHERE institution_id = ${institutionId} AND account = ${account} AND operation_id = ${operationId}
        `)
      )[0];
      if (!row || !row.result_json) return null;
      return {
        requestHash: row.request_hash,
        resultJson: row.result_json,
      };
    },
  };
}

export type DisbursementStore = ReturnType<typeof createDisbursementStore>;

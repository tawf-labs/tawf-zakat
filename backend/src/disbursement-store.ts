/** Durable institution-scoped programs and versioned proposal drafts.
 * Save/delete and their retry result commit together. A retry returns the original
 * result, even after later edits; a new operation must use the current version.
 */

import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  LEGACY_COST_MIGRATION_STATEMENTS,
  OPERATIONAL_COST_SCHEMA_STATEMENTS,
  costItemFrom,
  fundingColumns,
  itemSnapshot,
  itemVersionFrom,
  loadOperationalCosts,
  loadReceipts,
  receiptFileFrom,
  receiptFileView,
  reimbursementFrom,
  type StoredReceiptFile,
} from "./operational-cost-sql";
import {
  operationalCostTotals,
  panjarRemainingIdr,
  panjarUsedIdr,
  summarizeHolders,
  validateCostItemInput,
  type CostIssue,
  type CostItemInput,
  type CostItemRecord,
  type CostItemVersionRecord,
  type HolderSummary,
  type OperationalCostTotals,
  type PanjarInput,
  type PanjarRecord,
  type ReceiptFileRecord,
  type ReceiptFileType,
  type ReceiptInput,
  type ReceiptRecord,
  type ReimbursementRecord,
} from "./operational-cost";
import {
  addDecimalStrings,
  approvedIdrOf,
  approvedQuantityOf,
  approvedUnitOf,
  calculateProposalRealizationSummary,
  compareDecimalStrings,
  computeRightsDigest,
  contactHintOf,
  decidedAidLines,
  DEFAULT_DISBURSEMENT_POLICY,
  evaluateRecurringAidWarnings,
  evidenceStatusOf,
  goodsValuationOf,
  REQUIRED_EVIDENCE_BY_METHOD,
  validateProposalForSubmission,
  type AidLine,
  type BastExaminationRecord,
  type Beneficiary,
  type ComplainantType,
  type ConfirmationMethod,
  type ConfirmationStatus,
  type DecisionBinding,
  type DisbursementMethod,
  type DisbursementPolicy,
  type DisputeExaminationRecord,
  type DisputeOutcome,
  type DisputeStatus,
  type DisputeSubject,
  type EvidenceAllocation,
  type ExaminationChecklist,
  type FundType,
  type OperationalAdvanceRecord,
  type OperationalExpenseRecord,
  type ProgramRecord,
  type ProgramStatus,
  type ProposalCompletenessIssue,
  type ProposalDecisionAction,
  type ProposalDecisionBasis,
  type ProposalDecisionChallenge,
  type ProposalDecisionDocument,
  type ProposalDecisionInput,
  type ProposalDecisionRecord,
  type ProposalDocumentCategory,
  type ProposalDocumentRecord,
  type ProposalHistoryAction,
  type ProposalHistoryRecord,
  type ProposalIssue,
  type ProposalPublicationInput,
  type ProposalRealizationSummary,
  type ProposalStatus,
  type RealizationChallenge,
  type RealizationDisputeRecord,
  type RealizationDocumentRecord,
  type RealizationDocumentType,
  type RealizationEvidenceStatus,
  type RealizationItemInput,
  type RealizationRecord,
  type RecurringAidMatch,
  type RecurringAidWarning,
  calculateRevisionDelta,
  validateRevisionFloor,
  calculateRemainderClosure,
  type ProposalClosureRecord,
  type ProposalRevisionRecord,
  type ProposalRevisionDelta,
} from "./disbursement";
import {
  maskNik,
  type RealizationItemData,
  type RealizationAdvanceItem,
  type RealizationExpenseItem,
  type RealizationDocumentRef,
  type RealizationDisputeRef,
  type RealizationSourceData,
} from "./realization-source";

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
  activeRevisionId: string | null;
  heldAidLineIds: string[];
  cancelReason: string | null;
  closureReason: string | null;
  remainderClosed: ProposalClosureRecord | null;
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
  activeRevisionId: string | null;
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

export class RealizationCapExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealizationCapExceededError";
  }
}

export class RealizationHeldForRevisionError extends Error {
  constructor(message = "Rincian bantuan sedang ditahan karena ada revisi pengajuan yang aktif.") {
    super(message);
    this.name = "RealizationHeldForRevisionError";
  }
}

export class ProposalRevisionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalRevisionConflictError";
  }
}

export class RevisionCapFloorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RevisionCapFloorError";
  }
}

/** The revision's target version was already taken by another decision; re-read and decide again. */
export class RevisionSupersededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RevisionSupersededError";
  }
}

export class RevisionNotFoundError extends Error {
  constructor(message = "Revisi pengajuan tidak ditemukan.") {
    super(message);
    this.name = "RevisionNotFoundError";
  }
}

export class ProposalClosureConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalClosureConflictError";
  }
}

export class ProposalCancellationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalCancellationConflictError";
  }
}

/** The realization, document, dispute or advance does not exist on this proposal of this institution. */
export class RealizationNotFoundError extends Error {
  constructor(message = "Realisasi tidak ditemukan pada pengajuan ini.") {
    super(message);
    this.name = "RealizationNotFoundError";
  }
}

/** The request names something the event cannot accept: a foreign line, the wrong evidence type, an excess amount. */
export class RealizationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealizationInputError";
  }
}

/**
 * The event's current state refuses the step: held by a dispute, already confirmed, evidence
 * still short, not a cash/goods handover, or overtaken by a concurrent change. `code` classifies
 * why - the batch BAST confirmation reads it to report each member's outcome honestly rather
 * than treating every refusal alike.
 */
export class RealizationStateError extends Error {
  constructor(
    message: string,
    readonly code?: "DISPUTED" | "ALREADY_CONFIRMED" | "NOT_EVIDENCED" | "WRONG_METHOD" | "STALE_VERSION"
  ) {
    super(message);
    this.name = "RealizationStateError";
  }
}

export class RealizationChallengeSpentError extends Error {
  constructor(message = "Tantangan konfirmasi sudah digunakan atau kedaluwarsa.") {
    super(message);
    this.name = "RealizationChallengeSpentError";
  }
}

export class RealizationOtpInvalidError extends Error {
  constructor(message = "Kode OTP salah atau tidak sah.") {
    super(message);
    this.name = "RealizationOtpInvalidError";
  }
}

/** Separation of duties: whoever recorded an event neither examines its BAST nor rules on its dispute. */
export class RealizationSelfExaminationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealizationSelfExaminationError";
  }
}

/** One member's result inside a batch BAST confirmation - never silently folded into the others. */
export type BastBatchOutcomeState =
  | "CONFIRMED"
  | "ALREADY_CONFIRMED"
  | "DISPUTED"
  | "NOT_EVIDENCED"
  | "SELF_EXAMINATION"
  | "NOT_CONFIRMABLE_METHOD"
  | "FAILED";

export type BastBatchOutcome = {
  realizationId: string;
  beneficiaryId: string;
  state: BastBatchOutcomeState;
  message?: string;
};

export type BastBatchConfirmationReport = {
  outcomes: BastBatchOutcome[];
  confirmedCount: number;
};

function bastBatchOutcomeStateOf(error: unknown): BastBatchOutcomeState {
  if (error instanceof RealizationSelfExaminationError) return "SELF_EXAMINATION";
  if (error instanceof RealizationStateError) {
    switch (error.code) {
      case "ALREADY_CONFIRMED": return "ALREADY_CONFIRMED";
      case "DISPUTED": return "DISPUTED";
      case "NOT_EVIDENCED": return "NOT_EVIDENCED";
      case "WRONG_METHOD": return "NOT_CONFIRMABLE_METHOD";
      default: return "FAILED";
    }
  }
  return "FAILED";
}

export type DraftOperation = { id: string; account: string; requestHash: string };
export type ProposalContributor = { account: string; officerId: string | null; version: number };

export type ProposalAccessScope = {
  institutionId: string;
  proposalId: string;
  account: string;
};

export type ProposalBeneficiaryListPreview = ProposalAccessScope & {
  id: string;
  baseVersion: number;
  mappingVersion: string;
  beneficiaries: Beneficiary[];
  aidLines: AidLine[];
  document: ProposalDocumentRecord;
  contentBase64: string;
  canApply: boolean;
  error: string | null;
  isIdentical: boolean;
};

export const BENEFICIARY_LIST_PREVIEW_TTL_SECONDS = 30 * 60;

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

type OperationLedger = "proposal_draft_operations" | "disbursement_realization_operations";

/** The unique insert waits for an in-flight retry before reading its committed result. */
/** The shape every submitted or published proposal version is frozen in. */
type FrozenSubmission = {
  current: StoredProposalDraft;
  policy: DisbursementPolicy;
  version: number;
  warnings: RecurringAidWarning[];
};

/**
 * Locks a DRAFT / REVISION_REQUIRED proposal, enforces the institution's completeness
 * policy and freezes the version with its documents and recurring-aid warnings. Shared by
 * submission for examination and by publication on an outside-app decision (ADR-0041),
 * so both freeze exactly the same evidence. Leaves the draft row and history to the caller.
 */
async function freezeSubmission(
  tx: { execute: (query: any) => Promise<any> },
  institutionId: string,
  proposalId: string,
  expectedVersion: number,
  actor: { account: string },
  now: number
): Promise<FrozenSubmission> {
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

  return { current, policy, version: submittedVersion, warnings };
}

/** Proposal states in which costs may be recorded: once aid is decided, and after it ends. */
const COST_RECORDING_STATUSES: ProposalStatus[] = ["APPROVED", "REMAINDER_CLOSED", "CANCELLED"];

/** A batch is a spreadsheet paste, not a bulk import: bounded so one request stays one transaction. */
export const MAX_COST_BATCH = 500;

export type CostRecordingResult =
  | { index: number; item: CostItemRecord }
  | { index: number; issues: CostIssue[] };

export type OperationalCostOverview = {
  items: CostItemRecord[];
  panjar: PanjarRecord[];
  reimbursements: ReimbursementRecord[];
  receipts: ReceiptRecord[];
  holders: HolderSummary[];
  totals: OperationalCostTotals;
};

type CostActor = { account: string; officerId: string };

/**
 * Serialises every cost write on the proposal row (the same lock realization and
 * reallocation take, #107 AC04) and refuses a proposal not yet decided.
 */
async function lockProposalForCosts(tx: Executor, institutionId: string, proposalId: string) {
  const row = rowsOf(await tx.execute(sql`
    SELECT id, status FROM proposal_drafts
    WHERE id = ${proposalId} AND institution_id = ${institutionId}
    FOR UPDATE
  `))[0];
  if (!row) throw new RealizationNotFoundError("Pengajuan tidak ditemukan.");
  if (!COST_RECORDING_STATUSES.includes(row.status as ProposalStatus)) {
    throw new ProposalStateConflictError(
      `Biaya operasional hanya dicatat pada pengajuan yang sudah disetujui/terbit; status pengajuan ini "${row.status}".`
    );
  }
}

async function activeOfficerIds(tx: Executor, institutionId: string): Promise<Set<string>> {
  return new Set(rowsOf(await tx.execute(sql`
    SELECT id FROM officer_profiles WHERE institution_id = ${institutionId} AND is_active = TRUE
  `)).map((row) => row.id as string));
}

/**
 * Database-side checks of a row that already passed `validateCostItemInput`: the holder is
 * an active officer of this institution, and a panjar row fits what that panjar has left.
 * `spent` carries this batch's earlier rows, so a paste cannot overdraw a panjar either.
 */
function fundingIssue(
  input: CostItemInput,
  officers: Set<string>,
  panjars: PanjarRecord[],
  items: CostItemRecord[],
  spent: Map<string, bigint>
): CostIssue | null {
  const source = input.fundingSource;
  if (source.kind === "TALANGAN" && !officers.has(source.holderOfficerId)) {
    return { field: "fundingSource", message: "Petugas yang menalangi tidak terdaftar sebagai petugas aktif lembaga ini." };
  }
  if (source.kind === "PANJAR") {
    const panjar = panjars.find((entry) => entry.id === source.panjarId);
    if (!panjar) return { field: "fundingSource", message: "Panjar yang dirujuk tidak ada pada pengajuan ini." };
    const remaining = panjarRemainingIdr(panjar, items) - (spent.get(panjar.id) ?? 0n);
    if (BigInt(input.amountIdr) > remaining) {
      return { field: "fundingSource", message: `Biaya melebihi sisa panjar ${panjar.cashOutRef} (Rp${remaining > 0n ? remaining : 0n}).` };
    }
  }
  return null;
}

/** A row may cite only a nota recorded on its own proposal. */
function receiptIssue(input: CostItemInput, receipts: ReceiptRecord[]): CostIssue | null {
  if (input.receiptId && !receipts.some((receipt) => receipt.id === input.receiptId)) {
    return { field: "receiptId", message: "Nota yang dirujuk tidak ada pada pengajuan ini." };
  }
  return null;
}

/** Once a recorded row cites a receipt, its files are evidence and can no longer be deleted. */
async function markReceiptEvidenced(tx: Executor, institutionId: string, receiptId: string | null, now: number) {
  if (!receiptId) return;
  await tx.execute(sql`
    UPDATE operational_cost_receipts SET evidenced_at = COALESCE(evidenced_at, ${now})
    WHERE id = ${receiptId} AND institution_id = ${institutionId}
  `);
}

async function insertItemVersion(
  tx: Executor,
  institutionId: string,
  item: CostItemRecord,
  change: "RECORD" | "CORRECT" | "VOID",
  reason: string | null,
  actor: CostActor,
  now: number
) {
  await tx.execute(sql`
    INSERT INTO operational_cost_item_versions (
      item_id, institution_id, version, change, item_json, reason, actor_officer_id, actor_account, at
    ) VALUES (
      ${item.id}, ${institutionId}, ${item.version}, ${change}, ${JSON.stringify(itemSnapshot(item, item.status))},
      ${reason}, ${actor.officerId}, ${actor.account.toLowerCase()}, ${now}
    )
  `);
}

/** The current item, locked, and refused when it may no longer change (ADR-0042). */
async function lockChangeableItem(tx: Executor, institutionId: string, proposalId: string, itemId: string, expectedVersion: number) {
  const row = rowsOf(await tx.execute(sql`
    SELECT * FROM operational_cost_items
    WHERE id = ${itemId} AND institution_id = ${institutionId} AND proposal_id = ${proposalId}
    FOR UPDATE
  `))[0];
  if (!row) throw new RealizationNotFoundError("Baris biaya tidak ditemukan pada pengajuan ini.");
  const item = costItemFrom(row);
  if (item.version !== expectedVersion) {
    throw new RealizationStateError("Baris biaya sudah diubah sejak versi yang Anda muat. Muat ulang sebelum mengoreksi.", "STALE_VERSION");
  }
  if (item.status === "VOIDED") throw new RealizationStateError("Baris biaya sudah dibatalkan dan tidak dapat diubah lagi.");
  if (item.reimbursementId) {
    throw new RealizationStateError("Talangan pada baris ini sudah diganti lembaga; baris tidak dapat dikoreksi atau dibatalkan.");
  }
  return item;
}

async function mutateOnce<T>(db: DisbursementDatabase, institutionId: string, operation: DraftOperation,
  mutate: (tx: { execute: (query: any) => Promise<any> }) => Promise<T>,
  ledger: OperationLedger = "proposal_draft_operations"): Promise<T> {
  const table = sql.identifier(ledger);
  return db.transaction(async tx => {
    const inserted = rowsOf(await tx.execute(sql`
      INSERT INTO ${table} (institution_id, account, operation_id, request_hash)
      VALUES (${institutionId}, ${operation.account}, ${operation.id}, ${operation.requestHash})
      ON CONFLICT DO NOTHING RETURNING operation_id
    `));
    if (!inserted.length) {
      const previous = rowsOf(await tx.execute(sql`
        SELECT request_hash, result_json FROM ${table}
        WHERE institution_id = ${institutionId} AND account = ${operation.account} AND operation_id = ${operation.id}
      `))[0];
      if (!previous || previous.request_hash !== operation.requestHash) throw new DraftOperationConflictError();
      return JSON.parse(previous.result_json) as T;
    }
    const result = await mutate(tx);
    await tx.execute(sql`
      UPDATE ${table} SET result_json = ${JSON.stringify(result)}
      WHERE institution_id = ${institutionId} AND account = ${operation.account} AND operation_id = ${operation.id}
    `);
    return result;
  });
}

/**
 * A version's content with the aid lines its approval decided, when the decision
 * recorded them. The submitted snapshot itself is never rewritten; versions
 * approved before the decision carried its lines read as they were submitted.
 */
export function withDecidedAidLines<T extends { aidLines?: AidLine[] }>(snapshot: T, decidedJson: string | null): T {
  if (!decidedJson) return snapshot;
  return { ...snapshot, aidLines: JSON.parse(decidedJson) as AidLine[] };
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
  activeRevisionId: row.active_revision_id ?? null,
  heldAidLineIds: JSON.parse(row.held_aid_lines_json ?? "[]"),
  cancelReason: row.cancel_reason ?? null,
  closureReason: row.closure_reason ?? null,
  remainderClosed: row.remainder_closed_json ? JSON.parse(row.remainder_closed_json) : null,
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
  activeRevisionId: row.active_revision_id ?? null,
  updatedAt: asSeconds(row.updated_at),
});

const revisionFrom = (row: any): ProposalRevisionRecord => ({
  id: row.id,
  proposalId: row.proposal_id,
  institutionId: row.institution_id,
  revisionNumber: Number(row.revision_number),
  fromVersion: Number(row.from_version),
  toVersion: Number(row.to_version),
  reason: row.reason,
  status: row.status as ProposalRevisionRecord["status"],
  beneficiaries: JSON.parse(row.beneficiaries_json || "[]"),
  aidLines: JSON.parse(row.aid_lines_json || "[]"),
  delta: JSON.parse(row.delta_json || "{}"),
  heldAidLineIds: JSON.parse(row.held_aid_line_ids_json || "[]"),
  examinationNotes: row.examination_notes ?? null,
  examinationChecklist: row.examination_checklist_json ? JSON.parse(row.examination_checklist_json) : null,
  examinedBy: row.examined_by ?? null,
  examinedByOfficerId: row.examined_by_officer_id ?? null,
  examinedAt: row.examined_at ? asSeconds(row.examined_at) : null,
  decisionReference: row.decision_reference ?? null,
  decisionDate: row.decision_date ?? null,
  rejectionReason: row.rejection_reason ?? null,
  createdBy: row.created_by,
  createdByOfficerId: row.created_by_officer_id ?? null,
  createdAt: asSeconds(row.created_at),
  updatedAt: asSeconds(row.updated_at),
});

type QueueAccess = (target: Pick<StoredProposalDraft, "programId" | "aidLines">) => boolean;
const permittedRows = (rows: any[], allows: QueueAccess) => rows.filter(row => allows({
  programId: row.program_id ?? null, aidLines: JSON.parse(row.aid_lines_json || "[]"),
}));

async function consumeBeneficiaryListPreview(
  tx: { execute: DisbursementDatabase["execute"] },
  scope: ProposalAccessScope,
  previewId: string,
  now: number,
  storageRef?: string | null,
) {
  const row = rowsOf(
    await tx.execute(sql`SELECT id FROM proposal_beneficiary_list_previews
    WHERE id = ${previewId} AND institution_id = ${scope.institutionId} AND proposal_id = ${scope.proposalId}
      AND account = ${scope.account} AND expires_at > ${now} FOR UPDATE`),
  )[0];
  if (!row)
    throw new ProposalStateConflictError(
      "Pratinjau sudah kedaluwarsa atau telah digunakan. Baca ulang berkas.",
    );
  if (storageRef) {
    const file = rowsOf(
      await tx.execute(sql`SELECT storage_ref FROM proposal_preview_file_cleanup
      WHERE storage_ref = ${storageRef} AND expires_at > ${now} FOR UPDATE`),
    )[0];
    if (!file)
      throw new ProposalStateConflictError(
        "Berkas pratinjau sudah kedaluwarsa. Baca ulang berkas.",
      );
    await tx.execute(
      sql`DELETE FROM proposal_preview_file_cleanup WHERE storage_ref = ${storageRef}`,
    );
  }
  await tx.execute(
    sql`DELETE FROM proposal_beneficiary_list_previews WHERE id = ${previewId}`,
  );
}

async function recordDraftContributors(tx: { execute: DisbursementDatabase["execute"] }, previous: StoredProposalDraft | null,
  saved: StoredProposalDraft, operation: DraftOperation) {
  if (previous && materialContents(previous) === materialContents(saved)) {
    await tx.execute(sql`
      INSERT INTO proposal_draft_contributors (draft_id, version, account, officer_id)
      SELECT draft_id, ${saved.version}, account, officer_id FROM proposal_draft_contributors
      WHERE draft_id = ${saved.id} AND version = ${previous.version}
    `);
  } else {
    // Attribution is committed with the actual version; it never depends on an active membership later.
    await tx.execute(sql`
      INSERT INTO proposal_draft_contributors (draft_id, version, account, officer_id)
      VALUES (${saved.id}, ${saved.version}, ${operation.account.toLowerCase()},
        (SELECT officer_id FROM institution_memberships WHERE institution_id = ${saved.institutionId}
          AND account_address = ${operation.account.toLowerCase()}))
    `);
  }
}

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

async function insertProposalDocument(tx: { execute: DisbursementDatabase["execute"] }, doc: ProposalDocumentRecord): Promise<ProposalDocumentRecord> {
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
}

const policyFrom = (row: any, institutionId: string): DisbursementPolicy => {
  if (!row) return DEFAULT_DISBURSEMENT_POLICY(institutionId);
  return {
    institutionId: row.institution_id,
    requireProposalLetter: Boolean(row.require_proposal_letter),
    requireRecipientVerification: Boolean(row.require_recipient_verification),
    decisionOutsideApp: Boolean(row.decision_outside_app),
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
  basis: (row.basis ?? "SIGNED_IN_APP") as ProposalDecisionBasis,
  decisionDocumentId: row.decision_document_id ?? null,
  decisionDocumentSha256: row.decision_document_sha256 ?? null,
  notes: row.notes ?? null,
  rejectionReason: row.rejection_reason ?? null,
  rightsDigest: row.rights_digest,
  operatorOfficerId: row.operator_officer_id,
  operatorAccount: row.operator_account,
  signerAccount: row.signer_account ?? null,
  mandateId: row.mandate_id,
  signature: row.signature ?? null,
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

const realizationRecordFrom = (row: any): RealizationRecord => ({
  id: row.id,
  institutionId: row.institution_id,
  proposalId: row.proposal_id,
  proposalVersion: Number(row.proposal_version),
  aidLineId: row.aid_line_id,
  beneficiaryId: row.beneficiary_id,
  batchGroupId: row.batch_group_id ?? null,
  paymentRecipient: row.payment_recipient_json ? JSON.parse(row.payment_recipient_json) : null,
  method: row.method as DisbursementMethod,
  amountIdr: row.amount_idr ?? null,
  quantity: row.quantity ?? null,
  unit: row.unit ?? null,
  reportedAt: asSeconds(row.reported_at),
  recordedAt: asSeconds(row.recorded_at),
  operatorAccount: row.operator_account,
  operatorOfficerId: row.operator_officer_id,
  notes: row.notes ?? null,
  evidenceStatus: row.evidence_status as RealizationEvidenceStatus,
  confirmationStatus: row.confirmation_status as ConfirmationStatus,
  confirmationMethod: (row.confirmation_method as ConfirmationMethod | null) ?? null,
  version: Number(row.version),
  createdAt: asSeconds(row.created_at),
  updatedAt: asSeconds(row.updated_at),
});

const realizationDocumentFrom = (row: any, allocations: EvidenceAllocation[]): RealizationDocumentRecord => ({
  id: row.id,
  proposalId: row.proposal_id,
  realizationId: row.realization_id,
  batchGroupId: row.batch_group_id ?? null,
  institutionId: row.institution_id,
  documentType: row.document_type as RealizationDocumentType,
  fileName: row.file_name,
  mimeType: row.mime_type,
  sizeBytes: Number(row.size_bytes),
  contentSha256: row.content_sha256 as `0x${string}`,
  storageRef: row.storage_ref,
  uploadedBy: row.uploaded_by,
  allocations,
  createdAt: asSeconds(row.created_at),
});

const realizationChallengeFrom = (row: any): RealizationChallenge => ({
  nonce: row.nonce,
  institutionId: row.institution_id,
  proposalId: row.proposal_id,
  proposalVersion: Number(row.proposal_version),
  realizationId: row.realization_id,
  realizationVersion: Number(row.realization_version),
  beneficiaryId: row.beneficiary_id,
  contactHint: row.contact_hint,
  confirmer: row.confirmer_json ? JSON.parse(row.confirmer_json) : null,
  aidType: row.aid_type,
  amountIdr: row.amount_idr ?? null,
  quantity: row.quantity ?? null,
  unit: row.unit ?? null,
  codeHash: row.code_hash,
  attempts: Number(row.attempts),
  issuedAt: asSeconds(row.issued_at),
  expiresAt: asSeconds(row.expires_at),
  consumedAt: row.consumed_at == null ? null : asSeconds(row.consumed_at),
});

const bastExaminationFrom = (row: any): BastExaminationRecord => ({
  id: row.id,
  realizationId: row.realization_id,
  institutionId: row.institution_id,
  verifierOfficerId: row.verifier_officer_id,
  verifierAccount: row.verifier_account,
  notes: row.notes,
  verifiedAt: asSeconds(row.verified_at),
});

const disputeExaminationFrom = (row: any): DisputeExaminationRecord => ({
  id: row.id,
  disputeId: row.dispute_id,
  outcome: row.outcome as DisputeOutcome,
  notes: row.notes,
  examinerOfficerId: row.examiner_officer_id,
  examinerAccount: row.examiner_account,
  examinedAt: asSeconds(row.examined_at),
});

const realizationDisputeFrom = (row: any, examinations: DisputeExaminationRecord[]): RealizationDisputeRecord => ({
  id: row.id,
  proposalId: row.proposal_id,
  realizationId: row.realization_id,
  aidLineId: row.aid_line_id,
  institutionId: row.institution_id,
  complainantType: row.complainant_type as ComplainantType,
  subject: row.subject as DisputeSubject,
  reason: row.reason,
  disputedAmountIdr: row.disputed_amount_idr ?? null,
  disputedQuantity: row.disputed_quantity ?? null,
  disputedUnit: row.disputed_unit ?? null,
  status: row.status as DisputeStatus,
  recordedByOfficerId: row.recorded_by_officer_id,
  createdAt: asSeconds(row.created_at),
  examinations,
});

// The old uang muka and biaya shapes (#95), read from the ADR-0042 rows they were carried
// into (#128), so the old GET routes stay consistent with the tab during the transition.
const advanceFrom = (
  institutionId: string,
  panjar: PanjarRecord,
  items: CostItemRecord[],
  account: string
): OperationalAdvanceRecord => ({
  id: panjar.id,
  institutionId,
  proposalId: panjar.proposalId,
  officerId: panjar.holderOfficerId,
  officerAccount: account,
  amountIdr: panjar.amountIdr,
  purpose: panjar.purpose,
  reference: panjar.cashOutRef,
  accountedIdr: panjarUsedIdr(panjar.id, items),
  unaccountedIdr: panjarRemainingIdr(panjar, items).toString(),
  issuedAt: panjar.recordedAt,
});

const expenseFrom = (institutionId: string, item: CostItemRecord, documentRef: string): OperationalExpenseRecord => ({
  id: item.id,
  institutionId,
  proposalId: item.proposalId,
  advanceId: item.fundingSource.kind === "PANJAR" ? item.fundingSource.panjarId : null,
  amountIdr: item.amountIdr,
  purpose: item.purpose,
  payee: item.payee,
  documentRef,
  recordedByOfficerId: item.recordedByOfficerId,
  recordedAt: item.recordedAt,
});

type Executor = { execute: (query: any) => Promise<any> };

async function lockRealization(tx: Executor, institutionId: string, proposalId: string, realizationId: string) {
  const row = rowsOf(await tx.execute(sql`
    SELECT * FROM disbursement_realizations
    WHERE id = ${realizationId} AND institution_id = ${institutionId} AND proposal_id = ${proposalId}
    FOR UPDATE
  `))[0];
  if (!row) throw new RealizationNotFoundError();
  return realizationRecordFrom(row);
}

/** Every status change bumps the version, so whoever bound the earlier state (an OTP, a report source) sees it moved. */
async function updateRealizationStatus(
  tx: Executor,
  current: RealizationRecord,
  next: Pick<RealizationRecord, "evidenceStatus" | "confirmationStatus" | "confirmationMethod">,
  now: number
) {
  const row = rowsOf(await tx.execute(sql`
    UPDATE disbursement_realizations
    SET evidence_status = ${next.evidenceStatus},
        confirmation_status = ${next.confirmationStatus},
        confirmation_method = ${next.confirmationMethod},
        version = version + 1,
        updated_at = ${now}
    WHERE id = ${current.id} AND institution_id = ${current.institutionId} AND version = ${current.version}
    RETURNING *
  `))[0];
  if (!row) throw new RealizationStateError("Realisasi sudah berubah. Muat ulang sebelum melanjutkan.", "STALE_VERSION");
  return realizationRecordFrom(row);
}

/** Cash or goods handovers are confirmed by their recipients, once, and never while a dispute holds them. */
function assertRecipientConfirmable(realization: RealizationRecord) {
  if (realization.method !== "CASH" && realization.method !== "GOODS_HANDOVER") {
    throw new RealizationStateError(
      "Transfer atau pembayaran penyedia dibuktikan dengan bukti pembayaran, bukan konfirmasi penerima.",
      "WRONG_METHOD"
    );
  }
  if (realization.confirmationStatus === "DISPUTED") {
    throw new RealizationStateError("Konfirmasi ditahan karena realisasi ini sedang diperselisihkan.", "DISPUTED");
  }
  if (realization.confirmationStatus === "CONFIRMED") {
    throw new RealizationStateError("Penerimaan realisasi ini sudah dikonfirmasi.", "ALREADY_CONFIRMED");
  }
}

async function evidenceAllocationsOf(tx: Executor, institutionId: string, realizationId: string) {
  return rowsOf(await tx.execute(sql`
    SELECT d.document_type, a.amount_idr, a.quantity, a.unit
    FROM disbursement_realization_document_allocations a
    JOIN disbursement_realization_documents d ON d.id = a.document_id
    WHERE a.realization_id = ${realizationId} AND a.institution_id = ${institutionId}
  `)).map((row) => {
    const item: { documentType: RealizationDocumentType; amountIdr: string | null; quantity?: string | null; unit?: string | null } = {
      documentType: row.document_type as RealizationDocumentType,
      amountIdr: (row.amount_idr as string) ?? null,
    };
    if (row.quantity != null) item.quantity = row.quantity as string;
    if (row.unit != null) item.unit = row.unit as string;
    return item;
  });
}

/**
 * The BAST-examination step itself, shared by the single-realization route and the batch
 * confirmation below - one rule, so a batch of a thousand rows can never confirm something the
 * single-item route would have refused.
 */
async function performBastExamination(
  tx: Executor,
  institutionId: string,
  proposalId: string,
  realizationId: string,
  notes: string,
  actor: { account: string; officerId: string },
  now: number
): Promise<{ examination: BastExaminationRecord; realization: RealizationRecord }> {
  const realization = await lockRealization(tx, institutionId, proposalId, realizationId);
  if (realization.operatorOfficerId === actor.officerId) {
    throw new RealizationSelfExaminationError("Petugas pencatat tidak dapat memverifikasi BAST miliknya sendiri.");
  }
  assertRecipientConfirmable(realization);
  const receipts = (await evidenceAllocationsOf(tx, institutionId, realizationId))
    .filter((allocation) => allocation.documentType === "RECEIPT_OR_BAST");
  if (realization.quantity != null) {
    const totalQty = receipts
      .filter((receipt) => receipt.quantity != null)
      .reduce((total, receipt) => addDecimalStrings(total, receipt.quantity!), "0");
    if (compareDecimalStrings(totalQty, realization.quantity) !== 0) {
      throw new RealizationStateError(
        "Lengkapi alokasi tanda terima atau BAST untuk seluruh kuantitas sebelum konfirmasi penuh.",
        "NOT_EVIDENCED"
      );
    }
  } else {
    if (receipts.reduce((total, receipt) => total + BigInt(receipt.amountIdr ?? 0), 0n) !== BigInt(realization.amountIdr!)) {
      throw new RealizationStateError(
        "Lengkapi alokasi tanda terima atau BAST untuk seluruh nominal sebelum konfirmasi penuh.",
        "NOT_EVIDENCED"
      );
    }
  }

  const examinationRow = rowsOf(await tx.execute(sql`
    INSERT INTO disbursement_realization_bast_examinations (
      id, realization_id, institution_id, verifier_officer_id, verifier_account, notes, verified_at
    ) VALUES (
      ${`bast-exam-${crypto.randomUUID()}`}, ${realizationId}, ${institutionId}, ${actor.officerId},
      ${actor.account.toLowerCase()}, ${notes}, ${now}
    )
    RETURNING *
  `))[0];

  return {
    examination: bastExaminationFrom(examinationRow),
    realization: await updateRealizationStatus(tx, realization, {
      ...realization,
      confirmationStatus: "CONFIRMED",
      confirmationMethod: "BAST_EXAMINED",
    }, now),
  };
}

async function allocationsByDocument(tx: Executor, institutionId: string, documentIds: string[]) {
  const byDocument = new Map<string, EvidenceAllocation[]>();
  if (!documentIds.length) return byDocument;
  const rows = rowsOf(await tx.execute(sql`
    SELECT document_id, realization_id, amount_idr, quantity, unit FROM disbursement_realization_document_allocations
    WHERE institution_id = ${institutionId} AND document_id IN (${sql.join(documentIds.map((id) => sql`${id}`), sql`, `)})
    ORDER BY realization_id
  `));
  for (const row of rows) {
    const list = byDocument.get(row.document_id) ?? [];
    const allocation: EvidenceAllocation = { realizationId: row.realization_id, amountIdr: row.amount_idr ?? null };
    if (row.quantity != null) allocation.quantity = row.quantity;
    if (row.unit != null) allocation.unit = row.unit;
    list.push(allocation);
    byDocument.set(row.document_id, list);
  }
  return byDocument;
}

async function disputesWithExaminations(tx: Executor, institutionId: string, disputeRows: any[]) {
  if (!disputeRows.length) return [];
  const ids = disputeRows.map((row) => row.id as string);
  const examinationRows = rowsOf(await tx.execute(sql`
    SELECT * FROM disbursement_realization_dispute_examinations
    WHERE institution_id = ${institutionId} AND dispute_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    ORDER BY seq ASC
  `));
  return disputeRows.map((row) =>
    realizationDisputeFrom(row, examinationRows.filter((exam) => exam.dispute_id === row.id).map(disputeExaminationFrom))
  );
}

async function realizationSummaryOf(tx: Executor, institutionId: string, draft: StoredProposalDraft) {
  const realizations = rowsOf(await tx.execute(sql`
    SELECT * FROM disbursement_realizations
    WHERE institution_id = ${institutionId} AND proposal_id = ${draft.id}
    ORDER BY recorded_at ASC, id ASC
  `)).map(realizationRecordFrom);
  // Panjar net of what came back counts as advances, every live cost row as an expense.
  const costState = await loadOperationalCosts(tx, institutionId, draft.id);
  const costs = operationalCostTotals(costState.items, costState.panjar);
  const advances = [{ amountIdr: costs.panjarNetIdr }];
  const expenses = [{ amountIdr: costs.totalItemsIdr }];
  return calculateProposalRealizationSummary(
    {
      ...draft,
      status: draft.status,
      heldAidLineIds: draft.heldAidLineIds,
      activeRevisionId: draft.activeRevisionId,
      closure: draft.remainderClosed,
    },
    realizations,
    advances,
    expenses
  );
}

const MAX_OTP_ATTEMPTS = 5;

const sameHash = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

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
  `ALTER TABLE proposal_drafts ADD COLUMN IF NOT EXISTS active_revision_id TEXT;`,
  `ALTER TABLE proposal_drafts ADD COLUMN IF NOT EXISTS held_aid_lines_json TEXT NOT NULL DEFAULT '[]';`,
  `ALTER TABLE proposal_drafts ADD COLUMN IF NOT EXISTS cancel_reason TEXT;`,
  `ALTER TABLE proposal_drafts ADD COLUMN IF NOT EXISTS closure_reason TEXT;`,
  `ALTER TABLE proposal_drafts ADD COLUMN IF NOT EXISTS remainder_closed_json TEXT;`,
  `CREATE TABLE IF NOT EXISTS proposal_revisions (
     id TEXT PRIMARY KEY,
     proposal_id TEXT NOT NULL REFERENCES proposal_drafts(id) ON DELETE CASCADE,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     revision_number INTEGER NOT NULL,
     from_version INTEGER NOT NULL,
     to_version INTEGER NOT NULL,
     reason TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'SUBMITTED',
     beneficiaries_json TEXT NOT NULL DEFAULT '[]',
     aid_lines_json TEXT NOT NULL DEFAULT '[]',
     delta_json TEXT NOT NULL DEFAULT '{}',
     held_aid_line_ids_json TEXT NOT NULL DEFAULT '[]',
     examination_notes TEXT,
     examination_checklist_json TEXT,
     examined_by TEXT,
     examined_at BIGINT,
     decision_reference TEXT,
     decision_date TEXT,
     rejection_reason TEXT,
     created_by TEXT NOT NULL,
     created_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL
   );`,
  // Who materially composed a revised version, so a decision on it can refuse its own authors.
  `ALTER TABLE proposal_revisions ADD COLUMN IF NOT EXISTS created_by_officer_id TEXT;`,
  `ALTER TABLE proposal_revisions ADD COLUMN IF NOT EXISTS examined_by_officer_id TEXT;`,
  `CREATE INDEX IF NOT EXISTS proposal_revisions_by_proposal ON proposal_revisions (institution_id, proposal_id, created_at DESC);`,
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
  `CREATE TABLE IF NOT EXISTS proposal_beneficiary_list_previews (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     proposal_id TEXT NOT NULL REFERENCES proposal_drafts (id) ON DELETE CASCADE,
     account TEXT NOT NULL,
     payload_ciphertext TEXT NOT NULL,
     created_at BIGINT NOT NULL,
     expires_at BIGINT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS proposal_beneficiary_list_preview_expiry
     ON proposal_beneficiary_list_previews (expires_at);`,
  `CREATE INDEX IF NOT EXISTS proposal_beneficiary_list_preview_owner
     ON proposal_beneficiary_list_previews (institution_id, proposal_id, account);`,
  `CREATE TABLE IF NOT EXISTS proposal_preview_file_cleanup (
     storage_ref TEXT PRIMARY KEY,
     created_at BIGINT NOT NULL,
     expires_at BIGINT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS proposal_preview_file_cleanup_expiry ON proposal_preview_file_cleanup (expires_at);`,
  `DO $$ BEGIN
     IF to_regclass('proposal_roster_previews') IS NOT NULL THEN
       INSERT INTO proposal_preview_file_cleanup (storage_ref, created_at, expires_at)
       SELECT DISTINCT payload_json::jsonb->'document'->>'storageRef', 0, 0
       FROM proposal_roster_previews
       WHERE payload_json::jsonb->'document'->>'storageRef' IS NOT NULL
       ON CONFLICT DO NOTHING;
       DROP TABLE proposal_roster_previews;
     END IF;
   END $$;`,
  `CREATE INDEX IF NOT EXISTS proposal_draft_beneficiary_ids
     ON proposal_drafts USING GIN ((beneficiaries_json::jsonb) jsonb_path_ops);`,
  `CREATE INDEX IF NOT EXISTS proposal_draft_aid_line_ids
     ON proposal_drafts USING GIN ((aid_lines_json::jsonb) jsonb_path_ops);`,
  `CREATE INDEX IF NOT EXISTS proposal_revision_beneficiary_ids
     ON proposal_revisions USING GIN ((beneficiaries_json::jsonb) jsonb_path_ops);`,
  `CREATE INDEX IF NOT EXISTS proposal_revision_aid_line_ids
     ON proposal_revisions USING GIN ((aid_lines_json::jsonb) jsonb_path_ops);`,
  `CREATE TABLE IF NOT EXISTS proposal_draft_operations (
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     account TEXT NOT NULL,
     operation_id TEXT NOT NULL,
     request_hash TEXT NOT NULL,
     result_json TEXT,
     PRIMARY KEY (institution_id, account, operation_id)
   );`,
  `UPDATE proposal_draft_operations SET result_json =
     (result_json::jsonb || jsonb_build_object('kind', 'REVISION'))::TEXT
     WHERE result_json IS NOT NULL AND result_json::jsonb ? 'fromVersion' AND NOT result_json::jsonb ? 'kind';`,
  `UPDATE proposal_draft_operations SET result_json =
     (result_json::jsonb || jsonb_build_object('kind', 'DRAFT'))::TEXT
     WHERE result_json IS NOT NULL AND result_json::jsonb ? 'draft' AND NOT result_json::jsonb ? 'kind';`,
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
  // FALSE keeps a policy an institution already saved exactly as it was; a new
  // institution without a saved policy gets the code default instead (ADR-0040).
  `ALTER TABLE institution_disbursement_policies ADD COLUMN IF NOT EXISTS require_recipient_verification BOOLEAN NOT NULL DEFAULT FALSE;`,
  // Same reasoning as above: a saved policy keeps deciding in the app (ADR-0041).
  `ALTER TABLE institution_disbursement_policies ADD COLUMN IF NOT EXISTS decision_outside_app BOOLEAN NOT NULL DEFAULT FALSE;`,
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
  // #93 allowed one decision per version. Cancellation and remainder closure are decided on the
  // version their approval already occupies, so the invariant widens to one decision per action.
  // Which actions may follow which is still enforced by the status guards, not by this index.
  `DROP INDEX IF EXISTS proposal_decisions_one_per_version;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS proposal_decisions_one_per_version_action ON proposal_decisions (proposal_id, proposal_version, action);`,
  // The aid lines an approval fixed, exactly as its rights digest covers them. The version's
  // data_json stays the submitted content; the decision carries what was decided on it.
  `ALTER TABLE proposal_decisions ADD COLUMN IF NOT EXISTS decided_aid_lines_json TEXT;`,
  // A decision taken outside the app (ADR-0041) has no signer, signature or SK document here.
  `ALTER TABLE proposal_decisions ADD COLUMN IF NOT EXISTS basis TEXT NOT NULL DEFAULT 'SIGNED_IN_APP';`,
  `ALTER TABLE proposal_decisions ALTER COLUMN decision_document_id DROP NOT NULL;`,
  `ALTER TABLE proposal_decisions ALTER COLUMN decision_document_sha256 DROP NOT NULL;`,
  `ALTER TABLE proposal_decisions ALTER COLUMN signer_account DROP NOT NULL;`,
  `ALTER TABLE proposal_decisions ALTER COLUMN signature DROP NOT NULL;`,
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
  `CREATE TABLE IF NOT EXISTS disbursement_realizations (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions (id),
      proposal_id TEXT NOT NULL REFERENCES proposal_drafts (id),
      proposal_version INTEGER NOT NULL,
      aid_line_id TEXT NOT NULL,
      beneficiary_id TEXT NOT NULL,
      batch_group_id TEXT,
      payment_recipient_json TEXT,
      method TEXT NOT NULL,
      amount_idr TEXT,
      quantity TEXT,
      unit TEXT,
      reported_at BIGINT NOT NULL,
      recorded_at BIGINT NOT NULL,
      operator_account TEXT NOT NULL,
      operator_officer_id TEXT NOT NULL REFERENCES officer_profiles (id),
      notes TEXT,
      evidence_status TEXT NOT NULL DEFAULT 'EVIDENCE_PENDING',
      confirmation_status TEXT NOT NULL DEFAULT 'UNCONFIRMED',
      confirmation_method TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );`,
  `CREATE INDEX IF NOT EXISTS disbursement_realizations_by_proposal ON disbursement_realizations (institution_id, proposal_id, aid_line_id);`,
  `CREATE TABLE IF NOT EXISTS disbursement_realization_documents (
      id TEXT PRIMARY KEY,
      seq BIGINT GENERATED ALWAYS AS IDENTITY,
      institution_id TEXT NOT NULL REFERENCES institutions (id),
      proposal_id TEXT NOT NULL REFERENCES proposal_drafts (id),
      realization_id TEXT NOT NULL REFERENCES disbursement_realizations (id),
      batch_group_id TEXT,
      document_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      content_sha256 TEXT NOT NULL,
      storage_ref TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );`,
  `CREATE INDEX IF NOT EXISTS disbursement_realization_documents_by_proposal ON disbursement_realization_documents (institution_id, proposal_id);`,
  `CREATE TABLE IF NOT EXISTS disbursement_realization_document_allocations (
      document_id TEXT NOT NULL REFERENCES disbursement_realization_documents (id),
      realization_id TEXT NOT NULL REFERENCES disbursement_realizations (id),
      institution_id TEXT NOT NULL REFERENCES institutions (id),
      amount_idr TEXT,
      quantity TEXT,
      unit TEXT,
      PRIMARY KEY (document_id, realization_id)
    );`,
  `CREATE INDEX IF NOT EXISTS disbursement_realization_allocations_by_realization ON disbursement_realization_document_allocations (institution_id, realization_id);`,
  `CREATE TABLE IF NOT EXISTS disbursement_realization_challenges (
      nonce TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions (id),
      proposal_id TEXT NOT NULL REFERENCES proposal_drafts (id),
      proposal_version INTEGER NOT NULL,
      realization_id TEXT NOT NULL REFERENCES disbursement_realizations (id),
      realization_version INTEGER NOT NULL,
      beneficiary_id TEXT NOT NULL,
      contact_hint TEXT NOT NULL,
      confirmer_json TEXT,
      aid_type TEXT NOT NULL,
      amount_idr TEXT,
      quantity TEXT,
      unit TEXT,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      issued_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      consumed_at BIGINT
    );`,
  `ALTER TABLE disbursement_realization_challenges ADD COLUMN IF NOT EXISTS confirmer_json TEXT;`,
  `ALTER TABLE disbursement_realizations ADD COLUMN IF NOT EXISTS quantity TEXT;`,
  `ALTER TABLE disbursement_realizations ADD COLUMN IF NOT EXISTS unit TEXT;`,
  `ALTER TABLE disbursement_realizations ALTER COLUMN amount_idr DROP NOT NULL;`,
  `ALTER TABLE disbursement_realization_document_allocations ADD COLUMN IF NOT EXISTS quantity TEXT;`,
  `ALTER TABLE disbursement_realization_document_allocations ADD COLUMN IF NOT EXISTS unit TEXT;`,
  `ALTER TABLE disbursement_realization_document_allocations ALTER COLUMN amount_idr DROP NOT NULL;`,
  `ALTER TABLE disbursement_realization_challenges ADD COLUMN IF NOT EXISTS quantity TEXT;`,
  `ALTER TABLE disbursement_realization_challenges ADD COLUMN IF NOT EXISTS unit TEXT;`,
  `ALTER TABLE disbursement_realization_challenges ALTER COLUMN amount_idr DROP NOT NULL;`,
  `CREATE TABLE IF NOT EXISTS disbursement_realization_bast_examinations (
      id TEXT PRIMARY KEY,
      realization_id TEXT NOT NULL REFERENCES disbursement_realizations (id),
      institution_id TEXT NOT NULL REFERENCES institutions (id),
      verifier_officer_id TEXT NOT NULL REFERENCES officer_profiles (id),
      verifier_account TEXT NOT NULL,
      notes TEXT NOT NULL,
      verified_at BIGINT NOT NULL
    );`,
  `CREATE TABLE IF NOT EXISTS disbursement_realization_disputes (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions (id),
      proposal_id TEXT NOT NULL REFERENCES proposal_drafts (id),
      realization_id TEXT NOT NULL REFERENCES disbursement_realizations (id),
      aid_line_id TEXT NOT NULL,
      complainant_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      reason TEXT NOT NULL,
      disputed_amount_idr TEXT,
      disputed_quantity TEXT,
      disputed_unit TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN',
      recorded_by_officer_id TEXT NOT NULL REFERENCES officer_profiles (id),
      created_at BIGINT NOT NULL
    );`,
  `ALTER TABLE disbursement_realization_disputes ADD COLUMN IF NOT EXISTS disputed_quantity TEXT;`,
  `ALTER TABLE disbursement_realization_disputes ADD COLUMN IF NOT EXISTS disputed_unit TEXT;`,
  `ALTER TABLE disbursement_realization_disputes ALTER COLUMN disputed_amount_idr DROP NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS disbursement_realization_disputes_by_realization ON disbursement_realization_disputes (institution_id, realization_id);`,
  `CREATE TABLE IF NOT EXISTS disbursement_realization_dispute_examinations (
     id TEXT PRIMARY KEY,
     seq BIGINT GENERATED ALWAYS AS IDENTITY,
     dispute_id TEXT NOT NULL REFERENCES disbursement_realization_disputes (id),
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     outcome TEXT NOT NULL,
     notes TEXT NOT NULL,
     examiner_officer_id TEXT NOT NULL REFERENCES officer_profiles (id),
     examiner_account TEXT NOT NULL,
     examined_at BIGINT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS disbursement_realization_advances (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     proposal_id TEXT NOT NULL REFERENCES proposal_drafts (id),
     officer_id TEXT NOT NULL REFERENCES officer_profiles (id),
     officer_account TEXT NOT NULL,
     amount_idr TEXT NOT NULL,
     purpose TEXT NOT NULL,
     reference TEXT NOT NULL,
     issued_at BIGINT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS disbursement_realization_expenses (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     proposal_id TEXT NOT NULL REFERENCES proposal_drafts (id),
     advance_id TEXT REFERENCES disbursement_realization_advances (id),
     amount_idr TEXT NOT NULL,
     purpose TEXT NOT NULL,
     payee TEXT NOT NULL,
     document_ref TEXT NOT NULL,
     recorded_by_officer_id TEXT NOT NULL REFERENCES officer_profiles (id),
     recorded_at BIGINT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS disbursement_realization_operations (
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     account TEXT NOT NULL,
     operation_id TEXT NOT NULL,
     request_hash TEXT NOT NULL,
     result_json TEXT,
     PRIMARY KEY (institution_id, account, operation_id)
   );`,
  ...OPERATIONAL_COST_SCHEMA_STATEMENTS,
  ...LEGACY_COST_MIGRATION_STATEMENTS,
] as const;

/** What cancellation and remainder closure both carry: a signed institutional decision. */
export type ProposalTerminationInput = {
  decisionReference: string;
  decisionDate: string;
  decisionDocumentId: string;
  decisionDocumentSha256: `0x${string}`;
  mandateId: string;
  signature: string;
  signerAccount: string;
  reason: string;
  /** An optional free-text note, kept apart from the stated reason. */
  notes?: string | null;
  expectedVersion: number;
  challenge: ProposalDecisionChallenge;
};

/**
 * Spend the challenge, then lock the proposal and confirm it is the approved version that
 * was signed. Shared by cancellation and remainder closure, which differ only in what they
 * then require of the realizations.
 */
async function lockApprovedProposalForTermination(
  tx: { execute: (query: any) => Promise<any> },
  institutionId: string,
  proposalId: string,
  input: ProposalTerminationInput,
  now: number,
  verb: string
): Promise<StoredProposalDraft> {
  const spent = rowsOf(
    await tx.execute(sql`
      UPDATE proposal_decision_challenges SET consumed_at = ${now}
      WHERE nonce = ${input.challenge.nonce.toLowerCase()} AND consumed_at IS NULL
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
  if (current.status !== "APPROVED") {
    throw new ProposalStateConflictError(
      `Pengajuan berstatus "${current.status}". Hanya pengajuan disetujui (APPROVED) yang dapat ${verb}.`
    );
  }
  return current;
}

/** The durable trail both terminations leave: draft, frozen version status, decision, history. */
async function writeTermination(
  tx: { execute: (query: any) => Promise<any> },
  institutionId: string,
  proposalId: string,
  current: StoredProposalDraft,
  input: ProposalTerminationInput,
  actor: { account: string; officerId: string },
  now: number,
  kind: {
    action: "CANCEL" | "CLOSE_REMAINDER";
    nextStatus: "CANCELLED" | "REMAINDER_CLOSED";
    revisionWithdrawalReason: string;
    historyNote: string;
    extraDraftColumns: any;
  }
): Promise<{ draft: StoredProposalDraft; decision: ProposalDecisionRecord; summary: ProposalRealizationSummary }> {
  if (current.activeRevisionId) {
    await tx.execute(sql`
      UPDATE proposal_revisions SET
        status = 'WITHDRAWN',
        rejection_reason = ${kind.revisionWithdrawalReason},
        updated_at = ${now}
      WHERE id = ${current.activeRevisionId}
    `);
  }

  const updatedRaw = rowsOf(
    await tx.execute(sql`
      UPDATE proposal_drafts SET
        status = ${kind.nextStatus},
        active_revision_id = NULL,
        held_aid_lines_json = '[]',
        ${kind.extraDraftColumns}
        updated_at = ${now}
      WHERE id = ${proposalId} AND institution_id = ${institutionId} AND version = ${input.expectedVersion}
      RETURNING *
    `)
  )[0];

  // Only the version's lifecycle status moves; its frozen data_json is never rewritten.
  await tx.execute(sql`
    UPDATE proposal_versions SET status = ${kind.nextStatus}
    WHERE proposal_id = ${proposalId} AND version = ${current.version}
  `);

  const decisionRow = rowsOf(
    await tx.execute(sql`
      INSERT INTO proposal_decisions (
        id, proposal_id, proposal_version, institution_id, action,
        decision_reference, decision_date, decision_document_id, decision_document_sha256,
        notes, rejection_reason, rights_digest, operator_officer_id, operator_account, signer_account,
        mandate_id, signature, created_at
      ) VALUES (
        ${`dec-${crypto.randomUUID()}`}, ${proposalId}, ${current.version}, ${institutionId}, ${kind.action},
        ${input.decisionReference}, ${input.decisionDate},
        ${input.decisionDocumentId}, ${input.decisionDocumentSha256},
        ${input.notes ?? null}, ${input.reason}, ${input.challenge.rightsDigest}, ${actor.officerId},
        ${actor.account.toLowerCase()}, ${input.signerAccount.toLowerCase()},
        ${input.mandateId}, ${input.signature}, ${now}
      )
      RETURNING *
    `)
  )[0];

  await tx.execute(sql`
    INSERT INTO proposal_history (
      proposal_id, institution_id, version, from_status, to_status, action,
      actor_account, actor_officer_id, reason, notes, occurred_at
    ) VALUES (
      ${proposalId}, ${institutionId}, ${current.version}, ${current.status},
      ${kind.nextStatus}, ${kind.action}, ${actor.account.toLowerCase()}, ${actor.officerId},
      ${input.reason}, ${kind.historyNote},
      ${now}
    )
  `);

  const updatedDraft = draftFrom(updatedRaw);
  return {
    draft: updatedDraft,
    decision: decisionRecordFrom(decisionRow),
    summary: await realizationSummaryOf(tx, institutionId, updatedDraft),
  };
}

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
        await recordDraftContributors(tx, current ? draftFrom(current) : null, saved, operation);
        return saved;
      });
    },

    async applyProposalBeneficiaryList(
      institutionId: string,
      proposalId: string,
      expectedVersion: number,
      data: {
        previewId: string;
        beneficiaries: Beneficiary[];
        aidLines: AidLine[];
        issues: ProposalIssue[];
        file?: {
          id: string;
          fileName: string;
          mimeType: string;
          sizeBytes: number;
          contentSha256: string;
          storageRef: string;
        };
      },
      operation: DraftOperation,
      authorize: DraftGuard,
      now: number,
    ): Promise<{
      kind: "DRAFT";
      draft: StoredProposalDraft;
      document?: ProposalDocumentRecord;
    }> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        await consumeBeneficiaryListPreview(
          tx,
          { institutionId, proposalId, account: operation.account },
          data.previewId,
          now,
          data.file?.storageRef,
        );
        const previous = await editableDocumentDraft(
          tx,
          institutionId,
          proposalId,
          expectedVersion,
          authorize,
        );

        const written = rowsOf(
          await tx.execute(sql`
              UPDATE proposal_drafts SET
                beneficiaries_json = ${JSON.stringify(data.beneficiaries)},
                aid_lines_json = ${JSON.stringify(data.aidLines)},
                issues_json = ${JSON.stringify(data.issues)},
                version = version + 1,
                updated_at = ${now}
              WHERE id = ${proposalId} AND institution_id = ${institutionId} AND version = ${expectedVersion}
              RETURNING *
            `),
        );
        if (!written.length) throw new ProposalDraftConflictError(proposalId);
        const saved = draftFrom(written[0]);

        let docRecord: ProposalDocumentRecord | undefined;
        if (data.file) {
          docRecord = await insertProposalDocument(tx, {
            ...data.file,
            proposalId,
            institutionId,
            beneficiaryId: null,
            category: "BENEFICIARY_ROSTER",
            storageStatus: "STORED",
            version: saved.version,
            createdBy: operation.account,
            createdAt: now,
          });
        }

        await recordDraftContributors(tx, previous, saved, operation);

        return { kind: "DRAFT", draft: saved, document: docRecord };
      });
    },

    async hasBeneficiaryListIdsOutsideProposal(
      scope: ProposalAccessScope,
      aidLineIds: string[],
      beneficiaryIds: string[],
    ): Promise<boolean> {
      // Probe GIN containment indexes per candidate ID, including revision-only identities.
      for (const [column, ids] of [
        ["aid_lines_json", aidLineIds],
        ["beneficiaries_json", beneficiaryIds],
      ] as const) {
        if (!ids.length) continue;
        const field = sql.identifier(column);
        const conflicts = rowsOf(
          await db.execute(sql`
            SELECT 1 FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) candidate(id)
            WHERE NOT EXISTS (
              SELECT 1 FROM proposal_drafts own
              WHERE own.id = ${scope.proposalId} AND own.institution_id = ${scope.institutionId}
                AND ${field}::jsonb @> jsonb_build_array(jsonb_build_object('id', candidate.id))
            ) AND (
              EXISTS (SELECT 1 FROM proposal_drafts
                WHERE id <> ${scope.proposalId}
                  AND ${field}::jsonb @> jsonb_build_array(jsonb_build_object('id', candidate.id)))
              OR EXISTS (SELECT 1 FROM proposal_revisions
                WHERE proposal_id <> ${scope.proposalId}
                  AND ${field}::jsonb @> jsonb_build_array(jsonb_build_object('id', candidate.id)))
            ) LIMIT 1
          `),
        );
        if (conflicts.length) return true;
      }
      return false;
    },

    async acknowledgeUnchangedBeneficiaryList(
      institutionId: string,
      proposalId: string,
      expectedVersion: number,
      operation: DraftOperation,
      guard: DraftGuard,
      previewId: string,
      now: number,
    ) {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        await consumeBeneficiaryListPreview(
          tx,
          { institutionId, proposalId, account: operation.account },
          previewId,
          now,
        );
        const row = rowsOf(
          await tx.execute(
            sql`SELECT * FROM proposal_drafts WHERE id = ${proposalId} AND institution_id = ${institutionId} FOR UPDATE`,
          ),
        )[0];
        if (!row || Number(row.version) !== expectedVersion)
          throw new ProposalDraftConflictError(proposalId);
        const draft = draftFrom(row);
        guard(draft);
        if (!["DRAFT", "REVISION_REQUIRED", "APPROVED"].includes(draft.status))
          throw new ProposalStateConflictError(
            "Daftar penerima tidak dapat diperbarui pada status ini.",
          );
        return { kind: "DRAFT" as const, draft };
      });
    },

    async saveProposalBeneficiaryListPreview(
      scope: ProposalAccessScope,
      id: string,
      payloadCiphertext: string,
      now: number,
    ): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`DELETE FROM proposal_beneficiary_list_previews WHERE expires_at <= ${now}`,
        );
        await tx.execute(sql`INSERT INTO proposal_beneficiary_list_previews
            (id, institution_id, proposal_id, account, payload_ciphertext, created_at, expires_at)
            VALUES (${id}, ${scope.institutionId}, ${scope.proposalId}, ${scope.account},
              ${payloadCiphertext}, ${now}, ${now + BENEFICIARY_LIST_PREVIEW_TTL_SECONDS})`);
      });
    },

    async getProposalBeneficiaryListPreview(
      scope: ProposalAccessScope,
      id: string,
      now: number,
    ): Promise<string | null> {
      const row = rowsOf(
        await db.execute(sql`SELECT payload_ciphertext FROM proposal_beneficiary_list_previews
          WHERE id = ${id} AND institution_id = ${scope.institutionId} AND proposal_id = ${scope.proposalId}
            AND account = ${scope.account} AND expires_at > ${now}`),
      )[0];
      return row?.payload_ciphertext ?? null;
    },

    async pruneProposalBeneficiaryListPreviews(now: number): Promise<void> {
      await db.execute(
        sql`DELETE FROM proposal_beneficiary_list_previews WHERE expires_at <= ${now}`,
      );
    },

    async queueUncommittedProposalFile(
      storageRef: string,
      now: number,
    ): Promise<void> {
      await db.execute(sql`INSERT INTO proposal_preview_file_cleanup (storage_ref, created_at, expires_at)
          VALUES (${storageRef}, ${now}, ${now + BENEFICIARY_LIST_PREVIEW_TTL_SECONDS}) ON CONFLICT DO NOTHING`);
    },

    async pruneUncommittedProposalFiles(
      now: number,
      remove: (storageRef: string) => Promise<void>,
    ): Promise<void> {
      await db.transaction(async (tx) => {
        const pending = rowsOf(
          await tx.execute(sql`SELECT storage_ref
            FROM proposal_preview_file_cleanup WHERE expires_at <= ${now}
            ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED`),
        );
        for (const row of pending) {
          const referenced =
            rowsOf(
              await tx.execute(sql`SELECT 1 FROM proposal_documents
              WHERE storage_ref = ${row.storage_ref} LIMIT 1`),
            ).length > 0;
          if (!referenced) await remove(row.storage_ref);
          await tx.execute(
            sql`DELETE FROM proposal_preview_file_cleanup WHERE storage_ref = ${row.storage_ref}`,
          );
        }
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
              SELECT id, program_id, origin_of_request, purpose, beneficiaries_json, issues_json, version, status, submitted_at, examined_at, active_revision_id, updated_at
              FROM proposal_drafts WHERE institution_id = ${institutionId} AND program_id = ${programId}
              ORDER BY updated_at DESC, id DESC
            `)
          : await db.execute(sql`
              SELECT id, program_id, origin_of_request, purpose, beneficiaries_json, issues_json, version, status, submitted_at, examined_at, active_revision_id, updated_at
              FROM proposal_drafts WHERE institution_id = ${institutionId}
              ORDER BY updated_at DESC, id DESC
            `)
      );
      return rows.map(proposalSummaryFrom);
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
              require_recipient_verification = ${policy.requireRecipientVerification},
              decision_outside_app = ${policy.decisionOutsideApp},
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
              sop_requires_multi_signer_quorum, require_recipient_verification, decision_outside_app,
              version, updated_at, updated_by
            ) VALUES (
              ${policy.institutionId}, ${policy.requireProposalLetter}, ${policy.requireIdentityDoc},
              ${policy.requireAlternativeIdProof}, ${policy.requireGuardianProof}, ${policy.warnRecurringAid},
              ${Boolean(policy.sopRequiresMultiSignerQuorum)}, ${policy.requireRecipientVerification},
              ${policy.decisionOutsideApp}, 1,
              ${policy.updatedAt}, ${policy.updatedBy}
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
        return insertProposalDocument(tx, doc);
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
        const { current, version: submittedVersion, warnings } = await freezeSubmission(
          tx, institutionId, proposalId, expectedVersion, actor, now
        );

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

    /**
     * Publishes a complete proposal on a decision the institution took outside the app
     * (ADR-0041): the version is frozen exactly as a submission would freeze it, and the
     * requested rights become the approved rights in the same transaction. The publishing
     * amil is recorded as operator; there is deliberately no separate signer.
     */
    async publishProposalDraft(
      institutionId: string,
      proposalId: string,
      expectedVersion: number,
      publication: ProposalPublicationInput & { mandateId: string },
      operation: DraftOperation,
      actor: { account: string; officerId: string },
      now: number
    ): Promise<{ draft: StoredProposalDraft; decision: ProposalDecisionRecord; warnings: RecurringAidWarning[] }> {
      return mutateOnce(db, institutionId, operation, async tx => {
        const { current, policy, version, warnings } = await freezeSubmission(
          tx, institutionId, proposalId, expectedVersion, actor, now
        );
        if (!policy.decisionOutsideApp) {
          throw new ProposalStateConflictError(
            "Kebijakan lembaga ini memutus pengajuan di aplikasi. Ajukan untuk pemeriksaan, bukan terbitkan langsung."
          );
        }

        const decided = decidedAidLines(current.aidLines, { action: "APPROVE", approvedAidLines: [] });
        if (!decided.ok) throw new ProposalStateConflictError(decided.error);
        const intent = {
          action: "APPROVE" as const,
          decisionReference: publication.decisionReference,
          decisionDate: publication.decisionDate,
          notes: publication.notes,
          rejectionReason: null,
        };

        const updatedRaw = rowsOf(
          await tx.execute(sql`
            UPDATE proposal_drafts SET
              version = ${version}, status = 'APPROVED', aid_lines_json = ${JSON.stringify(decided.lines)},
              examined_at = NULL, examined_by = NULL, submitted_at = ${now}, submitted_by = ${actor.account},
              revision_reason = NULL, withdrawal_reason = NULL, examination_notes = NULL,
              examination_checklist_json = NULL, updated_at = ${now}
            WHERE id = ${proposalId} AND institution_id = ${institutionId} AND version = ${expectedVersion}
            RETURNING *
          `)
        )[0];
        await tx.execute(sql`
          UPDATE proposal_versions SET status = 'APPROVED' WHERE proposal_id = ${proposalId} AND version = ${version}
        `);

        const basis: ProposalDecisionBasis = "RECORDED_OUTSIDE_APP";
        const decisionRow = rowsOf(
          await tx.execute(sql`
            INSERT INTO proposal_decisions (
              id, proposal_id, proposal_version, institution_id, action, basis,
              decision_reference, decision_date, decision_document_id, decision_document_sha256,
              notes, rejection_reason, rights_digest, operator_officer_id, operator_account, signer_account,
              mandate_id, signature, created_at, decided_aid_lines_json
            ) VALUES (
              ${`dec-${crypto.randomUUID()}`}, ${proposalId}, ${version}, ${institutionId}, 'APPROVE', ${basis},
              ${publication.decisionReference}, ${publication.decisionDate}, NULL, NULL,
              ${publication.notes}, NULL, ${computeRightsDigest(decided.lines, intent)},
              ${actor.officerId}, ${actor.account.toLowerCase()}, NULL,
              ${publication.mandateId}, NULL, ${now}, ${JSON.stringify(decided.lines)}
            )
            RETURNING *
          `)
        )[0];

        await tx.execute(sql`
          INSERT INTO proposal_history (
            proposal_id, institution_id, version, from_status, to_status, action,
            actor_account, actor_officer_id, reason, notes, occurred_at
          ) VALUES (
            ${proposalId}, ${institutionId}, ${version}, ${current.status}, 'APPROVED', 'PUBLISH',
            ${actor.account.toLowerCase()}, ${actor.officerId}, NULL,
            ${`Diterbitkan atas keputusan internal: ${publication.decisionReference} (${publication.decisionDate})`}, ${now}
          )
        `);

        return { draft: draftFrom(updatedRaw), decision: decisionRecordFrom(decisionRow), warnings };
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
      const approval = rowsOf(
        await db.execute(sql`
          SELECT decided_aid_lines_json FROM proposal_decisions
          WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId}
            AND proposal_version = ${version} AND action = 'APPROVE'
        `)
      )[0];
      return {
        version: Number(row.version),
        status: row.status as ProposalStatus,
        data: withDecidedAidLines(JSON.parse(row.data_json), approval?.decided_aid_lines_json ?? null),
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
              mandate_id, signature, created_at, decided_aid_lines_json
            ) VALUES (
              ${`dec-${crypto.randomUUID()}`}, ${proposalId}, ${current.version}, ${institutionId}, ${input.action},
              ${input.decisionReference}, ${input.decisionDate},
              ${challenge.decisionDocumentId}, ${challenge.decisionDocumentSha256},
              ${input.notes}, ${input.rejectionReason}, ${challenge.rightsDigest}, ${actor.officerId}, ${actor.account.toLowerCase()}, ${input.signerAccount.toLowerCase()},
              ${input.mandateId}, ${input.signature}, ${now}, ${JSON.stringify(decidedLines)}
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
      // A cancelled or remainder-closed proposal carries two decisions on the same version:
      // the approval it rests on and the termination that ended it. The termination is the
      // later one, and timestamps alone cannot order them when both land in the same second.
      const row = rowsOf(
        await db.execute(sql`
          SELECT * FROM proposal_decisions
          WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId}
          ORDER BY proposal_version DESC,
                   CASE WHEN action IN ('CANCEL', 'CLOSE_REMAINDER') THEN 1 ELSE 0 END DESC,
                   created_at DESC
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

    /**
     * Records reported handovers against the approved version. The proposal row lock
     * serialises concurrent recordings, and the retry identity replays a lost response
     * instead of recording the payment twice.
     */
    async recordRealizations(
      institutionId: string,
      proposalId: string,
      input: { items: RealizationItemInput[]; batchGroupId: string | null; expectedVersion: number },
      operation: DraftOperation,
      actor: { account: string; officerId: string },
      now: number
    ): Promise<{ records: RealizationRecord[]; summary: ProposalRealizationSummary }> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        const proposalRow = rowsOf(await tx.execute(sql`
          SELECT * FROM proposal_drafts
          WHERE id = ${proposalId} AND institution_id = ${institutionId}
          FOR UPDATE
        `))[0];
        if (!proposalRow) throw new RealizationNotFoundError("Pengajuan tidak ditemukan.");
        const current = draftFrom(proposalRow);

        if (current.status !== "APPROVED") {
          throw new ProposalStateConflictError(
            `Pengajuan belum disetujui (status: "${current.status}"). Realisasi hanya dapat dicatat setelah pengajuan disetujui.`
          );
        }
        if (current.version !== input.expectedVersion) throw new ProposalDraftConflictError(proposalId);

        const heldSet = new Set(current.heldAidLineIds ?? []);
        for (const item of input.items) {
          if (heldSet.has(item.aidLineId)) {
            throw new RealizationHeldForRevisionError(
              `Rincian bantuan '${item.aidLineId}' sedang ditahan karena ada revisi pengajuan yang aktif.`
            );
          }
        }

        const lineCumulativeIdr = new Map<string, bigint>();
        const lineCumulativeQty = new Map<string, string>();
        for (const row of rowsOf(await tx.execute(sql`
          SELECT aid_line_id, amount_idr, quantity FROM disbursement_realizations
          WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId}
        `))) {
          if (row.amount_idr != null) {
            lineCumulativeIdr.set(row.aid_line_id, (lineCumulativeIdr.get(row.aid_line_id) ?? 0n) + BigInt(row.amount_idr));
          }
          if (row.quantity != null) {
            const prev = lineCumulativeQty.get(row.aid_line_id) ?? "0";
            lineCumulativeQty.set(row.aid_line_id, addDecimalStrings(prev, row.quantity));
          }
        }

        const aidLineMap = new Map(current.aidLines.map((line) => [line.id, line]));
        const records: RealizationRecord[] = [];

        for (const item of input.items) {
          const line = aidLineMap.get(item.aidLineId);
          if (!line) {
            throw new RealizationInputError(`Rincian bantuan '${item.aidLineId}' tidak ditemukan pada pengajuan ini.`);
          }
          if (line.beneficiaryId !== item.beneficiaryId) {
            throw new RealizationInputError(`Penerima '${item.beneficiaryId}' tidak sesuai dengan rincian bantuan '${item.aidLineId}'.`);
          }

          if (line.value.kind === "GOODS") {
            if (item.method !== "GOODS_HANDOVER" || item.quantity == null || !item.unit) {
              throw new RealizationInputError(`Rincian '${item.aidLineId}' berupa barang dan membutuhkan kuantitas serta satuan.`);
            }
            const approvedQty = approvedQuantityOf(line);
            const approvedUnit = approvedUnitOf(line);
            if (approvedQty === null || approvedUnit === null) {
              throw new RealizationInputError(`Rincian '${item.aidLineId}' tidak memiliki kuantitas barang yang valid.`);
            }
            if (item.unit !== approvedUnit) {
              throw new RealizationInputError(`Satuan '${item.unit}' tidak sesuai dengan satuan yang disetujui ('${approvedUnit}').`);
            }
            const realizedQty = lineCumulativeQty.get(item.aidLineId) ?? "0";
            const newTotalQty = addDecimalStrings(realizedQty, item.quantity);
            if (compareDecimalStrings(newTotalQty, approvedQty) > 0) {
              throw new RealizationCapExceededError(
                `Realisasi sebesar ${item.quantity} ${item.unit} melebihi sisa hak yang disetujui pada baris ${item.aidLineId} (Disetujui: ${approvedQty} ${approvedUnit}, Terealisasi: ${realizedQty} ${approvedUnit}).`
              );
            }
            lineCumulativeQty.set(item.aidLineId, newTotalQty);
          } else {
            if (item.method === "GOODS_HANDOVER" || !item.amountIdr) {
              throw new RealizationInputError(`Rincian '${item.aidLineId}' berupa uang dan membutuhkan nominal IDR.`);
            }
            const approvedIdr = approvedIdrOf(line);
            if (approvedIdr === null) {
              throw new RealizationInputError(`Rincian '${item.aidLineId}' berupa barang dan tidak dicatat sebagai realisasi IDR.`);
            }

            const realizedIdr = lineCumulativeIdr.get(item.aidLineId) ?? 0n;
            const newTotal = realizedIdr + BigInt(item.amountIdr);
            if (newTotal > approvedIdr) {
              throw new RealizationCapExceededError(
                `Realisasi sebesar Rp${item.amountIdr} melebihi sisa hak yang disetujui pada baris ${item.aidLineId} (Disetujui: Rp${approvedIdr}, Terealisasi: Rp${realizedIdr}).`
              );
            }
            lineCumulativeIdr.set(item.aidLineId, newTotal);
          }

          const row = rowsOf(await tx.execute(sql`
            INSERT INTO disbursement_realizations (
              id, institution_id, proposal_id, proposal_version, aid_line_id, beneficiary_id,
              batch_group_id, payment_recipient_json, method, amount_idr, quantity, unit,
              reported_at, recorded_at, operator_account, operator_officer_id, notes,
              evidence_status, confirmation_status, confirmation_method, version,
              created_at, updated_at
            ) VALUES (
              ${`rea-${crypto.randomUUID()}`}, ${institutionId}, ${proposalId}, ${current.version}, ${item.aidLineId}, ${item.beneficiaryId},
              ${input.batchGroupId}, ${item.paymentRecipient ? JSON.stringify(item.paymentRecipient) : null}, ${item.method}, ${line.value.kind === "MONEY" ? item.amountIdr : null}, ${line.value.kind === "GOODS" ? item.quantity : null}, ${line.value.kind === "GOODS" ? item.unit : null},
              ${item.reportedAt}, ${now}, ${actor.account.toLowerCase()}, ${actor.officerId}, ${item.notes},
              'EVIDENCE_PENDING', 'UNCONFIRMED', NULL, 1,
              ${now}, ${now}
            )
            RETURNING *
          `))[0];
          records.push(realizationRecordFrom(row));
        }

        return { records, summary: await realizationSummaryOf(tx, institutionId, current) };
      }, "disbursement_realization_operations");
    },

    async getProposalRealizations(institutionId: string, proposalId: string): Promise<RealizationRecord[]> {
      return rowsOf(await db.execute(sql`
        SELECT * FROM disbursement_realizations
        WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId}
        ORDER BY recorded_at ASC, id ASC
      `)).map(realizationRecordFrom);
    },

    async getProposalRealizationSummary(institutionId: string, proposalId: string): Promise<ProposalRealizationSummary | null> {
      const draftRow = rowsOf(await db.execute(sql`
        SELECT * FROM proposal_drafts WHERE id = ${proposalId} AND institution_id = ${institutionId}
      `))[0];
      return draftRow ? realizationSummaryOf(db, institutionId, draftFrom(draftRow)) : null;
    },

    /**
     * Keeps a private evidence file and the explicit amount it evidences for each realization.
     * A group BAST allocates to every realization of its batch it covers; a photo allocates nothing.
     * Evidence becomes complete only when the method's required documents account for the whole amount.
     */
    async uploadRealizationDocument(
      institutionId: string,
      proposalId: string,
      realizationId: string,
      document: {
        documentType: RealizationDocumentType;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        contentSha256: `0x${string}`;
        storageRef: string;
        batchGroupId: string | null;
      },
      allocations: EvidenceAllocation[],
      operation: DraftOperation,
      uploadedBy: string,
      now: number
    ): Promise<{ document: RealizationDocumentRecord; realizations: RealizationRecord[] }> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        const anchor = await lockRealization(tx, institutionId, proposalId, realizationId);
        const batchGroupId = document.batchGroupId ?? anchor.batchGroupId;

        if (document.documentType === "SUPPORTING_PHOTO") {
          if (allocations.length) {
            throw new RealizationInputError("Foto hanya pendukung dan tidak dialokasikan ke jumlah realisasi.");
          }
        } else {
          if (!allocations.some((allocation) => allocation.realizationId === realizationId)) {
            throw new RealizationInputError("Bukti wajib menyebut jumlah yang dibuktikan untuk realisasi ini.");
          }
          if (allocations.length > 1 && !batchGroupId) {
            throw new RealizationInputError("Bukti kelompok hanya dapat dialokasikan ke realisasi dalam satu kelompok penyerahan.");
          }
        }

        const allocated: RealizationRecord[] = [];
        for (const allocation of [...allocations].sort((a, b) => a.realizationId.localeCompare(b.realizationId))) {
          const target = allocation.realizationId === anchor.id
            ? anchor
            : await lockRealization(tx, institutionId, proposalId, allocation.realizationId);
          if (allocations.length > 1 && target.batchGroupId !== batchGroupId) {
            throw new RealizationInputError(`Realisasi ${target.id} bukan bagian dari kelompok penyerahan ${batchGroupId}.`);
          }
          const required = REQUIRED_EVIDENCE_BY_METHOD[target.method];
          if (document.documentType !== required) {
            throw new RealizationInputError(
              target.method === "CASH" || target.method === "GOODS_HANDOVER"
                ? `Realisasi ${target.method === "CASH" ? "tunai" : "barang"} ${target.id} dibuktikan dengan tanda terima atau BAST.`
                : `Realisasi transfer ${target.id} dibuktikan dengan bukti pembayaran.`
            );
          }
          if (target.quantity != null) {
            if (allocation.quantity == null || !allocation.unit) {
              throw new RealizationInputError(`Alokasi bukti untuk realisasi barang ${target.id} wajib menyertakan kuantitas dan satuan.`);
            }
            if (allocation.unit !== target.unit) {
              throw new RealizationInputError(`Satuan alokasi bukti '${allocation.unit}' tidak sesuai dengan satuan realisasi ('${target.unit}').`);
            }
            const covered = (await evidenceAllocationsOf(tx, institutionId, target.id))
              .filter((existing) => existing.documentType === required && existing.quantity != null)
              .reduce((total, existing) => addDecimalStrings(total, existing.quantity!), "0");
            const newTotal = addDecimalStrings(covered, allocation.quantity);
            if (compareDecimalStrings(newTotal, target.quantity) > 0) {
              throw new RealizationInputError(
                `Jumlah bukti untuk realisasi ${target.id} melebihi kuantitas realisasi (${target.quantity} ${target.unit}, sudah dibuktikan ${covered} ${target.unit}).`
              );
            }
          } else {
            if (!allocation.amountIdr) {
              throw new RealizationInputError(`Alokasi bukti untuk realisasi uang ${target.id} wajib menyertakan nominal IDR.`);
            }
            const covered = (await evidenceAllocationsOf(tx, institutionId, target.id))
              .filter((existing) => existing.documentType === required && existing.amountIdr != null)
              .reduce((total, existing) => total + BigInt(existing.amountIdr!), 0n);
            if (covered + BigInt(allocation.amountIdr) > BigInt(target.amountIdr!)) {
              throw new RealizationInputError(
                `Jumlah bukti untuk realisasi ${target.id} melebihi nominal realisasi (Rp${target.amountIdr}, sudah dibuktikan Rp${covered}).`
              );
            }
          }
          allocated.push(target);
        }

        const documentRow = rowsOf(await tx.execute(sql`
          INSERT INTO disbursement_realization_documents (
            id, institution_id, proposal_id, realization_id, batch_group_id,
            document_type, file_name, mime_type, size_bytes,
            content_sha256, storage_ref, uploaded_by, created_at
          ) VALUES (
            ${`doc-rea-${crypto.randomUUID()}`}, ${institutionId}, ${proposalId}, ${realizationId}, ${batchGroupId},
            ${document.documentType}, ${document.fileName}, ${document.mimeType}, ${document.sizeBytes},
            ${document.contentSha256}, ${document.storageRef}, ${uploadedBy}, ${now}
          )
          RETURNING *
        `))[0];

        for (const allocation of allocations) {
          await tx.execute(sql`
            INSERT INTO disbursement_realization_document_allocations (
              document_id, realization_id, institution_id, amount_idr, quantity, unit
            ) VALUES (
              ${documentRow.id}, ${allocation.realizationId}, ${institutionId},
              ${allocation.amountIdr ?? null}, ${allocation.quantity ?? null}, ${allocation.unit ?? null}
            )
          `);
        }

        const realizations: RealizationRecord[] = [];
        for (const target of allocated.length ? allocated : [anchor]) {
          const evidenceStatus = evidenceStatusOf(target, await evidenceAllocationsOf(tx, institutionId, target.id));
          realizations.push(evidenceStatus === target.evidenceStatus
            ? target
            : await updateRealizationStatus(tx, target, { ...target, evidenceStatus }, now));
        }

        const sortedAllocations = [...allocations].sort((a, b) => a.realizationId.localeCompare(b.realizationId));
        return { document: realizationDocumentFrom(documentRow, sortedAllocations), realizations };
      }, "disbursement_realization_operations");
    },

    async getRealizationDocument(
      institutionId: string,
      proposalId: string,
      documentId: string
    ): Promise<RealizationDocumentRecord | null> {
      const row = rowsOf(await db.execute(sql`
        SELECT * FROM disbursement_realization_documents
        WHERE id = ${documentId} AND institution_id = ${institutionId} AND proposal_id = ${proposalId}
      `))[0];
      if (!row) return null;
      const allocations = await allocationsByDocument(db, institutionId, [row.id]);
      return realizationDocumentFrom(row, allocations.get(row.id) ?? []);
    },

    async listRealizationDocuments(institutionId: string, proposalId: string): Promise<RealizationDocumentRecord[]> {
      const rows = rowsOf(await db.execute(sql`
        SELECT * FROM disbursement_realization_documents
        WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId}
        ORDER BY seq ASC
      `));
      const allocations = await allocationsByDocument(db, institutionId, rows.map((row) => row.id));
      return rows.map((row) => realizationDocumentFrom(row, allocations.get(row.id) ?? []));
    },

    /**
     * Opens an OTP challenge bound to the realization's exact version, amount and aid type.
     * A newer challenge voids any earlier one still open for the same realization.
     */
    async issueConfirmationOtp(
      institutionId: string,
      proposalId: string,
      realizationId: string,
      challenge: { nonce: string; codeHash: string; recipientContact: string; ttlSeconds: number },
      now: number
    ): Promise<RealizationChallenge> {
      return db.transaction(async (tx) => {
        const realization = await lockRealization(tx, institutionId, proposalId, realizationId);
        assertRecipientConfirmable(realization);

        const versionRow = rowsOf(await tx.execute(sql`
          SELECT data_json FROM proposal_versions
          WHERE proposal_id = ${proposalId} AND institution_id = ${institutionId}
            AND version = ${realization.proposalVersion}
        `))[0];
        const snapshot = versionRow ? JSON.parse(versionRow.data_json) as StoredProposalDraft : null;
        const beneficiary = snapshot?.beneficiaries.find((entry) => entry.id === realization.beneficiaryId);
        const aidType = snapshot?.aidLines.find((line) => line.id === realization.aidLineId)?.aidType;
        if (!beneficiary || !aidType) throw new RealizationNotFoundError("Versi penerima dan rincian bantuan tidak ditemukan.");
        const normalize = (contact: string) => contact.trim().replace(/[\s-]/g, "");
        const destination = [beneficiary.contact?.phone, beneficiary.contact?.email]
          .find((contact) => contact && normalize(contact) === normalize(challenge.recipientContact));
        if (!destination || !beneficiary.contact?.relation?.trim()) {
          throw new RealizationInputError("Kontak dan hubungan penerima/perwakilan harus sesuai versi pengajuan yang disetujui. Gunakan pemeriksaan BAST bila kontak belum tersedia.");
        }
        const confirmer = {
          beneficiaryName: beneficiary.name,
          guardian: beneficiary.guardian,
          contactRelation: beneficiary.contact.relation,
        };

        await tx.execute(sql`
          UPDATE disbursement_realization_challenges SET consumed_at = ${now}
          WHERE institution_id = ${institutionId} AND realization_id = ${realizationId} AND consumed_at IS NULL
        `);

        const row = rowsOf(await tx.execute(sql`
          INSERT INTO disbursement_realization_challenges (
            nonce, institution_id, proposal_id, proposal_version, realization_id, realization_version,
            beneficiary_id, contact_hint, confirmer_json, aid_type, amount_idr, quantity, unit, code_hash, attempts,
            issued_at, expires_at, consumed_at
          ) VALUES (
            ${challenge.nonce}, ${institutionId}, ${proposalId}, ${realization.proposalVersion}, ${realizationId}, ${realization.version},
            ${realization.beneficiaryId}, ${contactHintOf(normalize(destination))}, ${JSON.stringify(confirmer)}, ${aidType},
            ${realization.amountIdr ?? null}, ${realization.quantity ?? null}, ${realization.unit ?? null},
            ${challenge.codeHash}, 0,
            ${now}, ${now + challenge.ttlSeconds}, NULL
          )
          RETURNING *
        `))[0];
        return realizationChallengeFrom(row);
      });
    },

    /** A challenge whose message could not be delivered must not stay redeemable. */
    async voidConfirmationOtp(institutionId: string, nonce: string, now: number): Promise<void> {
      await db.execute(sql`
        UPDATE disbursement_realization_challenges SET consumed_at = ${now}
        WHERE nonce = ${nonce} AND institution_id = ${institutionId} AND consumed_at IS NULL
      `);
    },

    /**
     * Redeems the code the recipient read back. A wrong code costs an attempt that survives
     * the refusal; the challenge dies after too many attempts, on expiry, on use, or when the
     * realization changed after the code was sent.
     */
    async verifyConfirmationOtp(
      institutionId: string,
      proposalId: string,
      realizationId: string,
      nonce: string,
      codeHash: string,
      now: number
    ): Promise<RealizationRecord> {
      const outcome = await db.transaction(async (tx): Promise<
        { kind: "spent"; message: string } | { kind: "invalid"; remaining: number } | { kind: "confirmed"; realization: RealizationRecord }
      > => {
        const realization = await lockRealization(tx, institutionId, proposalId, realizationId);
        const row = rowsOf(await tx.execute(sql`
          SELECT * FROM disbursement_realization_challenges
          WHERE nonce = ${nonce} AND institution_id = ${institutionId}
          FOR UPDATE
        `))[0];
        if (!row) return { kind: "spent", message: "Tantangan OTP tidak ditemukan." };
        const challenge = realizationChallengeFrom(row);
        if (challenge.realizationId !== realizationId || challenge.proposalId !== proposalId) {
          return { kind: "spent", message: "Tantangan OTP tidak sesuai dengan kejadian realisasi ini." };
        }
        if (!challenge.confirmer || challenge.consumedAt !== null || challenge.expiresAt <= now || challenge.attempts >= MAX_OTP_ATTEMPTS) {
          return { kind: "spent", message: "Tantangan OTP sudah kedaluwarsa atau telah digunakan. Kirim kode baru." };
        }

        assertRecipientConfirmable(realization);
        if (realization.version !== challenge.realizationVersion) {
          return { kind: "spent", message: "Realisasi berubah setelah kode dikirim. Kirim kode baru." };
        }

        if (!sameHash(challenge.codeHash, codeHash)) {
          const attempts = challenge.attempts + 1;
          await tx.execute(sql`
            UPDATE disbursement_realization_challenges
            SET attempts = ${attempts}, consumed_at = ${attempts >= MAX_OTP_ATTEMPTS ? now : null}
            WHERE nonce = ${nonce}
          `);
          return { kind: "invalid", remaining: MAX_OTP_ATTEMPTS - attempts };
        }

        await tx.execute(sql`UPDATE disbursement_realization_challenges SET consumed_at = ${now} WHERE nonce = ${nonce}`);
        return {
          kind: "confirmed",
          realization: await updateRealizationStatus(tx, realization, {
            ...realization,
            confirmationStatus: "CONFIRMED",
            confirmationMethod: "OTP",
          }, now),
        };
      });

      if (outcome.kind === "spent") throw new RealizationChallengeSpentError(outcome.message);
      if (outcome.kind === "invalid") {
        throw new RealizationOtpInvalidError(
          outcome.remaining > 0 ? `Kode OTP salah. Sisa percobaan: ${outcome.remaining}.` : "Kode OTP salah. Kirim kode baru."
        );
      }
      return outcome.realization;
    },

    /** When OTP is unavailable, an officer other than the recorder examines the uploaded receipt/BAST. */
    async verifyBastBySecondOfficer(
      institutionId: string,
      proposalId: string,
      realizationId: string,
      notes: string,
      actor: { account: string; officerId: string },
      now: number
    ): Promise<{ examination: BastExaminationRecord; realization: RealizationRecord }> {
      return db.transaction((tx) => performBastExamination(tx, institutionId, proposalId, realizationId, notes, actor, now));
    },

    /**
     * Confirms every member of one group handover in a single call - the UX a large roster
     * (a hundred sembako recipients handed over at once) needs, without pretending a batch is
     * one undifferentiated success. Each member gets its own transaction and its own outcome:
     * one row that is already disputed, already confirmed, still short of evidence, or recorded
     * by this same officer does not block or silently pass the rest of the batch.
     */
    async verifyBastBatchBySecondOfficer(
      institutionId: string,
      proposalId: string,
      batchGroupId: string,
      notes: string,
      actor: { account: string; officerId: string },
      now: number
    ): Promise<BastBatchConfirmationReport> {
      const members = rowsOf(await db.execute(sql`
        SELECT id, beneficiary_id FROM disbursement_realizations
        WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId} AND batch_group_id = ${batchGroupId}
        ORDER BY id
      `));
      if (members.length === 0) throw new RealizationNotFoundError("Kelompok realisasi ini tidak ditemukan.");

      const outcomes: BastBatchOutcome[] = [];
      for (const member of members) {
        try {
          await db.transaction((tx) => performBastExamination(tx, institutionId, proposalId, member.id, notes, actor, now));
          outcomes.push({ realizationId: member.id, beneficiaryId: member.beneficiary_id, state: "CONFIRMED" });
        } catch (error) {
          outcomes.push({
            realizationId: member.id,
            beneficiaryId: member.beneficiary_id,
            state: bastBatchOutcomeStateOf(error),
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { outcomes, confirmedCount: outcomes.filter((outcome) => outcome.state === "CONFIRMED").length };
    },

    /** Marks the contested part and holds final confirmation. The realized amount is never deleted or recounted. */
    async recordDispute(
      institutionId: string,
      proposalId: string,
      realizationId: string,
      dispute: {
        complainantType: ComplainantType;
        subject: DisputeSubject;
        reason: string;
        disputedAmountIdr?: string | null;
        disputedQuantity?: string | null;
        disputedUnit?: string | null;
      },
      actor: { officerId: string },
      now: number,
      operation: DraftOperation
    ): Promise<{ dispute: RealizationDisputeRecord; realization: RealizationRecord }> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        const realization = await lockRealization(tx, institutionId, proposalId, realizationId);
        if (realization.quantity != null) {
          if (!dispute.disputedQuantity || !dispute.disputedUnit) {
            throw new RealizationInputError("Sengketa atas barang wajib mencantumkan kuantitas dan satuan.");
          }
          if (dispute.disputedUnit !== realization.unit) {
            throw new RealizationInputError(`Satuan sengketa '${dispute.disputedUnit}' tidak sesuai dengan satuan realisasi ('${realization.unit}').`);
          }
          if (compareDecimalStrings(dispute.disputedQuantity, realization.quantity) > 0) {
            throw new RealizationInputError(
              `Kuantitas yang diperselisihkan (${dispute.disputedQuantity} ${dispute.disputedUnit}) melebihi kuantitas realisasi (${realization.quantity} ${realization.unit}).`
            );
          }
        } else {
          if (!dispute.disputedAmountIdr) {
            throw new RealizationInputError("Sengketa atas uang wajib mencantumkan nominal IDR.");
          }
          if (BigInt(dispute.disputedAmountIdr) > BigInt(realization.amountIdr!)) {
            throw new RealizationInputError(
              `Nominal yang diperselisihkan melebihi nominal realisasi (Rp${realization.amountIdr}).`
            );
          }
        }

        const row = rowsOf(await tx.execute(sql`
          INSERT INTO disbursement_realization_disputes (
            id, institution_id, proposal_id, realization_id, aid_line_id, complainant_type, subject,
            reason, disputed_amount_idr, disputed_quantity, disputed_unit, status, recorded_by_officer_id, created_at
          ) VALUES (
            ${`disp-${crypto.randomUUID()}`}, ${institutionId}, ${proposalId}, ${realizationId}, ${realization.aidLineId},
            ${dispute.complainantType}, ${dispute.subject}, ${dispute.reason},
            ${dispute.disputedAmountIdr ?? null}, ${dispute.disputedQuantity ?? null}, ${dispute.disputedUnit ?? null},
            'OPEN', ${actor.officerId}, ${now}
          )
          RETURNING *
        `))[0];

        return {
          dispute: realizationDisputeFrom(row, []),
          realization: realization.confirmationStatus === "DISPUTED"
            ? realization
            : await updateRealizationStatus(tx, realization, { ...realization, confirmationStatus: "DISPUTED" }, now),
        };
      }, "disbursement_realization_operations");
    },

    /**
     * Appends an authorized examination result. EXAMINED keeps the hold; RESOLVED closes the
     * dispute, and once no dispute on the realization stays open the hold lifts and the
     * recipient confirmation must be obtained again.
     */
    async examineDispute(
      institutionId: string,
      proposalId: string,
      realizationId: string,
      disputeId: string,
      examination: { outcome: DisputeOutcome; notes: string },
      actor: { account: string; officerId: string },
      now: number,
      operation: DraftOperation
    ): Promise<{ dispute: RealizationDisputeRecord; realization: RealizationRecord }> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        const realization = await lockRealization(tx, institutionId, proposalId, realizationId);
        const disputeRow = rowsOf(await tx.execute(sql`
          SELECT * FROM disbursement_realization_disputes
          WHERE id = ${disputeId} AND institution_id = ${institutionId} AND realization_id = ${realizationId}
          FOR UPDATE
        `))[0];
        if (!disputeRow) throw new RealizationNotFoundError("Sengketa tidak ditemukan pada realisasi ini.");
        if (disputeRow.status === "RESOLVED") throw new RealizationStateError("Sengketa ini sudah diselesaikan.");
        if (realization.operatorOfficerId === actor.officerId) {
          throw new RealizationSelfExaminationError("Pencatat realisasi tidak dapat memeriksa sengketa atas kejadiannya sendiri.");
        }

        await tx.execute(sql`
          INSERT INTO disbursement_realization_dispute_examinations (
            id, dispute_id, institution_id, outcome, notes, examiner_officer_id, examiner_account, examined_at
          ) VALUES (
            ${`disp-exam-${crypto.randomUUID()}`}, ${disputeId}, ${institutionId}, ${examination.outcome}, ${examination.notes},
            ${actor.officerId}, ${actor.account.toLowerCase()}, ${now}
          )
        `);
        const updatedRow = rowsOf(await tx.execute(sql`
          UPDATE disbursement_realization_disputes SET status = ${examination.outcome}
          WHERE id = ${disputeId} AND institution_id = ${institutionId}
          RETURNING *
        `))[0];

        let updatedRealization = realization;
        if (examination.outcome === "RESOLVED" && realization.confirmationStatus === "DISPUTED") {
          const stillOpen = rowsOf(await tx.execute(sql`
            SELECT id FROM disbursement_realization_disputes
            WHERE institution_id = ${institutionId} AND realization_id = ${realizationId} AND status <> 'RESOLVED'
          `));
          if (!stillOpen.length) {
            updatedRealization = await updateRealizationStatus(tx, realization, {
              ...realization,
              confirmationStatus: "UNCONFIRMED",
              confirmationMethod: null,
            }, now);
          }
        }

        const [dispute] = await disputesWithExaminations(tx, institutionId, [updatedRow]);
        return { dispute: dispute!, realization: updatedRealization };
      }, "disbursement_realization_operations");
    },

    async listDisputes(institutionId: string, proposalId: string, realizationId: string): Promise<RealizationDisputeRecord[]> {
      const rows = rowsOf(await db.execute(sql`
        SELECT * FROM disbursement_realization_disputes
        WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId} AND realization_id = ${realizationId}
        ORDER BY created_at ASC, id ASC
      `));
      return disputesWithExaminations(db, institutionId, rows);
    },

    // -----------------------------------------------------------------------
    // Biaya operasional per item, panjar dan talangan (ADR-0042, #125)
    // -----------------------------------------------------------------------

    async getOperationalCosts(institutionId: string, proposalId: string): Promise<OperationalCostOverview> {
      const state = await loadOperationalCosts(db, institutionId, proposalId);
      const names = new Map(rowsOf(await db.execute(sql`
        SELECT id, display_name FROM officer_profiles WHERE institution_id = ${institutionId}
      `)).map((row) => [row.id as string, row.display_name as string]));
      return {
        ...state,
        receipts: await loadReceipts(db, institutionId, proposalId),
        holders: summarizeHolders(state.items, state.panjar, names),
        totals: operationalCostTotals(state.items, state.panjar),
      };
    },

    /** Records each row on its own merits: valid rows are recorded, the others come back with their issues. */
    async recordCostItems(
      institutionId: string,
      proposalId: string,
      rows: unknown[],
      actor: CostActor,
      now: number,
      operation: DraftOperation
    ): Promise<{ results: CostRecordingResult[] }> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        await lockProposalForCosts(tx, institutionId, proposalId);
        const officers = await activeOfficerIds(tx, institutionId);
        const state = await loadOperationalCosts(tx, institutionId, proposalId);
        const receipts = await loadReceipts(tx, institutionId, proposalId);
        const spent = new Map<string, bigint>();
        const results: CostRecordingResult[] = [];

        for (const [index, raw] of rows.entries()) {
          const validated = validateCostItemInput(raw);
          if (!validated.ok) {
            results.push({ index, issues: validated.issues });
            continue;
          }
          const input = validated.value;
          const issues = [fundingIssue(input, officers, state.panjar, state.items, spent), receiptIssue(input, receipts)]
            .filter((issue): issue is CostIssue => issue !== null);
          if (issues.length > 0) {
            results.push({ index, issues });
            continue;
          }
          if (input.fundingSource.kind === "PANJAR") {
            const panjarId = input.fundingSource.panjarId;
            spent.set(panjarId, (spent.get(panjarId) ?? 0n) + BigInt(input.amountIdr));
          }

          const funding = fundingColumns(input.fundingSource);
          const row = rowsOf(await tx.execute(sql`
            INSERT INTO operational_cost_items (
              id, institution_id, proposal_id, version, status, spent_on, purpose, quantity, unit, unit_price_idr,
              amount_idr, payee, funding_kind, holder_officer_id, panjar_id, reimbursement_id, receipt_id,
              recorded_by_officer_id, recorded_by_account, recorded_at, updated_at
            ) VALUES (
              ${`opc-${crypto.randomUUID()}`}, ${institutionId}, ${proposalId}, 1, 'ACTIVE', ${input.spentOn}, ${input.purpose},
              ${input.quantity}, ${input.unit}, ${input.unitPriceIdr}, ${input.amountIdr}, ${input.payee},
              ${funding.kind}, ${funding.holderOfficerId}, ${funding.panjarId}, NULL, ${input.receiptId},
              ${actor.officerId}, ${actor.account.toLowerCase()}, ${now}, ${now}
            )
            RETURNING *
          `))[0];
          const item = costItemFrom(row);
          await markReceiptEvidenced(tx, institutionId, item.receiptId, now);
          await insertItemVersion(tx, institutionId, item, "RECORD", null, actor, now);
          results.push({ index, item });
        }
        return { results };
      }, "disbursement_realization_operations");
    },

    async issuePanjar(
      institutionId: string,
      proposalId: string,
      input: PanjarInput,
      actor: CostActor,
      now: number,
      operation: DraftOperation
    ): Promise<PanjarRecord> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        await lockProposalForCosts(tx, institutionId, proposalId);
        if (!(await activeOfficerIds(tx, institutionId)).has(input.holderOfficerId)) {
          throw new RealizationInputError("Petugas penerima panjar tidak terdaftar sebagai petugas aktif lembaga ini.");
        }
        const id = `pjr-${crypto.randomUUID()}`;
        await tx.execute(sql`
          INSERT INTO operational_cost_panjar (
            id, institution_id, proposal_id, holder_officer_id, amount_idr, purpose, cash_out_ref, issued_on,
            recorded_by_officer_id, recorded_by_account, recorded_at
          ) VALUES (
            ${id}, ${institutionId}, ${proposalId}, ${input.holderOfficerId}, ${input.amountIdr}, ${input.purpose},
            ${input.cashOutRef}, ${input.issuedOn}, ${actor.officerId}, ${actor.account.toLowerCase()}, ${now}
          )
        `);
        const state = await loadOperationalCosts(tx, institutionId, proposalId);
        return state.panjar.find((entry) => entry.id === id)!;
      }, "disbursement_realization_operations");
    },

    /** Cash coming back from a panjar; never more than the panjar still leaves open. */
    async returnPanjar(
      institutionId: string,
      proposalId: string,
      panjarId: string,
      input: { amountIdr: string; returnedOn: string; reference: string },
      actor: CostActor,
      now: number,
      operation: DraftOperation
    ): Promise<PanjarRecord> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        await lockProposalForCosts(tx, institutionId, proposalId);
        const state = await loadOperationalCosts(tx, institutionId, proposalId);
        const panjar = state.panjar.find((entry) => entry.id === panjarId);
        if (!panjar) throw new RealizationNotFoundError("Panjar tidak ditemukan pada pengajuan ini.");
        const remaining = panjarRemainingIdr(panjar, state.items);
        if (BigInt(input.amountIdr) > remaining) {
          throw new RealizationInputError(`Pengembalian melebihi sisa panjar ${panjar.cashOutRef} (Rp${remaining}).`);
        }
        await tx.execute(sql`
          INSERT INTO operational_cost_panjar_returns (
            id, institution_id, panjar_id, amount_idr, returned_on, reference,
            recorded_by_officer_id, recorded_by_account, recorded_at
          ) VALUES (
            ${`pjk-${crypto.randomUUID()}`}, ${institutionId}, ${panjarId}, ${input.amountIdr}, ${input.returnedOn},
            ${input.reference}, ${actor.officerId}, ${actor.account.toLowerCase()}, ${now}
          )
        `);
        return (await loadOperationalCosts(tx, institutionId, proposalId)).panjar.find((entry) => entry.id === panjarId)!;
      }, "disbursement_realization_operations");
    },

    /** Pays back one officer's talangan rows at once; each row can be paid back only once. */
    async reimburseTalangan(
      institutionId: string,
      proposalId: string,
      input: { holderOfficerId: string; itemIds: string[]; paidOn: string; reference: string },
      actor: CostActor,
      now: number,
      operation: DraftOperation
    ): Promise<ReimbursementRecord> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        await lockProposalForCosts(tx, institutionId, proposalId);
        const state = await loadOperationalCosts(tx, institutionId, proposalId);
        const ids = [...new Set(input.itemIds)];
        const items = ids.map((id) => state.items.find((item) => item.id === id));
        if (items.some((item) => !item)) throw new RealizationInputError("Sebagian baris biaya tidak ada pada pengajuan ini.");
        const rows = items as CostItemRecord[];
        const foreign = rows.find((item) =>
          item.status !== "ACTIVE" ||
          item.fundingSource.kind !== "TALANGAN" ||
          item.fundingSource.holderOfficerId !== input.holderOfficerId
        );
        if (foreign) {
          throw new RealizationInputError(
            `Baris "${foreign.purpose}" bukan talangan aktif milik petugas ini; penggantian hanya untuk talangan satu petugas.`
          );
        }
        const paid = rows.find((item) => item.reimbursementId);
        if (paid) throw new RealizationStateError(`Talangan "${paid.purpose}" sudah pernah diganti.`);

        const total = rows.reduce((sum, item) => sum + BigInt(item.amountIdr), 0n).toString();
        const id = `rmb-${crypto.randomUUID()}`;
        const row = rowsOf(await tx.execute(sql`
          INSERT INTO operational_cost_reimbursements (
            id, institution_id, proposal_id, holder_officer_id, total_idr, paid_on, reference,
            recorded_by_officer_id, recorded_by_account, recorded_at
          ) VALUES (
            ${id}, ${institutionId}, ${proposalId}, ${input.holderOfficerId}, ${total}, ${input.paidOn}, ${input.reference},
            ${actor.officerId}, ${actor.account.toLowerCase()}, ${now}
          )
          RETURNING *
        `))[0];
        await tx.execute(sql`
          UPDATE operational_cost_items SET reimbursement_id = ${id}, updated_at = ${now}
          WHERE institution_id = ${institutionId} AND id IN (${sql.join(ids.map((itemId) => sql`${itemId}`), sql`, `)})
        `);
        return reimbursementFrom(row, ids);
      }, "disbursement_realization_operations");
    },

    /** Replaces an item's content as a new version; the earlier version stays readable (ADR-0042). */
    async correctCostItem(
      institutionId: string,
      proposalId: string,
      itemId: string,
      input: { expectedVersion: number; reason: string; item: CostItemInput },
      actor: CostActor,
      now: number,
      operation: DraftOperation
    ): Promise<CostItemRecord> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        await lockProposalForCosts(tx, institutionId, proposalId);
        const current = await lockChangeableItem(tx, institutionId, proposalId, itemId, input.expectedVersion);
        const state = await loadOperationalCosts(tx, institutionId, proposalId);
        // The row's own current spend is given back to its panjar before the new amount is checked.
        const others = state.items.filter((item) => item.id !== itemId);
        const issue = fundingIssue(input.item, await activeOfficerIds(tx, institutionId), state.panjar, others, new Map())
          ?? receiptIssue(input.item, await loadReceipts(tx, institutionId, proposalId));
        if (issue) throw new RealizationInputError(issue.message);

        const next = input.item;
        const funding = fundingColumns(next.fundingSource);
        const row = rowsOf(await tx.execute(sql`
          UPDATE operational_cost_items SET
            version = ${current.version + 1}, spent_on = ${next.spentOn}, purpose = ${next.purpose},
            quantity = ${next.quantity}, unit = ${next.unit}, unit_price_idr = ${next.unitPriceIdr},
            amount_idr = ${next.amountIdr}, payee = ${next.payee}, funding_kind = ${funding.kind},
            holder_officer_id = ${funding.holderOfficerId}, panjar_id = ${funding.panjarId},
            receipt_id = ${next.receiptId}, updated_at = ${now}
          WHERE id = ${itemId} AND institution_id = ${institutionId} AND version = ${current.version}
          RETURNING *
        `))[0];
        const item = costItemFrom(row);
        await markReceiptEvidenced(tx, institutionId, item.receiptId, now);
        await insertItemVersion(tx, institutionId, item, "CORRECT", input.reason, actor, now);
        return item;
      }, "disbursement_realization_operations");
    },

    /** A double entry stops counting but stays on record, struck through, with its reason. */
    async voidCostItem(
      institutionId: string,
      proposalId: string,
      itemId: string,
      input: { expectedVersion: number; reason: string },
      actor: CostActor,
      now: number,
      operation: DraftOperation
    ): Promise<CostItemRecord> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        await lockProposalForCosts(tx, institutionId, proposalId);
        const current = await lockChangeableItem(tx, institutionId, proposalId, itemId, input.expectedVersion);
        const row = rowsOf(await tx.execute(sql`
          UPDATE operational_cost_items SET version = ${current.version + 1}, status = 'VOIDED', updated_at = ${now}
          WHERE id = ${itemId} AND institution_id = ${institutionId} AND version = ${current.version}
          RETURNING *
        `))[0];
        const item = costItemFrom(row);
        await insertItemVersion(tx, institutionId, item, "VOID", input.reason, actor, now);
        return item;
      }, "disbursement_realization_operations");
    },

    /** Nota/kuitansi, or a surat pernyataan standing in for a lost one (#126). */
    async recordReceipt(
      institutionId: string,
      proposalId: string,
      input: ReceiptInput,
      actor: CostActor,
      now: number,
      operation: DraftOperation
    ): Promise<ReceiptRecord> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        await lockProposalForCosts(tx, institutionId, proposalId);
        const id = `nta-${crypto.randomUUID()}`;
        await tx.execute(sql`
          INSERT INTO operational_cost_receipts (
            id, institution_id, proposal_id, kind, reference, issued_on, issuer,
            recorded_by_officer_id, recorded_by_account, recorded_at
          ) VALUES (
            ${id}, ${institutionId}, ${proposalId}, ${input.kind}, ${input.reference}, ${input.issuedOn}, ${input.issuer},
            ${actor.officerId}, ${actor.account.toLowerCase()}, ${now}
          )
        `);
        return (await loadReceipts(tx, institutionId, proposalId)).find((receipt) => receipt.id === id)!;
      }, "disbursement_realization_operations");
    },

    /**
     * Attaches one photo or PDF to a receipt. `persist` writes the ciphertext and runs only
     * on the operation's first attempt, so a retried upload neither stores nor lists it twice.
     */
    async addReceiptFile(
      institutionId: string,
      proposalId: string,
      receiptId: string,
      file: { fileName: string; mimeType: ReceiptFileType },
      persist: (fileId: string) => Promise<{ storageRef: string; sizeBytes: number; contentSha256: string }>,
      actor: CostActor,
      now: number,
      operation: DraftOperation
    ): Promise<ReceiptFileRecord> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        await lockProposalForCosts(tx, institutionId, proposalId);
        const receipt = rowsOf(await tx.execute(sql`
          SELECT id FROM operational_cost_receipts
          WHERE id = ${receiptId} AND institution_id = ${institutionId} AND proposal_id = ${proposalId}
        `))[0];
        if (!receipt) throw new RealizationNotFoundError("Nota tidak ditemukan pada pengajuan ini.");
        const id = `ntf-${crypto.randomUUID()}`;
        const stored = await persist(id);
        const row = rowsOf(await tx.execute(sql`
          INSERT INTO operational_cost_receipt_files (
            id, institution_id, receipt_id, file_name, mime_type, size_bytes, content_sha256, storage_ref,
            uploaded_by_officer_id, uploaded_by_account, uploaded_at
          ) VALUES (
            ${id}, ${institutionId}, ${receiptId}, ${file.fileName}, ${file.mimeType}, ${stored.sizeBytes},
            ${stored.contentSha256}, ${stored.storageRef}, ${actor.officerId}, ${actor.account.toLowerCase()}, ${now}
          )
          RETURNING *
        `))[0];
        return receiptFileView(receiptFileFrom(row));
      }, "disbursement_realization_operations");
    },

    async getReceiptFile(institutionId: string, proposalId: string, receiptId: string, fileId: string): Promise<StoredReceiptFile | null> {
      const row = rowsOf(await db.execute(sql`
        SELECT f.* FROM operational_cost_receipt_files f
        JOIN operational_cost_receipts r ON r.id = f.receipt_id AND r.institution_id = f.institution_id
        WHERE f.id = ${fileId} AND f.receipt_id = ${receiptId}
          AND f.institution_id = ${institutionId} AND r.proposal_id = ${proposalId}
      `))[0];
      return row ? receiptFileFrom(row) : null;
    },

    /**
     * Removes a file uploaded by mistake, only while no recorded row has cited its receipt.
     * Returns the locator so the caller can drop the ciphertext once the row is gone.
     */
    async deleteReceiptFile(
      institutionId: string,
      proposalId: string,
      receiptId: string,
      fileId: string
    ): Promise<{ storageRef: string }> {
      return db.transaction(async (tx) => {
        await lockProposalForCosts(tx, institutionId, proposalId);
        const receipt = rowsOf(await tx.execute(sql`
          SELECT evidenced_at FROM operational_cost_receipts
          WHERE id = ${receiptId} AND institution_id = ${institutionId} AND proposal_id = ${proposalId}
          FOR UPDATE
        `))[0];
        if (!receipt) throw new RealizationNotFoundError("Nota tidak ditemukan pada pengajuan ini.");
        if (receipt.evidenced_at !== null && receipt.evidenced_at !== undefined) {
          throw new RealizationStateError(
            "Nota ini sudah menjadi bukti baris biaya tercatat; berkasnya tidak dapat dihapus. Tambahkan berkas atau koreksi barisnya."
          );
        }
        const row = rowsOf(await tx.execute(sql`
          DELETE FROM operational_cost_receipt_files
          WHERE id = ${fileId} AND receipt_id = ${receiptId} AND institution_id = ${institutionId}
          RETURNING storage_ref
        `))[0];
        if (!row) throw new RealizationNotFoundError("Berkas nota tidak ditemukan.");
        return { storageRef: row.storage_ref as string };
      });
    },

    /** Keperluan already typed anywhere in the institution, most used first, to suggest consistent wording. */
    async costPurposes(institutionId: string, limit = 200): Promise<string[]> {
      return rowsOf(await db.execute(sql`
        SELECT purpose FROM operational_cost_items
        WHERE institution_id = ${institutionId} AND status = 'ACTIVE'
        GROUP BY purpose
        ORDER BY COUNT(*) DESC, MAX(seq) DESC
        LIMIT ${limit}
      `)).map((row) => row.purpose as string);
    },

    async costItemHistory(institutionId: string, proposalId: string, itemId: string): Promise<CostItemVersionRecord[]> {
      const rows = rowsOf(await db.execute(sql`
        SELECT v.* FROM operational_cost_item_versions v
        JOIN operational_cost_items i ON i.id = v.item_id
        WHERE v.institution_id = ${institutionId} AND i.proposal_id = ${proposalId} AND v.item_id = ${itemId}
        ORDER BY v.version ASC
      `));
      if (rows.length === 0) throw new RealizationNotFoundError("Baris biaya tidak ditemukan pada pengajuan ini.");
      return rows.map(itemVersionFrom);
    },

    async listAdvances(institutionId: string, proposalId: string): Promise<OperationalAdvanceRecord[]> {
      const { items, panjar } = await loadOperationalCosts(db, institutionId, proposalId);
      const accounts = new Map(rowsOf(await db.execute(sql`
        SELECT id, recorded_by_account FROM operational_cost_panjar
        WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId}
      `)).map((row) => [row.id as string, row.recorded_by_account as string]));
      return panjar.map((p) => advanceFrom(institutionId, p, items, accounts.get(p.id) ?? ""));
    },

    async listExpenses(institutionId: string, proposalId: string): Promise<OperationalExpenseRecord[]> {
      const { items } = await loadOperationalCosts(db, institutionId, proposalId);
      const references = new Map((await loadReceipts(db, institutionId, proposalId)).map((r) => [r.id, r.reference]));
      return items
        .filter((item) => item.status === "ACTIVE")
        .map((item) => expenseFrom(institutionId, item, item.receiptId ? references.get(item.receiptId) ?? "" : ""));
    },

    async listIncompleteEvidenceQueue(institutionId: string): Promise<Array<{
      proposalId: string;
      purpose: string;
      pendingCount: number;
      totalPendingIdr: string | null;
      goods: Array<{ aidType: string; unit: string; quantity: string }>;
      oldestPendingReportedAt: number;
    }>> {
      const rows = rowsOf(await db.execute(sql`
        SELECT r.proposal_id, p.purpose, r.amount_idr, r.quantity, r.unit, r.aid_line_id,
               r.reported_at, v.data_json
        FROM disbursement_realizations r
        JOIN proposal_drafts p ON p.id = r.proposal_id AND p.institution_id = r.institution_id
        LEFT JOIN proposal_versions v ON v.proposal_id = r.proposal_id
          AND v.institution_id = r.institution_id AND v.version = r.proposal_version
        WHERE r.institution_id = ${institutionId} AND r.evidence_status = 'EVIDENCE_PENDING'
        ORDER BY r.reported_at ASC, r.id ASC
      `));
      type PendingGoods = { aidType: string; unit: string; quantity: string };
      const queue = new Map<string, { proposalId: string; purpose: string; pendingCount: number;
        total: bigint | null; goods: Map<string, PendingGoods>; oldestPendingReportedAt: number }>();
      for (const row of rows) {
        const entry = queue.get(row.proposal_id) ?? {
          proposalId: row.proposal_id,
          purpose: row.purpose,
          pendingCount: 0,
          total: null,
          goods: new Map<string, PendingGoods>(),
          oldestPendingReportedAt: asSeconds(row.reported_at),
        };
        entry.pendingCount++;
        if (row.quantity != null) {
          const lines: AidLine[] = JSON.parse(row.data_json ?? "{}").aidLines ?? [];
          const line = lines.find((line) => line.id === row.aid_line_id);
          if (!line || line.value.kind !== "GOODS") throw new Error("Rincian barang pada versi realisasi tidak tersedia.");
          const key = JSON.stringify([line.aidType, row.unit]);
          const current = entry.goods.get(key);
          entry.goods.set(key, { aidType: line.aidType, unit: row.unit,
            quantity: addDecimalStrings(current?.quantity ?? "0", row.quantity) });
        } else if (row.amount_idr != null) {
          entry.total = (entry.total ?? 0n) + BigInt(row.amount_idr);
        }
        queue.set(row.proposal_id, entry);
      }
      return [...queue.values()].map(({ total, goods, ...entry }) => ({ ...entry,
        totalPendingIdr: total?.toString() ?? null,
        goods: [...goods.values()].sort((a, b) => a.aidType.localeCompare(b.aidType) || a.unit.localeCompare(b.unit)),
      }));
    },

    // -----------------------------------------------------------------------
    // Revisi pengajuan (ticket #96)
    // -----------------------------------------------------------------------

    async proposeRevision(
      institutionId: string,
      proposalId: string,
      input: {
        reason: string;
        beneficiaries: Beneficiary[];
        aidLines: AidLine[];
        expectedVersion: number;
      },
      operation: DraftOperation,
      actor: { account: string; officerId: string },
      now: number,
      sourceDocument?: ProposalDocumentRecord & { previewId: string },
    ): Promise<
      ProposalRevisionRecord & {
        kind: "REVISION";
        document?: ProposalDocumentRecord;
      }> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        if (sourceDocument) {
          await consumeBeneficiaryListPreview(
            tx,
            { institutionId, proposalId, account: operation.account },
            sourceDocument.previewId,
            now,
            sourceDocument.storageRef,
          );
        }
        const proposalRow = rowsOf(
          await tx.execute(sql`
            SELECT * FROM proposal_drafts
            WHERE id = ${proposalId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!proposalRow) throw new ProposalDraftConflictError(proposalId);
        const current = draftFrom(proposalRow);

        if (current.version !== input.expectedVersion) throw new ProposalDraftConflictError(proposalId);
        if (current.status !== "APPROVED") {
          throw new ProposalStateConflictError(
            `Pengajuan berstatus "${current.status}". Revisi hanya dapat diajukan pada pengajuan yang telah disetujui (APPROVED).`
          );
        }

        if (current.activeRevisionId) {
          throw new ProposalRevisionConflictError(
            "Terdapat revisi yang sedang aktif pada pengajuan ini. Selesaikan atau tarik revisi tersebut sebelum mengajukan revisi baru."
          );
        }

        const realizations = rowsOf(
          await tx.execute(sql`
            SELECT * FROM disbursement_realizations
            WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId}
          `)
        ).map(realizationRecordFrom);

        const floorValidation = validateRevisionFloor(current.aidLines, input.aidLines, realizations);
        if (!floorValidation.ok) {
          throw new RevisionCapFloorError(floorValidation.error);
        }

        const delta = calculateRevisionDelta(
          { beneficiaries: current.beneficiaries, aidLines: current.aidLines },
          { beneficiaries: input.beneficiaries, aidLines: input.aidLines }
        );

        const countRow = rowsOf(
          await tx.execute(sql`
            SELECT COUNT(*)::integer as count FROM proposal_revisions
            WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId}
          `)
        )[0];
        const revisionNumber = Number(countRow?.count ?? 0) + 1;
        const revisionId = `rev-${crypto.randomUUID()}`;
        const targetVersion = current.version + 1;

        const revRow = rowsOf(
          await tx.execute(sql`
            INSERT INTO proposal_revisions (
              id, proposal_id, institution_id, revision_number, from_version, to_version,
              reason, status, beneficiaries_json, aid_lines_json, delta_json, held_aid_line_ids_json,
              created_by, created_by_officer_id, created_at, updated_at
            ) VALUES (
              ${revisionId}, ${proposalId}, ${institutionId}, ${revisionNumber}, ${current.version}, ${targetVersion},
              ${input.reason}, 'SUBMITTED', ${JSON.stringify(input.beneficiaries)}, ${JSON.stringify(input.aidLines)},
              ${JSON.stringify(delta)}, ${JSON.stringify(delta.heldAidLineIds)},
              ${actor.account.toLowerCase()}, ${actor.officerId}, ${now}, ${now}
            )
            RETURNING *
          `)
        )[0];

        await tx.execute(sql`
          UPDATE proposal_drafts SET
            active_revision_id = ${revisionId},
            held_aid_lines_json = ${JSON.stringify(delta.heldAidLineIds)},
            updated_at = ${now}
          WHERE id = ${proposalId} AND institution_id = ${institutionId}
        `);

        await tx.execute(sql`
          INSERT INTO proposal_history (
            proposal_id, institution_id, version, from_status, to_status, action,
            actor_account, actor_officer_id, reason, notes, occurred_at
          ) VALUES (
            ${proposalId}, ${institutionId}, ${current.version}, ${current.status},
            ${current.status}, 'PROPOSE_REVISION', ${actor.account.toLowerCase()}, ${actor.officerId},
            ${input.reason}, ${`Pengajuan revisi diajukan (target versi: ${targetVersion})`},
            ${now}
          )
        `);

        const document = sourceDocument ? await insertProposalDocument(tx, {
          ...sourceDocument, proposalId, institutionId, version: targetVersion,
          createdBy: actor.account, createdAt: now,
        }) : undefined;
        return { kind: "REVISION", ...revisionFrom(revRow), ...(document ? { document } : {}) };
      });
    },

    async getProposalRevisions(institutionId: string, proposalId: string): Promise<ProposalRevisionRecord[]> {
      const rows = rowsOf(
        await db.execute(sql`
          SELECT * FROM proposal_revisions
          WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId}
          ORDER BY revision_number ASC, created_at ASC
        `)
      );
      return rows.map(revisionFrom);
    },

    async getProposalRevision(institutionId: string, proposalId: string, revisionId: string): Promise<ProposalRevisionRecord | null> {
      const row = rowsOf(
        await db.execute(sql`
          SELECT * FROM proposal_revisions
          WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId} AND id = ${revisionId}
        `)
      )[0];
      return row ? revisionFrom(row) : null;
    },

    async getActiveProposalRevision(institutionId: string, proposalId: string): Promise<ProposalRevisionRecord | null> {
      const draftRow = rowsOf(
        await db.execute(sql`
          SELECT active_revision_id FROM proposal_drafts
          WHERE id = ${proposalId} AND institution_id = ${institutionId}
        `)
      )[0];
      if (!draftRow || !draftRow.active_revision_id) return null;
      return this.getProposalRevision(institutionId, proposalId, draftRow.active_revision_id);
    },

    async withdrawRevision(
      institutionId: string,
      proposalId: string,
      revisionId: string,
      reason: string,
      operation: DraftOperation,
      actor: { account: string; officerId: string },
      now: number
    ): Promise<ProposalRevisionRecord> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        const proposalRow = rowsOf(
          await tx.execute(sql`
            SELECT * FROM proposal_drafts
            WHERE id = ${proposalId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!proposalRow) throw new ProposalDraftConflictError(proposalId);
        const currentDraft = draftFrom(proposalRow);

        const revRow = rowsOf(
          await tx.execute(sql`
            SELECT * FROM proposal_revisions
            WHERE id = ${revisionId} AND proposal_id = ${proposalId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!revRow) throw new RevisionNotFoundError();
        const rev = revisionFrom(revRow);

        if (rev.status === "APPROVED" || rev.status === "REJECTED" || rev.status === "WITHDRAWN") {
          throw new ProposalStateConflictError(`Revisi dengan status "${rev.status}" tidak dapat ditarik.`);
        }

        const updatedRevRow = rowsOf(
          await tx.execute(sql`
            UPDATE proposal_revisions SET
              status = 'WITHDRAWN',
              rejection_reason = ${reason},
              updated_at = ${now}
            WHERE id = ${revisionId}
            RETURNING *
          `)
        )[0];

        if (currentDraft.activeRevisionId === revisionId) {
          await tx.execute(sql`
            UPDATE proposal_drafts SET
              active_revision_id = NULL,
              held_aid_lines_json = '[]',
              updated_at = ${now}
            WHERE id = ${proposalId} AND institution_id = ${institutionId}
          `);
        }

        await tx.execute(sql`
          INSERT INTO proposal_history (
            proposal_id, institution_id, version, from_status, to_status, action,
            actor_account, actor_officer_id, reason, notes, occurred_at
          ) VALUES (
            ${proposalId}, ${institutionId}, ${currentDraft.version}, ${currentDraft.status},
            ${currentDraft.status}, 'WITHDRAW_REVISION', ${actor.account.toLowerCase()}, ${actor.officerId},
            ${reason}, ${`Revisi ditarik (${revisionId})`},
            ${now}
          )
        `);

        return revisionFrom(updatedRevRow);
      });
    },

    async startRevisionExamination(
      institutionId: string,
      proposalId: string,
      revisionId: string,
      operation: DraftOperation,
      actor: { account: string; officerId: string },
      now: number
    ): Promise<ProposalRevisionRecord> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        const revRow = rowsOf(
          await tx.execute(sql`
            SELECT * FROM proposal_revisions
            WHERE id = ${revisionId} AND proposal_id = ${proposalId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!revRow) throw new RevisionNotFoundError();
        const rev = revisionFrom(revRow);
        if (rev.status !== "SUBMITTED" && rev.status !== "REVISION_REQUIRED") {
          throw new ProposalStateConflictError(`Revisi berstatus "${rev.status}" tidak dapat diperiksa.`);
        }

        const updated = rowsOf(
          await tx.execute(sql`
            UPDATE proposal_revisions SET
              status = 'UNDER_EXAMINATION',
              examined_by = ${actor.account.toLowerCase()},
              examined_by_officer_id = ${actor.officerId},
              examined_at = ${now},
              updated_at = ${now}
            WHERE id = ${revisionId}
            RETURNING *
          `)
        )[0];
        return revisionFrom(updated);
      });
    },

    async returnRevisionForRevision(
      institutionId: string,
      proposalId: string,
      revisionId: string,
      input: { reason: string; notes?: string | null; checklist?: ExaminationChecklist | null },
      operation: DraftOperation,
      actor: { account: string; officerId: string },
      now: number
    ): Promise<ProposalRevisionRecord> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        const revRow = rowsOf(
          await tx.execute(sql`
            SELECT * FROM proposal_revisions
            WHERE id = ${revisionId} AND proposal_id = ${proposalId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!revRow) throw new RevisionNotFoundError();
        const rev = revisionFrom(revRow);
        if (rev.status !== "UNDER_EXAMINATION") {
          throw new ProposalStateConflictError(`Revisi berstatus "${rev.status}" tidak sedang diperiksa.`);
        }

        const updated = rowsOf(
          await tx.execute(sql`
            UPDATE proposal_revisions SET
              status = 'REVISION_REQUIRED',
              rejection_reason = ${input.reason},
              examination_notes = ${input.notes ?? null},
              examination_checklist_json = ${input.checklist ? JSON.stringify(input.checklist) : null},
              updated_at = ${now}
            WHERE id = ${revisionId}
            RETURNING *
          `)
        )[0];
        return revisionFrom(updated);
      });
    },

    /**
     * The amil's answer to a returned revision: corrected content on the same revision,
     * back in the examiner's queue. The proposal's in-force version is never touched here.
     */
    async amendRevision(
      institutionId: string,
      proposalId: string,
      revisionId: string,
      input: { reason: string; beneficiaries: Beneficiary[]; aidLines: AidLine[] },
      operation: DraftOperation,
      actor: { account: string; officerId: string },
      now: number
    ): Promise<ProposalRevisionRecord> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        const proposalRow = rowsOf(
          await tx.execute(sql`
            SELECT * FROM proposal_drafts
            WHERE id = ${proposalId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!proposalRow) throw new ProposalDraftConflictError(proposalId);
        const current = draftFrom(proposalRow);

        const revRow = rowsOf(
          await tx.execute(sql`
            SELECT * FROM proposal_revisions
            WHERE id = ${revisionId} AND proposal_id = ${proposalId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!revRow) throw new RevisionNotFoundError();
        const rev = revisionFrom(revRow);
        if (rev.status !== "REVISION_REQUIRED") {
          throw new ProposalStateConflictError(
            `Revisi berstatus "${rev.status}"; hanya revisi yang dikembalikan (REVISION_REQUIRED) yang dapat diperbaiki.`
          );
        }

        const realizations = rowsOf(
          await tx.execute(sql`
            SELECT * FROM disbursement_realizations
            WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId}
          `)
        ).map(realizationRecordFrom);

        const floorValidation = validateRevisionFloor(current.aidLines, input.aidLines, realizations);
        if (!floorValidation.ok) throw new RevisionCapFloorError(floorValidation.error);

        const delta = calculateRevisionDelta(
          { beneficiaries: current.beneficiaries, aidLines: current.aidLines },
          { beneficiaries: input.beneficiaries, aidLines: input.aidLines }
        );

        const updated = rowsOf(
          await tx.execute(sql`
            UPDATE proposal_revisions SET
              status = 'SUBMITTED',
              reason = ${input.reason},
              beneficiaries_json = ${JSON.stringify(input.beneficiaries)},
              aid_lines_json = ${JSON.stringify(input.aidLines)},
              delta_json = ${JSON.stringify(delta)},
              held_aid_line_ids_json = ${JSON.stringify(delta.heldAidLineIds)},
              examination_notes = NULL,
              examination_checklist_json = NULL,
              examined_by = NULL,
              examined_by_officer_id = NULL,
              examined_at = NULL,
              updated_at = ${now}
            WHERE id = ${revisionId}
            RETURNING *
          `)
        )[0];

        await tx.execute(sql`
          UPDATE proposal_drafts SET
            held_aid_lines_json = ${JSON.stringify(delta.heldAidLineIds)},
            updated_at = ${now}
          WHERE id = ${proposalId} AND institution_id = ${institutionId}
        `);

        await tx.execute(sql`
          INSERT INTO proposal_history (
            proposal_id, institution_id, version, from_status, to_status, action,
            actor_account, actor_officer_id, reason, notes, occurred_at
          ) VALUES (
            ${proposalId}, ${institutionId}, ${current.version}, ${current.status},
            ${current.status}, 'AMEND_REVISION', ${actor.account.toLowerCase()}, ${actor.officerId},
            ${input.reason}, ${`Perbaikan revisi #${rev.revisionNumber} setelah dikembalikan`},
            ${now}
          )
        `);

        return revisionFrom(updated);
      });
    },

    async markRevisionReadyForApproval(
      institutionId: string,
      proposalId: string,
      revisionId: string,
      input: { notes?: string | null; checklist?: ExaminationChecklist | null },
      operation: DraftOperation,
      actor: { account: string; officerId: string },
      now: number
    ): Promise<ProposalRevisionRecord> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        const revRow = rowsOf(
          await tx.execute(sql`
            SELECT * FROM proposal_revisions
            WHERE id = ${revisionId} AND proposal_id = ${proposalId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!revRow) throw new RevisionNotFoundError();
        const rev = revisionFrom(revRow);
        if (rev.status !== "UNDER_EXAMINATION") {
          throw new ProposalStateConflictError(`Revisi berstatus "${rev.status}" tidak sedang diperiksa.`);
        }

        const updated = rowsOf(
          await tx.execute(sql`
            UPDATE proposal_revisions SET
              status = 'READY_FOR_DECISION',
              examination_notes = ${input.notes ?? null},
              examination_checklist_json = ${input.checklist ? JSON.stringify(input.checklist) : null},
              updated_at = ${now}
            WHERE id = ${revisionId}
            RETURNING *
          `)
        )[0];
        return revisionFrom(updated);
      });
    },

    async recordRevisionDecision(
      institutionId: string,
      proposalId: string,
      revisionId: string,
      decision: {
        action: "APPROVE" | "REJECT";
        decisionReference: string;
        decisionDate: string;
        decisionDocumentId: string;
        decisionDocumentSha256: `0x${string}`;
        notes?: string | null;
        rejectionReason?: string | null;
        mandateId: string;
        signature: string;
        signerAccount: string;
        challenge: ProposalDecisionChallenge;
      },
      operation: DraftOperation,
      actor: { account: string; officerId: string },
      now: number
    ): Promise<{ revision: ProposalRevisionRecord; draft: StoredProposalDraft }> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        const spent = rowsOf(
          await tx.execute(sql`
            UPDATE proposal_decision_challenges SET consumed_at = ${now}
            WHERE nonce = ${decision.challenge.nonce.toLowerCase()} AND consumed_at IS NULL
            RETURNING nonce
          `)
        )[0];
        if (!spent) throw new DecisionChallengeSpentError();

        const proposalRow = rowsOf(
          await tx.execute(sql`
            SELECT * FROM proposal_drafts
            WHERE id = ${proposalId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!proposalRow) throw new ProposalDraftConflictError(proposalId);
        const current = draftFrom(proposalRow);

        const revRow = rowsOf(
          await tx.execute(sql`
            SELECT * FROM proposal_revisions
            WHERE id = ${revisionId} AND proposal_id = ${proposalId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!revRow) throw new RevisionNotFoundError();
        const rev = revisionFrom(revRow);

        if (rev.status !== "READY_FOR_DECISION") {
          throw new ProposalStateConflictError(`Revisi berstatus "${rev.status}" belum siap disahkan.`);
        }

        if (decision.action === "APPROVE") {
          const realizations = rowsOf(
            await tx.execute(sql`
              SELECT * FROM disbursement_realizations
              WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId}
            `)
          ).map(realizationRecordFrom);
          const floorCheck = validateRevisionFloor(current.aidLines, rev.aidLines, realizations);
          if (!floorCheck.ok) {
            throw new RevisionCapFloorError(floorCheck.error);
          }

          const targetVersion = rev.toVersion;

          // A frozen version snapshot is never rewritten. If this target already exists, another
          // revision reached it first; the caller re-reads and decides again against the new version.
          const occupied = rowsOf(
            await tx.execute(sql`
              SELECT 1 FROM proposal_versions
              WHERE proposal_id = ${proposalId} AND version = ${targetVersion}
            `)
          )[0];
          if (occupied) {
            throw new RevisionSupersededError(
              `Versi ${targetVersion} sudah terisi oleh keputusan lain. Baca ulang pengajuan sebelum mengesahkan revisi ini.`
            );
          }

          const updatedRev = rowsOf(
            await tx.execute(sql`
              UPDATE proposal_revisions SET
                status = 'APPROVED',
                decision_reference = ${decision.decisionReference},
                decision_date = ${decision.decisionDate},
                updated_at = ${now}
              WHERE id = ${revisionId}
              RETURNING *
            `)
          )[0];

          const resolvedAidLines: AidLine[] = rev.aidLines.map((line) => {
            if (line.value.kind === "MONEY") {
              const value = line.value.amountApprovedIdr ?? line.value.amountRequestedIdr;
              return { ...line, value: { ...line.value, amountApprovedIdr: value } };
            } else {
              const value = line.value.quantityApproved ?? line.value.quantityRequested;
              return { ...line, value: { ...line.value, quantityApproved: value } };
            }
          });

          const updatedDraftRaw = rowsOf(
            await tx.execute(sql`
              UPDATE proposal_drafts SET
                version = ${targetVersion},
                beneficiaries_json = ${JSON.stringify(rev.beneficiaries)},
                aid_lines_json = ${JSON.stringify(resolvedAidLines)},
                active_revision_id = NULL,
                held_aid_lines_json = '[]',
                updated_at = ${now}
              WHERE id = ${proposalId} AND institution_id = ${institutionId}
              RETURNING *
            `)
          )[0];

          await tx.execute(sql`
            INSERT INTO proposal_versions (
              proposal_id, version, institution_id, status, data_json,
              documents_json, recurring_warnings_json, submitted_by, submitted_at,
              examination_json, created_at
            ) VALUES (
              ${proposalId}, ${targetVersion}, ${institutionId}, 'APPROVED',
              ${JSON.stringify({
                beneficiaries: rev.beneficiaries,
                aidLines: resolvedAidLines,
                programId: current.programId,
                originOfRequest: current.originOfRequest,
                purpose: current.purpose,
                aidPeriod: current.aidPeriod,
                personInCharge: current.personInCharge,
              })},
              '[]', '[]', ${rev.createdBy}, ${rev.createdAt},
              ${JSON.stringify({
                examinedBy: rev.examinedBy,
                examinedAt: rev.examinedAt,
                examinationNotes: rev.examinationNotes,
                checklist: rev.examinationChecklist,
              })},
              ${now}
            )
          `);

          await tx.execute(sql`
            INSERT INTO proposal_decisions (
              id, proposal_id, proposal_version, institution_id, action,
              decision_reference, decision_date, decision_document_id, decision_document_sha256,
              notes, rejection_reason, rights_digest, operator_officer_id, operator_account, signer_account,
              mandate_id, signature, created_at
            ) VALUES (
              ${`dec-${crypto.randomUUID()}`}, ${proposalId}, ${targetVersion}, ${institutionId}, 'APPROVE',
              ${decision.decisionReference}, ${decision.decisionDate},
              ${decision.decisionDocumentId}, ${decision.decisionDocumentSha256},
              ${decision.notes ?? null}, NULL, ${decision.challenge.rightsDigest},
              ${actor.officerId}, ${actor.account.toLowerCase()}, ${decision.signerAccount.toLowerCase()},
              ${decision.mandateId}, ${decision.signature}, ${now}
            )
          `);

          await tx.execute(sql`
            INSERT INTO proposal_history (
              proposal_id, institution_id, version, from_status, to_status, action,
              actor_account, actor_officer_id, reason, notes, occurred_at
            ) VALUES (
              ${proposalId}, ${institutionId}, ${targetVersion}, 'APPROVED',
              'APPROVED', 'APPROVE_REVISION', ${actor.account.toLowerCase()}, ${actor.officerId},
              ${decision.notes ?? "Revisi disetujui"},
              ${`Revisi #${rev.revisionNumber} disetujui (SK: ${decision.decisionReference})`},
              ${now}
            )
          `);

          return {
            revision: revisionFrom(updatedRev),
            draft: draftFrom(updatedDraftRaw),
          };
        } else {
          const updatedRev = rowsOf(
            await tx.execute(sql`
              UPDATE proposal_revisions SET
                status = 'REJECTED',
                rejection_reason = ${decision.rejectionReason ?? "Ditolak"},
                decision_reference = ${decision.decisionReference},
                decision_date = ${decision.decisionDate},
                updated_at = ${now}
              WHERE id = ${revisionId}
              RETURNING *
            `)
          )[0];

          const updatedDraftRaw = rowsOf(
            await tx.execute(sql`
              UPDATE proposal_drafts SET
                active_revision_id = NULL,
                held_aid_lines_json = '[]',
                updated_at = ${now}
              WHERE id = ${proposalId} AND institution_id = ${institutionId}
              RETURNING *
            `)
          )[0];

          await tx.execute(sql`
            INSERT INTO proposal_history (
              proposal_id, institution_id, version, from_status, to_status, action,
              actor_account, actor_officer_id, reason, notes, occurred_at
            ) VALUES (
              ${proposalId}, ${institutionId}, ${current.version}, 'APPROVED',
              'APPROVED', 'REJECT_REVISION', ${actor.account.toLowerCase()}, ${actor.officerId},
              ${decision.rejectionReason ?? "Revisi ditolak"},
              ${`Revisi #${rev.revisionNumber} ditolak (SK: ${decision.decisionReference})`},
              ${now}
            )
          `);

          return {
            revision: revisionFrom(updatedRev),
            draft: draftFrom(updatedDraftRaw),
          };
        }
      });
    },

    // -----------------------------------------------------------------------
    // Pembatalan pengajuan sebelum realisasi (ticket #96)
    // -----------------------------------------------------------------------

    async cancelProposal(
      institutionId: string,
      proposalId: string,
      input: ProposalTerminationInput,
      operation: DraftOperation,
      actor: { account: string; officerId: string },
      now: number
    ): Promise<{ draft: StoredProposalDraft; decision: ProposalDecisionRecord; summary: ProposalRealizationSummary }> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        const current = await lockApprovedProposalForTermination(tx, institutionId, proposalId, input, now, "dibatalkan");

        const realizationCount = rowsOf(
          await tx.execute(sql`
            SELECT COUNT(*)::integer as count FROM disbursement_realizations
            WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId}
          `)
        )[0];
        if (Number(realizationCount?.count ?? 0) > 0) {
          throw new ProposalCancellationConflictError(
            "Pengajuan yang sudah memiliki realisasi tidak dapat dibatalkan. Gunakan penutupan sisa pengajuan."
          );
        }

        return writeTermination(tx, institutionId, proposalId, current, input, actor, now, {
          action: "CANCEL",
          nextStatus: "CANCELLED",
          revisionWithdrawalReason: "Pengajuan induk dibatalkan.",
          historyNote: `Pengajuan dibatalkan (SK: ${input.decisionReference})`,
          extraDraftColumns: sql`cancel_reason = ${input.reason},`,
        });
      });
    },

    // -----------------------------------------------------------------------
    // Penutupan sisa pengajuan setelah realisasi (ticket #96)
    // -----------------------------------------------------------------------

    async closeProposalRemainder(
      institutionId: string,
      proposalId: string,
      input: ProposalTerminationInput,
      operation: DraftOperation,
      actor: { account: string; officerId: string },
      now: number
    ): Promise<{
      draft: StoredProposalDraft;
      decision: ProposalDecisionRecord;
      closure: ProposalClosureRecord;
      summary: ProposalRealizationSummary;
    }> {
      return mutateOnce(db, institutionId, operation, async (tx) => {
        const current = await lockApprovedProposalForTermination(tx, institutionId, proposalId, input, now, "ditutup sisanya");

        const realizations = rowsOf(
          await tx.execute(sql`
            SELECT * FROM disbursement_realizations
            WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId}
            ORDER BY recorded_at ASC, id ASC
          `)
        ).map(realizationRecordFrom);

        if (realizations.length === 0) {
          throw new ProposalClosureConflictError(
            "Pengajuan belum memiliki realisasi. Gunakan pembatalan pengajuan, bukan penutupan sisa."
          );
        }

        const closure = calculateRemainderClosure(current, realizations, {
          institutionId,
          decisionReference: input.decisionReference,
          decisionDate: input.decisionDate,
          decisionDocumentId: input.decisionDocumentId,
          decisionDocumentSha256: input.decisionDocumentSha256,
          reason: input.reason,
          operatorOfficerId: actor.officerId,
          operatorAccount: actor.account.toLowerCase(),
          signerAccount: input.signerAccount.toLowerCase(),
          now,
        });

        const hasRemaining =
          BigInt(closure.totalUnrealizedRemainderIdr) > 0n ||
          closure.goodsUnitRemainders.some((g) => compareDecimalStrings(g.totalUnrealizedRemainder, "0") > 0);
        if (!hasRemaining) {
          throw new ProposalClosureConflictError(
            "Pengajuan tidak memiliki sisa bantuan yang dapat ditutup karena seluruh hak telah terealisasi penuh."
          );
        }

        const written = await writeTermination(tx, institutionId, proposalId, current, input, actor, now, {
          action: "CLOSE_REMAINDER",
          nextStatus: "REMAINDER_CLOSED",
          revisionWithdrawalReason: "Pengajuan induk ditutup sisanya.",
          historyNote: `Penutupan sisa bantuan (SK: ${input.decisionReference})`,
          extraDraftColumns: sql`
            closure_reason = ${input.reason},
            remainder_closed_json = ${JSON.stringify(closure)},
          `,
        });

        return { ...written, closure };
      });
    },

    /**
     * Reads all recorded realization items, officer advances, and operational expenses
     * for reporting evidence source generation and provenance freezing (Spec #86, Ticket #98).
     *
     * Beneficiary and purpose come from the approved proposal version the realization
     * was recorded against. A realization whose version row is missing is returned
     * flagged, not filled in from the live draft.
     */
    async readRealizationSourceData(institutionId: string): Promise<RealizationSourceData> {
      const realizationRows = rowsOf(await db.execute(sql`
        SELECT r.*, p.program_id, pr.name AS program_name, pr.fund_type AS program_fund_type,
               v.data_json AS version_data_json, d.decided_aid_lines_json
        FROM disbursement_realizations r
        JOIN proposal_drafts p ON p.id = r.proposal_id AND p.institution_id = r.institution_id
        LEFT JOIN programs pr ON pr.id = p.program_id AND pr.institution_id = p.institution_id
        LEFT JOIN proposal_versions v ON v.proposal_id = r.proposal_id AND v.institution_id = r.institution_id AND v.version = r.proposal_version
        LEFT JOIN proposal_decisions d ON d.proposal_id = r.proposal_id AND d.institution_id = r.institution_id
          AND d.proposal_version = r.proposal_version AND d.action = 'APPROVE'
        WHERE r.institution_id = ${institutionId}
        ORDER BY r.recorded_at ASC, r.id ASC
      `));

      const docRows = rowsOf(await db.execute(sql`
        SELECT d.id, d.document_type, d.file_name, d.mime_type, d.size_bytes, d.content_sha256, d.storage_ref,
               d.created_at, d.realization_id AS primary_realization_id, a.realization_id AS alloc_realization_id
        FROM disbursement_realization_documents d
        LEFT JOIN disbursement_realization_document_allocations a ON a.document_id = d.id AND a.institution_id = d.institution_id
        WHERE d.institution_id = ${institutionId}
      `));

      const docsByRealization = new Map<string, Map<string, RealizationDocumentRef>>();
      for (const row of docRows) {
        const docRef: RealizationDocumentRef = {
          id: row.id,
          documentType: row.document_type,
          fileName: row.file_name,
          mimeType: row.mime_type,
          sizeBytes: Number(row.size_bytes),
          contentSha256: row.content_sha256,
          storageRef: row.storage_ref,
          createdAt: asSeconds(row.created_at),
        };
        for (const realizationId of [row.primary_realization_id, row.alloc_realization_id].filter(Boolean)) {
          const docs = docsByRealization.get(realizationId) ?? new Map<string, RealizationDocumentRef>();
          docs.set(docRef.id, docRef);
          docsByRealization.set(realizationId, docs);
        }
      }

      const disputeRows = rowsOf(await db.execute(sql`
        SELECT id, realization_id, subject, status, reason, disputed_amount_idr, disputed_quantity, disputed_unit, created_at
        FROM disbursement_realization_disputes
        WHERE institution_id = ${institutionId}
      `));

      const disputesByRealization = new Map<string, RealizationDisputeRef[]>();
      for (const row of disputeRows) {
        const list = disputesByRealization.get(row.realization_id) ?? [];
        list.push({
          id: row.id,
          subject: row.subject,
          status: row.status,
          reason: row.reason,
          createdAt: asSeconds(row.created_at),
          disputedAmountIdr: row.disputed_amount_idr ?? null,
          disputedQuantity: row.disputed_quantity ?? null,
          disputedUnit: row.disputed_unit ?? null,
        });
        disputesByRealization.set(row.realization_id, list);
      }

      const realizations: RealizationItemData[] = realizationRows.map((row) => {
        let snapshot: any = null;
        try {
          snapshot = row.version_data_json
            ? withDecidedAidLines(JSON.parse(row.version_data_json), row.decided_aid_lines_json ?? null)
            : null;
        } catch {
          snapshot = null;
        }
        const beneficiaries: Beneficiary[] = snapshot?.beneficiaries ?? [];
        const beneficiary = beneficiaries.find((b) => b.id === row.beneficiary_id);
        const aidLine = (snapshot?.aidLines as AidLine[] | undefined)?.find((l) => l.id === row.aid_line_id);
        const nik = beneficiary?.identityBasis?.kind === "NIK" ? beneficiary.identityBasis.value : null;

        return {
          id: row.id,
          institutionId: row.institution_id,
          proposalId: row.proposal_id,
          proposalVersion: Number(row.proposal_version),
          proposalVersionFound: snapshot !== null,
          programId: snapshot?.programId ?? row.program_id ?? null,
          programName: row.program_name ?? null,
          programFundType: row.program_fund_type ?? null,
          proposalPurpose: snapshot?.purpose ?? "",
          aidLineId: row.aid_line_id,
          beneficiaryId: row.beneficiary_id,
          beneficiaryName: beneficiary?.name ?? row.beneficiary_id,
          beneficiaryNikMasked: nik ? maskNik(nik) : null,
          beneficiaryAsnaf: beneficiary?.asnaf ?? null,
          method: row.method,
          amountIdr: row.amount_idr ?? null,
          quantity: row.quantity ?? null,
          unit: row.unit ?? null,
          reportedAt: asSeconds(row.reported_at),
          recordedAt: asSeconds(row.recorded_at),
          operatorAccount: row.operator_account,
          operatorOfficerId: row.operator_officer_id,
          notes: row.notes ?? null,
          evidenceStatus: row.evidence_status,
          confirmationStatus: row.confirmation_status,
          confirmationMethod: row.confirmation_method ?? null,
          documents: Array.from(docsByRealization.get(row.id)?.values() ?? []),
          disputes: disputesByRealization.get(row.id) ?? [],
          aidLineValuation:
            aidLine?.value.kind === "GOODS"
              ? {
                  unit: aidLine.value.unit,
                  quantityApproved: aidLine.value.quantityApproved ?? null,
                  // Only a value the institution stated a basis for is carried; see goodsValuationOf.
                  valuedAmountIdr: goodsValuationOf(aidLine.value),
                  valuationBasis: goodsValuationOf(aidLine.value) === null ? null : (aidLine.value.valuationBasis ?? null),
                }
              : null,
        };
      });

      // A panjar reads as an advance net of what came back, a live cost row as an expense
      // against its panjar. The old uang muka and biaya rows were carried into these (#128).
      const advances: RealizationAdvanceItem[] = [];
      const expenses: RealizationExpenseItem[] = [];
      const costState = await loadOperationalCosts(db, institutionId, null);
      for (const panjar of costState.panjar) {
        const returned = panjar.returns.reduce((sum, ret) => sum + BigInt(ret.amountIdr), 0n);
        const net = BigInt(panjar.amountIdr) - returned;
        advances.push({
          id: panjar.id, proposalId: panjar.proposalId, amountIdr: (net > 0n ? net : 0n).toString(),
          purpose: panjar.purpose, reference: panjar.cashOutRef, issuedAt: panjar.recordedAt,
        });
      }
      for (const item of costState.items) {
        if (item.status !== "ACTIVE") continue;
        expenses.push({
          id: item.id, proposalId: item.proposalId,
          advanceId: item.fundingSource.kind === "PANJAR" ? item.fundingSource.panjarId : null,
          amountIdr: item.amountIdr, purpose: item.purpose, payee: item.payee, recordedAt: item.recordedAt,
        });
      }
      // In time order, as the old rows were read: carried rows took their sequence numbers
      // after rows already typed in the tab. Rows of one batch share a time and keep their order.
      advances.sort((a, b) => a.issuedAt - b.issuedAt);
      expenses.sort((a, b) => a.recordedAt - b.recordedAt);

      return { realizations, advances, expenses };
    },
  };
}

export type DisbursementStore = ReturnType<typeof createDisbursementStore>;

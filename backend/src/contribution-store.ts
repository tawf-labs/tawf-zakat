/**
 * Contribution Storage Layer (Spec #100, Ticket #102).
 *
 * Durable PostgreSQL storage for:
 * - Institutional contributions (IDR and USDC 6dp strictly separate)
 * - Source deduplication by (institutionId, sourceChannel, sourceReference)
 * - Progressive reconciliation and endorsement lifecycle
 * - Versioned audit history and optimistic concurrency
 * - Tabular import drafts and commits
 * - Idempotent operation tracking
 */

import { sql, type SQL } from "drizzle-orm";
import {
  checkStatusTransition,
  evaluateQualificationReason,
  validateContributionInput,
  validateCorrectionInput,
  validateRefundDecisionInput,
  validateRefundPaymentInput,
  type ContributionCorrection,
  type ContributionEvent,
  type ContributionInput,
  type ContributionRecord,
  type ContributionRefund,
  type ContributionStatus,
  type CorrectionType,
  type EndorsementInput,
  type JenisDana,
  type ReconciliationInput,
  type RefundStatus,
  type SourceChannel,
} from "./contribution";
import type { CurrencyUnit } from "./reconciliation";

export type ContributionDatabase = {
  execute: (query: any) => Promise<any>;
  transaction: <T>(run: (tx: { execute: (query: any) => Promise<any> }) => Promise<T>) => Promise<T>;
};

export type StoredContributionHistory = {
  id: number;
  contributionId: string;
  institutionId: string;
  version: number;
  fromStatus: ContributionStatus;
  toStatus: ContributionStatus;
  action: string;
  actorAccount: string;
  actorOfficerId: string | null;
  reason: string | null;
  notes: string | null;
  occurredAt: number;
};

export type StoredImportDraft = {
  id: string;
  institutionId: string;
  createdBy: string;
  fileName: string;
  currencyUnit: CurrencyUnit;
  rawRowsCount: number;
  validRowsCount: number;
  invalidRowsCount: number;
  totalValidAmount: string;
  rowsJson: string;
  issuesJson: string;
  status: "DRAFT" | "COMMITTED" | "DISCARDED";
  createdAt: number;
  updatedAt: number;
};

export type StoredContributionDocument = {
  id: string;
  contributionId: string;
  institutionId: string;
  category: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  storageStatus: "STORED" | "FAILED";
  storageRef: string | null;
  createdBy: string;
  createdAt: number;
};

export type ContributionOperation = {
  operationId: string;
  account: string;
  requestHash: string;
};

export type ActorIdentity = {
  account: string;
  officerId: string | null;
};

export type ImportDraftInput = {
  id?: string;
  fileName: string;
  currencyUnit: CurrencyUnit;
  rawRowsCount: number;
  validRowsCount: number;
  invalidRowsCount: number;
  totalValidAmount: string;
  rowsJson: string;
  issuesJson: string;
};

export class ContributionNotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} "${id}" tidak ditemukan pada ruang kerja lembaga ini.`);
    this.name = "ContributionNotFoundError";
  }
}

export class ContributionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContributionConflictError";
  }
}

export class ContributionDuplicateError extends Error {
  constructor(channel: string, ref: string) {
    super(`Penerimaan dengan kanal "${channel}" dan referensi "${ref}" sudah pernah dicatat pada lembaga ini.`);
    this.name = "ContributionDuplicateError";
  }
}

export class ContributionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContributionStateError";
  }
}

export class ContributionOperationConflictError extends Error {
  constructor() {
    super("Identitas operasi (operationId) sudah digunakan untuk permintaan berbeda.");
    this.name = "ContributionOperationConflictError";
  }
}

export const CONTRIBUTION_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS contributions (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     source_channel TEXT NOT NULL,
     source_reference TEXT NOT NULL,
     currency_unit TEXT NOT NULL,
     amount_exact TEXT NOT NULL,
     fund_type TEXT NOT NULL,
     purpose TEXT NOT NULL DEFAULT '',
     received_at BIGINT NOT NULL,
     donor_name TEXT,
     donor_contact TEXT,
     status TEXT NOT NULL DEFAULT 'RECEIVED',
     reconciled_at BIGINT,
     reconciled_by TEXT,
     reconciliation_proof_ref TEXT,
     reconciliation_notes TEXT,
     endorsed_at BIGINT,
     endorsed_by TEXT,
     endorsement_mandate_id TEXT,
     endorsement_notes TEXT,
     unqualified_reason TEXT,
     version INTEGER NOT NULL DEFAULT 1,
     created_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL,
     created_by TEXT NOT NULL
   );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS contributions_source_unique ON contributions (institution_id, source_channel, source_reference);`,
  `CREATE INDEX IF NOT EXISTS contributions_by_institution ON contributions (institution_id, updated_at DESC);`,
  `CREATE INDEX IF NOT EXISTS contributions_by_status ON contributions (institution_id, status, updated_at DESC);`,
  `CREATE TABLE IF NOT EXISTS contribution_history (
     id SERIAL PRIMARY KEY,
     contribution_id TEXT NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
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
  `CREATE INDEX IF NOT EXISTS contribution_history_by_contrib ON contribution_history (institution_id, contribution_id, occurred_at ASC);`,
  `CREATE TABLE IF NOT EXISTS contribution_operations (
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     account TEXT NOT NULL,
     operation_id TEXT NOT NULL,
     request_hash TEXT NOT NULL,
     result_json TEXT,
     PRIMARY KEY (institution_id, account, operation_id)
   );`,
  `CREATE TABLE IF NOT EXISTS contribution_import_drafts (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     created_by TEXT NOT NULL,
     file_name TEXT NOT NULL,
     currency_unit TEXT NOT NULL,
     raw_rows_count INTEGER NOT NULL,
     valid_rows_count INTEGER NOT NULL,
     invalid_rows_count INTEGER NOT NULL,
     total_valid_amount TEXT NOT NULL,
     rows_json TEXT NOT NULL DEFAULT '[]',
     issues_json TEXT NOT NULL DEFAULT '[]',
     status TEXT NOT NULL DEFAULT 'DRAFT',
     created_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS contribution_import_drafts_by_inst ON contribution_import_drafts (institution_id, updated_at DESC);`,
  `CREATE TABLE IF NOT EXISTS contribution_documents (
     id TEXT PRIMARY KEY,
     contribution_id TEXT REFERENCES contributions(id) ON DELETE CASCADE,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     category TEXT NOT NULL,
     file_name TEXT NOT NULL,
     mime_type TEXT NOT NULL,
     size_bytes INTEGER NOT NULL,
     content_sha256 TEXT NOT NULL,
     storage_status TEXT NOT NULL,
     storage_ref TEXT,
     created_by TEXT NOT NULL,
     created_at BIGINT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS contribution_documents_by_contrib ON contribution_documents (institution_id, contribution_id);`,
  `CREATE TABLE IF NOT EXISTS contribution_corrections (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     contribution_id TEXT NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
     from_version INTEGER NOT NULL,
     to_version INTEGER NOT NULL,
     correction_type TEXT NOT NULL,
     from_amount_exact TEXT NOT NULL,
     to_amount_exact TEXT NOT NULL,
     reason TEXT NOT NULL,
     source_proof_ref TEXT NOT NULL,
     actor_account TEXT NOT NULL,
     actor_officer_id TEXT REFERENCES officer_profiles(id),
     created_at BIGINT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS contribution_corrections_by_contrib ON contribution_corrections (institution_id, contribution_id, created_at ASC);`,
  `CREATE TABLE IF NOT EXISTS contribution_refunds (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     contribution_id TEXT NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
     amount_exact TEXT NOT NULL,
     currency_unit TEXT NOT NULL DEFAULT 'IDR',
     fund_type TEXT NOT NULL,
     reason TEXT NOT NULL,
     policy_basis TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'DECIDED',
     contribution_version INTEGER NOT NULL,
     decided_at BIGINT NOT NULL,
     decided_by TEXT NOT NULL,
     decided_by_officer_id TEXT REFERENCES officer_profiles(id),
     paid_at BIGINT,
     paid_by TEXT,
     paid_by_officer_id TEXT REFERENCES officer_profiles(id),
     payment_proof_ref TEXT,
     payment_notes TEXT,
     version INTEGER NOT NULL DEFAULT 1,
     created_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS contribution_refunds_by_contrib ON contribution_refunds (institution_id, contribution_id);`,
  `CREATE INDEX IF NOT EXISTS contribution_refunds_by_status ON contribution_refunds (institution_id, status);`,
  `CREATE TABLE IF NOT EXISTS contribution_events (
     id SERIAL PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     contribution_id TEXT NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
     version INTEGER NOT NULL,
     previous_version INTEGER NOT NULL,
     event_type TEXT NOT NULL,
     amount_exact TEXT NOT NULL,
     reason TEXT NOT NULL,
     source_proof_ref TEXT,
     actor_account TEXT NOT NULL,
     actor_officer_id TEXT REFERENCES officer_profiles(id),
     occurred_at BIGINT NOT NULL,
     proof_superseded BOOLEAN NOT NULL DEFAULT true
   );`,
  `CREATE INDEX IF NOT EXISTS contribution_events_by_contrib ON contribution_events (institution_id, contribution_id, version ASC);`,
];

type Executor = { execute: ContributionDatabase["execute"] };

function rowsOf(result: any): any[] {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.rows)) return result.rows;
  return [];
}

function contributionFromRow(row: any): ContributionRecord {
  return {
    id: row.id,
    institutionId: row.institution_id,
    sourceChannel: row.source_channel as SourceChannel,
    sourceReference: row.source_reference,
    currencyUnit: row.currency_unit as CurrencyUnit,
    amountExact: String(row.amount_exact),
    fundType: row.fund_type as JenisDana,
    purpose: row.purpose ?? "",
    receivedAt: Number(row.received_at),
    donorName: row.donor_name ?? null,
    donorContact: row.donor_contact ?? null,
    status: row.status as ContributionStatus,
    reconciledAt: row.reconciled_at ? Number(row.reconciled_at) : null,
    reconciledBy: row.reconciled_by ?? null,
    reconciliationProofRef: row.reconciliation_proof_ref ?? null,
    reconciliationNotes: row.reconciliation_notes ?? null,
    endorsedAt: row.endorsed_at ? Number(row.endorsed_at) : null,
    endorsedBy: row.endorsed_by ?? null,
    endorsementMandateId: row.endorsement_mandate_id ?? null,
    endorsementNotes: row.endorsement_notes ?? null,
    unqualifiedReason: row.unqualified_reason ?? evaluateQualificationReason(row.status),
    version: Number(row.version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    createdBy: row.created_by,
  };
}

function draftFromRow(row: any): StoredImportDraft {
  return {
    id: row.id,
    institutionId: row.institution_id,
    createdBy: row.created_by,
    fileName: row.file_name,
    currencyUnit: row.currency_unit as CurrencyUnit,
    rawRowsCount: Number(row.raw_rows_count),
    validRowsCount: Number(row.valid_rows_count),
    invalidRowsCount: Number(row.invalid_rows_count),
    totalValidAmount: row.total_valid_amount,
    rowsJson: row.rows_json,
    issuesJson: row.issues_json,
    status: row.status as ImportDraftStatus,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function documentFromRow(row: any): StoredContributionDocument {
  return {
    id: row.id,
    contributionId: row.contribution_id,
    institutionId: row.institution_id,
    category: row.category,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    contentSha256: row.content_sha256,
    storageStatus: row.storage_status as "STORED" | "FAILED",
    storageRef: row.storage_ref ?? null,
    createdBy: row.created_by,
    createdAt: Number(row.created_at),
  };
}

function correctionFromRow(row: any): ContributionCorrection {
  return {
    id: row.id,
    institutionId: row.institution_id,
    contributionId: row.contribution_id,
    fromVersion: Number(row.from_version),
    toVersion: Number(row.to_version),
    correctionType: row.correction_type as CorrectionType,
    fromAmountExact: String(row.from_amount_exact),
    toAmountExact: String(row.to_amount_exact),
    reason: row.reason,
    sourceProofRef: row.source_proof_ref,
    actorAccount: row.actor_account,
    actorOfficerId: row.actor_officer_id ?? null,
    createdAt: Number(row.created_at),
  };
}

function refundFromRow(row: any): ContributionRefund {
  return {
    id: row.id,
    institutionId: row.institution_id,
    contributionId: row.contribution_id,
    amountExact: String(row.amount_exact),
    currencyUnit: row.currency_unit as CurrencyUnit,
    fundType: row.fund_type as JenisDana,
    reason: row.reason,
    policyBasis: row.policy_basis,
    status: row.status as RefundStatus,
    contributionVersion: Number(row.contribution_version),
    decidedAt: Number(row.decided_at),
    decidedBy: row.decided_by,
    decidedByOfficerId: row.decided_by_officer_id ?? null,
    paidAt: row.paid_at ? Number(row.paid_at) : null,
    paidBy: row.paid_by ?? null,
    paidByOfficerId: row.paid_by_officer_id ?? null,
    paymentProofRef: row.payment_proof_ref ?? null,
    paymentNotes: row.payment_notes ?? null,
    version: Number(row.version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function eventFromRow(row: any): ContributionEvent {
  return {
    id: Number(row.id),
    institutionId: row.institution_id,
    contributionId: row.contribution_id,
    version: Number(row.version),
    previousVersion: Number(row.previous_version),
    eventType: row.event_type,
    amountExact: String(row.amount_exact),
    reason: row.reason,
    sourceProofRef: row.source_proof_ref ?? null,
    actorAccount: row.actor_account,
    actorOfficerId: row.actor_officer_id ?? null,
    occurredAt: Number(row.occurred_at),
    proofSuperseded: Boolean(row.proof_superseded),
  };
}

async function selectContribution(tx: Executor, institutionId: string, id: string): Promise<ContributionRecord> {
  const row = rowsOf(
    await tx.execute(sql`SELECT * FROM contributions WHERE id = ${id} AND institution_id = ${institutionId}`)
  )[0];
  return contributionFromRow(row);
}

/** The single write path for a RECEIVED record, used by the form and by an import commit alike. */
async function insertReceived(
  tx: Executor,
  institutionId: string,
  input: ContributionInput,
  actor: ActorIdentity,
  now: number,
  note: string
): Promise<ContributionRecord> {
  const existing = rowsOf(
    await tx.execute(sql`
      SELECT id FROM contributions
      WHERE institution_id = ${institutionId}
        AND source_channel = ${input.sourceChannel}
        AND source_reference = ${input.sourceReference}
    `)
  )[0];
  if (existing) {
    throw new ContributionDuplicateError(input.sourceChannel, input.sourceReference);
  }

  const id = input.id || `contrib_${crypto.randomUUID()}`;
  await tx.execute(sql`
    INSERT INTO contributions (
      id, institution_id, source_channel, source_reference,
      currency_unit, amount_exact, fund_type, purpose,
      received_at, donor_name, donor_contact, status,
      unqualified_reason, version, created_at, updated_at, created_by
    ) VALUES (
      ${id}, ${institutionId}, ${input.sourceChannel}, ${input.sourceReference},
      ${input.currencyUnit}, ${input.amountExact}, ${input.fundType}, ${input.purpose},
      ${input.receivedAt}, ${input.donorName ?? null}, ${input.donorContact ?? null}, 'RECEIVED',
      ${evaluateQualificationReason("RECEIVED")}, 1, ${now}, ${now}, ${actor.account}
    )
  `);
  await tx.execute(sql`
    INSERT INTO contribution_history (
      contribution_id, institution_id, version, from_status, to_status,
      action, actor_account, actor_officer_id, notes, occurred_at
    ) VALUES (
      ${id}, ${institutionId}, 1, 'RECEIVED', 'RECEIVED',
      'RECORD', ${actor.account}, ${actor.officerId ?? null}, ${note}, ${now}
    )
  `);
  return selectContribution(tx, institutionId, id);
}

type TransitionStep = {
  target: "RECONCILED" | "ENDORSED";
  action: "RECONCILE" | "ENDORSE";
  defaultNote: string;
  notes: string | null;
  columns: (actorRef: string) => SQL;
};

/** Lock, check version and lifecycle, apply the step's columns, and write history, all in one place. */
async function applyTransition(
  tx: Executor,
  institutionId: string,
  id: string,
  expectedVersion: number,
  actor: ActorIdentity,
  now: number,
  step: TransitionStep
): Promise<ContributionRecord> {
  const row = rowsOf(
    await tx.execute(sql`
      SELECT * FROM contributions
      WHERE id = ${id} AND institution_id = ${institutionId}
      FOR UPDATE
    `)
  )[0];

  if (!row) throw new ContributionNotFoundError(id);
  if (Number(row.version) !== expectedVersion) throw new ContributionConflictError(id);

  const currentStatus = row.status as ContributionStatus;
  const transition = checkStatusTransition(currentStatus, step.target);
  if (!transition.allowed || currentStatus === step.target) {
    throw new ContributionStateError(
      transition.issue?.message || `Kontribusi sudah berstatus ${step.target}.`
    );
  }

  const newVersion = expectedVersion + 1;
  await tx.execute(sql`
    UPDATE contributions
    SET status = ${step.target},
        ${step.columns(actor.officerId || actor.account)},
        unqualified_reason = ${evaluateQualificationReason(step.target)},
        version = ${newVersion},
        updated_at = ${now}
    WHERE id = ${id} AND institution_id = ${institutionId} AND version = ${expectedVersion}
  `);
  await tx.execute(sql`
    INSERT INTO contribution_history (
      contribution_id, institution_id, version, from_status, to_status,
      action, actor_account, actor_officer_id, notes, occurred_at
    ) VALUES (
      ${id}, ${institutionId}, ${newVersion}, ${currentStatus}, ${step.target},
      ${step.action}, ${actor.account}, ${actor.officerId ?? null}, ${step.notes ?? step.defaultNote}, ${now}
    )
  `);
  return selectContribution(tx, institutionId, id);
}

export type ContributionStore = {
  ensureSchema: () => Promise<void>;

  createContribution: (
    institutionId: string,
    input: ContributionInput,
    actor: ActorIdentity,
    now: number,
    operation?: ContributionOperation
  ) => Promise<ContributionRecord>;

  getContribution: (institutionId: string, id: string) => Promise<ContributionRecord | null>;

  listContributions: (
    institutionId: string,
    filters?: { status?: ContributionStatus; currencyUnit?: CurrencyUnit; fundType?: JenisDana }
  ) => Promise<ContributionRecord[]>;

  reconcileContribution: (
    institutionId: string,
    id: string,
    expectedVersion: number,
    input: ReconciliationInput,
    actor: ActorIdentity,
    now: number,
    operation?: ContributionOperation
  ) => Promise<ContributionRecord>;

  endorseContribution: (
    institutionId: string,
    id: string,
    expectedVersion: number,
    input: EndorsementInput,
    actor: ActorIdentity,
    now: number,
    operation?: ContributionOperation
  ) => Promise<ContributionRecord>;

  saveImportDraft: (
    institutionId: string,
    draft: ImportDraftInput,
    actor: ActorIdentity,
    now: number
  ) => Promise<StoredImportDraft>;

  getImportDraft: (institutionId: string, draftId: string) => Promise<StoredImportDraft | null>;

  listImportDrafts: (institutionId: string) => Promise<StoredImportDraft[]>;

  commitImportDraft: (
    institutionId: string,
    draftId: string,
    actor: ActorIdentity,
    now: number,
    operation?: ContributionOperation
  ) => Promise<{ committedCount: number; ignoredInvalidRows: number; contributions: ContributionRecord[] }>;

  discardImportDraft: (institutionId: string, draftId: string, now: number) => Promise<StoredImportDraft>;

  attachDocument: (doc: StoredContributionDocument) => Promise<StoredContributionDocument>;

  listDocuments: (institutionId: string, contributionId: string) => Promise<StoredContributionDocument[]>;

  getHistory: (institutionId: string, contributionId: string) => Promise<StoredContributionHistory[]>;

  correctContribution: (
    institutionId: string,
    params: {
      contributionId: string;
      expectedVersion: number;
      correctionType: CorrectionType;
      amountExact?: string;
      reason: string;
      sourceProofRef: string;
    },
    operation: ContributionOperation,
    actor: ActorIdentity,
    now: number
  ) => Promise<{ contribution: ContributionRecord; correction: ContributionCorrection }>;

  listCorrections: (institutionId: string, contributionId: string) => Promise<ContributionCorrection[]>;

  decideRefund: (
    institutionId: string,
    params: {
      contributionId: string;
      expectedVersion: number;
      amountExact: string;
      reason: string;
      policyBasis: string;
    },
    operation: ContributionOperation,
    actor: ActorIdentity,
    now: number
  ) => Promise<ContributionRefund>;

  payRefund: (
    institutionId: string,
    params: {
      contributionId: string;
      refundId: string;
      paymentProofRef: string;
      paidAt: number;
      paymentNotes?: string;
    },
    operation: ContributionOperation,
    actor: ActorIdentity,
    now: number
  ) => Promise<ContributionRefund>;

  listRefunds: (institutionId: string, contributionId: string) => Promise<ContributionRefund[]>;

  getEvents: (institutionId: string, contributionId: string) => Promise<ContributionEvent[]>;

  getRefundTotals: (
    institutionId: string,
    contributionIds: string[]
  ) => Promise<Map<string, { paidRefundTotal: string; decidedRefundTotal: string }>>;
};

export function createContributionStore(database: ContributionDatabase): ContributionStore {
  async function withOperation<T>(
    institutionId: string,
    operation: ContributionOperation | undefined,
    action: (tx: Executor) => Promise<T>
  ): Promise<T> {
    if (!operation) {
      return database.transaction(action);
    }

    return database.transaction(async (tx) => {
      const existingOp = rowsOf(
        await tx.execute(sql`
          SELECT * FROM contribution_operations
          WHERE institution_id = ${institutionId}
            AND account = ${operation.account}
            AND operation_id = ${operation.operationId}
          FOR UPDATE
        `)
      )[0];

      if (existingOp) {
        if (existingOp.request_hash !== operation.requestHash) {
          throw new ContributionOperationConflictError();
        }
        if (existingOp.result_json) {
          return JSON.parse(existingOp.result_json) as T;
        }
      } else {
        await tx.execute(sql`
          INSERT INTO contribution_operations (institution_id, account, operation_id, request_hash)
          VALUES (${institutionId}, ${operation.account}, ${operation.operationId}, ${operation.requestHash})
        `);
      }

      const result = await action(tx);

      await tx.execute(sql`
        UPDATE contribution_operations
        SET result_json = ${JSON.stringify(result)}
        WHERE institution_id = ${institutionId}
          AND account = ${operation.account}
          AND operation_id = ${operation.operationId}
      `);

      return result;
    });
  }

  return {
    async ensureSchema() {
      for (const statement of CONTRIBUTION_SCHEMA_STATEMENTS) {
        await database.execute(sql.raw(statement));
      }
    },

    async createContribution(institutionId, input, actor, now, operation) {
      return withOperation(institutionId, operation, (tx) =>
        insertReceived(tx, institutionId, input, actor, now, "Pencatatan penerimaan kontribusi")
      );
    },

    async getContribution(institutionId, id) {
      const row = rowsOf(
        await database.execute(sql`
          SELECT * FROM contributions
          WHERE id = ${id} AND institution_id = ${institutionId}
        `)
      )[0];
      return row ? contributionFromRow(row) : null;
    },

    async listContributions(institutionId, filters) {
      let query = sql`SELECT * FROM contributions WHERE institution_id = ${institutionId}`;
      if (filters?.status) {
        query = sql`${query} AND status = ${filters.status}`;
      }
      if (filters?.currencyUnit) {
        query = sql`${query} AND currency_unit = ${filters.currencyUnit}`;
      }
      if (filters?.fundType) {
        query = sql`${query} AND fund_type = ${filters.fundType}`;
      }
      query = sql`${query} ORDER BY updated_at DESC`;

      const rows = rowsOf(await database.execute(query));
      return rows.map(contributionFromRow);
    },

    async reconcileContribution(institutionId, id, expectedVersion, input, actor, now, operation) {
      return withOperation(institutionId, operation, (tx) =>
        applyTransition(tx, institutionId, id, expectedVersion, actor, now, {
          target: "RECONCILED",
          action: "RECONCILE",
          defaultNote: "Pencocokan sumber lembaga berhasil",
          notes: input.notes ?? null,
          columns: (actorRef) => sql`
            reconciled_at = ${now},
            reconciled_by = ${actorRef},
            reconciliation_proof_ref = ${input.proofRef},
            reconciliation_notes = ${input.notes ?? null}`,
        })
      );
    },

    async endorseContribution(institutionId, id, expectedVersion, input, actor, now, operation) {
      return withOperation(institutionId, operation, (tx) =>
        applyTransition(tx, institutionId, id, expectedVersion, actor, now, {
          target: "ENDORSED",
          action: "ENDORSE",
          defaultNote: "Pengesahan lembaga untuk batch kontribusi",
          notes: input.notes ?? null,
          columns: (actorRef) => sql`
            endorsed_at = ${now},
            endorsed_by = ${actorRef},
            endorsement_mandate_id = ${input.mandateId},
            endorsement_notes = ${input.notes ?? null}`,
        })
      );
    },

    async saveImportDraft(institutionId, draft, actor, now) {
      return database.transaction(async (tx) => {
        const existing = rowsOf(
          await tx.execute(sql`
            SELECT status FROM contribution_import_drafts
            WHERE id = ${draft.id} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];

        if (existing) {
          if (existing.status !== "DRAFT") {
            throw new ContributionStateError(`Draf impor berstatus ${existing.status} tidak dapat diubah.`);
          }
          await tx.execute(sql`
            UPDATE contribution_import_drafts
            SET file_name = ${draft.fileName},
                currency_unit = ${draft.currencyUnit},
                raw_rows_count = ${draft.rawRowsCount},
                valid_rows_count = ${draft.validRowsCount},
                invalid_rows_count = ${draft.invalidRowsCount},
                total_valid_amount = ${draft.totalValidAmount},
                rows_json = ${draft.rowsJson},
                issues_json = ${draft.issuesJson},
                updated_at = ${now}
            WHERE id = ${draft.id} AND institution_id = ${institutionId}
          `);
        } else {
          await tx.execute(sql`
            INSERT INTO contribution_import_drafts (
              id, institution_id, created_by, file_name,
              currency_unit, raw_rows_count, valid_rows_count, invalid_rows_count,
              total_valid_amount, rows_json, issues_json, status,
              created_at, updated_at
            ) VALUES (
              ${draft.id}, ${institutionId}, ${actor.account}, ${draft.fileName},
              ${draft.currencyUnit}, ${draft.rawRowsCount}, ${draft.validRowsCount}, ${draft.invalidRowsCount},
              ${draft.totalValidAmount}, ${draft.rowsJson}, ${draft.issuesJson}, 'DRAFT',
              ${now}, ${now}
            )
          `);
        }

        const stored = rowsOf(
          await tx.execute(sql`
            SELECT * FROM contribution_import_drafts
            WHERE id = ${draft.id} AND institution_id = ${institutionId}
          `)
        )[0];
        return draftFromRow(stored);
      });
    },

    async getImportDraft(institutionId, draftId) {
      const row = rowsOf(
        await database.execute(sql`
          SELECT * FROM contribution_import_drafts
          WHERE id = ${draftId} AND institution_id = ${institutionId}
        `)
      )[0];
      return row ? draftFromRow(row) : null;
    },

    async listImportDrafts(institutionId) {
      const rows = rowsOf(
        await database.execute(sql`
          SELECT * FROM contribution_import_drafts
          WHERE institution_id = ${institutionId}
          ORDER BY updated_at DESC
        `)
      );
      return rows.map(draftFromRow);
    },

    async commitImportDraft(institutionId, draftId, actor, now, operation) {
      return withOperation(institutionId, operation, async (tx) => {
        const draftRow = rowsOf(
          await tx.execute(sql`
            SELECT * FROM contribution_import_drafts
            WHERE id = ${draftId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];

        if (!draftRow) throw new ContributionNotFoundError(draftId, "Draf impor");
        if (draftRow.status === "COMMITTED") {
          throw new ContributionStateError("Draf impor ini sudah pernah dikomit.");
        }
        if (draftRow.status === "DISCARDED") {
          throw new ContributionStateError("Draf impor ini telah dibuang.");
        }

        const rows: { rowNumber: number; isValid: boolean; contribution?: ContributionInput }[] =
          JSON.parse(draftRow.rows_json || "[]");
        // Re-checked here rather than trusted from the stored preview: a row enters only
        // if it still passes the form's validator in the draft's own currency unit.
        const validRows = rows.filter(
          (r) =>
            r.isValid &&
            r.contribution &&
            r.contribution.currencyUnit === draftRow.currency_unit &&
            validateContributionInput(r.contribution).length === 0
        );

        if (validRows.length === 0) {
          throw new ContributionStateError("Draf impor tidak memiliki baris valid untuk dikomit.");
        }

        const contributions: ContributionRecord[] = [];
        for (const item of validRows) {
          contributions.push(
            await insertReceived(
              tx,
              institutionId,
              item.contribution!,
              actor,
              now,
              `Komit impor dari berkas ${draftRow.file_name} baris ${item.rowNumber}`
            )
          );
        }

        await tx.execute(sql`
          UPDATE contribution_import_drafts
          SET status = 'COMMITTED', updated_at = ${now}
          WHERE id = ${draftId} AND institution_id = ${institutionId}
        `);

        return {
          committedCount: contributions.length,
          ignoredInvalidRows: rows.length - contributions.length,
          contributions,
        };
      });
    },

    async discardImportDraft(institutionId, draftId, now) {
      return database.transaction(async (tx) => {
        const row = rowsOf(
          await tx.execute(sql`
            SELECT * FROM contribution_import_drafts
            WHERE id = ${draftId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!row) throw new ContributionNotFoundError(draftId, "Draf impor");
        if (row.status === "COMMITTED") {
          throw new ContributionStateError("Draf impor yang sudah dikomit tidak dapat dibuang.");
        }
        const updated = rowsOf(
          await tx.execute(sql`
            UPDATE contribution_import_drafts
            SET status = 'DISCARDED', updated_at = ${now}
            WHERE id = ${draftId} AND institution_id = ${institutionId}
            RETURNING *
          `)
        )[0];
        return draftFromRow(updated);
      });
    },

    async attachDocument(doc) {
      await database.execute(sql`
        INSERT INTO contribution_documents (
          id, contribution_id, institution_id, category, file_name,
          mime_type, size_bytes, content_sha256, storage_status, storage_ref,
          created_by, created_at
        ) VALUES (
          ${doc.id}, ${doc.contributionId}, ${doc.institutionId}, ${doc.category}, ${doc.fileName},
          ${doc.mimeType}, ${doc.sizeBytes}, ${doc.contentSha256}, ${doc.storageStatus}, ${doc.storageRef ?? null},
          ${doc.createdBy}, ${doc.createdAt}
        )
      `);
      return doc;
    },

    async listDocuments(institutionId, contributionId) {
      const rows = rowsOf(
        await database.execute(sql`
          SELECT * FROM contribution_documents
          WHERE contribution_id = ${contributionId} AND institution_id = ${institutionId}
          ORDER BY created_at ASC
        `)
      );
      return rows.map(documentFromRow);
    },

    async getHistory(institutionId, contributionId) {
      const rows = rowsOf(
        await database.execute(sql`
          SELECT * FROM contribution_history
          WHERE contribution_id = ${contributionId} AND institution_id = ${institutionId}
          ORDER BY occurred_at ASC, id ASC
        `)
      );
      return rows.map((r) => ({
        id: Number(r.id),
        contributionId: r.contribution_id,
        institutionId: r.institution_id,
        version: Number(r.version),
        fromStatus: r.from_status as ContributionStatus,
        toStatus: r.to_status as ContributionStatus,
        action: r.action,
        actorAccount: r.actor_account,
        actorOfficerId: r.actor_officer_id ?? null,
        reason: r.reason ?? null,
        notes: r.notes ?? null,
        occurredAt: Number(r.occurred_at),
      }));
    },

    async correctContribution(institutionId, params, operation, actor, now) {
      return withOperation(institutionId, operation, async (tx) => {
        const row = rowsOf(
          await tx.execute(sql`
            SELECT * FROM contributions
            WHERE id = ${params.contributionId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!row) throw new ContributionNotFoundError("Catatan kontribusi", params.contributionId);
        const currentVersion = Number(row.version);
        if (currentVersion !== params.expectedVersion) {
          throw new ContributionConflictError(
            `Catatan kontribusi "${params.contributionId}" telah diperbarui sejak versi yang Anda muat. Muat ulang sebelum mencoba lagi.`
          );
        }

        const issues = validateCorrectionInput(params, String(row.amount_exact));
        if (issues.length > 0) {
          throw new ContributionStateError(issues.map((i) => i.message).join(" "));
        }

        const newVersion = currentVersion + 1;
        const newAmount = params.correctionType === "AMOUNT" ? String(params.amountExact) : String(row.amount_exact);
        const newStatus = params.correctionType === "DUPLICATE" ? "REJECTED" : row.status;
        const unqualifiedReason =
          params.correctionType === "DUPLICATE"
            ? "Pencatatan ganda dikoreksi: tanpa arus kas balik."
            : row.unqualified_reason;

        const updated = rowsOf(
          await tx.execute(sql`
            UPDATE contributions
            SET amount_exact = ${newAmount},
                status = ${newStatus},
                unqualified_reason = ${unqualifiedReason},
                version = ${newVersion},
                updated_at = ${now}
            WHERE id = ${params.contributionId} AND institution_id = ${institutionId}
            RETURNING *
          `)
        )[0];

        const correctionId = `cor-${crypto.randomUUID()}`;
        const correctionRow = rowsOf(
          await tx.execute(sql`
            INSERT INTO contribution_corrections (
              id, institution_id, contribution_id, from_version, to_version,
              correction_type, from_amount_exact, to_amount_exact, reason,
              source_proof_ref, actor_account, actor_officer_id, created_at
            ) VALUES (
              ${correctionId}, ${institutionId}, ${params.contributionId}, ${currentVersion}, ${newVersion},
              ${params.correctionType}, ${String(row.amount_exact)}, ${newAmount}, ${params.reason},
              ${params.sourceProofRef}, ${actor.account}, ${actor.officerId ?? null}, ${now}
            )
            RETURNING *
          `)
        )[0];

        await tx.execute(sql`
          INSERT INTO contribution_events (
            institution_id, contribution_id, version, previous_version,
            event_type, amount_exact, reason, source_proof_ref,
            actor_account, actor_officer_id, occurred_at, proof_superseded
          ) VALUES (
            ${institutionId}, ${params.contributionId}, ${newVersion}, ${currentVersion},
            'CORRECTION', ${newAmount}, ${params.reason}, ${params.sourceProofRef},
            ${actor.account}, ${actor.officerId ?? null}, ${now}, true
          )
        `);

        await tx.execute(sql`
          INSERT INTO contribution_history (
            contribution_id, institution_id, version, from_status, to_status,
            action, actor_account, actor_officer_id, reason, notes, occurred_at
          ) VALUES (
            ${params.contributionId}, ${institutionId}, ${newVersion}, ${row.status}, ${newStatus},
            ${params.correctionType === "DUPLICATE" ? "CORRECT_DUPLICATE" : "CORRECT_AMOUNT"},
            ${actor.account}, ${actor.officerId ?? null}, ${params.reason},
            ${`Koreksi (${params.correctionType}): ${params.reason}. Bukti: ${params.sourceProofRef}`}, ${now}
          )
        `);

        return {
          contribution: contributionFromRow(updated),
          correction: correctionFromRow(correctionRow),
        };
      });
    },

    async listCorrections(institutionId, contributionId) {
      const rows = rowsOf(
        await database.execute(sql`
          SELECT * FROM contribution_corrections
          WHERE contribution_id = ${contributionId} AND institution_id = ${institutionId}
          ORDER BY created_at ASC, id ASC
        `)
      );
      return rows.map(correctionFromRow);
    },

    async decideRefund(institutionId, params, operation, actor, now) {
      return withOperation(institutionId, operation, async (tx) => {
        const row = rowsOf(
          await tx.execute(sql`
            SELECT * FROM contributions
            WHERE id = ${params.contributionId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!row) throw new ContributionNotFoundError("Catatan kontribusi", params.contributionId);
        const currentVersion = Number(row.version);
        if (currentVersion !== params.expectedVersion) {
          throw new ContributionConflictError(
            `Catatan kontribusi "${params.contributionId}" telah diperbarui sejak versi yang Anda muat. Muat ulang sebelum mencoba lagi.`
          );
        }

        const existingRefundRows = rowsOf(
          await tx.execute(sql`
            SELECT amount_exact, status FROM contribution_refunds
            WHERE contribution_id = ${params.contributionId} AND institution_id = ${institutionId}
              AND status IN ('DECIDED', 'PAID')
          `)
        );
        const totalRefundsSoFar = existingRefundRows.reduce(
          (sum: bigint, r: any) => sum + BigInt(r.amount_exact),
          0n
        );
        const contributionTotal = BigInt(row.amount_exact);
        const availableToRefund = contributionTotal > totalRefundsSoFar ? contributionTotal - totalRefundsSoFar : 0n;

        const issues = validateRefundDecisionInput(params, availableToRefund);
        if (issues.length > 0) {
          throw new ContributionStateError(issues.map((i) => i.message).join(" "));
        }

        const refundId = `ref-${crypto.randomUUID()}`;
        const inserted = rowsOf(
          await tx.execute(sql`
            INSERT INTO contribution_refunds (
              id, institution_id, contribution_id, amount_exact, currency_unit, fund_type,
              reason, policy_basis, status, contribution_version, decided_at,
              decided_by, decided_by_officer_id, paid_at, paid_by, paid_by_officer_id,
              payment_proof_ref, payment_notes, version, created_at, updated_at
            ) VALUES (
              ${refundId}, ${institutionId}, ${params.contributionId}, ${params.amountExact},
              ${row.currency_unit}, ${row.fund_type}, ${params.reason}, ${params.policyBasis},
              'DECIDED', ${currentVersion}, ${now}, ${actor.account}, ${actor.officerId ?? null},
              NULL, NULL, NULL, NULL, NULL, 1, ${now}, ${now}
            )
            RETURNING *
          `)
        )[0];

        await tx.execute(sql`
          INSERT INTO contribution_events (
            institution_id, contribution_id, version, previous_version,
            event_type, amount_exact, reason, source_proof_ref,
            actor_account, actor_officer_id, occurred_at, proof_superseded
          ) VALUES (
            ${institutionId}, ${params.contributionId}, ${currentVersion}, ${currentVersion},
            'REFUND_DECISION', ${params.amountExact}, ${params.reason}, ${params.policyBasis},
            ${actor.account}, ${actor.officerId ?? null}, ${now}, false
          )
        `);

        await tx.execute(sql`
          INSERT INTO contribution_history (
            contribution_id, institution_id, version, from_status, to_status,
            action, actor_account, actor_officer_id, reason, notes, occurred_at
          ) VALUES (
            ${params.contributionId}, ${institutionId}, ${currentVersion}, ${row.status}, ${row.status},
            'DECIDE_REFUND', ${actor.account}, ${actor.officerId ?? null}, ${params.reason},
            ${`Keputusan refund ${params.amountExact} dicatat (Menunggu Pembayaran). Kebijakan: ${params.policyBasis}`}, ${now}
          )
        `);

        return refundFromRow(inserted);
      });
    },

    async payRefund(institutionId, params, operation, actor, now) {
      return withOperation(institutionId, operation, async (tx) => {
        const refundRow = rowsOf(
          await tx.execute(sql`
            SELECT * FROM contribution_refunds
            WHERE id = ${params.refundId} AND contribution_id = ${params.contributionId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!refundRow) throw new ContributionNotFoundError("Data keputusan pengembalian", params.refundId);
        if (refundRow.status === "PAID") {
          throw new ContributionConflictError("Pembayaran pengembalian dana ini sudah pernah dicatat.");
        }
        if (refundRow.status !== "DECIDED") {
          throw new ContributionStateError(`Pengembalian dengan status "${refundRow.status}" tidak dapat dibayarkan.`);
        }

        const issues = validateRefundPaymentInput(params);
        if (issues.length > 0) {
          throw new ContributionStateError(issues.map((i) => i.message).join(" "));
        }

        const contribRow = rowsOf(
          await tx.execute(sql`
            SELECT * FROM contributions
            WHERE id = ${params.contributionId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!contribRow) throw new ContributionNotFoundError("Catatan kontribusi", params.contributionId);

        const currentVersion = Number(contribRow.version);
        const newVersion = currentVersion + 1;

        await tx.execute(sql`
          UPDATE contributions
          SET version = ${newVersion}, updated_at = ${now}
          WHERE id = ${params.contributionId} AND institution_id = ${institutionId}
        `);

        const updatedRefund = rowsOf(
          await tx.execute(sql`
            UPDATE contribution_refunds
            SET status = 'PAID',
                paid_at = ${params.paidAt},
                paid_by = ${actor.account},
                paid_by_officer_id = ${actor.officerId ?? null},
                payment_proof_ref = ${params.paymentProofRef},
                payment_notes = ${params.paymentNotes ?? null},
                version = version + 1,
                updated_at = ${now}
            WHERE id = ${params.refundId} AND institution_id = ${institutionId}
            RETURNING *
          `)
        )[0];

        await tx.execute(sql`
          INSERT INTO contribution_events (
            institution_id, contribution_id, version, previous_version,
            event_type, amount_exact, reason, source_proof_ref,
            actor_account, actor_officer_id, occurred_at, proof_superseded
          ) VALUES (
            ${institutionId}, ${params.contributionId}, ${newVersion}, ${currentVersion},
            'REFUND_PAYMENT', ${refundRow.amount_exact}, 'Pembayaran pengembalian dana dicatat', ${params.paymentProofRef},
            ${actor.account}, ${actor.officerId ?? null}, ${now}, true
          )
        `);

        await tx.execute(sql`
          INSERT INTO contribution_history (
            contribution_id, institution_id, version, from_status, to_status,
            action, actor_account, actor_officer_id, reason, notes, occurred_at
          ) VALUES (
            ${params.contributionId}, ${institutionId}, ${newVersion}, ${contribRow.status}, ${contribRow.status},
            'PAY_REFUND', ${actor.account}, ${actor.officerId ?? null},
            'Pembayaran pengembalian dana selesai',
            ${`Pembayaran pengembalian dana sebesar ${refundRow.amount_exact} dicatat. Bukti: ${params.paymentProofRef}`}, ${now}
          )
        `);

        return refundFromRow(updatedRefund);
      });
    },

    async listRefunds(institutionId, contributionId) {
      const rows = rowsOf(
        await database.execute(sql`
          SELECT * FROM contribution_refunds
          WHERE contribution_id = ${contributionId} AND institution_id = ${institutionId}
          ORDER BY created_at ASC, id ASC
        `)
      );
      return rows.map(refundFromRow);
    },

    async getEvents(institutionId, contributionId) {
      const rows = rowsOf(
        await database.execute(sql`
          SELECT * FROM contribution_events
          WHERE contribution_id = ${contributionId} AND institution_id = ${institutionId}
          ORDER BY occurred_at ASC, id ASC
        `)
      );
      return rows.map(eventFromRow);
    },

    async getRefundTotals(institutionId, contributionIds) {
      if (contributionIds.length === 0) return new Map();
      const rows = rowsOf(
        await database.execute(sql`
          SELECT contribution_id,
                 COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount_exact::numeric ELSE 0 END), 0)::text AS paid_total,
                 COALESCE(SUM(CASE WHEN status = 'DECIDED' THEN amount_exact::numeric ELSE 0 END), 0)::text AS decided_total
          FROM contribution_refunds
          WHERE institution_id = ${institutionId}
            AND contribution_id IN (${sql.join(contributionIds.map((id) => sql`${id}`), sql`, `)})
          GROUP BY contribution_id
        `)
      );
      return new Map(
        rows.map((row) => [
          row.contribution_id as string,
          { paidRefundTotal: row.paid_total as string, decidedRefundTotal: row.decided_total as string },
        ])
      );
    },
  };
}

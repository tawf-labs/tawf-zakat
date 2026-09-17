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
  type ContributionInput,
  type ContributionRecord,
  type ContributionStatus,
  type EndorsementInput,
  type JenisDana,
  type ReconciliationInput,
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

export type ImportDraftStatus = "DRAFT" | "COMMITTED" | "DISCARDED";

/** What the server read out of an import file; the counts and rows are never taken from a client. */
export type ImportDraftInput = {
  id: string;
  fileName: string;
  currencyUnit: CurrencyUnit;
  rawRowsCount: number;
  validRowsCount: number;
  invalidRowsCount: number;
  totalValidAmount: string;
  rowsJson: string;
  issuesJson: string;
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
  status: ImportDraftStatus;
  createdAt: number;
  updatedAt: number;
};

export class ContributionDuplicateError extends Error {
  constructor(channel: string, ref: string) {
    super(`Penerimaan dengan kanal "${channel}" dan referensi "${ref}" sudah pernah dicatat pada lembaga ini.`);
    this.name = "ContributionDuplicateError";
  }
}

export class ContributionConflictError extends Error {
  constructor(id: string) {
    super(`Catatan kontribusi "${id}" telah diperbarui oleh pihak lain sejak versi yang Anda muat. Muat ulang sebelum mencoba lagi.`);
    this.name = "ContributionConflictError";
  }
}

export class ContributionNotFoundError extends Error {
  constructor(id: string, what = "Catatan kontribusi") {
    super(`${what} "${id}" tidak ditemukan pada ruang kerja lembaga ini.`);
    this.name = "ContributionNotFoundError";
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

export type ContributionOperation = {
  operationId: string;
  account: string;
  requestHash: string;
};

export type ActorIdentity = {
  account: string;
  officerId: string | null;
};

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
  };
}

/**
 * Where auditor findings are kept (Issue #99).
 *
 * A finding is an immutable head - the report version it binds and the auditor's
 * original wording - followed by an append-only event log. Nothing in these
 * tables is ever updated or deleted: status, assignment and corrected notes are
 * projections of the log, computed by the reader.
 *
 * Every mutation runs in one transaction that locks the finding head, checks the
 * revision the caller last read and appends at the next sequence number, so two
 * people acting on the same finding cannot both succeed against the same state.
 * The `(finding_id, seq)` key makes the database refuse it even if a caller forgot
 * to lock. Each mutation is also recorded under the caller's operation id, and a
 * retry with the same id and body replays the recorded result instead of writing
 * twice.
 *
 * No cascades: a finding outlives any attempt to delete what it examined.
 */

import { sql, type SQL } from "drizzle-orm";
import {
  AUDIT_ATTACHMENT_ACCESS,
  AUDIT_FINDING_EVENT_TYPES,
  AUDIT_FINDING_SCOPES,
  AUDIT_FINDING_SEVERITIES,
  AUDIT_FINDING_STATUSES,
  type AuditAttachmentAccess,
  type AuditFindingActorRole,
  type AuditFindingEventType,
  type AuditFindingScope,
  type AuditFindingSeverity,
  type AuditFindingStatus,
  type AuditFindingTargets,
  type AuditorFollowupAction,
} from "../../shared/audit-findings";

type Executor = { execute: (query: SQL) => Promise<unknown> };

export type AuditFindingDatabase = Executor & {
  transaction: <T>(run: (tx: Executor) => Promise<T>) => Promise<T>;
};

export class AuditFindingConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditFindingConflict";
  }
}

export type AuditFindingHead = {
  id: string;
  institutionId: string;
  preparationId: string;
  packageId: string;
  packageDigest: string;
  reportId: string;
  reportVersion: string;
  createdBy: string;
  scope: AuditFindingScope;
  severity: AuditFindingSeverity;
  title: string;
  description: string;
  targetProposalId: string | null;
  targetProposalVersion: number | null;
  targetRealizationId: string | null;
  targetDocumentId: string | null;
  targetDisputeId: string | null;
  createdAt: number;
};

export type StoredAuditEvent = {
  id: string;
  findingId: string;
  seq: number;
  eventType: AuditFindingEventType;
  actorAccount: string;
  actorRole: AuditFindingActorRole;
  actorOfficerId: string | null;
  actorName: string;
  mandateRef: string | null;
  assignmentRef: string | null;
  assignedAuditor: string | null;
  correctsEventId: string | null;
  followupAction: AuditorFollowupAction | null;
  note: string;
  resultingStatus: AuditFindingStatus;
  createdAt: number;
};

export type StoredAuditFile = {
  id: string;
  findingId: string;
  eventId: string;
  uploaderAccount: string;
  uploaderRole: AuditFindingActorRole;
  access: AuditAttachmentAccess;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  /** The private locator. Kept here, never put in a response. */
  storageRef: string;
  createdAt: number;
};

export type StoredAuditFinding = { head: AuditFindingHead; events: StoredAuditEvent[]; files: StoredAuditFile[] };

/** An event to append; the store assigns the sequence number. */
export type NewAuditEvent = Omit<StoredAuditEvent, "seq">;
export type NewAuditFile = Omit<StoredAuditFile, "findingId" | "eventId">;

export type AuditOperation = { account: string; id: string; requestHash: string };

const ACTOR_ROLES: readonly AuditFindingActorRole[] = ["AUDITOR", "AMIL"];
/** A CHECK list written from the shared constants, so a new value is added in one place. */
const known = (values: readonly string[]) => values.map(value => `'${value}'`).join(", ");

export const AUDIT_FINDING_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS audit_findings (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     preparation_id TEXT NOT NULL REFERENCES evidence_preparations (id),
     package_id TEXT NOT NULL REFERENCES report_packages (id),
     package_digest TEXT NOT NULL,
     report_id TEXT NOT NULL,
     report_version TEXT NOT NULL,
     created_by TEXT NOT NULL,
     scope TEXT NOT NULL,
     severity TEXT NOT NULL,
     title TEXT NOT NULL,
     description TEXT NOT NULL,
     target_proposal_id TEXT,
     target_proposal_version INTEGER,
     target_realization_id TEXT,
     target_document_id TEXT,
     target_dispute_id TEXT,
     created_at BIGINT NOT NULL,
     CONSTRAINT audit_findings_scope_known
       CHECK (scope IN (${known(AUDIT_FINDING_SCOPES)})),
     CONSTRAINT audit_findings_severity_known
       CHECK (severity IN (${known(AUDIT_FINDING_SEVERITIES)}))
   );`,
  `CREATE INDEX IF NOT EXISTS audit_findings_by_package
     ON audit_findings (institution_id, package_id, created_at DESC);`,
  `CREATE TABLE IF NOT EXISTS audit_finding_events (
     id TEXT PRIMARY KEY,
     finding_id TEXT NOT NULL REFERENCES audit_findings (id),
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     seq INTEGER NOT NULL,
     event_type TEXT NOT NULL,
     actor_account TEXT NOT NULL,
     actor_role TEXT NOT NULL,
     actor_officer_id TEXT,
     actor_name TEXT NOT NULL,
     mandate_ref TEXT,
     assignment_ref TEXT,
     assigned_auditor TEXT,
     corrects_event_id TEXT REFERENCES audit_finding_events (id),
     followup_action TEXT,
     note TEXT NOT NULL,
     resulting_status TEXT NOT NULL,
     created_at BIGINT NOT NULL,
     CONSTRAINT audit_finding_events_one_per_seq UNIQUE (finding_id, seq),
     CONSTRAINT audit_finding_events_type_known CHECK (event_type IN (${known(AUDIT_FINDING_EVENT_TYPES)})),
     CONSTRAINT audit_finding_events_role_known CHECK (actor_role IN (${known(ACTOR_ROLES)})),
     CONSTRAINT audit_finding_events_status_known CHECK (resulting_status IN (${known(AUDIT_FINDING_STATUSES)}))
   );`,
  `CREATE TABLE IF NOT EXISTS audit_finding_files (
     id TEXT PRIMARY KEY,
     finding_id TEXT NOT NULL REFERENCES audit_findings (id),
     event_id TEXT NOT NULL REFERENCES audit_finding_events (id),
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     uploader_account TEXT NOT NULL,
     uploader_role TEXT NOT NULL,
     access TEXT NOT NULL,
     file_name TEXT NOT NULL,
     mime_type TEXT NOT NULL,
     size_bytes INTEGER NOT NULL,
     content_sha256 TEXT NOT NULL,
     storage_ref TEXT NOT NULL,
     created_at BIGINT NOT NULL,
     CONSTRAINT audit_finding_files_access_known CHECK (access IN (${known(AUDIT_ATTACHMENT_ACCESS)})),
     CONSTRAINT audit_finding_files_role_known CHECK (uploader_role IN (${known(ACTOR_ROLES)}))
   );`,
  `CREATE INDEX IF NOT EXISTS audit_finding_files_by_finding ON audit_finding_files (institution_id, finding_id);`,
  `CREATE TABLE IF NOT EXISTS audit_finding_operations (
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     account TEXT NOT NULL,
     operation_id TEXT NOT NULL,
     request_hash TEXT NOT NULL,
     finding_id TEXT,
     PRIMARY KEY (institution_id, account, operation_id)
   );`,
] as const;

const rowsOf = (result: any): any[] =>
  Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];

const headFrom = (row: any): AuditFindingHead => ({
  id: row.id,
  institutionId: row.institution_id,
  preparationId: row.preparation_id,
  packageId: row.package_id,
  packageDigest: row.package_digest,
  reportId: row.report_id,
  reportVersion: row.report_version,
  createdBy: row.created_by,
  scope: row.scope,
  severity: row.severity,
  title: row.title,
  description: row.description,
  targetProposalId: row.target_proposal_id ?? null,
  targetProposalVersion: row.target_proposal_version == null ? null : Number(row.target_proposal_version),
  targetRealizationId: row.target_realization_id ?? null,
  targetDocumentId: row.target_document_id ?? null,
  targetDisputeId: row.target_dispute_id ?? null,
  createdAt: Number(row.created_at),
});

const eventFrom = (row: any): StoredAuditEvent => ({
  id: row.id,
  findingId: row.finding_id,
  seq: Number(row.seq),
  eventType: row.event_type,
  actorAccount: row.actor_account,
  actorRole: row.actor_role,
  actorOfficerId: row.actor_officer_id ?? null,
  actorName: row.actor_name,
  mandateRef: row.mandate_ref ?? null,
  assignmentRef: row.assignment_ref ?? null,
  assignedAuditor: row.assigned_auditor ?? null,
  correctsEventId: row.corrects_event_id ?? null,
  followupAction: row.followup_action ?? null,
  note: row.note,
  resultingStatus: row.resulting_status,
  createdAt: Number(row.created_at),
});

const fileFrom = (row: any): StoredAuditFile => ({
  id: row.id,
  findingId: row.finding_id,
  eventId: row.event_id,
  uploaderAccount: row.uploader_account,
  uploaderRole: row.uploader_role,
  access: row.access,
  fileName: row.file_name,
  mimeType: row.mime_type,
  sizeBytes: Number(row.size_bytes),
  contentSha256: row.content_sha256,
  storageRef: row.storage_ref,
  createdAt: Number(row.created_at),
});

async function insertEvent(tx: Executor, institutionId: string, seq: number, event: NewAuditEvent, files: NewAuditFile[]) {
  await tx.execute(sql`
    INSERT INTO audit_finding_events (
      id, finding_id, institution_id, seq, event_type, actor_account, actor_role, actor_officer_id, actor_name,
      mandate_ref, assignment_ref, assigned_auditor, corrects_event_id, followup_action, note, resulting_status, created_at
    ) VALUES (
      ${event.id}, ${event.findingId}, ${institutionId}, ${seq}, ${event.eventType}, ${event.actorAccount},
      ${event.actorRole}, ${event.actorOfficerId}, ${event.actorName}, ${event.mandateRef}, ${event.assignmentRef},
      ${event.assignedAuditor}, ${event.correctsEventId}, ${event.followupAction}, ${event.note},
      ${event.resultingStatus}, ${event.createdAt}
    )
  `);
  for (const file of files) {
    await tx.execute(sql`
      INSERT INTO audit_finding_files (
        id, finding_id, event_id, institution_id, uploader_account, uploader_role, access,
        file_name, mime_type, size_bytes, content_sha256, storage_ref, created_at
      ) VALUES (
        ${file.id}, ${event.findingId}, ${event.id}, ${institutionId}, ${file.uploaderAccount}, ${file.uploaderRole},
        ${file.access}, ${file.fileName}, ${file.mimeType}, ${file.sizeBytes}, ${file.contentSha256},
        ${file.storageRef}, ${file.createdAt}
      )
    `);
  }
}

/** Heads, events and files for a set of findings in three queries, not one round per finding. */
async function readMany(tx: Executor, institutionId: string, heads: AuditFindingHead[]): Promise<StoredAuditFinding[]> {
  if (!heads.length) return [];
  const ids = heads.map(head => head.id);
  const idList = sql.join(ids.map(id => sql`${id}`), sql`, `);
  const events = rowsOf(await tx.execute(sql`
    SELECT * FROM audit_finding_events
    WHERE institution_id = ${institutionId} AND finding_id IN (${idList})
    ORDER BY finding_id, seq ASC
  `)).map(eventFrom);
  const files = rowsOf(await tx.execute(sql`
    SELECT * FROM audit_finding_files
    WHERE institution_id = ${institutionId} AND finding_id IN (${idList})
    ORDER BY created_at ASC, id ASC
  `)).map(fileFrom);
  return heads.map(head => ({
    head,
    events: events.filter(event => event.findingId === head.id),
    files: files.filter(file => file.findingId === head.id),
  }));
}

export function createAuditFindingStore(db: AuditFindingDatabase) {
  /**
   * Claims the operation id, or replays it. A retry with the same body gets the
   * finding it produced; a different body under the same id is a conflict.
   */
  async function claim(tx: Executor, institutionId: string, operation: AuditOperation): Promise<{ replayed: string | null }> {
    const inserted = rowsOf(await tx.execute(sql`
      INSERT INTO audit_finding_operations (institution_id, account, operation_id, request_hash)
      VALUES (${institutionId}, ${operation.account}, ${operation.id}, ${operation.requestHash})
      ON CONFLICT DO NOTHING RETURNING operation_id
    `));
    if (inserted.length) return { replayed: null };
    const previous = await operationResult(tx, institutionId, operation);
    if (!previous) throw new AuditFindingConflict("Identitas operasi sudah dipakai untuk permintaan berbeda.");
    return { replayed: previous };
  }

  async function operationResult(tx: Executor, institutionId: string, operation: AuditOperation): Promise<string | null> {
    const row = rowsOf(await tx.execute(sql`
      SELECT request_hash, finding_id FROM audit_finding_operations
      WHERE institution_id = ${institutionId} AND account = ${operation.account} AND operation_id = ${operation.id}
    `))[0];
    if (!row) return null;
    if (row.request_hash !== operation.requestHash || !row.finding_id) {
      throw new AuditFindingConflict("Identitas operasi sudah dipakai untuk permintaan berbeda.");
    }
    return row.finding_id;
  }

  const settle = (tx: Executor, institutionId: string, operation: AuditOperation, findingId: string) =>
    tx.execute(sql`
      UPDATE audit_finding_operations SET finding_id = ${findingId}
      WHERE institution_id = ${institutionId} AND account = ${operation.account} AND operation_id = ${operation.id}
    `);

  async function readOne(tx: Executor, institutionId: string, findingId: string, lock: boolean) {
    const row = rowsOf(await tx.execute(lock
      ? sql`SELECT * FROM audit_findings WHERE id = ${findingId} AND institution_id = ${institutionId} FOR UPDATE`
      : sql`SELECT * FROM audit_findings WHERE id = ${findingId} AND institution_id = ${institutionId}`))[0];
    return row ? (await readMany(tx, institutionId, [headFrom(row)]))[0]! : null;
  }

  return {
    async ensureSchema(): Promise<void> {
      for (const statement of AUDIT_FINDING_SCHEMA_STATEMENTS) await db.execute(sql.raw(statement));
    },

    /** The finding an earlier attempt of this operation produced, or `null` if it never ran. */
    previousOperation: (institutionId: string, operation: AuditOperation) => operationResult(db, institutionId, operation),

    async create(institutionId: string, operation: AuditOperation, head: AuditFindingHead, event: NewAuditEvent, files: NewAuditFile[]) {
      return db.transaction(async (tx) => {
        const { replayed } = await claim(tx, institutionId, operation);
        if (replayed) return replayed;
        await tx.execute(sql`
          INSERT INTO audit_findings (
            id, institution_id, preparation_id, package_id, package_digest, report_id, report_version, created_by,
            scope, severity, title, description, target_proposal_id, target_proposal_version,
            target_realization_id, target_document_id, target_dispute_id, created_at
          ) VALUES (
            ${head.id}, ${institutionId}, ${head.preparationId}, ${head.packageId}, ${head.packageDigest},
            ${head.reportId}, ${head.reportVersion}, ${head.createdBy}, ${head.scope}, ${head.severity},
            ${head.title}, ${head.description}, ${head.targetProposalId}, ${head.targetProposalVersion},
            ${head.targetRealizationId}, ${head.targetDocumentId}, ${head.targetDisputeId}, ${head.createdAt}
          )
        `);
        await insertEvent(tx, institutionId, 1, event, files);
        await settle(tx, institutionId, operation, head.id);
        return head.id;
      });
    },

    /**
     * Appends one event under a lock on the finding. `decide` sees the finding as
     * it is inside the lock and returns the event, or throws to refuse; nothing it
     * saw can change before the event is written.
     */
    async append(
      institutionId: string,
      findingId: string,
      operation: AuditOperation,
      expectedRevision: number,
      decide: (current: StoredAuditFinding) => { event: NewAuditEvent; files: NewAuditFile[] },
    ) {
      return db.transaction(async (tx) => {
        const { replayed } = await claim(tx, institutionId, operation);
        if (replayed) return replayed;
        const current = await readOne(tx, institutionId, findingId, true);
        if (!current) return null;
        const revision = current.events.length;
        if (revision !== expectedRevision) {
          throw new AuditFindingConflict("Temuan telah berubah sejak terakhir dibaca. Muat ulang riwayatnya sebelum bertindak.");
        }
        const { event, files } = decide(current);
        await insertEvent(tx, institutionId, revision + 1, event, files);
        await settle(tx, institutionId, operation, findingId);
        return findingId;
      });
    },

    read: (institutionId: string, findingId: string) => readOne(db, institutionId, findingId, false),

    async listByPackage(institutionId: string, preparationId: string, packageId: string) {
      const heads = rowsOf(await db.execute(sql`
        SELECT * FROM audit_findings
        WHERE institution_id = ${institutionId} AND preparation_id = ${preparationId} AND package_id = ${packageId}
        ORDER BY created_at DESC, id DESC
      `)).map(headFrom);
      return readMany(db, institutionId, heads);
    },

    async listAll(institutionId: string) {
      const heads = rowsOf(await db.execute(sql`
        SELECT * FROM audit_findings WHERE institution_id = ${institutionId} ORDER BY created_at DESC, id DESC
      `)).map(headFrom);
      return readMany(db, institutionId, heads);
    },

    /** Frozen versions that name `packageId` as the version they correct. */
    async correctionsOf(institutionId: string, packageId: string) {
      const rows = rowsOf(await db.execute(sql`
        SELECT id, preparation_id, canonical FROM report_packages
        WHERE institution_id = ${institutionId} AND (canonical::jsonb ->> 'predecessor') = ${packageId}
      `));
      return rows
        .map(row => ({ row, body: JSON.parse(row.canonical) }))
        .filter(({ body }) => body.status === "FROZEN")
        .map(({ row, body }) => ({
          packageId: row.id as string,
          preparationId: row.preparation_id as string,
          reportVersion: String(body.version),
          status: String(body.status),
        }));
    },

    /** Does each referenced operational record exist in this institution? Returns the missing ones. */
    async missingTargets(institutionId: string, targets: AuditFindingTargets): Promise<string[]> {
      const missing: string[] = [];
      const exists = async (query: SQL) => rowsOf(await db.execute(query)).length > 0;
      if (targets.proposalId && !(await exists(targets.proposalVersion == null
        ? sql`SELECT 1 FROM proposal_drafts WHERE id = ${targets.proposalId} AND institution_id = ${institutionId}`
        : sql`SELECT 1 FROM proposal_versions WHERE proposal_id = ${targets.proposalId}
                AND version = ${targets.proposalVersion} AND institution_id = ${institutionId}`))) {
        missing.push("pengajuan");
      }
      if (targets.realizationId && !(await exists(targets.proposalId
        ? sql`SELECT 1 FROM disbursement_realizations WHERE id = ${targets.realizationId}
                AND institution_id = ${institutionId} AND proposal_id = ${targets.proposalId}`
        : sql`SELECT 1 FROM disbursement_realizations WHERE id = ${targets.realizationId} AND institution_id = ${institutionId}`))) {
        missing.push("realisasi");
      }
      if (targets.documentId && !(await exists(sql`
        SELECT 1 FROM proposal_documents WHERE id = ${targets.documentId} AND institution_id = ${institutionId}
        UNION ALL
        SELECT 1 FROM disbursement_realization_documents WHERE id = ${targets.documentId} AND institution_id = ${institutionId}
      `))) {
        missing.push("dokumen");
      }
      if (targets.disputeId && !(await exists(targets.realizationId
        ? sql`SELECT 1 FROM disbursement_realization_disputes WHERE id = ${targets.disputeId}
                AND institution_id = ${institutionId} AND realization_id = ${targets.realizationId}`
        : sql`SELECT 1 FROM disbursement_realization_disputes WHERE id = ${targets.disputeId} AND institution_id = ${institutionId}`))) {
        missing.push("sengketa penerimaan");
      }
      return missing;
    },
  };
}

export type AuditFindingStore = ReturnType<typeof createAuditFindingStore>;

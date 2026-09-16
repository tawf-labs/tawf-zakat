/** Durable institution-scoped programs and versioned proposal drafts.
 * Save/delete and their retry result commit together. A retry returns the original
 * result, even after later edits; a new operation must use the current version.
 */

import { sql } from "drizzle-orm";
import type {
  AidLine,
  Beneficiary,
  FundType,
  ProgramRecord,
  ProgramStatus,
  ProposalIssue,
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

export type DraftOperation = { id: string; account: string; requestHash: string };
export type ProposalContributor = { account: string; officerId: string | null; version: number };

type DraftGuard = (draft: StoredProposalDraft) => void;
const materialContents = (draft: Omit<StoredProposalDraft, "version">) => JSON.stringify([
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
  createdAt: asSeconds(row.created_at),
  updatedAt: asSeconds(row.updated_at),
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
      draft: Omit<StoredProposalDraft, "version" | "updatedAt"> & { updatedAt: number },
      expectedVersion: number,
      operation: DraftOperation,
      authorizeExisting: DraftGuard
    ): Promise<StoredProposalDraft> {
      return mutateOnce(db, draft.institutionId, operation, async tx => {
        const current = rowsOf(await tx.execute(sql`
          SELECT * FROM proposal_drafts WHERE id = ${draft.id} AND institution_id = ${draft.institutionId} FOR UPDATE
        `))[0];
        if (current) authorizeExisting(draftFrom(current));
        const written = rowsOf(await tx.execute(expectedVersion === 0 ? sql`
          INSERT INTO proposal_drafts (
            id, institution_id, program_id, created_by, origin_of_request, purpose,
            aid_period_json, person_in_charge, beneficiaries_json, aid_lines_json,
            issues_json, version, created_at, updated_at
          ) VALUES (
            ${draft.id}, ${draft.institutionId}, ${draft.programId}, ${draft.createdBy},
            ${draft.originOfRequest}, ${draft.purpose}, ${draft.aidPeriod ? JSON.stringify(draft.aidPeriod) : null},
            ${draft.personInCharge}, ${JSON.stringify(draft.beneficiaries)}, ${JSON.stringify(draft.aidLines)},
            ${JSON.stringify(draft.issues)}, 1, ${draft.createdAt}, ${draft.updatedAt}
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
              SELECT id, program_id, origin_of_request, purpose, beneficiaries_json, issues_json, version, updated_at
              FROM proposal_drafts WHERE institution_id = ${institutionId} AND program_id = ${programId}
              ORDER BY updated_at DESC, id DESC
            `)
          : await db.execute(sql`
              SELECT id, program_id, origin_of_request, purpose, beneficiaries_json, issues_json, version, updated_at
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
        await tx.execute(sql`DELETE FROM proposal_drafts WHERE id = ${id} AND institution_id = ${institutionId} AND version = ${expectedVersion}`);
        return true;
      });
    },
  };
}

export type DisbursementStore = ReturnType<typeof createDisbursementStore>;

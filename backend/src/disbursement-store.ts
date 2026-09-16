/**
 * Where Program bantuan and Pengajuan drafts are kept (Spec #86, ticket #89).
 *
 * Follows `evidence-store.ts`'s draft pattern deliberately, not by accident:
 *
 * - Every row belongs to an institution that exists, scoped by `institution_id`
 *   in the query itself, so a caller who swaps an id in a URL finds nothing.
 * - A program is written durably the moment it is created - it is never a
 *   draft, and archiving it never deletes it, so its history stays readable.
 * - A proposal draft saves with optimistic concurrency: `ON CONFLICT ... DO
 *   UPDATE ... version = version + 1 WHERE institution_id = EXCLUDED.institution_id
 *   RETURNING *`. Zero rows back means either a stale `version` lost the race,
 *   or the id already belongs to another institution - both are conflicts, and
 *   neither is silently overwritten. This is a deliberate difference from
 *   `evidence-store.ts`'s `saveDraft`, which guards only the cross-institution
 *   case and always accepts a save regardless of the version it was read at
 *   (last-write-wins): a Pengajuan draft's mutations must "membawa versi yang
 *   diharapkan" (spec #86), so this store also checks `expectedVersion`.
 *
 * Schema is additive: its own tables, `IF NOT EXISTS`, no `ALTER` against
 * anything that already exists.
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

/** The dev migration. Every statement is `IF NOT EXISTS`; running it twice is a no-op. */
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
      expectedVersion: number | null
    ): Promise<StoredProposalDraft> {
      const written = rowsOf(
        await db.execute(sql`
          INSERT INTO proposal_drafts (
            id, institution_id, program_id, created_by, origin_of_request, purpose,
            aid_period_json, person_in_charge, beneficiaries_json, aid_lines_json,
            issues_json, version, created_at, updated_at
          ) VALUES (
            ${draft.id}, ${draft.institutionId}, ${draft.programId}, ${draft.createdBy},
            ${draft.originOfRequest}, ${draft.purpose}, ${draft.aidPeriod ? JSON.stringify(draft.aidPeriod) : null},
            ${draft.personInCharge}, ${JSON.stringify(draft.beneficiaries)}, ${JSON.stringify(draft.aidLines)},
            ${JSON.stringify(draft.issues)}, 1, ${draft.createdAt}, ${draft.updatedAt}
          )
          ON CONFLICT (id) DO UPDATE SET
            program_id = EXCLUDED.program_id,
            origin_of_request = EXCLUDED.origin_of_request,
            purpose = EXCLUDED.purpose,
            aid_period_json = EXCLUDED.aid_period_json,
            person_in_charge = EXCLUDED.person_in_charge,
            beneficiaries_json = EXCLUDED.beneficiaries_json,
            aid_lines_json = EXCLUDED.aid_lines_json,
            issues_json = EXCLUDED.issues_json,
            version = proposal_drafts.version + 1,
            updated_at = EXCLUDED.updated_at
          WHERE proposal_drafts.institution_id = EXCLUDED.institution_id
            AND (${expectedVersion}::int IS NULL OR proposal_drafts.version = ${expectedVersion}::int)
          RETURNING *
        `)
      );
      if (written.length === 0) throw new ProposalDraftConflictError(draft.id);
      return draftFrom(written[0]);
    },

    async getProposalDraft(institutionId: string, id: string): Promise<StoredProposalDraft | null> {
      const row = rowsOf(
        await db.execute(sql`SELECT * FROM proposal_drafts WHERE id = ${id} AND institution_id = ${institutionId}`)
      )[0];
      return row ? draftFrom(row) : null;
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

    async deleteProposalDraft(institutionId: string, id: string): Promise<boolean> {
      const written = rowsOf(
        await db.execute(
          sql`DELETE FROM proposal_drafts WHERE id = ${id} AND institution_id = ${institutionId} RETURNING id`
        )
      );
      return written.length > 0;
    },
  };
}

export type DisbursementStore = ReturnType<typeof createDisbursementStore>;

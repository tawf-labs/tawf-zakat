/**
 * Where a frozen preparation is kept (Spec #68, ticket #70).
 *
 * One preparation is one identity, and everything that belongs to it - the
 * manifests, the normalized rows, the reconciliation result, the findings, the
 * file references - is written under that identity in a single transaction and
 * read back in a single transaction. Half a preparation is not a smaller
 * preparation; it is a report whose figures no longer match the source they
 * were computed from, which is the exact failure this ticket exists to remove.
 *
 * Three properties the database enforces, rather than a caller remembering to:
 *
 * - A preparation belongs to an institution that exists, and every side,
 *   finding and file belongs to a preparation that exists.
 * - Every read is scoped by `institution_id` in the SQL itself. Swapping an id
 *   in a URL therefore finds nothing, rather than finding something a route
 *   then has to remember to hide.
 * - A preparation id is a primary key, never a query against live data. Reading
 *   one twice returns the same rows however much the working ledger has moved
 *   underneath it.
 *
 * The schema is additive - its own tables, `IF NOT EXISTS`, no `ALTER` against
 * anything that already exists - and written against Drizzle's driver-agnostic
 * `execute`, so it runs on the deployed PostgreSQL and on the PGlite database
 * the tests isolate.
 */

import { sql } from "drizzle-orm";
import type { DiscrepancyKind } from "./reconciliation";
import type { PublicSummary } from "./evidence-snapshot";
import type { SourceManifest, NormalizedRow } from "./evidence-source";

/** Any Drizzle PostgreSQL handle that can also open a transaction. */
export type EvidenceDatabase = {
  execute: (query: any) => Promise<any>;
  transaction: <T>(run: (tx: { execute: (query: any) => Promise<any> }) => Promise<T>) => Promise<T>;
};

export type StoredSide = {
  role: "CLAIM" | "SOURCE";
  status: "READ" | "MISSING" | "FAILED";
  detail: string | null;
  manifest: SourceManifest;
  rows: NormalizedRow[];
  rowCount: number;
};

export type StoredFinding = {
  ordinal: number;
  kind: DiscrepancyKind;
  key: string;
  bucket: string;
  deltaAmount: string;
  deltaUnit: string;
  claimAmount: string | null;
  sourceAmount: string | null;
  label: string | null;
};

export type StoredFile = {
  id: string;
  role: "CLAIM" | "SOURCE";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string | null;
  storageStatus: "STORED" | "FAILED";
  /** The private locator. Kept here, never put in a response. */
  storageRef: string | null;
  failureReason: string | null;
};

export type PreparationRecord = {
  id: string;
  institutionId: string;
  preparedBy: string;
  label: string;
  periodKind: string;
  periodYear: number;
  currencyUnit: string;
  outcome: "RECONCILED" | "INCOMPLETE";
  commitment: string;
  commitmentScheme: string;
  commitmentSalt: string;
  /** The canonical bytes, as text. The record of what was examined. */
  canonicalSnapshot: string;
  /** The serialized reconciliation report, or `null` when no result was possible. */
  resultJson: string | null;
  publicSummary: PublicSummary;
  createdAt: number;
  sides: StoredSide[];
  findings: StoredFinding[];
  files: StoredFile[];
};

export type PreparationSummary = {
  id: string;
  label: string;
  periodKind: string;
  periodYear: number;
  currencyUnit: string;
  outcome: "RECONCILED" | "INCOMPLETE";
  commitment: string;
  createdAt: number;
  findingCount: number;
};

export type StoredPreparation = PreparationRecord;

/**
 * The dev migration, as one ordered list. Every statement is `IF NOT EXISTS`,
 * so running it twice is a no-op and it alters no table that already exists.
 */
export const EVIDENCE_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS evidence_preparations (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     prepared_by TEXT NOT NULL,
     label TEXT NOT NULL,
     period_kind TEXT NOT NULL,
     period_year INTEGER NOT NULL,
     currency_unit TEXT NOT NULL,
     outcome TEXT NOT NULL,
     commitment TEXT NOT NULL,
     commitment_scheme TEXT NOT NULL,
     commitment_salt TEXT NOT NULL,
     canonical_snapshot TEXT NOT NULL,
     result_json TEXT,
     public_summary_json TEXT NOT NULL,
     created_at BIGINT NOT NULL,
     CONSTRAINT evidence_preparations_outcome_known
       CHECK (outcome IN ('RECONCILED', 'INCOMPLETE')),
     CONSTRAINT evidence_preparations_unit_known
       CHECK (currency_unit IN ('IDR', 'USDC_6DP'))
   );`,
  `CREATE INDEX IF NOT EXISTS evidence_preparations_by_institution
     ON evidence_preparations (institution_id, created_at DESC);`,
  `CREATE TABLE IF NOT EXISTS evidence_sources (
     preparation_id TEXT NOT NULL REFERENCES evidence_preparations (id) ON DELETE CASCADE,
     role TEXT NOT NULL,
     status TEXT NOT NULL,
     detail TEXT,
     manifest_json TEXT NOT NULL,
     rows_json TEXT NOT NULL,
     row_count INTEGER NOT NULL,
     PRIMARY KEY (preparation_id, role),
     CONSTRAINT evidence_sources_role_known CHECK (role IN ('CLAIM', 'SOURCE')),
     CONSTRAINT evidence_sources_status_known CHECK (status IN ('READ', 'MISSING', 'FAILED')),
     -- A source that was not read holds no rows. The database refuses the
     -- combination outright, so a failed read can never arrive holding data.
     CONSTRAINT evidence_sources_unread_has_no_rows
       CHECK (status = 'READ' OR row_count = 0)
   );`,
  `CREATE TABLE IF NOT EXISTS evidence_findings (
     preparation_id TEXT NOT NULL REFERENCES evidence_preparations (id) ON DELETE CASCADE,
     ordinal INTEGER NOT NULL,
     kind TEXT NOT NULL,
     entry_key TEXT NOT NULL,
     bucket TEXT NOT NULL,
     delta_amount TEXT NOT NULL,
     delta_unit TEXT NOT NULL,
     claim_amount TEXT,
     source_amount TEXT,
     label TEXT,
     PRIMARY KEY (preparation_id, ordinal)
   );`,
  `CREATE TABLE IF NOT EXISTS evidence_files (
     id TEXT PRIMARY KEY,
     preparation_id TEXT NOT NULL REFERENCES evidence_preparations (id) ON DELETE CASCADE,
     institution_id TEXT NOT NULL,
     role TEXT NOT NULL,
     file_name TEXT NOT NULL,
     mime_type TEXT NOT NULL,
     size_bytes INTEGER NOT NULL,
     content_sha256 TEXT,
     storage_status TEXT NOT NULL,
     storage_ref TEXT,
     failure_reason TEXT,
     CONSTRAINT evidence_files_status_known CHECK (storage_status IN ('STORED', 'FAILED')),
     -- A stored file has somewhere it is stored and a digest of what it holds;
     -- a failed one has a reason and neither. No row can claim both or neither.
     CONSTRAINT evidence_files_stored_is_locatable
       CHECK ((storage_status = 'STORED') = (storage_ref IS NOT NULL AND content_sha256 IS NOT NULL)),
     CONSTRAINT evidence_files_failed_says_why
       CHECK ((storage_status = 'FAILED') = (failure_reason IS NOT NULL))
   );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS evidence_preparations_owner_id ON evidence_preparations (institution_id, id);`,
  `CREATE TABLE IF NOT EXISTS report_packages (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL,
    preparation_id TEXT NOT NULL,
    canonical TEXT NOT NULL,
    digest TEXT NOT NULL,
    FOREIGN KEY (institution_id, preparation_id) REFERENCES evidence_preparations (institution_id, id)
  );`,
] as const;

const rowsOf = (result: any): any[] =>
  Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];

const asSeconds = (value: unknown): number => Number(value);

const sideFrom = (row: any): StoredSide => ({
  role: row.role,
  status: row.status,
  detail: row.detail ?? null,
  manifest: JSON.parse(row.manifest_json) as SourceManifest,
  rows: JSON.parse(row.rows_json) as NormalizedRow[],
  rowCount: Number(row.row_count),
});

const findingFrom = (row: any): StoredFinding => ({
  ordinal: Number(row.ordinal),
  kind: row.kind,
  key: row.entry_key,
  bucket: row.bucket,
  deltaAmount: row.delta_amount,
  deltaUnit: row.delta_unit,
  claimAmount: row.claim_amount ?? null,
  sourceAmount: row.source_amount ?? null,
  label: row.label ?? null,
});

const fileFrom = (row: any): StoredFile => ({
  id: row.id,
  role: row.role,
  fileName: row.file_name,
  mimeType: row.mime_type,
  sizeBytes: Number(row.size_bytes),
  contentSha256: row.content_sha256 ?? null,
  storageStatus: row.storage_status,
  storageRef: row.storage_ref ?? null,
  failureReason: row.failure_reason ?? null,
});

export function createEvidenceStore(db: EvidenceDatabase) {
  return {
    async saveReportPackage(institutionId: string, preparationId: string, id: string, canonical: string, digest: string) {
      await db.execute(sql`INSERT INTO report_packages (id, institution_id, preparation_id, canonical, digest)
        VALUES (${id}, ${institutionId}, ${preparationId}, ${canonical}, ${digest}) ON CONFLICT (id) DO NOTHING`);
    },
    async getReportPackage(institutionId: string, preparationId: string, id: string): Promise<{canonical: string; digest: string} | null> {
      return rowsOf(await db.execute(sql`SELECT canonical, digest FROM report_packages
        WHERE institution_id = ${institutionId} AND preparation_id = ${preparationId} AND id = ${id}`))[0] ?? null;
    },
    async findReportPackage(institutionId: string, id: string): Promise<{canonical: string} | null> {
      return rowsOf(await db.execute(sql`SELECT canonical FROM report_packages WHERE institution_id = ${institutionId} AND id = ${id}`))[0] ?? null;
    },
    async listReportPackages(institutionId: string, preparationId: string): Promise<{id: string; digest: string}[]> {
      return rowsOf(await db.execute(sql`SELECT id, digest FROM report_packages
        WHERE institution_id = ${institutionId} AND preparation_id = ${preparationId} ORDER BY id`));
    },
    async ensureSchema(): Promise<void> {
      for (const statement of EVIDENCE_SCHEMA_STATEMENTS) {
        await db.execute(sql.raw(statement));
      }
    },

    /**
     * Writes the whole preparation, or none of it.
     *
     * The snapshot, the result computed from it and the findings it produced
     * only mean anything together: a snapshot with no result is unexamined
     * evidence, and a result with no snapshot is a number with no source.
     */
    async savePreparation(record: PreparationRecord): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO evidence_preparations (
            id, institution_id, prepared_by, label, period_kind, period_year, currency_unit,
            outcome, commitment, commitment_scheme, commitment_salt, canonical_snapshot,
            result_json, public_summary_json, created_at
          ) VALUES (
            ${record.id}, ${record.institutionId}, ${record.preparedBy}, ${record.label},
            ${record.periodKind}, ${record.periodYear}, ${record.currencyUnit},
            ${record.outcome}, ${record.commitment}, ${record.commitmentScheme},
            ${record.commitmentSalt}, ${record.canonicalSnapshot}, ${record.resultJson},
            ${JSON.stringify(record.publicSummary)}, ${record.createdAt}
          )
        `);

        for (const side of record.sides) {
          await tx.execute(sql`
            INSERT INTO evidence_sources (
              preparation_id, role, status, detail, manifest_json, rows_json, row_count
            ) VALUES (
              ${record.id}, ${side.role}, ${side.status}, ${side.detail},
              ${JSON.stringify(side.manifest)}, ${JSON.stringify(side.rows)}, ${side.rowCount}
            )
          `);
        }

        for (const finding of record.findings) {
          await tx.execute(sql`
            INSERT INTO evidence_findings (
              preparation_id, ordinal, kind, entry_key, bucket,
              delta_amount, delta_unit, claim_amount, source_amount, label
            ) VALUES (
              ${record.id}, ${finding.ordinal}, ${finding.kind}, ${finding.key}, ${finding.bucket},
              ${finding.deltaAmount}, ${finding.deltaUnit}, ${finding.claimAmount},
              ${finding.sourceAmount}, ${finding.label}
            )
          `);
        }

        for (const file of record.files) {
          await tx.execute(sql`
            INSERT INTO evidence_files (
              id, preparation_id, institution_id, role, file_name, mime_type, size_bytes,
              content_sha256, storage_status, storage_ref, failure_reason
            ) VALUES (
              ${file.id}, ${record.id}, ${record.institutionId}, ${file.role}, ${file.fileName},
              ${file.mimeType}, ${file.sizeBytes}, ${file.contentSha256}, ${file.storageStatus},
              ${file.storageRef}, ${file.failureReason}
            )
          `);
        }
      });
    },

    async listPreparations(institutionId: string): Promise<PreparationSummary[]> {
      const rows = rowsOf(
        await db.execute(sql`
          SELECT p.id, p.label, p.period_kind, p.period_year, p.currency_unit, p.outcome,
                 p.commitment, p.created_at,
                 (SELECT COUNT(*) FROM evidence_findings f WHERE f.preparation_id = p.id) AS finding_count
          FROM evidence_preparations p
          WHERE p.institution_id = ${institutionId}
          ORDER BY p.created_at DESC, p.id DESC
        `)
      );
      return rows.map((row) => ({
        id: row.id,
        label: row.label,
        periodKind: row.period_kind,
        periodYear: Number(row.period_year),
        currencyUnit: row.currency_unit,
        outcome: row.outcome,
        commitment: row.commitment,
        createdAt: asSeconds(row.created_at),
        findingCount: Number(row.finding_count),
      }));
    },

    /**
     * The whole preparation, read inside one transaction.
     *
     * Reading the four tables separately would let a concurrent write land
     * between them and produce a package whose result belongs to a different
     * snapshot than its rows - a report that never existed at any moment.
     */
    async getPreparation(institutionId: string, id: string): Promise<StoredPreparation | null> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
        const head = rowsOf(
          await tx.execute(sql`
            SELECT * FROM evidence_preparations
            WHERE id = ${id} AND institution_id = ${institutionId}
          `)
        )[0];
        if (!head) return null;

        const [sides, findings, files] = [
          rowsOf(
            await tx.execute(
              sql`SELECT * FROM evidence_sources WHERE preparation_id = ${id} ORDER BY role ASC`
            )
          ),
          rowsOf(
            await tx.execute(
              sql`SELECT * FROM evidence_findings WHERE preparation_id = ${id} ORDER BY ordinal ASC`
            )
          ),
          rowsOf(
            await tx.execute(
              sql`SELECT * FROM evidence_files WHERE preparation_id = ${id} ORDER BY id ASC`
            )
          ),
        ];

        return {
          id: head.id,
          institutionId: head.institution_id,
          preparedBy: head.prepared_by,
          label: head.label,
          periodKind: head.period_kind,
          periodYear: Number(head.period_year),
          currencyUnit: head.currency_unit,
          outcome: head.outcome,
          commitment: head.commitment,
          commitmentScheme: head.commitment_scheme,
          commitmentSalt: head.commitment_salt,
          canonicalSnapshot: head.canonical_snapshot,
          resultJson: head.result_json ?? null,
          publicSummary: JSON.parse(head.public_summary_json) as PublicSummary,
          createdAt: asSeconds(head.created_at),
          sides: sides.map(sideFrom),
          findings: findings.map(findingFrom),
          files: files.map(fileFrom),
        };
      });
    },

    /** The public part, by id alone. Nothing restricted is read on this path. */
    async getPublicSummary(id: string): Promise<PublicSummary | null> {
      const row = rowsOf(
        await db.execute(sql`SELECT public_summary_json FROM evidence_preparations WHERE id = ${id}`)
      )[0];
      return row ? (JSON.parse(row.public_summary_json) as PublicSummary) : null;
    },

    /**
     * One file, scoped to its institution in the query itself.
     *
     * The institution is part of the `WHERE`, not a check a handler performs
     * afterwards, so a caller who substitutes an id finds no row at all.
     */
    async getFile(
      institutionId: string,
      preparationId: string,
      fileId: string
    ): Promise<StoredFile | null> {
      const row = rowsOf(
        await db.execute(sql`
          SELECT * FROM evidence_files
          WHERE id = ${fileId} AND preparation_id = ${preparationId}
            AND institution_id = ${institutionId}
        `)
      )[0];
      return row ? fileFrom(row) : null;
    },
  };
}

export type EvidenceStore = ReturnType<typeof createEvidenceStore>;

/**
 * An isolated PostgreSQL for tests (Spec #68, ticket #69).
 *
 * PGlite is a real PostgreSQL compiled to WebAssembly, so foreign keys, partial
 * unique indexes and `UPDATE ... RETURNING` behave the way the deployed database
 * behaves. An in-memory map would let every one of those constraints pass by
 * being absent, which is exactly the claim these tests exist to make.
 *
 * By default, each call gets its own data directory under the OS temp dir, so tests cannot
 * see each other's rows, and `reopen()` genuinely closes the database and opens
 * the same directory again - the only honest way to test durability.
 *
 * A minimal legacy `donations` table is seeded first, standing in for the tables
 * a real deployment already holds, so the workspace schema can be shown to be
 * additive rather than merely asserted to be.
 */

// An explicit connection string uses a unique temporary PostgreSQL schema.
// Reopening that mode reconnects the client; it does not restart the server.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { drizzle as postgresDrizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type WorkspaceDatabase = ReturnType<typeof drizzle> | ReturnType<typeof postgresDrizzle>;

const LEGACY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS donations (
    id SERIAL PRIMARY KEY,
    trx_id TEXT NOT NULL UNIQUE,
    donor_name TEXT NOT NULL,
    amount_idr BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING'
  );
`;

/** The tables these tickets add, newest first, for truncation between tests. */
const WORKSPACE_TABLES = [
  "disbursement_realization_operations",
  "disbursement_realization_expenses",
  "disbursement_realization_advances",
  "disbursement_realization_dispute_examinations",
  "disbursement_realization_disputes",
  "disbursement_realization_bast_examinations",
  "disbursement_realization_challenges",
  "disbursement_realization_document_allocations",
  "disbursement_realization_documents",
  "disbursement_realizations",
  "proposal_decision_challenges",
  "proposal_decisions",
  "proposal_decision_documents",
  "allocation_history",
  "contribution_allocations",
  "activity_operations",
  "distribution_activities",
  "contribution_documents",
  "contribution_history",
  "contribution_operations",
  "contribution_import_drafts",
  "contributions",
  "proposal_draft_contributors",
  "operational_mandates",
  "institutional_endorsement_accounts",
  "proposal_beneficiary_list_previews",
  "proposal_preview_file_cleanup",
  "proposal_draft_operations",
  "proposal_drafts",
  "programs",
  "report_audit_finding_attachments",
  "report_audit_finding_events",
  "report_audit_findings",
  "evidence_files",
  "evidence_findings",
  "evidence_sources",
  "evidence_preparations",
  "workspace_sessions",
  "workspace_challenges",
  "institution_memberships",
  "institutions",
] as const;

export type TestWorkspaceDatabase = {
  /** The live handle. Re-read it after `reopen()`; the old one is closed. */
  handle: () => WorkspaceDatabase;
  /** Empties only this ticket's tables, leaving the legacy rows alone. */
  reset: () => Promise<void>;
  /** Closes the database and opens the same directory again. */
  reopen: () => Promise<WorkspaceDatabase>;
  close: () => Promise<void>;
  /** Introspection, so the migration can be shown to leave old tables alone. */
  columnsOf: (table: string) => Promise<string[]>;
  rowCount: (table: string) => Promise<number>;
  /**
   * Rewrites a stored challenge's purpose, standing in for a row some other
   * flow wrote. There is no application path that does this, which is why it
   * belongs here rather than on the production store.
   */
  setChallengePurpose: (nonce: string, purpose: string) => Promise<void>;
};

/**
 * Booting PostgreSQL costs about a second, so one database is opened per test
 * file and its tables are truncated between tests. Isolation is unaffected: a
 * truncated table is as empty as a fresh one, and the file's directory is still
 * its own.
 */
export async function createTestWorkspaceDatabase(connectionString?: string): Promise<TestWorkspaceDatabase> {
  const directory = await mkdtemp(join(tmpdir(), "tawf-workspace-"));
  // A unique schema keeps smoke fixtures and truncation away from existing data.
  const schema = connectionString ? `smoke_${crypto.randomUUID().replaceAll("-", "")}` : "public";
  const admin = connectionString ? postgres(connectionString, { max: 1, onnotice: () => {} }) : undefined;
  if (admin) await admin.unsafe(`CREATE SCHEMA ${schema}`);
  function open() {
    if (connectionString) {
      const client = postgres(connectionString, { max: 5, connection: { search_path: schema }, onnotice: () => {} });
      return { db: postgresDrizzle(client), close: () => client.end() };
    }
    const client = new PGlite(directory);
    return { db: drizzle(client), close: () => client.close() };
  }
  let connection = open();
  let db: WorkspaceDatabase = connection.db;

  await db.execute(sql.raw(LEGACY_SCHEMA));
  await db.execute(
    sql`INSERT INTO donations (trx_id, donor_name, amount_idr, status) VALUES ('LEGACY-NO-OWNER', 'Donatur lama', 250000, 'PAID')`
  );

  return {
    handle: () => db,

    async reset() {
      for (const table of WORKSPACE_TABLES) {
        // A test file that only installs the tenancy schema has no evidence
        // tables; skipping those is right, inventing them here would not be.
        const exists: any = await db.execute(sql`SELECT to_regclass(${`${schema}.${table}`}) AS found`);
        if (!(exists.rows ?? exists)[0]?.found) continue;
        await db.execute(sql.raw(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`));
      }
    },

    async reopen() {
      await connection.close();
      connection = open();
      db = connection.db;
      return db;
    },

    async close() {
      await connection.close();
      if (admin) {
        await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      }
      await rm(directory, { recursive: true, force: true });
    },

    async columnsOf(table: string) {
      const result: any = await db.execute(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = ${schema} AND table_name = ${table} ORDER BY column_name ASC
      `);
      return (result.rows ?? result).map((row: any) => row.column_name as string);
    },

    async setChallengePurpose(nonce: string, purpose: string) {
      await db.execute(
        sql`UPDATE workspace_challenges SET purpose = ${purpose} WHERE nonce = ${nonce.toLowerCase()}`
      );
    },

    async rowCount(table: string) {
      if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`Nama tabel tidak sah: ${table}`);
      const result: any = await db.execute(sql`SELECT COUNT(*)::int AS total FROM ${sql.identifier(table)}`);
      return Number((result.rows ?? result)[0]?.total ?? 0);
    },
  };
}

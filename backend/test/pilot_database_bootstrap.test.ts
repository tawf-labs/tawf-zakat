import { describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { EvidenceDatabase } from "../src/evidence-store";
import { bootstrapPilotDatabase, pilotPlan, validatePilotTarget } from "../src/scripts/pilot-database-bootstrap";
import { createWorkspaceStore } from "../src/tenancy-store";
import * as schema from "../src/db/schema";

const target = { host: "127.0.0.1", port: 5432, database: "tawf_demo_20260921", username: "tawf_demo_app" };
const rows = (result: any): any[] => result.rows ?? result;
const dialect = new PgDialect();

// PGlite's fixed postgres database/superuser cannot be the deployment identity.
// Only that catalog response is substituted; ALL DDL, DML and rollback use SQL.
async function fixture(failAfterSeed = false, identityOverrides: Record<string, unknown> = {}) {
  const client = new PGlite();
  const db = drizzle(client);
  const adapter: EvidenceDatabase = {
    execute: (query) => db.execute(query),
    transaction: (run) => db.transaction(async (tx) => run({
      execute: async (query) => {
        const text = dialect.sqlToQuery(query).sql;
        if (text.includes("current_database()")) return [{ database: target.database, username: target.username, session_username: target.username, is_superuser: false, ...identityOverrides }];
        if (failAfterSeed && text.includes("SELECT count(*)::int AS count FROM institutions")) {
          return tx.execute(sql`SELECT 1 / 0`);
        }
        return tx.execute(query);
      },
    })),
  };
  return { client, db, adapter };
}

it("plans without any database and rejects every non-exact target", () => {
  expect(pilotPlan().mode).toBe("plan-only");
  expect(pilotPlan().counts).toEqual({ institutions: 1, officers: 2, memberships: 3, mandates: 9 });
  expect(() => validatePilotTarget(target)).not.toThrow();
  for (const bad of [{ host: "localhost" }, { host: "remote" }, { port: 5433 }, { database: "production" }, { username: "postgres" }]) {
    expect(() => validatePilotTarget({ ...target, ...bad })).toThrow("target");
  }
});

it("CLI defaults to a credential-free plan and fails closed with redacted output", () => {
  const script = new URL("../src/scripts/pilot-database-bootstrap.ts", import.meta.url).pathname;
  const run = (...args: string[]) => Bun.spawnSync([process.execPath, "--no-env-file", script, ...args], { env: {}, stdout: "pipe", stderr: "pipe" });
  const planned = run();
  expect(planned.exitCode).toBe(0);
  expect(JSON.parse(planned.stdout.toString()).mode).toBe("plan-only");
  for (const args of [["--apply"], ["--apply", "--database=other"], ["--unknown"]]) {
    const refused = run(...args);
    expect(refused.exitCode).toBe(1);
    expect(refused.stdout.toString()).toBe("");
    expect(refused.stderr.toString()).toContain("Driver details suppressed");
  }
});

it("refuses an invalid requested target before invoking the SQL boundary", async () => {
  let touched = false;
  const db: EvidenceDatabase = {
    execute: async () => { touched = true; throw new Error("must not execute"); },
    transaction: async () => { touched = true; throw new Error("must not connect"); },
  };
  await expect(bootstrapPilotDatabase(db, { ...target, database: "other" })).rejects.toThrow("target");
  expect(touched).toBe(false);
});

describe("isolated PGlite bootstrap", () => {
  it.each([{ database: "other" }, { username: "other" }, { session_username: "postgres" }, { is_superuser: true }, { is_superuser: null }])("fails closed for mismatched server identity or superuser %j", async (identity) => {
    const { client, db, adapter } = await fixture(false, identity);
    try {
      await expect(bootstrapPilotDatabase(adapter, target)).rejects.toThrow("identity");
      expect(rows(await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`))).toEqual([]);
    } finally { await client.close(); }
  });
  it("initializes compatible schemas and only synthetic separated authority", async () => {
    const { client, db, adapter } = await fixture();
    try {
      const result = await bootstrapPilotDatabase(adapter, target);
      expect(result.counts).toEqual(pilotPlan().counts);
      // Schema preparation must not grant a spending allowance or contain signed bytes.
      expect(rows(await db.execute(sql`SELECT * FROM registry_budget`))).toEqual([]);
      expect(rows(await db.execute(sql`SELECT * FROM registry_budget_reservations`))).toEqual([]);
      const workspace = createWorkspaceStore(db);
      const institution = await workspace.getInstitution("demo-tawf-20260921");
      expect(institution?.isSynthetic).toBe(true);
      const members = rows(await db.execute(sql`SELECT * FROM institution_memberships ORDER BY role`));
      expect(members.map(m => m.role)).toEqual(["ADMIN", "OFFICER", "READER"]);
      expect(members[0].officer_id).toBe("demo-tawf-20260921-operator");
      expect(members[1].officer_id).toBe("demo-tawf-20260921-approver");
      expect(members[2].officer_id).toBeNull();
      const mandates = await workspace.listMandates("demo-tawf-20260921");
      expect(mandates).toHaveLength(9);
      for (const mandate of mandates) {
        expect(mandate.scopeType).toBe("ALL_PROGRAMS");
        expect(mandate.nominalLimit).toBe("10000000");
        expect(mandate.validFrom).toBe(Date.parse("2026-09-21T00:00:00Z") / 1000);
        expect(mandate.validUntil).toBe(Date.parse("2026-09-24T00:00:00Z") / 1000);
        expect(mandate.function).not.toContain("RECOVERY");
        expect(mandate.officerId).not.toBe(members[2].officer_id);
      }
      expect(mandates.filter(m => m.officerId.endsWith("approver")).map(m => m.function).sort()).toEqual(["APPROVE_DECISIONS", "ENDORSE_CONTRIBUTIONS", "ISSUE_CERTIFICATES"]);
      // Drizzle's declared legacy columns must all be selectable, not just the
      // minimal donations fixture used by earlier workspace tests.
      for (const table of [schema.merkleBatches, schema.donations, schema.disbursementProposals, schema.indexerState, schema.onchainEvents, schema.roleMembers, schema.auditorProfiles]) {
        expect(await db.select().from(table)).toHaveLength(0);
      }
      for (const table of ["contributions", "distribution_activities", "workspace_sessions", "workspace_challenges", "institutional_endorsement_accounts", "registry_intents", "certificate_intents", "zk_publications"]) {
        expect(rows(await db.execute(sql`SELECT count(*)::int AS count FROM ${sql.identifier(table)}`))[0].count).toBe(0);
      }
      await expect(bootstrapPilotDatabase(adapter, target)).rejects.toThrow("not blank");
      expect(await workspace.listMandates("demo-tawf-20260921")).toHaveLength(9);
    } finally { await client.close(); }
  });

  it("refuses an unrelated existing table without touching it", async () => {
    const { client, db, adapter } = await fixture();
    try {
      await db.execute(sql`CREATE TABLE existing (value text)`);
      await db.execute(sql`INSERT INTO existing VALUES ('keep')`);
      await expect(bootstrapPilotDatabase(adapter, target)).rejects.toThrow("not blank");
      expect(rows(await db.execute(sql`SELECT * FROM existing`))).toEqual([{ value: "keep" }]);
      expect(rows(await db.execute(sql`SELECT to_regclass('institutions') AS found`))[0].found).toBeNull();
    } finally { await client.close(); }
  });

  it("rolls back schema AND seeded authority after an actual SQL failure", async () => {
    const { client, db, adapter } = await fixture(true);
    try {
      await expect(bootstrapPilotDatabase(adapter, target)).rejects.toThrow();
      expect(rows(await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`))).toEqual([]);
    } finally { await client.close(); }
  });

  it("rejects the real wrong database/superuser before creating anything", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    try {
      await expect(bootstrapPilotDatabase(db, target)).rejects.toThrow("identity");
      expect(rows(await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`))).toEqual([]);
    } finally { await client.close(); }
  });
});

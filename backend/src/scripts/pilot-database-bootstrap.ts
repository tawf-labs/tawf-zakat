/** LOCAL synthetic pilot preparation only. Default is a connection-free plan.
 * Apply requires a separately authorized blank, dedicated database. No server,
 * db/index, indexer, chain client, fixture signing keys, or authentic sessions.
 * Run: bun --no-env-file src/scripts/pilot-database-bootstrap.ts [--apply]
 * Apply reads only PILOT_DATABASE_PASSWORD; host/database/user are not configurable.
 */
import { sql } from "drizzle-orm";
import { createWorkspaceStore } from "../tenancy-store";
import { createEvidenceStore, type EvidenceDatabase } from "../evidence-store";
import { createDisbursementStore } from "../disbursement-store";
import { createContributionStore } from "../contribution-store";
import { createActivityStore } from "../activity-store";
import { createAuditFindingStore } from "../audit-finding-store";
import { createDonorAccessStore } from "../donor-access-store";
import { createZkBatchStore } from "../zk-batch-store";
import { createZkPublicationStore } from "../zk-publication-store";
import { createRegistryStore } from "../registry-store";
import { ensureRegistryBudgetSchema } from "../registry-budget";
import { createCertificateStore } from "../certificate-store";
import type { OperationalFunction } from "../operational-mandate";
import { PILOT_LEGACY_SCHEMA } from "./pilot-database-schema";

export type PilotTarget = { host: string; port: number; database: string; username: string };
const TARGET: Readonly<PilotTarget> = Object.freeze({ host: "127.0.0.1", port: 5432, database: "tawf_demo_20260921", username: "tawf_demo_app" });
const INSTITUTION = "demo-tawf-20260921";
const FROM = Date.parse("2026-09-21T00:00:00Z") / 1000;
const UNTIL = Date.parse("2026-09-24T00:00:00Z") / 1000;
// Integer rupiah, not wei or USDC. No unlimited nominal authority.
const LIMIT = "10000000";
const ACCOUNTS = [
  { account: "0x5e9B652C4E8a013f6fAb69F0b55377c408B59968".toLowerCase(), role: "ADMIN", officer: `${INSTITUTION}-operator`, name: "Operator sintetis", functions: ["MANAGE_PROGRAMS", "PREPARE_PROPOSALS", "EXAMINE_PROPOSALS", "RECORD_REALIZATION", "RECORD_CONTRIBUTIONS", "HANDLE_REPORT_EXAMINATION"] },
  { account: "0x6214e4E81a075c7CA6F4B5725eCd943D1C6b642C".toLowerCase(), role: "OFFICER", officer: `${INSTITUTION}-approver`, name: "Pemberi persetujuan sintetis", functions: ["APPROVE_DECISIONS", "ENDORSE_CONTRIBUTIONS", "ISSUE_CERTIFICATES"] },
  { account: "0xe8A4Ee352B95A4FC08667Df5d85c167006FE2A2f".toLowerCase(), role: "READER", officer: null, name: "Auditor pembaca sintetis", functions: [] },
] as const;
const WARNING = "SYNTHETIC / TESTNET ONLY: administrator address historically compromised; never real assets or personal data. Database authority is not chain authority.";
const rows = (result: any): any[] => result.rows ?? result;

export function validatePilotTarget(target: PilotTarget): void {
  if (target.host !== TARGET.host || target.port !== TARGET.port || target.database !== TARGET.database || target.username !== TARGET.username) {
    throw new Error("Pilot target refused.");
  }
}

export function pilotPlan() {
  return {
    mode: "plan-only" as const, target: { ...TARGET }, institution: INSTITUTION, synthetic: true,
    warning: WARNING,
    validity: { from: "2026-09-21T00:00:00Z", until: "2026-09-24T00:00:00Z", unit: "epoch seconds" },
    scope: "ALL_PROGRAMS", nominalLimitIDR: LIMIT,
    counts: { institutions: 1, officers: 2, memberships: 3, mandates: 9 },
    profiles: ACCOUNTS.map(a => ({ role: a.role, officerId: a.officer, functions: [...a.functions] })),
    noContributionsOrActivities: true, noSessionsOrSigningMaterial: true,
  };
}

/** Injected SQL boundary. The caller owns connection lifetime; no I/O outside db.
 * Domain methods' nested transaction callbacks deliberately JOIN this outer
 * transaction, not the root pool and not raw BEGIN/COMMIT. Any failure propagates
 * out, rolling back both schema and rows. No caught inner errors/savepoint claims.
 */
export async function bootstrapPilotDatabase(db: EvidenceDatabase, target: PilotTarget) {
  validatePilotTarget(target);
  return db.transaction(async (tx) => {
    const identity = rows(await tx.execute(sql`
      SELECT current_database() AS database, current_user AS username, session_user AS session_username,
        (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser
    `))[0];
    if (!identity || identity.database !== TARGET.database || identity.username !== TARGET.username ||
      identity.session_username !== TARGET.username || identity.is_superuser !== false) {
      throw new Error("Pilot database identity refused.");
    }
    await tx.execute(sql`SET LOCAL search_path TO public`);
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '60s'`);
    // Serialize this bootstrap; all existence checks occur AFTER the lock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20260921, 5432)`);
    const existing = rows(await tx.execute(sql`
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
      UNION ALL SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public', 'pg_catalog', 'information_schema') AND nspname NOT LIKE 'pg_%'
      UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
      UNION ALL SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'
      LIMIT 1
    `));
    if (existing.length) throw new Error("Pilot database is not blank; no changes allowed (including reruns).");
    const atomic: EvidenceDatabase = {
      execute: (query) => tx.execute(query),
      transaction: (run) => run(tx),
    };
    for (const statement of PILOT_LEGACY_SCHEMA) await atomic.execute(sql.raw(statement));
    const workspace = createWorkspaceStore(atomic);
    await workspace.ensureSchema();
    await createEvidenceStore(atomic).ensureSchema();
    await createDisbursementStore(atomic).ensureSchema();
    await createContributionStore(atomic).ensureSchema();
    await createActivityStore(atomic).ensureSchema();
    await createAuditFindingStore(atomic).ensureSchema();
    // Schema only: the unused buffer is NOT an OTP secret and no OTP method is called.
    await createDonorAccessStore(atomic, Buffer.alloc(0)).ensureSchema();
    await createZkBatchStore(atomic).ensureSchema();
    await createZkPublicationStore(atomic).ensureSchema();
    await createRegistryStore(atomic).ensureSchema();
    await ensureRegistryBudgetSchema(atomic);
    await createCertificateStore(atomic).ensureSchema();

    await atomic.execute(sql`INSERT INTO institutions (id, legal_name, scope_unit, scope_level, mandate_note, is_synthetic)
      VALUES (${INSTITUTION}, 'TAWF pilot sintetis 2026-09-21', 'Demo sintetis', 'PUSAT', ${WARNING}, true)`);
    for (const profile of ACCOUNTS) {
      if (profile.officer) await atomic.execute(sql`INSERT INTO officer_profiles (id, institution_id, display_name)
        VALUES (${profile.officer}, ${INSTITUTION}, ${profile.name})`);
      await atomic.execute(sql`INSERT INTO institution_memberships (institution_id, account_address, role, officer_id)
        VALUES (${INSTITUTION}, ${profile.account}, ${profile.role}, ${profile.officer})`);
    }
    for (const profile of ACCOUNTS) {
      for (const fn of profile.functions) {
        await workspace.grantMandate({
          id: `${profile.officer}-${fn}`, institutionId: INSTITUTION, actor: ACCOUNTS[0].account, now: FROM,
          mandate: { officerId: profile.officer!, accountAddress: profile.account, function: fn as OperationalFunction,
            scopeType: "ALL_PROGRAMS", validFrom: FROM, validUntil: UNTIL,
            assignmentRef: "SYNTHETIC-PILOT-20260921-NOT-A-REAL-MANDATE", nominalLimit: LIMIT },
        });
      }
    }
    // Verify before commit; return only redacted counts/profiles, not credentials or SQL errors.
    const counts = {
      institutions: rows(await atomic.execute(sql`SELECT count(*)::int AS count FROM institutions`))[0].count as number,
      officers: rows(await atomic.execute(sql`SELECT count(*)::int AS count FROM officer_profiles`))[0].count as number,
      memberships: rows(await atomic.execute(sql`SELECT count(*)::int AS count FROM institution_memberships`))[0].count as number,
      mandates: rows(await atomic.execute(sql`SELECT count(*)::int AS count FROM operational_mandates`))[0].count as number,
    };
    if (JSON.stringify(counts) !== JSON.stringify(pilotPlan().counts)) throw new Error("Pilot verification failed.");
    for (const profile of ACCOUNTS) {
      const member = await workspace.activeMembershipFor(profile.account);
      const mandates = await workspace.activeMandatesForAccount(INSTITUTION, profile.account, FROM);
      if (member?.role !== profile.role || (member.officerId ?? null) !== profile.officer || mandates.length !== profile.functions.length ||
        JSON.stringify(mandates.map(m => m.function).sort()) !== JSON.stringify([...profile.functions].sort()) ||
        mandates.some(m => m.officerId !== profile.officer || m.accountAddress !== profile.account || !m.isActive || m.programId !== null || m.nominalLimit !== LIMIT || m.validFrom !== FROM || m.validUntil !== UNTIL || m.scopeType !== "ALL_PROGRAMS")) {
        throw new Error("Pilot authority verification failed.");
      }
    }
    return { ...pilotPlan(), mode: "applied" as const, counts, verified: true };
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === "--plan")) {
    console.log(JSON.stringify(pilotPlan(), null, 2));
    return;
  }
  if (args.length !== 1 || args[0] !== "--apply") throw new Error("Pilot arguments refused.");
  const password = process.env.PILOT_DATABASE_PASSWORD;
  if (!password) throw new Error("Pilot credential missing.");
  // Dynamic imports: even the connection driver is unused during planning.
  const [{ default: postgres }, { drizzle }] = await Promise.all([import("postgres"), import("drizzle-orm/postgres-js")]);
  const client = postgres({ ...TARGET, password, max: 1, ssl: false, connect_timeout: 5,
    idle_timeout: 5, onnotice: () => {}, connection: { application_name: "synthetic-pilot-bootstrap", search_path: "public" } });
  try { console.log(JSON.stringify(await bootstrapPilotDatabase(drizzle(client), TARGET), null, 2)); }
  finally { await client.end({ timeout: 5 }); }
}

if (import.meta.main) {
  main().catch(() => {
    // Never render driver errors: they can contain SQL, credentials, or row data.
    console.error("Pilot bootstrap refused or failed. No success confirmed; inspect target/permissions locally. Driver details suppressed.");
    process.exitCode = 1;
  });
}

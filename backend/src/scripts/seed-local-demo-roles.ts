/**
 * LOCAL-ONLY seed for a manual end-to-end demo (donor payment -> manual proposal
 * -> DPS decision -> audit) using the project's actual DEPLOY_* addresses from
 * backend/.env, not throwaway Hardhat test accounts.
 *
 *   bun src/scripts/seed-local-demo-roles.ts
 *
 * Mirrors the role/function mapping already established in
 * scripts/pilot-database-bootstrap.ts (Amil == Admin, DPS approves, Auditor
 * reads), but targets whatever local DATABASE_URL is configured instead of the
 * VPS pilot database. Refuses to run against a non-local database.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createWorkspaceStore } from "../tenancy-store";
import type { OperationalFunction } from "../operational-mandate";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"];

// Matches the institution already enrolled on the deployed ReportEvidenceRegistry
// (0xfb621B196Ca8b198766e14B476A0fdcd65144659, Arbitrum Sepolia) where
// DEPLOY_AUDITOR_ADDRESS already holds an active auditor mandate. Reusing this id
// means the workspace's audit-findings feature works with zero new transactions.
const INSTITUTION_ID = "demo-tawf-20260921";

const ADMIN_ACCOUNT = (process.env.DEPLOY_ADMIN_ADDRESS ?? "").toLowerCase();
const DPS_ACCOUNT = (process.env.DEPLOY_DPS_ADDRESS ?? "").toLowerCase();
const AUDITOR_ACCOUNT = (process.env.DEPLOY_AUDITOR_ADDRESS ?? "").toLowerCase();

const ACCOUNTS = [
  {
    account: ADMIN_ACCOUNT,
    role: "ADMIN" as const,
    officerId: "off-tawf-amil",
    displayName: "Amil / Administrator",
    functions: [
      "MANAGE_PROGRAMS",
      "PREPARE_PROPOSALS",
      "EXAMINE_PROPOSALS",
      "RECORD_REALIZATION",
      "RECORD_CONTRIBUTIONS",
      "HANDLE_REPORT_EXAMINATION",
    ] as OperationalFunction[],
  },
  {
    account: DPS_ACCOUNT,
    role: "OFFICER" as const,
    officerId: "off-tawf-dps",
    displayName: "Dewan Pengawas Syariah (Pengesah)",
    functions: ["APPROVE_DECISIONS", "ENDORSE_CONTRIBUTIONS", "ISSUE_CERTIFICATES"] as OperationalFunction[],
  },
  {
    account: AUDITOR_ACCOUNT,
    role: "READER" as const,
    officerId: "off-tawf-auditor",
    displayName: "Auditor Independen",
    functions: [] as OperationalFunction[],
  },
];

const isLocal = (url: string): boolean => {
  try {
    return LOCAL_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL belum disetel.");
  if (!isLocal(databaseUrl)) throw new Error(`Menolak database non-lokal: ${new URL(databaseUrl).hostname}`);
  for (const a of ACCOUNTS) {
    if (!/^0x[0-9a-f]{40}$/.test(a.account)) {
      throw new Error(`Alamat tidak sah untuk ${a.displayName}: pastikan DEPLOY_ADMIN_ADDRESS / DEPLOY_DPS_ADDRESS / DEPLOY_AUDITOR_ADDRESS disetel di .env`);
    }
  }

  const client = postgres(databaseUrl, { max: 2 });
  const store = createWorkspaceStore(drizzle(client));
  const now = Math.floor(Date.now() / 1000);

  try {
    await store.ensureSchema();

    await store.upsertInstitution({
      id: INSTITUTION_ID,
      legalName: "LPZ Demo Lokal (sintetis)",
      scopeUnit: "Pusat",
      scopeLevel: "PUSAT",
      mandateNote: "Lembaga sintetis untuk uji alur manual lokal; bukan mandat atau identitas mitra sungguhan.",
      isSynthetic: true,
    });

    const adminAccount = ACCOUNTS[0].account;

    for (const a of ACCOUNTS) {
      await store.upsertMembership({ institutionId: INSTITUTION_ID, account: a.account, role: a.role });

      if (a.officerId) {
        await store
          .createOfficerProfile({ id: a.officerId, institutionId: INSTITUTION_ID, displayName: a.displayName, actor: adminAccount, now })
          .catch(() => {});
        await store
          .linkOfficerAccount({ officerId: a.officerId, institutionId: INSTITUTION_ID, account: a.account, role: a.role, actor: adminAccount, now })
          .catch(() => {});

        for (const fn of a.functions) {
          await store
            .grantMandate({
              institutionId: INSTITUTION_ID,
              actor: adminAccount,
              now,
              mandate: {
                officerId: a.officerId,
                function: fn,
                scopeType: "ALL_PROGRAMS",
                validFrom: now - 3600,
                validUntil: now + 86400 * 365,
                assignmentRef: `DEMO-LOCAL-${fn}`,
              },
            })
            .catch(() => {});
        }
      }
      console.log(`  ${INSTITUTION_ID}  ${a.role.padEnd(7)} ${a.account}  (${a.displayName})`);
    }

    console.log(`\n✓ Institusi demo lokal '${INSTITUTION_ID}' siap dengan 3 akun DEPLOY_* di atas.`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("Seed demo lokal gagal:", error);
  process.exit(1);
});

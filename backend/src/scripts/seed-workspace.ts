/**
 * Local onboarding for the institutional workspace (Spec #68, ticket #69).
 *
 *   bun src/scripts/seed-workspace.ts
 *
 * Records the two synthetic Pengelola Zakat and their accounts - an initial
 * administrator, an Amil operasional, and an authorised reader - so a local
 * developer can actually sign in. Without this the `institutions` table is
 * empty and every `POST /challenge` correctly answers 404.
 *
 * Onboarding is a deliberate step rather than a side effect of starting the
 * server, because installing institutions is exactly the thing that must not
 * happen by accident. It is idempotent: rerunning it updates the same rows.
 *
 * It refuses to touch a database that is not local. The fixture accounts come
 * from published test keys and are worthless as credentials; writing them into
 * a deployment that holds real data would be handing out authority on an
 * institution's workspace. Override with `--force` only when you know the
 * database is disposable.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../fixtures/institutions";
import { createWorkspaceStore } from "../tenancy-store";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"];

const isLocal = (url: string): boolean => {
  try {
    return LOCAL_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL belum disetel. Lihat backend/.env.example.");
    process.exit(1);
  }

  const forced = process.argv.includes("--force");
  if (!isLocal(databaseUrl) && !forced) {
    console.error(
      "Menolak menanam lembaga sintetis pada database non-lokal.\n" +
        "Akun fixture memakai kunci uji yang dipublikasikan dan tidak boleh diberi kewenangan\n" +
        "pada deployment yang memuat data sungguhan. Gunakan --force hanya bila database ini\n" +
        "memang dapat dibuang."
    );
    process.exit(1);
  }

  const client = postgres(databaseUrl, { max: 2 });
  const store = createWorkspaceStore(drizzle(client));

  try {
    await store.ensureSchema();

    for (const institution of SYNTHETIC_INSTITUTIONS) {
      await store.upsertInstitution(institutionRecordOf(institution));
      for (const member of institution.members) {
        await store.upsertMembership({
          institutionId: institution.id,
          account: member.account,
          role: member.role,
        });
        if (member.officerProfile) {
          const now = Math.floor(Date.now() / 1000);
          await store.createOfficerProfile({
            id: member.officerProfile.id,
            institutionId: institution.id,
            displayName: member.officerProfile.displayName,
            actor: institution.members.find(candidate => candidate.role === "ADMIN")!.account,
            now,
          }).catch(() => { /* idempotent if exists */ });
          await store.linkOfficerAccount({
            officerId: member.officerProfile.id,
            institutionId: institution.id,
            account: member.account,
            role: member.role,
            actor: institution.members.find(candidate => candidate.role === "ADMIN")!.account,
            now,
          }).catch(() => { /* idempotent */ });

          if (member.officerProfile.mandates) {
            const adminAcc = institution.members.find(candidate => candidate.role === "ADMIN")!.account;
            for (const m of member.officerProfile.mandates) {
              await store.grantMandate({
                institutionId: institution.id,
                actor: adminAcc,
                now,
                mandate: {
                  officerId: member.officerProfile.id,
                  function: m.function,
                  scopeType: m.scopeType,
                  validFrom: now - 3600,
                  validUntil: now + 86400 * 365,
                  assignmentRef: m.assignmentRef,
                  nominalLimit: m.nominalLimit,
                },
              }).catch(() => { /* idempotent */ });
            }
          }
        }
        console.log(`  ${institution.id}  ${member.role.padEnd(7)} ${member.account}  (${member.describes})`);
      }

      if (institution.endorsementAccounts) {
        const adminAcc = institution.members.find(candidate => candidate.role === "ADMIN")!.account;
        const now = Math.floor(Date.now() / 1000);
        for (const ea of institution.endorsementAccounts) {
          await store.registerEndorsementAccount({
            id: ea.id,
            institutionId: institution.id,
            actor: adminAcc,
            now,
            data: {
              accountAddress: ea.accountAddress,
              label: ea.label,
              authorizedOfficerIds: ea.authorizedOfficerIds,
            },
          }).catch(() => { /* idempotent */ });
        }
      }

      console.log(`✓ ${institution.legalName}`);
    }

    console.log(
      "\nSelesai. Lembaga di atas sintetis dan diberi label demikian pada barisnya sendiri;\n" +
        "identitas, mandat, dan akun penanda tangan lembaga sungguhan adalah data onboarding\n" +
        "yang belum tersedia."
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("Onboarding ruang kerja gagal:", error);
  process.exit(1);
});

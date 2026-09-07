import postgres from "postgres";
import { chmodSync, statSync } from "node:fs";
import { resolve } from "node:path";

// No application imports: reset must not start the indexer or run startup DDL.
async function main() {
  if (process.env.DEPLOYMENT_PENDING !== "true" || process.env.ENABLE_EMBEDDED_INDEXER !== "false") {
    throw new Error("Stop all indexers and set DEPLOYMENT_PENDING=true, ENABLE_EMBEDDED_INDEXER=false first");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const target = new URL(process.env.DATABASE_URL);
  const database = decodeURIComponent(target.pathname.slice(1));
  const confirmation = `--confirm-reset=${target.hostname}/${database}`;
  if (!process.argv.includes(confirmation)) throw new Error(`Explicit target confirmation required: ${confirmation}`);

  process.umask(0o077);
  const backup = resolve(import.meta.dir, "../..", `manual-reset-${Date.now()}.dump.bak`);
  const dump = Bun.spawn(["pg_dump", "--format=custom", "--no-owner", "--no-acl", `--file=${backup}`], {
    env: { PATH: process.env.PATH, PGHOST: target.hostname, PGPORT: target.port || "5432",
      PGDATABASE: database, PGUSER: decodeURIComponent(target.username), PGPASSWORD: decodeURIComponent(target.password),
      PGSSLMODE: "require", PGCONNECT_TIMEOUT: "10" }, stdout: "ignore", stderr: "ignore",
  });
  if (await dump.exited !== 0) throw new Error("Backup failed; database was not changed");
  chmodSync(backup, 0o600);
  const check = Bun.spawn(["pg_restore", "--list", backup], { stdout: "pipe", stderr: "ignore" });
  const toc = await new Response(check.stdout).text();
  if (await check.exited !== 0 || !toc.includes("TABLE DATA") || statSync(backup).size < 1000) throw new Error("Backup validation failed");

  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10 });
  try {
    await sql.begin(async tx => {
      await tx`SET LOCAL lock_timeout = '10s'`;
      await tx`TRUNCATE TABLE donations, merkle_batches, disbursement_proposals, onchain_events, role_members, auditor_profiles, indexer_state RESTART IDENTITY`;
    });
    console.log(JSON.stringify({ reset: "complete", backup, tablesEmptied: 7, seededRows: 0, deploymentPending: true }));
  } finally { await sql.end(); }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message.split("\n")[0] : "Reset failed");
  process.exitCode = 1;
});

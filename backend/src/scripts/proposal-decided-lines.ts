/**
 * The operator's tool for recovering what initial approvals decided (#93 follow-up).
 *
 *   bun src/scripts/proposal-decided-lines.ts verify
 *   bun src/scripts/proposal-decided-lines.ts apply
 *
 * `verify` reports and writes nothing. `apply` adds the column if needed and
 * writes back only line sets that reproduce the signed rights digest, then
 * reports again, so what the operator reads is the state they just made.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createDisbursementStore } from "../disbursement-store";
import { recoverDecidedAidLines } from "../proposal-decision-lines";

const say = (line = "") => console.log(line);

const MODES = ["verify", "apply"] as const;
type Mode = (typeof MODES)[number];

async function main() {
  const mode = (process.argv[2] ?? "verify") as Mode;
  if (!MODES.includes(mode)) {
    say(`Mode tidak dikenal: ${mode}. Gunakan ${MODES.join(" atau ")}.`);
    process.exit(2);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    say("DATABASE_URL belum disetel. Skrip ini tidak memiliki basis data cadangan.");
    process.exit(2);
  }

  // Schema statements are idempotent; their "already exists" notices are not findings.
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const db = drizzle(client);
  try {
    if (mode === "apply") {
      await createDisbursementStore(db).ensureSchema();
    } else {
      const column = await client`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'proposal_decisions' AND column_name = 'decided_aid_lines_json'
      `;
      if (column.length === 0) {
        say("\nKolom decided_aid_lines_json belum ada. Jalankan mode apply untuk menambahkannya dan memulihkan data.");
        return;
      }
    }
    const report = await recoverDecidedAidLines(db, { apply: mode === "apply" });
    const count = (state: string) => report.outcomes.filter((o) => o.state === state).length;
    say(`\nKeputusan persetujuan tanpa garis yang diputuskan: ${report.missing}`);
    const done = mode === "apply" ? "Dipulihkan" : "Dapat dipulihkan";
    say(`   ${`${done} dari draf aktif`.padEnd(36)}: ${count("RECOVERED_FROM_DRAFT")}`);
    say(`   ${`${done} dari delta revisi`.padEnd(36)}: ${count("RECOVERED_FROM_REVISION")}`);
    say(`   ${"Tidak dapat dipulihkan".padEnd(36)}: ${count("UNRECOVERABLE")}`);
    for (const o of report.outcomes.filter((o) => o.state === "UNRECOVERABLE")) {
      say(`     - ${o.decisionId} (pengajuan ${o.proposalId} v${o.proposalVersion}): tidak ada kandidat yang cocok dengan rights digest bertanda tangan`);
    }
    say();
  } finally {
    await client.end({ timeout: 5 });
  }
}

await main();
process.exit(0);

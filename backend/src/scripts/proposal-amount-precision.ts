/**
 * The operator's tool for the exact disbursement amount column (ticket #80).
 *
 *   bun src/scripts/proposal-amount-precision.ts verify
 *   bun src/scripts/proposal-amount-precision.ts apply
 *
 * The sibling of `usdc-deposit-identity.ts`, and it works the same way: `verify`
 * reads and reports and writes nothing; `apply` runs the additive migration and
 * verifies afterwards, so what the operator reads is the state they just made
 * rather than the one they intended.
 *
 * Deploying the code is not the approval. The heuristic this ticket removes is
 * gone either way - the unit now comes from `currencyType`, which needs no
 * migration at all. The column preserves exact amounts; legacy USDC without it remains
 * unverified until the same proposal is recovered from a verified receipt.
 *
 * There is no inference backfill here either, but for a different reason than in
 * #67: a proposal *can* be paired, because it carries `proposalIdOnChain` and
 * the chain emits `DisbursementProposed` / `DisbursementExecuted` with the
 * amount. Operators recover rows through the existing receipt-confirmation
 * endpoint, which verifies that identity before writing the current exact
 * amount. The schema migration itself never backfills legacy values.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  applyProposalAmountMigration,
  PROPOSAL_AMOUNT_MIGRATION_STATEMENTS,
  verifyProposalAmounts,
} from "../proposal-amount-store";

const say = (line = "") => console.log(line);
const heading = (line: string) => say(`\n\x1b[1m${line}\x1b[0m`);

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

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    if (mode === "apply") {
      heading("Menjalankan migrasi jumlah eksak penyaluran");
      for (const statement of PROPOSAL_AMOUNT_MIGRATION_STATEMENTS) say(`   ${statement}`);
      await applyProposalAmountMigration(db);
      say("   Selesai. Aditif dan idempoten; tidak ada kolom lama yang diubah.");
    }

    heading("Keadaan jumlah penyaluran");
    const report = await verifyProposalAmounts(db);

    if (!report.migrated) {
      say("   Migrasi belum diterapkan: kolom jumlah eksak belum ada.");
      say(`   Proposal tersimpan: ${report.totalProposals}.`);
      say(`   Proposal USDC belum terverifikasi: ${report.usdcWithoutExactAmount}.`);
      say("   USDC tanpa amount_exact belum terverifikasi; jumlah lama tidak dipakai dalam perhitungan.");
      return;
    }

    say(`   Proposal tersimpan            : ${report.totalProposals}`);
    say(`   Menyimpan jumlah eksak        : ${report.exact}`);
    say(`   USDC tanpa jumlah eksak       : ${report.usdcWithoutExactAmount}`);

    if (report.usdcWithoutExactAmount > 0) {
      say();
      say("   Proposal berikut belum terverifikasi; pulihkan jumlahnya dari receipt proposal yang sama:");
      for (const id of report.inexactReferences) say(`     - proposal #${id}`);
    }
    say();
  } finally {
    await client.end({ timeout: 5 });
  }
}

await main();
process.exit(0);

/**
 * The operator's tool for the USDC deposit identity migration (ticket #67).
 *
 *   bun src/scripts/usdc-deposit-identity.ts verify
 *   bun src/scripts/usdc-deposit-identity.ts apply
 *
 * `verify` reads and reports; it writes nothing and is safe against production.
 * `apply` runs the additive migration and then verifies, so the operator sees
 * the state they just created rather than the state they intended.
 *
 * The migration is a separate, deliberate act rather than something the server
 * does at boot. #66 deploys without migrations, and this ticket exists precisely
 * because the schema change was carved out of that boundary. Running this script
 * is the approval; deploying the code is not.
 *
 * **There is no inference backfill, and that is the strategy, not an omission.**
 * A legacy USDC row holds a rupiah estimate at a hardcoded rate, a timestamp,
 * and a truncated donor address. None of those can prove which log a row came
 * from - two deposits of the same size in the same hour are indistinguishable to
 * every one of them - so pairing by resemblance would manufacture exactly the
 * false reconciliation this work is meant to detect. Legacy rows are reported as
 * unverified and stay that way. See the runbook for what an operator does about
 * them.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  applyUsdcDepositMigration,
  USDC_DEPOSIT_MIGRATION_STATEMENTS,
  verifyUsdcDepositIdentity,
} from "../usdc-deposit-store";

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
    say(
      "DATABASE_URL belum disetel. Skrip ini tidak memiliki basis data cadangan dan tidak " +
        "mengarang salah satu."
    );
    process.exit(2);
  }

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    if (mode === "apply") {
      heading("Menjalankan migrasi identitas deposit USDC");
      for (const statement of USDC_DEPOSIT_MIGRATION_STATEMENTS) {
        say(`   ${statement.replace(/\s+/g, " ").trim()}`);
      }
      await applyUsdcDepositMigration(db);
      say("   Selesai. Seluruh pernyataan bersifat aditif dan idempoten.");
    }

    heading("Keadaan ledger deposit USDC");
    const report = await verifyUsdcDepositIdentity(db);

    if (!report.migrated) {
      say("   Migrasi belum diterapkan: kolom jumlah native dan identitas event belum ada.");
      say(`   Baris donasi USDC: ${report.totalUsdcRows}, seluruhnya belum terverifikasi.`);
      say("   Jalankan ulang dengan mode `apply` setelah membaca runbook.");
      return;
    }

    say(`   Baris donasi USDC        : ${report.totalUsdcRows}`);
    say(`   Terikat identitas event  : ${report.identified}`);
    say(`   Belum terverifikasi      : ${report.unverified}`);

    if (report.unverified > 0) {
      say();
      say("   Baris berikut tidak dapat dipasangkan dengan event on-chain mana pun.");
      say("   Jumlahnya tidak ditebak dari kurs, estimasi rupiah, atau tanggal, dan tetap");
      say("   dilaporkan sebagai belum terverifikasi pada paket bukti maupun mode internal:");
      for (const reference of report.unverifiedReferences) say(`     - ${reference}`);
    }
    say();
  } finally {
    await client.end({ timeout: 5 });
  }
}

await main();
process.exit(0);

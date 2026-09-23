/**
 * The operator's tool for attributing older allocations to individual mustahik (ADR-0037).
 *
 *   bun src/scripts/allocation-beneficiary-shares.ts verify
 *   bun src/scripts/allocation-beneficiary-shares.ts apply
 *
 * `verify` reports and writes nothing; it runs the same fill inside a rolled-back
 * transaction, so its numbers are what `apply` would write. `apply` creates the table
 * if this deployment lacks it, fills the gaps, then reports the state it just made.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { backfillBeneficiaryShares, type ShareBackfillState } from "../allocation-share-backfill";
import { createActivityStore } from "../activity-store";

const say = (line = "") => console.log(line);

const MODES = ["verify", "apply"] as const;
type Mode = (typeof MODES)[number];

const LABELS: Record<ShareBackfillState, string> = {
  ATTRIBUTED: "Dirinci ke mustahik",
  UNATTRIBUTABLE: "Tidak ada kebutuhan tersisa untuk dirinci",
  EMPTY: "Alokasi bernilai nol, dilewati",
  UNKNOWN_FUND_TYPE: "Jenis dana tidak dikenali, dilewati",
};

const rupiah = (exact: string) => `Rp${BigInt(exact).toLocaleString("id-ID")}`;

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
      await createActivityStore(db).ensureSchema();
    } else {
      const table = await client`SELECT to_regclass('allocation_beneficiary_shares') AS found`;
      if (!table[0]?.found) {
        say("\nTabel allocation_beneficiary_shares belum ada. Jalankan mode apply untuk membuatnya dan merinci alokasi lama.");
        return;
      }
    }

    const report = await backfillBeneficiaryShares(db, { apply: mode === "apply", now: Date.now() });
    const count = (state: ShareBackfillState) => report.outcomes.filter((o) => o.state === state).length;
    const totalOf = (field: "attributedExact" | "unassignedExact") =>
      report.outcomes.reduce((total, o) => total + BigInt(o[field]), 0n).toString();

    say(`\nAlokasi aktif tanpa rincian penerima: ${report.candidates}`);
    for (const state of Object.keys(LABELS) as ShareBackfillState[]) {
      say(`   ${LABELS[state].padEnd(42)}: ${count(state)}`);
    }
    say(`\n   ${"Nominal dirinci ke mustahik".padEnd(42)}: ${rupiah(totalOf("attributedExact"))}`);
    // A visible remainder is a legitimate state, not a failure: the money exceeds what
    // the activity still needs, or covers aid whose value is not yet known (ADR-0033).
    say(`   ${"Nominal tetap belum dirinci".padEnd(42)}: ${rupiah(totalOf("unassignedExact"))}`);

    for (const outcome of report.outcomes.filter((o) => o.state !== "ATTRIBUTED")) {
      say(`     - ${outcome.allocationId} (kegiatan ${outcome.activityId}): ${LABELS[outcome.state].toLowerCase()}`);
    }
    if (mode === "verify" && report.candidates > 0) {
      say("\nTidak ada yang ditulis. Jalankan mode apply untuk menyimpan rincian di atas.");
    }
    say();
  } finally {
    await client.end({ timeout: 5 });
  }
}

await main();
process.exit(0);

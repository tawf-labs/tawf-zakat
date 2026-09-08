/**
 * Keeping a disbursement amount exactly (ticket #80).
 *
 * The `amount` column is declared `bigint({ mode: "number" })`, so the driver
 * hands it back as a JavaScript number. The chain reader guards that today by
 * *refusing* any proposal above 2^53 minor units - safe, but it turns a valid
 * disbursement into an error rather than a figure.
 *
 * An exact decimal-text column removes both the refusal and the round trip. It
 * is additive and operator-run, like #67's, so a deployment with the code and
 * not the columns has to keep working - which is what most of this file checks.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyProposalAmountMigration,
  hasExactAmountColumn,
  proposalSelection,
  verifyProposalAmounts,
} from "../src/proposal-amount-store";
import { proposalAmount } from "../src/ledger-rows";
import * as schema from "../src/db/schema";

/** The table as a deployment already holds it, before this ticket. */
const LEGACY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS disbursement_proposals (
    id SERIAL PRIMARY KEY,
    proposal_id_on_chain INTEGER NOT NULL UNIQUE,
    currency_type INTEGER NOT NULL DEFAULT 0,
    amount BIGINT NOT NULL,
    asnaf_category TEXT NOT NULL,
    beneficiary_name TEXT NOT NULL,
    beneficiary_nik_masked TEXT NOT NULL,
    beneficiary_hash TEXT NOT NULL,
    ipfs_proof_cid TEXT NOT NULL,
    disbursement_receipt_cid TEXT,
    period_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending',
    cancel_reason TEXT,
    approval_count INTEGER NOT NULL DEFAULT 1,
    approved_by TEXT NOT NULL DEFAULT '[]',
    tx_hash TEXT,
    audit_status TEXT NOT NULL DEFAULT 'PENDING',
    auditor_address TEXT, auditor_name TEXT, audit_report_cid TEXT,
    audit_opinion TEXT, audit_notes TEXT, audited_at TIMESTAMP, audit_tx_hash TEXT,
    lai_document_cid TEXT, financial_statements_cid TEXT,
    safe_status TEXT DEFAULT 'IDLE',
    safe_confirmations_count INTEGER DEFAULT 0,
    safe_confirmations_required INTEGER DEFAULT 2,
    created_at TIMESTAMP DEFAULT NOW(),
    executed_at TIMESTAMP
  );
`;

let directory: string;
let client: PGlite;
let db: ReturnType<typeof drizzle>;

const rows = (result: any): any[] =>
  Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];

async function unmigratedDatabase() {
  const path = await mkdtemp(join(tmpdir(), "tawf-proposal-legacy-"));
  const legacyClient = new PGlite(path);
  const legacyDb = drizzle(legacyClient);
  await legacyDb.execute(sql.raw(LEGACY_SCHEMA));
  return {
    db: legacyDb,
    async close() {
      await legacyClient.close();
      await rm(path, { recursive: true, force: true });
    },
  };
}

const insertProposal = (
  target: ReturnType<typeof drizzle>,
  id: number,
  currencyType: number,
  amount: bigint,
  exact?: string
) =>
  target.execute(
    exact === undefined
      ? sql`INSERT INTO disbursement_proposals (proposal_id_on_chain, currency_type, amount,
              asnaf_category, beneficiary_name, beneficiary_nik_masked, beneficiary_hash,
              ipfs_proof_cid, period_id, status)
            VALUES (${id}, ${currencyType}, ${amount.toString()}, 'Amil', 'x', 'x', '0xabc', 'cid', 202608, 'Executed')`
      : sql`INSERT INTO disbursement_proposals (proposal_id_on_chain, currency_type, amount, amount_exact,
              asnaf_category, beneficiary_name, beneficiary_nik_masked, beneficiary_hash,
              ipfs_proof_cid, period_id, status)
            VALUES (${id}, ${currencyType}, ${amount.toString()}, ${exact}, 'Amil', 'x', 'x', '0xabc', 'cid', 202608, 'Executed')`
  );

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "tawf-proposal-store-"));
  client = new PGlite(directory);
  db = drizzle(client);
  await db.execute(sql.raw(LEGACY_SCHEMA));
});

afterAll(async () => {
  await client.close();
  await rm(directory, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE disbursement_proposals RESTART IDENTITY`);
});

describe("the migration", () => {
  beforeEach(async () => {
    await applyProposalAmountMigration(db);
  });

  it("adds the exact column and leaves the existing ones alone", async () => {
    const columns = rows(
      await db.execute(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'disbursement_proposals'
      `)
    ).map((row: any) => String(row.column_name));

    expect(columns).toContain("amount_exact");
    for (const kept of ["amount", "currency_type", "proposal_id_on_chain", "status", "asnaf_category"]) {
      expect(columns, kept).toContain(kept);
    }
  });

  it("runs twice without complaining", async () => {
    await insertProposal(db, 1, 1, 500_000n);
    await applyProposalAmountMigration(db);
    expect(rows(await db.execute(sql`SELECT * FROM disbursement_proposals`))).toHaveLength(1);
  });

  it("leaves a legacy row's amount untouched and its exact column empty", async () => {
    await insertProposal(db, 1, 1, 500_000n);
    await applyProposalAmountMigration(db);

    const [row] = rows(await db.execute(sql`SELECT amount, amount_exact FROM disbursement_proposals`));
    expect(Number(row.amount)).toBe(500_000);
    expect(row.amount_exact).toBeNull();
  });
});

describe("reading proposals across the migration boundary", () => {
  it("names no column the database does not have", async () => {
    const legacy = await unmigratedDatabase();
    try {
      await insertProposal(legacy.db, 1, 1, 500_000n);
      const [row] = await legacy.db
        .select(proposalSelection(false))
        .from(schema.disbursementProposals);

      expect(row).toHaveProperty("amount");
      expect(row).not.toHaveProperty("amountExact");
      // The row is readable, but its ambiguous legacy amount is not verified.
      expect(() => proposalAmount(row as never)).toThrow("belum terverifikasi");
    } finally {
      await legacy.close();
    }
  });

  it("reads the exact column once it exists, past what a number could hold", async () => {
    await applyProposalAmountMigration(db);
    const huge = "123456789012345678901234567890";
    await insertProposal(db, 1, 1, 0n, huge);

    const [row] = await db.select(proposalSelection(true)).from(schema.disbursementProposals);
    expect(proposalAmount(row as never)).toEqual({ amount: BigInt(huge), unit: "USDC_6DP" });
  });

  it("reports whether the column exists rather than inferring it from rows", async () => {
    const legacy = await unmigratedDatabase();
    try {
      expect(await hasExactAmountColumn(legacy.db)).toBe(false);
    } finally {
      await legacy.close();
    }
    await applyProposalAmountMigration(db);
    expect(await hasExactAmountColumn(db)).toBe(true);
  });
});

describe("verifying what the deployment holds", () => {
  it("reports the migration as absent rather than as zero exact rows", async () => {
    const legacy = await unmigratedDatabase();
    try {
      await insertProposal(legacy.db, 1, 1, 500_000n);
      const report = await verifyProposalAmounts(legacy.db);
      expect(report.migrated).toBe(false);
      expect(report.exact).toBeNull();
      expect(report.usdcWithoutExactAmount).toBe(1);
    } finally {
      await legacy.close();
    }
  });

  it("counts exact and inexact USDC proposals apart once migrated", async () => {
    await applyProposalAmountMigration(db);
    await insertProposal(db, 1, 1, 500_000n, "500000");
    await insertProposal(db, 2, 1, 1_500_000n);
    await insertProposal(db, 3, 0, 2_000_000n);

    const report = await verifyProposalAmounts(db);
    expect(report.migrated).toBe(true);
    expect(report.totalProposals).toBe(3);
    expect(report.exact).toBe(1);
    expect(report.usdcWithoutExactAmount).toBe(1);
    expect(report.inexactReferences).toEqual([2]);
  });
});

describe("saving chain-confirmed proposal amounts", () => {
  it("round trips full uint256 amounts through the confirmed proposal writer", async () => {
    await applyProposalAmountMigration(db);
    const { saveConfirmedProposal } = await import("../src/proposal-amount-store");
    await saveConfirmedProposal(db, {
      proposalIdOnChain: 9, currencyType: 1, amountExact: "123456789012345678901234567890",
      asnafCategory: "Amil", beneficiaryHash: "0xabc", ipfsProofCID: "cid", periodId: 202609,
    }, true);
    const [row] = await db.select(proposalSelection(true)).from(schema.disbursementProposals);
    expect(proposalAmount(row as never).amount).toBe(123456789012345678901234567890n);
    expect(row.amount).toBe(-1);
    expect(row.createdAt).toBeNull();
  });
});
it("writes before migration and refuses amounts the legacy column cannot preserve", async () => {
  const legacy = await unmigratedDatabase();
  try {
    const { saveConfirmedProposal } = await import("../src/proposal-amount-store");
    const record = { proposalIdOnChain: 10, currencyType: 1, amountExact: "500000", asnafCategory: "Amil", beneficiaryHash: "0xabc", ipfsProofCID: "cid", periodId: 202609 };
    await saveConfirmedProposal(legacy.db, record, false);
    expect(rows(await legacy.db.execute(sql`SELECT amount FROM disbursement_proposals`))[0].amount).toBe(500000);
    await expect(saveConfirmedProposal(legacy.db, { ...record, amountExact: "9007199254740993" }, false)).rejects.toThrow("migrasi");
  } finally { await legacy.close(); }
});
it("recovers an existing proposal only from a confirmation of the same identity", async () => {
  await applyProposalAmountMigration(db);
  await insertProposal(db, 11, 1, 250n);
  const { saveConfirmedProposal } = await import("../src/proposal-amount-store");
  const record = { proposalIdOnChain: 11, currencyType: 1, amountExact: "250000000", asnafCategory: "Amil", beneficiaryHash: "0xabc", ipfsProofCID: "cid", periodId: 202609 };
  await saveConfirmedProposal(db, record, true);
  await saveConfirmedProposal(db, record, true);
  const saved = await db.select(proposalSelection(true)).from(schema.disbursementProposals);
  expect(saved).toHaveLength(1);
  expect(proposalAmount(saved[0] as never).amount).toBe(250000000n);
  await expect(saveConfirmedProposal(db, { ...record, beneficiaryHash: "0xdef" }, true)).rejects.toThrow("another deployment");
});

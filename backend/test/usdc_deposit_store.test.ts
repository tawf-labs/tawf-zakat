/**
 * Keeping a USDC deposit, once (ticket #67).
 *
 * Against a real PostgreSQL (PGlite), because every claim here is a claim about
 * what the database enforces rather than about what the caller remembers to do:
 * the migration is additive, the identity is unique, and an event processed
 * twice leaves one row.
 *
 * The migration is deliberately not applied at boot. A deployment that has the
 * code but not the columns is a real state - #66 ships without migrations - so
 * the write path is tested in both, and the one without columns must keep
 * working rather than dropping the deposit.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDepositIntake, type DepositEventInput } from "../src/usdc-deposit-intake";
import {
  applyUsdcDepositMigration,
  donationSelection,
  saveUsdcDeposit,
  verifyUsdcDepositIdentity,
} from "../src/usdc-deposit-store";
import * as schema from "../src/db/schema";

const CHAIN_ID = 421614;
const CONTRACT = "0x0d6cec28a574aca41b879767b081f6f2b4e9a849";
const TX = `0x${"ab".repeat(32)}`;
const DONOR = "0x1234567890abcdef1234567890abcdef12345678";

/** The donations table as a deployment already holds it, before this ticket. */
const LEGACY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS donations (
    id SERIAL PRIMARY KEY,
    trx_id TEXT NOT NULL UNIQUE,
    donor_name TEXT NOT NULL,
    is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
    amount_idr BIGINT NOT NULL,
    salt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    payment_method TEXT NOT NULL DEFAULT 'QRIS',
    qr_string TEXT,
    qr_url TEXT,
    batch_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    paid_at TIMESTAMP
  );
`;

let directory: string;
let client: PGlite;
let db: ReturnType<typeof drizzle>;

/**
 * A second, throwaway database that never gets the migration.
 *
 * The shared one above is migrated by the blocks below it, and `TRUNCATE` does
 * not remove a column - so "what happens before the migration" has to be asked
 * of a database that has genuinely never had it.
 */
async function unmigratedDatabase() {
  const path = await mkdtemp(join(tmpdir(), "tawf-usdc-legacy-"));
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

const rows = (result: any): any[] =>
  Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];

const recordOf = (overrides: Partial<DepositEventInput> = {}) => {
  const read = readDepositIntake({
    chainId: CHAIN_ID,
    contract: CONTRACT,
    txHash: TX,
    logIndex: 0,
    blockNumber: 500,
    amountUSDC: 1_500_000n,
    donor: DONOR,
    isAnonymous: false,
    occurredAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  });
  if ("error" in read) throw new Error(read.error);
  return read.record;
};

const donationRows = async () =>
  rows(await db.execute(sql`SELECT * FROM donations ORDER BY id ASC`));

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "tawf-usdc-store-"));
  client = new PGlite(directory);
  db = drizzle(client);
  await db.execute(sql.raw(LEGACY_SCHEMA));
});

afterAll(async () => {
  await client.close();
  await rm(directory, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE donations RESTART IDENTITY`);
});

describe("before the migration is applied", () => {
  it("still records the deposit, without pretending it has an identity", async () => {
    const legacy = await unmigratedDatabase();
    try {
      const saved = await saveUsdcDeposit(legacy.db, recordOf(), { salt: "salt-1" });
      expect(saved.stored).toBe("INSERTED");
      expect(saved.identityPreserved).toBe(false);

      const [row] = rows(await legacy.db.execute(sql`SELECT * FROM donations`));
      expect(row.trx_id).toBe(recordOf().trxId);
      expect(row.payment_method).toBe("USDC");
      // No native columns to write to, so nothing pretends there are.
      expect(row.amount_usdc_6dp).toBeUndefined();
      // And no estimate at a hardcoded rate standing in for the amount.
      expect(Number(row.amount_idr)).toBe(0);
    } finally {
      await legacy.close();
    }
  });

  it("reports the migration as absent rather than reporting zero identified rows", async () => {
    const legacy = await unmigratedDatabase();
    try {
      await saveUsdcDeposit(legacy.db, recordOf(), { salt: "salt-1" });
      const report = await verifyUsdcDepositIdentity(legacy.db);
      expect(report.migrated).toBe(false);
      expect(report.identified).toBeNull();
      expect(report.unverified).toBe(1);
    } finally {
      await legacy.close();
    }
  });
});

describe("the migration", () => {
  beforeEach(async () => {
    await applyUsdcDepositMigration(db);
  });

  it("adds the native columns and leaves the existing ones alone", async () => {
    const columns = rows(
      await db.execute(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'donations'
      `)
    ).map((row: any) => String(row.column_name));

    for (const added of [
      "amount_usdc_6dp",
      "deposit_chain_id",
      "deposit_contract",
      "deposit_tx_hash",
      "deposit_log_index",
    ]) {
      expect(columns, added).toContain(added);
    }
    for (const kept of ["trx_id", "donor_name", "amount_idr", "salt", "status", "batch_id"]) {
      expect(columns, kept).toContain(kept);
    }
  });

  it("runs twice without complaining and without changing anything", async () => {
    await saveUsdcDeposit(db, recordOf(), { salt: "salt-1" });
    await applyUsdcDepositMigration(db);
    expect(await donationRows()).toHaveLength(1);
  });

  it("keeps a legacy row untouched: no invented identity, no invented amount", async () => {
    await db.execute(sql`
      INSERT INTO donations (trx_id, donor_name, amount_idr, salt, status, payment_method)
      VALUES ('USDC-20240101-1234', 'Muzakki Web3', 16200000, 'lama', 'PAID', 'USDC')
    `);
    await applyUsdcDepositMigration(db);

    const [row] = await donationRows();
    expect(row.amount_usdc_6dp).toBeNull();
    expect(row.deposit_tx_hash).toBeNull();
    // The estimate that was already there is left exactly as it was found.
    expect(Number(row.amount_idr)).toBe(16_200_000);
  });
});

describe("after the migration", () => {
  beforeEach(async () => {
    await applyUsdcDepositMigration(db);
  });

  it("stores the native amount and the full identity", async () => {
    const saved = await saveUsdcDeposit(db, recordOf({ amountUSDC: 500_000n }), { salt: "s" });
    expect(saved.identityPreserved).toBe(true);

    const [row] = await donationRows();
    expect(row.amount_usdc_6dp).toBe("500000");
    expect(row.deposit_chain_id).toBe(CHAIN_ID);
    expect(row.deposit_contract).toBe(CONTRACT);
    expect(row.deposit_tx_hash).toBe(TX);
    expect(row.deposit_log_index).toBe(0);
  });

  it("keeps an amount beyond double precision exact through storage", async () => {
    const huge = 123_456_789_012_345_678_901_234_567_890n;
    await saveUsdcDeposit(db, recordOf({ amountUSDC: huge }), { salt: "s" });
    const [row] = await donationRows();
    expect(row.amount_usdc_6dp).toBe(huge.toString());
  });

  it("leaves one row when the same event is processed twice", async () => {
    const record = recordOf();
    const first = await saveUsdcDeposit(db, record, { salt: "salt-pertama" });
    const second = await saveUsdcDeposit(db, record, { salt: "salt-kedua" });

    expect(first.stored).toBe("INSERTED");
    expect(second.stored).toBe("UNCHANGED");
    expect(await donationRows()).toHaveLength(1);
  });

  it("does not rewrite a row a later stage already moved on from", async () => {
    const record = recordOf();
    await saveUsdcDeposit(db, record, { salt: "asli" });
    await db.execute(sql`UPDATE donations SET batch_id = 7, status = 'BATCHED'`);

    await saveUsdcDeposit(db, record, { salt: "baru" });

    const [row] = await donationRows();
    expect(row.batch_id).toBe(7);
    expect(row.status).toBe("BATCHED");
    expect(row.salt).toBe("asli");
  });

  it("keeps two deposits from one transaction as two rows", async () => {
    await saveUsdcDeposit(db, recordOf({ logIndex: 0, amountUSDC: 1_000_000n }), { salt: "a" });
    await saveUsdcDeposit(db, recordOf({ logIndex: 1, amountUSDC: 1_500_000n }), { salt: "b" });

    const stored = await donationRows();
    expect(stored).toHaveLength(2);
    expect(stored.map((row: any) => row.amount_usdc_6dp)).toEqual(["1000000", "1500000"]);
  });

  it("refuses a second row claiming the same deposit identity", async () => {
    await saveUsdcDeposit(db, recordOf(), { salt: "a" });
    // A row minted the old way, with its own trxId, pointing at the same log.
    const duplicate = async () =>
      db.execute(sql`
        INSERT INTO donations (trx_id, donor_name, amount_idr, salt, status, payment_method,
          amount_usdc_6dp, deposit_chain_id, deposit_contract, deposit_tx_hash, deposit_log_index)
        VALUES ('USDC-LAIN-0001', 'Muzakki Web3', 0, 'x', 'PAID', 'USDC',
                '1500000', ${CHAIN_ID}, ${CONTRACT}, ${TX}, 0)
      `);
    expect(duplicate()).rejects.toThrow();
  });
});

describe("verifying what the deployment holds", () => {
  it("counts identified and unverifiable rows apart once migrated", async () => {
    await applyUsdcDepositMigration(db);
    await saveUsdcDeposit(db, recordOf({ logIndex: 0 }), { salt: "a" });
    await saveUsdcDeposit(db, recordOf({ logIndex: 1 }), { salt: "b" });
    await db.execute(sql`
      INSERT INTO donations (trx_id, donor_name, amount_idr, salt, status, payment_method)
      VALUES ('USDC-LAMA-1', 'Muzakki Web3', 16200000, 'lama', 'PAID', 'USDC')
    `);

    const report = await verifyUsdcDepositIdentity(db);
    expect(report.migrated).toBe(true);
    expect(report.totalUsdcRows).toBe(3);
    expect(report.identified).toBe(2);
    expect(report.unverified).toBe(1);
    expect(report.unverifiedReferences).toEqual(["USDC-LAMA-1"]);
  });

  it("does not count a fiat row as a USDC deposit", async () => {
    await applyUsdcDepositMigration(db);
    await db.execute(sql`
      INSERT INTO donations (trx_id, donor_name, amount_idr, salt, status, payment_method)
      VALUES ('TRX-1', 'Donatur', 250000, 'x', 'PAID', 'QRIS')
    `);
    expect((await verifyUsdcDepositIdentity(db)).totalUsdcRows).toBe(0);
  });
});

/**
 * Reading donations on a deployment that has the code but not the columns.
 *
 * Drizzle names every column of the model in its `SELECT`, so adding five
 * columns to the model breaks *every* read of `donations` on an unmigrated
 * database - internal reconciliation, the period report, the evidence sources.
 * That is the failure this ticket's own runbook promises cannot happen, and it
 * would only show up in production, after a deploy, on a table nobody migrated.
 */
describe("reading donations across the migration boundary", () => {
  it("refuses to name columns the database does not have", async () => {
    const legacy = await unmigratedDatabase();
    try {
      // The projection this ticket adds, chosen from what the catalog says.
      const rowsRead = await legacy.db
        .select(donationSelection(false))
        .from(schema.donations);
      expect(rowsRead).toEqual([]);
    } finally {
      await legacy.close();
    }
  });

  it("reads the native columns once they exist", async () => {
    await applyUsdcDepositMigration(db);
    await saveUsdcDeposit(db, recordOf({ amountUSDC: 500_000n }), { salt: "s" });

    const [row] = await db.select(donationSelection(true)).from(schema.donations);
    expect((row as any).amountUsdc6dp).toBe("500000");
    expect((row as any).depositTxHash).toBe(TX);
  });

  it("still returns every pre-existing column on an unmigrated database", async () => {
    const legacy = await unmigratedDatabase();
    try {
      await saveUsdcDeposit(legacy.db, recordOf(), { salt: "s" });
      const [row] = await legacy.db.select(donationSelection(false)).from(schema.donations);

      // The columns every other reader depends on are all still there.
      for (const field of ["trxId", "donorName", "amountIDR", "salt", "status", "paymentMethod", "batchId", "createdAt"]) {
        expect(row, field).toHaveProperty(field);
      }
      // And the ones the database cannot answer for are simply absent.
      expect(row).not.toHaveProperty("amountUsdc6dp");
    } finally {
      await legacy.close();
    }
  });
});

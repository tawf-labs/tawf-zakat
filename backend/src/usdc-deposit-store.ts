/**
 * Where a USDC deposit is kept, and what the database enforces about it
 * (ticket #67).
 *
 * The adapter half of `usdc-deposit-intake`: it knows SQL, the schema this
 * deployment actually has, and nothing about what a deposit means.
 *
 * Three decisions live here.
 *
 * **The migration is additive and explicit.** `ADD COLUMN IF NOT EXISTS` only;
 * it alters no existing column and rewrites no existing row. It is deliberately
 * *not* run at boot: #66 deploys without migrations, and a schema change that
 * arrives as a side effect of a deployment is exactly what this ticket was
 * carved out of #55 and #66 to avoid. An operator runs it, having read the
 * runbook.
 *
 * **The write path works on both sides of that migration.** A deployment can
 * legitimately have the code and not the columns. Refusing to record the deposit
 * there would lose it entirely; writing the amount into a column that does not
 * exist would fail every intake. So the columns are probed once and the insert
 * degrades to the legacy shape, with the caller told which happened.
 *
 * **Identity is unique in the database, not merely in the caller.** A partial
 * unique index over (chain, contract, transaction, log) means a second row
 * claiming one deposit is refused by PostgreSQL, whichever code path wrote it.
 * Legacy rows carry no identity and are excluded from the index rather than
 * colliding with each other on a shared NULL.
 */

import { sql } from "drizzle-orm";
import * as schema from "./db/schema";
import type { DepositIntakeRecord } from "./usdc-deposit-intake";

/** Any Drizzle PostgreSQL handle that can run a statement. */
export type DepositDatabase = { execute: (query: any) => Promise<any> };

/** Rows out of a driver result, whichever shape this driver returns them in. */
export const rowsOf = (result: any): any[] =>
  Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];

/** The columns this ticket adds. All of them, or the deployment is unmigrated. */
export const NATIVE_DEPOSIT_COLUMNS = [
  "amount_usdc_6dp",
  "deposit_chain_id",
  "deposit_contract",
  "deposit_tx_hash",
  "deposit_log_index",
] as const;

/**
 * The dev migration, as one ordered list.
 *
 * `amount_usdc_6dp` is TEXT rather than a numeric column on purpose: the amount
 * is a decimal integer that must survive a driver, and the drivers in this
 * project hand back `bigint` columns as JavaScript numbers.
 */
export const USDC_DEPOSIT_MIGRATION_STATEMENTS = [
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS amount_usdc_6dp TEXT`,
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS deposit_chain_id INTEGER`,
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS deposit_contract TEXT`,
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS deposit_tx_hash TEXT`,
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS deposit_log_index INTEGER`,
  // Partial, so the rows that carry no identity are not all competing for one
  // NULL tuple. Two deposits in the same transaction differ by log index.
  `CREATE UNIQUE INDEX IF NOT EXISTS donations_deposit_identity
     ON donations (deposit_chain_id, deposit_contract, deposit_tx_hash, deposit_log_index)
     WHERE deposit_tx_hash IS NOT NULL`,
] as const;

export async function applyUsdcDepositMigration(db: DepositDatabase): Promise<void> {
  for (const statement of USDC_DEPOSIT_MIGRATION_STATEMENTS) {
    await db.execute(sql.raw(statement));
  }
}

export async function hasNativeDepositColumns(db: DepositDatabase): Promise<boolean> {
  const found = rowsOf(
    await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'donations'
    `)
  ).map((row: any) => String(row.column_name));
  return NATIVE_DEPOSIT_COLUMNS.every((column) => found.includes(column));
}

/**
 * Which columns a `donations` read may name (ticket #67).
 *
 * Drizzle names every column of the model in its `SELECT`, so the five columns
 * this ticket adds to the model would break *every* read of `donations` on a
 * deployment that has the code and not the migration - internal reconciliation,
 * the period report, the evidence sources, all of them, with `column does not
 * exist`. Since running the migration is deliberately a separate act from
 * deploying the code, that deployment is a state this project has to support
 * rather than a mistake to warn about.
 *
 * So the projection is chosen from what the catalog actually says. Every column
 * that existed before is always named; the deposit columns are named only where
 * they exist, and a caller that reads them back gets `undefined` rather than a
 * failed query.
 */
export const donationSelection = (migrated: boolean) => ({
  id: schema.donations.id,
  trxId: schema.donations.trxId,
  donorName: schema.donations.donorName,
  isAnonymous: schema.donations.isAnonymous,
  amountIDR: schema.donations.amountIDR,
  salt: schema.donations.salt,
  status: schema.donations.status,
  paymentMethod: schema.donations.paymentMethod,
  qrString: schema.donations.qrString,
  qrUrl: schema.donations.qrUrl,
  batchId: schema.donations.batchId,
  createdAt: schema.donations.createdAt,
  paidAt: schema.donations.paidAt,
  ...(migrated
    ? {
        amountUsdc6dp: schema.donations.amountUsdc6dp,
        depositChainId: schema.donations.depositChainId,
        depositContract: schema.donations.depositContract,
        depositTxHash: schema.donations.depositTxHash,
        depositLogIndex: schema.donations.depositLogIndex,
      }
    : {}),
});

export type DepositSaveOutcome = {
  /** `INSERTED` on first sight, `UNCHANGED` when the deposit was already held. */
  stored: "INSERTED" | "UNCHANGED";
  /** False on a deployment whose ledger cannot yet hold a deposit identity. */
  identityPreserved: boolean;
};

/**
 * Records one deposit, at most once.
 *
 * `ON CONFLICT DO NOTHING` rather than an upsert, deliberately: by the time an
 * event is reprocessed the row may have been batched, paid or corrected, and
 * rewriting it from the event would undo work the row has since acquired. The
 * event's facts do not change, so there is nothing to update.
 *
 * `amount_idr` is `0`, which is a fact - a USDC deposit contributed no rupiah -
 * where the old estimate at a hardcoded rate was a guess presented as a figure.
 */
export async function saveUsdcDeposit(
  db: DepositDatabase,
  record: DepositIntakeRecord,
  options: { salt: string; migrated?: boolean }
): Promise<DepositSaveOutcome> {
  const migrated = options.migrated ?? (await hasNativeDepositColumns(db));
  const occurredAt = new Date(record.occurredAt);

  const columns = migrated
    ? sql`, amount_usdc_6dp, deposit_chain_id, deposit_contract, deposit_tx_hash, deposit_log_index`
    : sql``;
  const values = migrated
    ? sql`, ${record.amountUsdc6dp}, ${record.identity.chainId}, ${record.identity.contract},
          ${record.identity.txHash}, ${record.identity.logIndex}`
    : sql``;

  const inserted = rowsOf(
    await db.execute(sql`
      INSERT INTO donations
        (trx_id, donor_name, is_anonymous, amount_idr, salt, status, payment_method,
         created_at, paid_at${columns})
      VALUES
        (${record.trxId}, ${record.donorName}, ${record.isAnonymous}, 0, ${options.salt},
         'PAID', 'USDC', ${occurredAt}, ${occurredAt}${values})
      ON CONFLICT DO NOTHING
      RETURNING id
    `)
  );

  return {
    stored: inserted.length > 0 ? "INSERTED" : "UNCHANGED",
    identityPreserved: migrated,
  };
}

export type DepositIdentityReport = {
  migrated: boolean;
  totalUsdcRows: number;
  /** Rows carrying a provable on-chain identity. `null` before the migration. */
  identified: number | null;
  /** Rows that cannot be paired with an event. Never guessed into shape. */
  unverified: number;
  /** Their `trx_id`s, so an operator can look at them rather than a count. */
  unverifiedReferences: string[];
};

/**
 * What this deployment's deposit ledger actually holds.
 *
 * Reported rather than repaired. A row with no identity stays a row with no
 * identity: its estimated rupiah, its timestamp and its truncated donor address
 * cannot prove which deposit it was, and inventing a pairing from them would
 * turn an honest gap into a false reconciliation.
 */
export async function verifyUsdcDepositIdentity(
  db: DepositDatabase
): Promise<DepositIdentityReport> {
  const migrated = await hasNativeDepositColumns(db);

  const usdcRows = rowsOf(
    await db.execute(
      migrated
        ? sql`SELECT trx_id, deposit_tx_hash, amount_usdc_6dp FROM donations
              WHERE payment_method = 'USDC' ORDER BY id ASC`
        : sql`SELECT trx_id FROM donations WHERE payment_method = 'USDC' ORDER BY id ASC`
    )
  );

  const isIdentified = (row: any) =>
    migrated && Boolean(row.deposit_tx_hash) && Boolean(row.amount_usdc_6dp);

  const unidentified = usdcRows.filter((row) => !isIdentified(row));

  return {
    migrated,
    totalUsdcRows: usdcRows.length,
    identified: migrated ? usdcRows.length - unidentified.length : null,
    unverified: unidentified.length,
    unverifiedReferences: unidentified.map((row) => String(row.trx_id)),
  };
}

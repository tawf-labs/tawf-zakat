/**
 * A deposit from event to verdict (ticket #67).
 *
 * The claim this file exists to make, and the one no unit test can make on its
 * own: the rows the intake path actually writes reconcile against the events
 * they came from. Every earlier test in this ticket either hand-writes a ledger
 * row or hand-writes an event; here the ledger rows are produced by the real
 * intake boundary, stored by the real writer into a real PostgreSQL, and then
 * compared over HTTP by the real mapper and the real engine.
 *
 * Nothing is stubbed except the clock and the `eth_call` transport, and no
 * transaction is ever sent: the events are the indexed mirror, which is what the
 * comparison reads in production too.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { createEvidenceStore, type EvidenceStore } from "../src/evidence-store";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { createInternalLedgerReader } from "../src/internal-ledger-reader";
import { readDepositIntake } from "../src/usdc-deposit-intake";
import { applyUsdcDepositMigration, saveUsdcDeposit, verifyUsdcDepositIdentity } from "../src/usdc-deposit-store";
import { USDC_DEPOSIT_STREAM } from "../src/internal-usdc-source";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import type { EthCall } from "../src/account-signature";

const WORKSPACE = "http://localhost:3001/api/workspace";
const EVIDENCE = "http://localhost:3001/api/evidence";
const SINAR = "lpz-sinar-amanah";

const CHAIN_ID = 421614;
const CONTRACT = "0x0d6cec28a574aca41b879767b081f6f2b4e9a849";
const INDEXER_KEY = `${CHAIN_ID}:${CONTRACT}`;
const DONOR = "0x1234567890abcdef1234567890abcdef12345678";

const txOf = (nibble: string) => `0x${nibble.repeat(64)}`;

const officer = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
const NOW = 1_800_000_000;

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let evidence: EvidenceStore;
let clock = NOW;

const ethCall: EthCall = async () => "0x";
const request = (url: string, init: RequestInit = {}) => app.fetch(new Request(url, init));

const LEDGER_SCHEMA = [
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS salt TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'QRIS'`,
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS batch_id INTEGER`,
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP`,
  `CREATE TABLE IF NOT EXISTS onchain_events (
     id SERIAL PRIMARY KEY, tx_hash TEXT NOT NULL, block_number INTEGER NOT NULL,
     log_index INTEGER NOT NULL DEFAULT 0, event_name TEXT NOT NULL,
     contract_address TEXT NOT NULL, args_json TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS indexer_state (
     id SERIAL PRIMARY KEY, indexer_key TEXT NOT NULL UNIQUE,
     last_indexed_block INTEGER NOT NULL DEFAULT 0, last_sync_at TIMESTAMP DEFAULT NOW(),
     status TEXT NOT NULL DEFAULT 'SYNCING', total_events_indexed INTEGER NOT NULL DEFAULT 0)`,
];

/** One deposit, as it reaches the indexer: an ABI-decoded `bigint` and a log. */
type Deposit = { txHash: string; logIndex: number; blockNumber: number; amount: bigint };

/**
 * Writes the event to the indexed mirror and runs the deposit through the real
 * intake path, exactly as `processEvent` does.
 */
async function indexDeposit(deposit: Deposit, options: { toLedger?: boolean } = {}) {
  const db = database.handle();
  await db.execute(sql`
    INSERT INTO onchain_events (tx_hash, block_number, log_index, event_name, contract_address, args_json)
    VALUES (${deposit.txHash}, ${deposit.blockNumber}, ${deposit.logIndex}, 'USDCDeposited', ${CONTRACT},
            ${JSON.stringify({ donor: DONOR, amountUSDC: deposit.amount.toString(), isAnonymous: false })})
  `);

  if (options.toLedger === false) return null;

  const read = readDepositIntake({
    chainId: CHAIN_ID,
    contract: CONTRACT,
    txHash: deposit.txHash,
    logIndex: deposit.logIndex,
    blockNumber: deposit.blockNumber,
    // The `bigint` the ABI decoder produces, not a number.
    amountUSDC: deposit.amount,
    donor: DONOR,
    isAnonymous: false,
    occurredAt: "2024-06-01T00:00:00.000Z",
  });
  if ("error" in read) throw new Error(read.error);
  return saveUsdcDeposit(db, read.record, { salt: `salt-${deposit.txHash}-${deposit.logIndex}` });
}

async function signIn(): Promise<string> {
  const minted = await request(`${WORKSPACE}/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ institutionId: SINAR, account: officer.address }),
  });
  const { challenge, typedData } = await minted.json();
  const signature = await officer.signTypedData({
    ...typedData,
    message: {
      ...typedData.message,
      issuedAt: BigInt(typedData.message.issuedAt),
      expiresAt: BigInt(typedData.message.expiresAt),
    },
  } as never);
  const session = await request(`${WORKSPACE}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonce: challenge.nonce, signature }),
  });
  return (await session.json()).token as string;
}

const examine = async (token: string, label: string) => {
  const response = await request(EVIDENCE, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      label,
      period: { kind: "AKHIR_TAHUN", year: 2024 },
      currencyUnit: "USDC_6DP",
      balanceSheetScope: "ON",
      claim: { internal: { stream: USDC_DEPOSIT_STREAM } },
      source: { internal: { stream: USDC_DEPOSIT_STREAM } },
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()).preparation;
};

beforeAll(async () => {
  database = await createTestWorkspaceDatabase();
  const db = database.handle();
  for (const statement of LEDGER_SCHEMA) await db.execute(sql.raw(statement));
  await applyUsdcDepositMigration(db);

  store = createWorkspaceStore(db);
  evidence = createEvidenceStore(db);
  await store.ensureSchema();
  await evidence.ensureSchema();
});

afterAll(async () => {
  resetWorkspace();
  await database.close();
});

beforeEach(async () => {
  clock = NOW;
  await database.reset();
  const db = database.handle();
  await db.execute(sql`DELETE FROM donations WHERE payment_method = 'USDC'`);
  await db.execute(sql`DELETE FROM onchain_events`);
  await db.execute(sql`DELETE FROM indexer_state`);
  await db.execute(sql`
    INSERT INTO indexer_state (indexer_key, last_indexed_block, status)
    VALUES (${INDEXER_KEY}, 1000, 'SYNCED')
  `);

  configureWorkspace({
    store,
    evidence,
    internalLedger: createInternalLedgerReader(db, {
      chainId: CHAIN_ID,
      contract: CONTRACT,
      indexerKey: INDEXER_KEY,
    }),
    ethCall,
    now: () => clock,
    challengeTtlSeconds: 300,
    sessionTtlSeconds: 3600,
  });

  for (const institution of SYNTHETIC_INSTITUTIONS) {
    await store.upsertInstitution(institutionRecordOf(institution));
  }
  await store.upsertMembership({ institutionId: SINAR, account: officer.address, role: "OFFICER" });
});

describe("what the intake path writes reconciles against the chain", () => {
  it("balances a population it recorded itself, at every scale", async () => {
    await indexDeposit({ txHash: txOf("a"), logIndex: 0, blockNumber: 100, amount: 500_000n });
    await indexDeposit({ txHash: txOf("b"), logIndex: 0, blockNumber: 110, amount: 1_000_000n });
    await indexDeposit({ txHash: txOf("c"), logIndex: 0, blockNumber: 120, amount: 1_500_000n });
    // Two deposits inside one transaction.
    await indexDeposit({ txHash: txOf("d"), logIndex: 0, blockNumber: 130, amount: 2_500_000n });
    await indexDeposit({ txHash: txOf("d"), logIndex: 1, blockNumber: 130, amount: 7_500_000n });

    const preparation = await examine(await signIn(), "Deposit USDC 2024");

    expect(preparation.outcome).toBe("RECONCILED");
    expect(preparation.result.balanced).toBe(true);
    expect(preparation.result.entryCounts).toEqual({ claim: 5, source: 5, matched: 5 });
    expect(preparation.findings).toEqual([]);
  });

  it("keeps an amount past double precision equal on both sides", async () => {
    const huge = 123_456_789_012_345_678_901_234_567_890n;
    await indexDeposit({ txHash: txOf("a"), logIndex: 0, blockNumber: 100, amount: huge });

    const preparation = await examine(await signIn(), "Deposit besar");
    expect(preparation.result.balanced).toBe(true);
    const row = preparation.sources.find((side: any) => side.role === "CLAIM").rows[0];
    expect(row.amount).toBe(huge.toString());
  });

  it("does not double count a deposit whose event is processed again", async () => {
    const deposit = { txHash: txOf("a"), logIndex: 0, blockNumber: 100, amount: 1_000_000n };
    expect((await indexDeposit(deposit))!.stored).toBe("INSERTED");

    // The same log, delivered twice: a restart, a duplicate delivery, a replay.
    await database.handle().execute(sql`DELETE FROM onchain_events WHERE log_index = 0`);
    expect((await indexDeposit(deposit))!.stored).toBe("UNCHANGED");

    const preparation = await examine(await signIn(), "Deposit diproses ulang");
    expect(preparation.result.entryCounts).toEqual({ claim: 1, source: 1, matched: 1 });
    expect(preparation.findings.some((f: any) => f.kind === "DUPLICATE_KEY")).toBe(false);
  });

  it("reports a deposit the ledger never received as missing on the claim side", async () => {
    await indexDeposit({ txHash: txOf("a"), logIndex: 0, blockNumber: 100, amount: 1_000_000n });
    await indexDeposit(
      { txHash: txOf("b"), logIndex: 0, blockNumber: 110, amount: 2_000_000n },
      { toLedger: false }
    );

    const preparation = await examine(await signIn(), "Deposit belum masuk ledger");
    const missing = preparation.findings.filter((f: any) => f.kind === "MISSING_IN_CLAIM");
    expect(missing).toHaveLength(1);
    expect(missing[0].deltaUnit).toBe("USDC_6DP");
  });

  it("reports a ledger row whose amount was later altered as a mismatch", async () => {
    await indexDeposit({ txHash: txOf("a"), logIndex: 0, blockNumber: 100, amount: 1_000_000n });
    // Standing in for a hand edit or a bad correction; the chain is unchanged.
    await database.handle().execute(
      sql`UPDATE donations SET amount_usdc_6dp = '1500000' WHERE deposit_tx_hash = ${txOf("a")}`
    );

    const preparation = await examine(await signIn(), "Deposit diubah");
    const [mismatch] = preparation.findings.filter((f: any) => f.kind === "AMOUNT_MISMATCH");
    expect(mismatch.deltaAmount).toBe("500000");
    expect(mismatch.deltaUnit).toBe("USDC_6DP");
  });
});

describe("historical rows the migration cannot pair", () => {
  beforeEach(async () => {
    await database.handle().execute(sql`
      INSERT INTO donations (trx_id, donor_name, amount_idr, salt, status, payment_method)
      VALUES ('USDC-20240101-1234', 'Muzakki Web3', 16200000, 'lama', 'PAID', 'USDC')
    `);
  });

  it("counts them as unverified rather than backfilling them from an estimate", async () => {
    const report = await verifyUsdcDepositIdentity(database.handle());
    expect(report.unverified).toBe(1);
    expect(report.unverifiedReferences).toEqual(["USDC-20240101-1234"]);
  });

  it("keeps them out of the comparison and names them in the package", async () => {
    await indexDeposit({ txHash: txOf("a"), logIndex: 0, blockNumber: 100, amount: 1_000_000n });

    const preparation = await examine(await signIn(), "Deposit dengan baris lama");
    expect(preparation.result.balanced).toBe(true);

    const claim = preparation.sources.find((side: any) => side.role === "CLAIM");
    expect(claim.rowCount).toBe(1);
    expect(claim.unverified).toHaveLength(1);
    expect(claim.unverified[0].reference).toBe("USDC-20240101-1234");
    // The rate-derived estimate never becomes an amount anywhere in the package.
    expect(JSON.stringify(preparation.snapshot)).not.toContain("16200000");
  });
});

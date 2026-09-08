/**
 * Choosing an internal USDC source, over the HTTP it is actually used on
 * (Spec #68, ticket #79).
 *
 * The ledger, the indexed events, the indexer checkpoint, the mapper, the
 * reconciliation engine, the snapshot format, the commitment and the isolated
 * PostgreSQL are all the real ones. Only the clock and the `eth_call` transport
 * are substituted, and neither decides an outcome.
 *
 * The claims under test:
 *
 * - Before #67 lands, the internal USDC *claim* side says so and names the rows
 *   it therefore could not examine. The chain side is still read, and other
 *   structured sources are untouched.
 * - Once the native amount and event identity exist, the two sides reconcile per
 *   deposit: matched, mismatched, missing on either side, and duplicated.
 * - The frozen package keeps answering with the blocks it was examined against,
 *   however far the indexer moves afterwards.
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
import { depositKeyOf, USDC_DEPOSIT_BUCKET, USDC_DEPOSIT_STREAM } from "../src/internal-usdc-source";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import type { EthCall } from "../src/account-signature";

const WORKSPACE = "http://localhost:3001/api/workspace";
const EVIDENCE = "http://localhost:3001/api/evidence";
const SINAR = "lpz-sinar-amanah";

const CHAIN_ID = 421614;
const CONTRACT = "0x0d6cec28a574aca41b879767b081f6f2b4e9a849";
const INDEXER_KEY = `${CHAIN_ID}:${CONTRACT}`;

const officer = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
const NOW = 1_800_000_000;

const txOf = (nibble: string) => `0x${nibble.repeat(64)}`;
const TX_MATCH = txOf("a");
const TX_MISMATCH = txOf("b");
const TX_ONLY_CHAIN = txOf("c");
const TX_ONLY_LEDGER = txOf("d");
const TX_PAIR = txOf("e");

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let evidence: EvidenceStore;
let clock = NOW;
/** Flipped per test to stand for a deployment where #67 has not landed. */
let nativeColumns = false;

const ethCall: EthCall = async () => "0x";

const request = (url: string, init: RequestInit = {}) => app.fetch(new Request(url, init));
const get = (url: string, token: string) =>
  request(url, { headers: { Authorization: `Bearer ${token}` } });
const post = (url: string, body: unknown, token: string) =>
  request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

/** The ledger tables a real deployment already holds, in this test's own database. */
const LEDGER_SCHEMA = [
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'QRIS'`,
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  `CREATE TABLE IF NOT EXISTS onchain_events (
     id SERIAL PRIMARY KEY, tx_hash TEXT NOT NULL, block_number INTEGER NOT NULL,
     log_index INTEGER NOT NULL DEFAULT 0, event_name TEXT NOT NULL,
     contract_address TEXT NOT NULL, args_json TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS indexer_state (
     id SERIAL PRIMARY KEY, indexer_key TEXT NOT NULL UNIQUE,
     last_indexed_block INTEGER NOT NULL DEFAULT 0, last_sync_at TIMESTAMP DEFAULT NOW(),
     status TEXT NOT NULL DEFAULT 'SYNCING', total_events_indexed INTEGER NOT NULL DEFAULT 0)`,
];

/** The columns #67 owns. Added and dropped here only, never by this ticket's code. */
const NATIVE_COLUMNS = [
  "amount_usdc_6dp TEXT",
  "deposit_chain_id INTEGER",
  "deposit_contract TEXT",
  "deposit_tx_hash TEXT",
  "deposit_log_index INTEGER",
];

async function setNativeColumns(present: boolean): Promise<void> {
  const db = database.handle();
  for (const column of NATIVE_COLUMNS) {
    const name = column.split(" ")[0]!;
    await db.execute(
      sql.raw(
        present
          ? `ALTER TABLE donations ADD COLUMN IF NOT EXISTS ${column}`
          : `ALTER TABLE donations DROP COLUMN IF EXISTS ${name}`
      )
    );
  }
  nativeColumns = present;
}

async function recordEvent(
  txHash: string,
  logIndex: number,
  blockNumber: number,
  amountUSDC: string,
  contract = CONTRACT
): Promise<void> {
  await database.handle().execute(sql`
    INSERT INTO onchain_events (tx_hash, block_number, log_index, event_name, contract_address, args_json)
    VALUES (${txHash}, ${blockNumber}, ${logIndex}, 'USDCDeposited', ${contract},
            ${JSON.stringify({ donor: "0x" + "1".repeat(40), amountUSDC, isAnonymous: false })})
  `);
}

async function recordLedgerRow(
  trxId: string,
  options: { amountUsdc?: string; txHash?: string; logIndex?: number; amountIDR?: number } = {}
): Promise<void> {
  const db = database.handle();
  await db.execute(sql`
    INSERT INTO donations (trx_id, donor_name, amount_idr, status, payment_method)
    VALUES (${trxId}, 'Muzakki Web3', ${options.amountIDR ?? 16_200}, 'PAID', 'USDC')
  `);
  if (!nativeColumns || options.amountUsdc === undefined) return;
  await db.execute(sql`
    UPDATE donations SET amount_usdc_6dp = ${options.amountUsdc}, deposit_chain_id = ${CHAIN_ID},
      deposit_contract = ${CONTRACT}, deposit_tx_hash = ${options.txHash ?? null},
      deposit_log_index = ${options.logIndex ?? 0}
    WHERE trx_id = ${trxId}
  `);
}

async function setCheckpoint(lastIndexedBlock: number, status = "SYNCED"): Promise<void> {
  await database.handle().execute(sql`
    INSERT INTO indexer_state (indexer_key, last_indexed_block, status)
    VALUES (${INDEXER_KEY}, ${lastIndexedBlock}, ${status})
    ON CONFLICT (indexer_key) DO UPDATE SET last_indexed_block = ${lastIndexedBlock}, status = ${status}
  `);
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

const internalPreparation = (label: string) => ({
  label,
  period: { kind: "AKHIR_TAHUN", year: 2024 },
  currencyUnit: "USDC_6DP",
  balanceSheetScope: "ON",
  claim: { internal: { stream: USDC_DEPOSIT_STREAM } },
  source: { internal: { stream: USDC_DEPOSIT_STREAM } },
});

beforeAll(async () => {
  database = await createTestWorkspaceDatabase();
  const db = database.handle();
  for (const statement of LEDGER_SCHEMA) await db.execute(sql.raw(statement));

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
  await setNativeColumns(false);

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

describe("before #67: the internal USDC claim side is not yet supported", () => {
  it("offers the stream, reads the chain side, and names the rows it cannot examine", async () => {
    await setCheckpoint(1000);
    await recordEvent(TX_MATCH, 0, 500, "1500000");
    await recordLedgerRow("USDC-HISTORIS-1", { amountIDR: 24_300_000 });

    const token = await signIn();
    const listed = await (await get(`${EVIDENCE}/internal-sources`, token)).json();

    const stream = listed.streams[0];
    expect(stream.stream).toBe(USDC_DEPOSIT_STREAM);
    expect(stream.bucket).toBe(USDC_DEPOSIT_BUCKET);
    expect(stream.chainScope.checkpoint.lastIndexedBlock).toBe(1000);
    expect(stream.chainScope.blockHashes).toBe("NOT_RETAINED");

    const claim = stream.sides.find((side: any) => side.role === "CLAIM");
    expect(claim.status).toBe("MISSING");
    expect(claim.detail).toContain("#67");
    expect(claim.unverified).toHaveLength(1);
    expect(claim.unverified[0].reference).toBe("USDC-HISTORIS-1");

    const source = stream.sides.find((side: any) => side.role === "SOURCE");
    expect(source.status).toBe("READ");
    expect(source.rowCount).toBe(1);
  });

  it("freezes a package that says INCOMPLETE and never estimates the missing side", async () => {
    await setCheckpoint(1000);
    await recordEvent(TX_MATCH, 0, 500, "1500000");
    await recordLedgerRow("USDC-HISTORIS-1", { amountIDR: 24_300_000 });

    const token = await signIn();
    const response = await post(EVIDENCE, internalPreparation("Deposit USDC 2024"), token);
    expect(response.status).toBe(201);

    const { preparation } = await response.json();
    expect(preparation.outcome).toBe("INCOMPLETE");
    expect(preparation.result).toBeNull();

    const notes = preparation.snapshot.coverageNotes.join("\n");
    expect(notes).toContain("belum terperiksa");
    expect(notes).toContain("checkpoint indexer");
    expect(notes).toContain("bukan seluruh ledger internal");
    // Not a claim of zero, and never the estimated rupiah.
    expect(JSON.stringify(preparation.snapshot)).not.toContain("24300000");
  });

  it("still accepts an ordinary structured source alongside, unchanged", async () => {
    const token = await signIn();
    const manifest = (role: "CLAIM" | "SOURCE") => ({
      label: `Rekap ${role}`,
      origin: "PASTE",
      scopeUnit: "LPZ Sinar Amanah",
      scopeLevel: "LEMBAGA",
      fundTypes: ["ZAKAT"],
      balanceSheet: "ON",
      currencyUnit: "IDR",
      period: { kind: "AKHIR_TAHUN", year: 2024 },
      cutOff: "2025-02-11T00:00:00.000Z",
      format: "baris-ledger",
      mappingVersion: "1",
      transactionDetail: "PRESENT",
    });
    const side = (role: "CLAIM" | "SOURCE") => ({
      manifest: manifest(role),
      status: "READ",
      rows: [
        { key: "pz-1", bucket: "ZAKAT", balanceSheet: "ON", value: { amount: "1000000", unit: "IDR" } },
      ],
    });

    const response = await post(
      EVIDENCE,
      {
        label: "Rekap rupiah",
        period: { kind: "AKHIR_TAHUN", year: 2024 },
        currencyUnit: "IDR",
        balanceSheetScope: "ON",
        claim: side("CLAIM"),
        source: side("SOURCE"),
      },
      token
    );

    expect(response.status).toBe(201);
    const { preparation } = await response.json();
    expect(preparation.outcome).toBe("RECONCILED");
    // A source with no unverified records carries no such field at all.
    expect(preparation.snapshot.sides[0].unverified).toBeUndefined();
  });
});

describe("with #67 in place: deposits reconcile one by one", () => {
  beforeEach(async () => {
    await setNativeColumns(true);
    await setCheckpoint(1000);

    // Matched, to the minor unit.
    await recordEvent(TX_MATCH, 0, 100, "500000");
    await recordLedgerRow("USDC-COCOK", { amountUsdc: "500000", txHash: TX_MATCH, logIndex: 0 });

    // Mismatched: the ledger says 1,5 USDC where the chain says exactly 1.
    await recordEvent(TX_MISMATCH, 0, 110, "1000000");
    await recordLedgerRow("USDC-BEDA", { amountUsdc: "1500000", txHash: TX_MISMATCH, logIndex: 0 });

    // On chain only.
    await recordEvent(TX_ONLY_CHAIN, 0, 120, "2000000");

    // In the ledger only.
    await recordLedgerRow("USDC-TANPA-EVENT", {
      amountUsdc: "3000000",
      txHash: TX_ONLY_LEDGER,
      logIndex: 0,
    });

    // Two deposits in one transaction, both matched, kept apart by log index.
    await recordEvent(TX_PAIR, 0, 130, "1000000");
    await recordEvent(TX_PAIR, 1, 130, "1500000");
    await recordLedgerRow("USDC-PASANGAN-A", { amountUsdc: "1000000", txHash: TX_PAIR, logIndex: 0 });
    await recordLedgerRow("USDC-PASANGAN-B", { amountUsdc: "1500000", txHash: TX_PAIR, logIndex: 1 });

    // A historical row that no migration could pair: no identity, no native amount.
    await recordLedgerRow("USDC-HISTORIS", { amountIDR: 8_100_000 });
  });

  it("reports matched, mismatched, and missing on each side, per deposit", async () => {
    const token = await signIn();
    const { preparation } = await (
      await post(EVIDENCE, internalPreparation("Deposit USDC 2024"), token)
    ).json();

    expect(preparation.outcome).toBe("RECONCILED");
    expect(preparation.result.entryCounts).toEqual({ claim: 5, source: 5, matched: 4 });

    const byKind = (kind: string) => preparation.findings.filter((f: any) => f.kind === kind);
    expect(byKind("AMOUNT_MISMATCH")).toHaveLength(1);
    expect(byKind("AMOUNT_MISMATCH")[0].deltaAmount).toBe("500000");
    expect(byKind("AMOUNT_MISMATCH")[0].deltaUnit).toBe("USDC_6DP");

    expect(byKind("MISSING_IN_CLAIM")).toHaveLength(1);
    expect(byKind("MISSING_IN_CLAIM")[0].key).toBe(
      depositKeyOf({ chainId: CHAIN_ID, contract: CONTRACT, txHash: TX_ONLY_CHAIN, logIndex: 0 })
    );
    expect(byKind("MISSING_IN_SOURCE")).toHaveLength(1);
    expect(byKind("MISSING_IN_SOURCE")[0].key).toBe(
      depositKeyOf({ chainId: CHAIN_ID, contract: CONTRACT, txHash: TX_ONLY_LEDGER, logIndex: 0 })
    );

    // The two deposits in one transaction both matched, and neither collided.
    expect(byKind("DUPLICATE_KEY")).toHaveLength(0);
  });

  it("keeps the unpairable historical row as unverified, out of the comparison", async () => {
    const token = await signIn();
    const { preparation } = await (
      await post(EVIDENCE, internalPreparation("Deposit USDC 2024"), token)
    ).json();

    const claim = preparation.sources.find((side: any) => side.role === "CLAIM");
    expect(claim.status).toBe("READ");
    expect(claim.unverified).toHaveLength(1);
    expect(claim.unverified[0].reference).toBe("USDC-HISTORIS");
    expect(preparation.publicSummary.sides.find((s: any) => s.role === "CLAIM").unverifiedCount).toBe(1);
    // The rupiah estimate is not anywhere in the frozen bytes as an amount.
    expect(JSON.stringify(preparation.snapshot)).not.toContain("8100000");
  });

  it("reports a duplicated pairing as a duplicate rather than silently choosing one", async () => {
    await recordLedgerRow("USDC-COCOK-GANDA", {
      amountUsdc: "500000",
      txHash: TX_MATCH,
      logIndex: 0,
    });

    const token = await signIn();
    const { preparation } = await (
      await post(EVIDENCE, internalPreparation("Deposit USDC ganda"), token)
    ).json();

    expect(preparation.findings.some((f: any) => f.kind === "DUPLICATE_KEY")).toBe(true);
  });

  it("binds chain, contract, transaction, log index, block and checkpoint into the snapshot", async () => {
    const token = await signIn();
    const { preparation } = await (
      await post(EVIDENCE, internalPreparation("Deposit USDC 2024"), token)
    ).json();

    const source = preparation.snapshot.sides.find((s: any) => s.manifest.role === "SOURCE");
    expect(source.manifest.chainScope).toMatchObject({
      chainId: CHAIN_ID,
      contract: CONTRACT,
      indexerKey: INDEXER_KEY,
      fromBlock: 0,
      toBlock: 1000,
      blockHashes: "NOT_RETAINED",
    });
    expect(source.manifest.chainScope.observed).toEqual({
      firstBlock: 100,
      lastBlock: 130,
      eventCount: 5,
    });
    expect(source.manifest.chainScope.checkpoint.lastIndexedBlock).toBe(1000);

    const row = source.rows.find((r: any) => r.origin.txHash === TX_MATCH);
    expect(row.origin).toEqual({
      chainId: CHAIN_ID,
      contract: CONTRACT,
      txHash: TX_MATCH,
      logIndex: 0,
      blockNumber: 100,
      blockHash: null,
    });
    expect(row.unit).toBe("USDC_6DP");
    // Never mixed with rupiah.
    expect(preparation.snapshot.currencyUnit).toBe("USDC_6DP");
  });

  it("keeps a frozen package unchanged after the indexer moves on", async () => {
    const token = await signIn();
    const { preparation } = await (
      await post(EVIDENCE, internalPreparation("Deposit USDC 2024"), token)
    ).json();

    await recordEvent(txOf("f"), 0, 2000, "9000000");
    await setCheckpoint(3000);

    const reopened = await (await get(`${EVIDENCE}/${preparation.id}`, token)).json();
    expect(reopened.commitmentVerified).toBe(true);
    expect(reopened.preparation.snapshot).toEqual(preparation.snapshot);
    expect(reopened.preparation.findings).toEqual(preparation.findings);

    // A fresh examination does see the new block; the stored one never does.
    const { preparation: later } = await (
      await post(EVIDENCE, internalPreparation("Deposit USDC 2024 - ulang"), token)
    ).json();
    const scopeOf = (p: any) =>
      p.snapshot.sides.find((s: any) => s.manifest.role === "SOURCE").manifest.chainScope;
    expect(scopeOf(later).toBlock).toBe(3000);
    expect(scopeOf(later).observed.lastBlock).toBe(2000);
  });

  it("stops at the checkpoint even when asked for a later block", async () => {
    const token = await signIn();
    const { preparation } = await (
      await post(
        EVIDENCE,
        {
          ...internalPreparation("Deposit USDC dibatasi"),
          source: { internal: { stream: USDC_DEPOSIT_STREAM, fromBlock: 105, toBlock: 9_999_999 } },
        },
        token
      )
    ).json();

    const scope = preparation.snapshot.sides.find((s: any) => s.manifest.role === "SOURCE").manifest
      .chainScope;
    expect(scope.fromBlock).toBe(105);
    expect(scope.toBlock).toBe(1000);
    expect(scope.observed.firstBlock).toBe(110);
  });

  it("hands the package protocol a verdict, from the same snapshot bytes", async () => {
    const token = await signIn();
    const { preparation } = await (
      await post(EVIDENCE, internalPreparation("Deposit USDC 2024"), token)
    ).json();

    const review = await (await get(`${EVIDENCE}/${preparation.id}/reports/review`, token)).json();
    expect(review.blockers).toEqual([]);
    expect(review.figures.some((figure: any) => figure.name === `SOURCE.${USDC_DEPOSIT_BUCKET}.ON`)).toBe(
      true
    );
    expect(review.limitations.join("\n")).toContain("checkpoint indexer");
  });
});

describe("refusals", () => {
  it("refuses to examine a USDC deposit source in rupiah", async () => {
    await setCheckpoint(10);
    const token = await signIn();
    const response = await post(
      EVIDENCE,
      { ...internalPreparation("Salah unit"), currencyUnit: "IDR" },
      token
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.issues.some((i: any) => i.field === "currencyUnit")).toBe(true);
  });

  it("refuses an internal stream it does not have", async () => {
    await setCheckpoint(10);
    const token = await signIn();
    const response = await post(
      EVIDENCE,
      {
        ...internalPreparation("Stream asing"),
        source: { internal: { stream: "SOMETHING_ELSE" } },
      },
      token
    );

    expect(response.status).toBe(400);
    expect((await response.json()).issues.some((i: any) => i.field === "source.internal.stream")).toBe(
      true
    );
  });

  it("reports a deployment with no checkpoint as never indexed, not as up to date", async () => {
    const token = await signIn();
    const listed = await (await get(`${EVIDENCE}/internal-sources`, token)).json();
    expect(listed.streams[0].chainScope.checkpoint.status).toBe("NEVER_INDEXED");
    expect(listed.streams[0].chainScope.toBlock).toBe(0);
  });
});

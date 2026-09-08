/**
 * Choosing an internal USDC source, end to end (Spec #68, ticket #79).
 *
 *   bun src/scripts/demo-internal-usdc-source.ts
 *
 * Six deposits on chain, six rows in the ledger, and one of them off by half a
 * USDC. The amil picks the internal source, freezes it, gets a verdict, and then
 * the indexer moves on - and the frozen package still answers with the blocks it
 * was examined against.
 *
 * It runs against its own throwaway PostgreSQL (PGlite) in a temp directory, so
 * it needs no `DATABASE_URL`, touches no deployment, and leaves nothing behind.
 * Every request goes through the real HTTP app, the real mapper, and the real
 * reconciliation engine.
 *
 * The `donations` columns #67 owns are created here, in this demonstration's own
 * database, purely to show what the path does once they exist. Nothing in this
 * ticket's code creates them, and running this script authorizes no migration.
 *
 * The account is a published Anvil test key. It is worthless as a credential,
 * which is exactly what a demo account should be.
 */

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
// Set before loading the app: Bun may have loaded a deployment .env, but this
// demonstration must never install its database or indexer adapters.
process.env.NODE_ENV = "test";
const { default: app } = await import("../index");
import { createWorkspaceStore } from "../tenancy-store";
import { createEvidenceStore } from "../evidence-store";
import { configureWorkspace, resetWorkspace } from "../workspace-runtime";
import { createInternalLedgerReader } from "../internal-ledger-reader";
import { USDC_DEPOSIT_STREAM } from "../internal-usdc-source";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../fixtures/institutions";

const WORKSPACE = "http://localhost:3001/api/workspace";
const EVIDENCE = "http://localhost:3001/api/evidence";
const SINAR = "lpz-sinar-amanah";

const CHAIN_ID = 421614;
const CONTRACT = "0x0d6cec28a574aca41b879767b081f6f2b4e9a849";
const INDEXER_KEY = `${CHAIN_ID}:${CONTRACT}`;

/** Anvil account #1, published in every Ethereum toolchain. Not a credential. */
const OFFICER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const say = (line = "") => console.log(line);
const heading = (line: string) => say(`\n\x1b[1m${line}\x1b[0m`);

const txOf = (nibble: string) => `0x${nibble.repeat(64)}`;

/** Minor units to a readable USDC amount, without ever touching a float. */
function usdc(minorUnits: string): string {
  const value = BigInt(minorUnits);
  const whole = (value / 1_000_000n).toString();
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `,${fraction}` : ""} USDC`;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS donations (
     id SERIAL PRIMARY KEY, trx_id TEXT NOT NULL UNIQUE, donor_name TEXT NOT NULL,
     amount_idr BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
     payment_method TEXT NOT NULL DEFAULT 'QRIS', created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS onchain_events (
     id SERIAL PRIMARY KEY, tx_hash TEXT NOT NULL, block_number INTEGER NOT NULL,
     log_index INTEGER NOT NULL DEFAULT 0, event_name TEXT NOT NULL,
     contract_address TEXT NOT NULL, args_json TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS indexer_state (
     id SERIAL PRIMARY KEY, indexer_key TEXT NOT NULL UNIQUE,
     last_indexed_block INTEGER NOT NULL DEFAULT 0, last_sync_at TIMESTAMP DEFAULT NOW(),
     status TEXT NOT NULL DEFAULT 'SYNCING', total_events_indexed INTEGER NOT NULL DEFAULT 0)`,
  // #67's columns, created here only so this demonstration can show the path
  // working once that ticket lands.
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS amount_usdc_6dp TEXT`,
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS deposit_chain_id INTEGER`,
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS deposit_contract TEXT`,
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS deposit_tx_hash TEXT`,
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS deposit_log_index INTEGER`,
];

/** Chain amount, ledger amount. Where they differ, that is the point. */
const DEPOSITS = [
  { trxId: "USDC-2024-0001", tx: txOf("a"), log: 0, block: 100, chain: "500000", ledger: "500000" },
  { trxId: "USDC-2024-0002", tx: txOf("b"), log: 0, block: 110, chain: "1000000", ledger: "1500000" },
  { trxId: "USDC-2024-0003", tx: txOf("c"), log: 0, block: 120, chain: "1000000", ledger: "1000000" },
  // Two deposits inside one transaction, kept apart by their log index.
  { trxId: "USDC-2024-0004", tx: txOf("d"), log: 0, block: 130, chain: "2500000", ledger: "2500000" },
  { trxId: "USDC-2024-0005", tx: txOf("d"), log: 1, block: 130, chain: "7500000", ledger: "7500000" },
];

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "tawf-usdc-demo-"));
  const client = new PGlite(directory);
  const db = drizzle(client);

  for (const statement of SCHEMA) await db.execute(sql.raw(statement));

  const store = createWorkspaceStore(db);
  const evidence = createEvidenceStore(db);
  await store.ensureSchema();
  await evidence.ensureSchema();

  configureWorkspace({
    store,
    evidence,
    internalLedger: createInternalLedgerReader(db, {
      chainId: CHAIN_ID,
      contract: CONTRACT,
      indexerKey: INDEXER_KEY,
    }),
    ethCall: async () => "0x",
    now: () => Math.floor(Date.now() / 1000),
    challengeTtlSeconds: 300,
    sessionTtlSeconds: 3600,
  });

  for (const institution of SYNTHETIC_INSTITUTIONS) {
    await store.upsertInstitution(institutionRecordOf(institution));
  }
  const officer = privateKeyToAccount(OFFICER_KEY as Hex);
  await store.upsertMembership({ institutionId: SINAR, account: officer.address, role: "OFFICER" });

  const call = (url: string, init: RequestInit = {}) => app.fetch(new Request(url, init));
  const json = async (url: string, init: RequestInit = {}) => (await call(url, init)).json();

  try {
    heading("1. Ledger dan event terindeks pada deployment demonstrasi");
    await db.execute(sql`
      INSERT INTO indexer_state (indexer_key, last_indexed_block, status)
      VALUES (${INDEXER_KEY}, 1000, 'SYNCED')
    `);
    for (const deposit of DEPOSITS) {
      await db.execute(sql`
        INSERT INTO onchain_events (tx_hash, block_number, log_index, event_name, contract_address, args_json)
        VALUES (${deposit.tx}, ${deposit.block}, ${deposit.log}, 'USDCDeposited', ${CONTRACT},
                ${JSON.stringify({ donor: `0x${"1".repeat(40)}`, amountUSDC: deposit.chain, isAnonymous: false })})
      `);
      await db.execute(sql`
        INSERT INTO donations (trx_id, donor_name, amount_idr, status, payment_method,
          amount_usdc_6dp, deposit_chain_id, deposit_contract, deposit_tx_hash, deposit_log_index)
        VALUES (${deposit.trxId}, 'Muzakki Web3', 0, 'PAID', 'USDC',
                ${deposit.ledger}, ${CHAIN_ID}, ${CONTRACT}, ${deposit.tx}, ${deposit.log})
      `);
      const note = deposit.chain === deposit.ledger ? "" : `  <- ledger mencatat ${usdc(deposit.ledger)}`;
      say(`   blok ${deposit.block} log ${deposit.log}: ${usdc(deposit.chain)}${note}`);
    }
    // One historical row from before the identity columns existed. It carries an
    // estimated rupiah figure and nothing that can prove which deposit it is.
    await db.execute(sql`
      INSERT INTO donations (trx_id, donor_name, amount_idr, status, payment_method)
      VALUES ('USDC-LAMA-0001', 'Muzakki Web3', 16200000, 'PAID', 'USDC')
    `);
    say("   USDC-LAMA-0001: baris lama, hanya estimasi rupiah, tanpa identitas event");

    heading("2. Amil masuk ruang kerja dengan menandatangani tantangan");
    const { challenge, typedData } = await json(`${WORKSPACE}/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ institutionId: SINAR, account: officer.address }),
    });
    const signature = await officer.signTypedData({
      ...typedData,
      message: {
        ...typedData.message,
        issuedAt: BigInt(typedData.message.issuedAt),
        expiresAt: BigInt(typedData.message.expiresAt),
      },
    } as never);
    const session = await json(`${WORKSPACE}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce: challenge.nonce, signature }),
    });
    const token = session.token as string;
    const authorized = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    say(`   ${officer.address} masuk sebagai ${session.role} pada ${session.institutionId}`);

    heading("3. Memilih sumber internal, dengan batasnya terlihat lebih dulu");
    const listed = await json(`${EVIDENCE}/internal-sources?periodKind=AKHIR_TAHUN&year=2024`, {
      headers: authorized,
    });
    const stream = listed.streams[0];
    say(`   Stream ${stream.stream} · bucket ${stream.bucket} · unit ${stream.currencyUnit}`);
    say(
      `   Blok ${stream.chainScope.fromBlock}-${stream.chainScope.toBlock}, checkpoint indexer ` +
        `${stream.chainScope.checkpoint.lastIndexedBlock} (${stream.chainScope.checkpoint.status})`
    );
    for (const side of stream.sides) {
      say(
        `   ${side.role}: ${side.status}` +
          (side.rowCount === null ? "" : `, ${side.rowCount} baris`) +
          (side.unverified.length ? `, ${side.unverified.length} belum terverifikasi` : "")
      );
    }

    heading("4. Membekukan snapshot dan merekonsiliasi deposit per transaksi");
    const prepared = await json(EVIDENCE, {
      method: "POST",
      headers: authorized,
      body: JSON.stringify({
        label: "Deposit USDC akhir tahun 2024",
        period: { kind: "AKHIR_TAHUN", year: 2024 },
        currencyUnit: "USDC_6DP",
        balanceSheetScope: "ON",
        claim: { internal: { stream: USDC_DEPOSIT_STREAM } },
        source: { internal: { stream: USDC_DEPOSIT_STREAM } },
      }),
    });
    const preparation = prepared.preparation;
    say(`   Paket ${preparation.id} · hasil ${preparation.outcome}`);
    say(
      `   Entri klaim ${preparation.result.entryCounts.claim}, sumber ` +
        `${preparation.result.entryCounts.source}, cocok ${preparation.result.entryCounts.matched}`
    );
    for (const finding of preparation.findings) {
      say(`   Temuan ${finding.kind} pada ${finding.key}: selisih ${usdc(finding.deltaAmount.replace("-", ""))}`);
    }
    const claimSide = preparation.sources.find((side: any) => side.role === "CLAIM");
    for (const record of claimSide.unverified) {
      say(`   Belum terverifikasi: ${record.reference}`);
    }

    heading("5. Vonis paket, dari byte snapshot yang sama");
    const review = await json(`${EVIDENCE}/${preparation.id}/reports/review`, { headers: authorized });
    say(`   Prasyarat yang menghalangi: ${review.blockers.length === 0 ? "tidak ada" : review.blockers.join("; ")}`);
    for (const figure of review.figures) {
      say(`   ${figure.name} = ${figure.value.amount} ${figure.value.unit}`);
    }
    say("   Keterbatasan yang ikut dilaporkan:");
    for (const limitation of review.limitations) say(`     - ${limitation}`);

    heading("6. Indexer maju; paket yang sudah dibekukan tidak ikut berubah");
    await db.execute(sql`
      INSERT INTO onchain_events (tx_hash, block_number, log_index, event_name, contract_address, args_json)
      VALUES (${txOf("f")}, 2000, 0, 'USDCDeposited', ${CONTRACT},
              ${JSON.stringify({ donor: `0x${"2".repeat(40)}`, amountUSDC: "9000000", isAnonymous: false })})
    `);
    await db.execute(sql`UPDATE indexer_state SET last_indexed_block = 3000 WHERE indexer_key = ${INDEXER_KEY}`);

    const reopened = await json(`${EVIDENCE}/${preparation.id}`, { headers: authorized });
    const scopeOf = (packet: any) =>
      packet.snapshot.sides.find((side: any) => side.manifest.role === "SOURCE").manifest.chainScope;
    say(`   Commitment terverifikasi: ${reopened.commitmentVerified}`);
    say(
      `   Paket lama tetap memeriksa blok ${scopeOf(reopened.preparation).fromBlock}-` +
        `${scopeOf(reopened.preparation).toBlock} dengan ` +
        `${reopened.preparation.result.entryCounts.source} entri sumber`
    );

    const later = await json(EVIDENCE, {
      method: "POST",
      headers: authorized,
      body: JSON.stringify({
        label: "Deposit USDC akhir tahun 2024 - pemeriksaan ulang",
        period: { kind: "AKHIR_TAHUN", year: 2024 },
        currencyUnit: "USDC_6DP",
        balanceSheetScope: "ON",
        claim: { internal: { stream: USDC_DEPOSIT_STREAM } },
        source: { internal: { stream: USDC_DEPOSIT_STREAM } },
      }),
    });
    say(
      `   Pemeriksaan baru memeriksa blok ${scopeOf(later.preparation).fromBlock}-` +
        `${scopeOf(later.preparation).toBlock} dan menemukan deposit blok ` +
        `${scopeOf(later.preparation).observed.lastBlock}`
    );
    say();
  } finally {
    resetWorkspace();
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
}

await main();
process.exit(0);

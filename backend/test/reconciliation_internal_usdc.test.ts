/**
 * USDC deposits in the internal reconciliation mode (ticket #67).
 *
 * Mode Internal already compared this protocol's two records of the same fiat
 * population. USDC deposits were left out of it, because a donation row carried
 * only an estimated rupiah figure and no way back to the event that produced it.
 * With the native amount and the event identity stored, they belong in the same
 * comparison as everything else.
 *
 * Pure: rows in, ledger sides out, the real engine doing all the comparing.
 */

import { describe, expect, it } from "bun:test";
import { reconcile, type ReconciliationOptions } from "../src/reconciliation";
import {
  buildInternalLedgerSides,
  snapshotFromRows,
  INTERNAL_BUCKETS,
  type InternalSnapshot,
} from "../src/reconciliation-internal";
import { depositKeyOf, USDC_DEPOSIT_BUCKET } from "../src/internal-usdc-source";
import { serializeReport } from "../src/routes/reconciliation";
import app from "../src/index";

const PERIOD: ReconciliationOptions["period"] = { kind: "AKHIR_TAHUN", year: 2026 };
const CHAIN_ID = 421614;
const CONTRACT = "0x0d6cec28a574aca41b879767b081f6f2b4e9a849";

const txOf = (nibble: string) => `0x${nibble.repeat(64)}`;
const TX_MATCH = txOf("a");
const TX_MISMATCH = txOf("b");
const TX_ONLY_CHAIN = txOf("c");
const TX_ONLY_LEDGER = txOf("d");
const TX_PAIR = txOf("e");

const chain = { chainId: CHAIN_ID, contract: CONTRACT };

const keyOf = (txHash: string, logIndex = 0) =>
  depositKeyOf({ chainId: CHAIN_ID, contract: CONTRACT, txHash, logIndex });

const depositEvent = (txHash: string, logIndex: number, amountUSDC: string, blockNumber = 100) => ({
  eventName: "USDCDeposited",
  txHash,
  logIndex,
  blockNumber,
  contractAddress: CONTRACT,
  argsJson: JSON.stringify({ donor: `0x${"1".repeat(40)}`, amountUSDC, isAnonymous: false }),
});

const depositRow = (
  trxId: string,
  amountUsdc: string | null,
  txHash: string | null,
  logIndex: number | null,
  amountIDR = 0
) => ({
  trxId,
  amountIDR,
  paymentMethod: "USDC",
  amountUsdc,
  depositChainId: txHash ? CHAIN_ID : null,
  depositContract: txHash ? CONTRACT : null,
  depositTxHash: txHash,
  depositLogIndex: logIndex,
});

const snapshotOf = (overrides: Partial<InternalSnapshot> = {}): InternalSnapshot => ({
  donations: [],
  batches: [],
  proposals: [],
  events: [],
  chain,
  ...overrides,
});

const usdcReport = (snapshot: InternalSnapshot) => {
  const { claim, source } = buildInternalLedgerSides(snapshot, "USDC_6DP");
  return reconcile(claim, source, { period: PERIOD, allowedBuckets: INTERNAL_BUCKETS });
};

describe("deposits on both sides of the internal ledger", () => {
  const populated = () =>
    snapshotOf({
      events: [
        depositEvent(TX_MATCH, 0, "500000", 100),
        depositEvent(TX_MISMATCH, 0, "1000000", 110),
        depositEvent(TX_ONLY_CHAIN, 0, "2000000", 120),
        depositEvent(TX_PAIR, 0, "1000000", 130),
        depositEvent(TX_PAIR, 1, "1500000", 130),
      ],
      donations: [
        depositRow("USDC-COCOK", "500000", TX_MATCH, 0),
        depositRow("USDC-BEDA", "1500000", TX_MISMATCH, 0),
        depositRow("USDC-TANPA-EVENT", "3000000", TX_ONLY_LEDGER, 0),
        depositRow("USDC-PASANGAN-A", "1000000", TX_PAIR, 0),
        depositRow("USDC-PASANGAN-B", "1500000", TX_PAIR, 1),
      ],
    });

  it("matches a deposit that agrees to the minor unit", () => {
    const report = usdcReport(populated());
    expect(report.discrepancies.some((d) => d.key === keyOf(TX_MATCH))).toBe(false);
  });

  it("reports a differing amount as a mismatch, in USDC minor units", () => {
    const [mismatch] = usdcReport(populated()).discrepancies.filter(
      (d) => d.kind === "AMOUNT_MISMATCH"
    );
    expect(mismatch!.key).toBe(keyOf(TX_MISMATCH));
    expect(mismatch!.delta).toEqual({ amount: 500_000n, unit: "USDC_6DP" });
    expect(mismatch!.bucket).toBe(USDC_DEPOSIT_BUCKET);
  });

  it("reports a deposit missing on each side, keyed by its own identity", () => {
    const report = usdcReport(populated());
    const kinds = (kind: string) => report.discrepancies.filter((d) => d.kind === kind);

    expect(kinds("MISSING_IN_CLAIM").map((d) => d.key)).toEqual([keyOf(TX_ONLY_CHAIN)]);
    expect(kinds("MISSING_IN_SOURCE").map((d) => d.key)).toEqual([keyOf(TX_ONLY_LEDGER)]);
  });

  it("keeps two deposits from one transaction apart", () => {
    const report = usdcReport(populated());
    for (const logIndex of [0, 1]) {
      expect(report.discrepancies.some((d) => d.key === keyOf(TX_PAIR, logIndex))).toBe(false);
    }
    expect(report.entryCounts.matched).toBe(4);
  });

  it("reports two ledger rows claiming one deposit as a duplicate", () => {
    const snapshot = snapshotOf({
      events: [depositEvent(TX_MATCH, 0, "500000")],
      donations: [
        depositRow("USDC-A", "500000", TX_MATCH, 0),
        depositRow("USDC-B", "500000", TX_MATCH, 0),
      ],
    });
    expect(usdcReport(snapshot).discrepancies.some((d) => d.kind === "DUPLICATE_KEY")).toBe(true);
  });
});

describe("what the mapper refuses to invent", () => {
  it("leaves an unpairable historical row out of the comparison and names it", () => {
    const snapshot = snapshotOf({
      donations: [depositRow("USDC-LAMA", null, null, null, 16_200_000)],
    });
    const { claim, unverified } = buildInternalLedgerSides(snapshot, "USDC_6DP");

    expect(claim.entries.filter((entry) => entry.bucket === USDC_DEPOSIT_BUCKET)).toEqual([]);
    expect(unverified.map((record) => record.reference)).toContain("USDC-LAMA");
    // The estimated rupiah is never read as an amount.
    expect(JSON.stringify(claim.entries)).not.toContain("16200000");
  });

  it("does not put deposits in the rupiah report", () => {
    const snapshot = snapshotOf({
      events: [depositEvent(TX_MATCH, 0, "500000")],
      donations: [depositRow("USDC-COCOK", "500000", TX_MATCH, 0)],
    });
    const { claim, source } = buildInternalLedgerSides(snapshot, "IDR");

    expect(claim.entries.some((entry) => entry.bucket === USDC_DEPOSIT_BUCKET)).toBe(false);
    expect(source.entries.some((entry) => entry.bucket === USDC_DEPOSIT_BUCKET)).toBe(false);
  });

  it("names every deposit as unverified when the deployment's chain scope is unknown", () => {
    const { claim, source, unverified } = buildInternalLedgerSides(
      {
        ...snapshotOf(),
        chain: null,
        events: [depositEvent(TX_MATCH, 0, "500000")],
        donations: [depositRow("USDC-COCOK", "500000", TX_MATCH, 0)],
      },
      "USDC_6DP"
    );

    expect(claim.entries.some((entry) => entry.bucket === USDC_DEPOSIT_BUCKET)).toBe(false);
    expect(source.entries.some((entry) => entry.bucket === USDC_DEPOSIT_BUCKET)).toBe(false);
    // Nothing was compared, and nothing pretends otherwise: an empty result here
    // would let the engine call an unexamined population balanced.
    expect(unverified.map((record) => record.reference)).toEqual([
      "USDC-COCOK",
      `${TX_MATCH}#0`,
    ]);
    expect(unverified.every((record) => record.reason.includes("tidak menyebut chain"))).toBe(true);
  });

  it("ignores a deposit event from another contract", () => {
    const snapshot = snapshotOf({
      events: [{ ...depositEvent(TX_MATCH, 0, "500000"), contractAddress: `0x${"9".repeat(40)}` }],
    });
    const { source } = buildInternalLedgerSides(snapshot, "USDC_6DP");
    expect(source.entries.some((entry) => entry.bucket === USDC_DEPOSIT_BUCKET)).toBe(false);
  });
});

describe("shaping rows into a snapshot", () => {
  it("carries the native amount and identity from the database row", () => {
    const snapshot = snapshotFromRows({
      donationRows: [
        {
          trxId: "USDC-1",
          amountIDR: 0,
          paymentMethod: "USDC",
          amountUsdc6dp: "1500000",
          depositChainId: CHAIN_ID,
          depositContract: CONTRACT,
          depositTxHash: TX_MATCH,
          depositLogIndex: 2,
          createdAt: new Date("2026-03-01T00:00:00.000Z"),
        },
      ],
      batchRows: [],
      proposalRows: [],
      eventRows: [],
      chain,
    });

    expect(snapshot.chain).toEqual(chain);
    expect(snapshot.donations[0]).toMatchObject({
      amountUsdc: "1500000",
      depositTxHash: TX_MATCH,
      depositLogIndex: 2,
    });
  });

  it("carries the contract each event came from, so deposits can be scoped", () => {
    const snapshot = snapshotFromRows({
      donationRows: [],
      batchRows: [],
      proposalRows: [],
      eventRows: [
        {
          eventName: "USDCDeposited",
          txHash: TX_MATCH,
          blockNumber: 10,
          logIndex: 0,
          contractAddress: CONTRACT,
          argsJson: "{}",
        },
      ],
      chain,
    });

    expect(snapshot.events[0]!.contractAddress).toBe(CONTRACT);
  });
});

describe("what a downloaded result carries", () => {
  it("keeps the unit and the source identity in the machine representation", () => {
    const snapshot = snapshotOf({
      events: [depositEvent(TX_MISMATCH, 0, "1000000", 110)],
      donations: [depositRow("USDC-BEDA", "1500000", TX_MISMATCH, 0)],
    });
    const { claim, source } = buildInternalLedgerSides(snapshot, "USDC_6DP");
    const serialized = serializeReport(
      reconcile(claim, source, { period: PERIOD, allowedBuckets: INTERNAL_BUCKETS })
    );

    const [mismatch] = serialized.discrepancies;
    // Decimal text, so the amount survives JSON, and the unit travels with it.
    expect(mismatch!.delta).toEqual({ amount: "500000", unit: "USDC_6DP" });
    expect(mismatch!.key).toBe(keyOf(TX_MISMATCH));
    // Chain, contract, transaction and log are all still readable from the key.
    expect(mismatch!.key).toContain(`eip155:${CHAIN_ID}`);
    expect(mismatch!.key).toContain(CONTRACT);
    expect(mismatch!.key).toContain(TX_MISMATCH);
    expect(mismatch!.key.endsWith("#0")).toBe(true);
    expect(serialized.netDelta.unit).toBe("USDC_6DP");
  });
});

describe("POST /api/reconciliation/internal", () => {
  it("still states the block bounds and indexer position when no source was read", async () => {
    const response = await app.fetch(
      new Request("http://localhost:3001/api/reconciliation/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromBlock: 0, toBlock: 999_999_999 }),
      })
    );

    // No DATABASE_URL in this process, so a verdict is withheld - but the bounds
    // an examination would have used are stated rather than implied.
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.reports).toBeUndefined();
    expect(body.blockRange.fromBlock).toBe(0);
    expect(body.blockRange.toBlock).toBeLessThanOrEqual(body.lastIndexedBlock);
    expect(typeof body.indexerStatus).toBe("string");
  });
});

describe("basis hak amil USDC (#80)", () => {
  const amilBasis = (snapshot: InternalSnapshot) =>
    buildInternalLedgerSides(snapshot, "USDC_6DP").claim.amilBasis![0]!;

  const executedUsdc = (id: number, amount: number, asnaf: string, amountExact?: string) => ({
    proposalIdOnChain: id,
    currencyType: 1,
    amount,
    status: "Executed",
    asnafCategory: asnaf,
    ...(amountExact ? { amountExact } : {}),
  });

  it("menghitung pengumpulan dan hak amil dari jumlah yang tersimpan eksak", () => {
    const basis = amilBasis(
      snapshotOf({
        events: [depositEvent(TX_MATCH, 0, "10000000")],
        donations: [depositRow("USDC-1", "10000000", TX_MATCH, 0)],
        proposals: [executedUsdc(1, 0, "Amil", "500000"), executedUsdc(2, 0, "Fakir", "1000000")],
      })
    );

    expect(basis.collected).toEqual({ amount: 10_000_000n, unit: "USDC_6DP" });
    // 0,5 USDC hak amil - bukan 500.000 USDC seperti heuristik lama.
    expect(basis.actual).toEqual({ amount: 500_000n, unit: "USDC_6DP" });
    expect(basis.reason).toBeUndefined();
  });

  it("tidak lagi menyebut heuristik besar angka sebagai alasan", () => {
    const basis = amilBasis(snapshotOf());
    expect(basis.reason ?? "").not.toMatch(/heuristik/i);
  });

  it("menahan kedua angka ketika ada deposit yang belum terverifikasi", () => {
    const basis = amilBasis(
      snapshotOf({
        donations: [depositRow("USDC-LAMA", null, null, null, 16_200_000)],
        proposals: [executedUsdc(1, 500_000, "Amil")],
      })
    );

    expect(basis.collected).toBeNull();
    expect(basis.actual).toBeNull();
    expect(basis.reason).toMatch(/belum terverifikasi/i);
  });

  it("tidak menganggap hak amil nol ketika asnaf penyaluran tidak dikenal", () => {
    const basis = amilBasis(
      snapshotOf({
        events: [depositEvent(TX_MATCH, 0, "10000000")],
        donations: [depositRow("USDC-1", "10000000", TX_MATCH, 0)],
        proposals: [executedUsdc(1, 0, "Entah", "500000")],
      })
    );

    expect(basis.actual).toBeNull();
    expect(basis.reason).toMatch(/asnaf/i);
  });
});


describe("legacy USDC disbursement coverage", () => {
  it("retains the unverified proposal and withholds the amil basis", () => {
    const snapshot = snapshotOf({
      events: [depositEvent(TX_MATCH, 0, "10000000")],
      donations: [depositRow("USDC-1", "10000000", TX_MATCH, 0)],
      proposals: [{ proposalIdOnChain: 42, currencyType: 1, amount: 500000,
        status: "Executed", asnafCategory: "Amil", txHash: TX_PAIR }],
    });
    const { claim, unverified } = buildInternalLedgerSides(snapshot, "USDC_6DP");
    expect(claim.entries.some(row => row.bucket === "DISBURSEMENT")).toBe(false);
    expect(unverified).toEqual([expect.objectContaining({ side: "CLAIM", reference: "PROPOSAL#42",
      reason: expect.stringMatching(/belum terverifikasi/i) })]);
    expect(claim.amilBasis![0]!.collected).toBeNull();
    expect(claim.amilBasis![0]!.actual).toBeNull();
  });
});

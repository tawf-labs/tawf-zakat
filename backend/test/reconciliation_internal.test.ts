import { describe, expect, it } from "bun:test";
import app from "../src/index";
import { reconcile, type ReconciliationOptions } from "../src/reconciliation";
import {
  buildInternalLedgerSides,
  periodBounds,
  snapshotFromRows,
  INTERNAL_BUCKETS,
  INTERNAL_UNITS,
  type InternalSnapshot,
} from "../src/reconciliation-internal";

const PERIOD: ReconciliationOptions["period"] = { kind: "AKHIR_TAHUN", year: 2026 };

const options = (): ReconciliationOptions => ({ period: PERIOD, allowedBuckets: INTERNAL_BUCKETS });

const emptySnapshot: InternalSnapshot = { donations: [], batches: [], proposals: [], events: [] };

const settledBatchEvent = (batchId: number, totalAmountIDR: string, blockNumber = 500) => ({
  eventName: "FiatBatchSettled",
  txHash: `0xbatch${batchId}`,
  blockNumber,
  logIndex: 0,
  argsJson: JSON.stringify({ batchId: String(batchId), merkleRoot: "0xroot", totalAmountIDR }),
});

const report = (snapshot: InternalSnapshot, unit: "IDR" | "USDC_6DP" = "IDR") => {
  const { claim, source } = buildInternalLedgerSides(snapshot, unit);
  return reconcile(claim, source, options());
};

describe("Mode Internal - mapping PostgreSQL and the chain onto one ledger", () => {
  it("reports a database that mirrors the chain as balanced", () => {
    const snapshot: InternalSnapshot = {
      batches: [
        { batchNumber: 7, totalAmountIDR: 5_000_000, txHash: "0xbatch7", status: "settled_onchain" },
      ],
      donations: [
        { trxId: "TRX-1", amountIDR: 3_000_000, batchId: 7, status: "BATCHED" },
        { trxId: "TRX-2", amountIDR: 2_000_000, batchId: 7, status: "BATCHED" },
      ],
      proposals: [
        {
          proposalIdOnChain: 3,
          currencyType: 0,
          amount: 1_500_000,
          status: "Executed",
          txHash: "0xprop3",
        },
      ],
      events: [
        settledBatchEvent(7, "5000000"),
        {
          eventName: "DisbursementProposed",
          txHash: "0xprop3",
          blockNumber: 510,
          logIndex: 0,
          argsJson: JSON.stringify({ proposalId: "3", currencyType: 0, amount: "1500000" }),
        },
        {
          eventName: "DisbursementExecuted",
          txHash: "0xexec3",
          blockNumber: 520,
          logIndex: 0,
          argsJson: JSON.stringify({ proposalId: "3", currencyType: 0, amount: "1500000" }),
        },
      ],
    };

    const result = report(snapshot);
    expect(result.discrepancies).toEqual([]);
    expect(result.balanced).toBe(true);
    expect(result.entryCounts.matched).toBeGreaterThan(0);
  });

  it("detects a settled batch row that has no on-chain event behind it", () => {
    const result = report({
      ...emptySnapshot,
      batches: [
        { batchNumber: 9, totalAmountIDR: 4_000_000, txHash: "0xbatch9", status: "settled_onchain" },
      ],
    });

    const kinds = result.discrepancies.map((d) => d.kind);
    expect(kinds).toContain("MISSING_IN_SOURCE");
    expect(result.discrepancies.some((d) => d.key.includes("9"))).toBe(true);
  });

  it("detects an on-chain settlement the database never absorbed", () => {
    const result = report({ ...emptySnapshot, events: [settledBatchEvent(11, "7000000")] });

    expect(result.discrepancies.map((d) => d.kind)).toContain("MISSING_IN_CLAIM");
    expect(result.netDelta.amount).toBeLessThan(0n);
  });

  it("detects a batch whose recorded total differs from the settled total", () => {
    const result = report({
      ...emptySnapshot,
      batches: [
        { batchNumber: 4, totalAmountIDR: 9_000_000, txHash: "0xbatch4", status: "settled_onchain" },
      ],
      events: [settledBatchEvent(4, "8000000")],
    });

    const mismatch = result.discrepancies.find(
      (d) => d.kind === "AMOUNT_MISMATCH" && d.bucket === "MERKLE_BATCH"
    );
    expect(mismatch).toBeDefined();
    expect(mismatch!.delta.amount).toBe(1_000_000n);
    expect(mismatch!.key).toBe("BATCH#4");
  });

  it("detects donations that do not add up to the settled batch total", () => {
    const result = report({
      ...emptySnapshot,
      batches: [
        { batchNumber: 5, totalAmountIDR: 6_000_000, txHash: "0xbatch5", status: "settled_onchain" },
      ],
      donations: [{ trxId: "TRX-9", amountIDR: 5_500_000, batchId: 5, status: "BATCHED" }],
      events: [settledBatchEvent(5, "6000000")],
    });

    const donationGap = result.discrepancies.find((d) => d.bucket === "DONASI_FIAT");
    expect(donationGap).toBeDefined();
    expect(donationGap!.delta.amount).toBe(-500_000n);
  });

  it("does not treat a batch still awaiting settlement as a claim about the chain", () => {
    const result = report({
      ...emptySnapshot,
      batches: [{ batchNumber: 6, totalAmountIDR: 2_000_000, txHash: null, status: "pending" }],
      donations: [{ trxId: "TRX-3", amountIDR: 2_000_000, batchId: 6, status: "BATCHED" }],
    });

    expect(result.balanced).toBe(true);
  });

  it("detects a proposal marked executed with no execution event", () => {
    const result = report({
      ...emptySnapshot,
      proposals: [
        {
          proposalIdOnChain: 12,
          currencyType: 0,
          amount: 3_000_000,
          status: "Executed",
          txHash: "0xprop12",
        },
      ],
      events: [
        {
          eventName: "DisbursementProposed",
          txHash: "0xprop12",
          blockNumber: 600,
          logIndex: 0,
          argsJson: JSON.stringify({ proposalId: "12", currencyType: 0, amount: "3000000" }),
        },
      ],
    });

    const missing = result.discrepancies.filter((d) => d.kind === "MISSING_IN_SOURCE");
    expect(missing).toHaveLength(1);
    expect(missing[0].bucket).toBe("DISBURSEMENT");
  });

  it("keeps rupiah and USDC in separate ledgers rather than adding them together", () => {
    const snapshot: InternalSnapshot = {
      ...emptySnapshot,
      proposals: [
        { proposalIdOnChain: 20, currencyType: 0, amount: 1_000_000, status: "Executed", txHash: "0xa" },
        { proposalIdOnChain: 21, currencyType: 1, amount: 50_000_000, status: "Executed", txHash: "0xb" },
      ],
      events: [
        {
          eventName: "DisbursementExecuted",
          txHash: "0xa",
          blockNumber: 700,
          logIndex: 0,
          argsJson: JSON.stringify({ proposalId: "20", currencyType: 0, amount: "1000000" }),
        },
        {
          eventName: "DisbursementExecuted",
          txHash: "0xb",
          blockNumber: 701,
          logIndex: 0,
          argsJson: JSON.stringify({ proposalId: "21", currencyType: 1, amount: "50000000" }),
        },
        {
          eventName: "DisbursementProposed",
          txHash: "0xa",
          blockNumber: 690,
          logIndex: 0,
          argsJson: JSON.stringify({ proposalId: "20", currencyType: 0, amount: "1000000" }),
        },
        {
          eventName: "DisbursementProposed",
          txHash: "0xb",
          blockNumber: 691,
          logIndex: 0,
          argsJson: JSON.stringify({ proposalId: "21", currencyType: 1, amount: "50000000" }),
        },
      ],
    };

    const idr = report(snapshot, "IDR");
    const usdc = report(snapshot, "USDC_6DP");

    expect(idr.balanced).toBe(true);
    expect(usdc.balanced).toBe(true);
    expect(idr.netDelta.unit).toBe("IDR");
    expect(usdc.netDelta.unit).toBe("USDC_6DP");
    // The rupiah ledger must not have absorbed the USDC disbursement.
    expect(idr.entryCounts.claim).toBe(2);
    expect(usdc.entryCounts.claim).toBe(2);
  });

  it("covers both units", () => {
    expect([...INTERNAL_UNITS]).toEqual(["IDR", "USDC_6DP"]);
  });

  it("bounds a semester period to the first half of the year", () => {
    const bounds = periodBounds({ kind: "SEMESTER", year: 2026 });
    expect(bounds.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(bounds.to.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("bounds a year-end period to the whole year", () => {
    const bounds = periodBounds({ kind: "AKHIR_TAHUN", year: 2026 });
    expect(bounds.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(bounds.to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("snapshotFromRows", () => {
  const rows = {
    donationRows: [
      { trxId: "TRX-IN", amountIDR: 1_000, batchId: 1, status: "BATCHED", createdAt: new Date("2026-03-01") },
      { trxId: "TRX-OUT", amountIDR: 9_000, batchId: 1, status: "BATCHED", createdAt: new Date("2025-03-01") },
    ],
    batchRows: [
      { batchId: 1, totalAmountIDR: 1_000, txHash: "0xb1", settledAt: new Date("2026-03-02") },
      { batchId: 2, totalAmountIDR: 5_000, txHash: null, settledAt: new Date("2026-03-02") },
    ],
    proposalRows: [
      { proposalIdOnChain: 1, currencyType: 0, amount: 500, status: "Executed", txHash: "0xp1", createdAt: new Date("2026-04-01") },
    ],
    eventRows: [
      {
        eventName: "FiatBatchSettled",
        txHash: "0xb1",
        blockNumber: 10,
        logIndex: 0,
        argsJson: JSON.stringify({ batchId: "1", totalAmountIDR: "1000" }),
        createdAt: new Date("2026-03-02"),
      },
      {
        eventName: "FiatBatchSettled",
        txHash: "0xold",
        blockNumber: 5,
        logIndex: 0,
        argsJson: JSON.stringify({ batchId: "99", totalAmountIDR: "7000" }),
        createdAt: new Date("2025-03-02"),
      },
    ],
  };

  it("maps rows onto the snapshot the mapper consumes", () => {
    const snapshot = snapshotFromRows(rows);
    expect(snapshot.batches[0].batchNumber).toBe(1);
    expect(snapshot.batches[0].status).toBe("settled_onchain");
    expect(snapshot.batches[1].status).toBe("pending");
    expect(snapshot.events).toHaveLength(2);
  });

  it("bounds both sides by the reporting period, never just one", () => {
    const snapshot = snapshotFromRows({ ...rows, proposalRows: [] }, {
      kind: "AKHIR_TAHUN",
      year: 2026,
    });

    expect(snapshot.donations.map((d) => d.trxId)).toEqual(["TRX-IN"]);
    // The 2025 event is dropped too - narrowing only the database side would
    // report the older settlement as MISSING_IN_CLAIM out of nowhere.
    expect(snapshot.events).toHaveLength(1);

    const result = reconcile(
      ...(Object.values(buildInternalLedgerSides(snapshot, "IDR")) as [any, any]),
      { period: { kind: "AKHIR_TAHUN", year: 2026 }, allowedBuckets: INTERNAL_BUCKETS }
    );
    expect(result.balanced).toBe(true);
  });
});

describe("POST /api/reconciliation/internal", () => {
  const post = (body?: unknown) =>
    app.fetch(
      new Request("http://localhost:3001/api/reconciliation/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      })
    );

  it("runs without any ledger payload from the caller", async () => {
    const res = await post();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.lastIndexedBlock).toBe("number");
    expect(body.reports.IDR).toBeDefined();
    expect(body.reports.USDC_6DP).toBeDefined();
    expect(body.reports.IDR.netDelta.unit).toBe("IDR");
    expect(body.reports.USDC_6DP.netDelta.unit).toBe("USDC_6DP");
    expect(typeof body.reports.IDR.balanced).toBe("boolean");
  });

  it("states the block range the report is valid up to", async () => {
    const body = await (await post({ fromBlock: 0, toBlock: 999_999_999 })).json();
    expect(body.blockRange.fromBlock).toBe(0);
    expect(body.blockRange.toBlock).toBeLessThanOrEqual(body.lastIndexedBlock);
  });

  it("can be narrowed to a reporting period", async () => {
    const res = await post({ period: { kind: "AKHIR_TAHUN", year: 2026 } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reports.IDR.period).toEqual({ kind: "AKHIR_TAHUN", year: 2026 });
  });

  it("rejects a block range that runs backwards", async () => {
    const res = await post({ fromBlock: 900, toBlock: 100 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/blok/i);
  });
});

/**
 * Mapping this protocol's USDC deposits, exactly (Spec #68, ticket #79).
 *
 * The claim these tests exist to make is narrow and worth stating plainly: the
 * mapper reports the amount that was deposited, and reports nothing at all when
 * it cannot. Every case below is a way an amount could be quietly changed on the
 * way into a package - a magnitude heuristic, a float, an estimated rupiah, a
 * transaction with two deposits in it - and each one is pinned to the behaviour
 * that keeps the number honest.
 *
 * Pure throughout: rows in, sides out, no database.
 */

import { describe, expect, it } from "bun:test";
import {
  depositKeyOf,
  mapDepositEvents,
  mapLedgerDeposits,
  readMinorUnits,
  usdcDepositClaimSide,
  usdcDepositSourceSide,
  USDC_DEPOSIT_BUCKET,
  type ChainScope,
  type DepositEventRow,
  type InternalManifestBase,
  type LedgerDepositRow,
} from "../src/internal-usdc-source";
import { sourceFailed, sourceRead } from "../src/source-read";

const CHAIN_ID = 421614;
const CONTRACT = "0x0d6cec28a574aca41b879767b081f6f2b4e9a849";
const TX = `0x${"ab".repeat(32)}`;
const OTHER_TX = `0x${"cd".repeat(32)}`;

const chainScope: ChainScope = {
  chainId: CHAIN_ID,
  contract: CONTRACT,
  indexerKey: `${CHAIN_ID}:${CONTRACT}`,
  fromBlock: 0,
  toBlock: 1000,
  checkpoint: { lastIndexedBlock: 1000, status: "SYNCED", lastSyncAt: "2026-02-01T00:00:00.000Z" },
  observed: null,
  blockHashes: "NOT_RETAINED",
};

const base: InternalManifestBase = {
  institutionId: "lpz-sinar-amanah",
  scopeUnit: "LPZ Sinar Amanah",
  scopeLevel: "LEMBAGA",
  period: { kind: "AKHIR_TAHUN", year: 2024 },
  cutOff: "2025-02-11T00:00:00.000Z",
};

const event = (
  amountUSDC: unknown,
  overrides: Partial<DepositEventRow> = {}
): DepositEventRow => ({
  eventName: "USDCDeposited",
  txHash: TX,
  logIndex: 0,
  blockNumber: 500,
  contractAddress: CONTRACT,
  argsJson: JSON.stringify({
    donor: "0x1111111111111111111111111111111111111111",
    amountUSDC,
    isAnonymous: false,
    commitmentHash: `0x${"00".repeat(32)}`,
  }),
  ...overrides,
});

const ledgerRow = (overrides: Partial<LedgerDepositRow> = {}): LedgerDepositRow => ({
  trxId: "USDC-20240101-1234",
  amountUsdc: "1000000",
  depositChainId: CHAIN_ID,
  depositContract: CONTRACT,
  depositTxHash: TX,
  depositLogIndex: 0,
  amountIDR: 16_200,
  ...overrides,
});

describe("reading USDC minor units", () => {
  it("keeps every documented amount at its own scale, without a magnitude heuristic", () => {
    // 0,5 USDC and 1,5 USDC bracket the one-USDC boundary a "small numbers must
    // be whole USDC" heuristic would rescale. Exactly 1 USDC sits on it.
    for (const [minorUnits, meaning] of [
      ["500000", "0,5 USDC"],
      ["1000000", "tepat 1 USDC"],
      ["1500000", "1,5 USDC"],
      ["1", "0,000001 USDC"],
    ] as const) {
      const read = readMinorUnits(minorUnits);
      expect(read, meaning).toEqual({ amount: BigInt(minorUnits) });
    }
  });

  it("carries an amount far beyond double precision without losing a unit", () => {
    const huge = "123456789012345678901234567890";
    expect(readMinorUnits(huge)).toEqual({ amount: BigInt(huge) });
  });

  it("refuses a number that has already left the safe integer range", () => {
    const read = readMinorUnits(9_007_199_254_740_993);
    expect("error" in read).toBe(true);
    if ("error" in read) expect(read.error).toContain("teks angka desimal");
  });

  it("refuses a fraction rather than rounding it", () => {
    expect("error" in readMinorUnits(1.5)).toBe(true);
    expect("error" in readMinorUnits("1.5")).toBe(true);
  });

  it("refuses an absent, negative or non-numeric amount", () => {
    for (const value of [undefined, null, "", "abc", -1, "-1"]) {
      expect("error" in readMinorUnits(value), JSON.stringify(value)).toBe(true);
    }
  });
});

describe("deposit identity", () => {
  it("separates two deposits inside one transaction by log index", () => {
    const first = depositKeyOf({ chainId: CHAIN_ID, contract: CONTRACT, txHash: TX, logIndex: 0 });
    const second = depositKeyOf({ chainId: CHAIN_ID, contract: CONTRACT, txHash: TX, logIndex: 1 });
    expect(first).not.toBe(second);
  });

  it("reads the same deposit to the same key regardless of hex casing", () => {
    expect(
      depositKeyOf({ chainId: CHAIN_ID, contract: CONTRACT.toUpperCase(), txHash: TX.toUpperCase(), logIndex: 3 })
    ).toBe(depositKeyOf({ chainId: CHAIN_ID, contract: CONTRACT, txHash: TX, logIndex: 3 }));
  });

  it("keeps the same transaction on two chains apart", () => {
    expect(depositKeyOf({ chainId: 1, contract: CONTRACT, txHash: TX, logIndex: 0 })).not.toBe(
      depositKeyOf({ chainId: CHAIN_ID, contract: CONTRACT, txHash: TX, logIndex: 0 })
    );
  });
});

describe("mapping indexed deposit events", () => {
  it("maps several deposits in one transaction as several rows", () => {
    const mapped = mapDepositEvents(
      [
        event("500000", { logIndex: 0, blockNumber: 120 }),
        event("1500000", { logIndex: 1, blockNumber: 120 }),
        event("1000000", { logIndex: 2, blockNumber: 121 }),
      ],
      chainScope
    );

    expect(mapped.rows.map((row) => row.amount)).toEqual(["500000", "1500000", "1000000"]);
    expect(new Set(mapped.rows.map((row) => row.key)).size).toBe(3);
    expect(mapped.rows.every((row) => row.bucket === USDC_DEPOSIT_BUCKET)).toBe(true);
    expect(mapped.rows.every((row) => row.unit === "USDC_6DP")).toBe(true);
    expect(mapped.observed).toEqual({ firstBlock: 120, lastBlock: 121, eventCount: 3 });
  });

  it("binds chain, contract, transaction, log index and block to each row", () => {
    const [row] = mapDepositEvents([event("2000000", { logIndex: 4, blockNumber: 777 })], chainScope).rows;
    expect(row!.origin).toEqual({
      chainId: CHAIN_ID,
      contract: CONTRACT,
      txHash: TX,
      logIndex: 4,
      blockNumber: 777,
      // The mirror keeps no block hash, and nothing invents one.
      blockHash: null,
    });
  });

  it("ignores events from another contract and other event names", () => {
    const mapped = mapDepositEvents(
      [
        event("1000000", { contractAddress: "0x9999999999999999999999999999999999999999" }),
        event("1000000", { eventName: "FiatBatchSettled" }),
      ],
      chainScope
    );
    expect(mapped.rows).toEqual([]);
    expect(mapped.unverified).toEqual([]);
  });

  it("records an unreadable in-scope event as unverified rather than dropping it", () => {
    const mapped = mapDepositEvents(
      [
        event(1.5, { logIndex: 0 }),
        { ...event("1000000", { logIndex: 1 }), argsJson: "{not json" },
        event(undefined, { logIndex: 2 }),
      ],
      chainScope
    );

    expect(mapped.rows).toEqual([]);
    expect(mapped.unverified).toHaveLength(3);
    expect(mapped.unverified.every((record) => record.side === "SOURCE")).toBe(true);
    expect(mapped.observed).toBeNull();
  });
});

describe("mapping internal ledger deposit rows", () => {
  it("maps a row that carries its native amount and event identity", () => {
    const mapped = mapLedgerDeposits([ledgerRow({ amountUsdc: "500000" })], chainScope);
    expect(mapped.unverified).toEqual([]);
    expect(mapped.rows[0]!.amount).toBe("500000");
    expect(mapped.rows[0]!.key).toBe(
      depositKeyOf({ chainId: CHAIN_ID, contract: CONTRACT, txHash: TX, logIndex: 0 })
    );
  });

  it("matches the chain side key exactly, so a paired deposit reconciles", () => {
    const source = mapDepositEvents([event("1000000")], chainScope);
    const claim = mapLedgerDeposits([ledgerRow()], chainScope);
    expect(claim.rows[0]!.key).toBe(source.rows[0]!.key);
  });

  it("marks a row with no event identity unverified and never reads its rupiah", () => {
    const mapped = mapLedgerDeposits(
      [ledgerRow({ depositTxHash: null, depositLogIndex: null, amountUsdc: null, amountIDR: 16_200_000 })],
      chainScope
    );

    expect(mapped.rows).toEqual([]);
    expect(mapped.unverified).toHaveLength(1);
    expect(mapped.unverified[0]!.reference).toBe("USDC-20240101-1234");
    expect(mapped.unverified[0]!.reason).toContain("Estimasi rupiah");
    // Nothing anywhere in the outcome carries the rupiah figure as an amount.
    expect(JSON.stringify(mapped)).not.toContain("16200000");
  });

  it("refuses to move a deposit identity between contracts", () => {
    const mapped = mapLedgerDeposits(
      [ledgerRow({ depositContract: "0x9999999999999999999999999999999999999999" })],
      chainScope
    );
    expect(mapped.rows).toEqual([]);
    expect(mapped.unverified[0]!.reason).toContain("chain atau kontrak lain");
  });

  it("keeps a duplicated pairing as two rows, so the engine can call it a duplicate", () => {
    const mapped = mapLedgerDeposits(
      [ledgerRow({ trxId: "USDC-A" }), ledgerRow({ trxId: "USDC-B" })],
      chainScope
    );
    expect(mapped.rows).toHaveLength(2);
    expect(mapped.rows[0]!.key).toBe(mapped.rows[1]!.key);
  });
});

describe("the sides a package is frozen against", () => {
  it("declares the chain side with its scope, bucket and observed blocks", () => {
    const side = usdcDepositSourceSide(base, chainScope, sourceRead([event("1000000", { blockNumber: 900 })]));

    expect(side.status).toBe("READ");
    expect(side.manifest.origin).toBe("INTERNAL_LEDGER");
    expect(side.manifest.currencyUnit).toBe("USDC_6DP");
    expect(side.manifest.fundTypes).toEqual([USDC_DEPOSIT_BUCKET]);
    expect(side.manifest.chainScope?.observed).toEqual({
      firstBlock: 900,
      lastBlock: 900,
      eventCount: 1,
    });
    expect(side.manifest.chainScope?.checkpoint.lastIndexedBlock).toBe(1000);
  });

  it("carries a failed event read through as FAILED with its reason, never as empty", () => {
    const side = usdcDepositSourceSide(base, chainScope, sourceFailed("koneksi terputus"));
    expect(side.status).toBe("FAILED");
    if (side.status !== "READ") expect(side.detail).toContain("koneksi terputus");
  });

  it("declares the ledger side unsupported while the native columns are absent", () => {
    const side = usdcDepositClaimSide(base, chainScope, {
      nativeIdentityAvailable: false,
      read: sourceRead([ledgerRow({ amountUsdc: null, depositTxHash: null, depositLogIndex: null })]),
    });

    expect(side.status).toBe("MISSING");
    if (side.status !== "READ") expect(side.detail).toContain("#67");
    // The rows still exist and are still named, as a population not examined.
    expect(side.unverified).toHaveLength(1);
  });

  it("reads the ledger side once the native columns are there", () => {
    const side = usdcDepositClaimSide(base, chainScope, {
      nativeIdentityAvailable: true,
      read: sourceRead([ledgerRow({ amountUsdc: "1500000" })]),
    });

    expect(side.status).toBe("READ");
    if (side.status === "READ") expect(side.rows[0]!.amount).toBe("1500000");
  });

  it("gives both sides the same cut-off and scope, so a package is not refused for drift", () => {
    const claim = usdcDepositClaimSide(base, chainScope, {
      nativeIdentityAvailable: true,
      read: sourceRead([ledgerRow()]),
    });
    const source = usdcDepositSourceSide(base, chainScope, sourceRead([event("1000000")]));

    expect(claim.manifest.cutOff).toBe(source.manifest.cutOff);
    expect(claim.manifest.scopeUnit).toBe(source.manifest.scopeUnit);
    expect(claim.manifest.scopeLevel).toBe(source.manifest.scopeLevel);
    expect(claim.manifest.period).toEqual(source.manifest.period);
  });
});

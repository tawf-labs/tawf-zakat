/**
 * Turning a `USDCDeposited` event into a ledger row, exactly (ticket #67).
 *
 * The intake boundary is where a deposit's amount and identity are either
 * preserved or lost forever, and the old path lost both: the amount went through
 * `Number`, was rescaled by a magnitude heuristic, and was then stored only as an
 * estimated rupiah figure at a hardcoded rate, while the transaction hash and log
 * index were discarded entirely. Nothing downstream can recover any of that.
 *
 * These tests pin the replacement. Pure throughout - an event in, a row's values
 * out - so every rule holds without a database or a chain.
 */

import { describe, expect, it } from "bun:test";
import {
  depositTrxId,
  readDepositIntake,
  type DepositEventInput,
} from "../src/usdc-deposit-intake";

const CHAIN_ID = 421614;
const CONTRACT = "0x0d6cec28a574aca41b879767b081f6f2b4e9a849";
const TX = `0x${"ab".repeat(32)}`;
const DONOR = "0x1234567890abcdef1234567890abcdef12345678";

const input = (overrides: Partial<DepositEventInput> = {}): DepositEventInput => ({
  chainId: CHAIN_ID,
  contract: CONTRACT,
  txHash: TX,
  logIndex: 0,
  blockNumber: 500,
  amountUSDC: 1_500_000n,
  donor: DONOR,
  isAnonymous: false,
  commitmentHash: `0x${"cd".repeat(32)}`,
  occurredAt: "2026-02-01T00:00:00.000Z",
  ...overrides,
});

const recordOf = (overrides: Partial<DepositEventInput> = {}) => {
  const read = readDepositIntake(input(overrides));
  if ("error" in read) throw new Error(`unexpected refusal: ${read.error}`);
  return read.record;
};

describe("reading a deposit event into a ledger row", () => {
  it("keeps the native amount exactly, at its own scale", () => {
    // 0,5 and 1,5 USDC bracket the boundary a "small numbers must be whole USDC"
    // heuristic would rescale; exactly 1 USDC sits on it.
    for (const minorUnits of [500_000n, 1_000_000n, 1_500_000n, 1n]) {
      expect(recordOf({ amountUSDC: minorUnits }).amountUsdc6dp).toBe(minorUnits.toString());
    }
  });

  it("carries an amount far beyond double precision without losing a unit", () => {
    const huge = 123_456_789_012_345_678_901_234_567_890n;
    expect(recordOf({ amountUSDC: huge }).amountUsdc6dp).toBe(huge.toString());
  });

  it("accepts the decimal text form a serialized event carries", () => {
    expect(recordOf({ amountUSDC: "2500000" }).amountUsdc6dp).toBe("2500000");
  });

  it("refuses an amount whose precision cannot be vouched for", () => {
    for (const amount of [1.5, 9_007_199_254_740_993, "1.5", "", null, undefined, -1n]) {
      const read = readDepositIntake(input({ amountUSDC: amount }));
      expect("error" in read, JSON.stringify(String(amount))).toBe(true);
    }
  });

  it("never converts the deposit into rupiah", () => {
    const record = recordOf({ amountUSDC: 1_000_000n });
    expect(JSON.stringify(record)).not.toContain("16200");
    expect(Object.keys(record)).not.toContain("amountIDR");
  });
});

describe("deposit identity", () => {
  it("binds chain, contract, transaction and log index", () => {
    const record = recordOf({ logIndex: 3 });
    expect(record.identity).toEqual({
      chainId: CHAIN_ID,
      contract: CONTRACT,
      txHash: TX,
      logIndex: 3,
    });
  });

  it("gives two deposits in one transaction two different rows", () => {
    expect(recordOf({ logIndex: 0 }).trxId).not.toBe(recordOf({ logIndex: 1 }).trxId);
  });

  it("derives the same trxId from the same event, so reprocessing lands on one row", () => {
    // Deterministic on purpose: the old path minted a random suffix, so a replayed
    // event inserted a second donation rather than colliding with the first.
    expect(recordOf().trxId).toBe(recordOf().trxId);
    expect(recordOf().trxId).toBe(
      depositTrxId({ chainId: CHAIN_ID, contract: CONTRACT, txHash: TX, logIndex: 0 })
    );
  });

  it("reads the same deposit to the same identity whatever the hex casing", () => {
    expect(recordOf({ txHash: TX.toUpperCase(), contract: CONTRACT.toUpperCase() }).trxId).toBe(
      recordOf().trxId
    );
  });

  it("keeps the trxId usable as a URL path segment", () => {
    expect(recordOf().trxId).toBe(encodeURIComponent(recordOf().trxId));
  });

  it("refuses an event with no usable identity rather than inventing one", () => {
    for (const overrides of [
      { txHash: "not-a-hash" },
      { txHash: "0x1234" },
      { logIndex: -1 },
      { logIndex: 1.5 },
      { contract: "" },
      { chainId: 0 },
      { blockNumber: -1 },
    ] as Partial<DepositEventInput>[]) {
      const read = readDepositIntake(input(overrides));
      expect("error" in read, JSON.stringify(overrides)).toBe(true);
    }
  });
});

describe("the rest of the row", () => {
  it("keeps an anonymous donor anonymous and names a public one by truncated address", () => {
    expect(recordOf({ isAnonymous: true }).donorName).toBe("Hamba Allah");
    expect(recordOf({ isAnonymous: false }).donorName).toContain("0x1234");
    expect(recordOf({ isAnonymous: false }).donorName).toContain("5678");
  });

  it("does not put the full donor address in an anonymous row", () => {
    expect(recordOf({ isAnonymous: true }).donorName).not.toContain("0x1234");
  });

  it("carries the block the deposit was seen in", () => {
    expect(recordOf({ blockNumber: 981 }).blockNumber).toBe(981);
  });

  it("records the commitment hash when the event carries one, and null when it does not", () => {
    expect(recordOf({ commitmentHash: undefined }).commitmentHash).toBeNull();
    expect(recordOf({ commitmentHash: `0x${"11".repeat(32)}` }).commitmentHash).toBe(
      `0x${"11".repeat(32)}`
    );
  });
});

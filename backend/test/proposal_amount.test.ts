/**
 * Reading a disbursement amount without guessing its unit (ticket #80).
 *
 * The old reader decided what a USDC amount meant from how large it was:
 * `value < 1_000_000n ? value * 1_000_000n : value`. It was introduced because
 * the `amount` column is ambiguous - some writers stored whole USDC, some stored
 * minor units - but a heuristic does not remove an ambiguity, it hides it behind
 * a number that looks confident. A 0,5 USDC disbursement came back as 500.000
 * USDC, which is the same shape of error the deposit path carried until #67.
 *
 * The unit now comes from `currencyType`, which is a stored fact, and the amount
 * comes from a column that holds it exactly. Pure throughout.
 */

import { describe, expect, it } from "bun:test";
import { proposalAmount, readProposalAmount, type AmountRow } from "../src/ledger-rows";

const usdcRow = (overrides: Partial<AmountRow> = {}): AmountRow => ({
  proposalIdOnChain: 1,
  currencyType: 1,
  amount: 1_500_000,
  ...overrides,
});

const idrRow = (overrides: Partial<AmountRow> = {}): AmountRow => ({
  proposalIdOnChain: 2,
  currencyType: 0,
  amount: 2_500_000,
  ...overrides,
});

describe("the unit comes from currencyType, never from the size of the number", () => {
  it("keeps every USDC amount at its own scale", () => {
    // 0,5 and 1,5 USDC bracket the boundary the old heuristic rescaled across;
    // exactly 1 USDC sat on it.
    for (const minorUnits of [1, 500_000, 1_000_000, 1_500_000, 2_500_000]) {
      expect(proposalAmount(usdcRow({ amount: minorUnits })), `${minorUnits}`).toEqual({
        amount: BigInt(minorUnits),
        unit: "USDC_6DP",
      });
    }
  });

  it("no longer multiplies a sub-USDC amount by a million", () => {
    // The regression this ticket exists for: 0,5 USDC reported as 500.000 USDC.
    expect(proposalAmount(usdcRow({ amount: 500_000 })).amount).toBe(500_000n);
    expect(proposalAmount(usdcRow({ amount: 500_000 })).amount).not.toBe(500_000_000_000n);
  });

  it("reads a rupiah proposal as rupiah, at any size", () => {
    expect(proposalAmount(idrRow({ amount: 1 }))).toEqual({ amount: 1n, unit: "IDR" });
    expect(proposalAmount(idrRow({ amount: 11_622_127_523_247 }))).toEqual({
      amount: 11_622_127_523_247n,
      unit: "IDR",
    });
  });
});

describe("the exact column wins over the number one", () => {
  it("prefers the exact decimal text when the row carries it", () => {
    expect(proposalAmount(usdcRow({ amount: 1, amountExact: "1500000" }))).toEqual({
      amount: 1_500_000n,
      unit: "USDC_6DP",
    });
  });

  it("carries an amount beyond double precision that the number column cannot hold", () => {
    const huge = "123456789012345678901234567890";
    expect(proposalAmount(usdcRow({ amount: 0, amountExact: huge }))).toEqual({
      amount: BigInt(huge),
      unit: "USDC_6DP",
    });
  });

  it("falls back to the stored number where the exact column is absent", () => {
    // Not a guess: the unit is still `currencyType`, and the value is whatever
    // the row holds. Only the reachable precision differs.
    expect(proposalAmount(usdcRow({ amount: 750_000, amountExact: null })).amount).toBe(750_000n);
  });
});

describe("what it refuses rather than rounds", () => {
  it("refuses a fractional amount instead of rounding it away", () => {
    const read = readProposalAmount(usdcRow({ amount: 1.5 }));
    expect("error" in read).toBe(true);
    expect(() => proposalAmount(usdcRow({ amount: 1.5 }))).toThrow();
  });

  it("refuses an exact column that is not a decimal integer", () => {
    for (const value of ["1.5", "abc", "-1", " "]) {
      const read = readProposalAmount(usdcRow({ amountExact: value }));
      expect("error" in read, JSON.stringify(value)).toBe(true);
    }
  });

  it("names the proposal in the reason, so a finding can be traced", () => {
    const read = readProposalAmount(usdcRow({ proposalIdOnChain: 42, amount: Number.NaN }));
    expect("error" in read).toBe(true);
    if ("error" in read) expect(read.error).toContain("42");
  });
});

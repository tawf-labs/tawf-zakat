import { describe, expect, it } from "bun:test";
import { allocationPercent, FUNDING_RECORD_DISCLAIMER } from "./activityClient";

describe("Activity client (Ticket #103, Spec #100)", () => {
  it("states a funding record is not a bank balance or handover, without crowdfunding framing", () => {
    expect(FUNDING_RECORD_DISCLAIMER).toContain("bukan saldo bank terverifikasi");
    expect(FUNDING_RECORD_DISCLAIMER).toContain("bukti serah terima bantuan fisik");
    expect(FUNDING_RECORD_DISCLAIMER).not.toContain("crowdfunding");
  });

  it("computes the allocated percent of a known target exactly", () => {
    expect(allocationPercent({ targetAmount: "1000000", targetIsPartial: false, totalAllocatedAmount: "900000" })).toBe(90);
    expect(allocationPercent({ targetAmount: "9007199254740993", targetIsPartial: false, totalAllocatedAmount: "9007199254740993" })).toBe(100);
  });

  it("gives no percent for a partial or zero target, rather than claiming it is funded", () => {
    expect(allocationPercent({ targetAmount: "0", targetIsPartial: true, totalAllocatedAmount: "0" })).toBeNull();
    expect(allocationPercent({ targetAmount: "500000", targetIsPartial: true, totalAllocatedAmount: "500000" })).toBeNull();
  });
});

import { describe, expect, it } from "bun:test";
import type { RecurringAidWarning } from "./disbursementClient";
import { groupRecurringWarnings, recurringFlags } from "./RecurringAidWarnings";

const warning = (beneficiaryId: string, beneficiaryName: string, matchedProposalId: string, matchedProgramName: string): RecurringAidWarning => ({
  beneficiaryId,
  beneficiaryName,
  matchedProposalId,
  matchedProgramName,
  matchedPeriod: "2026-01-01 s/d 2026-03-31",
  matchedStatus: "APPROVED",
  message: "…",
});

describe("recurring aid warnings", () => {
  const warnings = [
    warning("b1", "Ani", "p1", "Beasiswa"),
    warning("b2", "Budi", "p1", "Beasiswa"),
    warning("b1", "Ani", "p2", "Sembako"),
    warning("b1", "Ani", "p1", "Beasiswa"),
  ];

  it("groups per earlier proposal, largest overlap first, naming each recipient once", () => {
    expect(groupRecurringWarnings(warnings).map((g) => [g.proposalId, g.names])).toEqual([
      ["p1", ["Ani", "Budi"]],
      ["p2", ["Ani"]],
    ]);
  });

  it("flags each recipient with how many earlier proposals it matches, counting repeats once", () => {
    const flags = recurringFlags(warnings, () => "Disetujui");
    expect(flags.get("b1")?.badge).toBe("2×");
    expect(flags.get("b1")?.detail).toContain("Sembako · 2026-01-01 s/d 2026-03-31 · Disetujui");
    expect(flags.get("b2")?.badge).toBe("1×");
    expect(flags.has("b3")).toBe(false);
  });
});

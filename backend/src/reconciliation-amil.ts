import type { BalanceSheetPosition, LedgerSide, Money } from "./reconciliation";
import { assessAmilAmounts } from "./amil-policy";

export type AmilStatus = "WITHIN_CEILING" | "EXCEEDED" | "NOT_CHECKED";
export type AmilBasis = {
  key: string;
  label?: string;
  balanceSheet: BalanceSheetPosition;
  collected: Money | null;
  actual: Money | null;
  reason?: string;
};
export type AmilCheck = AmilBasis & {
  side: "claim" | "source";
  ceiling: Money | null;
  status: AmilStatus;
};
export type AmilAssessment = { status: AmilStatus; checks: AmilCheck[] };

function collectionBasis(side: LedgerSide): AmilBasis[] {
  const groups = new Map<string, AmilBasis>();
  const seen = new Set<string>();
  for (const entry of side.entries) {
    const id = JSON.stringify([entry.key, entry.balanceSheet]);
    const matchKey = JSON.stringify([entry.key, entry.bucket, entry.balanceSheet]);
    const basis = groups.get(id);
    if (seen.has(matchKey)) {
      basis!.collected = null;
      basis!.actual = null;
      basis!.reason = "Entri ganda membuat basis hak amil tidak dapat dipastikan.";
      continue;
    }
    seen.add(matchKey);
    if (!basis) {
      groups.set(id, {
        key: entry.key, label: entry.label, balanceSheet: entry.balanceSheet,
        collected: { ...entry.value }, actual: entry.amilAmount ? { ...entry.amilAmount } : null,
      });
    } else {
      if (basis.collected) basis.collected.amount += entry.value.amount;
      if (basis.actual && entry.amilAmount) basis.actual.amount += entry.amilAmount.amount;
      else basis.actual = null;
    }
  }
  return [...groups.values()];
}

export function assessReconciliationAmil(
  claim: LedgerSide, source: LedgerSide, position: BalanceSheetPosition = "ON"
): AmilAssessment {
  const checks: AmilCheck[] = [];
  for (const [role, side] of [["claim", claim], ["source", source]] as const) {
    const bases = [...(side.amilBasis ?? collectionBasis(side))];
    if (bases.length === 0) bases.push({
      key: "ALL", label: side.label, balanceSheet: position, collected: null, actual: null,
      reason: "Tidak ada data hak amil dalam cakupan ini.",
    });
    for (const basis of bases) {
      const amounts = basis.collected ? assessAmilAmounts(basis.collected.amount, basis.actual?.amount ?? 0n) : null;
      const ceiling = basis.collected && amounts
        ? { ...basis.collected, amount: amounts.ceiling }
        : null;
      const status: AmilStatus = !ceiling || !basis.actual ? "NOT_CHECKED"
        : amounts!.withinCeiling ? "WITHIN_CEILING" : "EXCEEDED";
      checks.push({ ...basis, side: role, ceiling, status,
        ...(status === "NOT_CHECKED" ? { reason: basis.reason ?? "Angka hak amil belum lengkap." } : {}),
      });
    }
  }
  checks.sort((a, b) => {
    const left = JSON.stringify([a.side, a.key, a.balanceSheet]);
    const right = JSON.stringify([b.side, b.key, b.balanceSheet]);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return {
    status: checks.some((c) => c.status === "EXCEEDED") ? "EXCEEDED"
      : checks.some((c) => c.status === "NOT_CHECKED") ? "NOT_CHECKED" : "WITHIN_CEILING",
    checks,
  };
}

/**
 * Reading this protocol's stored rows (Spec #55, Spec #61).
 *
 * Two things every caller that starts from a database row needs, and neither of
 * which belongs to any one feature: turning a stored amount into `bigint` money,
 * and placing a row's timestamp against a reporting period.
 *
 * Pure on purpose - no database, no `store`, no `viem`, no network - so both the
 * reconciliation mapping and the period report can share it without either
 * reaching into the other.
 */

import { money, type Money, type ReportingPeriod } from "./reconciliation";

const USDC_MINOR_UNIT_SCALE = 1_000_000n;

/**
 * Amount columns are declared `bigint({ mode: "number" })`, so the driver hands
 * back a JavaScript number and the boundary is already crossed by the time a row
 * reaches here. This accepts the string form too, and refuses anything that is
 * not a whole amount rather than rounding a fraction away in silence.
 */
export function toWholeAmount(value: number | string, what: string): bigint {
  if (typeof value === "string") {
    if (!/^-?\d+$/.test(value.trim())) {
      throw new Error(`${what} bukan bilangan bulat: "${value}".`);
    }
    return BigInt(value.trim());
  }
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${what} bukan bilangan bulat: ${value}.`);
  }
  return BigInt(value);
}

/**
 * Proposal amounts are stored either as whole USDC or as 6-decimal minor units,
 * depending on which writer produced the row. This mirrors the heuristic the
 * proposal read path already uses, so every surface reads a row the same way.
 */
export function toUsdcMinorUnits(amount: number | string): bigint {
  const value = toWholeAmount(amount, "Jumlah USDC");
  return value < USDC_MINOR_UNIT_SCALE ? value * USDC_MINOR_UNIT_SCALE : value;
}

export type AmountRow = {
  proposalIdOnChain: number;
  currencyType: number; // 0: IDR, 1: USDC
  amount: number | string;
};

export const unitOfCurrencyType = (currencyType: number) =>
  currencyType === 1 ? ("USDC_6DP" as const) : ("IDR" as const);

export function proposalAmount(row: AmountRow): Money {
  return row.currencyType === 1
    ? money(toUsdcMinorUnits(row.amount), "USDC_6DP")
    : money(toWholeAmount(row.amount, `Jumlah proposal #${row.proposalIdOnChain}`), "IDR");
}

/** Half-open bounds of a reporting period: [from, to). */
export function periodBounds(period: ReportingPeriod): { from: Date; to: Date } {
  const from = new Date(Date.UTC(period.year, 0, 1));
  const to =
    period.kind === "SEMESTER"
      ? new Date(Date.UTC(period.year, 6, 1))
      : new Date(Date.UTC(period.year + 1, 0, 1));
  return { from, to };
}

/**
 * Where a row's timestamp sits relative to a reporting period.
 *
 * `UNDATED` is kept apart from `OUTSIDE` on purpose, because the two callers
 * want opposite things from it. Reconciliation must never let a period filter
 * hide a row - an unseen row is an unreported discrepancy. A period report must
 * never count one either, because a row with no usable date would otherwise be
 * counted in *every* period, and this is a figure somebody signs.
 */
export type PeriodPlacement = "INSIDE" | "OUTSIDE" | "UNDATED";

/**
 * A stored timestamp as a `Date`, or null when there is no readable one.
 *
 * The single reader for every stored date column, so "this row has no usable
 * date" means the same thing to a period filter, a period figure and a stage
 * duration. Absent, empty and unparseable all collapse to null here on purpose:
 * a caller that has to tell those apart is asking a question the column cannot
 * answer.
 */
export function readableTime(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** The same timestamp as ISO text, or null when there is no readable one. */
export const readableIso = (value: Date | string | null | undefined): string | null =>
  readableTime(value)?.toISOString() ?? null;

export const isAttested = (row: { auditStatus?: string | null }): boolean =>
  Boolean(row.auditStatus) && String(row.auditStatus).toUpperCase() !== "PENDING";

export function placeInPeriod(
  timestamp: Date | string | null | undefined,
  period: ReportingPeriod
): PeriodPlacement {
  const at = readableTime(timestamp);
  if (at === null) return "UNDATED";
  const { from, to } = periodBounds(period);
  return at >= from && at < to ? "INSIDE" : "OUTSIDE";
}

/** Reconciliation's lenient rule: an undated row is never hidden by a filter. */
export const withinPeriod = (
  timestamp: Date | string | null | undefined,
  period: ReportingPeriod
): boolean => placeInPeriod(timestamp, period) !== "OUTSIDE";

/**
 * Presentation of reported figures, shared by every reporting feature slice.
 *
 * Amounts arrive as decimal strings and are formatted straight from those
 * strings. At national scale a rupiah figure runs past what a JavaScript number
 * can hold exactly, so nothing here ever converts to `number` - a single silent
 * rounding at the order of a trillion would erase the whole point of the tool.
 */

/** Every unit a reported quantity can carry across the wire. */
export type ReportedUnit = "IDR" | "USDC_6DP" | "BPS" | "COUNT" | "JAM";

export type ReportingPeriodLike = { kind: string; year: number };

/** An `(amount, unit)` pair exactly as it crosses the wire. */
export type ReportedQuantity = { amount: string; unit: ReportedUnit };

/** Groups a decimal string with Indonesian thousand separators. */
export function groupDigits(amount: string): string {
  const negative = amount.startsWith("-");
  const digits = negative ? amount.slice(1) : amount;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return negative ? `-${grouped}` : grouped;
}

/**
 * Renders an integer held in `decimals` minor units as the figure a reader
 * expects, with trailing zeros trimmed. Every fixed-point unit in this system -
 * USDC at six decimals, basis points at two - is the same problem once, so it is
 * solved once and never with a float.
 */
function formatScaled(amount: string, decimals: number): string {
  const negative = amount.startsWith("-");
  const digits = (negative ? amount.slice(1) : amount).padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  const rendered = fraction ? `${groupDigits(whole)},${fraction}` : groupDigits(whole);
  return negative ? `-${rendered}` : rendered;
}

/** Renders 6-decimal USDC minor units as a human figure, without floats. */
export const formatUsdc = (amount: string): string => formatScaled(amount, 6);

/** Basis points as the percentage a reader expects, without floats. */
export const formatBps = (amount: string): string => `${formatScaled(amount, 2)}%`;

/**
 * Whole hours as the span a reader thinks in: days and hours, never a decimal.
 * The stored figure stays the hour count it always was - this only chooses the
 * words for it, so nothing here can drift from the number the validator checked.
 */
export function formatHours(amount: string): string {
  const negative = amount.startsWith("-");
  const hours = BigInt(negative ? amount.slice(1) : amount);
  const days = hours / 24n;
  const rest = hours % 24n;

  const spoken =
    days === 0n
      ? `${rest} jam`
      : rest === 0n
        ? `${groupDigits(days.toString())} hari`
        : `${groupDigits(days.toString())} hari ${rest} jam`;

  return negative ? `-${spoken}` : spoken;
}

/** Renders any reported quantity in the words its unit calls for. */
export function formatQuantity(quantity: ReportedQuantity): string {
  switch (quantity.unit) {
    case "USDC_6DP":
      return `${formatUsdc(quantity.amount)} USDC`;
    case "BPS":
      return formatBps(quantity.amount);
    case "COUNT":
      return groupDigits(quantity.amount);
    case "JAM":
      return formatHours(quantity.amount);
    default:
      return `Rp${groupDigits(quantity.amount)}`;
  }
}

export const periodLabel = (period: ReportingPeriodLike): string =>
  period.kind === "SEMESTER"
    ? `Semester I ${period.year} (1 Januari-30 Juni)`
    : `Akhir Tahun ${period.year} (1 Januari-31 Desember)`;

/** The short form, for a file name or a chip. */
export const periodShortLabel = (period: ReportingPeriodLike): string =>
  period.kind === "SEMESTER" ? `Semester I ${period.year}` : `Akhir Tahun ${period.year}`;

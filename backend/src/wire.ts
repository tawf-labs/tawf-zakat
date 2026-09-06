/**
 * Wire codec shared by the stateless report routes (Spec #55, Spec #61).
 *
 * The pure cores speak `bigint`; JSON does not. Every amount therefore crosses
 * the wire as a decimal string, in both directions, so trillion-scale rupiah
 * survives the round trip exactly.
 *
 * A quantity on the wire is an `(amount, unit)` pair. Currency is one vocabulary
 * of units; period figures add basis points and plain counts on top. Nothing in
 * this module ever adds two quantities together, so widening the vocabulary
 * cannot make a report mix units that must never be mixed.
 *
 * Pure on purpose: no database, no `store`, no `viem`, no network.
 */

import type { CurrencyUnit, Money, ReportingPeriod } from "./reconciliation";

/** Thrown when a request body cannot be decoded into engine inputs. */
export class WireInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WireInputError";
  }
}

export function fail(message: string): never {
  throw new WireInputError(message);
}

export function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${what} harus berupa objek.`);
  }
  return value as Record<string, unknown>;
}

/**
 * Decodes a whole amount. Decimal text is the canonical form; a JSON number is
 * accepted for small values but a fraction is refused rather than rounded away.
 */
export function parseWholeAmount(raw: unknown, where: string): bigint {
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number") {
    if (!Number.isInteger(raw)) fail(`${where} memiliki jumlah yang bukan bilangan bulat: ${raw}.`);
    return BigInt(raw);
  }
  if (typeof raw !== "string" || !/^-?\d+$/.test(raw.trim())) {
    fail(
      `${where} memiliki jumlah yang bukan bilangan bulat: ${JSON.stringify(raw)}. ` +
        `Tulis rupiah penuh tanpa titik atau desimal, sebagai teks angka.`
    );
  }
  return BigInt(raw.trim());
}

export type WireQuantity = { amount: string; unit: string };

/**
 * Decodes an `(amount, unit)` pair against the vocabulary of units the caller
 * allows. An unknown unit is refused by name: silently defaulting it would let a
 * typo become a legal unit and, from there, a figure nobody can trace.
 */
export function parseQuantity<U extends string>(
  raw: unknown,
  where: string,
  allowedUnits: readonly U[],
  fallbackUnit: U
): { amount: bigint; unit: U } {
  const record = asRecord(raw, `${where}: nilai`);
  const unit = record.unit ?? fallbackUnit;
  if (!allowedUnits.includes(unit as U)) {
    fail(
      `${where} memakai unit tidak dikenal: ${JSON.stringify(unit)}. ` +
        `Gunakan ${allowedUnits.map((u) => `"${u}"`).join(" atau ")}.`
    );
  }
  return { amount: parseWholeAmount(record.amount, where), unit: unit as U };
}

export const CURRENCY_UNITS: readonly CurrencyUnit[] = ["IDR", "USDC_6DP"];

export const parseMoney = (raw: unknown, where: string): Money =>
  parseQuantity(raw, where, CURRENCY_UNITS, "IDR");

export const serializeQuantity = (value: { amount: bigint; unit: string }): WireQuantity => ({
  amount: value.amount.toString(),
  unit: value.unit,
});

export const PERIOD_KINDS = ["SEMESTER", "AKHIR_TAHUN"] as const;

export function parseReportingPeriod(raw: unknown, what: string): ReportingPeriod {
  const record = asRecord(raw, what);
  if (!PERIOD_KINDS.includes(record.kind as (typeof PERIOD_KINDS)[number])) {
    fail(
      `${what} memakai jenis periode pelaporan tidak dikenal: ${JSON.stringify(record.kind)}. ` +
        `Gunakan "SEMESTER" (1 Januari-30 Juni) atau "AKHIR_TAHUN" (1 Januari-31 Desember).`
    );
  }
  const year = record.year;
  if (typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > 2100) {
    fail(`${what} memakai tahun periode pelaporan yang tidak masuk akal: ${JSON.stringify(year)}.`);
  }
  return { kind: record.kind as ReportingPeriod["kind"], year };
}

export const describePeriod = (period: ReportingPeriod): string => `${period.kind} ${period.year}`;

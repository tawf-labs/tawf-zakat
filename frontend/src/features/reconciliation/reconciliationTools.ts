/**
 * Working tools for a reconciliation result: narrowing it down, and getting it
 * back out as a file that can be attached to a correction request.
 *
 * Everything here is a pure function over the report, so the behaviour is
 * testable without rendering anything.
 */

import { bucketLabel, DISCREPANCY_LABELS, deltaDirection, periodLabel } from "./format";
import {
  isEntryLevelKind,
  type DiscrepancyKind,
  type ReconciliationReport,
  type WireDiscrepancy,
} from "./types";

export type DiscrepancyFilters = {
  /** Empty means every jenis dana. */
  buckets: string[];
  /** Empty means every jenis selisih. */
  kinds: DiscrepancyKind[];
};

export const EMPTY_FILTERS: DiscrepancyFilters = { buckets: [], kinds: [] };

export function filterDiscrepancies(
  discrepancies: WireDiscrepancy[],
  filters: DiscrepancyFilters
): WireDiscrepancy[] {
  return discrepancies.filter((discrepancy) => {
    if (filters.buckets.length > 0 && !filters.buckets.includes(discrepancy.bucket)) return false;
    if (filters.kinds.length > 0 && !filters.kinds.includes(discrepancy.kind)) return false;
    return true;
  });
}

export const hasActiveFilters = (filters: DiscrepancyFilters): boolean =>
  filters.buckets.length > 0 || filters.kinds.length > 0;

/** Buckets present in a report, so the filter only offers what is really there. */
export function bucketsInReport(report: ReconciliationReport): string[] {
  return [...new Set(report.discrepancies.map((d) => d.bucket))].sort();
}

export function kindsInReport(report: ReconciliationReport): DiscrepancyKind[] {
  return [...new Set(report.discrepancies.map((d) => d.kind))].sort() as DiscrepancyKind[];
}

/** Sums signed decimal strings exactly - these run past what a float holds. */
export function sumAmounts(amounts: string[]): string {
  return amounts.reduce((total, amount) => (BigInt(total) + BigInt(amount)).toString(), "0");
}

export function netDeltaOf(discrepancies: WireDiscrepancy[]): string {
  return sumAmounts(discrepancies.filter((d) => isEntryLevelKind(d.kind)).map((d) => d.delta.amount));
}

// --- File intake -----------------------------------------------------------

const SUPPORTED_EXTENSIONS = [".csv", ".tsv", ".txt"];

export type FileLike = { name: string; type?: string };

export function isSupportedLedgerFile(file: FileLike): boolean {
  const name = file.name.toLowerCase();
  if (SUPPORTED_EXTENSIONS.some((extension) => name.endsWith(extension))) return true;
  return Boolean(file.type && file.type.startsWith("text/"));
}

export function unsupportedFileMessage(file: FileLike): string {
  return (
    `Berkas "${file.name}" belum bisa dibaca. Yang diharapkan adalah berkas teks bertabel ` +
    `(.csv, .tsv, atau .txt) dengan satu baris per entri: kode PZ, nama PZ, jenis dana, ` +
    `posisi neraca (opsional), jumlah. Dari Excel, gunakan "Save As" lalu pilih CSV.`
  );
}

// --- Export ----------------------------------------------------------------

const CSV_DELIMITER = ";";

const csvCell = (value: string): string =>
  /["\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const csvRow = (cells: string[]): string => cells.map(csvCell).join(CSV_DELIMITER);

export type ExportContext = {
  report: ReconciliationReport;
  discrepancies: WireDiscrepancy[];
  /** Which balance sheet position the reconciliation was scoped to, if any. */
  balanceSheet?: "ON" | "OFF" | null;
  checkedAt: Date;
  filtered: boolean;
};

/**
 * Renders the discrepancy report as a semicolon-separated file, the separator
 * Indonesian spreadsheet locales open without a fuss. Amounts are written as
 * plain integers so the receiving spreadsheet does not reinterpret them.
 */
export function toCsv({
  report,
  discrepancies,
  balanceSheet,
  checkedAt,
  filtered,
}: ExportContext): string {
  const netDelta = netDeltaOf(discrepancies);
  const unit = report.netDelta.unit;

  const preamble = [
    csvRow(["Laporan Rekonsiliasi"]),
    csvRow(["Periode pelaporan", periodLabel(report.period)]),
    csvRow(["Sisi klaim", report.claimLabel]),
    csvRow(["Sisi sumber", report.sourceLabel]),
    csvRow([
      "Posisi neraca",
      balanceSheet === "ON"
        ? "On balance sheet"
        : balanceSheet === "OFF"
          ? "Off balance sheet"
          : "Seluruh posisi",
    ]),
    csvRow(["Waktu pemeriksaan", checkedAt.toISOString()]),
    csvRow(["Cakupan baris", filtered ? "Sesuai filter yang aktif" : "Seluruh selisih"]),
    csvRow(["Total selisih bersih", netDelta, unit]),
    csvRow(["Jumlah selisih", String(discrepancies.length)]),
    csvRow([]),
  ];

  const header = csvRow([
    "Kode",
    "Pengelola Zakat",
    "Jenis dana",
    "Jenis selisih",
    "Arah",
    "Nilai klaim",
    "Nilai sumber",
    "Selisih",
    "Unit",
  ]);

  const rows = discrepancies.map((discrepancy) =>
    csvRow([
      discrepancy.key,
      discrepancy.label ?? "",
      bucketLabel(discrepancy.bucket),
      DISCREPANCY_LABELS[discrepancy.kind],
      deltaDirection(discrepancy.kind, discrepancy.delta.amount),
      discrepancy.claimValue?.amount ?? "",
      discrepancy.sourceValue?.amount ?? "",
      discrepancy.delta.amount,
      discrepancy.delta.unit,
    ])
  );

  return [...preamble, header, ...rows].join("\n");
}

export function exportFileName(report: ReconciliationReport, checkedAt: Date): string {
  const stamp = checkedAt.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `rekonsiliasi-${report.period.kind.toLowerCase()}-${report.period.year}-${stamp}.csv`;
}

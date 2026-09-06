import { describe, expect, it } from "bun:test";
import {
  bucketsInReport,
  exportFileName,
  filterDiscrepancies,
  hasActiveFilters,
  isSupportedLedgerFile,
  kindsInReport,
  netDeltaOf,
  toCsv,
  unsupportedFileMessage,
  EMPTY_FILTERS,
} from "./reconciliationTools";
import type { ReconciliationReport, WireDiscrepancy } from "./types";

const gap = (
  key: string,
  bucket: string,
  amount: string,
  kind: WireDiscrepancy["kind"] = "AMOUNT_MISMATCH",
  label?: string
): WireDiscrepancy => ({
  kind,
  key,
  bucket,
  delta: { amount, unit: "IDR" },
  claimValue: { amount: amount.replace(/^-/, ""), unit: "IDR" },
  sourceValue: { amount: "0", unit: "IDR" },
  ...(label ? { label } : {}),
});

const report: ReconciliationReport = {
  balanced: false,
  period: { kind: "AKHIR_TAHUN", year: 2024 },
  claimLabel: "Rekap Wilayah Riau",
  sourceLabel: "12 Laporan Kab/Kota",
  netDelta: { amount: "1400000", unit: "IDR" },
  absoluteDelta: { amount: "1600000", unit: "IDR" },
  discrepancies: [
    gap("PZ-1401", "ZAKAT", "1000000", "AMOUNT_MISMATCH", "BAZNAS Kab. Kampar"),
    gap("PZ-1471", "INFAK_SEDEKAH", "500000", "MISSING_IN_SOURCE", "BAZNAS Kota Pekanbaru"),
    gap("PZ-1403", "ZAKAT", "-100000", "MISSING_IN_CLAIM", "BAZNAS Kab. Rokan Hulu"),
    gap("TOTAL-ZAKAT", "ZAKAT", "700000", "BUCKET_TOTAL_MISMATCH", "Rekap Wilayah Riau"),
  ],
  entryCounts: { claim: 12, source: 12, matched: 10 },
};

describe("filtering a reconciliation result", () => {
  it("returns everything when no filter is set", () => {
    expect(filterDiscrepancies(report.discrepancies, EMPTY_FILTERS)).toHaveLength(4);
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it("narrows to one jenis dana", () => {
    const filtered = filterDiscrepancies(report.discrepancies, { buckets: ["ZAKAT"], kinds: [] });
    expect(filtered.map((d) => d.key)).toEqual(["PZ-1401", "PZ-1403", "TOTAL-ZAKAT"]);
  });

  it("narrows to one jenis selisih", () => {
    const filtered = filterDiscrepancies(report.discrepancies, {
      buckets: [],
      kinds: ["MISSING_IN_SOURCE"],
    });
    expect(filtered.map((d) => d.key)).toEqual(["PZ-1471"]);
  });

  it("combines both filters", () => {
    const filtered = filterDiscrepancies(report.discrepancies, {
      buckets: ["ZAKAT"],
      kinds: ["AMOUNT_MISMATCH"],
    });
    expect(filtered.map((d) => d.key)).toEqual(["PZ-1401"]);
    expect(hasActiveFilters({ buckets: ["ZAKAT"], kinds: ["AMOUNT_MISMATCH"] })).toBe(true);
  });

  it("keeps the headline total consistent with whatever is shown", () => {
    const all = filterDiscrepancies(report.discrepancies, EMPTY_FILTERS);
    // The declared-total finding is not an entry-level gap and stays out of the net.
    expect(netDeltaOf(all)).toBe("1400000");

    const onlyZakat = filterDiscrepancies(report.discrepancies, { buckets: ["ZAKAT"], kinds: [] });
    expect(netDeltaOf(onlyZakat)).toBe("900000");
  });

  it("offers only the buckets and kinds actually present", () => {
    expect(bucketsInReport(report)).toEqual(["INFAK_SEDEKAH", "ZAKAT"]);
    expect(kindsInReport(report)).toEqual([
      "AMOUNT_MISMATCH",
      "BUCKET_TOTAL_MISMATCH",
      "MISSING_IN_CLAIM",
      "MISSING_IN_SOURCE",
    ]);
  });
});

describe("accepting a report file", () => {
  it("accepts the tabular text formats an Amil exports", () => {
    expect(isSupportedLedgerFile({ name: "laporan.csv", type: "text/csv" })).toBe(true);
    expect(isSupportedLedgerFile({ name: "laporan.tsv" })).toBe(true);
    expect(isSupportedLedgerFile({ name: "REKAP.TXT" })).toBe(true);
    expect(isSupportedLedgerFile({ name: "rekap", type: "text/plain" })).toBe(true);
  });

  it("refuses a format it cannot read and says what it expects", () => {
    const file = { name: "laporan.xlsx", type: "application/vnd.ms-excel" };
    expect(isSupportedLedgerFile(file)).toBe(false);
    const message = unsupportedFileMessage(file);
    expect(message).toContain("laporan.xlsx");
    expect(message).toContain(".csv");
    expect(message).toContain("jenis dana");
  });
});

describe("exporting the discrepancy report", () => {
  const checkedAt = new Date("2026-09-06T04:05:06.000Z");

  it("carries the period, both side labels and the time of the check", () => {
    const csv = toCsv({
      report,
      discrepancies: report.discrepancies,
      balanceSheet: null,
      checkedAt,
      filtered: false,
    });

    expect(csv).toContain("Akhir Tahun 2024");
    expect(csv).toContain("Rekap Wilayah Riau");
    expect(csv).toContain("12 Laporan Kab/Kota");
    expect(csv).toContain("2026-09-06T04:05:06.000Z");
    expect(csv).toContain("Seluruh posisi");
  });

  it("writes one row per discrepancy with plain integer amounts", () => {
    const csv = toCsv({
      report,
      discrepancies: report.discrepancies,
      balanceSheet: "ON",
      checkedAt,
      filtered: false,
    });
    const lines = csv.split("\n");
    const headerIndex = lines.findIndex((line) => line.startsWith("Kode;"));

    expect(headerIndex).toBeGreaterThan(0);
    expect(lines).toHaveLength(headerIndex + 1 + report.discrepancies.length);
    expect(lines[headerIndex + 1]).toContain("PZ-1401");
    expect(lines[headerIndex + 1]).toContain("1000000");
    expect(lines[headerIndex + 1]).not.toContain("Rp");
    expect(csv).toContain("On balance sheet");
  });

  it("exports exactly what the filters left on screen", () => {
    const filtered = filterDiscrepancies(report.discrepancies, {
      buckets: ["INFAK_SEDEKAH"],
      kinds: [],
    });
    const csv = toCsv({ report, discrepancies: filtered, balanceSheet: null, checkedAt, filtered: true });

    expect(csv).toContain("Sesuai filter yang aktif");
    expect(csv).toContain("PZ-1471");
    expect(csv).not.toContain("PZ-1401");
    expect(csv).toContain("Total selisih bersih;500000;IDR");
  });

  it("quotes a field that contains the delimiter", () => {
    const withSemicolon = {
      ...report,
      discrepancies: [gap("PZ-1", "ZAKAT", "1000", "AMOUNT_MISMATCH", "BAZNAS Kampar; Riau")],
    };
    const csv = toCsv({
      report: withSemicolon,
      discrepancies: withSemicolon.discrepancies,
      balanceSheet: null,
      checkedAt,
      filtered: false,
    });

    expect(csv).toContain('"BAZNAS Kampar; Riau"');
  });

  it("names the download after the period and the moment it was run", () => {
    expect(exportFileName(report, checkedAt)).toBe(
      "rekonsiliasi-akhir_tahun-2024-2026-09-06-04-05-06.csv"
    );
  });
});

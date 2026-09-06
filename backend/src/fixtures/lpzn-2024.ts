/**
 * Golden fixture - Laporan Pengelola Zakat Nasional (LPZN) Akhir Tahun 2024.
 *
 * Two tables printed two pages apart in the same official BAZNAS publication,
 * both labelled "Sumber Data: SIMBA" and "Data per tanggal 11 Februari 2025",
 * report a different national collection figure for the same year. Each table
 * is internally consistent - its rows add up to its own printed total - which
 * is precisely why no per-row check would ever catch the gap between them.
 *
 * Source PDF:
 *   https://baznas.go.id/assets/images/szn/LPZ%20Nasional%20Akhir%20Tahun%202024.pdf
 *   - Tabel 2.2 "Pertumbuhan Pengumpulan Nasional Tahun 2024 per Jenis Dana", hal. 18
 *   - Tabel 2.3 "Pertumbuhan Pengumpulan Nasional Tahun 2024 per Jenis Pengelola Zakat", hal. 19
 *
 * Re-verify (Lampiran A, docs/research/0002-baznas-pelaporan-audit-dan-ai.md):
 *   pdftotext -layout lpzn2024.pdf lpzn2024.txt
 *   grep -n "11,622,127,523,247\|10,954,107,312,973" lpzn2024.txt
 *
 * The figures below are the 2024 column, transcribed exactly as printed.
 */

import {
  GRAND_TOTAL_BUCKET,
  JENIS_DANA,
  type LedgerEntry,
  type LedgerSide,
  type ReportingPeriod,
} from "../reconciliation";

export const LPZN_2024_PERIOD: ReportingPeriod = { kind: "AKHIR_TAHUN", year: 2024 };

/** Aggregate row both tables print for funds held off the balance sheet. */
export const ZIS_DSKL_OFF_BALANCE_SHEET_BUCKET = "ZIS_DSKL";

/** Jenis Pengelola Zakat - the bucket dimension Tabel 2.3 is cut along. */
export const JENIS_PENGELOLA_ZAKAT = [
  "BAZNAS",
  "BAZNAS_PROVINSI",
  "BAZNAS_KAB_KOTA",
  "LAZ_NASIONAL",
  "LAZ_PROVINSI",
  "LAZ_KAB_KOTA",
] as const;

/**
 * The two tables are cut along different dimensions, so a reconciliation across
 * them has to accept both vocabularies at once.
 */
export const LPZN_2024_BUCKETS: readonly string[] = [
  ...JENIS_DANA,
  ZIS_DSKL_OFF_BALANCE_SHEET_BUCKET,
  ...JENIS_PENGELOLA_ZAKAT,
];

const NASIONAL = "NASIONAL-2024";

const idr = (amount: bigint) => ({ amount, unit: "IDR" as const });

const row = (bucket: string, amount: bigint, label: string): LedgerEntry => ({
  key: NASIONAL,
  bucket,
  balanceSheet: "ON",
  value: idr(amount),
  label,
});

const offBalanceSheetRow = (amount: bigint, label: string): LedgerEntry => ({
  key: NASIONAL,
  bucket: ZIS_DSKL_OFF_BALANCE_SHEET_BUCKET,
  balanceSheet: "OFF",
  value: idr(amount),
  label,
});

const grandTotal = (
  key: string,
  amount: bigint,
  balanceSheet: "ON" | "OFF",
  label: string
): LedgerEntry => ({
  key,
  bucket: GRAND_TOTAL_BUCKET,
  balanceSheet,
  value: idr(amount),
  label,
});

/** LPZN Akhir Tahun 2024, Tabel 2.2 - pengumpulan 2024 per jenis dana. */
export const TABEL_2_2_PER_JENIS_DANA: LedgerSide = {
  label: "LPZN 2024 Tabel 2.2 (per jenis dana)",
  entries: [
    row("ZAKAT", 4_350_099_606_318n, "Zakat Mal"),
    row("FITRAH", 618_668_807_899n, "Zakat Fitrah"),
    row("INFAK_SEDEKAH", 3_759_094_821_080n, "Infak/Sedekah"),
    row("KURBAN", 2_695_928_225_424n, "Kurban"),
    row("DSKL", 198_336_062_526n, "Dana Sosial Keagamaan Lainnya"),
    offBalanceSheetRow(28_887_733_938_943n, "ZIS-DSKL Off Balance Sheet"),
  ],
  declaredTotals: [
    grandTotal("TOTAL-ON-2.2", 11_622_127_523_247n, "ON", "Total on balance sheet (tercetak)"),
    grandTotal("TOTAL-OFF-2.2", 28_887_733_938_943n, "OFF", "Total off balance sheet (tercetak)"),
  ],
};

/** LPZN Akhir Tahun 2024, Tabel 2.3 - pengumpulan 2024 per jenis Pengelola Zakat. */
export const TABEL_2_3_PER_JENIS_PENGELOLA_ZAKAT: LedgerSide = {
  label: "LPZN 2024 Tabel 2.3 (per jenis Pengelola Zakat)",
  entries: [
    row("BAZNAS", 1_129_733_837_481n, "BAZNAS (1 PZ)"),
    row("BAZNAS_PROVINSI", 925_076_124_372n, "BAZNAS Provinsi (34 PZ)"),
    row("BAZNAS_KAB_KOTA", 2_176_987_785_735n, "BAZNAS Kabupaten/Kota (514 PZ)"),
    row("LAZ_NASIONAL", 6_142_328_062_482n, "LAZ Nasional (47 PZ)"),
    row("LAZ_PROVINSI", 363_010_435_724n, "LAZ Provinsi (40 PZ)"),
    row("LAZ_KAB_KOTA", 216_971_067_179n, "LAZ Kabupaten/Kota (86 PZ)"),
    offBalanceSheetRow(29_493_257_261_484n, "ZIS-DSKL Off Balance Sheet"),
  ],
  declaredTotals: [
    grandTotal("TOTAL-ON-2.3", 10_954_107_312_973n, "ON", "Total on balance sheet (tercetak)"),
    grandTotal("TOTAL-OFF-2.3", 29_493_257_261_484n, "OFF", "Total off balance sheet (tercetak)"),
  ],
};

/** Grand totals as printed at the foot of each table (on plus off balance sheet). */
export const GRAND_TOTAL_TERCETAK_TABEL_2_2 = 40_509_861_462_190n;
export const GRAND_TOTAL_TERCETAK_TABEL_2_3 = 40_447_364_574_457n;

/** Tabel 2.2 minus Tabel 2.3, on balance sheet: Rp668.020.210.274. */
export const SELISIH_ON_BALANCE_SHEET_2024 = 668_020_210_274n;

/** Tabel 2.2 minus Tabel 2.3, off balance sheet: -Rp605.523.322.541. */
export const SELISIH_OFF_BALANCE_SHEET_2024 = -605_523_322_541n;

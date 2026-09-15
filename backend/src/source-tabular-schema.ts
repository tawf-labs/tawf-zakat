/**
 * Source Tabular Schema Mapper (Spec #86, Ticket #88).
 *
 * Maps a decoded TabularTable (from shared/tabular-reader) into normalized
 * evidence source rows according to the source manifest.
 *
 * Rules:
 * 1. Preserves every row including broken ones (US-24, Scenario 5).
 * 2. Does not turn missing/invalid rows into zeros.
 * 3. Marks calculated totals as partial when invalid rows are present.
 * 4. Rejects unsupported columns with explicit Indonesian messages.
 * 5. Preserves text identifiers and high-precision integer rupiah.
 */

import {
  GRAND_TOTAL_BUCKET,
  JENIS_DANA,
  type BalanceSheetPosition,
  type CurrencyUnit,
} from "./reconciliation";
import type { NormalizedRow, SourceIssue, SourceManifest } from "./evidence-source";
import type { TabularTable, TabularRow } from "../../shared/tabular-reader";

/** Supported column aliases mapped to canonical names */
const COLUMN_ALIASES: Record<string, string> = {
  // Key / Identifier
  key: "key",
  kode: "key",
  identitas_entri: "key",
  id_transaksi: "key",
  nomor_transaksi: "key",
  key_entri: "key",
  nomor_entri: "key",

  // Bucket / Fund type
  bucket: "bucket",
  jenis_dana: "bucket",
  dana: "bucket",
  kategori_dana: "bucket",

  // Balance sheet position
  balance_sheet: "balance_sheet",
  posisi_neraca: "balance_sheet",
  posisi: "balance_sheet",
  neraca: "balance_sheet",

  // Amount / Value
  amount: "amount",
  nilai: "amount",
  jumlah: "amount",
  nominal: "amount",
  nilai_penuh: "amount",

  // Unit / Currency
  unit: "unit",
  mata_uang: "unit",
  satuan: "unit",

  // Amil Amount
  amil_amount: "amil_amount",
  hak_amil: "amil_amount",
  bagian_amil: "amil_amount",

  // Label / Description
  label: "label",
  uraian: "label",
  keterangan: "label",
  deskripsi: "label",

  // Reference
  reference: "reference",
  referensi: "reference",
  nomor_bukti: "reference",
  rujukan: "reference",

  // Total flag
  is_total: "is_total",
  is_declared_total: "is_total",
  apakah_total: "is_total",
  baris_total: "is_total",
};

export type InvalidRowRecord = {
  rowNumber: number;
  rawCells: Record<string, string>;
  issues: SourceIssue[];
};

export type TabularSourceMappingResult = {
  validRows: NormalizedRow[];
  invalidRows: InvalidRowRecord[];
  allRowsPreview: Array<{
    rowNumber: number;
    isValid: boolean;
    row: NormalizedRow | null;
    rawCells: Record<string, string>;
    issues: SourceIssue[];
  }>;
  declaredTotals: NormalizedRow[];
  issues: SourceIssue[];
  totalRows: number;
  validRowCount: number;
  invalidRowCount: number;
  calculableTotal: string; // BigInt sum of valid non-total rows
  isPartial: boolean; // True if there are invalid rows
};

/**
 * Parses integer amount from string, tolerating standard thousands separators
 * only if unambiguous, and rejecting fractions/decimals/invalid numbers.
 */
export function parseIntegerAmount(raw: string): { amount: string } | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { error: "Nilai jumlah kosong." };
  }

  // Reject decimal fractions outright
  if (/[.,]\d{1,2}$/.test(trimmed) && !/^\d{1,3}([.,]\d{3})+$/.test(trimmed)) {
    return {
      error: `Jumlah memuat bilangan desimal atau pecahan (${trimmed}). Masukkan bilangan bulat penuh tanpa desimal.`,
    };
  }

  // Strip thousands separators (dots or commas between 3 digits)
  let digitsOnly = trimmed;
  if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) {
    digitsOnly = trimmed.replace(/\./g, "");
  } else if (/^\d{1,3}(,\d{3})+$/.test(trimmed)) {
    digitsOnly = trimmed.replace(/,/g, "");
  }

  if (!/^\d+$/.test(digitsOnly)) {
    return {
      error: `Format angka tidak sah: "${trimmed}". Gunakan angka bilangan bulat tanpa titik/koma desimal.`,
    };
  }

  try {
    const val = BigInt(digitsOnly);
    if (val < 0n) {
      return { error: "Jumlah tidak boleh bernilai negatif." };
    }
    return { amount: val.toString() };
  } catch {
    return { error: `Nilai "${trimmed}" tidak dapat dibaca sebagai angka yang sah.` };
  }
}

/**
 * Maps a generic TabularTable to report source rows and checks against the manifest.
 */
export function mapSourceTabular(
  table: TabularTable,
  manifest: SourceManifest
): TabularSourceMappingResult {
  const fileIssues: SourceIssue[] = [];

  // Map normalized headers to canonical column keys
  const colMap = new Map<string, string>(); // canonical -> raw header
  const unrecognizedCols: string[] = [];

  for (let i = 0; i < table.headers.length; i++) {
    const rawHeader = table.headers[i];
    const norm = table.normalizedHeaders[i];
    const canonical = COLUMN_ALIASES[norm];

    if (canonical) {
      if (!colMap.has(canonical)) {
        colMap.set(canonical, norm);
      }
    } else {
      unrecognizedCols.push(rawHeader);
    }
  }

  if (unrecognizedCols.length > 0) {
    fileIssues.push({
      scope: "manifest",
      rowIndex: null,
      field: "columns",
      message:
        `Kolom berikut tidak didukung dalam template sumber laporan: "${unrecognizedCols.join('", "')}". ` +
        `Gunakan kolom resmi: key, jenis_dana, nilai, posisi_neraca, hak_amil, uraian, referensi, is_total.`,
    });
  }

  // Check required columns
  if (!colMap.has("key")) {
    fileIssues.push({
      scope: "manifest",
      rowIndex: null,
      field: "key",
      message: 'Kolom pengenal ("key" / "kode" / "identitas_entri") wajib tersedia.',
    });
  }
  if (!colMap.has("bucket")) {
    fileIssues.push({
      scope: "manifest",
      rowIndex: null,
      field: "bucket",
      message: 'Kolom jenis dana ("bucket" / "jenis_dana") wajib tersedia.',
    });
  }
  if (!colMap.has("amount")) {
    fileIssues.push({
      scope: "manifest",
      rowIndex: null,
      field: "amount",
      message: 'Kolom jumlah ("amount" / "nilai" / "jumlah") wajib tersedia.',
    });
  }

  const validRows: NormalizedRow[] = [];
  const declaredTotals: NormalizedRow[] = [];
  const invalidRows: InvalidRowRecord[] = [];
  const allRowsPreview: TabularSourceMappingResult["allRowsPreview"] = [];
  let calculableTotalBigInt = 0n;

  const keyCol = colMap.get("key");
  const bucketCol = colMap.get("bucket");
  const amountCol = colMap.get("amount");
  const posCol = colMap.get("balance_sheet");
  const unitCol = colMap.get("unit");
  const amilCol = colMap.get("amil_amount");
  const labelCol = colMap.get("label");
  const isTotalCol = colMap.get("is_total");

  for (let idx = 0; idx < table.rows.length; idx++) {
    const row = table.rows[idx];
    const rowIssues: SourceIssue[] = [];
    const rawCells = row.cells;
    const rowNumber = row.rowNumber;

    const rawKey = keyCol ? (rawCells[keyCol] ?? "").trim() : "";
    if (!rawKey) {
      rowIssues.push({
        scope: "row",
        rowIndex: idx,
        field: "key",
        message: `Baris ${rowNumber}: identitas entri (key) tidak boleh kosong.`,
      });
    }

    let rawBucket = bucketCol ? (rawCells[bucketCol] ?? "").trim().toUpperCase() : "";
    // Normalize aliases for common Indonesian terms
    if (rawBucket === "INFAQ" || rawBucket === "SEDEKAH" || rawBucket === "INFAK") {
      rawBucket = "INFAK_SEDEKAH";
    } else if (rawBucket === "ZAKAT_FITRAH") {
      rawBucket = "FITRAH";
    }
    const rawIsTotal = isTotalCol ? (rawCells[isTotalCol] ?? "").trim().toUpperCase() : "";
    const isDeclaredTotal =
      rawIsTotal === "YA" ||
      rawIsTotal === "TRUE" ||
      rawIsTotal === "1" ||
      rawBucket === GRAND_TOTAL_BUCKET;

    if (!isDeclaredTotal) {
      if (!rawBucket) {
        rowIssues.push({
          scope: "row",
          rowIndex: idx,
          field: "bucket",
          message: `Baris ${rowNumber}: jenis dana wajib diisi.`,
        });
      } else if (!(JENIS_DANA as readonly string[]).includes(rawBucket)) {
        rowIssues.push({
          scope: "row",
          rowIndex: idx,
          field: "bucket",
          message: `Baris ${rowNumber}: jenis dana "${rawBucket}" tidak dikenal. Gunakan salah satu dari: ${JENIS_DANA.join(", ")}.`,
        });
      } else if (!manifest.fundTypes.includes(rawBucket)) {
        rowIssues.push({
          scope: "row",
          rowIndex: idx,
          field: "bucket",
          message: `Baris ${rowNumber}: jenis dana "${rawBucket}" berada di luar cakupan manifest (${manifest.fundTypes.join(", ")}).`,
        });
      }
    }

    // Balance sheet position
    let balanceSheet: BalanceSheetPosition;
    const rawPos = posCol ? (rawCells[posCol] ?? "").trim().toUpperCase() : "";
    if (rawPos) {
      if (rawPos !== "ON" && rawPos !== "OFF") {
        rowIssues.push({
          scope: "row",
          rowIndex: idx,
          field: "balanceSheet",
          message: `Baris ${rowNumber}: posisi neraca "${rawPos}" tidak dikenal. Gunakan "ON" atau "OFF".`,
        });
        balanceSheet = "ON";
      } else if (manifest.balanceSheet !== "BOTH" && rawPos !== manifest.balanceSheet) {
        rowIssues.push({
          scope: "row",
          rowIndex: idx,
          field: "balanceSheet",
          message: `Baris ${rowNumber}: posisi neraca "${rawPos}" tidak cocok dengan cakupan manifest "${manifest.balanceSheet}".`,
        });
        balanceSheet = rawPos as BalanceSheetPosition;
      } else {
        balanceSheet = rawPos as BalanceSheetPosition;
      }
    } else {
      if (manifest.balanceSheet === "BOTH") {
        rowIssues.push({
          scope: "row",
          rowIndex: idx,
          field: "balanceSheet",
          message: `Baris ${rowNumber}: posisi neraca ("ON" atau "OFF") wajib diisi karena cakupan manifest adalah "BOTH".`,
        });
        balanceSheet = "ON";
      } else {
        balanceSheet = manifest.balanceSheet as BalanceSheetPosition;
      }
    }

    // Amount parsing
    const rawAmount = amountCol ? (rawCells[amountCol] ?? "") : "";
    let amountStr = "";
    if (!rawAmount) {
      rowIssues.push({
        scope: "row",
        rowIndex: idx,
        field: "amount",
        message: `Baris ${rowNumber}: nilai jumlah tidak boleh kosong.`,
      });
    } else {
      const parsedAmount = parseIntegerAmount(rawAmount);
      if ("error" in parsedAmount) {
        rowIssues.push({
          scope: "row",
          rowIndex: idx,
          field: "amount",
          message: `Baris ${rowNumber}: ${parsedAmount.error}`,
        });
      } else {
        amountStr = parsedAmount.amount;
      }
    }

    // Currency Unit
    const rawUnit = unitCol ? (rawCells[unitCol] ?? "").trim().toUpperCase() : "";
    const unit: CurrencyUnit = rawUnit
      ? (rawUnit as CurrencyUnit)
      : manifest.currencyUnit;
    if (rawUnit && rawUnit !== manifest.currencyUnit) {
      rowIssues.push({
        scope: "row",
        rowIndex: idx,
        field: "unit",
        message: `Baris ${rowNumber}: unit mata uang "${rawUnit}" berbeda dari manifest ("${manifest.currencyUnit}").`,
      });
    }

    // Amil Amount
    let amilAmountStr: string | null = null;
    const rawAmil = amilCol ? (rawCells[amilCol] ?? "").trim() : "";
    if (rawAmil) {
      if (isDeclaredTotal) {
        rowIssues.push({
          scope: "total",
          rowIndex: idx,
          field: "amilAmount",
          message: `Baris ${rowNumber}: hak amil tidak boleh dideklarasikan pada baris total.`,
        });
      } else {
        const parsedAmil = parseIntegerAmount(rawAmil);
        if ("error" in parsedAmil) {
          rowIssues.push({
            scope: "row",
            rowIndex: idx,
            field: "amilAmount",
            message: `Baris ${rowNumber}: hak amil tidak sah: ${parsedAmil.error}`,
          });
        } else {
          amilAmountStr = parsedAmil.amount;
        }
      }
    }

    const label = labelCol ? (rawCells[labelCol] ?? "").trim() || null : null;

    const isValid = rowIssues.length === 0;

    let normalized: NormalizedRow | null = null;
    if (isValid && amountStr !== "") {
      normalized = {
        key: rawKey,
        bucket: isDeclaredTotal ? GRAND_TOTAL_BUCKET : rawBucket,
        balanceSheet,
        amount: amountStr,
        unit,
        amilAmount: amilAmountStr,
        label,
        isDeclaredTotal,
      };

      if (isDeclaredTotal) {
        declaredTotals.push(normalized);
      } else {
        validRows.push(normalized);
        calculableTotalBigInt += BigInt(amountStr);
      }
    } else {
      invalidRows.push({
        rowNumber,
        rawCells,
        issues: rowIssues,
      });
    }

    allRowsPreview.push({
      rowNumber,
      isValid,
      row: normalized,
      rawCells,
      issues: rowIssues,
    });
  }

  const allIssues = [...fileIssues, ...invalidRows.flatMap((r) => r.issues)];

  return {
    validRows,
    invalidRows,
    allRowsPreview,
    declaredTotals,
    issues: allIssues,
    totalRows: table.rows.length,
    validRowCount: validRows.length + declaredTotals.length,
    invalidRowCount: invalidRows.length,
    calculableTotal: calculableTotalBigInt.toString(),
    isPartial: invalidRows.length > 0,
  };
}

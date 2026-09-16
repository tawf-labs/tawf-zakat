/**
 * A ledger side, and the manifest that says what it is (Spec #68, ticket #70).
 *
 * The reconciliation engine takes two sides of numbers. That is enough to find
 * a discrepancy and nowhere near enough to keep as evidence: six months later
 * nobody can tell which institution's records those were, which funds they
 * covered, on or off the balance sheet, in which currency, as of when, or in
 * which mapping they were read. So every side carries a **manifest**, and a
 * side with no manifest is refused rather than normalized into an anonymous
 * pile of rows.
 *
 * Three rules shape the rest:
 *
 * 1. **Refuse by row, and refuse all of them.** A person pasting a table wants
 *    every line that is wrong, with its index and its field - not the first one
 *    and a retry. Nothing is dropped or coerced: a row this module cannot read
 *    becomes an issue, never a zero.
 * 2. **Nothing is thrown away in normalization.** Fund type and balance-sheet
 *    position survive onto the stored row, because totals from two categories
 *    that got flattened into one hide exactly the discrepancy this is for.
 * 3. **An unread side is a first-class outcome.** A source that is missing or
 *    that failed is recorded with its reason and no rows - never as a side that
 *    was read and happened to contain nothing.
 *
 * Pure: no database, no clock, no network, no randomness. It takes a decoded
 * request body and the institution the session resolved to, and returns either
 * a side or the reasons it is not one.
 */

import {
  GRAND_TOTAL_BUCKET,
  JENIS_DANA,
  money,
  type BalanceSheetPosition,
  type CurrencyUnit,
  type LedgerEntry,
  type ReportingPeriod,
} from "./reconciliation";
import { CURRENCY_UNITS, PERIOD_KINDS } from "./wire";

export type SourceRole = "CLAIM" | "SOURCE";

/** How the rows reached the application. Named, not guessed from their shape. */
export const SOURCE_ORIGINS = ["UPLOAD", "PASTE", "PARTNER_EXPORT", "INTERNAL_LEDGER"] as const;
export type SourceOrigin = (typeof SOURCE_ORIGINS)[number];

/** Which balance-sheet positions the source claims to cover. */
export const MANIFEST_POSITIONS = ["ON", "OFF", "BOTH"] as const;
export type ManifestPosition = (typeof MANIFEST_POSITIONS)[number];

/**
 * Whether the source carries the transactions underneath its figures.
 *
 * A recap has totals and nothing else. Saying so is the difference between an
 * honest aggregate and a report that appears to evidence individual payments it
 * never contained; this application does not reconstruct the missing detail.
 */
export const TRANSACTION_DETAIL = ["PRESENT", "NOT_AVAILABLE"] as const;
export type TransactionDetail = (typeof TRANSACTION_DETAIL)[number];

/**
 * Which chain, contract, block range and indexer checkpoint a source was read
 * against (ticket #79). Present only on sources the server built from this
 * protocol's own indexed events; a pasted or uploaded source has no such scope
 * and carries the field not at all rather than carrying an empty one.
 */
export type ChainScope = import("./internal-usdc-source").ChainScope;

export type SourceManifest = {
  role: SourceRole;
  label: string;
  origin: SourceOrigin;
  /** The owning institution. Taken from the session, never from the payload. */
  institutionId: string;
  scopeUnit: string;
  scopeLevel: string;
  fundTypes: string[];
  balanceSheet: ManifestPosition;
  currencyUnit: CurrencyUnit;
  period: ReportingPeriod;
  /** ISO 8601 instant: the moment the source was cut. */
  cutOff: string;
  format: string;
  mappingVersion: string;
  transactionDetail: TransactionDetail;
  note: string | null;
  /** Only for server-built on-chain sources. Omitted entirely otherwise. */
  chainScope?: ChainScope;
};

/**
 * Where a row came from on chain, bound to the row itself (ticket #79).
 *
 * The key already encodes chain, contract, transaction and log, but a key is a
 * matching device; this is the evidence. `blockNumber` is null on a side that
 * legitimately does not know it - a ledger row records which event it came from,
 * not which block the mirror read it in - and is never filled in by inference.
 */
export type RowOrigin = {
  chainId: number;
  contract: string;
  txHash: string;
  logIndex: number;
  blockNumber: number | null;
  blockHash: string | null;
};

/**
 * A record that exists and could not be proved (ticket #79).
 *
 * Kept apart from a row on purpose: it has no amount this application is willing
 * to state. It travels with its side so that "not examined" is visible in the
 * package, rather than disappearing into a smaller row count.
 */
export type UnverifiedRecord = {
  side: SourceRole;
  /** Whatever names the record on its own side: a trxId, or txHash#logIndex. */
  reference: string;
  reason: string;
};

/**
 * One normalized row, in the exact shape that is frozen and stored.
 *
 * Amounts are decimal integer strings: `bigint` does not survive JSON and a
 * float does not survive `11_622_127_523_247`. Fund type and balance-sheet
 * position are columns of their own, so nothing is inferred from the key later.
 */
export type NormalizedRow = {
  key: string;
  bucket: string;
  balanceSheet: BalanceSheetPosition;
  amount: string;
  unit: CurrencyUnit;
  amilAmount: string | null;
  label: string | null;
  isDeclaredTotal: boolean;
  /** Only for rows mapped from on-chain identity. Omitted entirely otherwise. */
  origin?: RowOrigin;
};

export type ReadSide = {
  manifest: SourceManifest;
  status: "READ";
  rows: NormalizedRow[];
  /** Records this side holds but cannot prove. Omitted when there are none. */
  unverified?: UnverifiedRecord[];
};
export type UnreadSide = {
  manifest: SourceManifest;
  status: "MISSING" | "FAILED";
  detail: string;
  unverified?: UnverifiedRecord[];
};
export type SubmittedSide = ReadSide | UnreadSide;

/** One thing wrong, located precisely enough to fix without guessing. */
export type SourceIssue = {
  side?: SourceRole;
  scope: "manifest" | "row" | "total";
  /** Absent for manifest issues. */
  rowIndex: number | null;
  field: string;
  message: string;
};

export type NormalizedSubmission = { side: SubmittedSide | null; issues: SourceIssue[] };

/** An object, or nothing. A JSON array is not a record, however it is spelled. */
export const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** A trimmed string, or "". Anything that is not a string never became one here. */
export const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/** One thing wrong with a submission as a whole, rather than with a single row. */
export const manifestIssue = (field: string, message: string): SourceIssue => ({
  scope: "manifest",
  rowIndex: null,
  field,
  message,
});

/** ISO 8601 with a real instant behind it, not merely a string that parses. */
const isInstant = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));

function readManifest(
  raw: unknown,
  role: SourceRole,
  institutionId: string,
  issues: SourceIssue[]
): SourceManifest | null {
  const record = asRecord(raw);
  if (!record) {
    issues.push({
      scope: "manifest",
      rowIndex: null,
      field: "manifest",
      message:
        "Sisi ini tidak menyertakan manifest sumber. Baris angka tanpa asal, cakupan, dan cut-off " +
        "bukan bukti yang dapat diperiksa kemudian.",
    });
    return null;
  }

  const bad = (field: string, message: string) =>
    issues.push({ scope: "manifest", rowIndex: null, field: `manifest.${field}`, message });

  const label = text(record.label);
  if (label === "") bad("label", "Manifest harus menyebut nama sumbernya.");

  const origin = text(record.origin) as SourceOrigin;
  if (!SOURCE_ORIGINS.includes(origin)) {
    bad(
      "origin",
      `Asal sumber tidak dikenal: ${JSON.stringify(record.origin)}. Gunakan ${SOURCE_ORIGINS.join(", ")}. ` +
        `Ekspor lembaga lain diberi label PARTNER_EXPORT; kompatibilitas dengan ekspor SiMBA belum diuji ` +
        `dan tidak diklaim.`
    );
  }

  const scopeUnit = text(record.scopeUnit);
  if (scopeUnit === "") bad("scopeUnit", "Manifest harus menyebut unit atau lembaga yang dicakup.");
  const scopeLevel = text(record.scopeLevel);
  if (scopeLevel === "") bad("scopeLevel", "Manifest harus menyebut tingkat cakupannya.");

  const fundTypesRaw = record.fundTypes;
  const fundTypes = Array.isArray(fundTypesRaw) ? fundTypesRaw.map((item) => text(item)) : [];
  if (fundTypes.length === 0) {
    bad("fundTypes", "Manifest harus menyebut jenis dana yang dicakup sumber ini.");
  } else {
    const unknown = fundTypes.filter((fund) => !(JENIS_DANA as readonly string[]).includes(fund));
    if (unknown.length > 0) {
      bad(
        "fundTypes",
        `Jenis dana tidak dikenal: ${unknown.join(", ")}. Yang dikenal: ${JENIS_DANA.join(", ")}.`
      );
    }
  }

  const balanceSheet = text(record.balanceSheet) as ManifestPosition;
  if (!MANIFEST_POSITIONS.includes(balanceSheet)) {
    bad(
      "balanceSheet",
      `Posisi neraca cakupan tidak dikenal: ${JSON.stringify(record.balanceSheet)}. ` +
        `Gunakan "ON", "OFF", atau "BOTH".`
    );
  }

  const currencyUnit = text(record.currencyUnit) as CurrencyUnit;
  if (!CURRENCY_UNITS.includes(currencyUnit)) {
    bad(
      "currencyUnit",
      `Unit mata uang tidak dikenal: ${JSON.stringify(record.currencyUnit)}. ` +
        `Gunakan "IDR" atau "USDC_6DP"; keduanya tidak pernah dikonversi.`
    );
  }

  const periodRecord = asRecord(record.period);
  let period: ReportingPeriod | null = null;
  if (
    periodRecord &&
    PERIOD_KINDS.includes(periodRecord.kind as (typeof PERIOD_KINDS)[number]) &&
    typeof periodRecord.year === "number" &&
    Number.isInteger(periodRecord.year) &&
    periodRecord.year >= 2000 &&
    periodRecord.year <= 2100
  ) {
    period = { kind: periodRecord.kind as ReportingPeriod["kind"], year: periodRecord.year };
  } else {
    bad("period", "Manifest harus menyebut periode pelaporan yang sah (SEMESTER atau AKHIR_TAHUN).");
  }

  const cutOff = text(record.cutOff);
  if (!isInstant(cutOff)) {
    bad(
      "cutOff",
      `Cut-off harus berupa instant ISO 8601, misalnya "2025-02-11T00:00:00.000Z". ` +
        `Diterima: ${JSON.stringify(record.cutOff)}.`
    );
  }

  const format = text(record.format);
  if (format === "") bad("format", "Manifest harus menyebut format sumbernya.");
  const mappingVersion = text(record.mappingVersion);
  if (mappingVersion === "") {
    bad("mappingVersion", "Manifest harus menyebut versi pemetaan yang dipakai membaca sumber ini.");
  }

  const transactionDetail = text(record.transactionDetail) as TransactionDetail;
  if (!TRANSACTION_DETAIL.includes(transactionDetail)) {
    bad(
      "transactionDetail",
      `Ketersediaan rincian transaksi harus dinyatakan: "PRESENT" bila sumber memuat transaksinya, ` +
        `"NOT_AVAILABLE" bila sumber berupa rekap.`
    );
  }

  if (issues.some((issue) => issue.scope === "manifest")) return null;

  return {
    role,
    label,
    origin,
    // The payload may name an institution; it never decides one. Honouring it
    // would let an edit move ownership of somebody else's evidence.
    institutionId,
    scopeUnit,
    scopeLevel,
    fundTypes,
    balanceSheet,
    currencyUnit,
    period: period!,
    cutOff,
    format,
    mappingVersion,
    transactionDetail,
    note: text(record.note) === "" ? null : text(record.note),
  };
}

/** A whole decimal integer, or `null` with the reason recorded. */
function readWholeAmount(raw: unknown): { amount: string } | { error: string } {
  if (typeof raw === "number") {
    if (raw < 0) return { error: "Jumlah harus bilangan bulat tidak negatif." };
    if (!Number.isSafeInteger(raw)) {
      return {
        error:
          `Jumlah ${raw} bukan bilangan bulat aman dalam JSON. Tulis rupiah penuh sebagai teks angka ` +
          `agar presisinya utuh.`,
      };
    }
    return { amount: BigInt(raw).toString() };
  }
  const value = text(raw);
  if (!/^\d+$/.test(value)) {
    return {
      error:
        `Jumlah harus bilangan bulat tanpa titik, koma, atau desimal, ditulis sebagai teks angka. ` +
        `Diterima: ${JSON.stringify(raw)}.`,
    };
  }
  return { amount: BigInt(value).toString() };
}

function readRow(
  raw: unknown,
  index: number,
  manifest: SourceManifest,
  isTotal: boolean,
  issues: SourceIssue[]
): NormalizedRow | null {
  const scope: SourceIssue["scope"] = isTotal ? "total" : "row";
  const bad = (field: string, message: string) =>
    issues.push({ scope, rowIndex: index, field, message });

  const record = asRecord(raw);
  if (!record) {
    bad("", "Baris harus berupa objek dengan key, jenis dana, posisi neraca, dan nilai.");
    return null;
  }

  let broken = false;

  const key = text(record.key);
  if (key === "") {
    bad("key", "Baris tidak memiliki key. Key adalah identitas yang dipakai mencocokkan dua sisi.");
    broken = true;
  }

  const bucket = text(record.bucket);
  const bucketIsTotalMarker = isTotal && bucket === GRAND_TOTAL_BUCKET;
  if (!bucketIsTotalMarker) {
    if (!(JENIS_DANA as readonly string[]).includes(bucket)) {
      bad(
        "bucket",
        `Jenis dana tidak dikenal: ${JSON.stringify(record.bucket)}. Yang dikenal: ${JENIS_DANA.join(", ")}.`
      );
      broken = true;
    } else if (!manifest.fundTypes.includes(bucket)) {
      bad(
        "bucket",
        `Jenis dana "${bucket}" berada di luar cakupan yang dinyatakan manifest ` +
          `(${manifest.fundTypes.join(", ")}). Perbaiki barisnya atau perluas cakupan manifest.`
      );
      broken = true;
    }
  }

  const balanceSheet = text(record.balanceSheet) as BalanceSheetPosition;
  if (balanceSheet !== "ON" && balanceSheet !== "OFF") {
    bad(
      "balanceSheet",
      `Posisi neraca tidak dikenal: ${JSON.stringify(record.balanceSheet)}. Gunakan "ON" atau "OFF".`
    );
    broken = true;
  } else if (manifest.balanceSheet !== "BOTH" && balanceSheet !== manifest.balanceSheet) {
    bad(
      "balanceSheet",
      `Baris berposisi "${balanceSheet}" sedangkan manifest menyatakan cakupan "${manifest.balanceSheet}". ` +
        `Posisi neraca tidak digabung, karena selisih pada satu posisi tidak boleh menutup selisih posisi lain.`
    );
    broken = true;
  }

  const valueRecord = asRecord(record.value);
  let amount: string | null = null;
  if (!valueRecord) {
    bad("value", "Baris tidak memiliki nilai berupa objek { amount, unit }.");
    broken = true;
  } else {
    const unit = text(valueRecord.unit);
    if (unit !== manifest.currencyUnit) {
      bad(
        "value.unit",
        `Unit baris ${JSON.stringify(valueRecord.unit)} berbeda dari unit yang dinyatakan manifest ` +
          `(${manifest.currencyUnit}). Satuan tidak pernah dikonversi; rekonsiliasikan tiap unit terpisah.`
      );
      broken = true;
    }
    const read = readWholeAmount(valueRecord.amount);
    if ("error" in read) {
      bad("value.amount", read.error);
      broken = true;
    } else {
      amount = read.amount;
    }
  }

  let amilAmount: string | null = null;
  if (record.amilAmount !== undefined && record.amilAmount !== null) {
    if (isTotal) {
      bad("amilAmount", "Hak amil tidak boleh diletakkan pada total yang dideklarasikan.");
      broken = true;
    } else {
      const amilRecord = asRecord(record.amilAmount);
      const read = amilRecord
        ? readWholeAmount(amilRecord.amount)
        : ({ error: "Hak amil harus berupa objek { amount, unit }." } as const);
      if ("error" in read) {
        bad("amilAmount", read.error);
        broken = true;
      } else if (text(amilRecord!.unit) !== manifest.currencyUnit) {
        bad("amilAmount", `Unit hak amil harus sama dengan unit pengumpulan (${manifest.currencyUnit}).`);
        broken = true;
      } else {
        amilAmount = read.amount;
      }
    }
  }

  if (broken || amount === null) return null;

  return {
    key,
    bucket,
    balanceSheet: balanceSheet as BalanceSheetPosition,
    amount,
    unit: manifest.currencyUnit,
    amilAmount,
    label: text(record.label) === "" ? null : text(record.label),
    isDeclaredTotal: isTotal,
  };
}

/**
 * Turns one submitted side into either a side that can be frozen, or the list
 * of reasons it cannot be.
 *
 * `institutionId` comes from the resolved session. Everything else comes from
 * the payload and is checked.
 */
export function normalizeSide(
  raw: unknown,
  role: SourceRole,
  institutionId: string
): NormalizedSubmission {
  const issues: SourceIssue[] = [];
  const record = asRecord(raw);
  if (!record) {
    return {
      side: null,
      issues: [
        {
          scope: "manifest",
          rowIndex: null,
          field: role === "CLAIM" ? "claim" : "source",
          message: `Sisi ${role === "CLAIM" ? "klaim" : "sumber"} harus berupa objek.`,
        },
      ],
    };
  }

  const manifest = readManifest(record.manifest, role, institutionId, issues);
  if (!manifest) return { side: null, issues };

  const declaredStatus = text(record.status);
  if (declaredStatus === "MISSING" || declaredStatus === "FAILED") {
    const detail = text(record.detail);
    if (detail === "") {
      issues.push({
        scope: "manifest",
        rowIndex: null,
        field: "detail",
        message:
          "Sumber yang hilang atau gagal dibaca harus menyebut alasannya. Alasan itulah bukti " +
          "mengapa cakupannya belum terperiksa.",
      });
      return { side: null, issues };
    }
    if (Array.isArray(record.rows) && record.rows.length > 0) {
      issues.push({
        scope: "manifest",
        rowIndex: null,
        field: "rows",
        message: "Sumber yang dinyatakan hilang atau gagal tidak boleh membawa baris data.",
      });
      return { side: null, issues };
    }
    return { side: { manifest, status: declaredStatus, detail }, issues };
  }

  if (declaredStatus !== "" && declaredStatus !== "READ") {
    issues.push({
      scope: "manifest",
      rowIndex: null,
      field: "status",
      message: `Status sumber tidak dikenal: ${JSON.stringify(record.status)}. Gunakan READ, MISSING, atau FAILED.`,
    });
    return { side: null, issues };
  }

  const rawRows = record.rows;
  if (!Array.isArray(rawRows)) {
    issues.push({
      scope: "manifest",
      rowIndex: null,
      field: "rows",
      message:
        "Sisi yang berhasil dibaca harus menyertakan daftar baris. Daftar kosong berarti periode ini " +
        "memang tidak memuat baris; sumber yang tidak terbaca dinyatakan dengan status MISSING atau FAILED.",
    });
    return { side: null, issues };
  }

  const rawTotals = record.declaredTotals;
  if (rawTotals !== undefined && !Array.isArray(rawTotals)) {
    issues.push({
      scope: "manifest",
      rowIndex: null,
      field: "declaredTotals",
      message: "Total yang dideklarasikan harus berupa daftar.",
    });
    return { side: null, issues };
  }

  const rows: NormalizedRow[] = [];
  for (const [index, item] of rawRows.entries()) {
    const row = readRow(item, index, manifest, false, issues);
    if (row) rows.push(row);
  }
  for (const [index, item] of (rawTotals ?? []).entries()) {
    const total = readRow(item, index, manifest, true, issues);
    if (total) rows.push(total);
  }

  if (issues.length > 0) return { side: null, issues };
  return { side: { manifest, status: "READ", rows }, issues };
}

/** The rows a side holds. An unread side holds none - never an invented empty read. */
export const rowsFrom = (side: SubmittedSide): NormalizedRow[] =>
  side.status === "READ" ? side.rows : [];

const entryFrom = (row: NormalizedRow): LedgerEntry => ({
  key: row.key,
  bucket: row.bucket,
  balanceSheet: row.balanceSheet,
  value: money(BigInt(row.amount), row.unit),
  ...(row.amilAmount !== null ? { amilAmount: money(BigInt(row.amilAmount), row.unit) } : {}),
  ...(row.label !== null ? { label: row.label } : {}),
});

/**
 * The engine's view of a side, rebuilt from the stored rows.
 *
 * Going through `NormalizedRow` rather than straight from the request body is
 * deliberate: the figures are then computed from exactly the bytes that get
 * frozen, so recomputing from the snapshot later cannot disagree with the
 * result recorded alongside it.
 */
export function entriesFrom(side: SubmittedSide): {
  entries: LedgerEntry[];
  declaredTotals: LedgerEntry[];
} {
  const rows = rowsFrom(side);
  return {
    entries: rows.filter((row) => !row.isDeclaredTotal).map(entryFrom),
    declaredTotals: rows.filter((row) => row.isDeclaredTotal).map(entryFrom),
  };
}

const roleName = (role: SourceRole): string => (role === "CLAIM" ? "klaim" : "sumber");

/**
 * What a reader has to be told about the limits of this examination.
 *
 * Empty when both sides were read in full and both carry their transactions.
 * Everything here is a limit on what the result proves, so it travels with the
 * result rather than living in a comment nobody reads.
 */
export function coverageNotesFor(sides: readonly SubmittedSide[]): string[] {
  const notes: string[] = [];

  for (const side of sides) {
    if (side.status !== "READ") {
      notes.push(
        `Sisi ${roleName(side.manifest.role)} "${side.manifest.label}" ` +
          `${side.status === "MISSING" ? "belum tersedia" : "gagal dibaca"}: ${side.detail}. ` +
          `Cakupan ${side.manifest.scopeUnit} untuk jenis dana ${side.manifest.fundTypes.join(", ")} ` +
          `belum terperiksa, dan angka nol pada cakupan itu bukan hasil pembacaan yang berhasil.`
      );
      continue;
    }

    if (side.manifest.transactionDetail === "NOT_AVAILABLE") {
      notes.push(
        `Sisi ${roleName(side.manifest.role)} "${side.manifest.label}" berupa rekap tanpa rincian transaksi. ` +
          `Kesesuaian angkanya tidak membuktikan pembayaran individual, dan rincian transaksi tidak ` +
          `direkonstruksi dari rekap.`
      );
    }
  }

  return notes;
}

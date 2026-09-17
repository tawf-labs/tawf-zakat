/**
 * Contribution Tabular Schema Mapper (Spec #100, Ticket #102).
 *
 * Maps a decoded TabularTable (from `tabular-reader`) into normalized
 * contribution rows.
 *
 * Rules:
 * 1. Preserves every row including broken ones with cell/row coordinates (US-09, US-32).
 * 2. Does not turn missing/invalid rows into zeros.
 * 3. Calculates total nominal of valid rows as partial total when invalid rows exist.
 * 4. Preserves text identifiers and exact minor-unit amounts.
 * 5. Handles missing or empty donor contacts gracefully without failing the row (US-51).
 * 6. Detects internal duplicate source references within the workbook (US-33), with the
 *    same exact-match rule the database uses, so the preview and commit never disagree.
 * 7. Every row carries one currency unit, the one the import was opened with: IDR and
 *    USDC rows are never summed together.
 */

import type { CurrencyUnit } from "./reconciliation";
import {
  isSourceChannel,
  normalizeFundType,
  validateContributionInput,
  type ContributionInput,
  type SourceChannel,
} from "./contribution";
import type { TabularTable } from "./tabular-reader";

const COLUMN_ALIASES: Record<string, string> = {
  // Stable ID (optional)
  id: "id",
  kode: "id",
  id_kontribusi: "id",
  identitas: "id",

  // Source channel
  sumber_kanal: "channel",
  kanal: "channel",
  channel: "channel",
  metode: "channel",
  metode_pembayaran: "channel",
  source_channel: "channel",

  // Source reference
  referensi: "reference",
  referensi_sumber: "reference",
  no_referensi: "reference",
  nomor_referensi: "reference",
  id_transaksi: "reference",
  nomor_transaksi: "reference",
  ref: "reference",
  source_reference: "reference",

  // Nominal / Amount
  nominal: "amount",
  amount: "amount",
  jumlah: "amount",
  nilai: "amount",

  // Unit / Currency
  unit: "unit",
  mata_uang: "unit",
  satuan: "unit",
  currency: "unit",

  // Fund Type
  jenis_dana: "fund_type",
  kategori_dana: "fund_type",
  dana: "fund_type",
  fund_type: "fund_type",

  // Purpose
  peruntukan: "purpose",
  tujuan: "purpose",
  kegiatan: "purpose",
  program: "purpose",
  purpose: "purpose",
  keterangan: "purpose",

  // Received Date
  tanggal: "date",
  waktu: "date",
  tanggal_terima: "date",
  date: "date",
  received_at: "date",

  // Donor Name
  nama_donatur: "donor_name",
  donatur: "donor_name",
  nama: "donor_name",
  donor_name: "donor_name",

  // Donor Contact
  kontak_donatur: "donor_contact",
  kontak: "donor_contact",
  no_hp: "donor_contact",
  telepon: "donor_contact",
  email: "donor_contact",
  donor_contact: "donor_contact",
};

const CHANNEL_MAP: Record<string, SourceChannel> = {
  bank_transfer: "BANK_TRANSFER",
  transfer_bank: "BANK_TRANSFER",
  transfer: "BANK_TRANSFER",
  bank: "BANK_TRANSFER",
  qris: "QRIS",
  cash: "CASH",
  tunai: "CASH",
  crypto: "CRYPTO_USDC",
  crypto_usdc: "CRYPTO_USDC",
  usdc: "CRYPTO_USDC",
  direct: "DIRECT",
  langsung: "DIRECT",
  other: "OTHER",
  lainnya: "OTHER",
};

export type TabularContributionIssue = {
  rowNumber: number;
  column: string | null;
  field?: string;
  message: string;
  code: string;
};

export type TabularContributionRowResult = {
  rowNumber: number;
  raw: Record<string, string>;
  isValid: boolean;
  contribution?: ContributionInput;
  issues: TabularContributionIssue[];
};

export type TabularContributionMappingResult = {
  sheetName: string;
  totalRows: number;
  validRowsCount: number;
  invalidRowsCount: number;
  currencyUnit: CurrencyUnit;
  totalValidAmount: string; // BigInt exact string
  rows: TabularContributionRowResult[];
  issues: TabularContributionIssue[];
};

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s\-_]+/g, "_");
}

function parseDateToUnix(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Unix timestamp in seconds
  if (/^\d{9,10}$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  // Unix timestamp in milliseconds
  if (/^\d{12,13}$/.test(trimmed)) {
    return Math.floor(parseInt(trimmed, 10) / 1000);
  }

  // ISO or standard date formats
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    return Math.floor(parsed / 1000);
  }

  // Indonesian DD/MM/YYYY or DD-MM-YYYY
  const parts = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (parts) {
    const day = parseInt(parts[1], 10);
    const month = parseInt(parts[2], 10) - 1;
    const year = parseInt(parts[3], 10);
    const d = new Date(Date.UTC(year, month, day));
    if (!isNaN(d.getTime())) {
      return Math.floor(d.getTime() / 1000);
    }
  }

  return null;
}

/**
 * Reads a whole-number amount exactly. Accepts plain digits, thousands grouped with
 * dots or commas, and a trailing zero fraction ("500000,00"). Anything with a real
 * fraction is refused instead of having its separator silently dropped.
 */
function parseExactAmount(raw: string): string | null {
  const trimmed = raw.trim().replace(/[,.]00$/, "");
  if (/^\d+$/.test(trimmed)) return trimmed;
  if (/^\d{1,3}(\.\d{3})+$/.test(trimmed) || /^\d{1,3}(,\d{3})+$/.test(trimmed)) {
    return trimmed.replace(/[,.]/g, "");
  }
  return null;
}

export function mapContributionTabular(
  table: TabularTable,
  defaultCurrency: CurrencyUnit = "IDR"
): TabularContributionMappingResult {
  const headerMap: Record<string, string> = {}; // normalized canonical -> original header
  for (const h of table.headers) {
    const norm = normalizeHeader(h);
    const canonical = COLUMN_ALIASES[norm];
    if (canonical) {
      headerMap[canonical] = h;
    }
  }

  const globalIssues: TabularContributionIssue[] = [];

  // Required canonical columns
  const required = ["channel", "reference", "amount", "fund_type", "date"];
  for (const req of required) {
    if (!headerMap[req]) {
      globalIssues.push({
        rowNumber: 1,
        column: null,
        field: req,
        message: `Kolom wajib '${req}' tidak ditemukan pada lembar '${table.sheetName}'.`,
        code: "MISSING_REQUIRED_COLUMN",
      });
    }
  }

  const mappedRows: TabularContributionRowResult[] = [];
  let totalValidBigInt = 0n;
  const seenReferences = new Set<string>();

  for (const row of table.rows) {
    const rowIssues: TabularContributionIssue[] = [];
    const getVal = (canonical: string): string => {
      const origHeader = headerMap[canonical];
      if (!origHeader) return "";
      const normHeader = normalizeHeader(origHeader);
      return row.cells[normHeader]?.trim() ?? "";
    };

    const rawChannel = getVal("channel");
    const rawRef = getVal("reference");
    const rawAmount = getVal("amount");
    const rawFundType = getVal("fund_type");
    const rawPurpose = getVal("purpose");
    const rawDate = getVal("date");
    const rawDonorName = getVal("donor_name");
    const rawDonorContact = getVal("donor_contact");
    const rawUnit = getVal("unit");

    // 1. Channel
    const normChannel = normalizeHeader(rawChannel);
    const channel = CHANNEL_MAP[normChannel] || (isSourceChannel(rawChannel.toUpperCase()) ? (rawChannel.toUpperCase() as SourceChannel) : null);
    if (!channel) {
      rowIssues.push({
        rowNumber: row.rowNumber,
        column: headerMap["channel"] ?? "sumber_kanal",
        field: "sourceChannel",
        message: `Kanal sumber '${rawChannel || "(kosong)"}' tidak dikenal.`,
        code: "INVALID_CHANNEL",
      });
    }

    // 2. Reference
    if (!rawRef) {
      rowIssues.push({
        rowNumber: row.rowNumber,
        column: headerMap["reference"] ?? "referensi_sumber",
        field: "sourceReference",
        message: "Nomor referensi sumber tidak boleh kosong.",
        code: "MISSING_REFERENCE",
      });
    } else {
      const refKey = `${channel || ""}:${rawRef}`;
      if (seenReferences.has(refKey)) {
        rowIssues.push({
          rowNumber: row.rowNumber,
          column: headerMap["reference"] ?? "referensi_sumber",
          field: "sourceReference",
          message: `Duplikasi nomor referensi '${rawRef}' pada berkas yang sama.`,
          code: "DUPLICATE_FILE_REFERENCE",
        });
      } else {
        seenReferences.add(refKey);
      }
    }

    // 3. Amount (exact integer string)
    const amountExact = parseExactAmount(rawAmount);
    if (!amountExact || /^0/.test(amountExact)) {
      rowIssues.push({
        rowNumber: row.rowNumber,
        column: headerMap["amount"] ?? "nominal",
        field: "amountExact",
        message: `Nominal '${rawAmount || "(kosong)"}' tidak sah; harus berupa bilangan bulat positif.`,
        code: "INVALID_AMOUNT",
      });
    }

    // 4. Fund type, through the same reader the form uses
    const fundType = normalizeFundType(rawFundType);
    if (!fundType) {
      rowIssues.push({
        rowNumber: row.rowNumber,
        column: headerMap["fund_type"] ?? "jenis_dana",
        field: "fundType",
        message: `Jenis dana '${rawFundType || "(kosong)"}' tidak sah.`,
        code: "INVALID_FUND_TYPE",
      });
    }

    // 5. Currency unit: a row may name the import's unit, never a different one
    if (rawUnit) {
      const u = rawUnit.trim().toUpperCase();
      const named: CurrencyUnit | null =
        u === "IDR" || u === "RUPIAH" ? "IDR" : u === "USDC" || u === "USDC_6DP" ? "USDC_6DP" : null;
      if (named !== defaultCurrency) {
        rowIssues.push({
          rowNumber: row.rowNumber,
          column: headerMap["unit"] ?? "unit",
          field: "currencyUnit",
          message: named
            ? `Baris bersatuan ${named} tidak dapat masuk impor ${defaultCurrency}; IDR dan USDC diimpor terpisah.`
            : `Mata uang '${rawUnit}' tidak didukung; harus IDR atau USDC_6DP.`,
          code: "INVALID_CURRENCY",
        });
      }
    }

    // 6. Received date is required: the import must not invent when funds arrived
    const receivedAt = rawDate ? parseDateToUnix(rawDate) : null;
    if (!receivedAt) {
      rowIssues.push({
        rowNumber: row.rowNumber,
        column: headerMap["date"] ?? "tanggal",
        field: "receivedAt",
        message: rawDate
          ? `Format tanggal '${rawDate}' tidak dapat dipahami.`
          : "Tanggal penerimaan wajib diisi.",
        code: "INVALID_DATE",
      });
    }

    const candidate: ContributionInput | undefined =
      rowIssues.length === 0
        ? {
            sourceChannel: channel!,
            sourceReference: rawRef,
            currencyUnit: defaultCurrency,
            amountExact: amountExact!,
            fundType: fundType!,
            purpose: rawPurpose || "Penerimaan Kontribusi Lembaga",
            receivedAt: receivedAt!,
            donorName: rawDonorName || null,
            donorContact: rawDonorContact || null,
          }
        : undefined;
    // The form's validator has the last word, so both paths accept the same records.
    if (candidate) {
      for (const issue of validateContributionInput(candidate)) {
        rowIssues.push({ rowNumber: row.rowNumber, column: null, field: issue.field, message: issue.message, code: issue.code });
      }
    }

    const isValid = rowIssues.length === 0;
    if (isValid) {
      totalValidBigInt += BigInt(amountExact!);
    }

    mappedRows.push({
      rowNumber: row.rowNumber,
      raw: row.cells,
      isValid,
      contribution: isValid ? candidate : undefined,
      issues: rowIssues,
    });
  }

  const validRowsCount = mappedRows.filter((r) => r.isValid).length;
  const invalidRowsCount = mappedRows.length - validRowsCount;

  return {
    sheetName: table.sheetName,
    totalRows: mappedRows.length,
    validRowsCount,
    invalidRowsCount,
    currencyUnit: defaultCurrency,
    totalValidAmount: totalValidBigInt.toString(),
    rows: mappedRows,
    issues: [...globalIssues, ...mappedRows.flatMap((r) => r.issues)],
  };
}

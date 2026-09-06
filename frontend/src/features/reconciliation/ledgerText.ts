/**
 * Parses the tabular text an Amil actually has - a block pasted out of a
 * spreadsheet or a SiMBA export - into the ledger shape the engine reads.
 *
 * One row per line: kode PZ, nama PZ, jenis dana, posisi neraca, jumlah.
 * The posisi neraca column may be left out, in which case the row is treated as
 * on balance sheet. A row whose kode reads TOTAL or GRAND TOTAL declares a total
 * rather than an entry, which is how a recap's own arithmetic gets checked.
 */

import {
  GRAND_TOTAL_BUCKET,
  type BalanceSheetPosition,
  type WireLedgerEntry,
  type WireLedgerSide,
} from "./types";

export type LedgerTextIssue = { line: number; message: string };

export type LedgerTextResult = {
  side: WireLedgerSide;
  issues: LedgerTextIssue[];
};

/**
 * Which vocabulary the bucket column is written in.
 *
 * `JENIS_DANA` is the default and the strict one: anything outside the five
 * funds of PerBAZNAS 1/2023 is refused by line, so a typo cannot quietly become
 * a legal bucket that then shows up as a missing entry. `BEBAS` is the opt-in
 * for a report cut along another dimension - jenis Pengelola Zakat, say - where
 * the institution's own labels are the vocabulary.
 */
export type BucketDimension = "JENIS_DANA" | "BEBAS";

export const JENIS_DANA_TERBACA = "Zakat, Zakat Fitrah, Infak/Sedekah, Kurban, DSKL";

const JENIS_DANA_ALIASES: Record<string, string> = {
  zakat: "ZAKAT",
  "zakat mal": "ZAKAT",
  "zakat maal": "ZAKAT",
  fitrah: "FITRAH",
  "zakat fitrah": "FITRAH",
  infak: "INFAK_SEDEKAH",
  sedekah: "INFAK_SEDEKAH",
  "infak/sedekah": "INFAK_SEDEKAH",
  "infak sedekah": "INFAK_SEDEKAH",
  infaq: "INFAK_SEDEKAH",
  "infaq/sedekah": "INFAK_SEDEKAH",
  kurban: "KURBAN",
  qurban: "KURBAN",
  dskl: "DSKL",
  "dana sosial keagamaan lainnya": "DSKL",
};

const BALANCE_SHEET_ALIASES: Record<string, BalanceSheetPosition> = {
  on: "ON",
  "on balance sheet": "ON",
  onbalancesheet: "ON",
  neraca: "ON",
  off: "OFF",
  "off balance sheet": "OFF",
  offbalancesheet: "OFF",
  "luar neraca": "OFF",
};

const TOTAL_MARKERS = ["total", "subtotal", "jumlah"];
const GRAND_TOTAL_MARKERS = ["grand total", "total keseluruhan", "total akhir"];

const normalise = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

/** Splits on the delimiter the line actually uses: tab, semicolon, then comma. */
function splitColumns(line: string): string[] {
  const delimiter = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
  return line.split(delimiter).map((cell) => cell.trim());
}

/**
 * Reads a rupiah figure written the way Indonesians write it: dots as thousand
 * separators, an optional Rp prefix, and no fractional part. Returns the amount
 * in whole rupiah as a decimal string, so nothing passes through a float.
 */
export function parseRupiah(raw: string): string | null {
  const cleaned = raw
    .replace(/rp/gi, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(/\.(?=\d{3}\.)/g, "")
    .replace(/,-$/, "")
    .trim();

  if (cleaned === "" || !/^-?\d+$/.test(cleaned)) return null;
  return String(BigInt(cleaned));
}

export function resolveJenisDana(
  raw: string,
  dimension: BucketDimension = "JENIS_DANA"
): string | null {
  const key = normalise(raw);
  if (key === "") return null;
  if (JENIS_DANA_ALIASES[key]) return JENIS_DANA_ALIASES[key];
  if (dimension === "JENIS_DANA") return null;
  // Another dimension names its own buckets; uppercase them into a stable code.
  return key.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "") || null;
}

function resolveBalanceSheet(raw: string | undefined): BalanceSheetPosition | null {
  if (raw === undefined || raw.trim() === "") return "ON";
  const key = normalise(raw);
  return BALANCE_SHEET_ALIASES[key] ?? null;
}

/** Which of the trailing columns holds the amount, and where the rest sit. */
type Row = {
  kode: string;
  nama: string;
  jenisDana: string;
  posisi?: string;
  jumlah: string;
};

function toRow(columns: string[]): Row | null {
  // kode, nama, jenis dana, posisi, jumlah
  if (columns.length >= 5) {
    return {
      kode: columns[0],
      nama: columns[1],
      jenisDana: columns[2],
      posisi: columns[3],
      jumlah: columns[4],
    };
  }
  // kode, nama, jenis dana, jumlah
  if (columns.length === 4) {
    return { kode: columns[0], nama: columns[1], jenisDana: columns[2], jumlah: columns[3] };
  }
  // kode, jenis dana, jumlah
  if (columns.length === 3) {
    return { kode: columns[0], nama: columns[0], jenisDana: columns[1], jumlah: columns[2] };
  }
  return null;
}

const isHeaderLine = (line: string): boolean =>
  /^(kode|no\b|nomor|pz\b|pengelola)/i.test(line.trim()) && /jumlah|nilai|rp/i.test(line);

/**
 * Turns pasted or uploaded text into one side of the ledger. Rows that cannot be
 * read are collected as issues naming their line number rather than throwing, so
 * the Amil can fix them one by one instead of losing the whole paste.
 */
export function parseLedgerText(
  text: string,
  label: string,
  dimension: BucketDimension = "JENIS_DANA"
): LedgerTextResult {
  const entries: WireLedgerEntry[] = [];
  const declaredTotals: WireLedgerEntry[] = [];
  const issues: LedgerTextIssue[] = [];

  const lines = text.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) return;
    if (isHeaderLine(line)) return;

    const columns = splitColumns(line);
    const row = toRow(columns);
    if (!row) {
      issues.push({
        line: lineNumber,
        message: `Baris ${lineNumber} hanya punya ${columns.length} kolom. Format yang diharapkan: kode PZ, nama PZ, jenis dana, posisi neraca (opsional), jumlah.`,
      });
      return;
    }

    const amount = parseRupiah(row.jumlah);
    if (amount === null) {
      issues.push({
        line: lineNumber,
        message: `Baris ${lineNumber} ("${row.kode}"): jumlah "${row.jumlah}" tidak terbaca sebagai rupiah bulat.`,
      });
      return;
    }
    if (amount.startsWith("-")) {
      issues.push({
        line: lineNumber,
        message: `Baris ${lineNumber} ("${row.kode}"): jumlah tidak boleh negatif.`,
      });
      return;
    }

    const balanceSheet = resolveBalanceSheet(row.posisi);
    if (!balanceSheet) {
      issues.push({
        line: lineNumber,
        message: `Baris ${lineNumber} ("${row.kode}"): posisi neraca "${row.posisi}" tidak dikenal. Gunakan "on" atau "off".`,
      });
      return;
    }

    const kodeKey = normalise(row.kode);
    const isGrandTotal = GRAND_TOTAL_MARKERS.includes(kodeKey);
    const isTotal = isGrandTotal || TOTAL_MARKERS.includes(kodeKey);

    const bucket = isGrandTotal ? GRAND_TOTAL_BUCKET : resolveJenisDana(row.jenisDana, dimension);
    if (!bucket) {
      issues.push({
        line: lineNumber,
        message:
          row.jenisDana.trim() === ""
            ? `Baris ${lineNumber} ("${row.kode}"): jenis dana kosong.`
            : `Baris ${lineNumber} ("${row.kode}"): jenis dana "${row.jenisDana.trim()}" tidak dikenal. ` +
              `Yang dikenal: ${JENIS_DANA_TERBACA}. Bila laporan ini memakai dimensi lain ` +
              `(misalnya jenis Pengelola Zakat), ubah dimensi bucket sisi ini menjadi "Bebas".`,
      });
      return;
    }

    const entry: WireLedgerEntry = {
      key: isTotal ? `${row.kode.trim().toUpperCase()}-${bucket}-${balanceSheet}` : row.kode.trim(),
      bucket,
      balanceSheet,
      value: { amount, unit: "IDR" },
      label: row.nama.trim() || row.kode.trim(),
    };

    (isTotal ? declaredTotals : entries).push(entry);
  });

  return {
    side: {
      label,
      entries,
      ...(declaredTotals.length > 0 ? { declaredTotals } : {}),
    },
    issues,
  };
}

/** The bucket codes a parsed side actually uses, for the allowedBuckets option. */
export function bucketsUsed(...sides: WireLedgerSide[]): string[] {
  const buckets = new Set<string>();
  for (const side of sides) {
    for (const row of [...side.entries, ...(side.declaredTotals ?? [])]) {
      if (row.bucket !== GRAND_TOTAL_BUCKET) buckets.add(row.bucket);
    }
  }
  return [...buckets].sort();
}

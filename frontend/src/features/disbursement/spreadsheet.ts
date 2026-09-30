/**
 * Pure helpers behind the roster spreadsheet grid: clipboard TSV (the format
 * Excel and Google Sheets put on the clipboard), lenient normalisation of
 * pasted values, and matching pasted recipient text back to a beneficiary.
 * Normalisation only tidies unambiguous spellings; anything else is kept as
 * typed so validation can flag it instead of the value silently vanishing.
 */
import type { Beneficiary } from "./disbursementClient";

/** Parses clipboard text into rows of cells, honouring Excel's quoting of tabs, newlines and quotes. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  const input = text.replace(/\r\n?/g, "\n");
  while (i < input.length) {
    const ch = input[i];
    if (ch === '"' && cell === "") {
      // Quoted cell: runs to the closing quote; "" is an escaped quote.
      i++;
      while (i < input.length) {
        if (input[i] === '"') {
          if (input[i + 1] === '"') { cell += '"'; i += 2; continue; }
          i++;
          break;
        }
        cell += input[i++];
      }
      continue;
    }
    if (ch === "\t") { row.push(cell); cell = ""; i++; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; continue; }
    cell += ch;
    i++;
  }
  // Spreadsheets end a copied block with a newline; do not turn it into an empty row.
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

export function toTsv(rows: string[][]): string {
  const quote = (cell: string) => (/[\t\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  return rows.map((row) => row.map(quote).join("\t")).join("\n");
}

const squash = (value: string) => value.trim().toUpperCase().replace(/[\s_]+/g, " ");

/** Maps a case/spacing variant onto a known option ("fakir", "IBNU_SABIL"); unknown text is kept. */
export function normalizeChoice(value: string, options: readonly string[]): string {
  const key = squash(value);
  return options.find((option) => squash(option) === key) ?? value.trim();
}

/** "Rp 1.500.000", "1,500,000" and "1500000,00" become "1500000"; anything else is kept for validation. */
export function normalizeRupiah(value: string): string {
  let text = value.trim().replace(/^rp\.?\s*/i, "").replace(/\s+/g, "");
  // A zero sen fraction ("1500000,00", "1.500.000,00") carries no value.
  text = text.replace(/^(\d{1,3}(?:[.,]\d{3})*|\d+)[.,]0{1,2}$/, "$1");
  if (/^\d{1,3}(\.\d{3})+$/.test(text) || /^\d{1,3}(,\d{3})+$/.test(text)) text = text.replace(/[.,]/g, "");
  return text;
}

/** Indonesian decimal comma ("2,5") becomes the exact-decimal dot form ("2.5"). */
export function normalizeQuantity(value: string): string {
  const text = value.trim();
  return /^\d+,\d+$/.test(text) ? text.replace(",", ".") : text;
}

/** Drops the separators and Excel's text-forcing apostrophe from a pasted NIK. */
export function normalizeNik(value: string): string {
  return value.trim().replace(/^'/, "").replace(/[\s.-]/g, "");
}

export function parseIdentityKind(value: string): "NIK" | "ALTERNATIVE" | null {
  const key = squash(value);
  if (key === "NIK") return "NIK";
  if (["ALTERNATIF", "ALTERNATIVE", "TANPA NIK", "IDENTITAS ALTERNATIF"].includes(key)) return "ALTERNATIVE";
  return null;
}

export function parseAidKind(value: string): "MONEY" | "GOODS" | null {
  const key = squash(value);
  if (["UANG", "MONEY", "UANG (IDR)", "TUNAI"].includes(key)) return "MONEY";
  if (["BARANG", "GOODS"].includes(key)) return "GOODS";
  return null;
}

const nikOf = (b: Beneficiary) => (b.identityBasis.kind === "NIK" ? b.identityBasis.value : "");

/** The recipient as shown in an aid-line cell; the NIK tail tells apart recipients who share a name. */
export function beneficiaryLabel(b: Beneficiary, index: number): string {
  const name = b.name.trim() || `Penerima ${index + 1}`;
  const nik = nikOf(b);
  return nik.length >= 4 ? `${name} · ••${nik.slice(-4)}` : name;
}

/**
 * Resolves pasted recipient text to a beneficiary id: the displayed label,
 * then a full NIK, then an exact (case-insensitive) name that only one
 * recipient carries. Returns null when nothing or more than one matches.
 */
export function matchBeneficiary(text: string, beneficiaries: Beneficiary[]): string | null {
  const value = text.trim();
  if (!value) return null;
  const byLabel = beneficiaries.findIndex((b, i) => beneficiaryLabel(b, i) === value);
  if (byLabel >= 0) return beneficiaries[byLabel].id;
  const digits = normalizeNik(value);
  if (/^\d{16}$/.test(digits)) {
    const byNik = beneficiaries.filter((b) => nikOf(b) === digits);
    if (byNik.length === 1) return byNik[0].id;
  }
  const key = value.toLowerCase();
  const byName = beneficiaries.filter((b) => b.name.trim().toLowerCase() === key);
  return byName.length === 1 ? byName[0].id : null;
}

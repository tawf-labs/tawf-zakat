/**
 * Pure helpers behind the Biaya Operasional grid (ADR-0042): the columns, lenient
 * normalisation of typed or pasted cells, the row rules (mirroring backend
 * `validateCostItemInput`), the fund-source text a cell carries ("Talangan Ahmad"),
 * and matching uploaded file names to nota numbers. Unrecognised text is kept as
 * typed so validation can flag it instead of the value silently vanishing.
 */
import { isExactNonNegativeDecimal } from "../../../../shared/exact-decimal";
import type { GridColumn } from "./SpreadsheetGrid";
import { normalizeQuantity, normalizeRupiah } from "./spreadsheet";
import type { CostItem, CostItemInput, FundingSource, Panjar, Receipt } from "./operationalCostClient";

/** Every cell of a cost row as text, the way the grid edits it. */
export type CostFields = {
  spentOn: string;
  purpose: string;
  quantity: string;
  unit: string;
  unitPriceIdr: string;
  amountIdr: string;
  payee: string;
  /** No. nota/kuitansi as typed; matched to a recorded nota by its number. */
  receiptRef: string;
  /** "Kas lembaga", "Talangan <petugas>" or "Panjar <petugas> · <no. BKK>". */
  funding: string;
};

/** A grid row: a local draft (`item` null) or a recorded, locked cost item. */
export type CostRow = { key: string; fields: CostFields; item: CostItem | null };

export type CostOfficer = { id: string; displayName: string; isActive: boolean };
export type CostContext = { officers: CostOfficer[]; panjar: Panjar[]; receipts: Receipt[] };

export const EMPTY_FIELDS: CostFields = {
  spentOn: "", purpose: "", quantity: "", unit: "", unitPriceIdr: "", amountIdr: "", payee: "", receiptRef: "", funding: "",
};

export const newCostDraft = (fields: Partial<CostFields> = {}): CostRow => ({
  key: `draft-${crypto.randomUUID()}`, fields: { ...EMPTY_FIELDS, ...fields }, item: null,
});

const MAX_TEXT = 200;
const squash = (value: string) => value.trim().toUpperCase().replace(/[\s_]+/g, " ");

// ---------------------------------------------------------------------------
// Dates: stored as YYYY-MM-DD, shown and pasted as Indonesians write them.
// ---------------------------------------------------------------------------

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * "28/09/2026", "28-9-26", "28.09.2026" and a bare "28/09" (in `year`) become
 * "2026-09-28"; an ISO date stays. Anything else is kept for validation to flag.
 */
export function normalizeDate(value: string, year: number = new Date().getFullYear()): string {
  const text = value.trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) {
    const [y, m, d] = text.split("-");
    const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return isCalendarDate(iso) ? iso : text;
  }
  const match = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(text);
  if (!match) return text;
  const [, d, m, y] = match;
  const fullYear = y === undefined ? String(year) : y.length === 2 ? `20${y}` : y;
  const iso = `${fullYear}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isCalendarDate(iso) ? iso : text;
}

/** "2026-09-28" reads as "28/09/2026"; text that is not a date is shown as typed. */
export const displayDate = (value: string) =>
  isCalendarDate(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : value;

// ---------------------------------------------------------------------------
// Totals: quantity × unit price, exact in whole rupiah.
// ---------------------------------------------------------------------------

const positiveIdr = (value: string) => /^\d+$/.test(value) && value.length <= 18 && BigInt(value) > 0n;
const positiveDecimal = (value: string) => isExactNonNegativeDecimal(value) && /[1-9]/.test(value) && value.length <= 24;

/** quantity × unit price in whole rupiah, or null when the product has a fractional rupiah. */
export function exactLineTotal(quantity: string, unitPriceIdr: string): string | null {
  const [whole, fraction = ""] = quantity.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const product = BigInt(whole + fraction) * BigInt(unitPriceIdr);
  return product % scale === 0n ? (product / scale).toString() : null;
}

/** Fills Total once Jml and Harga are both usable, as a spreadsheet formula would. */
export function withAutoTotal(fields: CostFields): CostFields {
  if (!positiveDecimal(fields.quantity) || !positiveIdr(fields.unitPriceIdr)) return fields;
  const total = exactLineTotal(fields.quantity, fields.unitPriceIdr);
  return total === null ? fields : { ...fields, amountIdr: total };
}

// ---------------------------------------------------------------------------
// Fund source: the text in the "Sumber dana" cell.
// ---------------------------------------------------------------------------

export const KAS_LEMBAGA_LABEL = "Kas lembaga";

const officerName = (ctx: CostContext, id: string) => ctx.officers.find((o) => o.id === id)?.displayName ?? id;

export const panjarLabel = (ctx: CostContext, panjar: Panjar) => `Panjar ${officerName(ctx, panjar.holderOfficerId)} · ${panjar.cashOutRef}`;

export function fundingLabel(source: FundingSource, ctx: CostContext): string {
  if (source.kind === "KAS_LEMBAGA") return KAS_LEMBAGA_LABEL;
  if (source.kind === "TALANGAN") return `Talangan ${officerName(ctx, source.holderOfficerId)}`;
  const panjar = ctx.panjar.find((p) => p.id === source.panjarId);
  return panjar ? panjarLabel(ctx, panjar) : `Panjar ${source.panjarId}`;
}

/** The dropdown: institution cash, every active officer's talangan, every panjar of this proposal. */
export function fundingOptions(ctx: CostContext): string[] {
  return [
    KAS_LEMBAGA_LABEL,
    ...ctx.officers.filter((o) => o.isActive).map((o) => `Talangan ${o.displayName}`),
    ...ctx.panjar.map((p) => panjarLabel(ctx, p)),
  ];
}

export type FundingParse = { ok: true; source: FundingSource } | { ok: false; message: string };

/** Reads the cell back into a fund source; names match officers regardless of case and spacing. */
export function parseFunding(text: string, ctx: CostContext): FundingParse {
  const key = squash(text);
  if (!key) return { ok: false, message: "Sumber dana wajib dipilih: kas lembaga, talangan petugas, atau panjar petugas." };
  if (key === "KAS" || key === "KAS LEMBAGA") return { ok: true, source: { kind: "KAS_LEMBAGA" } };

  const talangan = /^TALANGAN (.+)$/.exec(key);
  if (talangan) {
    const found = ctx.officers.filter((o) => o.isActive && squash(o.displayName) === talangan[1]);
    if (found.length === 1) return { ok: true, source: { kind: "TALANGAN", holderOfficerId: found[0].id } };
    return {
      ok: false,
      message: found.length > 1
        ? `Ada beberapa petugas bernama "${text.trim().slice(9)}"; bedakan namanya di Petugas & Akses.`
        : `Petugas "${text.trim().slice(9)}" tidak ada di Petugas & Akses (atau tidak aktif).`,
    };
  }

  const panjar = /^PANJAR (.+)$/.exec(key);
  if (panjar) {
    const rest = panjar[1];
    const byLabel = ctx.panjar.filter((p) => squash(panjarLabel(ctx, p)) === key);
    const byRef = ctx.panjar.filter((p) => squash(p.cashOutRef) === rest);
    const byHolder = ctx.panjar.filter((p) => squash(officerName(ctx, p.holderOfficerId)) === rest);
    const found = byLabel.length === 1 ? byLabel : byRef.length === 1 ? byRef : byHolder;
    if (found.length === 1) return { ok: true, source: { kind: "PANJAR", panjarId: found[0].id } };
    return {
      ok: false,
      message: found.length > 1
        ? "Petugas ini memegang lebih dari satu panjar; pilih panjarnya beserta nomor bukti kas keluar."
        : "Panjar tidak ditemukan pada pengajuan ini. Keluarkan panjarnya dulu di lembar Panjar.",
    };
  }
  return { ok: false, message: `Sumber dana "${text.trim()}" tidak dikenali. Pilih dari daftar.` };
}

// ---------------------------------------------------------------------------
// Nota: the number in the "No. nota/kuitansi" cell.
// ---------------------------------------------------------------------------

export const receiptByRef = (ref: string, receipts: Receipt[]): Receipt | null => {
  const key = squash(ref);
  return key ? receipts.find((r) => squash(r.reference) === key) ?? null : null;
};

// ---------------------------------------------------------------------------
// Rows: recorded items as text, the row rules, and the request body.
// ---------------------------------------------------------------------------

export function fieldsOfItem(item: CostItemInput, ctx: CostContext): CostFields {
  return {
    spentOn: item.spentOn, purpose: item.purpose, quantity: item.quantity ?? "", unit: item.unit ?? "",
    unitPriceIdr: item.unitPriceIdr ?? "", amountIdr: item.amountIdr, payee: item.payee,
    receiptRef: item.receiptId ? ctx.receipts.find((r) => r.id === item.receiptId)?.reference ?? "" : "",
    funding: fundingLabel(item.fundingSource, ctx),
  };
}

export type CostField = keyof CostFields;

/** Problems with one row, by field. Mirrors backend `validateCostItemInput`. */
export function costRowIssues(fields: CostFields, ctx: CostContext): Partial<Record<CostField, string>> {
  const issues: Partial<Record<CostField, string>> = {};
  if (!isCalendarDate(fields.spentOn)) issues.spentOn = "Tanggal wajib berupa tanggal yang sah, mis. 28/09/2026.";

  const purpose = fields.purpose.trim();
  if (!purpose) issues.purpose = "Keperluan wajib diisi, mis. \"Bensin\" atau \"Sewa mobil\".";
  else if (purpose.length > MAX_TEXT) issues.purpose = `Keperluan maksimal ${MAX_TEXT} karakter.`;

  const payee = fields.payee.trim();
  if (!payee) issues.payee = "Dibayarkan kepada wajib diisi, mis. nama toko atau rental.";
  else if (payee.length > MAX_TEXT) issues.payee = `Dibayarkan kepada maksimal ${MAX_TEXT} karakter.`;

  const quantity = fields.quantity.trim();
  const unit = fields.unit.trim();
  const price = fields.unitPriceIdr.trim();
  const amount = fields.amountIdr.trim();
  if (quantity && !positiveDecimal(quantity)) issues.quantity = "Jml harus angka lebih dari nol (boleh desimal, mis. 2,5).";
  if (unit && !quantity) issues.unit = "Satuan hanya diisi bersama Jml.";
  else if (unit.length > 40) issues.unit = "Satuan maksimal 40 karakter.";
  if (price && !positiveIdr(price)) issues.unitPriceIdr = "Harga harus rupiah bulat lebih dari nol.";
  if (!positiveIdr(amount)) issues.amountIdr = "Total wajib rupiah bulat lebih dari nol.";
  else if (quantity && price && !issues.quantity && !issues.unitPriceIdr) {
    const expected = exactLineTotal(quantity, price);
    if (expected === null) issues.amountIdr = "Jml × Harga menghasilkan pecahan rupiah; sesuaikan Jml atau Harga.";
    else if (expected !== BigInt(amount).toString()) issues.amountIdr = `Total harus sama dengan Jml × Harga (${expected}).`;
  }

  if (fields.receiptRef.trim().length > MAX_TEXT) issues.receiptRef = `No. nota maksimal ${MAX_TEXT} karakter.`;
  const funding = parseFunding(fields.funding, ctx);
  if (!funding.ok) issues.funding = funding.message;
  return issues;
}

/** The request body for a valid row; `receiptId` is the nota its number resolved to. */
export function costInputOf(fields: CostFields, ctx: CostContext, receiptId: string | null): CostItemInput {
  const funding = parseFunding(fields.funding, ctx);
  if (!funding.ok) throw new Error(funding.message);
  const quantity = fields.quantity.trim() || null;
  return {
    spentOn: fields.spentOn,
    purpose: fields.purpose.trim(),
    quantity,
    unit: quantity ? fields.unit.trim() || null : null,
    unitPriceIdr: fields.unitPriceIdr.trim() || null,
    amountIdr: BigInt(fields.amountIdr.trim()).toString(),
    payee: fields.payee.trim(),
    fundingSource: funding.source,
    receiptId,
  };
}

/** Server field names for a row issue, onto the grid's fields. */
export const FIELD_OF_SERVER_ISSUE: Record<string, CostField> = {
  spentOn: "spentOn", purpose: "purpose", quantity: "quantity", unit: "unit", unitPriceIdr: "unitPriceIdr",
  amountIdr: "amountIdr", payee: "payee", fundingSource: "funding", receiptId: "receiptRef",
};

// ---------------------------------------------------------------------------
// Grid columns
// ---------------------------------------------------------------------------

const set = (field: CostField, auto = false) => (row: CostRow, text: string): CostRow => {
  const fields = { ...row.fields, [field]: text };
  return { ...row, fields: auto ? withAutoTotal(fields) : fields };
};

export function costColumns(ctx: CostContext, purposes: readonly string[], year?: number): GridColumn<CostRow>[] {
  const check = (field: CostField) => (row: CostRow) => (row.item ? null : costRowIssues(row.fields, ctx)[field] ?? null);
  const receiptCount = (row: CostRow) => receiptByRef(row.fields.receiptRef, ctx.receipts)?.files.length ?? 0;
  return [
    {
      id: "spentOn", header: "Tanggal", width: 110, hint: "Wajib · mis. 28/09/2026",
      value: (row) => displayDate(row.fields.spentOn),
      normalize: (text) => normalizeDate(text, year),
      apply: set("spentOn"), validate: check("spentOn"),
    },
    {
      id: "purpose", header: "Keperluan", width: 200, hint: "Wajib · teks bebas, mis. Bensin, Sewa mobil",
      options: purposes, value: (row) => row.fields.purpose, apply: set("purpose"), validate: check("purpose"),
    },
    {
      id: "quantity", header: "Jml", width: 70, align: "right", mono: true, hint: "Opsional",
      value: (row) => row.fields.quantity, normalize: normalizeQuantity, apply: set("quantity", true), validate: check("quantity"),
    },
    {
      id: "unit", header: "Satuan", width: 80, hint: "Opsional, bersama Jml",
      value: (row) => row.fields.unit, apply: set("unit"), validate: check("unit"),
    },
    {
      id: "unitPriceIdr", header: "Harga", width: 110, align: "right", mono: true, hint: "Opsional · rupiah per satuan",
      value: (row) => row.fields.unitPriceIdr, normalize: normalizeRupiah, apply: set("unitPriceIdr", true), validate: check("unitPriceIdr"),
    },
    {
      id: "amountIdr", header: "Total", width: 120, align: "right", mono: true, hint: "Wajib · otomatis bila Jml dan Harga diisi",
      value: (row) => row.fields.amountIdr, normalize: normalizeRupiah,
      // An empty Total (a pasted row with no total column) falls back to Jml × Harga.
      apply: (row, text) => text.trim() ? set("amountIdr")(row, text) : set("amountIdr", true)(row, ""),
      validate: check("amountIdr"),
    },
    {
      id: "payee", header: "Dibayarkan kepada", width: 170, hint: "Wajib · toko, rental, atau pihak yang dibayar",
      value: (row) => row.fields.payee, apply: set("payee"), validate: check("payee"),
    },
    {
      id: "receiptRef", header: "No. nota/kuitansi 📎", width: 150, hint: "Nomor nota; buka lampirannya dengan Enter atau klik ganda pada baris tercatat",
      options: ctx.receipts.map((r) => r.reference),
      value: (row) => {
        const count = receiptCount(row);
        return count > 0 && row.item ? `${row.fields.receiptRef} 📎${count}` : row.fields.receiptRef;
      },
      apply: set("receiptRef"), validate: check("receiptRef"),
    },
    {
      id: "funding", header: "Sumber dana", width: 190, hint: "Wajib · kas lembaga, talangan petugas, atau panjar petugas",
      options: fundingOptions(ctx), value: (row) => row.fields.funding, apply: set("funding"), validate: check("funding"),
    },
  ];
}

// ---------------------------------------------------------------------------
// Bulk upload: file names to nota numbers.
// ---------------------------------------------------------------------------

const baseName = (fileName: string) => fileName.replace(/\.[^.]+$/, "").trim().toLowerCase();
const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Pairs each file with the nota whose number its name carries: "KW-012.jpg",
 * "kw012.pdf" and "KW-012 (belakang).jpg" all belong to nota KW-012. The longest
 * matching number wins, so "KW-0123.jpg" never lands on KW-012. Unmatched files get null.
 */
export function matchReceiptFiles(fileNames: string[], receipts: Receipt[]): { fileName: string; receiptId: string | null }[] {
  const byLength = [...receipts].sort((a, b) => b.reference.length - a.reference.length);
  return fileNames.map((fileName) => {
    const base = baseName(fileName);
    const found = byLength.find((receipt) => {
      const ref = receipt.reference.trim().toLowerCase();
      if (!ref) return false;
      if (compact(base) === compact(ref)) return true;
      return base.startsWith(ref) && /[^a-z0-9]/.test(base.charAt(ref.length));
    });
    return { fileName, receiptId: found?.id ?? null };
  });
}

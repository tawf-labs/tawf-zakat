/**
 * Biaya operasional penyaluran (ADR-0042): one row per cost item, a free-text purpose
 * with no category, and a fund source per row — the institution's cash, an officer's
 * talangan (paid out of pocket, reimbursed later) or an officer's panjar (institution
 * cash carried into the field, accounted for and the rest returned).
 *
 * Costs are never aid: nothing here counts towards realisasi penyaluran.
 *
 * A pure module: no database, no network, no clock.
 */

import { addDecimalStrings, isExactNonNegativeDecimal } from "../../shared/exact-decimal";

export type FundingSource =
  | { kind: "KAS_LEMBAGA" }
  | { kind: "TALANGAN"; holderOfficerId: string }
  | { kind: "PANJAR"; panjarId: string };

export type FundingSourceKind = FundingSource["kind"];

export type CostItemInput = {
  /** The day the money was spent (YYYY-MM-DD), not when it was typed in. */
  spentOn: string;
  /** Keperluan: free text, e.g. "Bensin", "Sewa mobil pick-up". */
  purpose: string;
  quantity: string | null;
  unit: string | null;
  unitPriceIdr: string | null;
  amountIdr: string;
  /** Dibayarkan kepada: who was paid, e.g. a shop or a rental. */
  payee: string;
  fundingSource: FundingSource;
  /** The nota (or surat pernyataan) this row is evidenced by, on the same proposal. */
  receiptId: string | null;
};

export type CostItemStatus = "ACTIVE" | "VOIDED";

export type CostItemRecord = CostItemInput & {
  id: string;
  proposalId: string;
  version: number;
  status: CostItemStatus;
  /** Set once a talangan row has been paid back; the row is then closed to correction. */
  reimbursementId: string | null;
  recordedByOfficerId: string;
  recordedAt: number;
  updatedAt: number;
};

export type CostItemChange = "RECORD" | "CORRECT" | "VOID";

export type CostItemVersionRecord = {
  itemId: string;
  version: number;
  change: CostItemChange;
  /** The row exactly as it stood at this version. */
  item: CostItemInput & { status: CostItemStatus };
  reason: string | null;
  /**
   * The published report this change was made for, when the row was already covered by a
   * published period report and the change was declared as preparing its correction (#129).
   */
  reportCorrectionFor: string | null;
  actorOfficerId: string;
  actorAccount: string;
  at: number;
};

/** The published period report that froze a cost row (#129). */
export type CostItemLockRef = {
  packageId: string;
  reportId: string;
  version: string;
  period: { kind: "SEMESTER" | "AKHIR_TAHUN"; year: number };
};

/** A cost row as the tab shows it: with the report that locks it, if any. */
export type CostItemView = CostItemRecord & {
  lockedBy: CostItemLockRef | null;
  /** Changed after a report covering it was published, for that report's correction. */
  correctedAfterPublication: boolean;
};

export type PanjarInput = {
  holderOfficerId: string;
  amountIdr: string;
  purpose: string;
  /** No. bukti kas keluar. */
  cashOutRef: string;
  issuedOn: string;
};

export type PanjarReturnRecord = {
  id: string;
  amountIdr: string;
  returnedOn: string;
  reference: string;
  recordedAt: number;
};

export type PanjarRecord = PanjarInput & {
  id: string;
  proposalId: string;
  recordedByOfficerId: string;
  recordedAt: number;
  returns: PanjarReturnRecord[];
};

export type ReimbursementRecord = {
  id: string;
  proposalId: string;
  holderOfficerId: string;
  itemIds: string[];
  totalIdr: string;
  paidOn: string;
  reference: string;
  recordedByOfficerId: string;
  recordedAt: number;
};

export type CostIssue = { field: string; message: string };

/**
 * Nota/kuitansi as its own record, evidence for any number of cost rows. A surat
 * pernyataan stands in for a nota that was lost.
 */
export type ReceiptKind = "NOTA" | "SURAT_PERNYATAAN";

export type ReceiptInput = {
  kind: ReceiptKind;
  /** No. nota/kuitansi, or what a surat pernyataan declares. */
  reference: string;
  issuedOn: string;
  /** Penerbit: the shop or rental that issued it; unknown on a faded struk. */
  issuer: string | null;
};

export type ReceiptFileRecord = {
  id: string;
  receiptId: string;
  fileName: string;
  mimeType: ReceiptFileType;
  sizeBytes: number;
  /** SHA-256 of the plaintext; every download is checked against it. */
  contentSha256: string;
  uploadedByOfficerId: string;
  uploadedAt: number;
};

export type ReceiptRecord = ReceiptInput & {
  id: string;
  proposalId: string;
  recordedByOfficerId: string;
  recordedAt: number;
  /** When a cost row first cited it; from then on none of its files may be deleted. */
  evidencedAt: number | null;
  /** Carried over from the old free-text "Dokumen rujukan" (#128): the number only, no file. */
  legacy: boolean;
  files: ReceiptFileRecord[];
};

export type ReceiptFileType = "image/jpeg" | "image/png" | "application/pdf";

export type HolderPanjarSummary = {
  panjarId: string;
  cashOutRef: string;
  amountIdr: string;
  usedIdr: string;
  returnedIdr: string;
  remainingIdr: string;
};

export type HolderSummary = {
  officerId: string;
  name: string;
  talanganOutstandingIdr: string;
  talanganReimbursedIdr: string;
  panjar: HolderPanjarSummary[];
};

export type OperationalCostTotals = {
  /** Paid by the institution, directly or by reimbursing a talangan. */
  directExpensesIdr: string;
  /** Spent out of a panjar. */
  panjarAccountedIdr: string;
  /** Panjar handed out, less what came back. */
  panjarNetIdr: string;
  totalItemsIdr: string;
};

/** Correction and voiding both have to say why; the same floor as a contribution correction. */
export const MIN_CORRECTION_REASON = 5;

const MAX_TEXT = 200;
const MAX_IDR_DIGITS = 18;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const optional = (value: unknown): string | null => text(value) || null;

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const positiveIdr = (value: string): boolean =>
  /^\d+$/.test(value) && value.length <= MAX_IDR_DIGITS && BigInt(value) > 0n;

const positiveDecimal = (value: string): boolean =>
  isExactNonNegativeDecimal(value) && /[1-9]/.test(value) && value.length <= 24;

const canonicalDecimal = (value: string): string => {
  const [whole, fraction = ""] = value.split(".");
  const int = whole.replace(/^0+(?=\d)/, "");
  const frac = fraction.replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
};

/** quantity × unit price in whole rupiah, or null when the product has a fractional rupiah. */
export function exactLineTotal(quantity: string, unitPriceIdr: string): string | null {
  const [whole, fraction = ""] = quantity.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const product = BigInt(whole + fraction) * BigInt(unitPriceIdr);
  return product % scale === 0n ? (product / scale).toString() : null;
}

function fundingSourceOf(raw: unknown): FundingSource | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  if (source.kind === "KAS_LEMBAGA") return { kind: "KAS_LEMBAGA" };
  if (source.kind === "TALANGAN") {
    const holderOfficerId = text(source.holderOfficerId);
    return holderOfficerId ? { kind: "TALANGAN", holderOfficerId } : null;
  }
  if (source.kind === "PANJAR") {
    const panjarId = text(source.panjarId);
    return panjarId ? { kind: "PANJAR", panjarId } : null;
  }
  return null;
}

export function validateCostItemInput(
  input: unknown
): { ok: true; value: CostItemInput } | { ok: false; issues: CostIssue[] } {
  const raw = (input ?? {}) as Record<string, unknown>;
  const issues: CostIssue[] = [];
  const at = (field: string, message: string) => issues.push({ field, message });

  const spentOn = text(raw.spentOn);
  if (!isCalendarDate(spentOn)) at("spentOn", "Tanggal biaya wajib berupa tanggal yang sah (YYYY-MM-DD).");

  const purpose = text(raw.purpose);
  if (!purpose) at("purpose", "Keperluan wajib diisi, misalnya \"Bensin\" atau \"Sewa mobil\".");
  else if (purpose.length > MAX_TEXT) at("purpose", `Keperluan maksimal ${MAX_TEXT} karakter.`);

  const payee = text(raw.payee);
  if (!payee) at("payee", "Pihak yang dibayar wajib diisi, misalnya nama toko atau rental.");
  else if (payee.length > MAX_TEXT) at("payee", `Pihak yang dibayar maksimal ${MAX_TEXT} karakter.`);

  const amountIdr = text(raw.amountIdr);
  const amountOk = positiveIdr(amountIdr);
  if (!amountOk) at("amountIdr", "Total wajib berupa rupiah bulat lebih dari nol.");

  const quantityText = optional(raw.quantity);
  const quantity = quantityText && positiveDecimal(quantityText) ? canonicalDecimal(quantityText) : null;
  if (quantityText && !quantity) at("quantity", "Jumlah harus angka lebih dari nol (boleh desimal, mis. 2.5).");

  const unit = optional(raw.unit);
  if (unit && !quantityText) at("unit", "Satuan hanya diisi bersama jumlah.");
  else if (unit && unit.length > 40) at("unit", "Satuan maksimal 40 karakter.");

  const priceText = optional(raw.unitPriceIdr);
  const unitPriceIdr = priceText && positiveIdr(priceText) ? BigInt(priceText).toString() : null;
  if (priceText && !unitPriceIdr) at("unitPriceIdr", "Harga satuan harus rupiah bulat lebih dari nol.");

  if (amountOk && quantity && unitPriceIdr) {
    const expected = exactLineTotal(quantity, unitPriceIdr);
    if (expected === null) {
      at("amountIdr", "Jumlah × harga satuan menghasilkan pecahan rupiah; sesuaikan jumlah atau harganya.");
    } else if (expected !== BigInt(amountIdr).toString()) {
      at("amountIdr", `Total harus sama dengan jumlah × harga satuan (Rp${expected}).`);
    }
  }

  const fundingSource = fundingSourceOf(raw.fundingSource);
  if (!fundingSource) {
    at("fundingSource", "Sumber dana wajib dipilih: kas lembaga, talangan petugas (sebutkan petugasnya), atau panjar petugas (sebutkan panjarnya).");
  }

  if (issues.length > 0 || !fundingSource) return { ok: false, issues };
  return {
    ok: true,
    value: {
      spentOn, purpose, quantity, unit: quantity ? unit : null, unitPriceIdr,
      amountIdr: BigInt(amountIdr).toString(), payee, fundingSource, receiptId: optional(raw.receiptId),
    },
  };
}

export function validateReceiptInput(
  input: unknown
): { ok: true; value: ReceiptInput } | { ok: false; issues: CostIssue[] } {
  const raw = (input ?? {}) as Record<string, unknown>;
  const issues: CostIssue[] = [];
  const kind = raw.kind === "NOTA" || raw.kind === "SURAT_PERNYATAAN" ? raw.kind : null;
  if (!kind) issues.push({ field: "kind", message: "Jenis bukti wajib 'NOTA' atau 'SURAT_PERNYATAAN' (pengganti nota yang hilang)." });
  const reference = text(raw.reference);
  if (!reference || reference.length > MAX_TEXT) {
    issues.push({ field: "reference", message: `Nomor atau keterangan nota wajib diisi (maksimal ${MAX_TEXT} karakter).` });
  }
  const issuedOn = text(raw.issuedOn);
  if (!isCalendarDate(issuedOn)) issues.push({ field: "issuedOn", message: "Tanggal nota wajib berupa tanggal yang sah (YYYY-MM-DD)." });
  const issuer = optional(raw.issuer);
  if (issuer && issuer.length > MAX_TEXT) issues.push({ field: "issuer", message: `Penerbit nota maksimal ${MAX_TEXT} karakter.` });
  if (issues.length > 0 || !kind) return { ok: false, issues };
  return { ok: true, value: { kind, reference, issuedOn, issuer } };
}

const SIGNATURES: Array<[ReceiptFileType, number[]]> = [
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ["application/pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]],
];

/**
 * A receipt file is a photo (JPG/PNG) or a PDF, told by its leading bytes rather than
 * by the name or type the browser claims, so it is always served as what it is.
 */
export function receiptFileTypeOf(bytes: Uint8Array): ReceiptFileType | null {
  const match = SIGNATURES.find(([, signature]) => signature.every((byte, index) => bytes[index] === byte));
  return match ? match[0] : null;
}

export function validatePanjarInput(
  input: unknown
): { ok: true; value: PanjarInput } | { ok: false; issues: CostIssue[] } {
  const raw = (input ?? {}) as Record<string, unknown>;
  const issues: CostIssue[] = [];
  const holderOfficerId = text(raw.holderOfficerId);
  if (!holderOfficerId) issues.push({ field: "holderOfficerId", message: "Petugas penerima panjar wajib dipilih." });
  const amountIdr = text(raw.amountIdr);
  if (!positiveIdr(amountIdr)) issues.push({ field: "amountIdr", message: "Nominal panjar wajib rupiah bulat lebih dari nol." });
  const purpose = text(raw.purpose);
  if (!purpose || purpose.length > MAX_TEXT) issues.push({ field: "purpose", message: `Tujuan panjar wajib diisi (maksimal ${MAX_TEXT} karakter).` });
  const cashOutRef = text(raw.cashOutRef);
  if (!cashOutRef || cashOutRef.length > MAX_TEXT) issues.push({ field: "cashOutRef", message: "Nomor bukti kas keluar wajib diisi." });
  const issuedOn = text(raw.issuedOn);
  if (!isCalendarDate(issuedOn)) issues.push({ field: "issuedOn", message: "Tanggal panjar wajib berupa tanggal yang sah (YYYY-MM-DD)." });
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { holderOfficerId, amountIdr: BigInt(amountIdr).toString(), purpose, cashOutRef, issuedOn } };
}

const sum = (values: string[]): string => values.reduce((total, value) => addDecimalStrings(total, value), "0");
const active = (items: CostItemRecord[]) => items.filter((item) => item.status === "ACTIVE");

export const panjarReturnedIdr = (panjar: PanjarRecord): string => sum(panjar.returns.map((r) => r.amountIdr));

export const panjarUsedIdr = (panjarId: string, items: CostItemRecord[]): string =>
  sum(active(items).filter((i) => i.fundingSource.kind === "PANJAR" && i.fundingSource.panjarId === panjarId).map((i) => i.amountIdr));

/** What a panjar can still pay for: handed out, less spent, less returned. Never negative. */
export function panjarRemainingIdr(panjar: PanjarRecord, items: CostItemRecord[]): bigint {
  const remaining = BigInt(panjar.amountIdr) - BigInt(panjarUsedIdr(panjar.id, items)) - BigInt(panjarReturnedIdr(panjar));
  return remaining > 0n ? remaining : 0n;
}

/** The three figures activity accountability reads, voided rows excluded. */
export function operationalCostTotals(items: CostItemRecord[], panjars: PanjarRecord[]): OperationalCostTotals {
  const live = active(items);
  const fromPanjar = live.filter((i) => i.fundingSource.kind === "PANJAR");
  const direct = live.filter((i) => i.fundingSource.kind !== "PANJAR");
  const handedOut = BigInt(sum(panjars.map((p) => p.amountIdr)));
  const returned = BigInt(sum(panjars.map(panjarReturnedIdr)));
  return {
    directExpensesIdr: sum(direct.map((i) => i.amountIdr)),
    panjarAccountedIdr: sum(fromPanjar.map((i) => i.amountIdr)),
    panjarNetIdr: (handedOut > returned ? handedOut - returned : 0n).toString(),
    totalItemsIdr: sum(live.map((i) => i.amountIdr)),
  };
}

/** Per officer: talangan still owed and already paid back, and every panjar's use and remainder. */
export function summarizeHolders(
  items: CostItemRecord[],
  panjars: PanjarRecord[],
  names: Map<string, string>
): HolderSummary[] {
  const holders = new Map<string, HolderSummary>();
  const holder = (officerId: string) => {
    const existing = holders.get(officerId);
    if (existing) return existing;
    const created: HolderSummary = {
      officerId, name: names.get(officerId) ?? officerId,
      talanganOutstandingIdr: "0", talanganReimbursedIdr: "0", panjar: [],
    };
    holders.set(officerId, created);
    return created;
  };

  for (const item of active(items)) {
    if (item.fundingSource.kind !== "TALANGAN") continue;
    const entry = holder(item.fundingSource.holderOfficerId);
    if (item.reimbursementId) entry.talanganReimbursedIdr = addDecimalStrings(entry.talanganReimbursedIdr, item.amountIdr);
    else entry.talanganOutstandingIdr = addDecimalStrings(entry.talanganOutstandingIdr, item.amountIdr);
  }
  for (const panjar of panjars) {
    holder(panjar.holderOfficerId).panjar.push({
      panjarId: panjar.id,
      cashOutRef: panjar.cashOutRef,
      amountIdr: panjar.amountIdr,
      usedIdr: panjarUsedIdr(panjar.id, items),
      returnedIdr: panjarReturnedIdr(panjar),
      remainingIdr: panjarRemainingIdr(panjar, items).toString(),
    });
  }
  return [...holders.values()].sort((a, b) => a.name.localeCompare(b.name, "id"));
}

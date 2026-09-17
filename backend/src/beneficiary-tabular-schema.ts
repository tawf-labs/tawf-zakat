/**
 * Beneficiary Tabular Schema Mapper (Spec #86, Ticket #92).
 *
 * Maps a decoded TabularTable (from `tabular-reader`) into the same Beneficiary
 * and AidLine model the manual proposal form uses.
 *
 * Rules:
 * 1. Every row stays in the preview, broken ones included (US-24, Scenario 5), even
 *    when the file also has unsupported columns.
 * 2. Cells are turned into draft candidates and checked by the draft's own
 *    validators (`validateBeneficiary`, `validateAidLine`); this module only adds
 *    what a spreadsheet can get wrong and a typed form cannot (unknown identity or
 *    aid kind, half-filled representative, conflicting rows for one recipient).
 * 3. Missing or invalid values never become zeros; totals are marked partial.
 * 4. Unsupported columns are named as written and block applying the import.
 * 5. NIK stays 16-digit text and IDR stays an exact integer string.
 * 6. Rows for the same recipient (id_penerima, else NIK, else name + alternative
 *    identity) become one beneficiary with several aid lines.
 * 7. Exact duplicate aid lines are blocked. Aid already recorded on another
 *    proposal is flagged for review by `attachRecurringAidWarnings`, never refused.
 * 8. Optional contacts are kept as restricted confirmation data, never as identity.
 */

import type { TabularRow, TabularTable } from "./tabular-reader";
import {
  aidLineFingerprint,
  summarizeProposalDraft,
  validateAidLine,
  validateBeneficiary,
  type AidLine,
  type AidValue,
  type Beneficiary,
  type IdentityBasis,
  type ProposalIssue,
  type RecurringAidWarning,
} from "./disbursement";

export const BENEFICIARY_COLUMNS = [
  "id_baris",
  "id_penerima",
  "nama",
  "dasar_identitas",
  "nik",
  "keterangan_identitas",
  "nama_perwakilan",
  "hubungan_perwakilan",
  "alamat_cakupan",
  "asnaf",
  "jenis_bantuan",
  "nama_bantuan",
  "nilai_idr",
  "jumlah_barang",
  "satuan_barang",
  "nilai_idr_barang",
  "dasar_valuasi_barang",
  "periode_bantuan",
  "nama_penerima_pembayaran",
  "hubungan_penerima_pembayaran",
  "referensi_bukti",
  "kontak_telepon",
  "kontak_email",
  "kontak_relasi",
] as const;

export type BeneficiaryColumn = (typeof BENEFICIARY_COLUMNS)[number];

export type BeneficiaryTabularIssueCode =
  | "UNSUPPORTED_COLUMN"
  | "DUPLICATE_COLUMN"
  | "REQUIRED_FIELD_MISSING"
  | "INVALID_NIK"
  | "INVALID_IDENTITY_BASIS"
  | "INVALID_AMOUNT"
  | "INVALID_QUANTITY"
  | "INVALID_ASNAF"
  | "INVALID_AID_TYPE"
  | "MISSING_UNIT"
  | "EXACT_DUPLICATE_AID"
  | "DUPLICATE_LINE_ID"
  | "CONFLICTING_RECIPIENT"
  | "RECURRING_AID_WARNING"
  | "MISSING_GUARDIAN_RELATION"
  | "MISSING_PAYMENT_RECIPIENT_RELATION";

export type BeneficiaryTabularIssue = {
  scope: "file" | "row";
  rowNumber: number | null;
  /** The column header as the file wrote it. */
  column: string | null;
  field?: BeneficiaryColumn;
  message: string;
  code: BeneficiaryTabularIssueCode;
  isWarning?: boolean;
};

const aliases = (column: BeneficiaryColumn, names: string[]) => names.map((name) => [name, column] as const);

export const BENEFICIARY_COLUMN_ALIASES: Record<string, BeneficiaryColumn> = Object.fromEntries([
  ...BENEFICIARY_COLUMNS.map((column) => [column, column] as const),
  ...aliases("id_baris", ["id_rincian", "aid_line_id", "line_id"]),
  ...aliases("id_penerima", ["id_mustahik", "beneficiary_id", "mustahik_id"]),
  ...aliases("nama", ["nama_penerima", "nama_mustahik", "name", "penerima"]),
  ...aliases("dasar_identitas", ["jenis_identitas", "identity_basis", "dasar_id"]),
  ...aliases("nik", ["nomor_induk_kependudukan", "no_ktp", "ktp"]),
  ...aliases("keterangan_identitas", ["keterangan_id", "alasan_tanpa_nik", "identitas_alternatif", "dasar_alternatif"]),
  ...aliases("nama_perwakilan", ["nama_wali", "wali", "perwakilan", "guardian_name"]),
  ...aliases("hubungan_perwakilan", ["hubungan_wali", "relasi_perwakilan", "relasi_wali", "guardian_relationship"]),
  ...aliases("alamat_cakupan", ["alamat", "cakupan", "wilayah", "domisili", "address"]),
  ...aliases("asnaf", ["kategori_asnaf", "golongan_asnaf"]),
  ...aliases("jenis_bantuan", ["bantuan", "bentuk_bantuan", "jenis", "aid_type"]),
  ...aliases("nama_bantuan", ["nama_barang", "uraian_bantuan", "item_bantuan", "aid_name"]),
  ...aliases("nilai_idr", ["nominal", "jumlah_idr", "rupiah", "nilai", "amount", "jumlah_uang"]),
  ...aliases("jumlah_barang", ["kuantitas", "qty", "volume", "quantity"]),
  ...aliases("satuan_barang", ["satuan", "unit"]),
  ...aliases("nilai_idr_barang", ["taksiran_nilai", "taksiran_rupiah", "valuasi_idr", "nilai_taksiran", "goods_valuation"]),
  ...aliases("periode_bantuan", ["periode", "bulan_bantuan", "period"]),
  ...aliases("nama_penerima_pembayaran", ["penerima_pembayaran", "rekening_tujuan", "tujuan_transfer", "pihak_ketiga", "payment_recipient_name"]),
  ...aliases("hubungan_penerima_pembayaran", ["hubungan_pembayaran", "relasi_penerima_pembayaran", "relasi_pembayaran", "payment_recipient_relation"]),
  ...aliases("referensi_bukti", ["referensi_dokumen", "nomor_bukti", "rujukan_bukti", "nomor_surat", "reference"]),
  ...aliases("kontak_telepon", ["telepon", "no_hp", "no_telp", "nohp", "phone", "whatsapp", "wa"]),
  ...aliases("kontak_email", ["email", "surel"]),
  ...aliases("kontak_relasi", ["relasi_kontak", "hubungan_kontak"]),
]);

export const VALID_ASNAF = new Set(["FAKIR", "MISKIN", "AMIL", "MUALAF", "RIQAB", "GHARIM", "FISABILILLAH", "IBNU_SABIL"]);
const ASNAF_SPELLINGS: Record<string, string> = { MUALLAF: "MUALAF", GHARIMIN: "GHARIM" };

export type BeneficiaryCells = Record<BeneficiaryColumn, string>;

export type BeneficiaryRowPreview = {
  rowNumber: number;
  isValid: boolean;
  /** Trimmed cells keyed by template column, whatever alias the file used. */
  cells: BeneficiaryCells;
  issues: BeneficiaryTabularIssue[];
  beneficiary: Beneficiary | null;
  aidLine: AidLine | null;
  recipientKey: string | null;
};

export type BeneficiaryMappingResult = {
  uniqueBeneficiaryCount: number;
  aidLineCount: number;
  validRowsCount: number;
  invalidRowsCount: number;
  totalsByUnit: Record<string, string>;
  isPartial: boolean;
  /** False while a file-level problem (e.g. an unsupported column) remains. */
  canApply: boolean;
  /** The period shared from the proposal form, used where a row leaves it empty. */
  sharedAidPeriod: string | null;
  beneficiaries: Beneficiary[];
  aidLines: AidLine[];
  allRowsPreview: BeneficiaryRowPreview[];
  issues: BeneficiaryTabularIssue[];
};

type ColumnHeaders = Partial<Record<BeneficiaryColumn, { normalized: string; raw: string }>>;

function resolveHeaders(table: TabularTable): { headers: ColumnHeaders; issues: BeneficiaryTabularIssue[] } {
  const headers: ColumnHeaders = {};
  const issues: BeneficiaryTabularIssue[] = [];
  const fileIssue = (raw: string, code: BeneficiaryTabularIssueCode, message: string) =>
    issues.push({ scope: "file", rowNumber: null, column: raw, code, message });

  table.headers.forEach((raw, index) => {
    const normalized = table.normalizedHeaders[index];
    const column = BENEFICIARY_COLUMN_ALIASES[normalized];
    if (!column) {
      fileIssue(raw, "UNSUPPORTED_COLUMN", `Kolom "${raw}" tidak dikenali dalam template daftar penerima. Periksa template terversi resmi.`);
    } else if (headers[column]) {
      fileIssue(raw, "DUPLICATE_COLUMN", `Kolom "${raw}" dan "${headers[column]!.raw}" sama-sama berarti "${column}". Sisakan satu kolom.`);
    } else {
      headers[column] = { normalized, raw };
    }
  });
  return { headers, issues };
}

const cellsOf = (row: TabularRow, headers: ColumnHeaders): BeneficiaryCells =>
  Object.fromEntries(
    BENEFICIARY_COLUMNS.map((column) => {
      const header = headers[column];
      return [column, header ? (row.cells[header.normalized] ?? "").trim() : ""];
    })
  ) as BeneficiaryCells;

/** Draft validator fields, as the spreadsheet column that holds them. */
const beneficiaryFieldColumns: Record<string, (b: Beneficiary) => { column: BeneficiaryColumn; code: BeneficiaryTabularIssueCode }> = {
  name: () => ({ column: "nama", code: "REQUIRED_FIELD_MISSING" }),
  asnaf: () => ({ column: "asnaf", code: "REQUIRED_FIELD_MISSING" }),
  addressOrScope: () => ({ column: "alamat_cakupan", code: "REQUIRED_FIELD_MISSING" }),
  identityBasis: (b) =>
    b.identityBasis.kind === "NIK"
      ? { column: "nik", code: "INVALID_NIK" }
      : { column: "keterangan_identitas", code: "INVALID_IDENTITY_BASIS" },
};

const aidLineFieldColumns: Record<string, { column: BeneficiaryColumn; code: BeneficiaryTabularIssueCode }> = {
  aidType: { column: "nama_bantuan", code: "REQUIRED_FIELD_MISSING" },
  period: { column: "periode_bantuan", code: "REQUIRED_FIELD_MISSING" },
  "value.amountRequestedIdr": { column: "nilai_idr", code: "INVALID_AMOUNT" },
  "value.unit": { column: "satuan_barang", code: "MISSING_UNIT" },
  "value.quantityRequested": { column: "jumlah_barang", code: "INVALID_QUANTITY" },
  "value.valuationBasis": { column: "dasar_valuasi_barang", code: "REQUIRED_FIELD_MISSING" },
  "value.valuedAmountIdr": { column: "nilai_idr_barang", code: "INVALID_AMOUNT" },
};

/** Stand-in ids so the draft validators judge content only; real ids are assigned once a row is valid. */
const CANDIDATE_ID = "candidate";

type ParsedRow = {
  issues: BeneficiaryTabularIssue[];
  beneficiary: Beneficiary | null;
  aidLine: AidLine | null;
};

function parseRow(
  rowNumber: number,
  cells: BeneficiaryCells,
  headers: ColumnHeaders,
  sharedAidPeriod: string | null
): ParsedRow {
  const issues: BeneficiaryTabularIssue[] = [];
  const header = (column: BeneficiaryColumn) => headers[column]?.raw ?? column;
  const issueAt = (column: BeneficiaryColumn, code: BeneficiaryTabularIssueCode, detail: string) =>
    issues.push({
      scope: "row",
      rowNumber,
      column: header(column),
      field: column,
      code,
      message: `Baris ${rowNumber} kolom "${header(column)}": ${detail}`,
    });
  const bothOrNeither = (nameColumn: BeneficiaryColumn, relationColumn: BeneficiaryColumn, code: BeneficiaryTabularIssueCode, label: string) => {
    const name = cells[nameColumn];
    const relation = cells[relationColumn];
    if (!name && !relation) return null;
    if (!name) issueAt(nameColumn, code, `Nama ${label} harus diisi bila hubungannya diisi.`);
    else if (!relation) issueAt(relationColumn, code, `Hubungan ${label} harus diisi bila namanya diisi.`);
    else return { name, relation };
    return null;
  };

  const identityBasis = identityOf(cells);
  if (!identityBasis) {
    issueAt("dasar_identitas", "INVALID_IDENTITY_BASIS", "Dasar identitas harus 'NIK' atau 'ALTERNATIF'.");
  }

  const asnaf = ASNAF_SPELLINGS[cells.asnaf.toUpperCase()] ?? cells.asnaf.toUpperCase();
  if (asnaf && !VALID_ASNAF.has(asnaf)) {
    issueAt("asnaf", "INVALID_ASNAF", `Kategori asnaf "${cells.asnaf}" tidak sah. Pilih salah satu: Fakir, Miskin, Amil, Mualaf, Riqab, Gharim, Fisabilillah, Ibnu Sabil.`);
  }

  const guardian = bothOrNeither("nama_perwakilan", "hubungan_perwakilan", "MISSING_GUARDIAN_RELATION", "perwakilan/wali");
  const paymentRecipient = bothOrNeither("nama_penerima_pembayaran", "hubungan_penerima_pembayaran", "MISSING_PAYMENT_RECIPIENT_RELATION", "penerima pembayaran");

  const value = aidValueOf(cells);
  if (!value) issueAt("jenis_bantuan", "INVALID_AID_TYPE", "Jenis bantuan harus 'UANG' atau 'BARANG'.");

  const hasContact = cells.kontak_telepon || cells.kontak_email || cells.kontak_relasi;
  const beneficiary: Beneficiary | null = identityBasis && {
    id: cells.id_penerima || CANDIDATE_ID,
    name: cells.nama,
    identityBasis,
    asnaf,
    addressOrScope: cells.alamat_cakupan,
    guardian: guardian && { name: guardian.name, relationship: guardian.relation },
    paymentRecipient,
    contact: hasContact
      ? { phone: cells.kontak_telepon || null, email: cells.kontak_email || null, relation: cells.kontak_relasi || null }
      : null,
  };
  const aidLine: AidLine | null = value && {
    id: cells.id_baris || CANDIDATE_ID,
    beneficiaryId: beneficiary?.id ?? CANDIDATE_ID,
    aidType: cells.nama_bantuan || (value.kind === "MONEY" ? "UANG" : "BARANG"),
    period: cells.periode_bantuan || sharedAidPeriod || "",
    value,
    evidenceReference: cells.referensi_bukti || null,
  };

  const draftIssues: ProposalIssue[] = [];
  if (beneficiary) validateBeneficiary(beneficiary, 0, draftIssues);
  if (aidLine) validateAidLine(aidLine, 0, new Set([aidLine.beneficiaryId]), draftIssues);
  for (const issue of draftIssues) {
    const target =
      issue.scope === "recipient"
        ? beneficiaryFieldColumns[issue.field]?.(beneficiary!)
        : aidLineFieldColumns[issue.field];
    if (target) issueAt(target.column, target.code, issue.message);
  }

  return { issues, beneficiary, aidLine };
}

function identityOf(cells: BeneficiaryCells): IdentityBasis | null {
  const kind = cells.dasar_identitas.toUpperCase();
  if (kind === "NIK" || (!kind && cells.nik)) return { kind: "NIK", value: cells.nik };
  if (kind === "ALTERNATIF" || (!kind && cells.keterangan_identitas)) {
    return { kind: "ALTERNATIVE", description: cells.keterangan_identitas };
  }
  return null;
}

function aidValueOf(cells: BeneficiaryCells): AidValue | null {
  const kind = cells.jenis_bantuan.toUpperCase();
  if (kind === "UANG" || (!kind && cells.nilai_idr)) {
    return { kind: "MONEY", amountRequestedIdr: cells.nilai_idr, amountApprovedIdr: null };
  }
  if (kind === "BARANG" || (!kind && (cells.jumlah_barang || cells.satuan_barang))) {
    return {
      kind: "GOODS",
      unit: cells.satuan_barang,
      quantityRequested: cells.jumlah_barang,
      quantityApproved: null,
      valuedAmountIdr: cells.nilai_idr_barang || null,
      valuationBasis: cells.dasar_valuasi_barang || null,
    };
  }
  return null;
}

/** Everything that describes the person, so two rows claiming one recipient can be compared. */
const recipientMaterial = ({ id: _id, ...rest }: Beneficiary) => JSON.stringify(rest);

/**
 * Merges valid rows into beneficiaries and aid lines, assigning ids once.
 * Rows that contradict an earlier row for the same recipient, reuse a line id,
 * or repeat an aid line exactly are turned invalid with a located issue.
 */
function groupRows(rows: BeneficiaryRowPreview[], nextId: () => string) {
  const byKey = new Map<string, Beneficiary>();
  const keyByNik = new Map<string, string>();
  const lineIds = new Set<string>();
  const fingerprints = new Set<string>();
  const beneficiaries: Beneficiary[] = [];
  const aidLines: AidLine[] = [];

  const reject = (row: BeneficiaryRowPreview, code: BeneficiaryTabularIssueCode, detail: string) => {
    row.isValid = false;
    row.issues.push({ scope: "row", rowNumber: row.rowNumber, column: null, code, message: `Baris ${row.rowNumber}: ${detail}` });
  };

  for (const row of rows) {
    if (!row.isValid || !row.beneficiary || !row.aidLine) continue;
    const candidate = row.beneficiary;
    const nik = candidate.identityBasis.kind === "NIK" ? candidate.identityBasis.value : null;
    const ownKey = row.cells.id_penerima
      ? `id:${row.cells.id_penerima}`
      : nik
      ? `nik:${nik}`
      : `alt:${candidate.name.toLowerCase()}:${candidate.identityBasis.kind === "ALTERNATIVE" ? candidate.identityBasis.description.toLowerCase() : ""}`;
    const nikKey = nik ? keyByNik.get(nik) : undefined;
    if (nikKey && nikKey !== ownKey && row.cells.id_penerima) {
      reject(row, "CONFLICTING_RECIPIENT", `NIK ini sudah dipakai penerima lain dengan id_penerima berbeda.`);
      continue;
    }
    const key = nikKey ?? ownKey;

    const existing = byKey.get(key);
    if (existing && recipientMaterial(existing) !== recipientMaterial({ ...candidate, id: existing.id })) {
      reject(row, "CONFLICTING_RECIPIENT", `Data penerima "${candidate.name}" berbeda dengan baris sebelumnya untuk penerima yang sama. Samakan nama, identitas, asnaf, alamat, perwakilan, dan kontak.`);
      continue;
    }
    if (row.cells.id_baris && lineIds.has(row.cells.id_baris)) {
      reject(row, "DUPLICATE_LINE_ID", `id_baris "${row.cells.id_baris}" sudah dipakai baris lain.`);
      continue;
    }

    const beneficiary = existing ?? { ...candidate, id: row.cells.id_penerima || nextId() };
    const line: AidLine = { ...row.aidLine, id: row.cells.id_baris || nextId(), beneficiaryId: beneficiary.id };
    const fingerprint = aidLineFingerprint(line);
    if (fingerprints.has(fingerprint)) {
      reject(row, "EXACT_DUPLICATE_AID", `Rincian bantuan ini duplikat persis baris lain untuk penerima "${beneficiary.name}". Duplikasi persis diblokir.`);
      continue;
    }

    if (!existing) {
      byKey.set(key, beneficiary);
      beneficiaries.push(beneficiary);
    }
    if (nik) keyByNik.set(nik, key);
    lineIds.add(line.id);
    fingerprints.add(fingerprint);
    aidLines.push(line);
    row.beneficiary = beneficiary;
    row.aidLine = line;
    row.recipientKey = key;
  }

  for (const row of rows) {
    if (!row.isValid) {
      row.beneficiary = null;
      row.aidLine = null;
    }
  }
  return { beneficiaries, aidLines };
}

/** Maps a decoded TabularTable into the proposal draft model, keeping every row visible. */
export function mapBeneficiaryTabular(
  table: TabularTable,
  options?: { sharedAidPeriod?: string; generateId?: () => string }
): BeneficiaryMappingResult {
  const nextId = options?.generateId ?? (() => crypto.randomUUID());
  const sharedAidPeriod = options?.sharedAidPeriod?.trim() || null;
  const { headers, issues: fileIssues } = resolveHeaders(table);

  const allRowsPreview: BeneficiaryRowPreview[] = table.rows.map((row) => {
    const cells = cellsOf(row, headers);
    const parsed = parseRow(row.rowNumber, cells, headers, sharedAidPeriod);
    return {
      rowNumber: row.rowNumber,
      isValid: parsed.issues.length === 0,
      cells,
      issues: parsed.issues,
      beneficiary: parsed.beneficiary,
      aidLine: parsed.aidLine,
      recipientKey: null,
    };
  });

  const { beneficiaries, aidLines } = groupRows(allRowsPreview, nextId);
  const summary = summarizeProposalDraft({ beneficiaries, aidLines });
  const validRowsCount = allRowsPreview.filter((row) => row.isValid).length;
  const invalidRowsCount = allRowsPreview.length - validRowsCount;

  return {
    uniqueBeneficiaryCount: summary.uniqueBeneficiaryCount,
    aidLineCount: summary.aidLineCount,
    validRowsCount,
    invalidRowsCount,
    totalsByUnit: summary.totalsByUnit,
    isPartial: summary.isPartial || invalidRowsCount > 0 || fileIssues.length > 0,
    canApply: fileIssues.length === 0 && validRowsCount > 0,
    sharedAidPeriod,
    beneficiaries,
    aidLines,
    allRowsPreview,
    issues: [...fileIssues, ...allRowsPreview.flatMap((row) => row.issues)],
  };
}

/** Flags recipients already recorded on another proposal, on their first row, for review only. */
export function attachRecurringAidWarnings(
  result: BeneficiaryMappingResult,
  warnings: RecurringAidWarning[]
): BeneficiaryMappingResult {
  for (const warning of warnings) {
    const row = result.allRowsPreview.find((item) => item.beneficiary?.id === warning.beneficiaryId);
    if (!row) continue;
    const issue: BeneficiaryTabularIssue = {
      scope: "row",
      rowNumber: row.rowNumber,
      column: null,
      code: "RECURRING_AID_WARNING",
      isWarning: true,
      message: `Baris ${row.rowNumber}: ${warning.message}`,
    };
    row.issues.push(issue);
    result.issues.push(issue);
  }
  return result;
}

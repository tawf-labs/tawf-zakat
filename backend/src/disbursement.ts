/**
 * Program bantuan and durable Pengajuan drafts, before anything is submitted
 * for pemeriksaan (Spec #86, ticket #89).
 *
 * A pure module: no database, no clock. It only shapes and validates what a
 * caller hands in - the store decides where it lives, the routes decide who
 * may call it.
 *
 * This ticket's own slice, and deliberately not more:
 *
 * - **Program is durable, not a draft.** Its name must "benar-benar
 *   tersimpan", so creating one always writes a row; there is no unsaved
 *   in-between for a program the way there is for a proposal.
 * - **A proposal draft may be incomplete.** It keeps its own list of issues
 *   alongside the data, and saving never refuses because the draft is not
 *   ready - only submitting for review would, and that is the next slice.
 * - **Money keeps its precision.** IDR amounts are decimal integer strings,
 *   never a JavaScript number: this module rejects anything that is not an
 *   exact non-negative integer string, including "1e3" and "12.50".
 * - **Goods are not money.** A quantity has its own unit; different units are
 *   never summed, and an unknown valuation is kept absent, never turned into
 *   a zero rupiah figure.
 */

import { createHash } from "node:crypto";
import { addDecimalStrings, compareDecimalStrings, subtractDecimalStrings, isExactNonNegativeDecimal } from "../../shared/exact-decimal";
import type { RevisionDelta, RevisionDeltaResult } from "../../shared/proposal-revision";
export { addDecimalStrings, compareDecimalStrings, subtractDecimalStrings, isExactNonNegativeDecimal } from "../../shared/exact-decimal";
// Revision delta and the realization floor are one pure core shared with the browser (ADR-0017 §1).
export {
  accumulateRealizedPerLine,
  calculateRevisionDelta,
  validateRevisionFloor,
} from "../../shared/proposal-revision";
export {
  compareProposalBeneficiaryLists,
  calculateTotalsByUnit,
  describeBeneficiaryChanges,
  describeAidLineChanges,
  type DiffStatus,
  type FieldDiff,
  type ProposalBeneficiaryListCounts,
  type ProposalBeneficiaryListRow,
  type ProposalBeneficiaryListDiff,
} from "../../shared/proposal-beneficiary-list";

export type FundType = "ZAKAT" | "INFAK" | "SEDEKAH" | "LAINNYA";
export const FUND_TYPES: FundType[] = ["ZAKAT", "INFAK", "SEDEKAH", "LAINNYA"];
export const isFundType = (value: unknown): value is FundType =>
  typeof value === "string" && (FUND_TYPES as string[]).includes(value);

export type ProgramStatus = "ACTIVE" | "ARCHIVED";

export type ProgramInput = {
  name: string;
  purpose: string;
  fundType: FundType;
  scope: string;
  /** Rupiah, as a decimal integer string. Absent means no reference pagu is stated. */
  referenceCeiling: string | null;
};

export type ProgramIssue = { field: string; message: string };

export type ProgramRecord = {
  id: string;
  institutionId: string;
  name: string;
  purpose: string;
  fundType: FundType;
  scope: string;
  referenceCeiling: string | null;
  status: ProgramStatus;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

/** A non-negative integer, written exactly - no exponents, no decimal point, no sign. */
export const isExactNonNegativeInteger = (value: string): boolean => /^\d+$/.test(value);

export function validateProgramInput(input: ProgramInput): ProgramIssue[] {
  const issues: ProgramIssue[] = [];
  if (input.name.trim() === "") issues.push({ field: "name", message: "Nama program tidak boleh kosong." });
  if (input.purpose.trim() === "") issues.push({ field: "purpose", message: "Tujuan program tidak boleh kosong." });
  if (!isFundType(input.fundType)) issues.push({ field: "fundType", message: "Jenis dana tidak dikenal." });
  if (input.scope.trim() === "") issues.push({ field: "scope", message: "Cakupan/periode program tidak boleh kosong." });
  if (input.referenceCeiling !== null && !isExactNonNegativeInteger(input.referenceCeiling)) {
    issues.push({ field: "referenceCeiling", message: "Pagu referensi harus berupa angka rupiah bulat, tanpa desimal." });
  }
  return issues;
}

export type IdentityBasis =
  | { kind: "NIK"; value: string }
  | { kind: "ALTERNATIVE"; description: string };

export type Guardian = { name: string; relationship: string };

export type BeneficiaryContact = {
  phone?: string | null;
  email?: string | null;
  relation?: string | null;
};

export type Beneficiary = {
  /** Stable within this proposal. Assigned once, kept on every re-save. */
  id: string;
  name: string;
  identityBasis: IdentityBasis;
  asnaf: string;
  addressOrScope: string;
  guardian: Guardian | null;
  /** When the payment goes to someone other than the beneficiary (e.g. a school). */
  paymentRecipient: { name: string; relation: string } | null;
  /** Optional contact for verification and notification (Ticket #92). */
  contact?: BeneficiaryContact | null;
};

export type AidValue =
  | {
      kind: "MONEY";
      /** Rupiah requested, as a decimal integer string. */
      amountRequestedIdr: string;
      /** Approved amount, set by the approval slice - always null in this ticket. */
      amountApprovedIdr: string | null;
    }
  | {
      kind: "GOODS";
      unit: string;
      /** Quantity requested, as a decimal string in `unit`. */
      quantityRequested: string;
      quantityApproved: string | null;
      /** Rupiah valuation, only when a valuation basis is actually available. */
      valuedAmountIdr: string | null;
      /** Institution-declared source and calculation for the proposal estimate; absent on legacy data. */
      valuationBasis?: string | null;
    };

/** A proposal estimate is usable only with the institution's stated valuation basis. */
export function goodsValuationOf(value: Extract<AidValue, { kind: "GOODS" }>): string | null {
  return typeof value.valuationBasis === "string" && value.valuationBasis.trim()
    && value.valuedAmountIdr != null && isExactNonNegativeInteger(value.valuedAmountIdr)
    ? value.valuedAmountIdr : null;
}

export type AidLine = {
  /** Stable within this proposal. */
  id: string;
  beneficiaryId: string;
  aidType: string;
  /** Explicit aid period, distinct from the reporting period. */
  period: string;
  value: AidValue;
  /**
   * Free-text note naming a supporting document (e.g. a letter number). Never
   * evidence that the document exists - only a stored proposal document is.
   */
  evidenceReference?: string | null;
};

export type ProposalIssue = {
  scope: "proposal" | "recipient" | "aidLine";
  /** Index into `beneficiaries` or `aidLines`, matching `scope`. Null for a proposal-level issue. */
  rowIndex: number | null;
  field: string;
  message: string;
};

export type ProposalDraftInput = {
  programId: string | null;
  originOfRequest: string;
  purpose: string;
  aidPeriod: { start: string; end: string } | null;
  personInCharge: string;
  beneficiaries: Beneficiary[];
  aidLines: AidLine[];
};

const isIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

export function validateBeneficiary(row: Beneficiary, index: number, issues: ProposalIssue[]): void {
  const at = (field: string, message: string) => issues.push({ scope: "recipient", rowIndex: index, field, message });
  if (row.id.trim() === "") at("id", "Penerima harus mempunyai ID internal.");
  if (row.name.trim() === "") at("name", "Nama penerima tidak boleh kosong.");
  if (row.asnaf.trim() === "") at("asnaf", "Kategori asnaf tidak boleh kosong.");
  if (row.addressOrScope.trim() === "") at("addressOrScope", "Alamat/cakupan penerima tidak boleh kosong.");

  if (row.identityBasis.kind === "NIK") {
    if (!/^\d{16}$/.test(row.identityBasis.value)) {
      at("identityBasis", "NIK harus 16 digit angka, disimpan sebagai teks.");
    }
  } else if (row.identityBasis.description.trim() === "") {
    at(
      "identityBasis",
      "Dasar identitas alternatif harus dijelaskan (mis. anak tanpa KTP); tidak boleh mengarang NIK."
    );
  }
}

export function validateAidLine(
  row: AidLine,
  index: number,
  beneficiaryIds: Set<string>,
  issues: ProposalIssue[]
): void {
  const at = (field: string, message: string) => issues.push({ scope: "aidLine", rowIndex: index, field, message });
  if (row.id.trim() === "") at("id", "Rincian bantuan harus mempunyai ID internal.");
  if (!beneficiaryIds.has(row.beneficiaryId)) {
    at("beneficiaryId", "Rincian bantuan menunjuk penerima yang tidak ada pada draf ini.");
  }
  if (row.aidType.trim() === "") at("aidType", "Jenis bantuan tidak boleh kosong.");
  if (row.period.trim() === "") at("period", "Periode bantuan pada rincian ini harus diisi secara eksplisit.");

  if (row.value.kind === "MONEY") {
    if (!isExactNonNegativeInteger(row.value.amountRequestedIdr)) {
      at("value.amountRequestedIdr", "Jumlah IDR harus bilangan bulat rupiah, tanpa desimal.");
    }
  } else {
    if (row.value.unit.trim() === "") at("value.unit", "Satuan barang harus dinyatakan.");
    if (!isExactNonNegativeDecimal(row.value.quantityRequested)) {
      at("value.quantityRequested", "Jumlah barang harus angka eksak dengan satuan yang dinyatakan.");
    }
    if (row.value.valuedAmountIdr !== null && !isExactNonNegativeInteger(row.value.valuedAmountIdr)) {
      at("value.valuedAmountIdr", "Nilai IDR barang harus bilangan bulat rupiah bila dasar penilaian tersedia.");
    }
    if (row.value.valuedAmountIdr !== null && !(typeof row.value.valuationBasis === "string" && row.value.valuationBasis.trim())) {
      at("value.valuationBasis", "Nyatakan sumber dan perhitungan estimasi nilai barang, atau kosongkan nilai IDR.");
    }
  }
}

/** Two aid lines are the same event if every field but the id matches. */
export const aidLineFingerprint = (row: AidLine): string =>
  JSON.stringify([row.beneficiaryId, row.aidType, row.period, row.value]);

export function validateProposalDraft(input: ProposalDraftInput): ProposalIssue[] {
  const issues: ProposalIssue[] = [];

  if (!input.programId) issues.push({ scope: "proposal", rowIndex: null, field: "programId", message: "Pengajuan harus menunjuk satu program." });
  if (input.originOfRequest.trim() === "") issues.push({ scope: "proposal", rowIndex: null, field: "originOfRequest", message: "Asal permohonan tidak boleh kosong." });
  if (input.purpose.trim() === "") issues.push({ scope: "proposal", rowIndex: null, field: "purpose", message: "Tujuan pengajuan tidak boleh kosong." });
  if (input.personInCharge.trim() === "") issues.push({ scope: "proposal", rowIndex: null, field: "personInCharge", message: "Penanggung jawab pengajuan tidak boleh kosong." });
  if (!input.aidPeriod || !isIsoDate(input.aidPeriod.start) || !isIsoDate(input.aidPeriod.end)) {
    issues.push({
      scope: "proposal",
      rowIndex: null,
      field: "aidPeriod",
      message: "Periode bantuan harus dipilih secara eksplisit, bukan mengikuti bulan berjalan.",
    });
  }
  if (input.beneficiaries.length === 0) {
    issues.push({ scope: "proposal", rowIndex: null, field: "beneficiaries", message: "Pengajuan harus mempunyai sekurangnya satu penerima." });
  }

  const seenBeneficiaryIds = new Set<string>();
  input.beneficiaries.forEach((row, index) => {
    validateBeneficiary(row, index, issues);
    if (seenBeneficiaryIds.has(row.id)) {
      issues.push({ scope: "recipient", rowIndex: index, field: "id", message: "ID penerima muncul lebih dari sekali pada draf ini." });
    }
    seenBeneficiaryIds.add(row.id);
  });

  const seenAidLineIds = new Set<string>();
  const seenFingerprints = new Set<string>();
  input.aidLines.forEach((row, index) => {
    validateAidLine(row, index, seenBeneficiaryIds, issues);
    if (seenAidLineIds.has(row.id)) {
      issues.push({ scope: "aidLine", rowIndex: index, field: "id", message: "ID rincian bantuan muncul lebih dari sekali pada draf ini." });
    }
    seenAidLineIds.add(row.id);

    const fingerprint = aidLineFingerprint(row);
    if (seenFingerprints.has(fingerprint)) {
      issues.push({
        scope: "aidLine",
        rowIndex: index,
        field: "value",
        message: "Rincian bantuan ini duplikat persis dari baris lain pada draf yang sama.",
      });
    }
    seenFingerprints.add(fingerprint);
  });

  return issues;
}

export type ProposalTotals = {
  uniqueBeneficiaryCount: number;
  aidLineCount: number;
  /** Keyed by "IDR" for money, or "<aidType>:<unit>" for goods. Never mixes units. */
  totalsByUnit: Record<string, string>;
  /** True when at least one goods line has no valuation and so is excluded from an IDR total. */
  isPartial: boolean;
};

export function summarizeProposalDraft(input: Pick<ProposalDraftInput, "beneficiaries" | "aidLines">): ProposalTotals {
  const totalsByUnit: Record<string, string> = {};
  let isPartial = false;

  for (const line of input.aidLines) {
    if (line.value.kind === "MONEY") {
      if (isExactNonNegativeInteger(line.value.amountRequestedIdr)) {
        totalsByUnit.IDR = addDecimalStrings(totalsByUnit.IDR ?? "0", line.value.amountRequestedIdr);
      }
      continue;
    }
    const key = `${line.aidType}:${line.value.unit}`;
    if (isExactNonNegativeDecimal(line.value.quantityRequested)) {
      totalsByUnit[key] = addDecimalStrings(totalsByUnit[key] ?? "0", line.value.quantityRequested);
    }
    if (goodsValuationOf(line.value) === null) isPartial = true;
  }

  return {
    uniqueBeneficiaryCount: input.beneficiaries.length,
    aidLineCount: input.aidLines.length,
    totalsByUnit,
    isPartial,
  };
}

/** Assigns a stable id to any beneficiary/aid line the caller did not already tag. */
export function withStableIds(input: ProposalDraftInput, newId: () => string): ProposalDraftInput {
  return {
    ...input,
    beneficiaries: input.beneficiaries.map((row) => (row.id.trim() ? row : { ...row, id: newId() })),
    aidLines: input.aidLines.map((row) => (row.id.trim() ? row : { ...row, id: newId() })),
  };
}

// ---------------------------------------------------------------------------
// Ticket #91: Documents, Lifecycle, and Examination Types
// ---------------------------------------------------------------------------

export type ProposalStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_EXAMINATION"
  | "REVISION_REQUIRED"
  | "READY_FOR_DECISION"
  | "WITHDRAWN"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "REMAINDER_CLOSED";

export const PROPOSAL_STATUSES: ProposalStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_EXAMINATION",
  "REVISION_REQUIRED",
  "READY_FOR_DECISION",
  "WITHDRAWN",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "REMAINDER_CLOSED",
];

export const isProposalStatus = (value: unknown): value is ProposalStatus =>
  typeof value === "string" && (PROPOSAL_STATUSES as string[]).includes(value);

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  DRAFT: "Draf",
  SUBMITTED: "Diajukan",
  UNDER_EXAMINATION: "Dalam pemeriksaan",
  REVISION_REQUIRED: "Perlu revisi",
  READY_FOR_DECISION: "Siap keputusan",
  WITHDRAWN: "Ditarik",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  CANCELLED: "Dibatalkan",
  REMAINDER_CLOSED: "Sisa ditutup",
};

export type ProposalDocumentCategory =
  | "PROPOSAL_LETTER"
  | "RECIPIENT_VERIFICATION"
  | "BENEFICIARY_IDENTITY"
  | "ALTERNATIVE_IDENTITY_PROOF"
  | "REPRESENTATION_PROOF"
  | "PAYMENT_RECIPIENT_PROOF"
  | "BENEFICIARY_ROSTER"
  | "OTHER";

export const PROPOSAL_DOCUMENT_CATEGORIES: ProposalDocumentCategory[] = [
  "PROPOSAL_LETTER",
  "RECIPIENT_VERIFICATION",
  "BENEFICIARY_IDENTITY",
  "ALTERNATIVE_IDENTITY_PROOF",
  "REPRESENTATION_PROOF",
  "PAYMENT_RECIPIENT_PROOF",
  "BENEFICIARY_ROSTER",
  "OTHER",
];

export const isProposalDocumentCategory = (value: unknown): value is ProposalDocumentCategory =>
  typeof value === "string" && (PROPOSAL_DOCUMENT_CATEGORIES as string[]).includes(value);

export const PROPOSAL_DOCUMENT_CATEGORY_LABELS: Record<ProposalDocumentCategory, string> = {
  PROPOSAL_LETTER: "Surat Permohonan / Proposal",
  RECIPIENT_VERIFICATION: "Berita Acara / Surat Keterangan Verifikasi Penerima",
  BENEFICIARY_IDENTITY: "KTP / Kartu Keluarga",
  ALTERNATIVE_IDENTITY_PROOF: "Surat Keterangan Identitas Alternatif",
  REPRESENTATION_PROOF: "Surat Kuasa / Dokumen Perwakilan",
  PAYMENT_RECIPIENT_PROOF: "Dokumen Rekening / Penerima Pembayaran",
  BENEFICIARY_ROSTER: "Berkas Impor Daftar Penerima (XLSX/CSV)",
  OTHER: "Dokumen Pendukung Lainnya",
};

export type ProposalDocumentRecord = {
  id: string;
  proposalId: string;
  institutionId: string;
  beneficiaryId: string | null;
  category: ProposalDocumentCategory;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  storageStatus: "STORED" | "FAILED";
  storageRef: string | null;
  version: number;
  createdBy: string;
  createdAt: number;
};

export type DisbursementPolicy = {
  institutionId: string;
  requireProposalLetter: boolean;
  /** One document verifying the whole roster, e.g. a berita acara or RT/RW letter (ADR-0040). */
  requireRecipientVerification: boolean;
  /**
   * The institution decides through its own internal process (e.g. a board meeting), so
   * the amil publishes a complete proposal straight to APPROVED citing that decision
   * (ADR-0041). False keeps the in-app examination and signed decision as the only path.
   */
  decisionOutsideApp: boolean;
  requireIdentityDoc: boolean;
  requireAlternativeIdProof: boolean;
  requireGuardianProof: boolean;
  warnRecurringAid: boolean;
  sopRequiresMultiSignerQuorum: boolean;
  version: number;
  updatedAt: number;
  updatedBy: string;
};

/**
 * One recipient verification document is enough by default; per-mustahik KTP/KK,
 * alternative identity and guardian proofs are opt-in for institutions whose SOP
 * asks for them (ADR-0040).
 */
export const DEFAULT_DISBURSEMENT_POLICY = (institutionId: string): DisbursementPolicy => ({
  institutionId,
  requireProposalLetter: false,
  requireRecipientVerification: true,
  decisionOutsideApp: true,
  requireIdentityDoc: false,
  requireAlternativeIdProof: false,
  requireGuardianProof: false,
  warnRecurringAid: true,
  sopRequiresMultiSignerQuorum: false,
  version: 1,
  updatedAt: 0,
  updatedBy: "system",
});

export type ProposalCompletenessIssue = {
  scope: "proposal" | "recipient" | "aidLine" | "document";
  rowIndex: number | null;
  beneficiaryId?: string | null;
  field: string;
  message: string;
};

export function validateProposalForSubmission(
  input: ProposalDraftInput,
  documents: Pick<ProposalDocumentRecord, "category" | "beneficiaryId" | "storageStatus">[],
  policy: Pick<
    DisbursementPolicy,
    | "requireProposalLetter"
    | "requireRecipientVerification"
    | "requireIdentityDoc"
    | "requireAlternativeIdProof"
    | "requireGuardianProof"
  >
): ProposalCompletenessIssue[] {
  const issues: ProposalCompletenessIssue[] = [];

  // 1. Proposal-level checks
  const baseIssues = validateProposalDraft(input);
  for (const bi of baseIssues) {
    issues.push({
      scope: bi.scope,
      rowIndex: bi.rowIndex,
      field: bi.field,
      message: bi.message,
    });
  }

  // 2. Document completeness checks according to policy
  const storedDocs = documents.filter((d) => d.storageStatus === "STORED");

  if (policy.requireProposalLetter) {
    const hasLetter = storedDocs.some((d) => d.category === "PROPOSAL_LETTER");
    if (!hasLetter) {
      issues.push({
        scope: "document",
        rowIndex: null,
        field: "documents.proposalLetter",
        message: "Dokumen proposal / surat permohonan wajib diunggah sebelum pengajuan diajukan.",
      });
    }
  }

  if (policy.requireRecipientVerification) {
    const hasVerification = storedDocs.some((d) => d.category === "RECIPIENT_VERIFICATION");
    if (!hasVerification) {
      issues.push({
        scope: "document",
        rowIndex: null,
        field: "documents.recipientVerification",
        message:
          "Berita acara / surat keterangan verifikasi penerima (mis. dari RT/RW) wajib diunggah sebelum pengajuan diajukan.",
      });
    }
  }

  // Beneficiary document checks
  input.beneficiaries.forEach((b, idx) => {
    const bDocs = storedDocs.filter((d) => d.beneficiaryId === b.id);

    if (policy.requireIdentityDoc && b.identityBasis.kind === "NIK") {
      const hasIdDoc = bDocs.some(
        (d) => d.category === "BENEFICIARY_IDENTITY" || d.category === "PROPOSAL_LETTER"
      );
      if (!hasIdDoc) {
        issues.push({
          scope: "document",
          rowIndex: idx,
          beneficiaryId: b.id,
          field: "documents.identity",
          message: `Dokumen KTP/KK wajib diunggah untuk penerima "${b.name || `Penerima ${idx + 1}`}".`,
        });
      }
    }

    if (policy.requireAlternativeIdProof && b.identityBasis.kind === "ALTERNATIVE") {
      const hasAltDoc = bDocs.some((d) => d.category === "ALTERNATIVE_IDENTITY_PROOF");
      if (!hasAltDoc) {
        issues.push({
          scope: "document",
          rowIndex: idx,
          beneficiaryId: b.id,
          field: "documents.alternativeProof",
          message: `Dokumen surat keterangan / bukti identitas alternatif wajib diunggah untuk "${b.name || `Penerima ${idx + 1}`}".`,
        });
      }
    }

    if (policy.requireGuardianProof && b.guardian) {
      const hasGuardianDoc = bDocs.some((d) => d.category === "REPRESENTATION_PROOF");
      if (!hasGuardianDoc) {
        issues.push({
          scope: "document",
          rowIndex: idx,
          beneficiaryId: b.id,
          field: "documents.guardianProof",
          message: `Dokumen perwakilan / surat kuasa wali wajib diunggah untuk "${b.name || `Penerima ${idx + 1}`}".`,
        });
      }
    }
  });

  return issues;
}

export type RecurringAidMatch = {
  proposalId: string;
  programId: string | null;
  programName: string;
  aidPeriod: { start: string; end: string } | null;
  status: ProposalStatus;
  beneficiaryId: string;
  beneficiaryName: string;
  nik: string | null;
  alternativeDesc: string | null;
};

export type RecurringAidWarning = {
  beneficiaryId: string;
  beneficiaryName: string;
  matchedProposalId: string;
  matchedProgramName: string;
  matchedPeriod: string;
  matchedStatus: ProposalStatus;
  message: string;
};

export function evaluateRecurringAidWarnings(
  beneficiaries: Beneficiary[],
  matches: RecurringAidMatch[]
): RecurringAidWarning[] {
  const warnings: RecurringAidWarning[] = [];

  for (const b of beneficiaries) {
    const matched = matches.filter((m) => {
      if (b.identityBasis.kind === "NIK" && m.nik) {
        return b.identityBasis.value === m.nik;
      }
      if (b.identityBasis.kind === "ALTERNATIVE" && m.alternativeDesc) {
        return (
          b.name.trim().toLowerCase() === m.beneficiaryName.trim().toLowerCase() &&
          b.identityBasis.description.trim().toLowerCase() === m.alternativeDesc.trim().toLowerCase()
        );
      }
      return false;
    });

    for (const match of matched) {
      const periodStr = match.aidPeriod
        ? `${match.aidPeriod.start} s/d ${match.aidPeriod.end}`
        : "Periode tidak tercatat";
      warnings.push({
        beneficiaryId: b.id,
        beneficiaryName: b.name,
        matchedProposalId: match.proposalId,
        matchedProgramName: match.programName || "Program tanpa judul",
        matchedPeriod: periodStr,
        matchedStatus: match.status,
        message:
          `Penerima "${b.name}" tercatat menerima bantuan pada program "${match.programName}" ` +
          `(periode: ${periodStr}, status: ${PROPOSAL_STATUS_LABELS[match.status] ?? match.status}). ` +
          `Periksa kesesuaian kebijakan bantuan berulang sebelum menyetujui.`,
      });
    }
  }

  return warnings;
}

export type ExaminationChecklist = {
  administrativeChecksOk: boolean;
  eligibilityChecksOk: boolean;
  alternativeIdReviewed: boolean;
  recurringAidExceptions: string[];
  notes: string;
};

/**
 * One examination gate for every cycle: the original proposal and each revision of it.
 * A proposal only becomes ready for a decision once both checks are affirmed outright.
 */
export function validateExaminationChecklist(
  input: unknown
): { ok: true; value: ExaminationChecklist } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Checklist pemeriksaan kelayakan wajib diisi." };
  }
  const raw = input as Record<string, unknown>;
  if (raw.administrativeChecksOk !== true) {
    return {
      ok: false,
      error: "Pemeriksaan administrasi harus dinyatakan lengkap dan sesuai sebelum pengajuan siap diputus.",
    };
  }
  if (raw.eligibilityChecksOk !== true) {
    return {
      ok: false,
      error: "Pemeriksaan kelayakan asnaf dan kebutuhan harus dinyatakan memenuhi syarat sebelum pengajuan siap diputus.",
    };
  }
  return {
    ok: true,
    value: {
      administrativeChecksOk: true,
      eligibilityChecksOk: true,
      alternativeIdReviewed: raw.alternativeIdReviewed === true,
      recurringAidExceptions: Array.isArray(raw.recurringAidExceptions)
        ? raw.recurringAidExceptions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [],
      notes: trimmed(raw.notes),
    },
  };
}

/** A checklist an examiner may attach while returning work; absent is legitimate here. */
export function validateOptionalExaminationChecklist(
  input: unknown
): { ok: true; value: ExaminationChecklist | null } | { ok: false; error: string } {
  if (input === null || input === undefined) return { ok: true, value: null };
  return validateExaminationChecklist(input);
}

export type ProposalHistoryAction =
  | "SUBMIT"
  | "WITHDRAW"
  | "START_EXAMINATION"
  | "RETURN_FOR_REVISION"
  | "MARK_READY"
  | "APPROVE"
  | "REJECT"
  | "CANCEL"
  | "CLOSE_REMAINDER"
  | "PROPOSE_REVISION"
  | "WITHDRAW_REVISION"
  | "APPROVE_REVISION"
  | "REJECT_REVISION"
  | "PUBLISH";

export type ProposalHistoryRecord = {
  id: number;
  proposalId: string;
  institutionId: string;
  version: number;
  fromStatus: ProposalStatus;
  toStatus: ProposalStatus;
  action: ProposalHistoryAction;
  actorAccount: string;
  actorOfficerId: string | null;
  reason: string | null;
  notes: string | null;
  occurredAt: number;
};


// ---------------------------------------------------------------------------
// Keputusan lembaga (Spec #86, ticket #93 & #96)
// ---------------------------------------------------------------------------

export type ProposalDecisionAction = "APPROVE" | "REJECT" | "CANCEL" | "CLOSE_REMAINDER";

export const isProposalDecisionAction = (value: unknown): value is ProposalDecisionAction =>
  value === "APPROVE" || value === "REJECT" || value === "CANCEL" || value === "CLOSE_REMAINDER";

export const SOP_QUORUM_HELD_MESSAGE =
  "Konfigurasi SOP lembaga mewajibkan kuorum digital banyak pejabat yang belum didukung oleh sistem; pencatatan pengesahan digital ditahan.";

export const DISBURSEMENT_DECISION_PURPOSE =
  "Pengesahan keputusan lembaga atas pengajuan penyaluran" as const;

export const DISBURSEMENT_DECISION_DOMAIN = {
  name: "ZKT Disbursement Decision",
  version: "1",
} as const;

export const DISBURSEMENT_DECISION_TYPES = {
  DisbursementDecision: [
    { name: "purpose", type: "string" },
    { name: "institutionId", type: "string" },
    { name: "proposalId", type: "string" },
    { name: "proposalVersion", type: "uint256" },
    { name: "action", type: "string" },
    { name: "rightsDigest", type: "bytes32" },
    { name: "decisionReference", type: "string" },
    { name: "decisionDate", type: "string" },
    { name: "decisionDocumentId", type: "string" },
    { name: "decisionDocumentSha256", type: "bytes32" },
    { name: "operatorOfficerId", type: "string" },
    { name: "operatorAccount", type: "address" },
    { name: "signerAccount", type: "address" },
    { name: "mandateId", type: "string" },
    { name: "mandateValidUntil", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "issuedAt", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
  ],
} as const;

type Hex32 = `0x${string}`;

export type ApprovedAidLineInput = {
  id: string;
  amountApprovedIdr?: string | null;
  quantityApproved?: string | null;
};

/** What the institution decided - the content the rights digest commits to. */
export type ProposalDecisionIntent = {
  action: ProposalDecisionAction;
  decisionReference: string;
  decisionDate: string; // YYYY-MM-DD
  /** The uploaded SK or berita acara this decision rests on. */
  decisionDocumentId: string;
  notes: string | null;
  rejectionReason: string | null;
  approvedAidLines: ApprovedAidLineInput[];
};

/** The signed SK or berita acara, stored privately; only its hash enters the signature. */
export type ProposalDecisionDocument = {
  id: string;
  proposalId: string;
  proposalVersion: number;
  institutionId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: Hex32;
  storageRef: string;
  uploadedBy: string;
  createdAt: number;
};

export type ProposalDecisionInput = ProposalDecisionIntent & {
  signerAccount: string;
  mandateId: string;
  nonce: string;
  signature: string;
  expectedVersion: number;
};

/** Everything one signature binds. A challenge stores it; the typed data mirrors it field for field. */
export type DecisionBinding = {
  institutionId: string;
  proposalId: string;
  proposalVersion: number;
  action: ProposalDecisionAction;
  rightsDigest: Hex32;
  decisionReference: string;
  decisionDate: string;
  decisionDocumentId: string;
  decisionDocumentSha256: Hex32;
  operatorOfficerId: string;
  operatorAccount: string;
  signerAccount: string;
  mandateId: string;
  mandateValidUntil: number;
  nonce: Hex32;
  issuedAt: number;
  expiresAt: number;
};

export type ProposalDecisionChallenge = DecisionBinding & { consumedAt: number | null };

export type ProposalDecisionRecord = {
  id: string;
  proposalId: string;
  proposalVersion: number;
  institutionId: string;
  action: ProposalDecisionAction;
  decisionReference: string;
  decisionDate: string;
  /**
   * `SIGNED_IN_APP`: an authorised signer decided here, on an uploaded SK / berita acara.
   * `RECORDED_OUTSIDE_APP`: the institution decided internally and the publishing amil
   * cites it; there is no signer, signature or decision document (ADR-0041).
   */
  basis: ProposalDecisionBasis;
  decisionDocumentId: string | null;
  decisionDocumentSha256: string | null;
  notes: string | null;
  rejectionReason: string | null;
  rightsDigest: string;
  operatorOfficerId: string;
  operatorAccount: string;
  signerAccount: string | null;
  mandateId: string;
  signature: string | null;
  createdAt: number;
};

export type ProposalDecisionBasis = "SIGNED_IN_APP" | "RECORDED_OUTSIDE_APP";

export type ProposalPublicationInput = { decisionReference: string; decisionDate: string; notes: string | null };

/** The internal decision a publication cites: a reference and the date it was taken. */
export function validatePublicationInput(
  input: unknown
): { ok: true; value: ProposalPublicationInput } | { ok: false; error: string } {
  const raw = (input ?? {}) as Record<string, unknown>;
  const decisionReference = trimmed(raw.decisionReference);
  if (!decisionReference) {
    return { ok: false, error: "Rujukan keputusan internal (mis. rapat pengurus atau nomor surat) wajib diisi." };
  }
  if (decisionReference.length > 200) return { ok: false, error: "Rujukan keputusan maksimal 200 karakter." };
  const decisionDate = trimmed(raw.decisionDate);
  if (!isIsoDate(decisionDate) || Number.isNaN(Date.parse(`${decisionDate}T00:00:00Z`))) {
    return { ok: false, error: "Tanggal keputusan wajib berformat YYYY-MM-DD." };
  }
  const notes = trimmed(raw.notes);
  return { ok: true, value: { decisionReference, decisionDate, notes: notes || null } };
}

/**
 * The aid lines as the decision fixes them. A rejection leaves them untouched;
 * an approval sets every approved value, defaulting to the requested one and
 * never exceeding it, for lines that exist on this version only.
 */
export function decidedAidLines(
  aidLines: AidLine[],
  intent: Pick<ProposalDecisionIntent, "action" | "approvedAidLines">
): { ok: true; lines: AidLine[] } | { ok: false; error: string } {
  if (intent.action !== "APPROVE") return { ok: true, lines: aidLines };

  const approved = new Map<string, ApprovedAidLineInput>();
  for (const item of intent.approvedAidLines) {
    if (approved.has(item.id)) return { ok: false, error: `Baris bantuan ${item.id} disetujui lebih dari sekali.` };
    if (!aidLines.some((line) => line.id === item.id)) {
      return { ok: false, error: `Baris bantuan ${item.id} tidak ada pada versi pengajuan ini.` };
    }
    approved.set(item.id, item);
  }

  const lines: AidLine[] = [];
  for (const line of aidLines) {
    const match = approved.get(line.id);
    if (line.value.kind === "MONEY") {
      const value = match?.amountApprovedIdr ?? line.value.amountRequestedIdr;
      if (compareDecimalStrings(value, line.value.amountRequestedIdr) > 0) {
        return { ok: false, error: `Jumlah disetujui pada baris ${line.id} melebihi jumlah yang diajukan.` };
      }
      lines.push({ ...line, value: { ...line.value, amountApprovedIdr: value } });
    } else {
      const value = match?.quantityApproved ?? line.value.quantityRequested;
      if (compareDecimalStrings(value, line.value.quantityRequested) > 0) {
        return { ok: false, error: `Jumlah barang disetujui pada baris ${line.id} melebihi jumlah yang diajukan.` };
      }
      lines.push({ ...line, value: { ...line.value, quantityApproved: value } });
    }
  }
  return { ok: true, lines };
}

/** The IDR nominal a decision commits: approved where set, requested otherwise. */
export function decidedIdr(aidLines: AidLine[]): bigint {
  return aidLines.reduce((total, line) => {
    if (line.value.kind !== "MONEY") return total;
    const amount = line.value.amountApprovedIdr ?? line.value.amountRequestedIdr;
    return isExactNonNegativeInteger(amount) ? total + BigInt(amount) : total;
  }, 0n);
}

/** Deterministic SHA-256 over the decided rights and the decision's own content. */
export function computeRightsDigest(
  decidedLines: AidLine[],
  intent: Omit<ProposalDecisionIntent, "approvedAidLines" | "decisionDocumentId">
): Hex32 {
  const lines = decidedLines.map((line) =>
    line.value.kind === "MONEY"
      ? {
          id: line.id,
          beneficiaryId: line.beneficiaryId,
          kind: "MONEY",
          aidType: line.aidType,
          period: line.period,
          amountRequestedIdr: line.value.amountRequestedIdr,
          amountApprovedIdr: line.value.amountApprovedIdr ?? null,
        }
      : {
          id: line.id,
          beneficiaryId: line.beneficiaryId,
          kind: "GOODS",
          aidType: line.aidType,
          period: line.period,
          unit: line.value.unit,
          quantityRequested: line.value.quantityRequested,
          quantityApproved: line.value.quantityApproved ?? null,
          valuedAmountIdr: line.value.valuedAmountIdr,
          ...(line.value.valuationBasis ? { valuationBasis: line.value.valuationBasis } : {}),
        }
  );
  const payload = JSON.stringify({
    action: intent.action,
    decisionReference: intent.decisionReference,
    decisionDate: intent.decisionDate,
    notes: intent.notes,
    rejectionReason: intent.rejectionReason,
    lines,
  });
  return `0x${createHash("sha256").update(payload).digest("hex")}`;
}

export function disbursementDecisionTypedDataWire(binding: DecisionBinding) {
  return {
    domain: DISBURSEMENT_DECISION_DOMAIN,
    types: DISBURSEMENT_DECISION_TYPES,
    primaryType: "DisbursementDecision" as const,
    message: {
      purpose: DISBURSEMENT_DECISION_PURPOSE,
      institutionId: binding.institutionId,
      proposalId: binding.proposalId,
      proposalVersion: binding.proposalVersion,
      action: binding.action,
      rightsDigest: binding.rightsDigest,
      decisionReference: binding.decisionReference,
      decisionDate: binding.decisionDate,
      decisionDocumentId: binding.decisionDocumentId,
      decisionDocumentSha256: binding.decisionDocumentSha256,
      operatorOfficerId: binding.operatorOfficerId,
      operatorAccount: binding.operatorAccount.toLowerCase() as Hex32,
      signerAccount: binding.signerAccount.toLowerCase() as Hex32,
      mandateId: binding.mandateId,
      mandateValidUntil: binding.mandateValidUntil,
      nonce: binding.nonce,
      issuedAt: binding.issuedAt,
      expiresAt: binding.expiresAt,
    },
  };
}

export function disbursementDecisionSigningPayload(binding: DecisionBinding) {
  const wire = disbursementDecisionTypedDataWire(binding);
  return {
    ...wire,
    message: {
      ...wire.message,
      proposalVersion: BigInt(wire.message.proposalVersion),
      mandateValidUntil: BigInt(wire.message.mandateValidUntil),
      issuedAt: BigInt(wire.message.issuedAt),
      expiresAt: BigInt(wire.message.expiresAt),
    },
  };
}

const trimmed = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Validates the decision content shared by the challenge request and the signed submission. */
export function validateDecisionIntent(input: unknown): { ok: true; value: ProposalDecisionIntent } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Data keputusan bukan objek yang sah." };
  }
  const raw = input as Record<string, unknown>;

  const action = raw.action;
  if (!isProposalDecisionAction(action)) {
    return { ok: false, error: "Tindakan keputusan harus 'APPROVE', 'REJECT', 'CANCEL', atau 'CLOSE_REMAINDER'." };
  }

  const decisionReference = trimmed(raw.decisionReference);
  if (!decisionReference) {
    return { ok: false, error: "Rujukan keputusan lembaga (SK / Berita Acara Pleno) wajib diisi." };
  }

  const decisionDate = trimmed(raw.decisionDate);
  if (!isIsoDate(decisionDate)) {
    return { ok: false, error: "Tanggal keputusan harus berformat tanggal yang sah (YYYY-MM-DD)." };
  }

  const decisionDocumentId = trimmed(raw.decisionDocumentId);
  if (!decisionDocumentId) {
    return { ok: false, error: "Berkas SK / berita acara keputusan wajib diunggah." };
  }

  let rejectionReason: string | null = null;
  if (action === "REJECT") {
    rejectionReason = trimmed(raw.rejectionReason);
    if (!rejectionReason) {
      return { ok: false, error: "Alasan penolakan wajib diisi secara jelas bila pengajuan ditolak." };
    }
  } else if (action === "CANCEL") {
    rejectionReason = trimmed(raw.reason);
    if (!rejectionReason) {
      return { ok: false, error: "Alasan pembatalan wajib diisi bila pengajuan dibatalkan." };
    }
  } else if (action === "CLOSE_REMAINDER") {
    rejectionReason = trimmed(raw.reason);
    if (!rejectionReason) {
      return { ok: false, error: "Alasan penutupan sisa bantuan wajib diisi bila sisa bantuan ditutup." };
    }
  }

  const approvedAidLines: ApprovedAidLineInput[] = [];
  if (action === "APPROVE" && Array.isArray(raw.approvedAidLines)) {
    for (const entry of raw.approvedAidLines) {
      const item = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
      const id = trimmed(item.id);
      if (!id) return { ok: false, error: "Setiap baris bantuan yang disetujui wajib memiliki ID." };
      const amountApprovedIdr = item.amountApprovedIdr == null ? null : String(item.amountApprovedIdr).trim();
      if (amountApprovedIdr !== null && !isExactNonNegativeInteger(amountApprovedIdr)) {
        return { ok: false, error: `Jumlah IDR disetujui pada baris ${id} harus bilangan bulat non-negatif.` };
      }
      const quantityApproved = item.quantityApproved == null ? null : String(item.quantityApproved).trim();
      if (quantityApproved !== null && !isExactNonNegativeDecimal(quantityApproved)) {
        return { ok: false, error: `Jumlah barang disetujui pada baris ${id} harus angka desimal yang sah.` };
      }
      approvedAidLines.push({ id, amountApprovedIdr, quantityApproved });
    }
  }

  return {
    ok: true,
    value: {
      action,
      decisionReference,
      decisionDate,
      decisionDocumentId,
      notes: trimmed(raw.notes) || null,
      rejectionReason,
      approvedAidLines,
    },
  };
}

export function validateProposalDecisionInput(input: unknown): { ok: true; value: ProposalDecisionInput } | { ok: false; error: string } {
  const intent = validateDecisionIntent(input);
  if (!intent.ok) return intent;
  const raw = input as Record<string, unknown>;

  const signerAccount = trimmed(raw.signerAccount).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(signerAccount)) {
    return { ok: false, error: "Alamat akun pengesah tidak sah." };
  }

  const mandateId = trimmed(raw.mandateId);
  if (!mandateId) {
    return { ok: false, error: "ID mandat operasional pengesah wajib ditentukan." };
  }

  const nonce = trimmed(raw.nonce);
  if (!nonce) {
    return { ok: false, error: "Tantangan nonce pengesahan wajib disertakan." };
  }

  const signature = trimmed(raw.signature);
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) {
    return { ok: false, error: "Tanda tangan digital pengesahan tidak sah." };
  }

  const expectedVersion = typeof raw.expectedVersion === "number" ? raw.expectedVersion : NaN;
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return { ok: false, error: "Versi pengajuan yang diharapkan tidak sah." };
  }

  return { ok: true, value: { ...intent.value, signerAccount, mandateId, nonce, signature, expectedVersion } };
}
// 16. Realisasi Penyaluran, Bukti Pembayaran, dan Konfirmasi (Ticket #94, Spec #86 / #100)

export const REALIZATION_DISCLAIMER_NOTICE =
  "Aplikasi mencatat kejadian penyaluran di luar aplikasi, bukan mengirim dana atau memverifikasi transaksi bank.";

export const DISBURSEMENT_METHODS = ["BANK_TRANSFER", "CASH", "GOODS_HANDOVER"] as const;
export type DisbursementMethod = (typeof DISBURSEMENT_METHODS)[number];
export const isDisbursementMethod = (v: unknown): v is DisbursementMethod =>
  typeof v === "string" && (DISBURSEMENT_METHODS as readonly string[]).includes(v);

export const DISBURSEMENT_METHOD_LABELS: Record<DisbursementMethod, string> = {
  BANK_TRANSFER: "Transfer Bank",
  CASH: "Tunai",
  GOODS_HANDOVER: "Penyerahan Barang",
};

export const REALIZATION_DOCUMENT_TYPES = [
  "PAYMENT_PROOF",
  "RECEIPT_OR_BAST",
  "SUPPORTING_PHOTO",
] as const;
export type RealizationDocumentType = (typeof REALIZATION_DOCUMENT_TYPES)[number];
export const isRealizationDocumentType = (v: unknown): v is RealizationDocumentType =>
  typeof v === "string" && (REALIZATION_DOCUMENT_TYPES as readonly string[]).includes(v);

export const REALIZATION_DOCUMENT_TYPE_LABELS: Record<RealizationDocumentType, string> = {
  PAYMENT_PROOF: "Bukti Transfer / Pembayaran Bank",
  RECEIPT_OR_BAST: "Tanda Terima / Berita Acara (BAST)",
  SUPPORTING_PHOTO: "Foto Dokumentasi Penyerahan (Pendukung)",
};

/** The evidence a method needs. A photo only ever supports; it never completes evidence. */
export const REQUIRED_EVIDENCE_BY_METHOD: Record<DisbursementMethod, RealizationDocumentType> = {
  BANK_TRANSFER: "PAYMENT_PROOF",
  CASH: "RECEIPT_OR_BAST",
  GOODS_HANDOVER: "RECEIPT_OR_BAST",
};

export const REALIZATION_EVIDENCE_STATUSES = ["EVIDENCE_PENDING", "EVIDENCE_COMPLETE"] as const;
export type RealizationEvidenceStatus = (typeof REALIZATION_EVIDENCE_STATUSES)[number];

/** DISPUTED holds the final confirmation; only an authorized examination result releases it. */
export const CONFIRMATION_STATUSES = ["UNCONFIRMED", "CONFIRMED", "DISPUTED"] as const;
export type ConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];

/** Cash and goods handovers are confirmed by the recipient; a transfer keeps its payment proof and no confirmation label. */
export const CONFIRMATION_METHODS = ["OTP", "BAST_EXAMINED"] as const;
export type ConfirmationMethod = (typeof CONFIRMATION_METHODS)[number];

export const COMPLAINANT_TYPES = ["BENEFICIARY", "OFFICER", "AUDITOR"] as const;
export type ComplainantType = (typeof COMPLAINANT_TYPES)[number];
export const isComplainantType = (v: unknown): v is ComplainantType =>
  typeof v === "string" && (COMPLAINANT_TYPES as readonly string[]).includes(v);

/** What part of the event is contested: that it was received at all, or the amount received. */
export const DISPUTE_SUBJECTS = ["RECEIPT", "AMOUNT"] as const;
export type DisputeSubject = (typeof DISPUTE_SUBJECTS)[number];
export const isDisputeSubject = (v: unknown): v is DisputeSubject =>
  typeof v === "string" && (DISPUTE_SUBJECTS as readonly string[]).includes(v);

export const DISPUTE_STATUSES = ["OPEN", "EXAMINED", "RESOLVED"] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/** An examination either records findings while the hold stays, or resolves the dispute. */
export const DISPUTE_OUTCOMES = ["EXAMINED", "RESOLVED"] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];
export const isDisputeOutcome = (v: unknown): v is DisputeOutcome =>
  typeof v === "string" && (DISPUTE_OUTCOMES as readonly string[]).includes(v);

export const REALIZATION_PROGRESS = ["NOT_REALIZED", "PARTIALLY_REALIZED", "FULLY_REALIZED", "REMAINDER_CLOSED"] as const;
export type RealizationProgress = (typeof REALIZATION_PROGRESS)[number];

export const REALIZATION_PROGRESS_LABELS: Record<RealizationProgress, string> = {
  NOT_REALIZED: "Belum disalurkan",
  PARTIALLY_REALIZED: "Tersalurkan sebagian",
  FULLY_REALIZED: "Tersalurkan seluruhnya",
  REMAINDER_CLOSED: "Sisa ditutup",
};

/** Who the payment went to when it is not the beneficiary (a school, hospital, vendor). Absent means the beneficiary. */
export type PaymentRecipient = { name: string; relation: string };

export type EvidenceAllocation = {
  realizationId: string;
  amountIdr?: string | null;
  quantity?: string | null;
  unit?: string | null;
};

export type RealizationItemInput = {
  aidLineId: string;
  beneficiaryId: string;
  paymentRecipient: PaymentRecipient | null;
  method: DisbursementMethod;
  amountIdr?: string | null;
  quantity?: string | null;
  unit?: string | null;
  reportedAt: number;
  notes: string | null;
};

export type RealizationRecord = {
  id: string;
  institutionId: string;
  proposalId: string;
  proposalVersion: number;
  aidLineId: string;
  beneficiaryId: string;
  batchGroupId: string | null;
  paymentRecipient: PaymentRecipient | null;
  method: DisbursementMethod;
  amountIdr: string | null;
  quantity: string | null;
  unit: string | null;
  reportedAt: number;
  recordedAt: number;
  operatorAccount: string;
  operatorOfficerId: string;
  notes: string | null;
  evidenceStatus: RealizationEvidenceStatus;
  confirmationStatus: ConfirmationStatus;
  confirmationMethod: ConfirmationMethod | null;
  /** Bumped by every status change, so a report source or an OTP binds the exact state it saw. */
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type RealizationDocumentRecord = {
  id: string;
  proposalId: string;
  realizationId: string;
  batchGroupId: string | null;
  institutionId: string;
  documentType: RealizationDocumentType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: Hex32;
  storageRef: string;
  uploadedBy: string;
  allocations: EvidenceAllocation[];
  createdAt: number;
};

/** A stored OTP challenge. The code is kept only as a salted hash and the contact only as a hint. */
export type RealizationChallenge = {
  nonce: string;
  institutionId: string;
  proposalId: string;
  proposalVersion: number;
  realizationId: string;
  realizationVersion: number;
  beneficiaryId: string;
  contactHint: string;
  confirmer: { beneficiaryName: string; guardian: Guardian | null; contactRelation: string } | null;
  aidType: string;
  amountIdr: string | null;
  quantity: string | null;
  unit: string | null;
  codeHash: string;
  attempts: number;
  issuedAt: number;
  expiresAt: number;
  consumedAt: number | null;
};

export type BastExaminationRecord = {
  id: string;
  realizationId: string;
  institutionId: string;
  verifierOfficerId: string;
  verifierAccount: string;
  notes: string;
  verifiedAt: number;
};

export type DisputeExaminationRecord = {
  id: string;
  disputeId: string;
  outcome: DisputeOutcome;
  notes: string;
  examinerOfficerId: string;
  examinerAccount: string;
  examinedAt: number;
};

export type RealizationDisputeRecord = {
  id: string;
  proposalId: string;
  realizationId: string;
  aidLineId: string;
  institutionId: string;
  complainantType: ComplainantType;
  subject: DisputeSubject;
  reason: string;
  disputedAmountIdr: string | null;
  disputedQuantity: string | null;
  disputedUnit: string | null;
  status: DisputeStatus;
  recordedByOfficerId: string;
  createdAt: number;
  examinations: DisputeExaminationRecord[];
};

/** An officer's advance and how much of it linked expenses account for. Not an aid payment. */
export type OperationalAdvanceRecord = {
  id: string;
  institutionId: string;
  proposalId: string;
  officerId: string;
  officerAccount: string;
  amountIdr: string;
  purpose: string;
  reference: string;
  accountedIdr: string;
  unaccountedIdr: string;
  issuedAt: number;
};

export type OperationalExpenseRecord = {
  id: string;
  institutionId: string;
  proposalId: string;
  advanceId: string | null;
  amountIdr: string;
  purpose: string;
  payee: string;
  documentRef: string;
  recordedByOfficerId: string;
  recordedAt: number;
};

export type RealizationLineSummary = {
  aidLineId: string;
  beneficiaryId: string;
  beneficiaryName: string;
  paymentRecipients: PaymentRecipient[];
  kind: "MONEY" | "GOODS";
  aidType: string;
  unit?: string | null;
  quantityApproved?: string | null;
  quantityRealized?: string | null;
  quantityRemaining?: string | null;
  amountApprovedIdr: string | null;
  amountRealizedIdr: string | null;
  amountRemainingIdr: string | null;
  valuedAmountIdr: string | null;
  valuationBasis: string | null;
  status: RealizationProgress;
  isDisputed: boolean;
  isHeldForRevision: boolean;
};

export type RealizationUnitSummary = {
  aidType: string;
  unit: string;
  approved: string;
  realized: string;
  remaining: string;
};

export type RevisionBeneficiaryDelta = RevisionDelta<Beneficiary>;
export type RevisionAidLineDelta = RevisionDelta<AidLine>;
export type ProposalRevisionDelta = RevisionDeltaResult<Beneficiary, AidLine>;

export type ProposalRevisionRecord = {
  id: string;
  proposalId: string;
  institutionId: string;
  revisionNumber: number;
  fromVersion: number;
  toVersion: number;
  reason: string;
  status: "DRAFT" | "SUBMITTED" | "UNDER_EXAMINATION" | "REVISION_REQUIRED" | "READY_FOR_DECISION" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  beneficiaries: Beneficiary[];
  aidLines: AidLine[];
  delta: ProposalRevisionDelta;
  heldAidLineIds: string[];
  examinationNotes: string | null;
  examinationChecklist: ExaminationChecklist | null;
  examinedBy: string | null;
  examinedByOfficerId: string | null;
  examinedAt: number | null;
  decisionReference: string | null;
  decisionDate: string | null;
  rejectionReason: string | null;
  createdBy: string;
  createdByOfficerId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ProposalClosureLineRemainder = {
  aidLineId: string;
  beneficiaryId: string;
  beneficiaryName: string;
  kind: "MONEY" | "GOODS";
  aidType: string;
  unit: string | null;
  approved: string;
  realized: string;
  unrealizedRemainder: string;
};

export type ProposalClosureRecord = {
  proposalId: string;
  proposalVersion: number;
  institutionId: string;
  decisionReference: string;
  decisionDate: string;
  decisionDocumentId: string;
  decisionDocumentSha256: string;
  reason: string;
  closedAt: number;
  operatorOfficerId: string;
  operatorAccount: string;
  signerAccount: string;
  totalApprovedIdr: string;
  totalRealizedIdr: string;
  totalUnrealizedRemainderIdr: string;
  lineRemainders: ProposalClosureLineRemainder[];
  goodsUnitRemainders: Array<{
    aidType: string;
    unit: string;
    totalApproved: string;
    totalRealized: string;
    totalUnrealizedRemainder: string;
  }>;
};

export type ProposalRealizationSummary = {
  proposalId: string;
  proposalVersion: number;
  totalApprovedIdr: string;
  totalRealizedIdr: string;
  totalRemainingIdr: string;
  approvedBeneficiaryCount: number;
  realizedBeneficiaryCount: number;
  paymentEventCount: number;
  /** Disbursement progress only. It never implies complete evidence or an audit opinion. */
  disbursementStatus: RealizationProgress;
  evidenceCompleteness: RealizationEvidenceStatus;
  pendingEvidenceCount: number;
  completeEvidenceCount: number;
  totalPendingEvidenceIdr: string;
  confirmedCount: number;
  disputedCount: number;
  totalAdvancesIdr: string;
  totalExpensesIdr: string;
  totalsByUnit: Record<string, RealizationUnitSummary>;
  unitSummaries: RealizationUnitSummary[];
  hasUnvaluedGoods: boolean;
  totalValuedGoodsApprovedIdr: string | null;
  lines: RealizationLineSummary[];
  activeRevisionId: string | null;
  closure: ProposalClosureRecord | null;
};

/** Rupiah amounts are whole, positive and bounded; anything else is refused before it reaches BigInt. */
const MAX_IDR_DIGITS = 18;
export function parsePositiveIdr(value: unknown): string | null {
  const text = trimmed(value);
  if (!isExactNonNegativeInteger(text) || text.length > MAX_IDR_DIGITS) return null;
  const amount = BigInt(text);
  return amount > 0n ? amount.toString() : null;
}

/** The IDR right a decision granted a line. Only a MONEY line has one; goods use approvedQuantityOf (#95). */
export function approvedIdrOf(line: AidLine): bigint | null {
  if (line.value.kind !== "MONEY") return null;
  const approved = line.value.amountApprovedIdr;
  return approved != null && isExactNonNegativeInteger(approved) ? BigInt(approved) : 0n;
}

export function approvedQuantityOf(line: AidLine): string | null {
  if (line.value.kind !== "GOODS") return null;
  const approved = line.value.quantityApproved ?? line.value.quantityRequested;
  return isExactNonNegativeDecimal(approved) ? approved : null;
}

export function approvedUnitOf(line: AidLine): string | null {
  return line.value.kind === "GOODS" ? line.value.unit : null;
}

export function realizationProgress(approved: bigint, realized: bigint): RealizationProgress {
  if (approved > 0n && realized >= approved) return "FULLY_REALIZED";
  return realized > 0n ? "PARTIALLY_REALIZED" : "NOT_REALIZED";
}

export function realizationProgressDecimal(approved: string, realized: string): RealizationProgress {
  if (compareDecimalStrings(approved, "0") > 0 && compareDecimalStrings(realized, approved) >= 0) {
    return "FULLY_REALIZED";
  }
  return compareDecimalStrings(realized, "0") > 0 ? "PARTIALLY_REALIZED" : "NOT_REALIZED";
}

/** Evidence is complete once documents of the method's required type account for exactly the realized amount or quantity. */
export function evidenceStatusOf(
  realization: Pick<RealizationRecord, "method" | "amountIdr" | "quantity" | "unit">,
  documents: Array<{ documentType: RealizationDocumentType; amountIdr?: string | null; quantity?: string | null }>
): RealizationEvidenceStatus {
  const required = REQUIRED_EVIDENCE_BY_METHOD[realization.method];
  const matching = documents.filter((doc) => doc.documentType === required);

  if (realization.quantity !== null && realization.quantity !== undefined) {
    const coveredQuantity = matching
      .filter((doc) => doc.quantity !== null && doc.quantity !== undefined)
      .reduce((total, doc) => addDecimalStrings(total, doc.quantity!), "0");
    return compareDecimalStrings(coveredQuantity, realization.quantity) === 0 ? "EVIDENCE_COMPLETE" : "EVIDENCE_PENDING";
  }

  if (realization.amountIdr !== null && realization.amountIdr !== undefined) {
    const coveredIdr = matching
      .filter((doc) => doc.amountIdr !== null && doc.amountIdr !== undefined)
      .reduce((total, doc) => total + BigInt(doc.amountIdr!), 0n);
    return coveredIdr === BigInt(realization.amountIdr) ? "EVIDENCE_COMPLETE" : "EVIDENCE_PENDING";
  }

  return "EVIDENCE_PENDING";
}

/** Only the hint survives storage: enough for the officer to recognise which contact received the code. */
export function contactHintOf(contact: string): string {
  const visible = contact.slice(-3);
  return `${"*".repeat(Math.max(3, contact.length - visible.length))}${visible}`;
}

export const isRecipientContact = (value: string): boolean =>
  /^\+?\d{8,15}$/.test(value) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/** Salted with the nonce so equal codes on different challenges never share a hash. */
export const otpCodeHash = (nonce: string, code: string): string =>
  createHash("sha256").update(`${nonce}:${code}`).digest("hex");

function paymentRecipientOf(raw: unknown): { ok: true; value: PaymentRecipient | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== "object") return { ok: false, error: "Penerima pembayaran harus berupa objek nama dan hubungan." };
  const name = trimmed((raw as Record<string, unknown>).name);
  const relation = trimmed((raw as Record<string, unknown>).relation);
  if (!name || !relation) {
    return { ok: false, error: "Penerima pembayaran pihak lain wajib memuat nama dan hubungannya dengan penerima manfaat." };
  }
  return { ok: true, value: { name, relation } };
}

export function validateRealizationItemInput(item: unknown): { ok: true; value: RealizationItemInput } | { ok: false; error: string } {
  if (typeof item !== "object" || item === null) {
    return { ok: false, error: "Data realisasi harus berupa objek." };
  }
  const raw = item as Record<string, unknown>;
  const aidLineId = trimmed(raw.aidLineId);
  if (!aidLineId) return { ok: false, error: "ID rincian bantuan (aidLineId) wajib diisi." };

  const beneficiaryId = trimmed(raw.beneficiaryId);
  if (!beneficiaryId) return { ok: false, error: "ID penerima manfaat (beneficiaryId) wajib diisi." };

  if (!isDisbursementMethod(raw.method)) {
    return { ok: false, error: "Metode penyaluran harus 'BANK_TRANSFER', 'CASH', atau 'GOODS_HANDOVER'." };
  }

  const reportedAt = typeof raw.reportedAt === "number" ? raw.reportedAt : NaN;
  if (!Number.isSafeInteger(reportedAt) || reportedAt <= 0) {
    return { ok: false, error: "Waktu kejadian nyata (reportedAt) wajib diisi dengan timestamp yang sah." };
  }

  const paymentRecipient = paymentRecipientOf(raw.paymentRecipient);
  if (!paymentRecipient.ok) return paymentRecipient;

  if (raw.method === "GOODS_HANDOVER") {
    const quantity = trimmed(raw.quantity);
    const unit = trimmed(raw.unit);
    if (!quantity || !isExactNonNegativeDecimal(quantity) || compareDecimalStrings(quantity, "0") <= 0) {
      return { ok: false, error: "Jumlah barang realisasi harus bilangan desimal eksak lebih dari nol." };
    }
    if (!unit) {
      return { ok: false, error: "Satuan barang realisasi wajib dinyatakan." };
    }
    return {
      ok: true,
      value: {
        aidLineId,
        beneficiaryId,
        paymentRecipient: paymentRecipient.value,
        method: "GOODS_HANDOVER",
        amountIdr: raw.amountIdr ? parsePositiveIdr(raw.amountIdr) : null,
        quantity,
        unit,
        reportedAt,
        notes: trimmed(raw.notes) || null,
      },
    };
  }

  const amountIdr = parsePositiveIdr(raw.amountIdr);
  if (!amountIdr) {
    return { ok: false, error: "Jumlah nominal IDR realisasi harus bilangan bulat rupiah lebih dari nol." };
  }

  return {
    ok: true,
    value: {
      aidLineId,
      beneficiaryId,
      paymentRecipient: paymentRecipient.value,
      method: raw.method,
      amountIdr,
      quantity: null,
      unit: null,
      reportedAt,
      notes: trimmed(raw.notes) || null,
    },
  };
}

export function validateEvidenceAllocations(raw: unknown): { ok: true; value: EvidenceAllocation[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Alokasi bukti harus berupa daftar realisasi dan jumlahnya." };
  const seen = new Set<string>();
  const allocations: EvidenceAllocation[] = [];
  for (const entry of raw) {
    const fields = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const realizationId = trimmed(fields.realizationId);
    if (!realizationId) {
      return { ok: false, error: "Setiap alokasi bukti wajib menunjuk realisasi yang sah." };
    }
    if (seen.has(realizationId)) return { ok: false, error: `Realisasi ${realizationId} dialokasikan lebih dari sekali.` };
    seen.add(realizationId);

    const hasAmount = fields.amountIdr != null && fields.amountIdr !== "";
    const hasQuantity = fields.quantity != null && fields.quantity !== "";
    const hasUnit = fields.unit != null && fields.unit !== "";
    if (hasAmount === hasQuantity || (hasAmount && hasUnit)) {
      return { ok: false, error: "Alokasi bukti harus berupa rupiah atau kuantitas dan satuan barang, tidak keduanya." };
    }
    if (hasAmount) {
      const amountIdr = parsePositiveIdr(fields.amountIdr);
      if (!amountIdr) return { ok: false, error: "Nominal alokasi harus rupiah bulat lebih dari nol." };
      allocations.push({ realizationId, amountIdr });
    } else {
      const quantity = trimmed(fields.quantity);
      const unit = trimmed(fields.unit);
      if (!isExactNonNegativeDecimal(quantity) || compareDecimalStrings(quantity, "0") <= 0 || !unit) {
        return { ok: false, error: "Alokasi barang harus memuat kuantitas desimal eksak lebih dari nol dan satuan." };
      }
      allocations.push({ realizationId, quantity, unit });
    }
  }
  return { ok: true, value: allocations };
}

export function calculateRemainderClosure(
  proposal: {
    id: string;
    version: number;
    beneficiaries: Beneficiary[];
    aidLines: AidLine[];
  },
  realizations: RealizationRecord[],
  decisionInfo: {
    institutionId: string;
    decisionReference: string;
    decisionDate: string;
    decisionDocumentId: string;
    decisionDocumentSha256: string;
    reason: string;
    operatorOfficerId: string;
    operatorAccount: string;
    signerAccount: string;
    now: number;
  }
): ProposalClosureRecord {
  const benMap = new Map(proposal.beneficiaries.map((b) => [b.id, b]));
  const lineCumulativeIdr = new Map<string, bigint>();
  const lineCumulativeQty = new Map<string, string>();
  for (const r of realizations) {
    if (r.amountIdr != null) {
      lineCumulativeIdr.set(r.aidLineId, (lineCumulativeIdr.get(r.aidLineId) ?? 0n) + BigInt(r.amountIdr));
    }
    if (r.quantity != null) {
      const prev = lineCumulativeQty.get(r.aidLineId) ?? "0";
      lineCumulativeQty.set(r.aidLineId, addDecimalStrings(prev, r.quantity));
    }
  }

  let totalApprovedIdr = 0n;
  let totalRealizedIdr = 0n;
  let totalUnrealizedRemainderIdr = 0n;

  const goodsTotalsByUnit = new Map<string, { aidType: string; unit: string; totalApproved: string; totalRealized: string; totalUnrealizedRemainder: string }>();

  const lineRemainders: ProposalClosureLineRemainder[] = proposal.aidLines.map((line) => {
    const benName = benMap.get(line.beneficiaryId)?.name ?? "Penerima manfaat";
    if (line.value.kind === "MONEY") {
      const approved = approvedIdrOf(line) ?? 0n;
      const realized = lineCumulativeIdr.get(line.id) ?? 0n;
      const remainder = approved > realized ? approved - realized : 0n;
      totalApprovedIdr += approved;
      totalRealizedIdr += realized;
      totalUnrealizedRemainderIdr += remainder;
      return {
        aidLineId: line.id,
        beneficiaryId: line.beneficiaryId,
        beneficiaryName: benName,
        kind: "MONEY" as const,
        aidType: line.aidType,
        unit: null,
        approved: approved.toString(),
        realized: realized.toString(),
        unrealizedRemainder: remainder.toString(),
      };
    } else {
      const approvedQty = approvedQuantityOf(line) ?? "0";
      const realizedQty = lineCumulativeQty.get(line.id) ?? "0";
      const remainderQty = compareDecimalStrings(approvedQty, realizedQty) > 0 ? subtractDecimalStrings(approvedQty, realizedQty) : "0";
      const unitKey = JSON.stringify([line.aidType, line.value.unit]);
      const prevTotals = goodsTotalsByUnit.get(unitKey) ?? {
        aidType: line.aidType,
        unit: line.value.unit,
        totalApproved: "0",
        totalRealized: "0",
        totalUnrealizedRemainder: "0",
      };
      goodsTotalsByUnit.set(unitKey, {
        aidType: line.aidType,
        unit: line.value.unit,
        totalApproved: addDecimalStrings(prevTotals.totalApproved, approvedQty),
        totalRealized: addDecimalStrings(prevTotals.totalRealized, realizedQty),
        totalUnrealizedRemainder: addDecimalStrings(prevTotals.totalUnrealizedRemainder, remainderQty),
      });
      return {
        aidLineId: line.id,
        beneficiaryId: line.beneficiaryId,
        beneficiaryName: benName,
        kind: "GOODS" as const,
        aidType: line.aidType,
        unit: line.value.unit,
        approved: approvedQty,
        realized: realizedQty,
        unrealizedRemainder: remainderQty,
      };
    }
  });

  return {
    proposalId: proposal.id,
    proposalVersion: proposal.version,
    institutionId: decisionInfo.institutionId,
    decisionReference: decisionInfo.decisionReference,
    decisionDate: decisionInfo.decisionDate,
    decisionDocumentId: decisionInfo.decisionDocumentId,
    decisionDocumentSha256: decisionInfo.decisionDocumentSha256,
    reason: decisionInfo.reason,
    closedAt: decisionInfo.now,
    operatorOfficerId: decisionInfo.operatorOfficerId,
    operatorAccount: decisionInfo.operatorAccount.toLowerCase(),
    signerAccount: decisionInfo.signerAccount.toLowerCase(),
    totalApprovedIdr: totalApprovedIdr.toString(),
    totalRealizedIdr: totalRealizedIdr.toString(),
    totalUnrealizedRemainderIdr: totalUnrealizedRemainderIdr.toString(),
    lineRemainders,
    goodsUnitRemainders: Array.from(goodsTotalsByUnit.values()),
  };
}

export function calculateProposalRealizationSummary(
  proposal: {
    id: string;
    version: number;
    beneficiaries: Beneficiary[];
    aidLines: AidLine[];
    status?: ProposalStatus;
    heldAidLineIds?: string[];
    activeRevisionId?: string | null;
    closure?: ProposalClosureRecord | null;
  },
  realizations: RealizationRecord[],
  advances: Array<Pick<OperationalAdvanceRecord, "amountIdr">> = [],
  expenses: Array<Pick<OperationalExpenseRecord, "amountIdr">> = []
): ProposalRealizationSummary {
  const beneficiaryMap = new Map(proposal.beneficiaries.map((b) => [b.id, b]));

  const realizedIdrByLine = new Map<string, bigint>();
  const realizedQuantityByLine = new Map<string, string>();
  const recipientsByLine = new Map<string, Map<string, PaymentRecipient>>();
  const lineDisputed = new Set<string>();
  const uniqueRealizedBeneficiaryIds = new Set<string>();

  let pendingEvidenceCount = 0;
  let completeEvidenceCount = 0;
  let totalPendingEvidence = 0n;
  let confirmedCount = 0;
  let disputedCount = 0;

  for (const rea of realizations) {
    if (rea.amountIdr) {
      realizedIdrByLine.set(rea.aidLineId, (realizedIdrByLine.get(rea.aidLineId) ?? 0n) + BigInt(rea.amountIdr));
    }
    if (rea.quantity) {
      realizedQuantityByLine.set(
        rea.aidLineId,
        addDecimalStrings(realizedQuantityByLine.get(rea.aidLineId) ?? "0", rea.quantity)
      );
    }
    uniqueRealizedBeneficiaryIds.add(rea.beneficiaryId);
    if (rea.paymentRecipient) {
      const recipients = recipientsByLine.get(rea.aidLineId) ?? new Map<string, PaymentRecipient>();
      recipients.set(JSON.stringify([rea.paymentRecipient.name, rea.paymentRecipient.relation]), rea.paymentRecipient);
      recipientsByLine.set(rea.aidLineId, recipients);
    }

    if (rea.evidenceStatus === "EVIDENCE_COMPLETE") {
      completeEvidenceCount++;
    } else {
      pendingEvidenceCount++;
      if (rea.amountIdr) {
        totalPendingEvidence += BigInt(rea.amountIdr);
      }
    }

    if (rea.confirmationStatus === "CONFIRMED") {
      confirmedCount++;
    } else if (rea.confirmationStatus === "DISPUTED") {
      disputedCount++;
      lineDisputed.add(rea.aidLineId);
    }
  }

  let totalApproved = 0n;
  let totalRealized = 0n;
  let totalValuedGoodsApproved = 0n;
  let hasUnvaluedGoods = false;
  const totalsByUnit: Record<string, RealizationUnitSummary> = {};

  const lines: RealizationLineSummary[] = proposal.aidLines.map((line): RealizationLineSummary => {
    const beneficiaryName = beneficiaryMap.get(line.beneficiaryId)?.name ?? "Tidak dikenal";
    const paymentRecipients = [...(recipientsByLine.get(line.id)?.values() ?? [])];
    const isDisputed = lineDisputed.has(line.id);
    const isHeldForRevision = proposal.heldAidLineIds?.includes(line.id) ?? false;

    if (line.value.kind === "MONEY") {
      const approved = approvedIdrOf(line) ?? 0n;
      const realized = realizedIdrByLine.get(line.id) ?? 0n;
      totalApproved += approved;
      totalRealized += realized;
      const remaining = approved > realized ? approved - realized : 0n;

      return {
        aidLineId: line.id,
        beneficiaryId: line.beneficiaryId,
        beneficiaryName,
        paymentRecipients,
        kind: "MONEY",
        aidType: line.aidType,
        unit: null,
        quantityApproved: null,
        quantityRealized: null,
        quantityRemaining: null,
        amountApprovedIdr: approved.toString(),
        amountRealizedIdr: realized.toString(),
        amountRemainingIdr: remaining.toString(),
        valuedAmountIdr: null,
        valuationBasis: null,
        status: realizationProgress(approved, realized),
        isDisputed,
        isHeldForRevision,
      };
    }

    // GOODS
    const approvedQty = approvedQuantityOf(line) ?? "0";
    const realizedQty = realizedQuantityByLine.get(line.id) ?? "0";
    const remainingQty = subtractDecimalStrings(approvedQty, realizedQty);
    const lineStatus = realizationProgressDecimal(approvedQty, realizedQty);

    const valuation = goodsValuationOf(line.value);
    if (valuation !== null) {
      totalValuedGoodsApproved += BigInt(valuation);
    } else {
      hasUnvaluedGoods = true;
    }

    const unit = line.value.unit;
    const key = JSON.stringify([line.aidType, unit]);
    const currentUnit = totalsByUnit[key] ?? { aidType: line.aidType, unit, approved: "0", realized: "0", remaining: "0" };
    totalsByUnit[key] = {
      aidType: line.aidType,
      unit,
      approved: addDecimalStrings(currentUnit.approved, approvedQty),
      realized: addDecimalStrings(currentUnit.realized, realizedQty),
      remaining: addDecimalStrings(currentUnit.remaining, remainingQty),
    };

    return {
      aidLineId: line.id,
      beneficiaryId: line.beneficiaryId,
      beneficiaryName,
      paymentRecipients,
      kind: "GOODS",
      aidType: line.aidType,
      unit: line.value.unit,
      quantityApproved: approvedQty,
      quantityRealized: realizedQty,
      quantityRemaining: remainingQty,
      amountApprovedIdr: valuation,
      amountRealizedIdr: null,
      amountRemainingIdr: null,
      valuedAmountIdr: valuation,
      valuationBasis: valuation !== null ? line.value.valuationBasis!.trim() : null,
      status: lineStatus,
      isDisputed,
      isHeldForRevision,
    };
  });

  const unitSummaries: RealizationUnitSummary[] = Object.values(totalsByUnit);

  // Overall disbursement status across all lines
  let disbursementStatus: RealizationProgress = "NOT_REALIZED";
  if (proposal.status === "REMAINDER_CLOSED") {
    disbursementStatus = "REMAINDER_CLOSED";
  } else if (lines.length > 0) {
    const allFully = lines.every((l) => l.status === "FULLY_REALIZED");
    const anyProgress = lines.some((l) => l.status === "PARTIALLY_REALIZED" || l.status === "FULLY_REALIZED");
    if (allFully) {
      disbursementStatus = "FULLY_REALIZED";
    } else if (anyProgress) {
      disbursementStatus = "PARTIALLY_REALIZED";
    }
  }

  return {
    proposalId: proposal.id,
    proposalVersion: proposal.version,
    totalApprovedIdr: totalApproved.toString(),
    totalRealizedIdr: totalRealized.toString(),
    totalRemainingIdr: (totalApproved > totalRealized ? totalApproved - totalRealized : 0n).toString(),
    approvedBeneficiaryCount: proposal.beneficiaries.length,
    realizedBeneficiaryCount: uniqueRealizedBeneficiaryIds.size,
    paymentEventCount: realizations.length,
    disbursementStatus,
    evidenceCompleteness: pendingEvidenceCount === 0 && realizations.length > 0 ? "EVIDENCE_COMPLETE" : "EVIDENCE_PENDING",
    pendingEvidenceCount,
    completeEvidenceCount,
    totalPendingEvidenceIdr: totalPendingEvidence.toString(),
    confirmedCount,
    disputedCount,
    totalAdvancesIdr: advances.reduce((acc, a) => acc + BigInt(a.amountIdr), 0n).toString(),
    totalExpensesIdr: expenses.reduce((acc, e) => acc + BigInt(e.amountIdr), 0n).toString(),
    totalsByUnit,
    unitSummaries,
    hasUnvaluedGoods,
    totalValuedGoodsApprovedIdr: lines.some((line) => line.kind === "GOODS" && line.valuedAmountIdr !== null) ? totalValuedGoodsApproved.toString() : null,
    lines,
    activeRevisionId: proposal.activeRevisionId ?? null,
    closure: proposal.closure ?? null,
  };
}

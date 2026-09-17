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
    };

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

export const isExactNonNegativeDecimal = (value: string): boolean => /^\d+(\.\d+)?$/.test(value);

/** Adds two non-negative decimal strings exactly, without passing through floats. */
export function addDecimalStrings(a: string, b: string): string {
  const [aInt, aFrac = ""] = a.split(".");
  const [bInt, bFrac = ""] = b.split(".");
  const scale = Math.max(aFrac.length, bFrac.length);
  const scaled = (int: string, frac: string) => BigInt(int + frac.padEnd(scale, "0"));
  const digits = (scaled(aInt, aFrac) + scaled(bInt, bFrac)).toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  const whole = digits.slice(0, -scale);
  return fraction ? `${whole}.${fraction}` : whole;
}

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
    if (line.value.valuedAmountIdr === null) isPartial = true;
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
  | "CANCELLED";

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
};

export type ProposalDocumentCategory =
  | "PROPOSAL_LETTER"
  | "BENEFICIARY_IDENTITY"
  | "ALTERNATIVE_IDENTITY_PROOF"
  | "REPRESENTATION_PROOF"
  | "PAYMENT_RECIPIENT_PROOF"
  | "BENEFICIARY_ROSTER"
  | "OTHER";

export const PROPOSAL_DOCUMENT_CATEGORIES: ProposalDocumentCategory[] = [
  "PROPOSAL_LETTER",
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
  requireIdentityDoc: boolean;
  requireAlternativeIdProof: boolean;
  requireGuardianProof: boolean;
  warnRecurringAid: boolean;
  version: number;
  updatedAt: number;
  updatedBy: string;
};

export const DEFAULT_DISBURSEMENT_POLICY = (institutionId: string): DisbursementPolicy => ({
  institutionId,
  requireProposalLetter: true,
  requireIdentityDoc: true,
  requireAlternativeIdProof: true,
  requireGuardianProof: true,
  warnRecurringAid: true,
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
    "requireProposalLetter" | "requireIdentityDoc" | "requireAlternativeIdProof" | "requireGuardianProof"
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

export type ProposalHistoryAction =
  | "SUBMIT"
  | "WITHDRAW"
  | "START_EXAMINATION"
  | "RETURN_FOR_REVISION"
  | "MARK_READY";

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

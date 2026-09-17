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
  sopRequiresMultiSignerQuorum: boolean;
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
  | "MARK_READY"
  | "APPROVE"
  | "REJECT";

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
// Keputusan lembaga (Spec #86, ticket #93)
// ---------------------------------------------------------------------------

export type ProposalDecisionAction = "APPROVE" | "REJECT";

export const isProposalDecisionAction = (value: unknown): value is ProposalDecisionAction =>
  value === "APPROVE" || value === "REJECT";

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
  notes: string | null;
  rejectionReason: string | null;
  approvedAidLines: ApprovedAidLineInput[];
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
  notes: string | null;
  rejectionReason: string | null;
  rightsDigest: string;
  operatorOfficerId: string;
  operatorAccount: string;
  signerAccount: string;
  mandateId: string;
  signature: string;
  createdAt: number;
};

/** Compares two non-negative decimal strings exactly. */
function compareDecimalStrings(a: string, b: string): number {
  const [aInt, aFrac = ""] = a.split(".");
  const [bInt, bFrac = ""] = b.split(".");
  const scale = Math.max(aFrac.length, bFrac.length);
  const left = BigInt(aInt + aFrac.padEnd(scale, "0"));
  const right = BigInt(bInt + bFrac.padEnd(scale, "0"));
  return left === right ? 0 : left < right ? -1 : 1;
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
  if (intent.action === "REJECT") return { ok: true, lines: aidLines };

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
export function computeRightsDigest(decidedLines: AidLine[], intent: Omit<ProposalDecisionIntent, "approvedAidLines">): Hex32 {
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
    return { ok: false, error: "Tindakan keputusan harus 'APPROVE' atau 'REJECT'." };
  }

  const decisionReference = trimmed(raw.decisionReference);
  if (!decisionReference) {
    return { ok: false, error: "Rujukan keputusan lembaga (SK / Berita Acara Pleno) wajib diisi." };
  }

  const decisionDate = trimmed(raw.decisionDate);
  if (!isIsoDate(decisionDate)) {
    return { ok: false, error: "Tanggal keputusan harus berformat tanggal yang sah (YYYY-MM-DD)." };
  }

  const rejectionReason = action === "REJECT" ? trimmed(raw.rejectionReason) : null;
  if (rejectionReason === "") {
    return { ok: false, error: "Alasan penolakan wajib diisi secara jelas bila pengajuan ditolak." };
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

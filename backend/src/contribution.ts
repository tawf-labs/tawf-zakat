/**
 * Pure domain logic for institutional contributions (Spec #100, Ticket #102).
 *
 * Fulfills:
 * - US-05: Record funds received outside ZKT with source references.
 * - US-32: Distinguish received funds from unexamined imports.
 * - US-33: Detect duplicate source references and retries.
 * - US-34: Endorse only source-reconciled received contributions for batches.
 * - US-51: Retain contributions with absent or incorrect contacts.
 * - AC08: Unexamined imports do not enter endorsed batches; source repetition does not create new funds.
 * - AC15: Public projections do not reveal private donor identity, amount, or contacts.
 * - AC29: Strict institutional isolation and authenticated session attribution.
 */

import { JENIS_DANA, type CurrencyUnit } from "./reconciliation";

export type JenisDana = (typeof JENIS_DANA)[number];

export const CONTRIBUTION_STATUSES = [
  "RECEIVED",    // Diterima: dicatat di luar ZKT, belum dicocokkan dengan sumber bank
  "RECONCILED",  // Dicocokkan: amil telah memeriksa bukti rekening koran/mutasi lembaga
  "ENDORSED",    // Disahkan: pejabat berwenang mengesahkan kelayakan masuk batch kontribusi
  "REJECTED",    // Ditolak: bukti sumber tidak sah atau dibatalkan
] as const;

export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

export const CURRENCY_UNITS = ["IDR", "USDC_6DP"] as const satisfies readonly CurrencyUnit[];

export const isCurrencyUnit = (value: unknown): value is CurrencyUnit =>
  typeof value === "string" && (CURRENCY_UNITS as readonly string[]).includes(value);

export const isContributionStatus = (value: unknown): value is ContributionStatus =>
  typeof value === "string" && (CONTRIBUTION_STATUSES as readonly string[]).includes(value as ContributionStatus);

export const SOURCE_CHANNELS = [
  "BANK_TRANSFER",
  "QRIS",
  "CASH",
  "CRYPTO_USDC",
  "DIRECT",
  "OTHER",
] as const;

export type SourceChannel = (typeof SOURCE_CHANNELS)[number];

export const isSourceChannel = (value: unknown): value is SourceChannel =>
  typeof value === "string" && (SOURCE_CHANNELS as readonly string[]).includes(value as SourceChannel);

export const SOURCE_CHANNEL_LABELS: Record<SourceChannel, string> = {
  BANK_TRANSFER: "Transfer Bank",
  QRIS: "QRIS",
  CASH: "Tunai",
  CRYPTO_USDC: "Kripto (USDC)",
  DIRECT: "Penerimaan Langsung",
  OTHER: "Kanal Lainnya",
};

export const STATUS_LABELS: Record<ContributionStatus, string> = {
  RECEIVED: "Diterima",
  RECONCILED: "Dicocokkan",
  ENDORSED: "Disahkan Lembaga",
  REJECTED: "Ditolak",
};

export type ContributionIssue = {
  field?: string;
  message: string;
  code:
    | "INVALID_AMOUNT"
    | "INVALID_CURRENCY"
    | "INVALID_FUND_TYPE"
    | "INVALID_SOURCE_CHANNEL"
    | "MISSING_SOURCE_REFERENCE"
    | "INVALID_RECEIVED_AT"
    | "INVALID_STATUS_TRANSITION"
    | "UNRECONCILED_CANNOT_BE_ENDORSED"
    | "VERSION_CONFLICT"
    | "DUPLICATE_SOURCE";
};

export type ContributionInput = {
  id?: string;
  sourceChannel: SourceChannel;
  sourceReference: string;
  currencyUnit: CurrencyUnit;
  amountExact: string;
  fundType: JenisDana;
  purpose: string;
  receivedAt: number;
  donorName?: string | null;
  donorContact?: string | null;
};

export type ReconciliationInput = {
  proofRef: string;
  notes?: string;
};

export type EndorsementInput = {
  mandateId: string;
  notes?: string;
};

export type ContributionRecord = {
  id: string;
  institutionId: string;
  sourceChannel: SourceChannel;
  sourceReference: string;
  currencyUnit: CurrencyUnit;
  amountExact: string;
  fundType: JenisDana;
  purpose: string;
  receivedAt: number;
  donorName: string | null;
  donorContact: string | null;
  status: ContributionStatus;
  reconciledAt: number | null;
  reconciledBy: string | null;
  reconciliationProofRef: string | null;
  reconciliationNotes: string | null;
  endorsedAt: number | null;
  endorsedBy: string | null;
  endorsementMandateId: string | null;
  endorsementNotes: string | null;
  unqualifiedReason: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
};

/**
 * Explains clearly why a contribution is not yet eligible for batch inclusion.
 */
export function evaluateQualificationReason(status: ContributionStatus): string | null {
  switch (status) {
    case "RECEIVED":
      return "Belum dicocokkan dengan rekening koran atau bukti sumber lembaga.";
    case "RECONCILED":
      return "Menunggu pengesahan resmi dari pihak berwenang lembaga.";
    case "ENDORSED":
      return null; // Memenuhi syarat untuk batch
    case "REJECTED":
      return "Catatan ditolak karena sumber tidak terverifikasi atau tidak sah.";
    default:
      return "Status tidak dikenal.";
  }
}

const FUND_TYPE_ALIASES: Record<string, JenisDana> = {
  ZAKAT_MAAL: "ZAKAT",
  ZAKAT_FITRAH: "FITRAH",
  INFAK: "INFAK_SEDEKAH",
  INFAQ: "INFAK_SEDEKAH",
  INFAQ_SEDEKAH: "INFAK_SEDEKAH",
  SEDEKAH: "INFAK_SEDEKAH",
};

/**
 * The one reader of a fund type, shared by the form and the tabular import so both
 * land on the same `JENIS_DANA`. Anything outside it (wakaf, for one) is refused
 * rather than folded into a neighbouring bucket.
 */
export function normalizeFundType(raw: unknown): JenisDana | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toUpperCase().replace(/[\s\-/]+/g, "_");
  if (FUND_TYPE_ALIASES[key]) return FUND_TYPE_ALIASES[key];
  return (JENIS_DANA as readonly string[]).includes(key) ? (key as JenisDana) : null;
}

/**
 * Validates manual contribution input.
 */
export function validateContributionInput(input: Partial<ContributionInput>): ContributionIssue[] {
  const issues: ContributionIssue[] = [];

  if (!input.sourceChannel || !isSourceChannel(input.sourceChannel)) {
    issues.push({
      field: "sourceChannel",
      message: "Kanal sumber harus dipilih dari opsi yang sah.",
      code: "INVALID_SOURCE_CHANNEL",
    });
  }

  const sourceRef = String(input.sourceReference ?? "").trim();
  if (!sourceRef) {
    issues.push({
      field: "sourceReference",
      message: "Nomor referensi atau identitas sumber penerimaan wajib diisi.",
      code: "MISSING_SOURCE_REFERENCE",
    });
  }

  if (!isCurrencyUnit(input.currencyUnit)) {
    issues.push({
      field: "currencyUnit",
      message: "Satuan mata uang harus IDR atau USDC_6DP.",
      code: "INVALID_CURRENCY",
    });
  }

  const rawAmount = String(input.amountExact ?? "").trim();
  if (!/^\d+$/.test(rawAmount) || rawAmount === "0" || rawAmount.startsWith("0")) {
    issues.push({
      field: "amountExact",
      message: "Nominal harus berupa bilangan bulat positif tanpa desimal atau pemisah ribuan.",
      code: "INVALID_AMOUNT",
    });
  }

  if (!input.fundType || !(JENIS_DANA as readonly string[]).includes(input.fundType)) {
    issues.push({
      field: "fundType",
      message: "Jenis dana harus dipilih dari kategori syariah yang sah.",
      code: "INVALID_FUND_TYPE",
    });
  }

  if (typeof input.receivedAt !== "number" || !Number.isSafeInteger(input.receivedAt) || input.receivedAt <= 0) {
    issues.push({
      field: "receivedAt",
      message: "Waktu penerimaan dana di luar ZKT harus berupa timestamp detik yang sah.",
      code: "INVALID_RECEIVED_AT",
    });
  }

  // Note on donorContact (US-51): Contact may be empty, null, or imperfect.
  // Missing or absent contact is explicitly allowed and must not reject or delete the contribution.

  return issues;
}

/**
 * Whether a status transition is permitted under domain rules.
 * Specifically enforces AC08: A RECEIVED contribution CANNOT be directly endorsed.
 */
export function checkStatusTransition(
  currentStatus: ContributionStatus,
  targetStatus: ContributionStatus
): { allowed: boolean; issue?: ContributionIssue } {
  if (currentStatus === targetStatus) {
    return { allowed: true };
  }

  if (currentStatus === "RECEIVED") {
    if (targetStatus === "RECONCILED") return { allowed: true };
    if (targetStatus === "REJECTED") return { allowed: true };
    if (targetStatus === "ENDORSED") {
      return {
        allowed: false,
        issue: {
          message: "Kontribusi yang belum dicocokkan (RECEIVED) tidak boleh langsung disahkan untuk batch. Lakukan rekonsiliasi sumber terlebih dahulu.",
          code: "UNRECONCILED_CANNOT_BE_ENDORSED",
        },
      };
    }
  }

  if (currentStatus === "RECONCILED") {
    if (targetStatus === "ENDORSED") return { allowed: true };
    if (targetStatus === "REJECTED") return { allowed: true };
    if (targetStatus === "RECEIVED") {
      // Pembatalan rekonsiliasi kembali ke draf penerimaan
      return { allowed: true };
    }
  }

  if (currentStatus === "ENDORSED") {
    if (targetStatus === "REJECTED") return { allowed: true };
  }

  return {
    allowed: false,
    issue: {
      message: `Transisi status dari ${currentStatus} ke ${targetStatus} tidak diizinkan.`,
      code: "INVALID_STATUS_TRANSITION",
    },
  };
}

// ---------------------------------------------------------------------------
// Correction & Refund Domain Logic (Spec #100, Ticket #106)
// ---------------------------------------------------------------------------

export const CORRECTION_TYPES = ["AMOUNT", "DUPLICATE"] as const;
export type CorrectionType = (typeof CORRECTION_TYPES)[number];

export const isCorrectionType = (value: unknown): value is CorrectionType =>
  typeof value === "string" && (CORRECTION_TYPES as readonly string[]).includes(value as CorrectionType);

export type ContributionCorrection = {
  id: string;
  institutionId: string;
  contributionId: string;
  fromVersion: number;
  toVersion: number;
  correctionType: CorrectionType;
  fromAmountExact: string;
  toAmountExact: string;
  reason: string;
  sourceProofRef: string;
  actorAccount: string;
  actorOfficerId: string | null;
  createdAt: number;
};

export const REFUND_STATUSES = ["DECIDED", "PAID", "CANCELLED"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const isRefundStatus = (value: unknown): value is RefundStatus =>
  typeof value === "string" && (REFUND_STATUSES as readonly string[]).includes(value as RefundStatus);

export type ContributionRefund = {
  id: string;
  institutionId: string;
  contributionId: string;
  amountExact: string;
  currencyUnit: CurrencyUnit;
  fundType: JenisDana;
  reason: string;
  policyBasis: string;
  status: RefundStatus;
  contributionVersion: number;
  decidedAt: number;
  decidedBy: string;
  decidedByOfficerId: string | null;
  paidAt: number | null;
  paidBy: string | null;
  paidByOfficerId: string | null;
  paymentProofRef: string | null;
  paymentNotes: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type ContributionEvent = {
  id: number;
  institutionId: string;
  contributionId: string;
  version: number;
  previousVersion: number;
  eventType: "CORRECTION" | "REFUND_DECISION" | "REFUND_PAYMENT" | "ENDORSEMENT" | "RECONCILIATION";
  amountExact: string;
  reason: string;
  sourceProofRef: string | null;
  actorAccount: string;
  actorOfficerId: string | null;
  occurredAt: number;
  proofSuperseded: boolean;
};

export type CorrectionInput = {
  correctionType: CorrectionType;
  amountExact?: string;
  reason: string;
  sourceProofRef: string;
  expectedVersion: number;
};

export function validateCorrectionInput(
  input: Partial<CorrectionInput>,
  currentAmountExact: string
): ContributionIssue[] {
  const issues: ContributionIssue[] = [];

  if (!input.correctionType || !isCorrectionType(input.correctionType)) {
    issues.push({
      field: "correctionType",
      message: "Tipe koreksi harus berupa 'AMOUNT' (koreksi nominal) atau 'DUPLICATE' (pencatatan ganda).",
      code: "INVALID_STATUS_TRANSITION",
    });
  }

  const reason = String(input.reason ?? "").trim();
  if (!reason || reason.length < 5) {
    issues.push({
      field: "reason",
      message: "Alasan koreksi wajib diisi dan minimal 5 karakter.",
      code: "MISSING_SOURCE_REFERENCE",
    });
  }

  const sourceProofRef = String(input.sourceProofRef ?? "").trim();
  if (!sourceProofRef) {
    issues.push({
      field: "sourceProofRef",
      message: "Referensi bukti sumber koreksi wajib disertakan.",
      code: "MISSING_SOURCE_REFERENCE",
    });
  }

  if (input.correctionType === "AMOUNT") {
    const rawAmount = String(input.amountExact ?? "").trim();
    if (!/^\d+$/.test(rawAmount) || rawAmount === "0" || rawAmount.startsWith("0")) {
      issues.push({
        field: "amountExact",
        message: "Nominal baru harus berupa bilangan bulat positif tanpa desimal atau pemisah ribuan.",
        code: "INVALID_AMOUNT",
      });
    } else if (rawAmount === currentAmountExact) {
      issues.push({
        field: "amountExact",
        message: "Nominal baru sama dengan nominal saat ini. Gunakan nominal yang berbeda untuk koreksi nominal.",
        code: "INVALID_AMOUNT",
      });
    }
  }

  return issues;
}

export type RefundDecisionInput = {
  amountExact: string;
  reason: string;
  policyBasis: string;
  expectedVersion: number;
};

export function validateRefundDecisionInput(
  input: Partial<RefundDecisionInput>,
  availableContributionAmount: bigint
): ContributionIssue[] {
  const issues: ContributionIssue[] = [];

  const rawAmount = String(input.amountExact ?? "").trim();
  if (!/^\d+$/.test(rawAmount) || rawAmount === "0" || rawAmount.startsWith("0")) {
    issues.push({
      field: "amountExact",
      message: "Nominal pengembalian harus berupa bilangan bulat positif.",
      code: "INVALID_AMOUNT",
    });
  } else {
    const refundBig = BigInt(rawAmount);
    if (refundBig > availableContributionAmount) {
      issues.push({
        field: "amountExact",
        message: `Nominal pengembalian (${rawAmount}) melebihi nominal kontribusi (${availableContributionAmount.toString()}).`,
        code: "INVALID_AMOUNT",
      });
    }
  }

  const reason = String(input.reason ?? "").trim();
  if (!reason || reason.length < 5) {
    issues.push({
      field: "reason",
      message: "Alasan keputusan pengembalian wajib diisi (minimal 5 karakter).",
      code: "MISSING_SOURCE_REFERENCE",
    });
  }

  const policyBasis = String(input.policyBasis ?? "").trim();
  if (!policyBasis || policyBasis.length < 5) {
    issues.push({
      field: "policyBasis",
      message: "Dasar kebijakan jenis dana lembaga wajib disertakan (minimal 5 karakter). ZKT tidak menyediakan hak refund bebas.",
      code: "MISSING_SOURCE_REFERENCE",
    });
  }

  return issues;
}

export type RefundPaymentInput = {
  paymentProofRef: string;
  paidAt: number;
  paymentNotes?: string;
};

export function validateRefundPaymentInput(input: Partial<RefundPaymentInput>): ContributionIssue[] {
  const issues: ContributionIssue[] = [];

  const proofRef = String(input.paymentProofRef ?? "").trim();
  if (!proofRef) {
    issues.push({
      field: "paymentProofRef",
      message: "Nomor referensi atau bukti transfer pengembalian dana wajib diisi.",
      code: "MISSING_SOURCE_REFERENCE",
    });
  }

  if (typeof input.paidAt !== "number" || !Number.isSafeInteger(input.paidAt) || input.paidAt <= 0) {
    issues.push({
      field: "paidAt",
      message: "Waktu pembayaran aktual wajib berupa timestamp detik yang sah.",
      code: "INVALID_RECEIVED_AT",
    });
  }

  return issues;
}

/**
 * Proof versioning check (AC19):
 * Proofs pointing to an older business version than the contribution's current version
 * are NOT current, and MUST be labeled SUPERSEDED (never CURRENT).
 */
export function evaluateProofValidity(
  currentContributionVersion: number,
  proofContributionVersion: number | null
): { status: "CURRENT" | "SUPERSEDED" | "NOT_AVAILABLE"; isCurrent: boolean; label: string } {
  if (proofContributionVersion === null || proofContributionVersion === undefined) {
    return { status: "NOT_AVAILABLE", isCurrent: false, label: "Belum Ada Proof" };
  }
  if (proofContributionVersion < currentContributionVersion) {
    return { status: "SUPERSEDED", isCurrent: false, label: "Digantikan / Usang (Superseded)" };
  }
  return { status: "CURRENT", isCurrent: true, label: "Berlaku (Current)" };
}

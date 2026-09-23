/**
 * Pure domain logic for accountless donor access via OTP (Spec #100, Ticket #104).
 *
 * Implements:
 * - US-38: Donors view their contribution and the activity it funds.
 * - US-39: Donors see pooled activity progress without other donors' identities.
 * - US-46: Minimal notification through available contact without private details.
 * - US-47: Open one contribution after OTP verification without compulsory registration.
 * - US-48: Bounded verified session allows navigation without a new code per page.
 * - US-49: Access confined to authorized contribution (shared contact does not reveal whole history).
 * - US-52: Public/aggregate views preserve recipient privacy (no photos, NIK, or private documents).
 * - US-53: Genuine institutional receipt while ZK publication is pending.
 * - US-54: Explicit proof pending / not available without manufactured success.
 * - AC13: IDOR prevention, link forwarding protection, bounded single-contribution session.
 * - AC14: Replay protection, rate limiting, attempt limit, expiration.
 * - AC15: No private donor identity, amount, or recipient documents in unauthorized/public contexts.
 * - AC20: Truthful representation of proof status without fabricated proofs.
 * - AC29: Strict separation between donor session and operator workspace authority.
 */

import type { DonorContributionCorrection } from "../../shared/contribution-lifecycle";
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { CurrencyUnit } from "./reconciliation";
import type { ContributionStatus, JenisDana, SourceChannel } from "./contribution";
import type { ActivityStatus } from "./activity";

export const DONOR_OTP_TTL_SECONDS = 900; // 15 menit
export const DONOR_OTP_MAX_ATTEMPTS = 5;
export const DONOR_OTP_COOLDOWN_SECONDS = 60; // 1 menit batas pengiriman ulang
/**
 * At most this many codes per contribution per window. Each code allows
 * DONOR_OTP_MAX_ATTEMPTS guesses, so the window also bounds the total guesses
 * against one contribution, and bounds how often a stranger holding the
 * reference can replace the donor's live code.
 */
export const DONOR_OTP_MAX_SENDS_PER_WINDOW = 5;
export const DONOR_OTP_SEND_WINDOW_SECONDS = 3600; // 1 jam
export const DONOR_SESSION_TTL_SECONDS = 3600; // 1 jam masa berlaku sesi

export interface DonorSession {
  tokenHash: string;
  contributionId: string;
  institutionId: string;
  expiresAt: number;
  revokedAt: number | null;
  createdAt: number;
  lastAccessedAt: number;
}

import type { DonorZkProofDetail } from "../../shared/activity-trace";
export type { DonorZkProofDetail, DonorZkProofStatus } from "../../shared/activity-trace";

export interface DonorContributionDetail {
  version: number;
  corrections: DonorContributionCorrection[];
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
  donorContactMasked: string | null;
  status: ContributionStatus;
  reconciledAt: number | null;
  endorsedAt: number | null;
  /** Real ZK proof of membership status (Spec #100, Issue #108). */
  zkProof: DonorZkProofDetail;
}

export type { DonorReallocation } from "../../shared/activity-trace";

/**
 * One mustahik's part of this donor's rupiah (ADR-0037). A pseudonym, an asnaf and two
 * amounts - never a name, NIK, address, contact, photo, document, representative or
 * payment recipient. The region label is the activity's, never the recipient's own
 * address, which would be precise enough to guess the person in a small village.
 */
export interface DonorBeneficiaryShare {
  /** `Mustahik #07`: the recipient's position on the proposal roster, never their identity. */
  beneficiaryPseudonym: string;
  asnaf: string;
  /** Rupiah from this contribution to this mustahik. */
  shareExact: string;
  /** The mustahik's approved need, the denominator behind "800.000 dari 800.000". */
  aidLineApprovedExact: string;
  /** Whether this donor's share covers that need on its own. */
  isFull: boolean;
  fillSequence: number;
}

export interface DonorAllocationBeneficiaries {
  shares: DonorBeneficiaryShare[];
  /** Set when the k-anonymity guard withheld the detail; the honest reason, not an empty list. */
  withheldReason: string | null;
  /**
   * This allocation's rupiah not attributed to any mustahik: it exceeds the activity's
   * remaining need, or belongs to aid whose value is not yet known. Visible, not hidden
   * as a zero (ADR-0033).
   */
  unassignedExact: string;
  /** One label for the whole activity, taken from its program's scope. */
  regionLabel: string | null;
  /** The attribution is accounting, not a physical earmark; the UI must say so. */
  disclaimer: string;
}

export interface DonorActivityAllocation {
  allocationId: string;
  activityId: string;
  amountExact: string;
  currencyUnit: CurrencyUnit;
  fundType: JenisDana;
  purpose: string;
  reason: string;
  allocatedAt: number;
  /** The contribution version this allocation was made against (#114 compares it with the current one). */
  contributionVersion: number;
  /** Who this donor's rupiah reached, as pseudonyms (ADR-0037). */
  beneficiaries: DonorAllocationBeneficiaries;
  activity: {
    id: string;
    name: string;
    description: string | null;
    targetAmount: string;
    targetIsPartial: boolean;
    currencyUnit: CurrencyUnit;
    status: ActivityStatus;
    pooled: {
      totalAllocatedAmount: string;
      allocationCount: number;
    };
  };
}

export const DONOR_RECOVERY_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type DonorRecoveryStatus = (typeof DONOR_RECOVERY_STATUSES)[number];

export interface DonorRecoveryRequest {
  id: string;
  contributionId: string;
  institutionId: string;
  requestedContact: string;
  requestedContactMasked: string;
  donorName: string | null;
  evidenceBasis: string;
  status: DonorRecoveryStatus;
  decisionReason: string | null;
  decidedByAccount: string | null;
  decidedByOfficerId: string | null;
  decidedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PublicDonorRecoveryStatus {
  id: string;
  status: DonorRecoveryStatus;
  requestedContactMasked: string;
  createdAt: number;
  decidedAt: number | null;
}

export interface DonorRecoveryRequestInput {
  reference: string;
  requestedContact: string;
  donorName?: string | null;
  evidenceBasis: string;
}

export function validateRecoveryRequestInput(input: unknown): { ok: true; value: DonorRecoveryRequestInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Badan permintaan tidak sah." };
  }
  const rec = input as Record<string, unknown>;
  const reference = typeof rec.reference === "string" ? rec.reference.trim() : "";
  if (!reference) {
    return { ok: false, error: "Referensi kontribusi wajib diisi." };
  }
  const requestedContact = typeof rec.requestedContact === "string" ? rec.requestedContact.trim() : "";
  if (!requestedContact) {
    return { ok: false, error: "Kontak baru yang diajukan wajib diisi." };
  }
  if (!requestedContact.includes("@") || requestedContact.length < 5) {
    return { ok: false, error: "Kontak yang diajukan harus berupa alamat email yang sah." };
  }
  const evidenceBasis = typeof rec.evidenceBasis === "string" ? rec.evidenceBasis.trim() : "";
  if (!evidenceBasis || evidenceBasis.length < 5) {
    return { ok: false, error: "Dasar hubungan atau bukti kepemilikan kontribusi wajib diisi (minimal 5 karakter)." };
  }
  const donorName = typeof rec.donorName === "string" && rec.donorName.trim() ? rec.donorName.trim() : null;
  return {
    ok: true,
    value: {
      reference,
      requestedContact,
      donorName,
      evidenceBasis,
    },
  };
}

export interface DonorRecoveryDecisionInput {
  decision: "APPROVED" | "REJECTED";
  reason: string;
  expectedContributionVersion: number;
  operationId?: string;
}

export function validateRecoveryDecisionInput(input: unknown): { ok: true; value: DonorRecoveryDecisionInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Badan keputusan tidak sah." };
  }
  const rec = input as Record<string, unknown>;
  const decision = rec.decision;
  if (decision !== "APPROVED" && decision !== "REJECTED") {
    return { ok: false, error: "Keputusan harus berupa 'APPROVED' atau 'REJECTED'." };
  }
  const reason = typeof rec.reason === "string" ? rec.reason.trim() : "";
  if (!reason || reason.length < 5) {
    return { ok: false, error: "Alasan keputusan wajib diisi (minimal 5 karakter)." };
  }
  const expectedContributionVersion = Number(rec.expectedContributionVersion);
  if (!Number.isInteger(expectedContributionVersion) || expectedContributionVersion <= 0) {
    return { ok: false, error: "Versi kontribusi yang diharapkan (expectedContributionVersion) wajib berupa bilangan bulat positif." };
  }
  const operationId = typeof rec.operationId === "string" && rec.operationId.trim() ? rec.operationId.trim() : undefined;
  return {
    ok: true,
    value: {
      decision,
      reason,
      expectedContributionVersion,
      operationId,
    },
  };
}

/**
 * Masks a contact string (phone number or email) to protect donor privacy.
 * Examples:
 * - "081234567890" -> "0812****7890" or "******7890"
 * - "donatur@example.com" -> "d***r@example.com"
 */
export function maskContact(contact: string): string {
  const trimmed = contact.trim();
  if (!trimmed) return "";

  if (trimmed.includes("@")) {
    const [local, domain] = trimmed.split("@");
    if (!domain) return "****";
    if (local.length <= 2) {
      return `${local[0] ?? "*"}***@${domain}`;
    }
    return `${local[0]}***${local[local.length - 1]}@${domain}`;
  }

  // Phone number or numeric ID
  if (trimmed.length <= 4) {
    return "****";
  }
  const start = trimmed.slice(0, Math.min(4, Math.floor(trimmed.length / 3)));
  const end = trimmed.slice(-4);
  const starsCount = Math.max(3, trimmed.length - start.length - end.length);
  return `${start}${"*".repeat(starsCount)}${end}`;
}

/**
 * Validates that an OTP code is exactly 6 digits.
 */
export function isValidOtpFormat(code: unknown): code is string {
  return typeof code === "string" && /^\d{6}$/.test(code);
}

/**
 * Keyed hash of the challenge ID and code. The challenge ID reaches the
 * browser and a code has only 10^6 values, so an unkeyed hash would be
 * reversible by anyone who reads the table; the server key prevents that.
 */
export function hashOtpCode(key: Buffer, challengeId: string, code: string): string {
  return createHmac("sha256", key).update(`${challengeId}:${code}`).digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function otpHashMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(actual, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The OTP key, 32 bytes hex in DONOR_OTP_KEY. Absent means null; a malformed
 * value is refused rather than silently weakened.
 */
export function donorOtpKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env.DONOR_OTP_KEY?.trim();
  if (!raw) return null;
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("DONOR_OTP_KEY harus 32 byte heksadesimal (64 karakter).");
  }
  return Buffer.from(hex, "hex");
}

/**
 * Computes SHA-256 hash of a session token for secure database lookup.
 */
export function hashSessionToken(sessionToken: string): string {
  return createHash("sha256").update(sessionToken).digest("hex");
}

/**
 * Generates a cryptographically secure 6-digit numeric OTP code.
 */
export function generateOtpCode(): string {
  return String(randomInt(100000, 1000000));
}

/**
 * Minimal message body for donor OTP notification.
 * Explicitly does NOT include donor name, donation amount, or any sensitive details.
 */
export function formatMinimalOtpMessage(code: string): string {
  const minutes = Math.round(DONOR_OTP_TTL_SECONDS / 60);
  return `Kode verifikasi akses kontribusi Anda: ${code}. Berlaku selama ${minutes} menit. Jangan bagikan kode ini kepada siapapun.`;
}

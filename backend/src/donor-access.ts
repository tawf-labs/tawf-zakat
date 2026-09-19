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

import { createHash, randomInt } from "node:crypto";
import type { CurrencyUnit } from "./reconciliation";
import type { ContributionStatus, JenisDana, SourceChannel } from "./contribution";

export const DONOR_OTP_TTL_SECONDS = 900; // 15 menit
export const DONOR_OTP_MAX_ATTEMPTS = 5;
export const DONOR_OTP_COOLDOWN_SECONDS = 60; // 1 menit batas pengiriman ulang
export const DONOR_SESSION_TTL_SECONDS = 3600; // 1 jam masa berlaku sesi

export interface DonorOtpChallenge {
  id: string;
  contributionId: string;
  institutionId: string;
  contactMasked: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: number;
  consumedAt: number | null;
  createdAt: number;
}

export interface DonorSession {
  tokenHash: string;
  contributionId: string;
  institutionId: string;
  expiresAt: number;
  revokedAt: number | null;
  createdAt: number;
  lastAccessedAt: number;
}

export interface DonorContributionDetail {
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
  zkProof: {
    status: "NOT_AVAILABLE" | "PENDING" | "VERIFIED";
  };
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
  activity: {
    id: string;
    name: string;
    description: string | null;
    targetAmount: string;
    targetIsPartial: boolean;
    currencyUnit: CurrencyUnit;
    status: string;
    pooled: {
      totalAllocatedAmount: string;
      allocationCount: number;
    };
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
 * Computes a salted SHA-256 hash of the OTP challenge ID and code.
 */
export function hashOtpCode(challengeId: string, code: string): string {
  return createHash("sha256").update(`${challengeId}:${code}`).digest("hex");
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
  return `Kode verifikasi akses kontribusi Anda: ${code}. Berlaku selama 15 menit. Jangan bagikan kode ini kepada siapapun.`;
}

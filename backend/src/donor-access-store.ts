/**
 * Durable Storage Layer for Accountless Donor Access & OTP (Spec #100, Ticket #104).
 *
 * Implements:
 * - OTP challenge lifecycle (issue, rate-limit, attempt cap, expiry, replay prevention).
 * - Bounded donor session tokens (IDOR prevention, single-contribution scope, revocation).
 * - Authorized retrieval of contribution details and activity allocations.
 */

import { sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  DONOR_OTP_COOLDOWN_SECONDS,
  DONOR_OTP_MAX_ATTEMPTS,
  DONOR_OTP_TTL_SECONDS,
  DONOR_SESSION_TTL_SECONDS,
  formatMinimalOtpMessage,
  generateOtpCode,
  hashOtpCode,
  hashSessionToken,
  isValidOtpFormat,
  maskContact,
  type DonorActivityAllocation,
  type DonorContributionDetail,
  type DonorOtpChallenge,
  type DonorSession,
} from "./donor-access";
import type { RecipientMessageTransport } from "./workspace-runtime";
import type { CurrencyUnit } from "./reconciliation";
import type { ContributionStatus, JenisDana, SourceChannel } from "./contribution";

export const DONOR_ACCESS_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS donor_otp_challenges (
     id TEXT PRIMARY KEY,
     contribution_id TEXT NOT NULL REFERENCES contributions (id) ON DELETE CASCADE,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     contact_masked TEXT NOT NULL,
     code_hash TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     max_attempts INTEGER NOT NULL DEFAULT 5,
     expires_at BIGINT NOT NULL,
     consumed_at BIGINT,
     created_at BIGINT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS donor_otp_by_contrib ON donor_otp_challenges (contribution_id, created_at DESC);`,
  `CREATE TABLE IF NOT EXISTS donor_sessions (
     token_hash TEXT PRIMARY KEY,
     contribution_id TEXT NOT NULL REFERENCES contributions (id) ON DELETE CASCADE,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     expires_at BIGINT NOT NULL,
     revoked_at BIGINT,
     created_at BIGINT NOT NULL,
     last_accessed_at BIGINT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS donor_sess_by_contrib ON donor_sessions (contribution_id, expires_at);`,
];

export class DonorContactMissingError extends Error {
  constructor(message = "Kontribusi ini tidak memiliki kontak terdaftar untuk pengiriman OTP. Hubungi amil lembaga untuk pemulihan akses.") {
    super(message);
    this.name = "DonorContactMissingError";
  }
}

export class DonorOtpRateLimitError extends Error {
  constructor(message = "Harap tunggu 60 detik sebelum meminta kode OTP baru.") {
    super(message);
    this.name = "DonorOtpRateLimitError";
  }
}

export class DonorOtpInvalidError extends Error {
  remainingAttempts?: number;
  constructor(message: string, remainingAttempts?: number) {
    super(message);
    this.name = "DonorOtpInvalidError";
    this.remainingAttempts = remainingAttempts;
  }
}

export class DonorSessionExpiredError extends Error {
  constructor(message = "Sesi akses donatur telah kedaluwarsa atau tidak sah. Silakan verifikasi ulang melalui OTP.") {
    super(message);
    this.name = "DonorSessionExpiredError";
  }
}

export class DonorAccessDeniedError extends Error {
  constructor(message = "Akses ditolak: sesi ini hanya berlaku untuk kontribusi yang diotorisasi.") {
    super(message);
    this.name = "DonorAccessDeniedError";
  }
}

export class DonorContributionNotFoundError extends Error {
  constructor(message = "Catatan kontribusi tidak ditemukan.") {
    super(message);
    this.name = "DonorContributionNotFoundError";
  }
}

export class DonorTransportUnavailableError extends Error {
  constructor(message = "Layanan pengiriman OTP belum tersedia. Hubungi amil lembaga untuk informasi lebih lanjut.") {
    super(message);
    this.name = "DonorTransportUnavailableError";
  }
}

export type DonorDatabase = {
  execute: (query: any) => Promise<any>;
  transaction: <T>(run: (tx: { execute: (query: any) => Promise<any> }) => Promise<T>) => Promise<T>;
};

export interface DonorAccessStore {
  ensureSchema(): Promise<void>;
  issueOtp(
    contributionId: string,
    now: number,
    messages?: RecipientMessageTransport
  ): Promise<{ challengeId: string; contactMasked: string; expiresAt: number }>;
  verifyOtp(
    challengeId: string,
    otpCode: string,
    now: number
  ): Promise<{ sessionToken: string; expiresAt: number; contributionId: string }>;
  getSession(sessionToken: string, now: number): Promise<DonorSession | null>;
  revokeSession(sessionToken: string, now: number): Promise<void>;
  getDonorContribution(session: DonorSession): Promise<DonorContributionDetail>;
  getDonorAllocations(session: DonorSession): Promise<DonorActivityAllocation[]>;
}

function rowsOf<T = any>(result: any): T[] {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.rows)) return result.rows;
  return [];
}

export function createDonorAccessStore(database: DonorDatabase): DonorAccessStore {
  return {
    async ensureSchema(): Promise<void> {
      for (const statement of DONOR_ACCESS_SCHEMA_STATEMENTS) {
        await database.execute(sql.raw(statement));
      }
    },

    async issueOtp(
      contributionId: string,
      now: number,
      messages?: RecipientMessageTransport
    ): Promise<{ challengeId: string; contactMasked: string; expiresAt: number }> {
      if (!messages) {
        throw new DonorTransportUnavailableError();
      }

      // Check contribution existence and contact
      const contribRows = rowsOf(
        await database.execute(sql`
          SELECT id, institution_id, donor_contact, donor_name
          FROM contributions
          WHERE id = ${contributionId}
        `)
      );

      const contribution = contribRows[0];
      if (!contribution) {
        throw new DonorContributionNotFoundError();
      }

      const rawContact = contribution.donor_contact;
      if (!rawContact || typeof rawContact !== "string" || !rawContact.trim()) {
        throw new DonorContactMissingError();
      }

      const contact = rawContact.trim();

      // Rate limit check: cooldown within DONOR_OTP_COOLDOWN_SECONDS
      const recentChallenges = rowsOf(
        await database.execute(sql`
          SELECT id, created_at
          FROM donor_otp_challenges
          WHERE contribution_id = ${contributionId}
            AND created_at > ${now - DONOR_OTP_COOLDOWN_SECONDS}
          ORDER BY created_at DESC
          LIMIT 1
        `)
      );

      if (recentChallenges.length > 0) {
        throw new DonorOtpRateLimitError();
      }

      const challengeId = `d-otp-${randomBytes(16).toString("hex")}`;
      const code = generateOtpCode();
      const codeHash = hashOtpCode(challengeId, code);
      const contactMasked = maskContact(contact);
      const expiresAt = now + DONOR_OTP_TTL_SECONDS;

      // Invalidate any unconsumed previous challenges for this contribution
      await database.execute(sql`
        UPDATE donor_otp_challenges
        SET consumed_at = ${now}
        WHERE contribution_id = ${contributionId}
          AND consumed_at IS NULL
      `);

      // Store challenge
      await database.execute(sql`
        INSERT INTO donor_otp_challenges (
          id, contribution_id, institution_id, contact_masked, code_hash,
          attempts, max_attempts, expires_at, consumed_at, created_at
        ) VALUES (
          ${challengeId}, ${contributionId}, ${contribution.institution_id}, ${contactMasked}, ${codeHash},
          0, ${DONOR_OTP_MAX_ATTEMPTS}, ${expiresAt}, NULL, ${now}
        )
      `);

      // Send minimal message via transport
      try {
        await messages.send({
          to: contact,
          body: formatMinimalOtpMessage(code),
        });
      } catch (sendError) {
        // Void the challenge if delivery fails
        await database.execute(sql`
          UPDATE donor_otp_challenges
          SET consumed_at = ${now}
          WHERE id = ${challengeId}
        `);
        throw sendError;
      }

      return { challengeId, contactMasked, expiresAt };
    },

    async verifyOtp(
      challengeId: string,
      otpCode: string,
      now: number
    ): Promise<{ sessionToken: string; expiresAt: number; contributionId: string }> {
      if (!isValidOtpFormat(otpCode)) {
        throw new DonorOtpInvalidError("Format kode OTP tidak sah. Harus 6 digit angka.");
      }

      type Outcome =
        | { kind: "spent"; message: string }
        | { kind: "invalid"; message: string; remaining: number }
        | { kind: "verified"; sessionToken: string; expiresAt: number; contributionId: string };

      const outcome = await database.transaction<Outcome>(async (tx) => {
        const rows = rowsOf(
          await tx.execute(sql`
            SELECT * FROM donor_otp_challenges
            WHERE id = ${challengeId}
            FOR UPDATE
          `)
        );

        const challenge = rows[0];
        if (!challenge) {
          return { kind: "spent", message: "Tantangan OTP tidak ditemukan." };
        }

        if (challenge.consumed_at !== null) {
          return { kind: "spent", message: "Kode OTP sudah pernah digunakan atau kedaluwarsa. Minta kode baru." };
        }

        if (Number(challenge.expires_at) <= now) {
          await tx.execute(sql`
            UPDATE donor_otp_challenges
            SET consumed_at = ${now}
            WHERE id = ${challengeId}
          `);
          return { kind: "spent", message: "Kode OTP sudah kedaluwarsa. Minta kode baru." };
        }

        const currentAttempts = Number(challenge.attempts);
        const maxAttempts = Number(challenge.max_attempts);

        if (currentAttempts >= maxAttempts) {
          await tx.execute(sql`
            UPDATE donor_otp_challenges
            SET consumed_at = ${now}
            WHERE id = ${challengeId}
          `);
          return { kind: "spent", message: "Batas percobaan kode OTP telah habis. Minta kode baru." };
        }

        const expectedHash = hashOtpCode(challengeId, otpCode);
        if (expectedHash !== challenge.code_hash) {
          const nextAttempts = currentAttempts + 1;
          const isExhausted = nextAttempts >= maxAttempts;
          await tx.execute(sql`
            UPDATE donor_otp_challenges
            SET attempts = ${nextAttempts},
                consumed_at = ${isExhausted ? now : null}
            WHERE id = ${challengeId}
          `);
          const remaining = Math.max(0, maxAttempts - nextAttempts);
          return {
            kind: "invalid",
            message: remaining > 0 ? `Kode OTP salah. Sisa percobaan: ${remaining}.` : "Kode OTP salah. Batas percobaan habis. Minta kode baru.",
            remaining,
          };
        }

        // OTP matched - consume challenge
        await tx.execute(sql`
          UPDATE donor_otp_challenges
          SET consumed_at = ${now}
          WHERE id = ${challengeId}
        `);

        // Generate bounded session
        const sessionToken = `dsess_${randomBytes(24).toString("hex")}`;
        const tokenHash = hashSessionToken(sessionToken);
        const expiresAt = now + DONOR_SESSION_TTL_SECONDS;

        await tx.execute(sql`
          INSERT INTO donor_sessions (
            token_hash, contribution_id, institution_id,
            expires_at, revoked_at, created_at, last_accessed_at
          ) VALUES (
            ${tokenHash}, ${challenge.contribution_id}, ${challenge.institution_id},
            ${expiresAt}, NULL, ${now}, ${now}
          )
        `);

        return {
          kind: "verified",
          sessionToken,
          expiresAt,
          contributionId: challenge.contribution_id,
        };
      });

      if (outcome.kind === "spent") {
        throw new DonorOtpInvalidError(outcome.message);
      }
      if (outcome.kind === "invalid") {
        throw new DonorOtpInvalidError(outcome.message, outcome.remaining);
      }

      return {
        sessionToken: outcome.sessionToken,
        expiresAt: outcome.expiresAt,
        contributionId: outcome.contributionId,
      };
    },

    async getSession(sessionToken: string, now: number): Promise<DonorSession | null> {
      if (!sessionToken || typeof sessionToken !== "string") return null;
      const tokenHash = hashSessionToken(sessionToken);

      const rows = rowsOf(
        await database.execute(sql`
          SELECT * FROM donor_sessions
          WHERE token_hash = ${tokenHash}
            AND expires_at > ${now}
            AND revoked_at IS NULL
        `)
      );

      const row = rows[0];
      if (!row) return null;

      // Update last accessed
      await database.execute(sql`
        UPDATE donor_sessions
        SET last_accessed_at = ${now}
        WHERE token_hash = ${tokenHash}
      `);

      return {
        tokenHash: row.token_hash,
        contributionId: row.contribution_id,
        institutionId: row.institution_id,
        expiresAt: Number(row.expires_at),
        revokedAt: row.revoked_at ? Number(row.revoked_at) : null,
        createdAt: Number(row.created_at),
        lastAccessedAt: now,
      };
    },

    async revokeSession(sessionToken: string, now: number): Promise<void> {
      if (!sessionToken || typeof sessionToken !== "string") return;
      const tokenHash = hashSessionToken(sessionToken);
      await database.execute(sql`
        UPDATE donor_sessions
        SET revoked_at = ${now}
        WHERE token_hash = ${tokenHash}
      `);
    },

    async getDonorContribution(session: DonorSession): Promise<DonorContributionDetail> {
      const rows = rowsOf(
        await database.execute(sql`
          SELECT * FROM contributions
          WHERE id = ${session.contributionId}
            AND institution_id = ${session.institutionId}
        `)
      );

      const row = rows[0];
      if (!row) {
        throw new DonorContributionNotFoundError();
      }

      return {
        id: row.id,
        institutionId: row.institution_id,
        sourceChannel: row.source_channel as SourceChannel,
        sourceReference: row.source_reference,
        currencyUnit: row.currency_unit as CurrencyUnit,
        amountExact: row.amount_exact,
        fundType: row.fund_type as JenisDana,
        purpose: row.purpose ?? "",
        receivedAt: Number(row.received_at),
        donorName: row.donor_name ?? null,
        donorContactMasked: row.donor_contact ? maskContact(row.donor_contact) : null,
        status: row.status as ContributionStatus,
        reconciledAt: row.reconciled_at ? Number(row.reconciled_at) : null,
        endorsedAt: row.endorsed_at ? Number(row.endorsed_at) : null,
        zkProof: {
          status: "NOT_AVAILABLE", // Honest, not fabricated
        },
      };
    },

    async getDonorAllocations(session: DonorSession): Promise<DonorActivityAllocation[]> {
      const allocationRows = rowsOf(
        await database.execute(sql`
          SELECT ca.*, a.name AS activity_name, a.description AS activity_description,
                 a.target_amount, a.target_is_partial, a.status AS activity_status
          FROM contribution_allocations ca
          JOIN distribution_activities a ON a.id = ca.activity_id AND a.institution_id = ca.institution_id
          WHERE ca.contribution_id = ${session.contributionId}
            AND ca.institution_id = ${session.institutionId}
          ORDER BY ca.allocated_at DESC, ca.id
        `)
      );

      const allocations: DonorActivityAllocation[] = [];

      for (const row of allocationRows) {
        // Compute pooled totals for this activity across all donors without exposing individual identities
        const pooledRows = rowsOf(
          await database.execute(sql`
            SELECT COALESCE(SUM(CAST(amount_exact AS NUMERIC)), 0) as total_pooled,
                   COUNT(id) as allocation_count
            FROM contribution_allocations
            WHERE activity_id = ${row.activity_id}
              AND institution_id = ${session.institutionId}
              AND status = 'ACTIVE'
          `)
        );

        const pooled = pooledRows[0];
        const totalAllocatedAmount = String(pooled?.total_pooled ?? "0");
        const allocationCount = Number(pooled?.allocation_count ?? 0);

        allocations.push({
          allocationId: row.id,
          activityId: row.activity_id,
          amountExact: row.amount_exact,
          currencyUnit: row.currency_unit as CurrencyUnit,
          fundType: row.fund_type as JenisDana,
          purpose: row.purpose ?? "",
          reason: row.reason,
          allocatedAt: Number(row.allocated_at),
          activity: {
            id: row.activity_id,
            name: row.activity_name,
            description: row.activity_description ?? null,
            targetAmount: row.target_amount,
            targetIsPartial: Boolean(row.target_is_partial),
            currencyUnit: row.currency_unit as CurrencyUnit,
            status: row.activity_status,
            pooled: {
              totalAllocatedAmount,
              allocationCount,
            },
          },
        });
      }

      return allocations;
    },
  };
}

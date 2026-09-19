/**
 * Durable Storage Layer for Accountless Donor Access & OTP (Spec #100, Ticket #104).
 *
 * Implements:
 * - OTP challenge lifecycle (issue, rate-limit, attempt cap, expiry, replay prevention).
 * - Bounded donor session tokens (IDOR prevention, single-contribution scope, revocation).
 * - Authorized retrieval of contribution details and activity allocations.
 */

import { sql, type SQL } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  DONOR_OTP_COOLDOWN_SECONDS,
  DONOR_OTP_MAX_ATTEMPTS,
  DONOR_OTP_MAX_SENDS_PER_WINDOW,
  DONOR_OTP_SEND_WINDOW_SECONDS,
  DONOR_OTP_TTL_SECONDS,
  DONOR_SESSION_TTL_SECONDS,
  formatMinimalOtpMessage,
  generateOtpCode,
  hashOtpCode,
  hashSessionToken,
  isValidOtpFormat,
  maskContact,
  otpHashMatches,
  type DonorActivityAllocation,
  type DonorContributionDetail,
  type DonorSession,
} from "./donor-access";
import type { RecipientMessageTransport } from "./workspace-runtime";
import type { CurrencyUnit } from "./reconciliation";
import type { ContributionStatus, JenisDana, SourceChannel } from "./contribution";
import type { ActivityStatus } from "./activity";
import { rowsOf } from "./sql-rows";

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
  constructor(
    message: string,
    /** Unix seconds from which a new code may be requested. */
    readonly retryAt: number
  ) {
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
  constructor(
    message = "Catatan kontribusi tidak ditemukan. Periksa kembali referensi pada kuitansi Anda."
  ) {
    super(message);
    this.name = "DonorContributionNotFoundError";
  }
}

export class DonorDeliveryFailedError extends Error {
  constructor(message = "Kode belum dapat dikirim. Coba lagi beberapa saat lagi.") {
    super(message);
    this.name = "DonorDeliveryFailedError";
  }
}

export class DonorTransportUnavailableError extends Error {
  constructor(message = "Layanan pengiriman OTP belum tersedia. Hubungi amil lembaga untuk informasi lebih lanjut.") {
    super(message);
    this.name = "DonorTransportUnavailableError";
  }
}

type Executor = { execute: (query: SQL) => Promise<unknown> };

export type DonorDatabase = Executor & {
  transaction: <T>(run: (tx: Executor) => Promise<T>) => Promise<T>;
};

export type DonorAccessStore = ReturnType<typeof createDonorAccessStore>;

export type IssuedDonorOtp = {
  challengeId: string;
  expiresAt: number;
  /** Unix seconds from which another code may be requested. */
  resendAvailableAt: number;
};

const consumeChallenge = (executor: Executor, challengeId: string, now: number) =>
  executor.execute(sql`
    UPDATE donor_otp_challenges SET consumed_at = ${now}
    WHERE id = ${challengeId} AND consumed_at IS NULL
  `);

type ReferencedContribution = {
  id: string;
  institution_id: string;
  donor_contact: string | null;
  status: ContributionStatus;
  received_at: number | string;
};

/**
 * The one contribution a donor's reference names: its ID, or its source
 * reference when no other institution's contribution shares it. The public
 * lookup and the OTP request resolve a reference by this same rule. With
 * `lock`, the row is held so that concurrent code requests for one
 * contribution are counted against the send limit one at a time.
 */
async function contributionByReference(
  executor: Executor,
  reference: string,
  { lock }: { lock: boolean }
): Promise<ReferencedContribution> {
  const rows = rowsOf(
    await executor.execute(sql`
      SELECT id, institution_id, donor_contact, status, received_at
      FROM contributions
      WHERE id = ${reference} OR source_reference = ${reference}
      ORDER BY (id = ${reference}) DESC, id
      LIMIT 2
      ${lock ? sql`FOR UPDATE` : sql``}
    `)
  );
  if (rows.length === 0) throw new DonorContributionNotFoundError();
  if (rows.length > 1 && rows[0].id !== reference) {
    throw new DonorContributionNotFoundError(
      "Referensi ini cocok dengan lebih dari satu kontribusi. Gunakan ID kontribusi yang tertera pada kuitansi lembaga."
    );
  }
  return rows[0];
}

export function createDonorAccessStore(database: DonorDatabase, otpKey: Buffer) {
  return {
    async ensureSchema(): Promise<void> {
      for (const statement of DONOR_ACCESS_SCHEMA_STATEMENTS) {
        await database.execute(sql.raw(statement));
      }
    },

    /**
     * The state a public page may show for a reference, and nothing else: no
     * contribution ID, institution, contact, donor or amount.
     */
    async publicState(reference: string): Promise<{ status: ContributionStatus; receivedAt: number } | null> {
      try {
        const row = await contributionByReference(database, reference, { lock: false });
        return { status: row.status, receivedAt: Number(row.received_at) };
      } catch (error) {
        if (error instanceof DonorContributionNotFoundError) return null;
        throw error;
      }
    },

    /**
     * Issues a code for the contribution the donor's reference names and sends
     * it to that contribution's own contact. The response names neither the
     * contribution nor the contact, so a reference alone reveals nothing more.
     */
    async issueOtp(
      reference: string,
      now: number,
      messages?: RecipientMessageTransport
    ): Promise<IssuedDonorOtp> {
      if (!messages) {
        throw new DonorTransportUnavailableError();
      }

      const issued = await database.transaction(async (tx) => {
        const contribution = await contributionByReference(tx, reference, { lock: true });
        const contact = contribution.donor_contact?.trim();
        if (!contact) throw new DonorContactMissingError();
        if (messages.canDeliver && !messages.canDeliver(contact)) {
          throw new DonorContactMissingError(
            "Kontak pada kontribusi ini belum dapat dijangkau: pengiriman kode saat ini hanya melalui email. Hubungi amil lembaga untuk memperbarui kontak Anda."
          );
        }

        const [recent] = rowsOf(
          await tx.execute(sql`
            SELECT COUNT(*) AS sent, MAX(created_at) AS last_sent_at
            FROM donor_otp_challenges
            WHERE contribution_id = ${contribution.id}
              AND created_at > ${now - DONOR_OTP_SEND_WINDOW_SECONDS}
          `)
        );
        const sent = Number(recent?.sent ?? 0);
        const lastSentAt = recent?.last_sent_at == null ? null : Number(recent.last_sent_at);
        if (lastSentAt !== null && lastSentAt > now - DONOR_OTP_COOLDOWN_SECONDS) {
          throw new DonorOtpRateLimitError(
            `Harap tunggu ${DONOR_OTP_COOLDOWN_SECONDS} detik sebelum meminta kode OTP baru.`,
            lastSentAt + DONOR_OTP_COOLDOWN_SECONDS
          );
        }
        if (sent >= DONOR_OTP_MAX_SENDS_PER_WINDOW) {
          const [oldest] = rowsOf(
            await tx.execute(sql`
              SELECT MIN(created_at) AS first_sent_at FROM donor_otp_challenges
              WHERE contribution_id = ${contribution.id}
                AND created_at > ${now - DONOR_OTP_SEND_WINDOW_SECONDS}
            `)
          );
          throw new DonorOtpRateLimitError(
            `Batas ${DONOR_OTP_MAX_SENDS_PER_WINDOW} kode per ${Math.round(DONOR_OTP_SEND_WINDOW_SECONDS / 60)} menit untuk kontribusi ini telah tercapai. Coba lagi nanti.`,
            Number(oldest.first_sent_at) + DONOR_OTP_SEND_WINDOW_SECONDS
          );
        }

        const challengeId = `d-otp-${randomBytes(16).toString("hex")}`;
        const code = generateOtpCode();
        const expiresAt = now + DONOR_OTP_TTL_SECONDS;

        // Only the newest code for a contribution is live.
        await tx.execute(sql`
          UPDATE donor_otp_challenges SET consumed_at = ${now}
          WHERE contribution_id = ${contribution.id} AND consumed_at IS NULL
        `);
        await tx.execute(sql`
          INSERT INTO donor_otp_challenges (
            id, contribution_id, institution_id, contact_masked, code_hash,
            attempts, max_attempts, expires_at, consumed_at, created_at
          ) VALUES (
            ${challengeId}, ${contribution.id}, ${contribution.institution_id}, ${maskContact(contact)},
            ${hashOtpCode(otpKey, challengeId, code)}, 0, ${DONOR_OTP_MAX_ATTEMPTS}, ${expiresAt}, NULL, ${now}
          )
        `);
        return { challengeId, code, contact, expiresAt };
      });

      try {
        await messages.send({ to: issued.contact, body: formatMinimalOtpMessage(issued.code) });
      } catch (sendError) {
        // A code that never arrived must not stay live. The contact is not logged.
        await consumeChallenge(database, issued.challengeId, now);
        console.error("Donor OTP delivery failed:", sendError instanceof Error ? sendError.message : sendError);
        throw new DonorDeliveryFailedError();
      }

      return {
        challengeId: issued.challengeId,
        expiresAt: issued.expiresAt,
        resendAvailableAt: now + DONOR_OTP_COOLDOWN_SECONDS,
      };
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
          await consumeChallenge(tx, challengeId, now);
          return { kind: "spent", message: "Kode OTP sudah kedaluwarsa. Minta kode baru." };
        }

        const currentAttempts = Number(challenge.attempts);
        const maxAttempts = Number(challenge.max_attempts);

        if (currentAttempts >= maxAttempts) {
          await consumeChallenge(tx, challengeId, now);
          return { kind: "spent", message: "Batas percobaan kode OTP telah habis. Minta kode baru." };
        }

        if (!otpHashMatches(challenge.code_hash, hashOtpCode(otpKey, challengeId, otpCode))) {
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

        await consumeChallenge(tx, challengeId, now);

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
        zkProof: { status: "NOT_AVAILABLE" },
      };
    },

    async getDonorAllocations(session: DonorSession): Promise<DonorActivityAllocation[]> {
      // Pooled totals cover every active allocation to the activity, and carry
      // no other donor's identity or individual amount.
      const rows = rowsOf(
        await database.execute(sql`
          SELECT ca.id, ca.activity_id, ca.amount_exact, ca.currency_unit, ca.fund_type,
                 ca.purpose, ca.reason, ca.allocated_at,
                 a.name AS activity_name, a.description AS activity_description,
                 a.target_amount, a.target_is_partial,
                 a.currency_unit AS activity_currency_unit, a.status AS activity_status,
                 pooled.total_pooled, pooled.allocation_count
          FROM contribution_allocations ca
          JOIN distribution_activities a
            ON a.id = ca.activity_id AND a.institution_id = ca.institution_id
          JOIN (
            SELECT activity_id, institution_id,
                   SUM(CAST(amount_exact AS NUMERIC)) AS total_pooled,
                   COUNT(id) AS allocation_count
            FROM contribution_allocations
            WHERE status = 'ACTIVE'
            GROUP BY activity_id, institution_id
          ) pooled
            ON pooled.activity_id = ca.activity_id AND pooled.institution_id = ca.institution_id
          WHERE ca.contribution_id = ${session.contributionId}
            AND ca.institution_id = ${session.institutionId}
            AND ca.status = 'ACTIVE'
          ORDER BY ca.allocated_at DESC, ca.id
        `)
      );

      return rows.map((row) => ({
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
          currencyUnit: row.activity_currency_unit as CurrencyUnit,
          status: row.activity_status as ActivityStatus,
          pooled: {
            totalAllocatedAmount: String(row.total_pooled ?? "0"),
            allocationCount: Number(row.allocation_count ?? 0),
          },
        },
      }));
    },
  };
}

/**
 * Accountless Donor Access routes (Spec #100, Ticket #104).
 *
 * Endpoints:
 *   POST /api/donor/otp-challenge       request one-time verification code to donor contact
 *   POST /api/donor/otp-verify          verify OTP and obtain bounded session token
 *   GET  /api/donor/contributions/:id   get contribution details for authorized session
 *   GET  /api/donor/contributions/:id/allocations get activity allocations & pooled progress
 *   POST /api/donor/logout              revoke active donor session immediately
 *
 * Principles (ADR-0033 & Spec #100):
 * - No wallet or account registration needed.
 * - Sesi terbatas binds only the single authorized contribution (IDOR prevented).
 * - Shared contacts never expose entire donation history.
 * - Minimal OTP message contains zero private details.
 * - Honest proof status without fabricated ZK/Merkle proofs.
 * - Strict isolation: donor sessions have zero workspace/operator privileges.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { workspaceRuntime, type WorkspaceRuntime } from "../workspace-runtime";
import {
  DonorAccessDeniedError,
  DonorContactMissingError,
  DonorContributionNotFoundError,
  DonorOtpInvalidError,
  DonorOtpRateLimitError,
  DonorSessionExpiredError,
  DonorTransportUnavailableError,
} from "../donor-access-store";

export const donorAccessRoutes = new Hono();

donorAccessRoutes.onError((error, c) => {
  if (error instanceof DonorContactMissingError) {
    return c.json({ success: false, error: error.message }, 422);
  }
  if (error instanceof DonorOtpRateLimitError) {
    return c.json({ success: false, error: error.message }, 429);
  }
  if (error instanceof DonorTransportUnavailableError) {
    return c.json({ success: false, error: error.message }, 503);
  }
  if (error instanceof DonorContributionNotFoundError) {
    return c.json({ success: false, error: error.message }, 404);
  }
  if (error instanceof DonorAccessDeniedError) {
    return c.json({ success: false, error: error.message }, 403);
  }
  if (error instanceof DonorSessionExpiredError) {
    return c.json({ success: false, error: error.message }, 401);
  }
  if (error instanceof DonorOtpInvalidError) {
    const status = error.remainingAttempts !== undefined ? 401 : 400;
    return c.json({ success: false, error: error.message, remainingAttempts: error.remainingAttempts }, status);
  }
  console.error("Donor access route error:", error);
  return c.json({ success: false, error: "Terjadi kesalahan internal pada layanan akses donatur." }, 500);
});

const runtimeOf = (): WorkspaceRuntime => {
  const rt = workspaceRuntime();
  if (!rt || !rt.donorAccess) {
    throw new DonorTransportUnavailableError(
      "Layanan akses donatur belum dikonfigurasi pada deployment ini."
    );
  }
  return rt;
};

const bearerTokenOf = (c: Context): string | null => {
  const auth = c.req.header("Authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
};

/**
 * 1. Request OTP challenge for a contribution.
 */
donorAccessRoutes.post("/otp-challenge", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const contributionId = typeof body.contributionId === "string" ? body.contributionId.trim() : "";

  if (!contributionId) {
    return c.json({ success: false, error: "ID kontribusi wajib disertakan." }, 400);
  }

  const runtime = runtimeOf();
  const challenge = await runtime.donorAccess!.issueOtp(
    contributionId,
    runtime.now(),
    runtime.messages
  );

  return c.json(
    {
      success: true,
      challengeId: challenge.challengeId,
      contactMasked: challenge.contactMasked,
      expiresAt: challenge.expiresAt,
    },
    201
  );
});

/**
 * 2. Verify OTP code and obtain bounded session token.
 */
donorAccessRoutes.post("/otp-verify", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const challengeId = typeof body.challengeId === "string" ? body.challengeId.trim() : "";
  const otpCode = typeof body.otpCode === "string" ? body.otpCode.trim() : "";

  if (!challengeId || !otpCode) {
    return c.json({ success: false, error: "ID tantangan dan kode OTP wajib disertakan." }, 400);
  }

  const runtime = runtimeOf();
  const session = await runtime.donorAccess!.verifyOtp(challengeId, otpCode, runtime.now());

  return c.json({
    success: true,
    sessionToken: session.sessionToken,
    expiresAt: session.expiresAt,
    contributionId: session.contributionId,
  });
});

/**
 * 3. Retrieve contribution details for authorized donor session.
 */
donorAccessRoutes.get("/contributions/:id", async (c) => {
  const id = c.req.param("id")?.trim();
  if (!id) return c.json({ success: false, error: "ID kontribusi wajib disertakan." }, 400);

  const token = bearerTokenOf(c);
  if (!token) {
    return c.json({ success: false, error: "Token sesi donatur diperlukan." }, 401);
  }

  const runtime = runtimeOf();
  const session = await runtime.donorAccess!.getSession(token, runtime.now());
  if (!session) {
    throw new DonorSessionExpiredError();
  }

  // Object authorization check (AC13 IDOR protection)
  if (session.contributionId !== id) {
    throw new DonorAccessDeniedError();
  }

  const contribution = await runtime.donorAccess!.getDonorContribution(session);
  return c.json({ success: true, contribution });
});

/**
 * 4. Retrieve activity allocations for authorized donor session.
 */
donorAccessRoutes.get("/contributions/:id/allocations", async (c) => {
  const id = c.req.param("id")?.trim();
  if (!id) return c.json({ success: false, error: "ID kontribusi wajib disertakan." }, 400);

  const token = bearerTokenOf(c);
  if (!token) {
    return c.json({ success: false, error: "Token sesi donatur diperlukan." }, 401);
  }

  const runtime = runtimeOf();
  const session = await runtime.donorAccess!.getSession(token, runtime.now());
  if (!session) {
    throw new DonorSessionExpiredError();
  }

  // Object authorization check (AC13 IDOR protection)
  if (session.contributionId !== id) {
    throw new DonorAccessDeniedError();
  }

  const allocations = await runtime.donorAccess!.getDonorAllocations(session);
  return c.json({ success: true, allocations });
});

/**
 * 5. Logout / revoke active donor session.
 */
donorAccessRoutes.post("/logout", async (c) => {
  const token = bearerTokenOf(c);
  if (token) {
    const runtime = runtimeOf();
    await runtime.donorAccess!.revokeSession(token, runtime.now());
  }
  return c.json({ success: true, message: "Sesi donatur berhasil ditutup." });
});

/**
 * Accountless Donor Access routes (Spec #100, Ticket #104).
 *
 * Endpoints:
 *   GET    /api/donor/channel                             whether this deployment can deliver a code
 *   POST   /api/donor/otp-challenge                       send a one-time code to the contribution's own contact
 *   POST   /api/donor/session                             exchange a code for a bounded session token
 *   GET    /api/donor/contributions/:id                   contribution detail for its session
 *   GET    /api/donor/contributions/:id/allocations       activity allocations and pooled progress
 *   DELETE /api/donor/session                             revoke the session immediately
 *
 * Principles (ADR-0033 & Spec #100):
 * - No wallet or account registration needed.
 * - A session binds only its one contribution; every read checks it (AC13).
 * - A reference alone reveals neither the contribution ID nor the contact.
 * - Minimal OTP message contains zero private details.
 * - Honest proof status without fabricated ZK/Merkle proofs.
 * - Donor tokens carry no workspace/operator authority.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { workspaceRuntime } from "../workspace-runtime";
import { bearerToken } from "../workspace-session";
import {
  DonorAccessDeniedError,
  DonorContactMissingError,
  DonorContributionNotFoundError,
  DonorDeliveryFailedError,
  DonorOtpInvalidError,
  DonorOtpRateLimitError,
  DonorSessionExpiredError,
  DonorTransportUnavailableError,
  type DonorAccessStore,
} from "../donor-access-store";
import type { DonorSession } from "../donor-access";

export const donorAccessRoutes = new Hono();

// Private detail must not be kept by a shared cache or served to the next token.
donorAccessRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  c.header("Vary", "Authorization");
  await next();
});

donorAccessRoutes.onError((error, c) => {
  if (error instanceof DonorContactMissingError) {
    return c.json({ success: false, error: error.message }, 422);
  }
  if (error instanceof DonorOtpRateLimitError) {
    return c.json({ success: false, error: error.message, retryAt: error.retryAt }, 429);
  }
  if (error instanceof DonorDeliveryFailedError) {
    return c.json({ success: false, error: error.message }, 502);
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

const donorAccessOf = () => {
  const runtime = workspaceRuntime();
  if (!runtime?.donorAccess) {
    throw new DonorTransportUnavailableError("Layanan akses donatur belum dikonfigurasi pada deployment ini.");
  }
  return { store: runtime.donorAccess, now: runtime.now(), messages: runtime.donorMessages };
};

/**
 * The session behind the bearer token, and only if it was issued for the
 * contribution in the path. Forwarded links and swapped IDs stop here (AC13).
 */
async function authorizedSession(c: Context): Promise<{ store: DonorAccessStore; session: DonorSession }> {
  const id = c.req.param("id")?.trim();
  const token = bearerToken(c);
  if (!token) throw new DonorSessionExpiredError("Token sesi donatur diperlukan.");

  const { store, now } = donorAccessOf();
  const session = await store.getSession(token, now);
  if (!session) throw new DonorSessionExpiredError();
  if (!id || session.contributionId !== id) throw new DonorAccessDeniedError();
  return { store, session };
}

/**
 * 0. Whether a code can be delivered here at all, so the page does not offer a
 *    channel that is not live.
 */
donorAccessRoutes.get("/channel", (c) => {
  const runtime = workspaceRuntime();
  return c.json({ success: true, available: Boolean(runtime?.donorAccess && runtime.donorMessages) });
});

/**
 * 1. Request a code for the contribution the donor's reference names.
 */
donorAccessRoutes.post("/otp-challenge", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  if (!reference) {
    return c.json({ success: false, error: "Referensi kontribusi wajib disertakan." }, 400);
  }

  const { store, now, messages } = donorAccessOf();
  const challenge = await store.issueOtp(reference, now, messages);
  return c.json({ success: true, ...challenge }, 201);
});

/**
 * 2. Exchange a code for a bounded session token.
 */
donorAccessRoutes.post("/session", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const challengeId = typeof body.challengeId === "string" ? body.challengeId.trim() : "";
  const otpCode = typeof body.otpCode === "string" ? body.otpCode.trim() : "";
  if (!challengeId || !otpCode) {
    return c.json({ success: false, error: "ID tantangan dan kode OTP wajib disertakan." }, 400);
  }

  const { store, now } = donorAccessOf();
  const session = await store.verifyOtp(challengeId, otpCode, now);
  return c.json({ success: true, ...session }, 201);
});

/**
 * 3. Contribution detail for its own session.
 */
donorAccessRoutes.get("/contributions/:id", async (c) => {
  const { store, session } = await authorizedSession(c);
  return c.json({ success: true, contribution: await store.getDonorContribution(session) });
});

/**
 * 4. Activity allocations for its own session.
 */
donorAccessRoutes.get("/contributions/:id/allocations", async (c) => {
  const { store, session } = await authorizedSession(c);
  return c.json({ success: true, allocations: await store.getDonorAllocations(session) });
});

/**
 * 5. Revoke the session.
 */
donorAccessRoutes.delete("/session", async (c) => {
  const token = bearerToken(c);
  if (token) {
    const { store, now } = donorAccessOf();
    await store.revokeSession(token, now);
  }
  return c.json({ success: true });
});

export default donorAccessRoutes;

/**
 * Who is calling, and on behalf of which institution (Spec #68, tickets #69-70).
 *
 * Extracted from `routes/workspace.ts` when a second module - the evidence
 * packages - needed the same door. A second copy of an authorization check is a
 * second place for it to drift, and the copy that drifts is always the one
 * guarding the newer feature.
 *
 * Two rules, unchanged from where they came from:
 *
 * - **The tenant comes from the session**, re-read on every request so that
 *   revoking a membership takes effect without waiting for a token to expire.
 *   An `institutionId` in a payload or query string may only agree with it.
 * - **Membership here is not a role there.** These capabilities govern the
 *   workspace and nothing else; recording evidence and publishing a report are
 *   authorized by the registry onchain (ADR-0022).
 */

import type { Context } from "hono";
import { sha256, toHex } from "viem";
import { resolveTenant, type WorkspaceRole } from "./tenancy";
import type { WorkspaceRuntime } from "./workspace-runtime";

/** Refusal reasons are a closed vocabulary, so a message can never leak a row. */
export type Refusal =
  | "no-membership"
  | "membership-inactive"
  | "cross-institution"
  | "expired"
  | "replayed"
  | "not-yet-valid"
  | "unknown-challenge"
  | "signature-rejected"
  | "malformed-signature"
  | "forbidden"
  | "not-found"
  | "unauthenticated";

export const REFUSAL_MESSAGES: Record<Refusal, string> = {
  "no-membership": "Akun ini tidak terdaftar pada ruang kerja lembaga mana pun.",
  "membership-inactive": "Keanggotaan akun ini sudah dinonaktifkan.",
  "cross-institution": "Permintaan menyebut lembaga lain daripada lembaga sesi ini.",
  expired: "Tantangan sudah kedaluwarsa. Minta tantangan baru.",
  replayed: "Tantangan sudah pernah dipakai.",
  "not-yet-valid": "Tantangan belum berlaku.",
  "unknown-challenge": "Tantangan tidak dikenal.",
  "signature-rejected": "Tanda tangan tidak sah untuk akun tersebut.",
  "malformed-signature": "Tanda tangan tidak berbentuk heksadesimal yang sah.",
  forbidden: "Peran Anda tidak berwenang melakukan tindakan ini.",
  "not-found": "Tidak ada catatan tersebut pada ruang kerja lembaga ini.",
  unauthenticated: "Sesi ruang kerja tidak ditemukan atau sudah berakhir.",
};

export const refuse = (c: Context, status: 400 | 401 | 403 | 404, reason: Refusal) =>
  c.json({ success: false, reason, error: REFUSAL_MESSAGES[reason] }, status);

export const badRequest = (c: Context, error: string) => c.json({ success: false, error }, 400);

export const hashToken = (token: string): string => sha256(toHex(token));

/** The header is the only place a token is accepted. */
export const bearerToken = (c: Context): string => {
  const header = c.req.header("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
};

export type WorkspaceSession = {
  institutionId: string;
  account: string;
  role: WorkspaceRole;
};

/**
 * Resolves the caller from the `Authorization` header, then checks that any
 * institution they named agrees with the one their session is for.
 */
export async function authenticateWorkspace(
  c: Context,
  runtime: WorkspaceRuntime,
  requestedInstitutionId: string | undefined
): Promise<{ ok: true; session: WorkspaceSession } | { ok: false; response: Response }> {
  const token = bearerToken(c);
  if (token === "") return { ok: false, response: refuse(c, 401, "unauthenticated") };

  const stored = await runtime.store.sessionFor(hashToken(token), runtime.now());
  if (!stored) return { ok: false, response: refuse(c, 401, "unauthenticated") };

  // The session is only a claim about the account; the membership is re-read on
  // every request, so revoking one takes effect without waiting for expiry.
  const membership = await runtime.store.activeMembershipFor(stored.account);
  const tenant = resolveTenant(membership, { requestedInstitutionId });
  if (!tenant.ok) return { ok: false, response: refuse(c, 403, tenant.reason) };
  if (tenant.institutionId !== stored.institutionId) {
    return { ok: false, response: refuse(c, 403, "cross-institution") };
  }

  return {
    ok: true,
    session: { institutionId: tenant.institutionId, account: stored.account, role: tenant.role },
  };
}

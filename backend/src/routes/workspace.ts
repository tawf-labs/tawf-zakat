/**
 * The institutional workspace door (Spec #68, ticket #69).
 *
 * Four steps, and the order is the point:
 *
 *   POST /challenge  the server mints a nonce bound to a purpose, an account
 *                    and a closing time, and stores it
 *   POST /session    the account returns it signed; the signature is verified,
 *                    the nonce is spent, the membership decides the tenant, and
 *                    a bearer token is issued once
 *   GET  /           the token resolves to a workspace, scoped to one institution
 *   DELETE /session  the token stops resolving
 *
 * Every refusal happens here, at the API, not in the interface. A caller with
 * `curl` meets the same gates as the browser does, which is the only version of
 * this that means anything.
 *
 * Two rules worth stating plainly, because both are easy to write the wrong way:
 *
 * - **The tenant comes from the session.** `institutionId` in a payload or a
 *   query string may only agree with it; disagreement is a refusal, never a
 *   silent correction to the "right" institution.
 * - **Membership here is not a role there.** These capabilities govern the
 *   workspace and nothing else. Recording evidence and publishing a report are
 *   authorized by the registry onchain (ADR-0022), so no row in this database
 *   is ever consulted as a fallback for a role the chain refuses.
 *
 * The token is returned exactly once, at sign-in. Only its SHA-256 hash is
 * stored, and no later response, error or log line repeats it.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { toHex, type Hex } from "viem";
import { verifyAccountSignature } from "../account-signature";
import {
  accessChallenge,
  authorize,
  bindsWorkspacePurpose,
  capabilitiesFor,
  isWorkspaceRole,
  judgeChallenge,
  normalizeAccount,
  resolveTenant,
  WORKSPACE_EIP712_DOMAIN,
  WORKSPACE_EIP712_TYPES,
} from "../tenancy";
import {
  authenticateWorkspace as authenticate,
  badRequest,
  bearerToken,
  hashToken,
  refuse,
} from "../workspace-session";
import { workspaceRuntime, type WorkspaceRuntime } from "../workspace-runtime";

const workspaceRoutes = new Hono();

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TOKEN_PREFIX = "tawf_ws_";

const randomHex = (bytes: number): Hex =>
  toHex(crypto.getRandomValues(new Uint8Array(bytes)));

const unconfigured = (c: Context) =>
  c.json(
    {
      success: false,
      error:
        "Ruang kerja lembaga belum dikonfigurasi pada deployment ini. " +
        "Setel DATABASE_URL, lalu jalankan ulang server agar skema ruang kerja dibuat.",
    },
    503
  );

/**
 * One gate for the whole module. Without a configured runtime there is nowhere
 * durable to keep a session, and every handler would otherwise repeat this.
 */
workspaceRoutes.use("*", async (c, next) => {
  if (!workspaceRuntime()) return unconfigured(c);
  return next();
});

/** Safe after the middleware above; the gate is what makes this non-null. */
const runtimeOf = (): WorkspaceRuntime => workspaceRuntime()!;

const readJson = async (c: Context): Promise<Record<string, unknown> | null> => {
  try {
    const body = await c.req.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/** The typed payload an account signs. Numbers on the wire, `uint256` in the hash. */
const typedDataFor = (challenge: ReturnType<typeof accessChallenge>) => ({
  domain: WORKSPACE_EIP712_DOMAIN,
  types: WORKSPACE_EIP712_TYPES,
  primaryType: "WorkspaceAccess" as const,
  message: {
    purpose: challenge.purpose,
    institutionId: challenge.institutionId,
    account: challenge.account,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
  },
});

const signingPayload = (challenge: ReturnType<typeof accessChallenge>) => {
  const typedData = typedDataFor(challenge);
  return {
    ...typedData,
    message: {
      ...typedData.message,
      issuedAt: BigInt(challenge.issuedAt),
      expiresAt: BigInt(challenge.expiresAt),
    },
  };
};

workspaceRoutes.post("/challenge", async (c) => {
  const runtime = runtimeOf();

  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const institutionId = typeof body.institutionId === "string" ? body.institutionId.trim() : "";
  const account = typeof body.account === "string" ? body.account.trim() : "";
  if (institutionId === "") return badRequest(c, "Permintaan harus menyebut lembaga.");
  if (!ADDRESS.test(account)) return badRequest(c, "Alamat akun tidak sah.");

  // Minting for an unknown institution would create a challenge nothing can
  // ever satisfy, so it is refused here rather than at the signature step.
  const institution = await runtime.store.getInstitution(institutionId);
  if (!institution) return refuse(c, 404, "unknown-challenge");

  const challenge = accessChallenge({
    institutionId,
    account,
    nonce: randomHex(32),
    issuedAt: runtime.now(),
    ttlSeconds: runtime.challengeTtlSeconds,
  });
  await runtime.store.saveChallenge(challenge);

  return c.json({ success: true, challenge, typedData: typedDataFor(challenge) }, 201);
});

workspaceRoutes.post("/session", async (c) => {
  const runtime = runtimeOf();

  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const nonce = typeof body.nonce === "string" ? body.nonce.trim().toLowerCase() : "";
  const signature = typeof body.signature === "string" ? body.signature.trim() : "";
  if (!/^0x[0-9a-f]{64}$/.test(nonce)) return badRequest(c, "Nonce tantangan tidak sah.");
  // An address without a signature is an assertion, not a proof.
  if (signature === "") return badRequest(c, "Permintaan harus menyertakan tanda tangan tantangan.");

  // Read before spending. A nonce is a public value once it has been handed
  // out, so burning it on a failed attempt would let anyone who learns one lock
  // the rightful officer out of their own challenge. It is spent below, after
  // the signature has proved the caller is the account it was minted for.
  const stored = await runtime.store.readChallenge(nonce);
  if (!stored) return refuse(c, 401, "unknown-challenge");
  if (stored.consumed) return refuse(c, 401, "replayed");
  // The purpose is read back from the row, not assumed: a challenge minted for
  // anything other than workspace access must not open a workspace session.
  if (!bindsWorkspacePurpose(stored.purpose)) return refuse(c, 401, "unknown-challenge");

  const { challenge } = stored;
  const clock = judgeChallenge(challenge, runtime.now());
  if (!clock.ok) return refuse(c, 401, clock.reason);

  const proof = await verifyAccountSignature({
    typedData: signingPayload(challenge) as never,
    account: challenge.account,
    signature,
    ethCall: runtime.ethCall,
  });
  if (!proof.ok) return refuse(c, 401, proof.reason);

  // Only now is it spent, and the conditional `UPDATE` is what settles a race:
  // two valid requests for one nonce, and exactly one of them opens a session.
  const spent = await runtime.store.consumeChallenge(nonce, runtime.now());
  if (spent.outcome !== "consumed") return refuse(c, 401, "replayed");

  const membership = await runtime.store.activeMembershipFor(challenge.account);
  const tenant = resolveTenant(membership, { requestedInstitutionId: challenge.institutionId });
  if (!tenant.ok) return refuse(c, 403, tenant.reason);

  const token = `${TOKEN_PREFIX}${randomHex(32).slice(2)}`;
  const issuedAt = runtime.now();
  const expiresAt = issuedAt + runtime.sessionTtlSeconds;
  await runtime.store.createSession({
    tokenHash: hashToken(token),
    institutionId: tenant.institutionId,
    account: challenge.account,
    role: tenant.role,
    issuedAt,
    expiresAt,
  });

  // The only time the token is ever spoken.
  return c.json({ success: true, token, expiresAt, institutionId: tenant.institutionId, role: tenant.role }, 201);
});

workspaceRoutes.delete("/session", async (c) => {
  const runtime = runtimeOf();

  const token = bearerToken(c);
  if (token === "") return refuse(c, 401, "unauthenticated");

  await runtime.store.revokeSession(hashToken(token), runtime.now());
  return c.body(null, 204);
});

workspaceRoutes.get("/", async (c) => {
  const runtime = runtimeOf();

  const requested = c.req.query("institutionId") ?? undefined;
  const auth = await authenticate(c, runtime, requested);
  if (!auth.ok) return auth.response;

  const institution = await runtime.store.getInstitution(auth.session.institutionId);
  if (!institution) return refuse(c, 403, "no-membership");

  return c.json({
    success: true,
    institution,
    account: auth.session.account,
    role: auth.session.role,
    capabilities: capabilitiesFor(auth.session.role),
    members: authorize(auth.session.role, "manageMembers")
      ? await runtime.store.membersOf(auth.session.institutionId)
      : undefined,
    // The institution's own frozen preparations (Spec #68, ticket #70). An
    // empty list where evidence storage is unconfigured is honest: there is
    // nowhere for a preparation to be, so there are none.
    evidencePackages: runtime.evidence
      ? await runtime.evidence.listPreparations(auth.session.institutionId)
      : [],
  });
});

workspaceRoutes.post("/members", async (c) => {
  const runtime = runtimeOf();

  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const requested = typeof body.institutionId === "string" ? body.institutionId : undefined;
  const auth = await authenticate(c, runtime, requested);
  if (!auth.ok) return auth.response;

  if (!authorize(auth.session.role, "manageMembers")) return refuse(c, 403, "forbidden");

  const account = typeof body.account === "string" ? body.account.trim() : "";
  if (!ADDRESS.test(account)) return badRequest(c, "Alamat akun tidak sah.");
  if (!isWorkspaceRole(body.role)) return badRequest(c, "Peran ruang kerja tidak dikenal.");
  // An administrator may staff their institution, but not mint another
  // administrator: #68 requires a successor to accept the authority, and that
  // handover is ticket #77's. Until it exists, the initial administrator comes
  // from onboarding and nowhere else.
  if (body.role === "ADMIN") {
    return c.json(
      {
        success: false,
        error:
          "Administrator lembaga hanya ditetapkan lewat onboarding. Rotasi administrator memerlukan " +
          "penerimaan oleh penerusnya melalui alur serah-terima administrator.",
      },
      403
    );
  }

  const target = await runtime.store.activeMembershipFor(account);
  if (target?.institutionId === auth.session.institutionId && target.role === "ADMIN") return refuse(c, 403, "forbidden");
  try {
    // The institution written is the session's own, never the payload's.
    if (!await runtime.store.manageMember(auth.session.institutionId, auth.session.account, account, body.role, runtime.now())) return refuse(c, 403, "forbidden");
  } catch {
    return c.json(
      { success: false, error: "Akun tersebut sudah aktif pada lembaga lain. Nonaktifkan keanggotaan lamanya lebih dahulu." },
      409
    );
  }

  return c.json(
    { success: true, institutionId: auth.session.institutionId, account: normalizeAccount(account), role: body.role },
    201
  );
});

workspaceRoutes.get("/authority-history", async c => {
  const runtime = runtimeOf();
  const auth = await authenticate(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;
  return c.json({ history: await runtime.store.authorityHistory(auth.session.institutionId),
    proposal: await runtime.store.administratorProposal(auth.session.institutionId) });
});
for (const [path, action] of [["/members/revoke", "REVOKE"], ["/administrator/propose", "PROPOSE"], ["/administrator/accept", "ACCEPT"]] as const) {
  workspaceRoutes.post(path, async c => {
    const runtime = runtimeOf();
    const body = await readJson(c);
    if (!body) return badRequest(c, "JSON tidak sah.");
    const auth = await authenticate(c, runtime, typeof body.institutionId === "string" ? body.institutionId : undefined);
    if (!auth.ok) return auth.response;
    if (action !== "ACCEPT" && !authorize(auth.session.role, "manageMembers")) return refuse(c, 403, "forbidden");
    const account = action === "ACCEPT" ? auth.session.account : body.account;
    if (typeof account !== "string" || !ADDRESS.test(account)) return badRequest(c, "Alamat akun tidak sah.");
    const changed = await runtime.store.changeMembership(auth.session.institutionId, auth.session.account, account, action, runtime.now());
    if (!changed) return c.json({ error: "Perubahan ditolak. Periksa kewenangan, keanggotaan penerus dan usulan yang masih berlaku." }, 409);
    return c.json({ success: true, account, action });
  });
}

/**
 * The institutions actually onboarded on this deployment - read from the
 * database, not from the fixture list. Advertising an id that onboarding never
 * installed would offer the interface a sign-in that can only ever 404.
 */
workspaceRoutes.get("/institutions", async (c) =>
  c.json({ success: true, institutions: await runtimeOf().store.listInstitutions() })
);

export default workspaceRoutes;

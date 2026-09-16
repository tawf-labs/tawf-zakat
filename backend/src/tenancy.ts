/**
 * Institutional workspace tenancy (Spec #68, ticket #69) - who is asking, on
 * behalf of which Pengelola Zakat, and what that entitles them to.
 *
 * A pure module: no database, no clock, no network, no `viem` RPC. Every
 * decision it makes is a function of arguments handed in, which is what lets
 * the isolation rules be tested exhaustively rather than demonstrated once.
 *
 * Three ideas, deliberately kept apart:
 *
 * 1. **The challenge.** An address in a request body proves nothing - anyone
 *    can type one. So access starts with a nonce the server minted, bound to a
 *    purpose, an account and a closing time, which the account must sign. It is
 *    good once - but single use is enforced where it can actually be made
 *    atomic, by the store's conditional `UPDATE`, so this module judges only
 *    what it can see: the clock.
 * 2. **The tenant.** Which institution a caller acts for is read off their
 *    membership, never off the payload. A request naming another institution is
 *    refused outright rather than quietly re-pointed - silently honouring it
 *    would let a payload edit move ownership of evidence.
 * 3. **The capability.** A role says what may be done inside the workspace and
 *    nothing more. Recording evidence and publishing a report are the registry's
 *    to authorize onchain (ADR-0022); no capability here is a stand-in for that,
 *    so a row in this database can never substitute for a role the chain denies.
 *
 * The signing domain is this application's own. It deliberately names no
 * verifying contract, so a workspace sign-in can never be replayed as a
 * governance action against the vault (ADR-0019 keeps that domain to itself).
 */

/** What the signature is for. Carried in the signed payload, not implied by it. */
export const WORKSPACE_PURPOSE = "Masuk ruang kerja lembaga" as const;

/**
 * Its own EIP-712 domain. No `verifyingContract`: this authorizes offchain
 * workspace access, and must not collide with the vault governance domain that
 * does name one.
 */
export const WORKSPACE_EIP712_DOMAIN = {
  name: "Tawf Workspace Access",
  version: "1",
} as const;

export const WORKSPACE_EIP712_TYPES = {
  WorkspaceAccess: [
    { name: "purpose", type: "string" },
    { name: "institutionId", type: "string" },
    { name: "account", type: "address" },
    { name: "nonce", type: "bytes32" },
    { name: "issuedAt", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
  ],
} as const;

export type Address = `0x${string}`;

/** 32 bytes of hex. A nonce is not an address, and must not be typed as one. */
export type Hex32 = `0x${string}`;

/** The server-minted challenge, in the exact shape the account signs. */
export type AccessChallenge = {
  purpose: typeof WORKSPACE_PURPOSE;
  institutionId: string;
  account: Address;
  /** 32 bytes of server randomness. Single use. */
  nonce: Hex32;
  issuedAt: number;
  expiresAt: number;
};

export type WorkspaceRole = "ADMIN" | "OFFICER" | "READER";

export type Membership = {
  institutionId: string;
  account: Address;
  role: WorkspaceRole;
  isActive: boolean;
  officerId?: string | null;
};

export type Capabilities = {
  /** Open the workspace and read what the institution owns. */
  viewWorkspace: boolean;
  /** Create or change the institution's own evidence. */
  prepareEvidence: boolean;
  /** Add, change or deactivate the institution's members. */
  manageMembers: boolean;
  /**
   * Create/manage Program bantuan and Pengajuan penyaluran drafts (Spec #86,
   * ticket #89). Separate from `prepareEvidence`: preparing a report source
   * and drafting a disbursement proposal are different institutional
   * functions, even though today both happen to be granted to the same roles.
   */
  manageDisbursement: boolean;
};

export type Capability = keyof Capabilities;

const CAPABILITIES: Record<WorkspaceRole, Capabilities> = {
  ADMIN: { viewWorkspace: true, prepareEvidence: true, manageMembers: true, manageDisbursement: true },
  OFFICER: { viewWorkspace: true, prepareEvidence: true, manageMembers: false, manageDisbursement: true },
  READER: { viewWorkspace: true, prepareEvidence: false, manageMembers: false, manageDisbursement: false },
};

export const WORKSPACE_ROLES = Object.keys(CAPABILITIES) as WorkspaceRole[];

export const isWorkspaceRole = (value: unknown): value is WorkspaceRole =>
  typeof value === "string" && (WORKSPACE_ROLES as string[]).includes(value);

/** Address comparison is case-insensitive; identity must not be either. */
export const normalizeAccount = (account: string): Address =>
  account.toLowerCase() as Address;

/**
 * Mints the challenge. `ttlSeconds` must be positive: a window that never
 * closes is a signature that authorizes access forever, which is exactly the
 * material a leaked signature needs to stay useful.
 */
export function accessChallenge(input: {
  institutionId: string;
  account: string;
  nonce: string;
  issuedAt: number;
  ttlSeconds: number;
}): AccessChallenge {
  if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds <= 0) {
    throw new Error("Masa berlaku tantangan harus lebih dari nol detik.");
  }
  if (!Number.isSafeInteger(input.issuedAt)) {
    throw new Error("Waktu penerbitan tantangan tidak sah.");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.nonce)) {
    throw new Error("Nonce tantangan harus 32 byte heksadesimal.");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.account)) {
    throw new Error("Alamat akun tidak sah.");
  }
  if (input.institutionId.trim() === "") {
    throw new Error("Tantangan harus menyebut lembaga.");
  }

  return {
    purpose: WORKSPACE_PURPOSE,
    institutionId: input.institutionId,
    account: normalizeAccount(input.account),
    nonce: input.nonce.toLowerCase() as Hex32,
    issuedAt: input.issuedAt,
    expiresAt: input.issuedAt + input.ttlSeconds,
  };
}

export type ChallengeVerdict =
  | { ok: true }
  | { ok: false; reason: "expired" | "not-yet-valid" };

/**
 * Judges a presented challenge against the clock, and only the clock.
 *
 * Whether the nonce has already been spent is deliberately not asked here.
 * Single use has to be decided atomically or it is not decided at all, and the
 * only place that can be true is the store, where one conditional `UPDATE`
 * settles a race that two sequential reads would lose.
 */
export function judgeChallenge(challenge: AccessChallenge, now: number): ChallengeVerdict {
  if (now < challenge.issuedAt) return { ok: false, reason: "not-yet-valid" };
  if (now > challenge.expiresAt) return { ok: false, reason: "expired" };
  return { ok: true };
}

/**
 * Checks that a stored challenge is the thing this application mints. A row
 * whose purpose is anything else was not minted for workspace access, and the
 * binding claimed in the signed payload has to be verified, not assumed.
 */
export const bindsWorkspacePurpose = (purpose: string): boolean => purpose === WORKSPACE_PURPOSE;

export type TenantResolution =
  | { ok: true; institutionId: string; role: WorkspaceRole }
  | { ok: false; reason: "no-membership" | "membership-inactive" | "cross-institution" };

/**
 * Decides which institution the caller is acting for.
 *
 * The answer comes from the membership. A `requestedInstitutionId` is only ever
 * allowed to *agree*; when it disagrees the request is refused, because the
 * alternative - honouring the membership and ignoring the payload - would let a
 * caller believe they had written into another institution's workspace.
 */
export function resolveTenant(
  membership: Membership | null,
  request: { requestedInstitutionId: string | undefined }
): TenantResolution {
  if (!membership) return { ok: false, reason: "no-membership" };
  if (!membership.isActive) return { ok: false, reason: "membership-inactive" };
  if (
    request.requestedInstitutionId !== undefined &&
    request.requestedInstitutionId !== membership.institutionId
  ) {
    return { ok: false, reason: "cross-institution" };
  }
  return { ok: true, institutionId: membership.institutionId, role: membership.role };
}

export const capabilitiesFor = (role: WorkspaceRole): Capabilities => ({ ...CAPABILITIES[role] });

export const authorize = (role: WorkspaceRole, capability: Capability): boolean =>
  CAPABILITIES[role][capability];

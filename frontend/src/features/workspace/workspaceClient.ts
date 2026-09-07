/**
 * Talking to the workspace API (Spec #68, ticket #69).
 *
 * The sign-in is three steps and the middle one belongs to the wallet: ask the
 * server for a challenge, have the account sign it, hand it back. The address
 * alone is never sent as proof, because the server would be right to ignore it.
 *
 * Refusals arrive with a `reason` from a closed vocabulary; this module carries
 * it through untranslated so the interface can say something specific rather
 * than "gagal".
 */

import { getApiBaseUrl } from "../../lib/contracts";
import { describeRefusal, type WorkspaceRole } from "./workspaceSession";

export class WorkspaceRequestError extends Error {
  constructor(
    message: string,
    readonly reason: string | null,
    readonly status: number
  ) {
    super(message);
    this.name = "WorkspaceRequestError";
  }
}

export type Institution = {
  id: string;
  legalName: string;
  scopeUnit: string;
  scopeLevel: string;
  mandateNote: string;
  isSynthetic: boolean;
};

export type Capabilities = {
  viewWorkspace: boolean;
  prepareEvidence: boolean;
  manageMembers: boolean;
};

export type Workspace = {
  institution: Institution;
  account: string;
  role: WorkspaceRole;
  capabilities: Capabilities;
  members?: { account: string; role: WorkspaceRole }[];
  evidencePackages: unknown[];
};

export type AccessChallengeResponse = {
  challenge: { nonce: string; institutionId: string; account: string; issuedAt: number; expiresAt: number };
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, string | number>;
  };
};

async function call(path: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(`${getApiBaseUrl()}/api/workspace${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

  if (response.status === 204) return null;

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    throw new WorkspaceRequestError(`Server membalas ${response.status} tanpa isi yang bisa dibaca.`, null, response.status);
  }

  if (!response.ok || payload?.success === false) {
    const reason = typeof payload?.reason === "string" ? payload.reason : null;
    // The server's own wording wins. `describeRefusal` is the fallback for a
    // reason that arrives without one, so the two vocabularies can never drift
    // into contradicting each other in front of the person reading them.
    const message =
      (typeof payload?.error === "string" && payload.error) ||
      (reason ? describeRefusal(reason) : null) ||
      `Permintaan gagal (HTTP ${response.status}).`;
    throw new WorkspaceRequestError(message, reason, response.status);
  }

  return payload;
}

const authorized = (token: string) => ({ Authorization: `Bearer ${token}` });

export const requestAccessChallenge = (institutionId: string, account: string): Promise<AccessChallengeResponse> =>
  call("/challenge", { method: "POST", body: JSON.stringify({ institutionId, account }) });

export const exchangeSignedChallenge = (
  nonce: string,
  signature: string
): Promise<{ token: string; expiresAt: number; institutionId: string; role: WorkspaceRole }> =>
  call("/session", { method: "POST", body: JSON.stringify({ nonce, signature }) });

export const fetchWorkspace = (token: string): Promise<Workspace> =>
  call("", { headers: authorized(token) });

export const endSession = (token: string): Promise<null> =>
  call("/session", { method: "DELETE", headers: authorized(token) });

export const fetchOnboardingFixtures = (): Promise<{ institutions: Institution[] }> =>
  call("/institutions");

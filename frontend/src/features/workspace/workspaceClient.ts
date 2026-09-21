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
import type { EvidenceSummary } from "./evidenceClient";

import { WorkspaceRequestError } from "./privateRequests";
export { WorkspaceRequestError } from "./privateRequests";

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
  manageDisbursement: boolean;
};

export type OfficerProfile = {
  id: string;
  displayName: string;
  isActive: boolean;
};

export type OfficerWithAccounts = OfficerProfile & {
  accounts: { account: string; role: WorkspaceRole; isActive: boolean }[];
};

export type OperationalFunction =
  | "MANAGE_PROGRAMS"
  | "PREPARE_PROPOSALS"
  | "EXAMINE_PROPOSALS"
  | "APPROVE_DECISIONS"
  | "RECORD_REALIZATION"
  | "HANDLE_REPORT_EXAMINATION"
  | "RECORD_CONTRIBUTIONS"
  | "ENDORSE_CONTRIBUTIONS"
  | "ISSUE_CERTIFICATES"
  | "RECOVER_CERTIFICATE_CUSTODY";

export type MandateScopeType = "ALL_PROGRAMS" | "SPECIFIC_PROGRAM";

export type OperationalMandate = {
  id: string;
  institutionId: string;
  officerId: string;
  accountAddress: string | null;
  function: OperationalFunction;
  scopeType: MandateScopeType;
  programId: string | null;
  validFrom: number;
  validUntil: number;
  assignmentRef: string;
  nominalLimit: string | null;
  version: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
};

export type InstitutionalEndorsementAccount = {
  id: string;
  institutionId: string;
  accountAddress: string;
  label: string;
  authorizedOfficerIds: string[];
  version: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
};

export type Workspace = {
  institution: Institution;
  account: string;
  role: WorkspaceRole;
  officer: OfficerProfile | null;
  mandates?: OperationalMandate[];
  endorsementAccounts?: InstitutionalEndorsementAccount[];
  capabilities: Capabilities;
  members?: { account: string; role: WorkspaceRole; officerId?: string | null; displayName?: string | null }[];
  evidencePackages: EvidenceSummary[];
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

export const fetchOnboardingFixtures = (): Promise<{ institutions: Institution[] }> =>
  call("/institutions");

import type { PrivateRequests } from "./privateRequests";

export async function fetchOfficers(requests: PrivateRequests): Promise<OfficerWithAccounts[]> {
  const result = await requests.json("/api/workspace/officers");
  return result.officers ?? [];
}

export async function createOfficer(
  requests: PrivateRequests,
  input: { displayName: string; id?: string; account?: string; role?: WorkspaceRole }
): Promise<OfficerProfile> {
  const result = await requests.json("/api/workspace/officers", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.officer;
}

export async function updateOfficer(
  requests: PrivateRequests,
  officerId: string,
  input: { displayName?: string; isActive?: boolean }
): Promise<OfficerProfile> {
  const result = await requests.json(`/api/workspace/officers/${encodeURIComponent(officerId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return result.officer;
}

export async function linkOfficerAccount(
  requests: PrivateRequests,
  officerId: string,
  input: { account: string; role?: WorkspaceRole }
): Promise<void> {
  await requests.json(`/api/workspace/officers/${encodeURIComponent(officerId)}/accounts`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function unlinkOfficerAccount(
  requests: PrivateRequests,
  officerId: string,
  account: string
): Promise<void> {
  await requests.json(
    `/api/workspace/officers/${encodeURIComponent(officerId)}/accounts/${encodeURIComponent(account)}`,
    { method: "DELETE" }
  );
}

export async function fetchMandates(
  requests: PrivateRequests,
  params?: { officerId?: string; activeOnly?: boolean }
): Promise<OperationalMandate[]> {
  const query = new URLSearchParams();
  if (params?.officerId) query.set("officerId", params.officerId);
  if (params?.activeOnly) query.set("activeOnly", "true");
  const qs = query.toString();
  const result = await requests.json(`/api/workspace/mandates${qs ? `?${qs}` : ""}`);
  return result.mandates ?? [];
}

export async function grantMandate(
  requests: PrivateRequests,
  input: {
    id: string;
    officerId: string;
    accountAddress?: string | null;
    function: OperationalFunction;
    scopeType: MandateScopeType;
    programId?: string | null;
    validFrom?: number;
    validUntil?: number;
    assignmentRef: string;
    nominalLimit?: string | null;
  }
): Promise<OperationalMandate> {
  const result = await requests.json("/api/workspace/mandates", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.mandate;
}

export async function updateMandate(
  requests: PrivateRequests,
  id: string,
  patch: {
    expectedVersion: number;
    scopeType?: MandateScopeType;
    programId?: string | null;
    validFrom?: number;
    validUntil?: number;
    assignmentRef?: string;
    nominalLimit?: string | null;
    isActive?: boolean;
  }
): Promise<OperationalMandate> {
  const result = await requests.json(`/api/workspace/mandates/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return result.mandate;
}

export async function revokeMandate(requests: PrivateRequests, id: string, expectedVersion: number): Promise<void> {
  await requests.json(`/api/workspace/mandates/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: JSON.stringify({ expectedVersion }),
  });
}

export async function fetchEndorsementAccounts(
  requests: PrivateRequests,
  includeInactive = false
): Promise<InstitutionalEndorsementAccount[]> {
  const result = await requests.json(
    `/api/workspace/endorsement-accounts${includeInactive ? "?includeInactive=true" : ""}`
  );
  return result.endorsementAccounts ?? [];
}

export async function registerEndorsementAccount(
  requests: PrivateRequests,
  input: {
    id: string;
    accountAddress: string;
    label: string;
    authorizedOfficerIds?: string[];
  }
): Promise<InstitutionalEndorsementAccount> {
  const result = await requests.json("/api/workspace/endorsement-accounts", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.endorsementAccount;
}

export async function updateEndorsementAccount(
  requests: PrivateRequests,
  id: string,
  patch: {
    expectedVersion: number;
    label?: string;
    authorizedOfficerIds?: string[];
    isActive?: boolean;
  }
): Promise<InstitutionalEndorsementAccount> {
  const result = await requests.json(`/api/workspace/endorsement-accounts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return result.endorsementAccount;
}

export async function revokeEndorsementAccount(requests: PrivateRequests, id: string, expectedVersion: number): Promise<void> {
  await requests.json(`/api/workspace/endorsement-accounts/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: JSON.stringify({ expectedVersion }),
  });
}



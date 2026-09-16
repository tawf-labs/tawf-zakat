import type { PrivateRequests } from "../workspace/privateRequests";

/**
 * Program bantuan and Pengajuan drafts (Spec #86, ticket #89).
 *
 * Every call goes through `PrivateRequests`, so the bearer token, the
 * `institutionId` from the session and the "context changed under you" guard
 * are all handled in one place, never re-implemented per feature.
 */

export type FundType = "ZAKAT" | "INFAK" | "SEDEKAH" | "LAINNYA";

export type Program = {
  id: string;
  institutionId: string;
  name: string;
  purpose: string;
  fundType: FundType;
  scope: string;
  referenceCeiling: string | null;
  status: "ACTIVE" | "ARCHIVED";
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export type IdentityBasis = { kind: "NIK"; value: string } | { kind: "ALTERNATIVE"; description: string };
export type Guardian = { name: string; relationship: string };

export type Beneficiary = {
  id: string;
  name: string;
  identityBasis: IdentityBasis;
  asnaf: string;
  addressOrScope: string;
  guardian: Guardian | null;
  paymentRecipient: { name: string; relation: string } | null;
};

export type AidValue =
  | { kind: "MONEY"; amountRequestedIdr: string; amountApprovedIdr: string | null }
  | { kind: "GOODS"; unit: string; quantityRequested: string; quantityApproved: string | null; valuedAmountIdr: string | null };

export type AidLine = {
  id: string;
  beneficiaryId: string;
  aidType: string;
  period: string;
  value: AidValue;
};

export type ProposalIssue = {
  scope: "proposal" | "recipient" | "aidLine";
  rowIndex: number | null;
  field: string;
  message: string;
};

export type ProposalDraft = {
  id: string;
  institutionId: string;
  programId: string | null;
  createdBy: string;
  originOfRequest: string;
  purpose: string;
  aidPeriod: { start: string; end: string } | null;
  personInCharge: string;
  beneficiaries: Beneficiary[];
  aidLines: AidLine[];
  issues: ProposalIssue[];
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type ProposalTotals = {
  uniqueBeneficiaryCount: number;
  aidLineCount: number;
  totalsByUnit: Record<string, string>;
  isPartial: boolean;
};

export type ProposalDraftSummary = {
  id: string;
  programId: string | null;
  originOfRequest: string;
  purpose: string;
  beneficiaryCount: number;
  issueCount: number;
  version: number;
  updatedAt: number;
};

export const listPrograms = (requests: PrivateRequests) =>
  requests.json<{ programs: Program[] }>("/api/workspace/programs").then((r) => r.programs);

export const createProgram = (
  requests: PrivateRequests,
  input: { name: string; purpose: string; fundType: FundType; scope: string; referenceCeiling: string | null }
) =>
  requests.json<{ program: Program }>("/api/workspace/programs", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((r) => r.program);

export const archiveProgram = (requests: PrivateRequests, id: string) =>
  requests.json<{ program: Program }>(`/api/workspace/programs/${id}/archive`, { method: "POST" }).then((r) => r.program);

export const listProposalDrafts = (requests: PrivateRequests, programId?: string) =>
  requests
    .json<{ drafts: ProposalDraftSummary[] }>(
      `/api/workspace/proposals${programId ? `?programId=${encodeURIComponent(programId)}` : ""}`
    )
    .then((r) => r.drafts);

export const getProposalDraft = (requests: PrivateRequests, id: string) =>
  requests.json<{ draft: ProposalDraft; summary: ProposalTotals }>(`/api/workspace/proposals/${id}`);

export type ProposalDraftInput = {
  id?: string;
  expectedVersion: number;
  operationId: string;
  programId: string | null;
  originOfRequest: string;
  purpose: string;
  aidPeriod: { start: string; end: string } | null;
  personInCharge: string;
  beneficiaries: Beneficiary[];
  aidLines: AidLine[];
};

export const saveProposalDraft = (requests: PrivateRequests, input: ProposalDraftInput) =>
  requests.json<{ draft: ProposalDraft; summary: ProposalTotals }>("/api/workspace/proposals", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const deleteProposalDraft = (requests: PrivateRequests, id: string, expectedVersion: number, operationId: string) =>
  requests.json<null>(`/api/workspace/proposals/${id}`, {
    method: "DELETE", body: JSON.stringify({ expectedVersion, operationId }),
  });

export const newBeneficiary = (): Beneficiary => ({
  id: crypto.randomUUID(),
  name: "",
  identityBasis: { kind: "NIK", value: "" },
  asnaf: "",
  addressOrScope: "",
  guardian: null,
  paymentRecipient: null,
});

export const newAidLine = (beneficiaryId: string): AidLine => ({
  id: crypto.randomUUID(),
  beneficiaryId,
  aidType: "",
  period: "",
  value: { kind: "MONEY", amountRequestedIdr: "", amountApprovedIdr: null },
});

/** An unsaved draft: `version: 0` is what the form uses to know it has never been saved. */
export const emptyProposalDraft = (program: Program): ProposalDraft => ({
  id: crypto.randomUUID(),
  institutionId: program.institutionId,
  programId: program.id,
  createdBy: "",
  originOfRequest: "",
  purpose: "",
  aidPeriod: null,
  personInCharge: "",
  beneficiaries: [],
  aidLines: [],
  issues: [],
  version: 0,
  createdAt: 0,
  updatedAt: 0,
});

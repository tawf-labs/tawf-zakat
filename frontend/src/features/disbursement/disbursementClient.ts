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

export type ProposalStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_EXAMINATION"
  | "REVISION_REQUIRED"
  | "READY_FOR_DECISION"
  | "APPROVED"
  | "WITHDRAWN";

export type ProposalDocumentCategory =
  | "PROPOSAL_LETTER"
  | "BENEFICIARY_IDENTITY"
  | "ALTERNATIVE_IDENTITY_PROOF"
  | "REPRESENTATION_PROOF"
  | "PAYMENT_RECIPIENT_PROOF"
  | "OTHER";

export type ProposalDocument = {
  id: string;
  proposalId: string;
  beneficiaryId: string | null;
  category: ProposalDocumentCategory;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  storageStatus: "STORED" | "FAILED";
  version: number;
  createdBy: string;
  createdAt: number;
};

export type DisbursementPolicy = {
  institutionId: string;
  requireProposalLetter: boolean;
  requireIdentityDoc: boolean;
  requireAlternativeIdProof: boolean;
  requireGuardianProof: boolean;
  warnRecurringAid: boolean;
  version: number;
  updatedAt: number;
  updatedBy: string;
};

export type RecurringAidWarning = {
  beneficiaryId: string;
  beneficiaryName: string;
  matchedProposalId: string;
  matchedProgramName: string;
  matchedPeriod: string;
  matchedStatus: ProposalStatus;
  message: string;
};

export type ExaminationChecklist = {
  administrativeChecksOk: boolean;
  eligibilityChecksOk: boolean;
  alternativeIdReviewed: boolean;
  recurringAidExceptions: string[];
  notes: string;
};

export type ProposalHistoryRecord = {
  id: number;
  proposalId: string;
  institutionId: string;
  version: number;
  fromStatus: ProposalStatus;
  toStatus: ProposalStatus;
  action: string;
  actorAccount: string;
  actorOfficerId: string | null;
  reason: string | null;
  notes: string | null;
  occurredAt: number;
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
  status: ProposalStatus;
  submittedAt?: number | null;
  submittedBy?: string | null;
  examinedAt?: number | null;
  examinedBy?: string | null;
  examinationNotes?: string | null;
  examinationChecklist?: ExaminationChecklist | null;
  revisionReason?: string | null;
  withdrawalReason?: string | null;
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
  status: ProposalStatus;
  submittedAt?: number | null;
  examinedAt?: number | null;
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
    method: "DELETE",
    body: JSON.stringify({ expectedVersion, operationId }),
  });

// ---------------------------------------------------------------------------
// Document Management
// ---------------------------------------------------------------------------

export const listProposalDocuments = (requests: PrivateRequests, proposalId: string, version?: number) =>
  requests
    .json<{ documents: ProposalDocument[] }>(
      `/api/workspace/proposals/${proposalId}/documents${version !== undefined ? `?version=${version}` : ""}`
    )
    .then((r) => r.documents);

export const uploadProposalDocument = (
  requests: PrivateRequests,
  proposalId: string,
  input: {
    category: ProposalDocumentCategory;
    beneficiaryId?: string | null;
    fileName: string;
    mimeType: string;
    contentBase64: string;
  }
) =>
  requests
    .json<{ document: ProposalDocument }>(`/api/workspace/proposals/${proposalId}/documents`, {
      method: "POST",
      body: JSON.stringify(input),
    })
    .then((r) => r.document);

export const deleteProposalDocument = (requests: PrivateRequests, proposalId: string, docId: string) =>
  requests.json<null>(`/api/workspace/proposals/${proposalId}/documents/${docId}`, {
    method: "DELETE",
  });

export const downloadProposalFile = (requests: PrivateRequests, proposalId: string, fileId: string, version?: number) =>
  requests.blob(`/api/workspace/proposals/${proposalId}/files/${fileId}${version !== undefined ? `?version=${version}` : ""}`);

// ---------------------------------------------------------------------------
// Lifecycle & Examination
// ---------------------------------------------------------------------------

export const submitProposalDraft = (
  requests: PrivateRequests,
  proposalId: string,
  expectedVersion: number,
  operationId: string
) =>
  requests.json<{ draft: ProposalDraft; warnings: RecurringAidWarning[] }>(
    `/api/workspace/proposals/${proposalId}/submit`,
    {
      method: "POST",
      body: JSON.stringify({ expectedVersion, operationId }),
    }
  );

export const withdrawProposal = (
  requests: PrivateRequests,
  proposalId: string,
  expectedVersion: number,
  operationId: string,
  reason: string
) =>
  requests
    .json<{ draft: ProposalDraft }>(`/api/workspace/proposals/${proposalId}/withdraw`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion, operationId, reason }),
    })
    .then((r) => r.draft);

export const startProposalExamination = (
  requests: PrivateRequests,
  proposalId: string,
  expectedVersion: number,
  operationId: string
) =>
  requests
    .json<{ draft: ProposalDraft }>(`/api/workspace/proposals/${proposalId}/start-examination`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion, operationId }),
    })
    .then((r) => r.draft);

export const returnProposalForRevision = (
  requests: PrivateRequests,
  proposalId: string,
  expectedVersion: number,
  operationId: string,
  reason: string
) =>
  requests
    .json<{ draft: ProposalDraft }>(`/api/workspace/proposals/${proposalId}/return`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion, operationId, reason }),
    })
    .then((r) => r.draft);

export const markProposalReady = (
  requests: PrivateRequests,
  proposalId: string,
  expectedVersion: number,
  operationId: string,
  checklist: ExaminationChecklist
) =>
  requests
    .json<{ draft: ProposalDraft }>(`/api/workspace/proposals/${proposalId}/ready`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion, operationId, checklist }),
    })
    .then((r) => r.draft);

// ---------------------------------------------------------------------------
// Queues, History & Policy
// ---------------------------------------------------------------------------

export const listExaminerQueue = (requests: PrivateRequests, programId?: string) =>
  requests
    .json<{ queue: ProposalDraftSummary[] }>(
      `/api/workspace/proposals/queue/examiner${programId ? `?programId=${encodeURIComponent(programId)}` : ""}`
    )
    .then((r) => r.queue);

export const listRevisionQueue = (requests: PrivateRequests) =>
  requests
    .json<{ queue: ProposalDraftSummary[] }>("/api/workspace/proposals/queue/revision")
    .then((r) => r.queue);

export const listProposalHistory = (requests: PrivateRequests, proposalId: string) =>
  requests
    .json<{ history: ProposalHistoryRecord[] }>(`/api/workspace/proposals/${proposalId}/history`)
    .then((r) => r.history);

export type ProposalVersion = {
  version: number;
  data: Pick<ProposalDraft, "programId" | "originOfRequest" | "purpose" | "aidPeriod" | "personInCharge" | "beneficiaries" | "aidLines" | "issues">;
  recurringWarnings: RecurringAidWarning[];
  examination: ExaminationChecklist | null;
};

export const getProposalVersion = (requests: PrivateRequests, proposalId: string, version: number) =>
  requests
    .json<{ version: ProposalVersion }>(`/api/workspace/proposals/${proposalId}/versions/${version}`)
    .then((r) => r.version);

export const getInstitutionPolicy = (requests: PrivateRequests) =>
  requests.json<{ policy: DisbursementPolicy }>("/api/workspace/policy").then((r) => r.policy);

export const saveInstitutionPolicy = (
  requests: PrivateRequests,
  input: Partial<DisbursementPolicy> & { expectedVersion: number }
) =>
  requests
    .json<{ policy: DisbursementPolicy }>("/api/workspace/policy", {
      method: "POST",
      body: JSON.stringify(input),
    })
    .then((r) => r.policy);

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
  status: "DRAFT",
  createdAt: 0,
  updatedAt: 0,
});

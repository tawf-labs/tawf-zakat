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

export type BeneficiaryContact = {
  phone?: string | null;
  email?: string | null;
  relation?: string | null;
};

export type Beneficiary = {
  id: string;
  name: string;
  identityBasis: IdentityBasis;
  asnaf: string;
  addressOrScope: string;
  guardian: Guardian | null;
  paymentRecipient: { name: string; relation: string } | null;
  contact?: BeneficiaryContact | null;
};

export type AidValue =
  | { kind: "MONEY"; amountRequestedIdr: string; amountApprovedIdr: string | null }
  | { kind: "GOODS"; unit: string; quantityRequested: string; quantityApproved: string | null; valuedAmountIdr: string | null; valuationBasis?: string | null };

export type AidLine = {
  id: string;
  beneficiaryId: string;
  aidType: string;
  period: string;
  value: AidValue;
  /** A note naming a supporting document; never proof that the document is stored. */
  evidenceReference?: string | null;
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
  | "REJECTED"
  | "WITHDRAWN";

export type ProposalDocumentCategory =
  | "PROPOSAL_LETTER"
  | "BENEFICIARY_IDENTITY"
  | "ALTERNATIVE_IDENTITY_PROOF"
  | "REPRESENTATION_PROOF"
  | "PAYMENT_RECIPIENT_PROOF"
  | "BENEFICIARY_ROSTER"
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
  sopRequiresMultiSignerQuorum: boolean;
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
  contact: null,
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

// ---------------------------------------------------------------------------
// Beneficiary Tabular Import & Export (Ticket #92)
// ---------------------------------------------------------------------------

export type TabularFormat = "xlsx" | "csv";

export type BeneficiaryTabularIssueCode =
  | "UNSUPPORTED_COLUMN"
  | "DUPLICATE_COLUMN"
  | "REQUIRED_FIELD_MISSING"
  | "INVALID_NIK"
  | "INVALID_IDENTITY_BASIS"
  | "INVALID_AMOUNT"
  | "INVALID_QUANTITY"
  | "INVALID_ASNAF"
  | "INVALID_AID_TYPE"
  | "MISSING_UNIT"
  | "EXACT_DUPLICATE_AID"
  | "DUPLICATE_LINE_ID"
  | "CONFLICTING_RECIPIENT"
  | "RECURRING_AID_WARNING"
  | "MISSING_GUARDIAN_RELATION"
  | "MISSING_PAYMENT_RECIPIENT_RELATION";

export type BeneficiaryTabularIssue = {
  scope: "file" | "row";
  rowNumber: number | null;
  column: string | null;
  field?: string;
  message: string;
  code: BeneficiaryTabularIssueCode;
  isWarning?: boolean;
};

/** A problem the tabular reader reports before any beneficiary rule runs. */
export type TabularFileIssue = {
  scope: "file" | "sheet" | "row" | "cell";
  rowNumber: number | null;
  column: string | null;
  message: string;
  code: string;
};

export type BeneficiaryRowPreview = {
  rowNumber: number;
  isValid: boolean;
  /** Cells keyed by template column, whatever alias the file used. */
  cells: Record<string, string>;
  issues: BeneficiaryTabularIssue[];
  beneficiary: Beneficiary | null;
  aidLine: AidLine | null;
  recipientKey: string | null;
};

export type BeneficiaryImportPreviewResult = {
  fileName: string;
  format: TabularFormat;
  /** Set when the preview was re-read from a roster kept on the proposal. */
  documentId?: string;
  sharedContext: { programName: string | null; aidPeriod: string | null };
  uniqueBeneficiaryCount: number;
  aidLineCount: number;
  validRowsCount: number;
  invalidRowsCount: number;
  totalsByUnit: Record<string, string>;
  isPartial: boolean;
  canApply: boolean;
  beneficiaries: Beneficiary[];
  aidLines: AidLine[];
  allRowsPreview: BeneficiaryRowPreview[];
  issues: BeneficiaryTabularIssue[];
  fileIssues: TabularFileIssue[];
};

export const beneficiaryTemplateFileName = (format: TabularFormat) => `tawf.beneficiary.template.v1.${format}`;

export const downloadBeneficiaryTemplate = (requests: PrivateRequests, format: TabularFormat) =>
  requests.blob(`/api/workspace/proposals/template?format=${format}`);

export const exportProposalBeneficiaries = (requests: PrivateRequests, proposalId: string, format: TabularFormat) =>
  requests.blob(`/api/workspace/proposals/${proposalId}/export?format=${format}`);

export const previewBeneficiaryImport = (
  requests: PrivateRequests,
  body: { fileName: string; contentBase64: string; proposalId: string; programId: string | null; sharedAidPeriod: string | null }
) =>
  requests
    .json<{ preview: BeneficiaryImportPreviewResult }>("/api/workspace/proposals/import/preview", {
      method: "POST",
      body: JSON.stringify(body),
    })
    .then((r) => r.preview);

export const previewStoredBeneficiaryImport = (requests: PrivateRequests, proposalId: string, documentId: string) =>
  requests
    .json<{ preview: BeneficiaryImportPreviewResult }>(
      `/api/workspace/proposals/${proposalId}/documents/${documentId}/import-preview`
    )
    .then((r) => r.preview);

// ---------------------------------------------------------------------------
// Keputusan lembaga (ticket #93)
// ---------------------------------------------------------------------------

export type ProposalDecisionAction = "APPROVE" | "REJECT";

export type ApprovedAidLineInput = {
  id: string;
  amountApprovedIdr?: string | null;
  quantityApproved?: string | null;
};

/** The decision content the signed rights digest commits to. */
export type ProposalDecisionIntent = {
  action: ProposalDecisionAction;
  decisionReference: string;
  decisionDate: string;
  decisionDocumentId: string;
  notes: string | null;
  rejectionReason: string | null;
  approvedAidLines: ApprovedAidLineInput[];
};

export type ProposalDecisionDocument = {
  id: string;
  proposalId: string;
  proposalVersion: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  uploadedBy: string;
  createdAt: number;
};

export type ProposalDecision = {
  id: string;
  proposalId: string;
  proposalVersion: number;
  institutionId: string;
  action: ProposalDecisionAction;
  decisionReference: string;
  decisionDate: string;
  decisionDocumentId: string;
  decisionDocumentSha256: string;
  notes: string | null;
  rejectionReason: string | null;
  rightsDigest: string;
  operatorOfficerId: string;
  operatorAccount: string;
  signerAccount: string;
  mandateId: string;
  signature: string;
  createdAt: number;
};

export type DecisionReviewData = {
  draft: ProposalDraft;
  program: Program | null;
  examination: { checklist: ExaminationChecklist | null; notes: string | null };
  canDecide: boolean;
  refusalReason: string | null;
  sopQuorumHeld: boolean;
  mandate: { id: string; assignmentRef: string; nominalLimit: string | null; validUntil: number } | null;
  operator: { officerId: string; name: string; account: string };
  availableSigners: {
    personal: string;
    institutional: Array<{ id: string; accountAddress: string; label: string }>;
  };
  referenceCeilingWarning: string;
  quorumStatement: string;
  existingDecision: ProposalDecision | null;
};

export type WireTypedData = {
  domain: Record<string, unknown>;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
};

export type DecisionChallengeResponse = {
  challenge: { nonce: string; mandateId: string; signerAccount: string; rightsDigest: string; expiresAt: number };
  typedData: WireTypedData;
};

export type SubmitDecisionInput = ProposalDecisionIntent & {
  signerAccount: string;
  mandateId: string;
  nonce: string;
  signature: string;
  expectedVersion: number;
  operationId: string;
};

/** JSON carries uint256 fields as numbers; a wallet signs them as bigint. */
export function signableTypedData(typedData: WireTypedData) {
  const uints = new Set((typedData.types[typedData.primaryType] ?? []).filter((field) => field.type === "uint256").map((field) => field.name));
  const message = Object.fromEntries(
    Object.entries(typedData.message).map(([name, value]) => [name, uints.has(name) ? BigInt(value as number) : value])
  );
  return { ...typedData, message };
}

/** Reads a browser file as the base64 body the upload endpoints accept. */
export const readFileBase64 = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Berkas tidak dapat dibaca."));
    reader.readAsDataURL(file);
  });

export const uploadDecisionDocument = (
  requests: PrivateRequests,
  proposalId: string,
  input: { fileName: string; mimeType: string; contentBase64: string; expectedVersion: number }
) =>
  requests
    .json<{ document: ProposalDecisionDocument }>(`/api/workspace/proposals/${proposalId}/decision-documents`, {
      method: "POST",
      body: JSON.stringify(input),
    })
    .then((r) => r.document);

export const downloadDecisionDocument = (requests: PrivateRequests, proposalId: string, documentId: string) =>
  requests.blob(`/api/workspace/proposals/${proposalId}/decision-documents/${documentId}`);

export const getProposalDecisionReview = (requests: PrivateRequests, proposalId: string) =>
  requests.json<DecisionReviewData>(`/api/workspace/proposals/${proposalId}/decision-review`);

export const createProposalDecisionChallenge = (
  requests: PrivateRequests,
  proposalId: string,
  input: ProposalDecisionIntent & { signerAccount: string; expectedVersion: number }
) =>
  requests.json<DecisionChallengeResponse>(`/api/workspace/proposals/${proposalId}/decision-challenge`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const submitProposalDecision = (requests: PrivateRequests, proposalId: string, input: SubmitDecisionInput) =>
  requests.json<{ draft: ProposalDraft; decision: ProposalDecision }>(`/api/workspace/proposals/${proposalId}/decide`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const getProposalDecision = (requests: PrivateRequests, proposalId: string) =>
  requests.json<{ decision: ProposalDecision }>(`/api/workspace/proposals/${proposalId}/decision`);

// ---------------------------------------------------------------------------
// Realisasi Penyaluran IDR bertahap & Bukti Pembayaran (ticket #94)
// Shapes mirror backend/src/disbursement.ts; the disclaimer comes from the server response.
// ---------------------------------------------------------------------------

export type DisbursementMethod = "CASH" | "BANK_TRANSFER" | "GOODS_HANDOVER";
export type RealizationEvidenceStatus = "EVIDENCE_PENDING" | "EVIDENCE_COMPLETE";
export type ConfirmationStatus = "UNCONFIRMED" | "CONFIRMED" | "DISPUTED";
export type ConfirmationMethod = "OTP" | "BAST_EXAMINED";
export type ComplainantType = "BENEFICIARY" | "OFFICER" | "AUDITOR";
export type DisputeSubject = "RECEIPT" | "AMOUNT";
export type DisputeStatus = "OPEN" | "EXAMINED" | "RESOLVED";
export type DisputeOutcome = "EXAMINED" | "RESOLVED";
export type RealizationProgress = "NOT_REALIZED" | "PARTIALLY_REALIZED" | "FULLY_REALIZED";
export type RealizationDocumentType = "PAYMENT_PROOF" | "RECEIPT_OR_BAST" | "SUPPORTING_PHOTO";

/** Who the payment went to when it is not the beneficiary (school, hospital, vendor). Null means the beneficiary. */
export type PaymentRecipient = { name: string; relation: string };
export type EvidenceAllocation = {
  realizationId: string;
  amountIdr?: string | null;
  quantity?: string | null;
  unit?: string | null;
};

export const DISBURSEMENT_METHOD_LABELS: Record<DisbursementMethod, string> = {
  CASH: "Tunai",
  BANK_TRANSFER: "Transfer bank",
  GOODS_HANDOVER: "Penyerahan Barang",
};

export const REALIZATION_DOCUMENT_TYPE_LABELS: Record<RealizationDocumentType, string> = {
  PAYMENT_PROOF: "Bukti transfer / pembayaran",
  RECEIPT_OR_BAST: "Tanda terima / BAST",
  SUPPORTING_PHOTO: "Foto pendukung",
};

/** The evidence a method needs; a photo only supports. */
export const REQUIRED_EVIDENCE_BY_METHOD: Record<DisbursementMethod, RealizationDocumentType> = {
  BANK_TRANSFER: "PAYMENT_PROOF",
  CASH: "RECEIPT_OR_BAST",
  GOODS_HANDOVER: "RECEIPT_OR_BAST",
};

export const REALIZATION_PROGRESS_LABELS: Record<RealizationProgress, string> = {
  NOT_REALIZED: "Belum tersalur",
  PARTIALLY_REALIZED: "Tersalurkan sebagian",
  FULLY_REALIZED: "Seluruh hak tersalur",
};

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  OPEN: "Terbuka",
  EXAMINED: "Sedang diperiksa",
  RESOLVED: "Diselesaikan",
};

export const DISPUTE_SUBJECT_LABELS: Record<DisputeSubject, string> = {
  RECEIPT: "Penerimaan bantuan",
  AMOUNT: "Jumlah yang diterima",
};

export const COMPLAINANT_TYPE_LABELS: Record<ComplainantType, string> = {
  BENEFICIARY: "Penerima manfaat / perwakilan",
  OFFICER: "Petugas lembaga",
  AUDITOR: "Auditor / pengawas",
};

export type DisbursementRealization = {
  id: string;
  institutionId: string;
  proposalId: string;
  proposalVersion: number;
  aidLineId: string;
  beneficiaryId: string;
  batchGroupId: string | null;
  paymentRecipient: PaymentRecipient | null;
  method: DisbursementMethod;
  amountIdr: string | null;
  quantity?: string | null;
  unit?: string | null;
  reportedAt: number;
  recordedAt: number;
  operatorAccount: string;
  operatorOfficerId: string;
  notes: string | null;
  evidenceStatus: RealizationEvidenceStatus;
  confirmationStatus: ConfirmationStatus;
  confirmationMethod: ConfirmationMethod | null;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type RealizationLineSummary = {
  aidLineId: string;
  beneficiaryId: string;
  beneficiaryName: string;
  paymentRecipients: PaymentRecipient[];
  kind: "MONEY" | "GOODS";
  aidType: string;
  amountApprovedIdr: string | null;
  amountRealizedIdr: string | null;
  amountRemainingIdr: string | null;
  quantityApproved?: string | null;
  quantityRealized?: string | null;
  quantityRemaining?: string | null;
  unit?: string | null;
  valuedAmountIdr?: string | null;
  valuationBasis?: string | null;
  status: RealizationProgress;
  isDisputed: boolean;
};

export type RealizationUnitSummary = {
  aidType: string;
  unit: string;
  approved: string;
  realized: string;
  remaining: string;
};

export type ProposalRealizationSummary = {
  proposalId: string;
  proposalVersion: number;
  totalApprovedIdr: string;
  totalRealizedIdr: string;
  totalRemainingIdr: string;
  totalsByUnit: Record<string, RealizationUnitSummary>;
  unitSummaries: RealizationUnitSummary[];
  hasUnvaluedGoods: boolean;
  totalValuedGoodsApprovedIdr: string | null;
  approvedBeneficiaryCount: number;
  realizedBeneficiaryCount: number;
  paymentEventCount: number;
  disbursementStatus: RealizationProgress;
  evidenceCompleteness: RealizationEvidenceStatus;
  pendingEvidenceCount: number;
  completeEvidenceCount: number;
  totalPendingEvidenceIdr: string;
  confirmedCount: number;
  disputedCount: number;
  totalAdvancesIdr: string;
  totalExpensesIdr: string;
  lines: RealizationLineSummary[];
};

export type RealizationItemInput = {
  aidLineId: string;
  beneficiaryId: string;
  method: DisbursementMethod;
  amountIdr?: string | null;
  quantity?: string | null;
  unit?: string | null;
  reportedAt: number;
  paymentRecipient: PaymentRecipient | null;
  notes: string | null;
};

export type RecordRealizationInput = {
  operationId: string;
  expectedVersion: number;
  batchGroupId: string | null;
  items: RealizationItemInput[];
};

export type RealizationDocument = {
  id: string;
  proposalId: string;
  realizationId: string;
  batchGroupId: string | null;
  institutionId: string;
  documentType: RealizationDocumentType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  uploadedBy: string;
  allocations: EvidenceAllocation[];
  createdAt: number;
};

export type UploadRealizationDocumentInput = {
  operationId: string;
  documentType: RealizationDocumentType;
  fileName: string;
  mimeType: string;
  contentBase64: string;
  batchGroupId?: string | null;
  allocations: EvidenceAllocation[];
};

export type RealizationOtpChallenge = { nonce: string; expiresAt: number; contactHint: string };

export type DisputeExamination = {
  id: string;
  disputeId: string;
  outcome: DisputeOutcome;
  notes: string;
  examinerOfficerId: string;
  examinerAccount: string;
  examinedAt: number;
};

export type RealizationDispute = {
  id: string;
  proposalId: string;
  realizationId: string;
  aidLineId: string;
  institutionId: string;
  complainantType: ComplainantType;
  subject: DisputeSubject;
  reason: string;
  disputedAmountIdr: string | null;
  disputedQuantity?: string | null;
  disputedUnit?: string | null;
  status: DisputeStatus;
  recordedByOfficerId: string;
  createdAt: number;
  examinations: DisputeExamination[];
};

export type RealizationAdvance = {
  id: string;
  institutionId: string;
  proposalId: string;
  officerId: string;
  officerAccount: string;
  amountIdr: string;
  purpose: string;
  reference: string;
  accountedIdr: string;
  unaccountedIdr: string;
  issuedAt: number;
};

export type RealizationExpense = {
  id: string;
  institutionId: string;
  proposalId: string;
  advanceId: string | null;
  amountIdr: string;
  purpose: string;
  payee: string;
  documentRef: string;
  recordedByOfficerId: string;
  recordedAt: number;
};

export type IncompleteEvidenceQueueItem = {
  proposalId: string;
  purpose: string;
  pendingCount: number;
  totalPendingIdr: string | null;
  goods: Array<{ aidType: string; unit: string; quantity: string }>;
  oldestPendingReportedAt: number;
};

const realizationPath = (proposalId: string, realizationId: string) =>
  `/api/workspace/proposals/${proposalId}/realizations/${realizationId}`;

const postJson = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const recordRealizations = (requests: PrivateRequests, proposalId: string, input: RecordRealizationInput) =>
  requests.json<{ records: DisbursementRealization[]; summary: ProposalRealizationSummary; notice: string }>(
    `/api/workspace/proposals/${proposalId}/realizations`,
    postJson(input)
  );

export const getProposalRealizations = (requests: PrivateRequests, proposalId: string) =>
  requests
    .json<{ realizations: DisbursementRealization[] }>(`/api/workspace/proposals/${proposalId}/realizations`)
    .then((r) => r.realizations);

export const getProposalRealizationSummary = (requests: PrivateRequests, proposalId: string) =>
  requests.json<{ summary: ProposalRealizationSummary; notice: string }>(
    `/api/workspace/proposals/${proposalId}/realization-summary`
  );

export const uploadRealizationDocument = (
  requests: PrivateRequests,
  proposalId: string,
  realizationId: string,
  input: UploadRealizationDocumentInput
) =>
  requests.json<{ document: RealizationDocument; realizations: DisbursementRealization[] }>(
    `${realizationPath(proposalId, realizationId)}/documents`,
    postJson(input)
  );

export const listRealizationDocuments = (requests: PrivateRequests, proposalId: string) =>
  requests
    .json<{ documents: RealizationDocument[] }>(`/api/workspace/proposals/${proposalId}/realization-documents`)
    .then((r) => r.documents);

export const downloadRealizationDocument = (requests: PrivateRequests, proposalId: string, documentId: string) =>
  requests.blob(`/api/workspace/proposals/${proposalId}/realization-documents/${documentId}`);

export const issueRealizationOtp = (
  requests: PrivateRequests,
  proposalId: string,
  realizationId: string,
  recipientContact: string
) =>
  requests.json<RealizationOtpChallenge>(`${realizationPath(proposalId, realizationId)}/otp-challenge`, postJson({ recipientContact }));

export const verifyRealizationOtp = (
  requests: PrivateRequests,
  proposalId: string,
  realizationId: string,
  input: { nonce: string; otpCode: string }
) =>
  requests
    .json<{ realization: DisbursementRealization }>(`${realizationPath(proposalId, realizationId)}/otp-verify`, postJson(input))
    .then((r) => r.realization);

export const verifyBastBySecondOfficer = (
  requests: PrivateRequests,
  proposalId: string,
  realizationId: string,
  input: { notes: string }
) =>
  requests
    .json<{ realization: DisbursementRealization }>(`${realizationPath(proposalId, realizationId)}/bast-verify`, postJson(input))
    .then((r) => r.realization);

export const recordRealizationDispute = (
  requests: PrivateRequests,
  proposalId: string,
  realizationId: string,
  input: {
    operationId: string;
    complainantType: ComplainantType;
    subject: DisputeSubject;
    reason: string;
    disputedAmountIdr?: string | null;
    disputedQuantity?: string | null;
    disputedUnit?: string | null;
  }
) =>
  requests.json<{ dispute: RealizationDispute; realization: DisbursementRealization }>(
    `${realizationPath(proposalId, realizationId)}/disputes`,
    postJson(input)
  );

export const examineRealizationDispute = (
  requests: PrivateRequests,
  proposalId: string,
  realizationId: string,
  disputeId: string,
  input: { operationId: string; outcome: DisputeOutcome; notes: string }
) =>
  requests.json<{ dispute: RealizationDispute; realization: DisbursementRealization }>(
    `${realizationPath(proposalId, realizationId)}/disputes/${disputeId}/examinations`,
    postJson(input)
  );

export const listRealizationDisputes = (requests: PrivateRequests, proposalId: string, realizationId: string) =>
  requests
    .json<{ disputes: RealizationDispute[] }>(`${realizationPath(proposalId, realizationId)}/disputes`)
    .then((r) => r.disputes);

export const recordRealizationAdvance = (
  requests: PrivateRequests,
  proposalId: string,
  input: { operationId: string; amountIdr: string; purpose: string; reference: string }
) =>
  requests
    .json<{ advance: RealizationAdvance }>(`/api/workspace/proposals/${proposalId}/advances`, postJson(input))
    .then((r) => r.advance);

export const listRealizationAdvances = (requests: PrivateRequests, proposalId: string) =>
  requests
    .json<{ advances: RealizationAdvance[] }>(`/api/workspace/proposals/${proposalId}/advances`)
    .then((r) => r.advances);

export const recordRealizationExpense = (
  requests: PrivateRequests,
  proposalId: string,
  input: { operationId: string; amountIdr: string; purpose: string; payee: string; documentRef: string; advanceId: string | null }
) =>
  requests
    .json<{ expense: RealizationExpense }>(`/api/workspace/proposals/${proposalId}/expenses`, postJson(input))
    .then((r) => r.expense);

export const listRealizationExpenses = (requests: PrivateRequests, proposalId: string) =>
  requests
    .json<{ expenses: RealizationExpense[] }>(`/api/workspace/proposals/${proposalId}/expenses`)
    .then((r) => r.expenses);

export const listIncompleteEvidenceQueue = (requests: PrivateRequests) =>
  requests
    .json<{ queue: IncompleteEvidenceQueueItem[] }>(`/api/workspace/proposals/queue/incomplete-evidence`)
    .then((r) => r.queue);

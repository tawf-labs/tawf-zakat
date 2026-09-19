import type { PrivateRequests } from "../workspace/privateRequests";

/**
 * Institutional Contributions & Source Endorsement Client (Ticket #102, Spec #100).
 *
 * The types mirror `backend/src/contribution.ts` and the contribution routes, value for value.
 *
 * Rules:
 * 1. Exact nominals: IDR (minor units) & USDC (6 decimal places), never converted or merged.
 * 2. Progressive lifecycle: RECEIVED -> RECONCILED -> ENDORSED.
 * 3. Tabular preview retains broken rows with cell/row coordinates.
 * 4. Saving draft does not create received funds; commit creates RECEIVED contributions.
 * 5. Every mutation carries an operationId, so a retried request never records twice.
 */

export type CurrencyUnit = "IDR" | "USDC_6DP";

export type ContributionStatus = "RECEIVED" | "RECONCILED" | "ENDORSED" | "REJECTED";

export type SourceChannel = "BANK_TRANSFER" | "QRIS" | "CASH" | "CRYPTO_USDC" | "DIRECT" | "OTHER";

/** Jenis dana per PerBAZNAS 1/2023, as `JENIS_DANA` in the backend. */
export type JenisDana = "ZAKAT" | "FITRAH" | "INFAK_SEDEKAH" | "KURBAN" | "DSKL";

export const SOURCE_CHANNELS: { value: SourceChannel; label: string }[] = [
  { value: "BANK_TRANSFER", label: "Transfer Bank" },
  { value: "QRIS", label: "QRIS" },
  { value: "CASH", label: "Tunai" },
  { value: "CRYPTO_USDC", label: "Kripto (USDC)" },
  { value: "DIRECT", label: "Penerimaan Langsung" },
  { value: "OTHER", label: "Kanal Lainnya" },
];

export const JENIS_DANA_LIST: { value: JenisDana; label: string }[] = [
  { value: "ZAKAT", label: "Zakat Maal" },
  { value: "FITRAH", label: "Zakat Fitrah" },
  { value: "INFAK_SEDEKAH", label: "Infak / Sedekah" },
  { value: "KURBAN", label: "Kurban" },
  { value: "DSKL", label: "Dana Sosial Keagamaan Lainnya (DSKL)" },
];

/** What each status means for batch eligibility, shown next to the badge. */
export const STATUS_MEANINGS: Record<ContributionStatus, string> = {
  RECEIVED: "Dicatat, belum dicocokkan dengan bukti sumber lembaga.",
  RECONCILED: "Sudah dicocokkan dengan sumber, menunggu pengesahan pihak berwenang.",
  ENDORSED: "Disahkan pihak berwenang dan layak masuk batch kontribusi.",
  REJECTED: "Ditolak: sumber tidak terverifikasi atau tidak sah.",
};

export type ContributionRecord = {
  id: string;
  institutionId: string;
  sourceChannel: SourceChannel;
  sourceReference: string;
  currencyUnit: CurrencyUnit;
  amountExact: string;
  fundType: JenisDana;
  purpose: string;
  receivedAt: number;
  donorName: string | null;
  donorContact: string | null;
  status: ContributionStatus;
  reconciledAt: number | null;
  reconciledBy: string | null;
  reconciliationProofRef: string | null;
  reconciliationNotes: string | null;
  endorsedAt: number | null;
  endorsedBy: string | null;
  endorsementMandateId: string | null;
  endorsementNotes: string | null;
  /** Why the record is not yet batch-eligible; null once endorsed. */
  unqualifiedReason: string | null;
  /** Allocated to distribution activities (#103); absent where allocation is not configured. */
  allocatedAmount?: string;
  /** Still allocatable; zero while there is a shortfall. */
  unallocatedAmount?: string;
  /** Allocations above the recorded amount after a correction; shown, never hidden as zero. */
  shortfallAmount?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
};

export type ContributionHistory = {
  id: number;
  contributionId: string;
  institutionId: string;
  version: number;
  fromStatus: ContributionStatus;
  toStatus: ContributionStatus;
  action: string;
  actorAccount: string;
  actorOfficerId: string | null;
  reason: string | null;
  notes: string | null;
  occurredAt: number;
};

/** The stored locator never leaves the server. */
export type ContributionDocument = {
  id: string;
  contributionId: string;
  institutionId: string;
  category: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  storageStatus: "STORED" | "FAILED";
  createdBy: string;
  createdAt: number;
};

export type ContributionImportDraft = {
  id: string;
  institutionId: string;
  createdBy: string;
  fileName: string;
  currencyUnit: CurrencyUnit;
  rawRowsCount: number;
  validRowsCount: number;
  invalidRowsCount: number;
  totalValidAmount: string;
  rowsJson: string;
  issuesJson: string;
  status: "DRAFT" | "COMMITTED" | "DISCARDED";
  createdAt: number;
  updatedAt: number;
};

export type TabularIssue = {
  rowNumber: number;
  column: string | null;
  field?: string;
  code: string;
  message: string;
};

export type ContributionDraftInput = {
  id?: string;
  sourceChannel: SourceChannel;
  sourceReference: string;
  currencyUnit: CurrencyUnit;
  amountExact: string;
  fundType: JenisDana;
  purpose: string;
  receivedAt: number;
  donorName?: string | null;
  donorContact?: string | null;
};

export type TabularRow = {
  rowNumber: number;
  /** Cells as read, keyed by normalized header. */
  raw: Record<string, string>;
  isValid: boolean;
  contribution?: ContributionDraftInput;
  issues: TabularIssue[];
};

export type TabularPreview = {
  fileName: string;
  sheetName: string;
  currencyUnit: CurrencyUnit;
  totalRows: number;
  validRowsCount: number;
  invalidRowsCount: number;
  totalValidAmount: string;
  rows: TabularRow[];
  issues: TabularIssue[];
};

export type CreateContributionInput = ContributionDraftInput & { operationId: string };

export function formatNominal(amountExact: string, currencyUnit: CurrencyUnit): string {
  if (currencyUnit === "IDR") {
    try {
      const n = BigInt(amountExact);
      return `Rp ${n.toLocaleString("id-ID")}`;
    } catch {
      return `Rp ${amountExact}`;
    }
  }
  // USDC 6DP
  try {
    const raw = BigInt(amountExact);
    const whole = raw / 1_000_000n;
    const frac = (raw % 1_000_000n).toString().padStart(6, "0");
    return `${whole.toLocaleString("en-US")}.${frac} USDC`;
  } catch {
    return `${amountExact} USDC`;
  }
}

export function channelLabel(channel: SourceChannel): string {
  return SOURCE_CHANNELS.find((c) => c.value === channel)?.label ?? channel;
}

export function fundTypeLabel(fundType: JenisDana): string {
  return JENIS_DANA_LIST.find((f) => f.value === fundType)?.label ?? fundType;
}

// API methods
export async function listContributions(
  requests: PrivateRequests,
  filters?: { status?: ContributionStatus; currencyUnit?: CurrencyUnit; fundType?: JenisDana }
): Promise<ContributionRecord[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.currencyUnit) params.set("currencyUnit", filters.currencyUnit);
  if (filters?.fundType) params.set("fundType", filters.fundType);
  const q = params.toString() ? `?${params.toString()}` : "";
  const res = await requests.json<{ success: boolean; contributions: ContributionRecord[] }>(
    `/api/workspace/contributions${q}`
  );
  return res.contributions;
}

export type ContributionDetailResponse = {
  success: boolean;
  contribution: ContributionRecord;
  history: ContributionHistory[];
  documents: ContributionDocument[];
  corrections?: ContributionCorrection[];
  refunds?: ContributionRefund[];
  events?: ContributionEvent[];
  proofValidity?: { status: ProofValidity; notes: string };
};

export async function getContribution(
  requests: PrivateRequests,
  id: string
): Promise<ContributionDetailResponse> {
  return requests.json<ContributionDetailResponse>(`/api/workspace/contributions/${encodeURIComponent(id)}`);
}

export async function createContribution(
  requests: PrivateRequests,
  input: CreateContributionInput
): Promise<ContributionRecord> {
  const res = await requests.json<{ success: boolean; contribution: ContributionRecord }>(
    "/api/workspace/contributions",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
  return res.contribution;
}

export async function reconcileContribution(
  requests: PrivateRequests,
  id: string,
  input: {
    expectedVersion: number;
    proofRef: string;
    notes?: string;
    operationId: string;
  }
): Promise<ContributionRecord> {
  const res = await requests.json<{ success: boolean; contribution: ContributionRecord }>(
    `/api/workspace/contributions/${encodeURIComponent(id)}/reconcile`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
  return res.contribution;
}

/** The endorsing mandate is resolved on the server from the signed-in officer; it is not sent. */
export async function endorseContribution(
  requests: PrivateRequests,
  id: string,
  input: {
    expectedVersion: number;
    notes?: string;
    operationId: string;
  }
): Promise<ContributionRecord> {
  const res = await requests.json<{ success: boolean; contribution: ContributionRecord }>(
    `/api/workspace/contributions/${encodeURIComponent(id)}/endorse`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
  return res.contribution;
}

export async function previewTabularImport(
  requests: PrivateRequests,
  fileName: string,
  contentBase64: string,
  currencyUnit: CurrencyUnit
): Promise<TabularPreview> {
  const res = await requests.json<{ success: boolean; preview: TabularPreview }>(
    "/api/workspace/contributions/import/preview",
    {
      method: "POST",
      body: JSON.stringify({ fileName, contentBase64, currencyUnit }),
    }
  );
  return res.preview;
}

/** Sends the file itself: the server re-reads it, so rows and totals are never taken from the client. */
export async function saveImportDraft(
  requests: PrivateRequests,
  draft: {
    id?: string;
    fileName: string;
    currencyUnit: CurrencyUnit;
    contentBase64: string;
  }
): Promise<ContributionImportDraft> {
  const res = await requests.json<{ success: boolean; draft: ContributionImportDraft }>(
    "/api/workspace/contributions/import/drafts",
    {
      method: "POST",
      body: JSON.stringify(draft),
    }
  );
  return res.draft;
}

export async function listImportDrafts(
  requests: PrivateRequests
): Promise<ContributionImportDraft[]> {
  const res = await requests.json<{ success: boolean; drafts: ContributionImportDraft[] }>(
    "/api/workspace/contributions/import/drafts"
  );
  return res.drafts;
}

export async function getImportDraft(
  requests: PrivateRequests,
  id: string
): Promise<{ draft: ContributionImportDraft; rows: TabularRow[]; issues: TabularIssue[] }> {
  const res = await requests.json<{ success: boolean; draft: ContributionImportDraft }>(
    `/api/workspace/contributions/import/drafts/${encodeURIComponent(id)}`
  );
  return {
    draft: res.draft,
    rows: JSON.parse(res.draft.rowsJson || "[]") as TabularRow[],
    issues: JSON.parse(res.draft.issuesJson || "[]") as TabularIssue[],
  };
}

export async function commitImportDraft(
  requests: PrivateRequests,
  id: string,
  operationId: string
): Promise<{ committedCount: number; ignoredInvalidRows: number }> {
  return requests.json<{
    success: boolean;
    committedCount: number;
    ignoredInvalidRows: number;
  }>(`/api/workspace/contributions/import/drafts/${encodeURIComponent(id)}/commit`, {
    method: "POST",
    body: JSON.stringify({ operationId }),
  });
}

export async function discardImportDraft(requests: PrivateRequests, id: string): Promise<void> {
  await requests.json<{ success: boolean }>(
    `/api/workspace/contributions/import/drafts/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    }
  );
}

export async function uploadContributionDocument(
  requests: PrivateRequests,
  contributionId: string,
  input: {
    category: string;
    fileName: string;
    contentBase64: string;
    mimeType?: string;
  }
): Promise<ContributionDocument> {
  const res = await requests.json<{ success: boolean; document: ContributionDocument }>(
    `/api/workspace/contributions/${encodeURIComponent(contributionId)}/documents`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
  return res.document;
}

export type DonorRecoveryStatus = "PENDING" | "APPROVED" | "REJECTED";

export type DonorRecoveryRequestRecord = {
  id: string;
  contributionId: string;
  institutionId: string;
  requestedContact: string;
  requestedContactMasked: string;
  donorName: string | null;
  evidenceBasis: string;
  status: DonorRecoveryStatus;
  decisionReason: string | null;
  decidedByAccount: string | null;
  decidedByOfficerId: string | null;
  decidedAt: number | null;
  createdAt: number;
  updatedAt: number;
  contribution: {
    id: string;
    sourceReference: string;
    sourceChannel: SourceChannel;
    currencyUnit: CurrencyUnit;
    amountExact: string;
    fundType: JenisDana;
    currentContactMasked: string | null;
    currentContact: string | null;
    version: number;
    status: ContributionStatus;
  };
};

export async function listRecoveryRequests(
  requests: PrivateRequests,
  filter?: { status?: DonorRecoveryStatus }
): Promise<DonorRecoveryRequestRecord[]> {
  const query = filter?.status ? `?status=${encodeURIComponent(filter.status)}` : "";
  const res = await requests.json<{ success: boolean; requests: DonorRecoveryRequestRecord[] }>(
    `/api/workspace/contributions/recovery-requests${query}`
  );
  return res.requests;
}

export async function getRecoveryRequestDetail(
  requests: PrivateRequests,
  id: string
): Promise<DonorRecoveryRequestRecord> {
  const res = await requests.json<{ success: boolean; request: DonorRecoveryRequestRecord }>(
    `/api/workspace/contributions/recovery-requests/${encodeURIComponent(id)}`
  );
  return res.request;
}

export async function decideRecoveryRequest(
  requests: PrivateRequests,
  id: string,
  input: {
    decision: "APPROVED" | "REJECTED";
    reason: string;
    expectedContributionVersion: number;
    operationId?: string;
  }
): Promise<{ request: DonorRecoveryRequestRecord; contribution: ContributionRecord }> {
  return requests.json<{
    success: boolean;
    request: DonorRecoveryRequestRecord;
    contribution: ContributionRecord;
  }>(`/api/workspace/contributions/recovery-requests/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// Correction, Refund & Versioning API (Issue #106, Spec #100)
// ---------------------------------------------------------------------------

export type CorrectionType = "AMOUNT" | "DUPLICATE";

export type ContributionCorrection = {
  id: string;
  institutionId: string;
  contributionId: string;
  fromVersion: number;
  toVersion: number;
  correctionType: CorrectionType;
  fromAmountExact: string;
  toAmountExact: string;
  reason: string;
  sourceProofRef: string | null;
  correctedBy: string;
  correctedByOfficerId: string | null;
  correctedAt: number;
};

export type RefundStatus = "DECIDED" | "PAID";

export type ContributionRefund = {
  id: string;
  institutionId: string;
  contributionId: string;
  contributionVersion: number;
  amountExact: string;
  reason: string;
  policyBasis: string;
  status: RefundStatus;
  decidedAt: number;
  decidedBy: string;
  decidedByOfficerId: string | null;
  paymentProofRef: string | null;
  paidAt: number | null;
  paidBy: string | null;
  paidByOfficerId: string | null;
  paymentNotes: string | null;
};

export type ContributionEvent = {
  id: string;
  institutionId: string;
  contributionId: string;
  version: number;
  eventType: string;
  eventData: Record<string, unknown>;
  occurredAt: number;
  actorAccount: string;
  actorOfficerId: string | null;
};

export type ProofValidity = "CURRENT" | "SUPERSEDED" | "INVALID";

export async function correctContribution(
  requests: PrivateRequests,
  id: string,
  input: {
    expectedVersion: number;
    correctionType: CorrectionType;
    amountExact?: string;
    reason: string;
    sourceProofRef?: string;
    operationId?: string;
  }
): Promise<{ contribution: ContributionRecord; correction: ContributionCorrection }> {
  const operationId = input.operationId || crypto.randomUUID();
  return requests.json<{
    success: boolean;
    contribution: ContributionRecord;
    correction: ContributionCorrection;
  }>(`/api/workspace/contributions/${encodeURIComponent(id)}/correct`, {
    method: "POST",
    body: JSON.stringify({ ...input, operationId }),
  });
}

export async function listCorrections(
  requests: PrivateRequests,
  id: string
): Promise<ContributionCorrection[]> {
  const res = await requests.json<{ success: boolean; corrections: ContributionCorrection[] }>(
    `/api/workspace/contributions/${encodeURIComponent(id)}/corrections`
  );
  return res.corrections;
}

export async function decideRefund(
  requests: PrivateRequests,
  id: string,
  input: {
    expectedVersion: number;
    amountExact: string;
    reason: string;
    policyBasis: string;
    operationId?: string;
  }
): Promise<{ refund: ContributionRefund }> {
  const operationId = input.operationId || crypto.randomUUID();
  return requests.json<{ success: boolean; refund: ContributionRefund }>(
    `/api/workspace/contributions/${encodeURIComponent(id)}/refunds`,
    {
      method: "POST",
      body: JSON.stringify({ ...input, operationId }),
    }
  );
}

export async function payRefund(
  requests: PrivateRequests,
  id: string,
  refundId: string,
  input: {
    paymentProofRef: string;
    paidAt?: number;
    paymentNotes?: string;
    operationId?: string;
  }
): Promise<{ refund: ContributionRefund }> {
  const operationId = input.operationId || crypto.randomUUID();
  return requests.json<{ success: boolean; refund: ContributionRefund }>(
    `/api/workspace/contributions/${encodeURIComponent(id)}/refunds/${encodeURIComponent(refundId)}/pay`,
    {
      method: "POST",
      body: JSON.stringify({ ...input, operationId }),
    }
  );
}

export async function listRefunds(
  requests: PrivateRequests,
  id: string
): Promise<ContributionRefund[]> {
  const res = await requests.json<{ success: boolean; refunds: ContributionRefund[] }>(
    `/api/workspace/contributions/${encodeURIComponent(id)}/refunds`
  );
  return res.refunds;
}

export async function listContributionEvents(
  requests: PrivateRequests,
  id: string
): Promise<ContributionEvent[]> {
  const res = await requests.json<{ success: boolean; events: ContributionEvent[] }>(
    `/api/workspace/contributions/${encodeURIComponent(id)}/events`
  );
  return res.events;
}

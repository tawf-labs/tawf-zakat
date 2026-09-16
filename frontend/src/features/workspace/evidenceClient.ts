import type { PrivateRequests } from "./privateRequests";
/**
 * Talking to the evidence package API (Spec #68, ticket #70).
 *
 * Every call carries the workspace bearer requests. There is no unauthenticated
 * path here on purpose: the public summary is a different surface with a
 * different audience, and mixing them in one client is how a restricted row
 * ends up on a page that was meant to be public.
 *
 * A file is fetched as bytes rather than JSON, and never via a link the browser
 * builds itself - a bare URL carries no `Authorization` header, so it would be
 * refused, and offering it would suggest the locator alone is enough. It is not.
 */

import { WorkspaceRequestError, type SessionEnd } from "./privateRequests";
import type {
  ChainScopeView,
  ExaminationOutcome,
  FileStorageStatus,
  SourceStatus,
} from "./evidenceText";

export type WireQuantity = { amount: string; unit: "IDR" | "USDC_6DP" };

export type EvidenceSummary = {
  id: string;
  label: string;
  periodKind: string;
  periodYear: number;
  currencyUnit: string;
  outcome: ExaminationOutcome;
  commitment: string;
  createdAt: number;
  findingCount: number;
};

export type EvidenceManifest = {
  role: "CLAIM" | "SOURCE";
  label: string;
  origin: string;
  institutionId: string;
  scopeUnit: string;
  scopeLevel: string;
  fundTypes: string[];
  balanceSheet: string;
  currencyUnit: string;
  period: { kind: string; year: number };
  cutOff: string;
  format: string;
  mappingVersion: string;
  transactionDetail: string;
  note: string | null;
  /** Present only on sources the server built from indexed events (ticket #79). */
  chainScope?: ChainScopeView;
};

/** Where a row came from on chain. Absent on pasted and uploaded rows. */
export type EvidenceRowOrigin = {
  chainId: number;
  contract: string;
  txHash: string;
  logIndex: number;
  blockNumber: number | null;
  blockHash: string | null;
};

/** A record a side holds and cannot prove. It has no amount, on purpose. */
export type UnverifiedRecord = {
  side: "CLAIM" | "SOURCE";
  reference: string;
  reason: string;
};

export type EvidenceRow = {
  key: string;
  bucket: string;
  balanceSheet: string;
  amount: string;
  unit: WireQuantity["unit"];
  amilAmount: string | null;
  label: string | null;
  isDeclaredTotal: boolean;
  origin?: EvidenceRowOrigin;
};

export type EvidenceSource = {
  role: "CLAIM" | "SOURCE";
  status: SourceStatus;
  detail: string | null;
  manifest: EvidenceManifest;
  rowCount: number;
  rows: EvidenceRow[];
  unverified: UnverifiedRecord[];
};

export type EvidenceFinding = {
  ordinal: number;
  kind: string;
  key: string;
  bucket: string;
  deltaAmount: string;
  deltaUnit: WireQuantity["unit"];
  claimAmount: string | null;
  sourceAmount: string | null;
  label: string | null;
};

export type EvidenceFile = {
  id: string;
  role: "CLAIM" | "SOURCE";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string | null;
  storageStatus: FileStorageStatus;
  failureReason: string | null;
};

export type EvidencePreparation = {
  id: string;
  institutionId: string;
  label: string;
  period: { kind: string; year: number };
  currencyUnit: string;
  outcome: ExaminationOutcome;
  preparedBy: string;
  createdAt: number;
  commitment: string;
  commitmentScheme: string;
  commitmentSalt: string;
  snapshot: { coverageNotes: string[]; balanceSheetScope: string; tolerance: WireQuantity };
  result: {
    balanced: boolean;
    netDelta: WireQuantity;
    absoluteDelta: WireQuantity;
    entryCounts: { claim: number; source: number; matched: number };
  } | null;
  findings: EvidenceFinding[];
  sources: EvidenceSource[];
  files: EvidenceFile[];
  publicSummary: { coverageNotes: string[]; files: { total: number; stored: number; failed: number } };
};

export type EvidenceIssue = {
  side?: "CLAIM" | "SOURCE";
  scope: string;
  rowIndex: number | null;
  field: string;
  message: string;
};

export class EvidenceRequestError extends WorkspaceRequestError {
  constructor(message: string, status: number, readonly issues: EvidenceIssue[], reason: string | null, sessionEnd: SessionEnd | null) {
    super(message, reason, status, sessionEnd, issues);
  }
}

async function call(path: string, requests: PrivateRequests, body?: unknown): Promise<any> {
  try {
    return await requests.json(`/api/evidence${path}`, {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error instanceof WorkspaceRequestError) throw new EvidenceRequestError(error.message, error.status,
      error.issues as EvidenceIssue[], error.reason, error.sessionEnd);
    throw error;
  }
}

/** One internal source this deployment can offer, and how far it reaches. */
export type InternalSourceSide = {
  role: "CLAIM" | "SOURCE";
  label: string;
  status: SourceStatus;
  detail: string | null;
  rowCount: number | null;
  unverified: UnverifiedRecord[];
  manifest: EvidenceManifest;
};

export type InternalSourceStream = {
  stream: string;
  bucket: string;
  currencyUnit: WireQuantity["unit"];
  balanceSheetScope: string;
  available: boolean;
  reason: string | null;
  chainScope: ChainScopeView | null;
  sides: InternalSourceSide[];
  coverageNotes?: string[];
};

/**
 * What the deployment's own ledger and indexed events would contribute, read
 * before anything is frozen.
 *
 * Deliberately a separate call from preparing a package: choosing a source is a
 * decision, and it is made with the block range, the checkpoint and the
 * unexaminable records already visible.
 */
export const fetchInternalSources = (
  requests: PrivateRequests,
  period: { kind: string; year: number }
): Promise<{ streams: InternalSourceStream[] }> =>
  call(`/internal-sources?periodKind=${encodeURIComponent(period.kind)}&year=${period.year}`, requests);

export const listEvidencePreparations = (requests: PrivateRequests): Promise<{ preparations: EvidenceSummary[] }> =>
  call("", requests);

export const prepareEvidence = (requests: PrivateRequests, body: unknown): Promise<{ preparation: EvidencePreparation }> =>
  call("", requests, body);

export const fetchEvidencePreparation = (
  id: string,
  requests: PrivateRequests
): Promise<{ preparation: EvidencePreparation; commitmentVerified: boolean }> => call(`/${id}`, requests);

/**
 * Downloads a restricted document through the authorized request, then hands
 * the browser a blob. The locator is never turned into a shareable link,
 * because the server treats a locator as no evidence of authority at all.
 */
export async function downloadEvidenceFile(
  preparationId: string,
  file: EvidenceFile,
  requests: PrivateRequests
): Promise<Blob> {
  return requests.blob(`/api/evidence/${preparationId}/files/${file.id}`);
}

export type ReportFigure = { name: string; label: string; value: WireQuantity };
export type ReportReview = {
  figures: ReportFigure[];
  blockers: string[];
  limitations: string[];
  disclosure: unknown;
  policy: { id: string };
};
export type SavedReportPackage = Pick<ReportReview, "figures" | "limitations" | "disclosure" | "policy"> & {
  institutionId: string; snapshot: unknown; reconciliation: unknown;
  id: string; reportId: string; version: string; status: "DRAFT" | "FROZEN"; digest: string;
  predecessor: string | null; correctionReason: string | null;
  draft: { narrative: string; claims: { name: string; value: WireQuantity | null; statedAmount?: string }[] } | null;
  verdict: { outcome: "LOLOS" | "DITOLAK"; prerequisites: string[]; findings: { kind: string; message: string; expected?: WireQuantity; claimed?: WireQuantity }[] };
  aiUnavailable: string | null;
};
export type ChangeState = "TETAP" | "BERUBAH" | "DITAMBAHKAN" | "TIDAK_LAGI_TERSEDIA";
/** What a correction would change against the version it succeeds, before any package is saved. */
export type CorrectionReview = {
  predecessor: { id: string; reportId: string; version: string; status: string; digest: string; preparationId: string;
    snapshotCommitment: string; period: { kind: string; year: number }; predecessor: string | null;
    correctionReason: string | null; outcome: string; netDelta: WireQuantity | null; findingCount: number | null };
  samePreparation: boolean;
  sources: { role: string; state: ChangeState;
    before: Record<string, string> | null; after: Record<string, string> | null }[];
  changes: { name: string; label: string; before: WireQuantity | null; after: WireQuantity | null; state: ChangeState }[];
  findingCount: { before: number | null; after: number | null };
  netDelta: { before: WireQuantity | null; after: WireQuantity | null };
  reasonRequired: true; blockers: string[]; limitations: string[];
};
export const reviewCorrection = (id: string, predecessor: string, requests: PrivateRequests): Promise<{ correction: CorrectionReview }> =>
  call(`/${id}/reports/correction?predecessor=${encodeURIComponent(predecessor)}`, requests);
export const reviewReport = (id: string, requests: PrivateRequests): Promise<ReportReview> => call(`/${id}/reports/review`, requests);
export const listReports = (id: string, requests: PrivateRequests): Promise<{ packages: { id: string; digest: string }[] }> => call(`/${id}/reports`, requests);
export const readReport = (id: string, packageId: string, requests: PrivateRequests): Promise<{ package: SavedReportPackage }> => call(`/${id}/reports/${packageId}`, requests);
export const saveReport = (id: string, requests: PrivateRequests, input: unknown): Promise<{ package: SavedReportPackage }> => call(`/${id}/reports`, requests, input);
export const freezeReport = (id: string, packageId: string, requests: PrivateRequests): Promise<{ package: SavedReportPackage }> => call(`/${id}/reports/${packageId}/freeze`, requests, {});

export type TabularPreviewRow = {
  rowNumber: number;
  isValid: boolean;
  row: EvidenceRow | null;
  rawCells: Record<string, string>;
  issues: Array<{ field?: string; message: string }>;
};

export type TabularPreviewResult = {
  success: boolean;
  fileName: string;
  format: "xlsx" | "csv";
  totalRows: number;
  validCount: number;
  invalidCount: number;
  isPartial: boolean;
  calculableTotal: string;
  allRowsPreview: TabularPreviewRow[];
  issues: Array<{ field?: string; message: string; rowIndex?: number | null }>;
};

export type EvidenceDraftSummary = {
  id: string;
  label: string;
  periodKind: string;
  periodYear: number;
  currencyUnit: string;
  balanceSheetScope: string;
  issueCount: number;
  version: number;
  updatedAt: number;
};

/**
 * A document a draft holds, as a reader may have it.
 *
 * Name, size and hash - never the bytes and never the locator. The workbook itself
 * stays in the restricted store on the server, exactly like a frozen package's files.
 */
export type EvidenceDraftDocument = {
  role: "CLAIM" | "SOURCE";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
};

export type EvidenceDraftSource = {
  tabular?: EvidenceDraftDocument;
  manifest?: EvidenceManifest;
  previewSummary?: {
    totalRows: number;
    validCount: number;
    invalidCount: number;
    isPartial: boolean;
    calculableTotal: string;
  };
  side?: Record<string, unknown>;
};

export type StoredEvidenceDraft = {
  id: string;
  institutionId: string;
  createdBy: string;
  label: string;
  periodKind: string;
  periodYear: number;
  currencyUnit: string;
  balanceSheetScope: string;
  tolerance: string | null;
  claimData: Record<string, unknown> | null;
  sourceData: EvidenceDraftSource | null;
  files: EvidenceDraftDocument[];
  issues: EvidenceIssue[];
  version: number;
  createdAt: number;
  updatedAt: number;
};

/** What the preparation the draft belongs to says about itself. */
export type SourceScope = {
  period: { kind: string; year: number };
  currencyUnit: string;
  balanceSheetScope: string;
};

/** The name the browser saves the template under, and the version it belongs to. */
export const SOURCE_TEMPLATE_VERSION = "tawf.source.template.v1";
export const sourceTemplateFileName = (format: "xlsx" | "csv") =>
  `${SOURCE_TEMPLATE_VERSION}.${format}`;

/**
 * Downloads the versioned template through the authorized request.
 *
 * Not a bare `fetch`: a plain URL carries no `Authorization` header, and this client
 * has no unauthenticated path - the workspace accounts for who took the template
 * just as it accounts for every other call here.
 */
export async function downloadSourceTemplate(
  requests: PrivateRequests,
  format: "xlsx" | "csv"
): Promise<Blob> {
  return requests.blob(`/api/evidence/template?format=${format}`);
}

/**
 * Reads an uploaded workbook without keeping anything.
 *
 * The scope travels with the file because the preview checks the rows against the
 * preparation they are meant for; a preview against a period nobody chose would
 * answer about a different preparation.
 */
export async function previewTabularSource(
  requests: PrivateRequests,
  fileName: string,
  contentBase64: string,
  scope: SourceScope
): Promise<TabularPreviewResult> {
  return call("/preview", requests, {
    fileName,
    contentBase64,
    period: scope.period,
    currencyUnit: scope.currencyUnit,
    balanceSheetScope: scope.balanceSheetScope,
  });
}

export async function listEvidenceDrafts(
  requests: PrivateRequests
): Promise<{ drafts: EvidenceDraftSummary[] }> {
  return call("/drafts", requests);
}

/**
 * Reopens a draft, with its rows recomputed from the workbook the server holds.
 *
 * `sourcePreview` is absent when the draft has no tabular source; when it has one
 * and could not be read back, `previewUnavailable` says why rather than showing an
 * empty table as though the file were empty.
 */
export async function getEvidenceDraft(
  id: string,
  requests: PrivateRequests
): Promise<{
  draft: StoredEvidenceDraft;
  sourcePreview: TabularPreviewResult | null;
  previewUnavailable: string | null;
}> {
  return call(`/drafts/${id}`, requests);
}

/** A workbook as it leaves the browser, before the server has read anything from it. */
export type TabularUpload = { fileName: string; contentBase64: string };

/** What a save sends: the form as filled in, plus the workbook if one was picked. */
export type EvidenceDraftInput = {
  id?: string;
  label: string;
  period: { kind: string; year: number };
  currencyUnit: string;
  balanceSheetScope: string;
  claim?: Record<string, unknown> | null;
  source?: Record<string, unknown>;
  sourceTable?: TabularUpload;
  issues?: EvidenceIssue[];
};

export async function saveEvidenceDraft(
  requests: PrivateRequests,
  draft: EvidenceDraftInput
): Promise<{ draft: StoredEvidenceDraft }> {
  return call("/drafts", requests, draft);
}

export async function deleteEvidenceDraft(
  id: string,
  requests: PrivateRequests
): Promise<{ success: boolean }> {
  return requests.json(`/api/evidence/drafts/${id}`, { method: "DELETE" });
}

export async function freezeEvidenceDraft(
  id: string,
  requests: PrivateRequests
): Promise<{ preparation: EvidencePreparation }> {
  return call(`/drafts/${id}/freeze`, requests, {});
}


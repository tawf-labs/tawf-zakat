/**
 * Talking to the evidence package API (Spec #68, ticket #70).
 *
 * Every call carries the workspace bearer token. There is no unauthenticated
 * path here on purpose: the public summary is a different surface with a
 * different audience, and mixing them in one client is how a restricted row
 * ends up on a page that was meant to be public.
 *
 * A file is fetched as bytes rather than JSON, and never via a link the browser
 * builds itself - a bare URL carries no `Authorization` header, so it would be
 * refused, and offering it would suggest the locator alone is enough. It is not.
 */

import { getApiBaseUrl } from "../../lib/contracts";
import { WorkspaceRequestError } from "./workspaceClient";
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
  constructor(message: string, status: number, readonly issues: EvidenceIssue[]) {
    super(message, null, status);
  }
}

async function call(path: string, token: string, body?: unknown): Promise<any> {
  const response = await fetch(`${getApiBaseUrl()}/api/evidence${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    throw new WorkspaceRequestError(
      `Server membalas ${response.status} tanpa isi yang bisa dibaca.`,
      null,
      response.status
    );
  }

  if (!response.ok || payload?.success === false) {
    throw new EvidenceRequestError(
      (typeof payload?.error === "string" && payload.error) || `Permintaan gagal (HTTP ${response.status}).`,
      response.status,
      Array.isArray(payload?.issues) ? payload.issues : []
    );
  }
  return payload;
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
  token: string,
  period: { kind: string; year: number }
): Promise<{ streams: InternalSourceStream[] }> =>
  call(`/internal-sources?periodKind=${encodeURIComponent(period.kind)}&year=${period.year}`, token);

export const listEvidencePreparations = (token: string): Promise<{ preparations: EvidenceSummary[] }> =>
  call("", token);

export const prepareEvidence = (token: string, body: unknown): Promise<{ preparation: EvidencePreparation }> =>
  call("", token, body);

export const fetchEvidencePreparation = (
  id: string,
  token: string
): Promise<{ preparation: EvidencePreparation; commitmentVerified: boolean }> => call(`/${id}`, token);

/**
 * Downloads a restricted document through the authorized request, then hands
 * the browser a blob. The locator is never turned into a shareable link,
 * because the server treats a locator as no evidence of authority at all.
 */
export async function downloadEvidenceFile(
  preparationId: string,
  file: EvidenceFile,
  token: string
): Promise<Blob> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/evidence/${preparationId}/files/${file.id}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!response.ok) {
    let message = `Berkas tidak dapat diunduh (HTTP ${response.status}).`;
    try {
      const payload = await response.json();
      if (typeof payload?.error === "string") message = payload.error;
    } catch {
      // Keep the status-based message; an unreadable body is not a new fact.
    }
    throw new WorkspaceRequestError(message, null, response.status);
  }

  return response.blob();
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
export const reviewCorrection = (id: string, predecessor: string, token: string): Promise<{ correction: CorrectionReview }> =>
  call(`/${id}/reports/correction?predecessor=${encodeURIComponent(predecessor)}`, token);
export const reviewReport = (id: string, token: string): Promise<ReportReview> => call(`/${id}/reports/review`, token);
export const listReports = (id: string, token: string): Promise<{ packages: { id: string; digest: string }[] }> => call(`/${id}/reports`, token);
export const readReport = (id: string, packageId: string, token: string): Promise<{ package: SavedReportPackage }> => call(`/${id}/reports/${packageId}`, token);
export const saveReport = (id: string, token: string, input: unknown): Promise<{ package: SavedReportPackage }> => call(`/${id}/reports`, token, input);
export const freezeReport = (id: string, packageId: string, token: string): Promise<{ package: SavedReportPackage }> => call(`/${id}/reports/${packageId}/freeze`, token, {});

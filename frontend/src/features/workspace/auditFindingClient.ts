import { WorkspaceRequestError, type PrivateRequests } from "./privateRequests";
import type {
  AuditFinding,
  AuditFindingFileInput,
  AuditFindingQueues,
  AuditFindingScope,
  AuditFindingSeverity,
  AuditFindingTargets,
  AuditFindingView,
  AuditFindingViewerRole,
  AuditorFollowupAction,
} from "../../../../shared/audit-findings";

export type { AuditFindingQueues };

export type CreateAuditFindingInput = {
  operationId: string;
  /** The digest of the version the auditor reviewed; a different stored version is refused. */
  packageDigest: string;
  scope: AuditFindingScope;
  severity: AuditFindingSeverity;
  title: string;
  description: string;
  targets: AuditFindingTargets;
  /** Owner-only: readable by the uploading auditor alone. */
  workingPapers: AuditFindingFileInput[];
  /** Shared with the amil handling this examination. */
  sharedFiles: AuditFindingFileInput[];
};

type Mutation = { operationId: string; expectedRevision: number };
export type AmilFindingResponseInput = Mutation & { note: string; attachments: AuditFindingFileInput[] };
export type AuditorFindingFollowupInput = Mutation & {
  action: AuditorFollowupAction;
  note: string;
  workingPapers: AuditFindingFileInput[];
  sharedFiles: AuditFindingFileInput[];
};
export type NoteCorrectionInput = Mutation & { eventId: string; note: string };
export type AuditorHandoverInput = Mutation & { assignmentRef: string; note: string; toAuditor: string | null };

const base = "/api/evidence/audit-findings";
const findingPath = (id: string, tail = "") => `${base}/${encodeURIComponent(id)}${tail}`;
const packagePath = (preparationId: string, packageId: string) =>
  `/api/evidence/${encodeURIComponent(preparationId)}/reports/${encodeURIComponent(packageId)}/findings`;

async function send(requests: PrivateRequests, path: string, body: unknown): Promise<AuditFinding> {
  const result = await requests.json<{ finding: AuditFinding }>(path, { method: "POST", body: JSON.stringify(body) });
  return result.finding;
}

/**
 * Whether a failed write may have been recorded anyway. A refusal the server
 * explained (4xx) was not recorded; a network failure or server error might
 * have been, so the caller reloads and retries under the same operation id.
 */
export const outcomeUnknown = (error: unknown): boolean =>
  !(error instanceof WorkspaceRequestError) || error.status >= 500;

export async function fetchAuditQueues(requests: PrivateRequests): Promise<AuditFindingQueues> {
  return (await requests.json<{ queues: AuditFindingQueues }>(`${base}/queues`)).queues;
}

export async function fetchPackageAuditFindings(
  requests: PrivateRequests,
  preparationId: string,
  packageId: string,
): Promise<{ viewer: AuditFindingViewerRole; findings: AuditFindingView[] }> {
  const result = await requests.json<{ viewer: AuditFindingViewerRole; findings: AuditFindingView[] }>(packagePath(preparationId, packageId));
  return { viewer: result.viewer, findings: result.findings };
}

export async function fetchAuditFindingDetail(requests: PrivateRequests, findingId: string): Promise<AuditFindingView> {
  return (await requests.json<{ finding: AuditFindingView }>(findingPath(findingId))).finding;
}

export const createAuditFinding = (requests: PrivateRequests, preparationId: string, packageId: string, input: CreateAuditFindingInput) =>
  send(requests, packagePath(preparationId, packageId), input);

export const submitAmilFindingResponse = (requests: PrivateRequests, findingId: string, input: AmilFindingResponseInput) =>
  send(requests, findingPath(findingId, "/responses"), input);

export const submitAuditorFindingFollowup = (requests: PrivateRequests, findingId: string, input: AuditorFindingFollowupInput) =>
  send(requests, findingPath(findingId, "/follow-ups"), input);

export const submitNoteCorrection = (requests: PrivateRequests, findingId: string, input: NoteCorrectionInput) =>
  send(requests, findingPath(findingId, "/corrections"), input);

export const submitAuditorHandover = (requests: PrivateRequests, findingId: string, input: AuditorHandoverInput) =>
  send(requests, findingPath(findingId, "/handover"), input);

export const downloadAuditAttachment = (requests: PrivateRequests, findingId: string, attachmentId: string): Promise<Blob> =>
  requests.blob(findingPath(findingId, `/attachments/${encodeURIComponent(attachmentId)}`));

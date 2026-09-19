import type { PrivateRequests } from "./privateRequests";
import type {
  AuditFinding,
  AuditFindingQueues,
  AuditFindingScope,
  AuditFindingSeverity,
} from "../../../../shared/audit-findings";

export type CreateAuditFindingInput = {
  scope: AuditFindingScope;
  severity: AuditFindingSeverity;
  title: string;
  description: string;
  targetProposalId?: string | null;
  targetProposalVersion?: number | null;
  targetRealizationId?: string | null;
  targetDocumentId?: string | null;
  workingPapers?: Array<{
    fileName: string;
    mimeType: string;
    contentBase64: string;
  }>;
};

export type AmilFindingResponseInput = {
  note: string;
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    contentBase64: string;
  }>;
};

export type AuditorFindingFollowupInput = {
  action: "MINTA_KLARIFIKASI_LANJUTAN" | "BUTUH_KOREKSI_LAPORAN" | "SELESAI_DITUTUP";
  note: string;
  workingPapers?: Array<{
    fileName: string;
    mimeType: string;
    contentBase64: string;
  }>;
};

export async function fetchAuditQueues(requests: PrivateRequests): Promise<AuditFindingQueues> {
  const result = await requests.json<{ success: boolean; queues: AuditFindingQueues }>(
    "/api/evidence/audit-findings/queues"
  );
  return result.queues;
}

export async function fetchPackageAuditFindings(
  requests: PrivateRequests,
  preparationId: string,
  packageId: string
): Promise<AuditFinding[]> {
  const result = await requests.json<{ success: boolean; findings: AuditFinding[] }>(
    `/api/evidence/${encodeURIComponent(preparationId)}/reports/${encodeURIComponent(packageId)}/findings`
  );
  return result.findings;
}

export async function fetchAuditFindingDetail(
  requests: PrivateRequests,
  findingId: string
): Promise<AuditFinding> {
  const result = await requests.json<{ success: boolean; finding: AuditFinding }>(
    `/api/evidence/audit-findings/${encodeURIComponent(findingId)}`
  );
  return result.finding;
}

export async function createAuditFinding(
  requests: PrivateRequests,
  preparationId: string,
  packageId: string,
  input: CreateAuditFindingInput
): Promise<AuditFinding> {
  const result = await requests.json<{ success: boolean; finding: AuditFinding }>(
    `/api/evidence/${encodeURIComponent(preparationId)}/reports/${encodeURIComponent(packageId)}/findings`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
  return result.finding;
}

export async function submitAmilFindingResponse(
  requests: PrivateRequests,
  findingId: string,
  input: AmilFindingResponseInput
): Promise<AuditFinding> {
  const result = await requests.json<{ success: boolean; finding: AuditFinding }>(
    `/api/evidence/audit-findings/${encodeURIComponent(findingId)}/responses`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
  return result.finding;
}

export async function submitAuditorFindingFollowup(
  requests: PrivateRequests,
  findingId: string,
  input: AuditorFindingFollowupInput
): Promise<AuditFinding> {
  const result = await requests.json<{ success: boolean; finding: AuditFinding }>(
    `/api/evidence/audit-findings/${encodeURIComponent(findingId)}/follow-ups`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
  return result.finding;
}

export async function downloadAuditAttachment(
  requests: PrivateRequests,
  findingId: string,
  attachmentId: string
): Promise<Blob> {
  return requests.blob(
    `/api/evidence/audit-findings/${encodeURIComponent(findingId)}/attachments/${encodeURIComponent(attachmentId)}`
  );
}

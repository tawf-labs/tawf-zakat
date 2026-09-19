/**
 * Shared audit findings vocabulary, event history and queue projections (Issue #99, Spec #86 & #100).
 *
 * An audit finding binds a specific report version identity (institution, preparation,
 * packageId, packageDigest, reportId, version). It is never addressed by reportId alone.
 *
 * Findings, responses, note corrections, and follow-ups form an append-only event log.
 * The current state is projected from this log. An Amil can provide responses and private
 * attachments but cannot close a finding or overwrite prior history. Only authorized
 * auditors can set the follow-up outcome or close the finding.
 */

export const AUDIT_FINDING_SCOPES = [
  "SUMBER_DATA",
  "REALISASI",
  "DOKUMEN_BUKTI",
  "PENERIMA",
  "KEPATUHAN_SYARIAH",
  "LAINNYA",
] as const;
export type AuditFindingScope = (typeof AUDIT_FINDING_SCOPES)[number];

export const AUDIT_FINDING_SCOPE_LABELS: Record<AuditFindingScope, string> = {
  SUMBER_DATA: "Sumber data & rekonsiliasi",
  REALISASI: "Penyaluran & realisasi",
  DOKUMEN_BUKTI: "Kelengkapan dokumen & bukti",
  PENERIMA: "Daftar penerima manfaat",
  KEPATUHAN_SYARIAH: "Kepatuhan syariah & fikih zakat",
  LAINNYA: "Catatan pemeriksaan lainnya",
};

export const AUDIT_FINDING_SEVERITIES = [
  "INFO",
  "CATATAN",
  "TEMUAN_RINGAN",
  "TEMUAN_MATERIAL",
] as const;
export type AuditFindingSeverity = (typeof AUDIT_FINDING_SEVERITIES)[number];

export const AUDIT_FINDING_SEVERITY_LABELS: Record<AuditFindingSeverity, string> = {
  INFO: "Informasi",
  CATATAN: "Catatan perbaikan",
  TEMUAN_RINGAN: "Temuan ringan",
  TEMUAN_MATERIAL: "Temuan material",
};

export const AUDIT_FINDING_STATUSES = [
  "OPEN",
  "DITANGGAPI",
  "DALAM_PENELAAHAN",
  "DITINDAKLANJUTI",
  "DITUTUP_AUDITOR",
] as const;
export type AuditFindingStatus = (typeof AUDIT_FINDING_STATUSES)[number];

export const AUDIT_FINDING_STATUS_LABELS: Record<AuditFindingStatus, string> = {
  OPEN: "Menunggu tanggapan amil",
  DITANGGAPI: "Telah ditanggapi amil (perlu ditelaah)",
  DALAM_PENELAAHAN: "Sedang ditelaah auditor",
  DITINDAKLANJUTI: "Perlu perbaikan lanjutan oleh amil",
  DITUTUP_AUDITOR: "Selesai ditindaklanjuti (ditutup auditor)",
};

export const AUDIT_FINDING_EVENT_TYPES = [
  "FINDING_CREATED",
  "AMIL_RESPONSE",
  "AUDITOR_FOLLOWUP",
  "NOTE_CORRECTION",
  "AUDITOR_CLOSED",
] as const;
export type AuditFindingEventType = (typeof AUDIT_FINDING_EVENT_TYPES)[number];

export type AuditFindingAttachmentMeta = {
  id: string;
  findingId: string;
  institutionId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  isOwnerOnly: boolean;
  uploadedBy: string;
  uploaderRole: "AUDITOR" | "AMIL";
  uploadedAt: number;
};

export type AuditFindingEvent = {
  id: string;
  findingId: string;
  institutionId: string;
  eventType: AuditFindingEventType;
  actorAccount: string;
  actorOfficerId: string;
  actorRole: "AUDITOR" | "AMIL";
  actorName: string;
  note: string;
  resultingStatus: AuditFindingStatus;
  attachments: AuditFindingAttachmentMeta[];
  createdAt: number;
};

export type AuditFinding = {
  id: string;
  institutionId: string;
  preparationId: string;
  packageId: string;
  packageDigest: string;
  reportId: string;
  version: string;
  auditorAccount: string;
  auditorOfficerId: string;
  auditorName: string;
  mandateRef: string;
  scope: AuditFindingScope;
  severity: AuditFindingSeverity;
  title: string;
  description: string;
  targetProposalId: string | null;
  targetProposalVersion: number | null;
  targetRealizationId: string | null;
  targetDocumentId: string | null;
  status: AuditFindingStatus;
  createdAt: number;
  updatedAt: number;
  events?: AuditFindingEvent[];
};

export type AuditFindingQueues = {
  amilActionQueue: AuditFinding[];
  auditorReviewQueue: AuditFinding[];
};

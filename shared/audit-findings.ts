/**
 * Temuan pemeriksaan, tanggapan amil dan tindak lanjut auditor (Issue #99, Spec #86 & #100).
 *
 * A finding binds one frozen report version: institution, preparation, package,
 * digest, report id and report version. It is never addressed by report id alone.
 *
 * Everything after that binding is an append-only event log. The status, the
 * auditor currently assigned and the latest wording of every note are projected
 * from the log; nothing is overwritten. An amil answers and attaches evidence
 * but cannot close a finding. Only the assigned auditor, still holding a
 * registry mandate, sets the follow-up, and a change of auditor is itself a
 * recorded event carrying the incoming auditor's registry mandate.
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

export const AUDIT_FINDING_SEVERITIES = ["INFO", "CATATAN", "TEMUAN_RINGAN", "TEMUAN_MATERIAL"] as const;
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
  "DITINDAKLANJUTI",
  "MENUNGGU_KOREKSI_LAPORAN",
  "DITUTUP_AUDITOR",
] as const;
export type AuditFindingStatus = (typeof AUDIT_FINDING_STATUSES)[number];

export const AUDIT_FINDING_STATUS_LABELS: Record<AuditFindingStatus, string> = {
  OPEN: "Menunggu tanggapan amil",
  DITANGGAPI: "Ditanggapi amil, perlu ditelaah auditor",
  DITINDAKLANJUTI: "Auditor meminta klarifikasi lanjutan",
  MENUNGGU_KOREKSI_LAPORAN: "Menunggu versi koreksi laporan",
  DITUTUP_AUDITOR: "Ditutup auditor",
};

/** Statuses in which the amil is the party expected to act. */
export const AMIL_ACTION_STATUSES: readonly AuditFindingStatus[] = ["OPEN", "DITINDAKLANJUTI", "MENUNGGU_KOREKSI_LAPORAN"];

export const AUDITOR_FOLLOWUP_ACTIONS = ["MINTA_KLARIFIKASI_LANJUTAN", "BUTUH_KOREKSI_LAPORAN", "SELESAI_DITUTUP"] as const;
export type AuditorFollowupAction = (typeof AUDITOR_FOLLOWUP_ACTIONS)[number];

export const AUDITOR_FOLLOWUP_ACTION_LABELS: Record<AuditorFollowupAction, string> = {
  MINTA_KLARIFIKASI_LANJUTAN: "Minta klarifikasi lanjutan",
  BUTUH_KOREKSI_LAPORAN: "Butuh versi koreksi laporan",
  SELESAI_DITUTUP: "Tutup temuan",
};

/** The status each auditor follow-up leaves the finding in. */
export const STATUS_AFTER_FOLLOWUP: Record<AuditorFollowupAction, AuditFindingStatus> = {
  MINTA_KLARIFIKASI_LANJUTAN: "DITINDAKLANJUTI",
  BUTUH_KOREKSI_LAPORAN: "MENUNGGU_KOREKSI_LAPORAN",
  SELESAI_DITUTUP: "DITUTUP_AUDITOR",
};

export const AUDIT_FINDING_EVENT_TYPES = [
  "FINDING_CREATED",
  "AMIL_RESPONSE",
  "AUDITOR_FOLLOWUP",
  "AUDITOR_CLOSED",
  "NOTE_CORRECTION",
  "AUDITOR_HANDOVER",
] as const;
export type AuditFindingEventType = (typeof AUDIT_FINDING_EVENT_TYPES)[number];

export type AuditFindingActorRole = "AUDITOR" | "AMIL";

/**
 * Who may download an attachment. `OWNER_ONLY` is the uploader alone - not another
 * auditor, not an auditor who later takes over the finding. `EXAMINATION` is shared
 * with the parties of this examination: the amil holding the examination mandate and
 * the assigned auditor.
 */
/** Largest single attachment a finding event accepts. */
export const AUDIT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const AUDIT_ATTACHMENT_ACCESS = ["OWNER_ONLY", "EXAMINATION"] as const;
export type AuditAttachmentAccess = (typeof AUDIT_ATTACHMENT_ACCESS)[number];

export type AuditFindingFileInput = {
  fileName: string;
  mimeType: string;
  contentBase64: string;
};

export type AuditFindingAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  access: AuditAttachmentAccess;
  uploaderRole: AuditFindingActorRole;
  uploadedAt: number;
};

export type AuditFindingEvent = {
  id: string;
  /** 1-based position in the finding's log; the finding's revision is the last one. */
  seq: number;
  eventType: AuditFindingEventType;
  actorAccount: string;
  actorRole: AuditFindingActorRole;
  actorName: string;
  note: string;
  /** Set on NOTE_CORRECTION: the event whose note this one corrects. */
  correctsEventId: string | null;
  /** Set on FINDING_CREATED and AUDITOR_HANDOVER: who is assigned from here on. */
  assignedAuditor: string | null;
  mandateRef: string | null;
  /** Set on AUDITOR_HANDOVER: the incoming auditor's mandate as the registry recorded it. */
  assignmentRef: string | null;
  followupAction: AuditorFollowupAction | null;
  resultingStatus: AuditFindingStatus;
  /** Attachments this viewer may see. */
  attachments: AuditFindingAttachment[];
  /** Owner-only working papers of someone else: counted, never named. */
  privateAttachmentCount: number;
  createdAt: number;
};

export type AuditFindingViewerRole = "AUDITOR" | "AMIL" | "STATUS_ONLY";

export type AuditFindingPermissions = {
  respond: boolean;
  followUp: boolean;
  takeOver: boolean;
  /** Events whose note this viewer wrote and may correct. */
  correctableEventIds: string[];
};

/** A frozen report version that names this finding's version as its predecessor. */
export type AuditFindingCorrection = {
  packageId: string;
  preparationId: string;
  reportVersion: string;
  status: string;
};

/** What every workspace member may see: which version, which status, never the narrative. */
export type AuditFindingStatusView = {
  id: string;
  institutionId: string;
  preparationId: string;
  packageId: string;
  packageDigest: string;
  reportId: string;
  reportVersion: string;
  scope: AuditFindingScope;
  severity: AuditFindingSeverity;
  status: AuditFindingStatus;
  revision: number;
  createdAt: number;
  updatedAt: number;
};

export type AuditFindingTargets = {
  proposalId: string | null;
  proposalVersion: number | null;
  realizationId: string | null;
  documentId: string | null;
  disputeId: string | null;
};

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

/** Every write after creation names the revision it read, so a stale view is refused. */
type AuditFindingMutation = { operationId: string; expectedRevision: number };
export type AmilFindingResponseInput = AuditFindingMutation & { note: string; attachments: AuditFindingFileInput[] };
export type AuditorFindingFollowupInput = AuditFindingMutation & {
  action: AuditorFollowupAction;
  note: string;
  workingPapers: AuditFindingFileInput[];
  sharedFiles: AuditFindingFileInput[];
};
export type NoteCorrectionInput = AuditFindingMutation & { eventId: string; note: string };
/** The assignment basis is not typed in: it is the incoming auditor's mandate as recorded on the registry. */
export type AuditorHandoverInput = AuditFindingMutation & { note: string; toAuditor: string | null };

export type AuditFinding = AuditFindingStatusView & {
  detail: "FULL";
  title: string;
  description: string;
  createdBy: string;
  assignedAuditor: string;
  targets: AuditFindingTargets;
  events: AuditFindingEvent[];
  corrections: AuditFindingCorrection[];
  permissions: AuditFindingPermissions;
};

export type AuditFindingView = AuditFinding | (AuditFindingStatusView & { detail: "STATUS_ONLY" });

export type AuditFindingQueues = {
  viewer: AuditFindingViewerRole;
  amilActionQueue: AuditFindingView[];
  auditorReviewQueue: AuditFindingView[];
};

/**
 * What a finding does not say. Shown wherever a finding is read next to a
 * contribution proof, a distribution certificate or a report version, so one kind
 * of claim is not read as another.
 */
export const AUDIT_CLAIM_BOUNDARIES = [
  "Proof ZK kontribusi hanya membuktikan keanggotaan kontribusi dalam batch; bukan bukti penyerahan bantuan atau opini audit.",
  "NFT tahap distribusi mencatat sertifikat tahap; bukan penerbitan laporan periode dan bukan kesimpulan auditor.",
  "Status versi laporan, kelengkapan bukti, progres penyaluran dan opini audit dinilai terpisah. Penyaluran selesai tidak menghasilkan opini wajar secara otomatis.",
  "Temuan dan tanggapan tidak mengubah transaksi, snapshot, pengesahan atau atestasi yang sudah tercatat. Perbaikan sumber resmi memerlukan versi koreksi dengan pengesahan dan pemeriksaannya sendiri.",
  "Tindak lanjut di sini tidak menerbitkan atestasi onchain. Pernyataan lanjutan auditor memakai alur atestasi versi laporan.",
] as const;

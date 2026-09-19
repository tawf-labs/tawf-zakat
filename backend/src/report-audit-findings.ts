/**
 * Temuan pemeriksaan, tanggapan amil dan tindak lanjut auditor (Issue #99).
 *
 * Who may do what is decided here, and only from two sources of authority:
 *
 * - An auditor is an account the institution recorded on the evidence registry
 *   with an active mandate. Workspace membership, an ADMIN role or an officer
 *   profile never stands in for it; without a registry nothing is written as an
 *   auditor. The mandate is re-read on every write, so a revoked auditor stops.
 * - An amil answering a finding holds the HANDLE_REPORT_EXAMINATION mandate. The
 *   same person cannot hold both sides of one examination.
 *
 * Only the auditor assigned to a finding sets its follow-up. The assignment
 * starts with whoever recorded the finding and moves only through a recorded
 * handover carrying its assignment reference.
 *
 * Reading is narrower than membership. The parties of the examination read the
 * narrative, notes and shared attachments; any other workspace member reads which
 * version a finding binds and its status. Owner-only working papers are opened to
 * their uploader and nobody else, whatever else changes.
 *
 * None of this touches a transaction, snapshot, endorsement or attestation.
 */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Hex } from "viem";
import {
  AMIL_ACTION_STATUSES,
  AUDIT_FINDING_SCOPES,
  AUDIT_FINDING_SEVERITIES,
  AUDITOR_FOLLOWUP_ACTIONS,
  FOLLOWUP_RESULT,
  type AuditFindingActorRole,
  type AuditFindingEvent,
  type AuditFindingQueues,
  type AuditFindingStatus,
  type AuditFindingStatusView,
  type AuditFindingView,
  type AuditFindingViewerRole,
} from "../../shared/audit-findings";
import { EvidenceReadError, MAX_EVIDENCE_FILE_BYTES, sha256Of } from "./evidence-files";
import { operationalActor, OperationalAccessDenied } from "./operational-access";
import { createReportPackages, PackageError } from "./report-package";
import {
  AuditFindingConflict,
  type AuditOperation,
  type NewAuditFile,
  type StoredAuditFinding,
} from "./audit-finding-store";
import type { SessionRecord } from "./tenancy-store";
import type { WorkspaceRuntime } from "./workspace-runtime";

export class AuditFindingError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 503) {
    super(message);
    this.name = "AuditFindingError";
  }
}

type Session = Pick<SessionRecord, "account" | "institutionId">;

const operationId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalId = z.string().trim().min(1).max(200).nullable().default(null);
const fileInput = z.object({
  fileName: text(200),
  mimeType: text(120),
  contentBase64: z.string().min(1),
}).strict();
const files = z.array(fileInput).max(10).default([]);

const CreateInput = z.object({
  operationId,
  packageDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  scope: z.enum(AUDIT_FINDING_SCOPES),
  severity: z.enum(AUDIT_FINDING_SEVERITIES),
  title: text(200),
  description: text(5000),
  targets: z.object({
    proposalId: optionalId,
    proposalVersion: z.number().int().positive().nullable().default(null),
    realizationId: optionalId,
    documentId: optionalId,
    disputeId: optionalId,
  }).strict().default({ proposalId: null, proposalVersion: null, realizationId: null, documentId: null, disputeId: null }),
  workingPapers: files,
  sharedFiles: files,
}).strict();

const ResponseInput = z.object({ operationId, expectedRevision: z.number().int().positive(), note: text(5000), attachments: files }).strict();
const FollowupInput = z.object({
  operationId,
  expectedRevision: z.number().int().positive(),
  action: z.enum(AUDITOR_FOLLOWUP_ACTIONS),
  note: text(5000),
  workingPapers: files,
  sharedFiles: files,
}).strict();
const CorrectionInput = z.object({ operationId, expectedRevision: z.number().int().positive(), eventId: text(100), note: text(5000) }).strict();
const HandoverInput = z.object({
  operationId,
  expectedRevision: z.number().int().positive(),
  assignmentRef: text(300),
  note: text(2000),
  toAuditor: z.string().regex(/^0x[0-9a-fA-F]{40}$/).nullable().default(null),
}).strict();

function parse<T>(schema: z.ZodType<T>, raw: unknown, message: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AuditFindingError(message, 400);
  return parsed.data;
}

const requestHash = (body: unknown) => createHash("sha256").update(JSON.stringify(body)).digest("hex");

const decode = (value: string): Uint8Array => {
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value.replace(/\s/g, "")) throw new AuditFindingError("Lampiran bukan base64 yang sah.", 400);
  return new Uint8Array(bytes);
};

type Actor = { role: AuditFindingActorRole; account: string; officerId: string | null; name: string; mandateRef: string | null };

/** Current state of a finding, projected from its log. */
function project(finding: StoredAuditFinding) {
  let status: AuditFindingStatus = "OPEN";
  let assignedAuditor = finding.head.createdBy;
  for (const event of finding.events) {
    status = event.resultingStatus;
    if (event.assignedAuditor) assignedAuditor = event.assignedAuditor;
  }
  const last = finding.events[finding.events.length - 1];
  return { status, assignedAuditor, revision: finding.events.length, updatedAt: last?.createdAt ?? finding.head.createdAt };
}

export function createAuditFindingService(runtime: WorkspaceRuntime) {
  const store = runtime.auditFindings;
  if (!store || !runtime.evidence) throw new AuditFindingError("Penyimpanan temuan pemeriksaan belum tersedia.", 503);
  const packages = createReportPackages(runtime.evidence, runtime.files, runtime.reportAmilRules);

  /** The registry's answer for this account, or a refusal; never a fallback. */
  async function auditorMandate(institutionId: string, account: string): Promise<{ active: boolean; mandate: string }> {
    const chain = runtime.registry?.chain;
    if (!chain) throw new AuditFindingError("Registry kewenangan auditor belum dikonfigurasi. Temuan tidak dapat dicatat tanpa mandat auditor yang dapat diperiksa.", 503);
    try {
      const authority = await chain.auditorAuthority(institutionId, account as Hex);
      return { active: authority.active, mandate: authority.mandate };
    } catch {
      throw new AuditFindingError("Mandat auditor tidak dapat diperiksa pada registry saat ini. Coba lagi.", 503);
    }
  }

  async function amilMandate(session: Session) {
    try {
      const actor = await operationalActor(runtime, session);
      const mandate = actor.require("HANDLE_REPORT_EXAMINATION");
      return { officer: actor.officer, mandate };
    } catch (error) {
      if (error instanceof OperationalAccessDenied) return null;
      throw error;
    }
  }

  async function requireAuditor(session: Session): Promise<Actor> {
    const account = session.account.toLowerCase();
    const authority = await auditorMandate(session.institutionId, account);
    if (!authority.active) {
      throw new AuditFindingError("Akun tidak memiliki mandat auditor aktif pada registry lembaga ini. Keanggotaan ruang kerja tidak memberi hak menulis temuan.", 403);
    }
    if (await amilMandate(session)) {
      throw new AuditFindingError("Akun ini memegang mandat amil untuk pemeriksaan laporan; satu orang tidak dapat menjadi auditor dan pihak yang diperiksa sekaligus.", 403);
    }
    const officer = await runtime.store.getOfficerForAccount(account, session.institutionId);
    return { role: "AUDITOR", account, officerId: officer?.id ?? null, name: officer?.displayName || `Auditor ${account.slice(0, 10)}`, mandateRef: authority.mandate || null };
  }

  async function requireAmil(session: Session): Promise<Actor> {
    const amil = await amilMandate(session);
    if (!amil) throw new AuditFindingError("Tanggapan temuan memerlukan mandat HANDLE_REPORT_EXAMINATION (menangani pemeriksaan laporan) yang aktif.", 403);
    return {
      role: "AMIL", account: session.account.toLowerCase(), officerId: amil.officer.id,
      name: amil.officer.displayName || `Petugas ${session.account.slice(0, 10)}`, mandateRef: amil.mandate?.assignmentRef ?? null,
    };
  }

  /** Which side of the examination this reader is on; a lookup failure only narrows what they read. */
  async function viewerOf(session: Session): Promise<AuditFindingViewerRole> {
    if (await amilMandate(session)) return "AMIL";
    if (runtime.registry?.chain) {
      try {
        if ((await runtime.registry.chain.auditorAuthority(session.institutionId, session.account as Hex)).active) return "AUDITOR";
      } catch { /* Unknown authority reads as no authority. */ }
    }
    return "STATUS_ONLY";
  }

  async function storeFiles(institutionId: string, preparationId: string, actor: Actor, inputs: z.infer<typeof fileInput>[], access: NewAuditFile["access"]) {
    if (!inputs.length) return [];
    if (!runtime.files) throw new AuditFindingError("Penyimpanan berkas privat belum tersedia; lampiran tidak dapat diterima.", 503);
    const decoded = inputs.map(input => {
      const bytes = decode(input.contentBase64);
      if (bytes.byteLength === 0) throw new AuditFindingError(`Berkas ${input.fileName} kosong.`, 400);
      if (bytes.byteLength > MAX_EVIDENCE_FILE_BYTES) throw new AuditFindingError(`Berkas ${input.fileName} melebihi batas ukuran lampiran pemeriksaan.`, 400);
      return { ...input, bytes };
    });
    const stored: NewAuditFile[] = [];
    for (const file of decoded) {
      const id = `afa_${randomUUID()}`;
      let storageRef: string;
      try {
        storageRef = (await runtime.files.put({ institutionId, preparationId, fileId: id, bytes: file.bytes })).storageRef;
      } catch {
        throw new AuditFindingError(`Berkas ${file.fileName} gagal disimpan; tidak ada yang dicatat.`, 503);
      }
      stored.push({
        id, uploaderAccount: actor.account, uploaderRole: actor.role, access, fileName: file.fileName,
        mimeType: file.mimeType, sizeBytes: file.bytes.byteLength, contentSha256: sha256Of(file.bytes),
        storageRef, createdAt: runtime.now(),
      });
    }
    return stored;
  }

  function statusView(finding: StoredAuditFinding): AuditFindingStatusView {
    const { head } = finding;
    const state = project(finding);
    return {
      id: head.id, institutionId: head.institutionId, preparationId: head.preparationId, packageId: head.packageId,
      packageDigest: head.packageDigest, reportId: head.reportId, reportVersion: head.reportVersion,
      scope: head.scope, severity: head.severity, status: state.status, revision: state.revision,
      createdAt: head.createdAt, updatedAt: state.updatedAt,
    };
  }

  /** The finding as this viewer may read it. */
  async function viewFor(session: Session, viewer: AuditFindingViewerRole, finding: StoredAuditFinding): Promise<AuditFindingView> {
    if (viewer === "STATUS_ONLY") return { ...statusView(finding), detail: "STATUS_ONLY" };
    const account = session.account.toLowerCase();
    const state = project(finding);
    const assigned = viewer === "AUDITOR" && state.assignedAuditor === account;
    const closed = state.status === "DITUTUP_AUDITOR";
    const events: AuditFindingEvent[] = finding.events.map(event => {
      const own = finding.files.filter(file => file.eventId === event.id);
      const visible = own.filter(file => file.access === "EXAMINATION" || file.uploaderAccount === account);
      return {
        id: event.id, seq: event.seq, eventType: event.eventType, actorAccount: event.actorAccount, actorRole: event.actorRole,
        actorName: event.actorName, note: event.note, correctsEventId: event.correctsEventId,
        assignedAuditor: event.assignedAuditor, mandateRef: event.mandateRef, assignmentRef: event.assignmentRef,
        followupAction: event.followupAction, resultingStatus: event.resultingStatus,
        attachments: visible.map(file => ({
          id: file.id, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes,
          contentSha256: file.contentSha256, access: file.access, uploaderRole: file.uploaderRole, uploadedAt: file.createdAt,
        })),
        privateAttachmentCount: own.length - visible.length,
        createdAt: event.createdAt,
      };
    });
    const corrections = await store!.correctionsOf(session.institutionId, finding.head.packageId);
    const { head } = finding;
    return {
      ...statusView(finding),
      detail: "FULL",
      title: head.title,
      description: head.description,
      createdBy: head.createdBy,
      assignedAuditor: state.assignedAuditor,
      targets: {
        proposalId: head.targetProposalId, proposalVersion: head.targetProposalVersion,
        realizationId: head.targetRealizationId, documentId: head.targetDocumentId, disputeId: head.targetDisputeId,
      },
      events,
      corrections,
      permissions: {
        respond: viewer === "AMIL" && !closed,
        followUp: assigned && !closed,
        takeOver: viewer === "AUDITOR" && !assigned && !closed,
        correctableEventIds: finding.events
          .filter(event => event.actorAccount === account && event.eventType !== "AUDITOR_HANDOVER"
            && event.actorRole === (viewer === "AUDITOR" ? "AUDITOR" : "AMIL"))
          .map(event => event.id),
      },
    };
  }

  async function read(session: Session, findingId: string) {
    const finding = await store!.read(session.institutionId, findingId);
    if (!finding) throw new AuditFindingError("Temuan pemeriksaan tidak ditemukan.", 404);
    return finding;
  }

  const operationOf = (session: Session, id: string, body: unknown): AuditOperation =>
    ({ account: session.account.toLowerCase(), id, requestHash: requestHash(body) });

  /** Runs a write; a replayed operation returns what the first attempt produced. */
  async function write(session: Session, run: () => Promise<string | null>) {
    let findingId: string | null;
    try {
      findingId = await run();
    } catch (error) {
      if (error instanceof AuditFindingConflict) throw new AuditFindingError(error.message, 409);
      throw error;
    }
    if (!findingId) throw new AuditFindingError("Temuan pemeriksaan tidak ditemukan.", 404);
    const viewer = await viewerOf(session);
    return viewFor(session, viewer, await read(session, findingId));
  }

  /** The view an earlier attempt of this operation produced, or `null` if it never ran. */
  async function replay(session: Session, operation: AuditOperation) {
    const previous = await write(session, () => store!.previousOperation(session.institutionId, operation)).catch(error => {
      if (error instanceof AuditFindingError && error.status === 404) return null;
      throw error;
    });
    return previous;
  }

  /** An event appended by `actor`; the caller supplies what differs. */
  const eventBy = (actor: Actor, findingId: string, fields: {
    eventType: AuditFindingEvent["eventType"]; note: string; resultingStatus: AuditFindingStatus;
    assignedAuditor?: string | null; assignmentRef?: string | null; correctsEventId?: string | null;
    followupAction?: AuditFindingEvent["followupAction"];
  }) => ({
    id: `afe_${randomUUID()}`, findingId, actorAccount: actor.account, actorRole: actor.role,
    actorOfficerId: actor.officerId, actorName: actor.name, mandateRef: actor.mandateRef,
    assignedAuditor: fields.assignedAuditor ?? null, assignmentRef: fields.assignmentRef ?? null,
    correctsEventId: fields.correctsEventId ?? null, followupAction: fields.followupAction ?? null,
    eventType: fields.eventType, note: fields.note, resultingStatus: fields.resultingStatus, createdAt: runtime.now(),
  });

  const refuseClosed = (finding: StoredAuditFinding, message: string) => {
    if (project(finding).status === "DITUTUP_AUDITOR") throw new AuditFindingError(message, 409);
  };

  return {
    async createFinding(session: Session, preparationId: string, packageId: string, raw: unknown) {
      const input = parse(CreateInput, raw, "Lingkup, tingkat, uraian, digest versi, identitas operasi atau lampiran temuan tidak sah.");
      const auditor = await requireAuditor(session);
      const institutionId = session.institutionId;
      const operation = operationOf(session, input.operationId, { preparationId, packageId, input });
      const replayed = await replay(session, operation);
      if (replayed) return replayed;

      let saved: any;
      try {
        saved = await packages.read(institutionId, preparationId, packageId);
      } catch (error) {
        if (error instanceof PackageError) throw new AuditFindingError(error.status === 404 ? "Versi laporan yang diperiksa tidak ditemukan." : error.message, error.status === 404 ? 404 : 409);
        throw error;
      }
      if (saved.status !== "FROZEN") throw new AuditFindingError("Temuan hanya dapat dicatat pada versi laporan beku.", 409);
      if (saved.digest !== input.packageDigest) throw new AuditFindingError("Digest versi yang ditinjau berbeda dari versi tersimpan. Buka ulang versi laporan sebelum mencatat temuan.", 409);
      if (typeof saved.reportId !== "string" || !saved.reportId || typeof saved.version !== "string" || !saved.version) {
        throw new AuditFindingError("Versi laporan tidak memuat identitas laporan dan versi; temuan tidak dapat diikat.", 409);
      }
      const { targets } = input;
      if (targets.proposalVersion != null && !targets.proposalId) throw new AuditFindingError("Versi pengajuan memerlukan ID pengajuan.", 400);
      const missing = await store!.missingTargets(institutionId, targets);
      if (missing.length) throw new AuditFindingError(`Rujukan ${missing.join(", ")} tidak ditemukan pada lembaga ini.`, 404);

      const findingId = `af_${randomUUID()}`;
      const stored = [
        ...await storeFiles(institutionId, preparationId, auditor, input.workingPapers, "OWNER_ONLY"),
        ...await storeFiles(institutionId, preparationId, auditor, input.sharedFiles, "EXAMINATION"),
      ];
      return write(session, () => store!.create(institutionId, operation, {
        id: findingId, institutionId, preparationId, packageId, packageDigest: saved.digest,
        reportId: saved.reportId, reportVersion: saved.version, createdBy: auditor.account,
        scope: input.scope, severity: input.severity, title: input.title, description: input.description,
        targetProposalId: targets.proposalId, targetProposalVersion: targets.proposalVersion,
        targetRealizationId: targets.realizationId, targetDocumentId: targets.documentId, targetDisputeId: targets.disputeId,
        createdAt: runtime.now(),
      }, eventBy(auditor, findingId, {
        eventType: "FINDING_CREATED", note: input.description, resultingStatus: "OPEN", assignedAuditor: auditor.account,
      }), stored));
    },

    async addAmilResponse(session: Session, findingId: string, raw: unknown) {
      const input = parse(ResponseInput, raw, "Tanggapan memerlukan catatan, revisi yang dibaca dan identitas operasi.");
      const amil = await requireAmil(session);
      const operation = operationOf(session, input.operationId, { findingId, input });
      const existing = await read(session, findingId);
      const replayed = await replay(session, operation);
      if (replayed) return replayed;
      refuseClosed(existing, "Temuan ini telah ditutup auditor dan tidak dapat ditanggapi lagi.");
      const stored = await storeFiles(session.institutionId, existing.head.preparationId, amil, input.attachments, "EXAMINATION");
      return write(session, () => store!.append(session.institutionId, findingId, operation, input.expectedRevision, current => {
        refuseClosed(current, "Temuan ini telah ditutup auditor dan tidak dapat ditanggapi lagi.");
        return { event: eventBy(amil, findingId, { eventType: "AMIL_RESPONSE", note: input.note, resultingStatus: "DITANGGAPI" }), files: stored };
      }));
    },

    async addAuditorFollowup(session: Session, findingId: string, raw: unknown) {
      const input = parse(FollowupInput, raw, "Tindak lanjut memerlukan aksi yang dikenal, catatan, revisi yang dibaca dan identitas operasi.");
      const auditor = await requireAuditor(session);
      const operation = operationOf(session, input.operationId, { findingId, input });
      const existing = await read(session, findingId);
      const replayed = await replay(session, operation);
      if (replayed) return replayed;
      const onlyAssigned = (finding: StoredAuditFinding) => {
        if (project(finding).assignedAuditor !== auditor.account) {
          throw new AuditFindingError("Hanya auditor yang ditugaskan pada temuan ini yang dapat menetapkan tindak lanjut. Pergantian auditor dicatat melalui serah terima penugasan.", 403);
        }
        refuseClosed(finding, "Temuan ini telah ditutup auditor; riwayatnya tidak dibuka kembali.");
      };
      onlyAssigned(existing);
      const stored = [
        ...await storeFiles(session.institutionId, existing.head.preparationId, auditor, input.workingPapers, "OWNER_ONLY"),
        ...await storeFiles(session.institutionId, existing.head.preparationId, auditor, input.sharedFiles, "EXAMINATION"),
      ];
      return write(session, () => store!.append(session.institutionId, findingId, operation, input.expectedRevision, current => {
        onlyAssigned(current);
        return {
          event: eventBy(auditor, findingId, {
            eventType: input.action === "SELESAI_DITUTUP" ? "AUDITOR_CLOSED" : "AUDITOR_FOLLOWUP",
            note: input.note, resultingStatus: FOLLOWUP_RESULT[input.action], followupAction: input.action,
          }),
          files: stored,
        };
      }));
    },

    /** A later note that corrects an earlier one by the same author; the earlier note stays readable. */
    async correctNote(session: Session, findingId: string, raw: unknown) {
      const input = parse(CorrectionInput, raw, "Koreksi catatan memerlukan catatan yang dikoreksi, isi baru, revisi yang dibaca dan identitas operasi.");
      const existing = await read(session, findingId);
      const target = existing.events.find(event => event.id === input.eventId);
      if (!target) throw new AuditFindingError("Catatan yang dikoreksi tidak ada pada temuan ini.", 404);
      if (target.actorAccount !== session.account.toLowerCase() || target.eventType === "AUDITOR_HANDOVER") {
        throw new AuditFindingError("Catatan hanya dapat dikoreksi oleh penulisnya; catatan pihak lain tidak dapat ditimpa.", 403);
      }
      const actor = target.actorRole === "AUDITOR" ? await requireAuditor(session) : await requireAmil(session);
      const operation = operationOf(session, input.operationId, { findingId, input });
      return write(session, () => store!.append(session.institutionId, findingId, operation, input.expectedRevision, current => ({
        event: eventBy(actor, findingId, {
          eventType: "NOTE_CORRECTION", note: input.note, resultingStatus: project(current).status, correctsEventId: target.id,
        }),
        files: [],
      })));
    },

    /**
     * A recorded change of the assigned auditor. The assigned auditor may hand the
     * finding to another auditor holding a mandate; anyone else holding a mandate may
     * take it over only once the assigned auditor's mandate is no longer active.
     */
    async handover(session: Session, findingId: string, raw: unknown) {
      const input = parse(HandoverInput, raw, "Serah terima memerlukan dasar penugasan, catatan, revisi yang dibaca dan identitas operasi.");
      const actor = await requireAuditor(session);
      const existing = await read(session, findingId);
      refuseClosed(existing, "Temuan yang telah ditutup tidak diserahterimakan.");
      const assigned = project(existing).assignedAuditor;
      let incoming: string;
      if (assigned === actor.account) {
        if (!input.toAuditor || input.toAuditor.toLowerCase() === actor.account) throw new AuditFindingError("Sebutkan akun auditor penerima serah terima.", 400);
        incoming = input.toAuditor.toLowerCase();
        if (!(await auditorMandate(session.institutionId, incoming)).active) {
          throw new AuditFindingError("Akun penerima tidak memiliki mandat auditor aktif pada registry lembaga ini.", 409);
        }
      } else {
        if (input.toAuditor && input.toAuditor.toLowerCase() !== actor.account) {
          throw new AuditFindingError("Hanya auditor yang ditugaskan yang dapat menyerahkan temuan kepada orang lain.", 403);
        }
        if ((await auditorMandate(session.institutionId, assigned)).active) {
          throw new AuditFindingError("Auditor yang ditugaskan masih memegang mandat aktif. Serah terima dicatat oleh auditor tersebut.", 403);
        }
        incoming = actor.account;
      }
      const operation = operationOf(session, input.operationId, { findingId, input });
      return write(session, () => store!.append(session.institutionId, findingId, operation, input.expectedRevision, current => {
        if (project(current).assignedAuditor !== assigned) throw new AuditFindingConflict("Penugasan temuan telah berubah. Muat ulang riwayatnya.");
        refuseClosed(current, "Temuan yang telah ditutup tidak diserahterimakan.");
        return {
          event: eventBy(actor, findingId, {
            eventType: "AUDITOR_HANDOVER", note: input.note, resultingStatus: project(current).status,
            assignedAuditor: incoming, assignmentRef: input.assignmentRef,
          }),
          files: [],
        };
      }));
    },

    async getFinding(session: Session, findingId: string) {
      const finding = await read(session, findingId);
      return viewFor(session, await viewerOf(session), finding);
    },

    async listFindingsForPackage(session: Session, packageId: string) {
      const viewer = await viewerOf(session);
      const findings = await store!.listByPackage(session.institutionId, packageId);
      return { viewer, findings: await Promise.all(findings.map(finding => viewFor(session, viewer, finding))) };
    },

    async getQueues(session: Session): Promise<AuditFindingQueues> {
      const viewer = await viewerOf(session);
      const account = session.account.toLowerCase();
      const all = await store!.listAll(session.institutionId);
      const amil = all.filter(finding => AMIL_ACTION_STATUSES.includes(project(finding).status));
      const auditor = all.filter(finding => {
        const state = project(finding);
        return state.status === "DITANGGAPI" && (viewer !== "AUDITOR" || state.assignedAuditor === account);
      });
      const views = (list: StoredAuditFinding[]) => Promise.all(list.map(finding => viewFor(session, viewer, finding)));
      return { viewer, amilActionQueue: await views(amil), auditorReviewQueue: await views(auditor) };
    },

    async readAttachment(session: Session, findingId: string, attachmentId: string) {
      const finding = await read(session, findingId);
      const file = finding.files.find(candidate => candidate.id === attachmentId);
      if (!file) throw new AuditFindingError("Lampiran tidak ditemukan.", 404);
      const account = session.account.toLowerCase();
      if (file.access === "OWNER_ONLY") {
        if (file.uploaderAccount !== account) throw new AuditFindingError("Kertas kerja auditor ini hanya dapat dibuka oleh pengunggahnya.", 403);
      } else if (file.uploaderAccount !== account) {
        const viewer = await viewerOf(session);
        const allowed = viewer === "AMIL" || (viewer === "AUDITOR" && project(finding).assignedAuditor === account);
        if (!allowed) throw new AuditFindingError("Lampiran pemeriksaan hanya dapat dibuka oleh amil yang menangani pemeriksaan dan auditor yang ditugaskan.", 403);
      }
      if (!runtime.files) throw new AuditFindingError("Penyimpanan berkas privat belum tersedia.", 503);
      let bytes: Uint8Array | null;
      try {
        bytes = await runtime.files.get(file.storageRef);
      } catch (error) {
        if (error instanceof EvidenceReadError) {
          throw new AuditFindingError(error.availability === "CORRUPT" ? "Berkas lampiran rusak dan tidak diberikan." : "Berkas lampiran belum dapat dibaca. Coba lagi.", error.availability === "CORRUPT" ? 409 : 503);
        }
        throw error;
      }
      if (!bytes) throw new AuditFindingError("Berkas lampiran tidak lagi tersedia di penyimpanan.", 404);
      if (bytes.byteLength !== file.sizeBytes || sha256Of(bytes) !== file.contentSha256) {
        throw new AuditFindingError("Integritas berkas gagal: isi tidak cocok dengan hash yang tercatat. Berkas tidak diberikan.", 409);
      }
      return { fileName: file.fileName, mimeType: file.mimeType, bytes };
    },
  };
}

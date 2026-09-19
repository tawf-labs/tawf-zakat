import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Hex } from "viem";
import {
  AUDIT_FINDING_SCOPES,
  AUDIT_FINDING_SEVERITIES,
  AUDIT_FINDING_STATUSES,
  type AuditFinding,
  type AuditFindingAttachmentMeta,
  type AuditFindingEvent,
  type AuditFindingQueues,
  type AuditFindingScope,
  type AuditFindingSeverity,
  type AuditFindingStatus,
} from "../../shared/audit-findings";
import { MAX_EVIDENCE_FILE_BYTES } from "./evidence-files";
import { operationalActor, OperationalAccessDenied } from "./operational-access";
import type { WorkspaceRuntime } from "./workspace-runtime";
import type { SessionRecord } from "./tenancy-store";

export class AuditFindingError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 403 | 404 | 409 | 503) {
    super(message);
    this.name = "AuditFindingError";
  }
}

export type CreateFindingInput = {
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

export type AmilResponseInput = {
  note: string;
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    contentBase64: string;
  }>;
};

export type AuditorFollowupInput = {
  action: "MINTA_KLARIFIKASI_LANJUTAN" | "BUTUH_KOREKSI_LAPORAN" | "SELESAI_DITUTUP";
  note: string;
  workingPapers?: Array<{
    fileName: string;
    mimeType: string;
    contentBase64: string;
  }>;
};

const rowsOf = (result: any): any[] =>
  Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];

const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const decodeBase64 = (str: string): Uint8Array => {
  try {
    return new Uint8Array(Buffer.from(str, "base64"));
  } catch {
    throw new AuditFindingError("Format konten berkas Base64 tidak sah.", 400);
  }
};

export function createAuditFindingService(runtime: WorkspaceRuntime) {
  const db = (runtime.evidence as any)?.db || (runtime.store as any)?.db;

  if (!runtime.evidence) {
    throw new AuditFindingError("Modul evidence store belum dikonfigurasi.", 503);
  }

  async function checkAuditorAuthority(
    institutionId: string,
    account: string,
  ): Promise<{ officerId: string; name: string; mandateRef: string }> {
    const normAccount = account.toLowerCase();
    const membership = await runtime.store.activeMembershipFor(normAccount);
    if (!membership || membership.institutionId !== institutionId) {
      throw new AuditFindingError("Akun bukan anggota lembaga ini.", 403);
    }
    if (membership.role === "READER") {
      throw new AuditFindingError("Akun pembaca biasa tidak dapat menulis temuan sebagai auditor.", 403);
    }

    const officer = await runtime.store.getOfficerForAccount(normAccount, institutionId);
    if (officer) {
      const amilMandates = await runtime.store.activeMandatesForOfficer(institutionId, officer.id, runtime.now());
      if (amilMandates.some(m => m.function === "HANDLE_REPORT_EXAMINATION")) {
        throw new AuditFindingError("Petugas amil yang menangani pemeriksaan tidak dapat bertindak sebagai auditor.", 403);
      }
    }

    let mandateRef = "Penugasan auditor independen";
    if (runtime.registry?.chain) {
      const auth = await runtime.registry.chain.auditorAuthority(institutionId, normAccount as Hex);
      if (!auth.active) {
        throw new AuditFindingError("Akun tidak memiliki mandat auditor yang sah pada registry lembaga ini.", 403);
      }
      mandateRef = auth.mandate || mandateRef;
    }

    return {
      officerId: officer?.id || `auditor-${normAccount.slice(2, 10)}`,
      name: officer?.displayName || `Auditor ${normAccount.slice(0, 8)}`,
      mandateRef,
    };
  }

  async function checkAmilAuthority(
    session: Pick<SessionRecord, "account" | "institutionId">,
  ): Promise<{ officerId: string; name: string }> {
    try {
      const actor = await operationalActor(runtime, session);
      actor.require("HANDLE_REPORT_EXAMINATION");
      return {
        officerId: actor.officer.id,
        name: actor.officer.displayName || `Petugas ${session.account.slice(0, 8)}`,
      };
    } catch (error) {
      if (error instanceof OperationalAccessDenied) {
        throw new AuditFindingError(`Wewenang ditolak: ${error.message}`, 403);
      }
      throw error;
    }
  }

  return {
    async createFinding(
      session: Pick<SessionRecord, "account" | "institutionId">,
      preparationId: string,
      packageId: string,
      input: CreateFindingInput,
    ): Promise<AuditFinding> {
      const institutionId = session.institutionId;
      const auditor = await checkAuditorAuthority(institutionId, session.account);

      if (!AUDIT_FINDING_SCOPES.includes(input.scope)) {
        throw new AuditFindingError(`Lingkup temuan tidak sah: ${input.scope}`, 400);
      }
      if (!AUDIT_FINDING_SEVERITIES.includes(input.severity)) {
        throw new AuditFindingError(`Tingkat temuan tidak sah: ${input.severity}`, 400);
      }
      if (!input.title || typeof input.title !== "string" || !input.title.trim()) {
        throw new AuditFindingError("Judul temuan wajib diisi.", 400);
      }
      if (!input.description || typeof input.description !== "string" || !input.description.trim()) {
        throw new AuditFindingError("Deskripsi temuan wajib diisi.", 400);
      }

      const pkg = await runtime.evidence!.getReportPackage(institutionId, preparationId, packageId);
      if (!pkg) {
        throw new AuditFindingError("Paket laporan yang diperiksa tidak ditemukan.", 404);
      }
      const prep = await runtime.evidence!.getPreparation(institutionId, preparationId);
      if (!prep) {
        throw new AuditFindingError("Snapshot persiapan bukti tidak ditemukan.", 404);
      }

      let parsedPackage: any = null;
      try {
        parsedPackage = JSON.parse(pkg.canonical);
      } catch {
        // Fallback if canonical is already an object
        parsedPackage = pkg.canonical;
      }
      const reportId = parsedPackage?.reportId || prep.label || "Laporan Periode";
      const version = String(parsedPackage?.version || "1");

      const findingId = `af_${randomUUID()}`;
      const now = runtime.now();
      const initialStatus: AuditFindingStatus = "OPEN";

      const finding: AuditFinding = {
        id: findingId,
        institutionId,
        preparationId,
        packageId,
        packageDigest: pkg.digest,
        reportId,
        version,
        auditorAccount: session.account.toLowerCase(),
        auditorOfficerId: auditor.officerId,
        auditorName: auditor.name,
        mandateRef: auditor.mandateRef,
        scope: input.scope,
        severity: input.severity,
        title: input.title.trim(),
        description: input.description.trim(),
        targetProposalId: input.targetProposalId || null,
        targetProposalVersion: input.targetProposalVersion != null ? Number(input.targetProposalVersion) : null,
        targetRealizationId: input.targetRealizationId || null,
        targetDocumentId: input.targetDocumentId || null,
        status: initialStatus,
        createdAt: now,
        updatedAt: now,
      };

      await db.execute(sql`
        INSERT INTO report_audit_findings (
          id, institution_id, preparation_id, package_id, package_digest,
          report_id, version, auditor_account, auditor_officer_id, auditor_name,
          mandate_ref, scope, severity, title, description,
          target_proposal_id, target_proposal_version, target_realization_id, target_document_id,
          status, created_at, updated_at
        ) VALUES (
          ${finding.id}, ${finding.institutionId}, ${finding.preparationId}, ${finding.packageId}, ${finding.packageDigest},
          ${finding.reportId}, ${finding.version}, ${finding.auditorAccount}, ${finding.auditorOfficerId}, ${finding.auditorName},
          ${finding.mandateRef}, ${finding.scope}, ${finding.severity}, ${finding.title}, ${finding.description},
          ${finding.targetProposalId}, ${finding.targetProposalVersion}, ${finding.targetRealizationId}, ${finding.targetDocumentId},
          ${finding.status}, ${finding.createdAt}, ${finding.updatedAt}
        )
      `);

      // Store attachments if provided
      const attachments: AuditFindingAttachmentMeta[] = [];
      if (input.workingPapers && input.workingPapers.length > 0) {
        for (const wp of input.workingPapers) {
          const bytes = decodeBase64(wp.contentBase64);
          if (bytes.byteLength > MAX_EVIDENCE_FILE_BYTES) {
            throw new AuditFindingError(`Berkas kertas kerja ${wp.fileName} melebihi batas 10MB.`, 400);
          }
          const hash = sha256Hex(bytes);
          const attachId = `afa_${randomUUID()}`;
          let storageRef = `ref_${attachId}`;

          if (runtime.files) {
            const stored = await runtime.files.put({
              institutionId,
              preparationId,
              fileId: attachId,
              bytes,
            });
            storageRef = stored.storageRef;
          }

          await db.execute(sql`
            INSERT INTO report_audit_finding_attachments (
              id, finding_id, institution_id, uploader_account, uploader_role,
              file_name, mime_type, size_bytes, content_sha256, storage_ref,
              is_owner_only, created_at
            ) VALUES (
              ${attachId}, ${findingId}, ${institutionId}, ${session.account.toLowerCase()}, 'AUDITOR',
              ${wp.fileName}, ${wp.mimeType}, ${bytes.byteLength}, ${hash}, ${storageRef},
              1, ${now}
            )
          `);

          attachments.push({
            id: attachId,
            findingId,
            institutionId,
            fileName: wp.fileName,
            mimeType: wp.mimeType,
            sizeBytes: bytes.byteLength,
            contentSha256: hash,
            isOwnerOnly: true,
            uploadedBy: auditor.name,
            uploaderRole: "AUDITOR",
            uploadedAt: now,
          });
        }
      }

      const eventId = `afe_${randomUUID()}`;
      await db.execute(sql`
        INSERT INTO report_audit_finding_events (
          id, finding_id, institution_id, event_type,
          actor_account, actor_officer_id, actor_role, actor_name,
          note, resulting_status, attachments_json, created_at
        ) VALUES (
          ${eventId}, ${findingId}, ${institutionId}, 'FINDING_CREATED',
          ${session.account.toLowerCase()}, ${auditor.officerId}, 'AUDITOR', ${auditor.name},
          ${finding.description}, ${initialStatus}, ${JSON.stringify(attachments)}, ${now}
        )
      `);

      return {
        ...finding,
        events: [
          {
            id: eventId,
            findingId,
            institutionId,
            eventType: "FINDING_CREATED",
            actorAccount: session.account.toLowerCase(),
            actorOfficerId: auditor.officerId,
            actorRole: "AUDITOR",
            actorName: auditor.name,
            note: finding.description,
            resultingStatus: initialStatus,
            attachments,
            createdAt: now,
          },
        ],
      };
    },

    async addAmilResponse(
      session: Pick<SessionRecord, "account" | "institutionId">,
      findingId: string,
      input: AmilResponseInput,
    ): Promise<AuditFinding> {
      const institutionId = session.institutionId;
      const amil = await checkAmilAuthority(session);

      if (!input.note || typeof input.note !== "string" || !input.note.trim()) {
        throw new AuditFindingError("Tanggapan amil wajib memuat catatan/penjelasan.", 400);
      }

      const findingRows = rowsOf(
        await db.execute(sql`
          SELECT * FROM report_audit_findings
          WHERE id = ${findingId} AND institution_id = ${institutionId}
        `),
      );
      if (!findingRows[0]) {
        throw new AuditFindingError("Temuan audit tidak ditemukan.", 404);
      }
      const existingFinding = findingRows[0];

      if (existingFinding.status === "DITUTUP_AUDITOR") {
        throw new AuditFindingError("Temuan ini telah ditutup oleh auditor dan tidak dapat ditanggapi lagi.", 409);
      }

      const now = runtime.now();
      const newStatus: AuditFindingStatus = "DITANGGAPI";

      // Process attachments if any
      const attachments: AuditFindingAttachmentMeta[] = [];
      if (input.attachments && input.attachments.length > 0) {
        for (const att of input.attachments) {
          const bytes = decodeBase64(att.contentBase64);
          if (bytes.byteLength > MAX_EVIDENCE_FILE_BYTES) {
            throw new AuditFindingError(`Berkas lampiran ${att.fileName} melebihi batas 10MB.`, 400);
          }
          const hash = sha256Hex(bytes);
          const attachId = `afa_${randomUUID()}`;
          let storageRef = `ref_${attachId}`;

          if (runtime.files) {
            const stored = await runtime.files.put({
              institutionId,
              preparationId: existingFinding.preparation_id,
              fileId: attachId,
              bytes,
            });
            storageRef = stored.storageRef;
          }

          await db.execute(sql`
            INSERT INTO report_audit_finding_attachments (
              id, finding_id, institution_id, uploader_account, uploader_role,
              file_name, mime_type, size_bytes, content_sha256, storage_ref,
              is_owner_only, created_at
            ) VALUES (
              ${attachId}, ${findingId}, ${institutionId}, ${session.account.toLowerCase()}, 'AMIL',
              ${att.fileName}, ${att.mimeType}, ${bytes.byteLength}, ${hash}, ${storageRef},
              0, ${now}
            )
          `);

          attachments.push({
            id: attachId,
            findingId,
            institutionId,
            fileName: att.fileName,
            mimeType: att.mimeType,
            sizeBytes: bytes.byteLength,
            contentSha256: hash,
            isOwnerOnly: false,
            uploadedBy: amil.name,
            uploaderRole: "AMIL",
            uploadedAt: now,
          });
        }
      }

      const eventId = `afe_${randomUUID()}`;
      await db.execute(sql`
        INSERT INTO report_audit_finding_events (
          id, finding_id, institution_id, event_type,
          actor_account, actor_officer_id, actor_role, actor_name,
          note, resulting_status, attachments_json, created_at
        ) VALUES (
          ${eventId}, ${findingId}, ${institutionId}, 'AMIL_RESPONSE',
          ${session.account.toLowerCase()}, ${amil.officerId}, 'AMIL', ${amil.name},
          ${input.note.trim()}, ${newStatus}, ${JSON.stringify(attachments)}, ${now}
        )
      `);

      await db.execute(sql`
        UPDATE report_audit_findings
        SET status = ${newStatus}, updated_at = ${now}
        WHERE id = ${findingId} AND institution_id = ${institutionId}
      `);

      return this.getFinding(session, findingId);
    },

    async addAuditorFollowup(
      session: Pick<SessionRecord, "account" | "institutionId">,
      findingId: string,
      input: AuditorFollowupInput,
    ): Promise<AuditFinding> {
      const institutionId = session.institutionId;
      const auditor = await checkAuditorAuthority(institutionId, session.account);

      if (!input.note || typeof input.note !== "string" || !input.note.trim()) {
        throw new AuditFindingError("Catatan tindak lanjut auditor wajib diisi.", 400);
      }
      if (!["MINTA_KLARIFIKASI_LANJUTAN", "BUTUH_KOREKSI_LAPORAN", "SELESAI_DITUTUP"].includes(input.action)) {
        throw new AuditFindingError(`Aksi tindak lanjut auditor tidak sah: ${input.action}`, 400);
      }

      const findingRows = rowsOf(
        await db.execute(sql`
          SELECT * FROM report_audit_findings
          WHERE id = ${findingId} AND institution_id = ${institutionId}
        `),
      );
      if (!findingRows[0]) {
        throw new AuditFindingError("Temuan audit tidak ditemukan.", 404);
      }
      const existingFinding = findingRows[0];

      if (existingFinding.auditor_account.toLowerCase() !== session.account.toLowerCase()) {
        throw new AuditFindingError("Hanya auditor yang mencatat temuan ini yang berwenang memberikan tindak lanjut atau menutup temuan.", 403);
      }

      const now = runtime.now();
      let newStatus: AuditFindingStatus = "DITINDAKLANJUTI";
      let eventType: "AUDITOR_FOLLOWUP" | "AUDITOR_CLOSED" = "AUDITOR_FOLLOWUP";

      if (input.action === "SELESAI_DITUTUP") {
        newStatus = "DITUTUP_AUDITOR";
        eventType = "AUDITOR_CLOSED";
      }

      // Process attachments if any
      const attachments: AuditFindingAttachmentMeta[] = [];
      if (input.workingPapers && input.workingPapers.length > 0) {
        for (const wp of input.workingPapers) {
          const bytes = decodeBase64(wp.contentBase64);
          if (bytes.byteLength > MAX_EVIDENCE_FILE_BYTES) {
            throw new AuditFindingError(`Berkas kertas kerja ${wp.fileName} melebihi batas 10MB.`, 400);
          }
          const hash = sha256Hex(bytes);
          const attachId = `afa_${randomUUID()}`;
          let storageRef = `ref_${attachId}`;

          if (runtime.files) {
            const stored = await runtime.files.put({
              institutionId,
              preparationId: existingFinding.preparation_id,
              fileId: attachId,
              bytes,
            });
            storageRef = stored.storageRef;
          }

          await db.execute(sql`
            INSERT INTO report_audit_finding_attachments (
              id, finding_id, institution_id, uploader_account, uploader_role,
              file_name, mime_type, size_bytes, content_sha256, storage_ref,
              is_owner_only, created_at
            ) VALUES (
              ${attachId}, ${findingId}, ${institutionId}, ${session.account.toLowerCase()}, 'AUDITOR',
              ${wp.fileName}, ${wp.mimeType}, ${bytes.byteLength}, ${hash}, ${storageRef},
              1, ${now}
            )
          `);

          attachments.push({
            id: attachId,
            findingId,
            institutionId,
            fileName: wp.fileName,
            mimeType: wp.mimeType,
            sizeBytes: bytes.byteLength,
            contentSha256: hash,
            isOwnerOnly: true,
            uploadedBy: auditor.name,
            uploaderRole: "AUDITOR",
            uploadedAt: now,
          });
        }
      }

      const eventId = `afe_${randomUUID()}`;
      await db.execute(sql`
        INSERT INTO report_audit_finding_events (
          id, finding_id, institution_id, event_type,
          actor_account, actor_officer_id, actor_role, actor_name,
          note, resulting_status, attachments_json, created_at
        ) VALUES (
          ${eventId}, ${findingId}, ${institutionId}, ${eventType},
          ${session.account.toLowerCase()}, ${auditor.officerId}, 'AUDITOR', ${auditor.name},
          ${input.note.trim()}, ${newStatus}, ${JSON.stringify(attachments)}, ${now}
        )
      `);

      await db.execute(sql`
        UPDATE report_audit_findings
        SET status = ${newStatus}, updated_at = ${now}
        WHERE id = ${findingId} AND institution_id = ${institutionId}
      `);

      return this.getFinding(session, findingId);
    },

    async getFinding(
      session: Pick<SessionRecord, "account" | "institutionId">,
      findingId: string,
    ): Promise<AuditFinding> {
      const institutionId = session.institutionId;
      const findingRows = rowsOf(
        await db.execute(sql`
          SELECT * FROM report_audit_findings
          WHERE id = ${findingId} AND institution_id = ${institutionId}
        `),
      );
      if (!findingRows[0]) {
        throw new AuditFindingError("Temuan audit tidak ditemukan.", 404);
      }
      const r = findingRows[0];

      const eventRows = rowsOf(
        await db.execute(sql`
          SELECT * FROM report_audit_finding_events
          WHERE finding_id = ${findingId} AND institution_id = ${institutionId}
          ORDER BY created_at ASC
        `),
      );

      const events: AuditFindingEvent[] = eventRows.map(e => ({
        id: e.id,
        findingId: e.finding_id,
        institutionId: e.institution_id,
        eventType: e.event_type,
        actorAccount: e.actor_account,
        actorOfficerId: e.actor_officer_id,
        actorRole: e.actor_role,
        actorName: e.actor_name,
        note: e.note,
        resultingStatus: e.resulting_status,
        attachments: JSON.parse(e.attachments_json || "[]"),
        createdAt: Number(e.created_at),
      }));

      return {
        id: r.id,
        institutionId: r.institution_id,
        preparationId: r.preparation_id,
        packageId: r.package_id,
        packageDigest: r.package_digest,
        reportId: r.report_id,
        version: r.version,
        auditorAccount: r.auditor_account,
        auditorOfficerId: r.auditor_officer_id,
        auditorName: r.auditor_name,
        mandateRef: r.mandate_ref,
        scope: r.scope,
        severity: r.severity,
        title: r.title,
        description: r.description,
        targetProposalId: r.target_proposal_id ?? null,
        targetProposalVersion: r.target_proposal_version != null ? Number(r.target_proposal_version) : null,
        targetRealizationId: r.target_realization_id ?? null,
        targetDocumentId: r.target_document_id ?? null,
        status: r.status,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
        events,
      };
    },

    async listFindingsForPackage(
      session: Pick<SessionRecord, "account" | "institutionId">,
      packageId: string,
    ): Promise<AuditFinding[]> {
      const institutionId = session.institutionId;
      const rows = rowsOf(
        await db.execute(sql`
          SELECT * FROM report_audit_findings
          WHERE package_id = ${packageId} AND institution_id = ${institutionId}
          ORDER BY created_at DESC
        `),
      );

      return Promise.all(rows.map(r => this.getFinding(session, r.id)));
    },

    async getQueues(
      session: Pick<SessionRecord, "account" | "institutionId">,
    ): Promise<AuditFindingQueues> {
      const institutionId = session.institutionId;
      const rows = rowsOf(
        await db.execute(sql`
          SELECT * FROM report_audit_findings
          WHERE institution_id = ${institutionId}
          ORDER BY updated_at DESC
        `),
      );

      const findings = await Promise.all(rows.map(r => this.getFinding(session, r.id)));

      return {
        amilActionQueue: findings.filter(f => f.status === "OPEN" || f.status === "DITINDAKLANJUTI"),
        auditorReviewQueue: findings.filter(f => f.status === "DITANGGAPI"),
      };
    },

    async readAttachment(
      session: Pick<SessionRecord, "account" | "institutionId">,
      findingId: string,
      attachmentId: string,
    ): Promise<{ fileName: string; mimeType: string; bytes: Uint8Array }> {
      const institutionId = session.institutionId;
      const findingRows = rowsOf(
        await db.execute(sql`
          SELECT * FROM report_audit_findings
          WHERE id = ${findingId} AND institution_id = ${institutionId}
        `),
      );
      if (!findingRows[0]) {
        throw new AuditFindingError("Temuan audit tidak ditemukan.", 404);
      }

      const attRows = rowsOf(
        await db.execute(sql`
          SELECT * FROM report_audit_finding_attachments
          WHERE id = ${attachmentId} AND finding_id = ${findingId} AND institution_id = ${institutionId}
        `),
      );
      if (!attRows[0]) {
        throw new AuditFindingError("Lampiran tidak ditemukan.", 404);
      }
      const att = attRows[0];

      // Owner-only check: if isOwnerOnly == 1, only the uploader or another authorized auditor can download
      if (att.is_owner_only) {
        if (att.uploader_account.toLowerCase() !== session.account.toLowerCase()) {
          // Check if caller is another auditor from the institution
          try {
            await checkAuditorAuthority(institutionId, session.account);
          } catch {
            throw new AuditFindingError("Kertas kerja auditor privat hanya dapat diakses oleh pemeriksa.", 403);
          }
        }
      }

      if (!runtime.files) {
        throw new AuditFindingError("Penyimpanan berkas belum tersedia.", 503);
      }

      const bytes = await runtime.files.get(att.storage_ref);
      if (!bytes) {
        throw new AuditFindingError("Berkas fisik lampiran tidak ditemukan.", 404);
      }

      const actualHash = sha256Hex(bytes);
      if (actualHash !== att.content_sha256) {
        throw new AuditFindingError("Integritas berkas gagal; isi berkas tidak cocok dengan hash tercatat.", 409);
      }

      return {
        fileName: att.file_name,
        mimeType: att.mime_type,
        bytes,
      };
    },
  };
}

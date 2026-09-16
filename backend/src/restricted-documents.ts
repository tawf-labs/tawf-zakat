import type { EvidenceStore } from "./evidence-store";
import { EvidenceReadError, type PrivateFileStore } from "./evidence-files";
import { canonicalJson, parseSnapshot, sha256Hex, verifyCommitment, type FileReference } from "./evidence-snapshot";
import type { FileAvailability } from "../../shared/registry-recovery";
import type { RegistryStore } from "./registry-store";
import type { DisbursementStore } from "./disbursement-store";

export type DocumentSubject =
  | { institutionId: string; preparationId: string; intentId?: string }
  | { institutionId: string; proposalId: string; version?: number };

type DocumentFile = Pick<FileReference, "id" | "fileName" | "mimeType" | "sizeBytes" | "contentSha256" | "storageStatus">;
type BoundDocument = { file: DocumentFile; storageRef: string | null; missingLocatorRow: boolean };
export class DocumentError extends Error {
  constructor(message: string, readonly reason: "NOT_FOUND" | "BINDING" | "MISSING" | "CORRUPT" | "UNAVAILABLE",
    readonly storageStatus?: "STORED" | "FAILED", readonly missingLocatorRow = false) { super(message); }
}

export function createRestrictedDocuments(
  evidence?: EvidenceStore | null,
  files?: PrivateFileStore,
  registry?: RegistryStore,
  disbursement?: DisbursementStore
) {
  async function inventory(subject: DocumentSubject): Promise<BoundDocument[]> {
    if ("proposalId" in subject) {
      if (!disbursement) throw new DocumentError("Layanan penyaluran belum tersedia.", "UNAVAILABLE");
      const proposal = await disbursement.getProposalDraft(subject.institutionId, subject.proposalId);
      if (!proposal) throw new DocumentError("Pengajuan tidak ditemukan.", "NOT_FOUND");
      let docs = await disbursement.listProposalDocuments(subject.institutionId, subject.proposalId, subject.version);
      if (subject.version !== undefined) {
        const versionRecord = await disbursement.getProposalVersion(subject.institutionId, subject.proposalId, subject.version);
        if (versionRecord && Array.isArray(versionRecord.documents)) {
          docs = versionRecord.documents;
        }
      }
      return docs.map(doc => ({
        file: {
          id: doc.id,
          fileName: doc.fileName,
          mimeType: doc.mimeType,
          sizeBytes: doc.sizeBytes,
          contentSha256: doc.contentSha256,
          storageStatus: doc.storageStatus,
        },
        storageRef: doc.storageRef,
        missingLocatorRow: !doc.storageRef,
      }));
    }

    if (!evidence) throw new DocumentError("Layanan bukti belum tersedia.", "UNAVAILABLE");
    const record = await evidence.getPreparation(subject.institutionId, subject.preparationId);
    if (!record) throw new DocumentError("Persiapan tidak ditemukan.", "NOT_FOUND");
    if (!verifyCommitment(new TextEncoder().encode(record.canonicalSnapshot), record.commitmentSalt, record.commitment)) {
      throw new DocumentError("Commitment snapshot tidak cocok.", "BINDING");
    }
    const snapshot = parseSnapshot(record.canonicalSnapshot);
    if (snapshot.institutionId !== subject.institutionId || snapshot.preparationId !== subject.preparationId) {
      throw new DocumentError("Identitas snapshot tidak cocok.", "BINDING");
    }
    if (subject.intentId) {
      const intent = await registry?.get(subject.institutionId, subject.intentId, "ATTESTATION");
      const saved = intent && await evidence.findReportPackage(subject.institutionId, intent.statement.packageId);
      if (!intent || !saved) throw new DocumentError("Atestasi tidak ditemukan.", "NOT_FOUND");
      const report = JSON.parse(saved.canonical);
      if (report.preparationId !== subject.preparationId || report.institutionId !== subject.institutionId
        || intent.statement.institutionId !== subject.institutionId || report.id !== intent.statement.packageId
        || saved.digest !== intent.statement.packageDigest
        || !verifyCommitment(new TextEncoder().encode(saved.canonical), record.commitmentSalt, saved.digest)
        || !verifyCommitment(new TextEncoder().encode(canonicalJson(intent.evidence.files)), intent.evidence.salt, intent.statement.evidenceCommitment)) {
        throw new DocumentError("Commitment atau identitas bukti atestasi tidak cocok.", "BINDING");
      }
      return intent.evidence.files.map(file => ({ file: { ...file, storageStatus: "STORED" as const },
        storageRef: intent.evidence.storageRefs?.[file.id] ?? null, missingLocatorRow: false }));
    }
    return snapshot.files.map(file => {
      const locator = record.files.find(stored => stored.id === file.id);
      return { file, storageRef: locator?.storageRef ?? null, missingLocatorRow: !locator };
    });
  }
  async function bytesOf({ file, storageRef, missingLocatorRow }: BoundDocument) {
    if (missingLocatorRow) throw new DocumentError("Berkas tidak ditemukan.", "MISSING", undefined, true);
    if (!files || !file.contentSha256 || file.storageStatus !== "STORED") {
      throw new DocumentError("Berkas ini tidak tersedia pada penyimpanan terbatas deployment ini.", "UNAVAILABLE", file.storageStatus);
    }
    if (!storageRef) throw new DocumentError("Berkas tidak ditemukan.", "MISSING");
    let bytes: Uint8Array | null;
    try { bytes = await files.get(storageRef); }
    catch (error) {
      throw new DocumentError("Berkas tidak dapat dibaca atau diverifikasi.", error instanceof EvidenceReadError ? error.availability : "UNAVAILABLE");
    }
    if (!bytes) throw new DocumentError("Berkas tidak ditemukan.", "MISSING");
    if (bytes.byteLength !== file.sizeBytes || sha256Hex(bytes) !== file.contentSha256) {
      throw new DocumentError("Isi berkas tidak cocok dengan dokumen yang dikomitmenkan.", "CORRUPT");
    }
    return bytes;
  }
  async function inspectFile(bound: BoundDocument) {
    const { file } = bound;
    let availability: FileAvailability = "AVAILABLE";
    try { await bytesOf(bound); }
    catch (error) {
      if (!(error instanceof DocumentError) || error.reason === "BINDING" || error.reason === "NOT_FOUND") throw error;
      availability = error.reason;
    }
    return { id: file.id, sizeBytes: file.sizeBytes, contentSha256: file.contentSha256, availability };
  }
  return {
    async inspect(subject: DocumentSubject) {
      return Promise.all((await inventory(subject)).map(inspectFile));
    },
    async read(subject: DocumentSubject, fileId: string) {
      const bound = (await inventory(subject)).find(item => item.file.id === fileId);
      if (!bound) throw new DocumentError("Berkas tidak ditemukan.", "NOT_FOUND");
      return { file: bound.file, bytes: await bytesOf(bound) };
    },
    async restore(subject: DocumentSubject, fileId: string, backup: Uint8Array) {
      const bound = (await inventory(subject)).find(item => item.file.id === fileId);
      if (!bound) throw new DocumentError("Berkas tidak ditemukan.", "NOT_FOUND");
      const { file, storageRef } = bound;
      if (!file.contentSha256 || backup.byteLength !== file.sizeBytes || sha256Hex(backup) !== file.contentSha256) {
        throw new DocumentError("Backup tidak cocok dengan sumber yang dikomitmenkan.", "CORRUPT");
      }
      if (!storageRef || !files?.restore) throw new DocumentError("Penyimpanan pemulihan belum tersedia.", "UNAVAILABLE");
      try { await files.restore(storageRef, backup, { contentSha256: file.contentSha256, sizeBytes: file.sizeBytes }); }
      catch { throw new DocumentError("Berkas belum dapat dipulihkan; periksa backup dan kunci penyimpanan.", "UNAVAILABLE"); }
      const restored = await inspectFile(bound);
      if (restored.availability !== "AVAILABLE") throw new DocumentError("Berkas hasil pemulihan belum dapat diverifikasi.", "UNAVAILABLE");
      return restored;
    },
  };
}

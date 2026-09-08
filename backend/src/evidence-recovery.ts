import { EvidenceReadError } from "./evidence-files";
import type { FileAvailability } from "../../shared/registry-recovery";
import type { WorkspaceRuntime } from "./workspace-runtime";
import { canonicalJson, verifyCommitment, sha256Hex } from "./evidence-snapshot";
import type { AttestationEvidenceFile } from "../../shared/report-registry";

type BoundFile = { id: string; sizeBytes: number; contentSha256: string | null; storageRef: string | null };
export class RecoveryFileError extends Error {
  constructor(message: string, readonly status: 404 | 409 | 503) { super(message); }
}
export async function recoveryFiles(runtime: WorkspaceRuntime, institution: string, preparationId: string, intentId?: string, actor?: string): Promise<BoundFile[]> {
  const preparation = await runtime.evidence?.getPreparation(institution, preparationId);
  if (!preparation) throw new RecoveryFileError("Persiapan tidak ditemukan.", 404);
  if (intentId) {
    const intent = await runtime.registry?.store.get(institution, intentId, "ATTESTATION");
    const saved = intent && await runtime.evidence!.findReportPackage(institution, intent.statement.packageId);
    if (!intent || !saved || JSON.parse(saved.canonical).preparationId !== preparationId) throw new RecoveryFileError("Atestasi tidak ditemukan.", 404);
    if (intent.statement.auditor.toLowerCase() !== actor?.toLowerCase()) {
      const attempt = await runtime.registry!.store.attempt(institution, intent.id);
      if (!attempt || (await runtime.registry!.chain.observe(intent, attempt.hash)).state !== "CONFIRMED") throw new RecoveryFileError("Atestasi tidak ditemukan.", 404);
    }
    if (!verifyCommitment(new TextEncoder().encode(canonicalJson(intent.evidence.files)), intent.evidence.salt, intent.statement.evidenceCommitment)) {
      throw new RecoveryFileError("Commitment bukti atestasi tidak cocok.", 409);
    }
    return intent.evidence.files.map((file: AttestationEvidenceFile) => ({ id: file.id, contentSha256: file.contentSha256, sizeBytes: file.sizeBytes, storageRef: intent.evidence.storageRefs?.[file.id] ?? null }));
  }
  if (!verifyCommitment(new TextEncoder().encode(preparation.canonicalSnapshot), preparation.commitmentSalt, preparation.commitment)) {
    throw new RecoveryFileError("Commitment snapshot tidak cocok.", 409);
  }
  // Expected hashes come from the committed manifest, never from replacement content.
  const manifest = JSON.parse(preparation.canonicalSnapshot).files as BoundFile[];
  return manifest.map(file => ({ id: file.id, sizeBytes: file.sizeBytes, contentSha256: file.contentSha256,
    storageRef: preparation.files.find(stored => stored.id === file.id)?.storageRef ?? null }));
}
export async function inspectRecoveryFiles(runtime: WorkspaceRuntime, files: BoundFile[]) {
  return Promise.all(files.map(async ({ storageRef, ...file }) => {
    let availability: FileAvailability = "UNAVAILABLE";
    try {
      if (runtime.files && storageRef && file.contentSha256) {
        const bytes = await runtime.files.get(storageRef);
        availability = !bytes ? "MISSING" : bytes.byteLength === file.sizeBytes && sha256Hex(bytes) === file.contentSha256 ? "AVAILABLE" : "CORRUPT";
      }
    } catch (error) { availability = error instanceof EvidenceReadError ? error.availability : "UNAVAILABLE"; }
    return { ...file, availability };
  }));
}
export async function restoreRecoveryFile(runtime: WorkspaceRuntime, files: BoundFile[], id: string, content: string) {
  const file = files.find(item => item.id === id);
  if (!file) throw new RecoveryFileError("Berkas tidak ditemukan.", 404);
  const bytes = Buffer.from(content, "base64");
  if (bytes.toString("base64") !== content || !file.contentSha256 || bytes.byteLength !== file.sizeBytes || sha256Hex(bytes) !== file.contentSha256) {
    throw new RecoveryFileError("Backup tidak cocok dengan sumber yang dikomitmenkan.", 409);
  }
  if (!file.storageRef || !runtime.files?.restore) throw new RecoveryFileError("Penyimpanan pemulihan belum tersedia.", 503);
  await runtime.files.restore(file.storageRef, bytes, { contentSha256: file.contentSha256, sizeBytes: file.sizeBytes });
  const restored = (await inspectRecoveryFiles(runtime, [file]))[0]!;
  if (restored.availability !== "AVAILABLE") throw new RecoveryFileError("Berkas hasil pemulihan belum dapat diverifikasi.", 503);
  return restored;
}

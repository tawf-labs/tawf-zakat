import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { CampaignError } from "./crowdfunding";

export function campaignDocumentKeyFromEnv(): Buffer | null {
  const value = process.env.CAMPAIGN_DOCUMENT_KEY;
  if (!value) return null;
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error("CAMPAIGN_DOCUMENT_KEY must be 32 bytes encoded as 64 hex characters");
  return Buffer.from(value, "hex");
}
export function encryptCampaignDocument(key: Buffer | null | undefined, campaignId: string, documentId: string, bytes: Buffer) {
  if (!key || key.length !== 32) throw new CampaignError("Private document encryption is unconfigured", 503);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${campaignId}:${documentId}`));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { algorithm: "AES-256-GCM", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}
export function decryptCampaignDocument(key: Buffer | null | undefined, campaignId: string, document: any) {
  if (!key || key.length !== 32) throw new CampaignError("Private document encryption is unconfigured", 503);
  try {
    const data = document.encrypted;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(data.iv, "base64"));
    decipher.setAAD(Buffer.from(`${campaignId}:${document.id}`));
    decipher.setAuthTag(Buffer.from(data.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data.ciphertext, "base64")), decipher.final()]);
  } catch { throw new CampaignError("Private document cannot be decrypted", 503); }
}
/**
 * Where campaign file ciphertext lives. The aggregate row keeps only the nonce, tag and
 * metadata, so a 2 MiB upload is not re-read and re-written on every later request.
 * One seam: an object-storage adapter can replace the disk one without touching callers.
 */
export interface CampaignFileStore {
  write(key: string, bytes: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
}
const fileKey = (campaignId: string, fileId: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(campaignId) || !/^[0-9a-f-]{36}$/i.test(fileId)) throw new CampaignError("Invalid file reference", 404);
  return `${campaignId}/${fileId}`;
};
export function campaignDiskFileStore(directory: string): CampaignFileStore {
  const root = resolve(directory);
  return {
    async write(key, bytes) {
      const target = join(root, key);
      await mkdir(dirname(target), { recursive: true });
      // Write-then-rename: a crash never leaves a half-written file under the final name.
      const partial = `${target}.${randomBytes(6).toString("hex")}.tmp`;
      await writeFile(partial, bytes, { mode: 0o600 });
      await rename(partial, target);
    },
    read: key => readFile(join(root, key)),
  };
}
export function campaignMemoryFileStore(): CampaignFileStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return { files, async write(key, bytes) { files.set(key, bytes); }, async read(key) { const bytes = files.get(key); if (!bytes) throw new Error("Missing file"); return bytes; } };
}
export const campaignFileStoreFromEnv = () => campaignDiskFileStore(process.env.CAMPAIGN_FILE_DIR ?? ".campaign-files");
type FileRuntime = { documentKey?: Buffer | null; files?: CampaignFileStore | null };
/** Encrypts, writes the ciphertext to the file store, and returns what the aggregate keeps. */
export async function storeCampaignFile(runtime: FileRuntime, campaignId: string, fileId: string, bytes: Buffer) {
  if (!runtime.files) throw new CampaignError("Campaign file storage is unconfigured", 503);
  const { ciphertext, ...sealed } = encryptCampaignDocument(runtime.documentKey, campaignId, fileId, bytes);
  await runtime.files.write(fileKey(campaignId, fileId), Buffer.from(ciphertext, "base64"));
  return { ...sealed, stored: true };
}
export async function readCampaignFile(runtime: FileRuntime, campaignId: string, document: any) {
  // Records written before the file store keep their ciphertext inline until externalized.
  if (document.encrypted?.ciphertext !== undefined) return decryptCampaignDocument(runtime.documentKey, campaignId, document);
  if (!runtime.files) throw new CampaignError("Campaign file storage is unconfigured", 503);
  let ciphertext: Buffer;
  try { ciphertext = await runtime.files.read(fileKey(campaignId, document.id)); } catch { throw new CampaignError("Stored file is unavailable", 503); }
  return decryptCampaignDocument(runtime.documentKey, campaignId, { ...document, encrypted: { ...document.encrypted, ciphertext: ciphertext.toString("base64") } });
}
/** Moves inline ciphertext of older records into the file store. Returns how many files moved. */
export async function externalizeCampaignFiles(runtime: FileRuntime, campaigns: Record<string, any>) {
  if (!runtime.files) throw new CampaignError("Campaign file storage is unconfigured", 503);
  let moved = 0;
  for (const c of Object.values(campaigns)) {
    const records = [...(c.documents ?? []), ...(c.versions ?? []).flatMap((v: any) => v.documents ?? []), ...(c.updates ?? []).flatMap((u: any) => u.attachments ?? [])];
    for (const record of records) {
      if (record.encrypted?.ciphertext === undefined) continue;
      await runtime.files.write(fileKey(c.id, record.id), Buffer.from(record.encrypted.ciphertext, "base64"));
      delete record.encrypted.ciphertext; record.encrypted.stored = true; moved++;
    }
  }
  return moved;
}
const file = { name: z.string().trim().min(1).max(120).regex(/^[^/\\\x00-\x1f]+$/), contentType: z.enum(["application/pdf", "image/png", "image/jpeg"]), dataBase64: z.string().min(4).max(2_800_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) };
const proposalUpload = z.object(file).strict();
const attachmentUpload = z.object({ ...file, visibility: z.enum(["PRIVATE", "PUBLIC"]) }).strict();
type Upload = z.infer<typeof proposalUpload> & { visibility?: "PRIVATE" | "PUBLIC" };
/** Validates an uploaded file's declared type against its magic bytes. */
export function parseCampaignUpload(body: unknown, withVisibility = false, imagesOnly = false) {
  const input: Upload = (withVisibility ? attachmentUpload : proposalUpload).parse(body);
  if (imagesOnly && input.contentType === "application/pdf") throw new CampaignError("Cover must be a JPEG or PNG image");
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (bytes.length > 2 * 1024 * 1024) throw new CampaignError("Document exceeds 2 MiB", 413);
  const valid = input.contentType === "application/pdf" ? bytes.subarray(0, 5).toString() === "%PDF-" : input.contentType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid) throw new CampaignError("File content does not match its type");
  return { input, bytes };
}
export const campaignDocumentHeaders = (document: { name: string; contentType: string }) => ({ "Content-Type": document.contentType, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": "sandbox" });
/** Published cover images are public and addressed by an id that never changes content. */
export const campaignCoverHeaders = (cover: { contentType: string }) => ({ "Content-Type": cover.contentType, "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=31536000, immutable", "Content-Security-Policy": "sandbox" });

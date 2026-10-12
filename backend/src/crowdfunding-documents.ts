import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
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
const file = { name: z.string().trim().min(1).max(120).regex(/^[^/\\\x00-\x1f]+$/), contentType: z.enum(["application/pdf", "image/png", "image/jpeg"]), dataBase64: z.string().min(4).max(2_800_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) };
const proposalUpload = z.object(file).strict();
const attachmentUpload = z.object({ ...file, visibility: z.enum(["PRIVATE", "PUBLIC"]) }).strict();
type Upload = z.infer<typeof proposalUpload> & { visibility?: "PRIVATE" | "PUBLIC" };
/** Validates an uploaded file's declared type against its magic bytes. */
export function parseCampaignUpload(body: unknown, withVisibility = false) {
  const input: Upload = (withVisibility ? attachmentUpload : proposalUpload).parse(body);
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (bytes.length > 2 * 1024 * 1024) throw new CampaignError("Document exceeds 2 MiB", 413);
  const valid = input.contentType === "application/pdf" ? bytes.subarray(0, 5).toString() === "%PDF-" : input.contentType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid) throw new CampaignError("File content does not match its type");
  return { input, bytes };
}
export const campaignDocumentHeaders = (document: { name: string; contentType: string }) => ({ "Content-Type": document.contentType, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": "sandbox" });

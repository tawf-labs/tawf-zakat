import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
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

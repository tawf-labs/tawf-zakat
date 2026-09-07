import { canonicalJson } from "../../../../shared/canonical-json";

/** Authorized readers use the restricted salt, never a public document URL. */
export async function verifyReportCommitment(body: unknown, salt: string, digest: string): Promise<boolean> {
  if (!/^0x[0-9a-f]{64}$/i.test(salt) || !/^0x[0-9a-f]{64}$/i.test(digest)) return false;
  const bytes = (hex: string) => Uint8Array.from(hex.slice(2).match(/../g)!, part => parseInt(part, 16));
  const key = await crypto.subtle.importKey("raw", bytes(salt), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, bytes(digest), new TextEncoder().encode(canonicalJson(body)));
}

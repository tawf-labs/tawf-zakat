/**
 * The durable half of certificate issuance: sign once, keep the bytes, broadcast, then observe.
 * Mirrors `registry-relay.ts`, kept separate so this ticket never touches the report-registry gate.
 */
import type { Hex, CertificateMintObservation, CertificateIssuanceIntent } from "../../shared/certificate-nft";
import type { CertificateChain } from "./certificate-chain";
import type { CertificateStore } from "./certificate-store";

export type CertificateRelayError = (message: string, status: 409) => Error;

export function createCertificateRelay(store: CertificateStore, chain: CertificateChain, institution: string, fail: CertificateRelayError) {
  const observation = (state: CertificateMintObservation["state"]): CertificateMintObservation =>
    ({ state, confirmations: 0, requiredConfirmations: chain.requiredConfirmations, confirmationPolicy: chain.confirmationPolicy });

  async function status(intent: CertificateIssuanceIntent): Promise<CertificateIssuanceIntent> {
    const attempt = await store.attempt(institution, intent.id);
    const current = attempt ? await store.observe(intent, await chain.observe(intent, attempt.hash), attempt.hash) : intent;
    if (["CONFIRMED", "INCLUDED"].includes(current.observation.state)) return { ...current, signingAuthority: "HISTORICAL" };
    try {
      const role = await chain.authority(institution, current.certification.signer);
      return { ...current, signingAuthority: role.active && role.epoch === current.certification.authorityEpoch ? "CURRENT" : "STALE" };
    } catch { return { ...current, signingAuthority: "UNAVAILABLE" }; }
  }

  async function settled(intent: CertificateIssuanceIntent, signature: Hex): Promise<CertificateIssuanceIntent | null> {
    const attempt = await store.attempt(institution, intent.id);
    if (!attempt) return null;
    if (attempt.signature !== signature) throw fail("Retry harus membawa tanda tangan yang sama.", 409);
    const current = await status(intent);
    return current.observation.state === "SUBMITTED" || current.observation.state === "NONCANONICAL" ? null : current;
  }

  /** A competing successor whose mint reverted on a canonical block has lost for good; anything
   * still pending, reorged or unknown keeps the slot, because it may yet win the line. */
  async function reclaimable(intent: CertificateIssuanceIntent): Promise<string[]> {
    const c = intent.certification;
    const holder = await store.successorClaim(institution, c.certificateId, c.predecessor);
    if (!holder || holder === intent.id) return [];
    const held = await store.get(institution, holder);
    if (!held) return [holder];
    return ["REVERTED", "INVALID_EVENT"].includes((await status(held)).observation.state) ? [holder] : [];
  }

  async function send(intent: CertificateIssuanceIntent, signature: Hex): Promise<CertificateIssuanceIntent> {
    let attempt = await store.attempt(institution, intent.id);
    if (!attempt) {
      const c = intent.certification;
      const successor = c.predecessor ? { certificateId: c.certificateId, predecessor: c.predecessor, reclaimable: await reclaimable(intent) } : undefined;
      attempt = await store.reserve(institution, intent.id, chain.deployment, await chain.pendingNonce(), chain.budget, (nonce) => chain.build(intent, signature, nonce), successor);
    }
    if (attempt.signature !== signature) throw fail("Retry berbeda dari percobaan tersimpan.", 409);
    // Broadcast ambiguity is recoverable: exact signed bytes and hash are already durable.
    await chain.broadcast(attempt);
    return store.observe(intent, observation("SUBMITTED"), attempt.hash);
  }

  return { status, settled, send, prepared: () => observation("PREPARED") };
}
export type CertificateRelay = ReturnType<typeof createCertificateRelay>;

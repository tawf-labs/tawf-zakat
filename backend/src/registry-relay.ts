/**
 * The durable half every registry action shares: sign once, keep the bytes, broadcast, then observe.
 *
 * Recording, publication and attestation differ in what they authorize and in
 * what the registry checks; they do not differ in how a signed transaction
 * survives a lost acknowledgement, a restart or a reorg. That sequence lives
 * here once, so a third action cannot quietly acquire a fourth variant of it.
 */
import type { Hex, RecordingObservation } from "../../shared/report-registry";
import type { RegistryChain } from "./registry-chain";
import type { RegistryStore, StoredIntent } from "./registry-store";

export type RelayError = (message: string, status: 409) => Error;

export function createRelay(store: RegistryStore, chain: RegistryChain, institution: string, fail: RelayError) {
  const observation = (state: RecordingObservation["state"]): RecordingObservation =>
    ({ state, confirmations: 0, requiredConfirmations: chain.requiredConfirmations, confirmationPolicy: chain.confirmationPolicy });

  /** Re-reads the chain rather than trusting the last stored observation, then persists what it saw. */
  async function status<T extends StoredIntent>(intent: T): Promise<T> {
    const attempt = await store.attempt(institution, intent.id);
    if (!attempt) return intent;
    return store.observe(intent, await chain.observe(intent, attempt.hash), attempt.hash);
  }

  /**
   * The settled intent when there is nothing left to send, otherwise null.
   *
   * Only a submission that was never seen on chain, or one whose block turned
   * out not to be canonical, is worth broadcasting again. Anything else is
   * already the answer, and resending it would risk a second logical action.
   */
  async function settled<T extends StoredIntent>(intent: T, signature: Hex): Promise<T | null> {
    const attempt = await store.attempt(institution, intent.id);
    if (!attempt) return null;
    if (attempt.signature !== signature) throw fail("Retry harus membawa tanda tangan yang sama.", 409);
    const current = await status(intent);
    return current.observation.state === "SUBMITTED" || current.observation.state === "NONCANONICAL" ? null : current;
  }

  async function send<T extends StoredIntent>(intent: T, signature: Hex): Promise<T> {
    let attempt = await store.attempt(institution, intent.id);
    if (!attempt) attempt = await store.reserve(institution, intent.id, chain.deployment, await chain.pendingNonce(), nonce => chain.build(intent, signature, nonce));
    if (attempt.signature !== signature) throw fail("Retry berbeda dari percobaan tersimpan.", 409);
    // Broadcast ambiguity is recoverable: exact signed bytes and hash are already durable.
    await chain.broadcast(attempt);
    return store.observe(intent, observation("SUBMITTED"), attempt.hash);
  }

  return { status, settled, send, prepared: () => observation("PREPARED") };
}
export type RegistryRelay = ReturnType<typeof createRelay>;

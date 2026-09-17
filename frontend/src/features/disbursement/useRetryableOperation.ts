import { useRef, useState } from "react";
import { WorkspaceRequestError } from "../workspace/privateRequests";

/** IDLE: not yet saved. UNKNOWN: sent, but no definitive answer; the same operation must be resent. */
export type OperationState = "IDLE" | "SAVING" | "SAVED" | "REFUSED" | "UNKNOWN";

/**
 * Holds one write until its outcome is definitive. A 4xx refusal is definitive; a transport
 * failure or 5xx may follow a committed write, so the retry resends the same payload and the
 * same retry identity, and the server replays the stored result instead of writing twice.
 */
export function useRetryableOperation<TPayload extends { operationId: string }, TResult>(
  send: (payload: TPayload) => Promise<TResult>,
  unknownMessage: string
) {
  const pending = useRef<TPayload | null>(null);
  const inFlight = useRef(false);
  const [state, setState] = useState<OperationState>("IDLE");
  const [error, setError] = useState<string | null>(null);

  async function run(build: (operationId: string) => TPayload): Promise<TResult | null> {
    if (inFlight.current) return null;
    inFlight.current = true;
    pending.current ??= build(crypto.randomUUID());
    setState("SAVING");
    setError(null);
    try {
      const result = await send(pending.current);
      pending.current = null;
      setState("SAVED");
      return result;
    } catch (failure) {
      const refused = failure instanceof WorkspaceRequestError && failure.status >= 400 && failure.status < 500;
      if (refused) pending.current = null;
      setState(refused ? "REFUSED" : "UNKNOWN");
      setError(refused ? failure.message : unknownMessage);
      return null;
    } finally {
      inFlight.current = false;
    }
  }

  function reset() {
    pending.current = null;
    setState("IDLE");
    setError(null);
  }

  return { state, error, run, reset, locked: state === "SAVING" || state === "UNKNOWN" };
}

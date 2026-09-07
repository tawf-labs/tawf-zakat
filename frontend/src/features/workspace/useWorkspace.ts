/**
 * The workspace session, as React sees it (Spec #68, ticket #69).
 *
 * Holds one thing: the token for the connected account, restored from
 * `sessionStorage` on mount and dropped the moment the server stops honouring
 * it. Signing in walks the challenge, the wallet and the exchange in order;
 * signing out revokes server-side first, so the session is dead even if this
 * tab never reloads.
 *
 * A 401 mid-session clears the stored token rather than retrying: the session
 * ended, and pretending otherwise only produces a second refusal.
 */

import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { getApiBaseUrl } from "../../lib/contracts";
import {
  endSession,
  exchangeSignedChallenge,
  fetchWorkspace,
  requestAccessChallenge,
  WorkspaceRequestError,
  type Workspace,
} from "./workspaceClient";
import { openWorkspaceSession } from "./workspaceAccess";
import {
  isSessionUsable,
  nowSeconds,
  sessionStorageKey,
  type StoredSession,
} from "./workspaceSession";

const read = (key: string): StoredSession | null => {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
};

const write = (key: string, session: StoredSession | null) => {
  try {
    if (session) sessionStorage.setItem(key, JSON.stringify(session));
    else sessionStorage.removeItem(key);
  } catch {
    // A browser refusing storage costs the user a re-sign, nothing more.
  }
};

export function useWorkspace() {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();

  const [session, setSession] = useState<StoredSession | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const storageKey = address ? sessionStorageKey(getApiBaseUrl(), address) : null;

  const forget = useCallback(() => {
    if (storageKey) write(storageKey, null);
    setSession(null);
    setWorkspace(null);
  }, [storageKey]);

  // Restore whatever this tab already holds for the connected account.
  useEffect(() => {
    if (!storageKey) {
      setSession(null);
      setWorkspace(null);
      return;
    }
    const restored = read(storageKey);
    setSession(isSessionUsable(restored, nowSeconds()) ? restored : null);
    if (!isSessionUsable(restored, nowSeconds())) write(storageKey, null);
  }, [storageKey]);

  // Load the workspace whenever a usable session is in hand.
  useEffect(() => {
    if (!session) {
      setWorkspace(null);
      return;
    }
    let cancelled = false;
    fetchWorkspace(session.token)
      .then((next) => {
        if (!cancelled) setWorkspace(next);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setWorkspace(null);
        if (caught instanceof WorkspaceRequestError) {
          setError(caught.message);
          // The session is over; keeping the token only buys another 401.
          if (caught.status === 401) forget();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session, forget]);

  const signIn = useCallback(
    async (institutionId: string) => {
      if (!address || !storageKey) {
        setError("Hubungkan wallet terlebih dahulu.");
        return;
      }
      setBusy(true);
      setError(null);

      // The walk itself lives in `workspaceAccess`, where it is tested against
      // fake ports; this only supplies the real wallet and API.
      const result = await openWorkspaceSession(
        {
          requestChallenge: requestAccessChallenge,
          sign: (payload) => signTypedDataAsync(payload as Parameters<typeof signTypedDataAsync>[0]),
          exchange: exchangeSignedChallenge,
        },
        { institutionId, account: address }
      );

      if (result.ok) {
        write(storageKey, result.session);
        setSession(result.session);
      } else {
        setError(result.error);
      }
      setBusy(false);
    },
    [address, storageKey, signTypedDataAsync]
  );

  const signOut = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    try {
      // Revoked at the server first; the local drop is only housekeeping.
      await endSession(session.token);
    } catch {
      // Already gone server-side is the same outcome the user asked for.
    } finally {
      forget();
      setError(null);
      setBusy(false);
    }
  }, [session, forget]);

  return {
    address,
    isConnected,
    // The evidence panel makes its own authorized requests, so it needs the
    // credential. It is handed down rather than re-read from storage, so there
    // stays one place that decides whether a session is still usable.
    token: session?.token ?? null,
    isSignedIn: Boolean(session && workspace),
    workspace,
    error,
    busy,
    signIn,
    signOut,
  };
}

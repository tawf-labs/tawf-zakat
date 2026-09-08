import { openWorkspaceSession, type SigningPayload } from "./workspaceAccess";
import type { Workspace } from "./workspaceClient";
import { sessionStorageKey, type StoredSession } from "./workspaceSession";
import { createPrivateRequests, AccessContextChanged, responseError, WorkspaceRequestError, type PrivateRequests } from "./privateRequests";

export type UnsavedReport = {
  reportId: string; version: string; predecessor: string; reason: string; narrative: string; amounts: Record<string, string>;
};

type AccessPorts = {
  origin: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  sign: (payload: SigningPayload) => Promise<string>;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  now: () => number;
  schedule: (task: () => void, milliseconds: number) => () => void;
};
type AccessState = { account: string | null; error: string | null; generation: number } & (
  { state: "CLOSED" | "OPENING" } | { state: "READY"; workspace: Workspace; requests: PrivateRequests }
);

/** Owns one tab's access. Async results belong to the generation that started them. */
export function createWorkspaceAccess(ports: AccessPorts) {
  let generation = 0;
  let state: AccessState = { state: "CLOSED", account: null, error: null, generation };
  let retained: StoredSession | null = null;
  let active: StoredSession | null = null;
  let cancelExpiry: (() => void) | null = null;
  const drafts = new Map<string, UnsavedReport>();
  const listeners = new Set<() => void>();
  const publish = (next: AccessState) => { state = next; for (const listener of listeners) listener(); };
  const current = (started: number) => {
    if (started === generation && active && ports.now() > active.expiresAt) lockExpired(active);
    if (started !== generation) throw new AccessContextChanged();
  };
  async function json(path: string, init?: RequestInit) {
    const response = await ports.fetch(`${ports.origin}/api/workspace${path}`, {
      ...init, headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw responseError(response.status, body);
    return body;
  }
  function closeSession(session: StoredSession, error: string, keepDraft: boolean) {
    generation++;
    cancelExpiry?.(); cancelExpiry = null;
    active = null;
    retained = keepDraft ? session : null;
    if (!keepDraft) drafts.clear();
    if (state.account) {
      try { ports.storage.removeItem(sessionStorageKey(ports.origin, state.account)); } catch { /* Optional storage. */ }
    }
    publish({ state: "CLOSED", account: state.account, generation, error });
    return generation;
  }
  function lockExpired(session: StoredSession) {
    const closed = closeSession(session, "Akses dikunci. Alasan berakhirnya sesi sedang diperiksa.", true);
    void json("", { headers: { Authorization: `Bearer ${session.token}` } }).then(() => {
      if (closed === generation) publish({ ...state, error: "Waktu sesi perlu diperiksa kembali. Masuk kembali untuk membuka ruang kerja." });
    }).catch(error => {
      if (closed !== generation) return;
      if (error instanceof WorkspaceRequestError && error.status === 401) {
        if (error.sessionEnd !== "EXPIRED") { drafts.clear(); retained = null; }
        publish({ ...state, error: error.sessionEnd === "EXPIRED"
          ? "Sesi kedaluwarsa. Masuk kembali untuk memulihkan draf pada tab ini." : error.message });
      } else if (error instanceof WorkspaceRequestError && ["no-membership", "membership-inactive"].includes(error.reason ?? "")) {
        drafts.clear(); retained = null;
        publish({ ...state, error: error.message });
      } else publish({ ...state, error: "Alasan berakhirnya sesi belum dapat diperiksa. Draf tetap tersembunyi di tab ini." });
    });
  }
  function scheduleExpiry(session: StoredSession, started: number) {
    cancelExpiry?.();
    cancelExpiry = ports.schedule(() => {
      if (started !== generation) return;
      if (ports.now() > session.expiresAt) lockExpired(session);
      else scheduleExpiry(session, started);
    }, Math.min(2_147_483_647, Math.max(0, (session.expiresAt - ports.now() + 1) * 1000)));
  }
  async function activate(session: StoredSession, account: string, started: number, institutionId: string) {
    if (!session || typeof session.token !== "string" || !session.token || !Number.isFinite(session.expiresAt)
      || typeof session.institutionId !== "string") throw new Error("Sesi yang diterima tidak sah.");
    const workspace: Workspace = await json("", { headers: { Authorization: `Bearer ${session.token}` } });
    current(started);
    if (workspace.account.toLowerCase() !== account.toLowerCase() || workspace.institution.id !== session.institutionId
      || session.institutionId !== institutionId) throw new Error("Identitas ruang kerja tidak cocok.");
    if (retained) {
      try {
        await json("", { headers: { Authorization: `Bearer ${retained.token}` } });
        current(started);
        // A response that no longer establishes expiry cannot restore the old draft.
        drafts.clear();
      } catch (error) {
        current(started);
        if (!(error instanceof WorkspaceRequestError)) throw error;
        if (error.status === 401) {
          if (error.sessionEnd !== "EXPIRED") drafts.clear();
        } else if (["membership-inactive", "no-membership"].includes(error.reason ?? "")) drafts.clear();
        else throw error;
      }
      current(started);
    }
    if (ports.now() > session.expiresAt) { lockExpired(session); return; }
    retained = null;
    try { ports.storage.setItem(sessionStorageKey(ports.origin, account), JSON.stringify(session)); } catch { /* Tab storage is optional. */ }
    const requests = createPrivateRequests({ origin: ports.origin, token: session.token, contextId: `${ports.origin}:${account}:${generation}`,
      fetch: ports.fetch, assertCurrent: () => current(started), denied: error => {
        if (error.status !== 401 && !["no-membership", "membership-inactive"].includes(error.reason ?? "")) return;
        closeSession(session, error.message, error.status === 401 && error.sessionEnd === "EXPIRED");
      } });
    active = session;
    publish({ state: "READY", account, workspace, requests, error: null, generation });
    scheduleExpiry(session, started);
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() {
      generation++; cancelExpiry?.(); cancelExpiry = null;
      active = null; retained = null; drafts.clear();
      publish({ state: "CLOSED", account: null, generation, error: null });
    },
    unsavedReport(preparationId: string) {
      if (state.state !== "READY") return { state: "HIDDEN" as const };
      const requests = state.requests;
      return { state: "EDITABLE" as const, value: drafts.get(preparationId) ?? null,
        change(next: UnsavedReport) {
          requests.assertCurrent();
          // Only editable report inputs are retained, never review or signing material.
          drafts.set(preparationId, { reportId: next.reportId, version: next.version, predecessor: next.predecessor,
            reason: next.reason, narrative: next.narrative, amounts: { ...next.amounts } });
          publish({ ...state });
        } };
    },
    async connect(account: string | null) {
      if (account?.toLowerCase() === state.account?.toLowerCase()) return;
      generation++;
      cancelExpiry?.(); cancelExpiry = null; active = null;
      drafts.clear(); retained = null;
      publish({ state: "CLOSED", account, error: null, generation });
      if (!account) return;
      const key = sessionStorageKey(ports.origin, account);
      let restored: StoredSession | null = null;
      try { restored = JSON.parse(ports.storage.getItem(key) ?? "null"); } catch { /* No usable stored session. */ }
      if (!restored) return;
      const started = generation;
      publish({ state: "OPENING", account, generation, error: null });
      try { await activate(restored, account, started, restored.institutionId); }
      catch (error) {
        if (started !== generation) return;
        if (error instanceof WorkspaceRequestError && error.status === 401) {
          closeSession(restored, error.message, error.sessionEnd === "EXPIRED");
        } else publish({ state: "CLOSED", account, generation, error: error instanceof Error ? error.message : "Sesi belum dapat diperiksa." });
      }
    },
    async leave() {
      const session = active ?? retained;
      const account = state.account;
      const closed = ++generation;
      cancelExpiry?.(); cancelExpiry = null;
      active = null; retained = null; drafts.clear();
      if (account) {
        try { ports.storage.removeItem(sessionStorageKey(ports.origin, account)); } catch { /* Optional storage. */ }
      }
      publish({ state: "CLOSED", account, generation, error: null });
      let serverRevoked = !session;
      if (session) {
        try { await json("/session", { method: "DELETE", headers: { Authorization: `Bearer ${session.token}` } }); serverRevoked = true; }
        catch { /* Local access has ended, but the server's result is unknown. */ }
      }
      if (!serverRevoked && closed === generation) publish({ ...state,
        error: "Anda sudah keluar dari tab ini. Pencabutan sesi di server belum terkonfirmasi." });
      return { serverRevoked };
    },
    async enter(institutionId: string) {
      if (!state.account) return;
      const account = state.account;
      if (active) { drafts.clear(); retained = null; }
      cancelExpiry?.(); cancelExpiry = null; active = null;
      if (retained && retained.institutionId !== institutionId) { drafts.clear(); retained = null; }
      const started = ++generation;
      publish({ state: "OPENING", account, error: null, generation });
      try {
        const opened = await openWorkspaceSession({
          requestChallenge: async () => {
            const result = await json("/challenge", { method: "POST", body: JSON.stringify({ institutionId, account }) });
            current(started);
            if (result.challenge.account.toLowerCase() !== account.toLowerCase() || result.challenge.institutionId !== institutionId) throw new Error("Identitas tantangan tidak cocok.");
            return result;
          },
          sign: async payload => { current(started); const signature = await ports.sign(payload); current(started); return signature; },
          exchange: async (nonce, signature) => {
            current(started);
            const session = await json("/session", { method: "POST", body: JSON.stringify({ nonce, signature }) });
            current(started); return session;
          },
        }, { institutionId, account });
        current(started);
        if (!opened.ok) throw opened.cause;
        await activate(opened.session, account, started, institutionId);
      } catch (error) {
        if (started === generation && error instanceof WorkspaceRequestError && ["no-membership", "membership-inactive"].includes(error.reason ?? "")) {
          retained = null; drafts.clear();
        }
        if (started === generation) publish({ state: "CLOSED", account, generation,
          error: error instanceof Error ? error.message : "Gagal masuk ke ruang kerja." });
      }
    },
  };
}

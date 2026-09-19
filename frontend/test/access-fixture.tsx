import { useSyncExternalStore, type ReactNode } from "react";
import { getApiBaseUrl } from "../src/lib/contracts";
import { createWorkspaceAccess } from "../src/features/workspace/workspaceAccessController";
import { WorkspaceAccessProvider } from "../src/features/workspace/useWorkspaceAccess";
import { sessionStorageKey } from "../src/features/workspace/workspaceSession";
import type { PrivateRequests } from "../src/features/workspace/privateRequests";

// Existing HTTP fixtures seed a session; the same production owner validates it
// and handles every subsequent private request and invalidation.
export async function fixtureAccess(token: string) {
  const origin = getApiBaseUrl() || window.location.origin;
  const workspace = await (await fetch(origin + "/api/workspace", { headers: { Authorization: `Bearer ${token}` } })).json();
  sessionStorage.setItem(sessionStorageKey(origin, workspace.account), JSON.stringify({
    token, institutionId: workspace.institution.id, role: workspace.role, expiresAt: Math.floor(Date.now() / 1000) + 3600,
  }));
  const access = createWorkspaceAccess({ origin, fetch: (url, init) => fetch(url, init),
    sign: async () => { throw new Error("Use the full workspace harness for sign-in."); },
    storage: sessionStorage, now: () => Math.floor(Date.now() / 1000),
    schedule: (task, delay) => { const timer = setTimeout(task, delay); return () => clearTimeout(timer); },
  });
  await access.connect(workspace.account);
  return access;
}
export function FixtureAccess({ access, children }: { access: Awaited<ReturnType<typeof fixtureAccess>>; children: (requests: PrivateRequests) => ReactNode }) {
  const state = useSyncExternalStore(access.subscribe, access.getSnapshot, access.getSnapshot);
  return <WorkspaceAccessProvider access={access}>{state.state === "READY" ? children(state.requests)
    : <p role="alert">{state.error ?? "Akses ruang kerja sudah berakhir."}</p>}</WorkspaceAccessProvider>;
}

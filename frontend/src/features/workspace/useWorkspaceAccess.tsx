import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { getApiBaseUrl } from "../../lib/contracts";
import { createWorkspaceAccess, type UnsavedReport } from "./workspaceAccessController";
import type { PrivateRequests } from "./privateRequests";

type WorkspaceAccess = ReturnType<typeof createWorkspaceAccess>;
const AccessContext = createContext<WorkspaceAccess | null>(null);

export function WorkspaceAccessProvider({ access, children }: { access: WorkspaceAccess; children: ReactNode }) {
  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>;
}

export function useWalletWorkspaceAccess() {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const signer = useRef(signTypedDataAsync);
  signer.current = signTypedDataAsync;
  const [access] = useState(() => createWorkspaceAccess({
    origin: new URL(getApiBaseUrl() || "/", typeof window === "undefined" ? "http://localhost" : window.location.origin).href.replace(/\/$/, ""), fetch: (url, init) => fetch(url, init),
    sign: payload => signer.current(payload as Parameters<typeof signTypedDataAsync>[0]),
    storage: { getItem: key => sessionStorage.getItem(key), setItem: (key, value) => sessionStorage.setItem(key, value), removeItem: key => sessionStorage.removeItem(key) },
    now: () => Math.floor(Date.now() / 1000),
    schedule: (task, delay) => { const timer = setTimeout(task, delay); return () => clearTimeout(timer); },
  }));
  useLayoutEffect(() => { void access.connect(isConnected && address ? address : null); }, [access, address, isConnected]);
  useEffect(() => () => access.dispose(), [access]);
  return access;
}

function useOwner() {
  const owner = useContext(AccessContext);
  if (!owner) throw new Error("Ruang kerja memerlukan pemilik akses.");
  return owner;
}

export function useWorkspaceAccess() {
  const owner = useOwner();
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { ...state, enter: owner.enter, leave: owner.leave };
}

const emptyReport: UnsavedReport = { reportId: "", version: "1", predecessor: "", reason: "", narrative: "", amounts: {} };

export function useUnsavedReport(preparationId: string, requests: PrivateRequests) {
  const owner = useOwner();
  useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const draft = owner.unsavedReport(preparationId);
  return { value: draft.state === "EDITABLE" ? draft.value ?? emptyReport : emptyReport,
    restored: draft.state === "EDITABLE" && draft.value !== null,
    change(patch: Partial<UnsavedReport>) {
      requests.assertCurrent();
      const current = owner.unsavedReport(preparationId);
      if (current.state !== "EDITABLE") return;
      current.change({ ...current.value ?? emptyReport, ...patch });
    } };
}

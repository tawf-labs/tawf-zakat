import { useQueryClient } from "@tanstack/react-query";
import { authorityKey } from "./useAuthorityManagement";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessContextChanged, WorkspaceRequestError, type PrivateRequests } from "./privateRequests";
import { useWorkspaceAccess } from "./useWorkspaceAccess";
import { fetchOfficers, type OfficerWithAccounts } from "./workspaceClient";

/** One list owner; every result still passes the workspace owner's context gate. */
export function useOfficerManagement(requests: PrivateRequests) {
  const { refresh } = useWorkspaceAccess();
  const client = useQueryClient();
  const [officers, setOfficers] = useState<OfficerWithAccounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const currentLoad = useRef(0);
  const load = useCallback(async () => {
    const revision = ++currentLoad.current;
    setLoading(true);
    try {
      const records = await fetchOfficers(requests);
      requests.assertCurrent();
      if (revision === currentLoad.current) setOfficers(records);
    } catch (cause) {
      if (!(cause instanceof AccessContextChanged) && revision === currentLoad.current) {
        setError("Daftar petugas belum dapat dibaca. Coba muat ulang.");
      }
    } finally { if (revision === currentLoad.current) setLoading(false); }
  }, [requests]);
  useEffect(() => { void load(); return () => { currentLoad.current++; }; }, [load]);
  async function run(operation: () => Promise<unknown>, success: string) {
    setError(""); setMessage("");
    try {
      await operation();
      requests.assertCurrent();
      setMessage(success);
      await load();
      await client.invalidateQueries({ queryKey: authorityKey(requests) });
      try { await refresh(); }
      catch (cause) {
        if (cause instanceof AccessContextChanged) return false;
        setError("Perubahan tersimpan, tetapi identitas header belum dapat dimuat ulang. Coba muat ulang petugas.");
      }
      return true;
    } catch (cause) {
      if (cause instanceof AccessContextChanged) return false;
      setError(cause instanceof WorkspaceRequestError && cause.status < 500
        ? cause.message
        : "Hasil penyimpanan belum diketahui. Muat ulang daftar atau coba kembali dengan data yang sama.");
      return false;
    }
  }
  async function reload() {
    await load();
    try { await refresh(); }
    catch (cause) { if (!(cause instanceof AccessContextChanged)) setError("Identitas header belum dapat dimuat ulang."); }
  }
  return { officers, loading, message, error, load: reload, run };
}
export type OfficerOperation = ReturnType<typeof useOfficerManagement>["run"];

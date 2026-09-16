import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AccessContextChanged, type PrivateRequests } from "./privateRequests";
import { useWorkspaceAccess } from "./useWorkspaceAccess";
import { fetchMandates, fetchEndorsementAccounts, fetchOfficers } from "./workspaceClient";

export const authorityKey = (requests: PrivateRequests) => ["workspace-authority", requests.contextId] as const;

export function useMandates(requests: PrivateRequests) {
  return useQuery({ queryKey: [...authorityKey(requests), "mandates"], queryFn: () => fetchMandates(requests) });
}
export function useEndorsements(requests: PrivateRequests) {
  return useQuery({ queryKey: [...authorityKey(requests), "endorsements"], queryFn: () => fetchEndorsementAccounts(requests, true) });
}
export function useAuthorityOfficers(requests: PrivateRequests) {
  return useQuery({ queryKey: [...authorityKey(requests), "officers"], queryFn: () => fetchOfficers(requests) });
}

/** Invalidate all views of authority, including the access owner's navbar snapshot. */
export function useAuthorityManagement(requests: PrivateRequests) {
  const client = useQueryClient();
  const { refresh } = useWorkspaceAccess();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function reload() {
    requests.assertCurrent();
    await Promise.all([
      client.invalidateQueries({ queryKey: authorityKey(requests) }, { throwOnError: true }),
      refresh(),
    ]);
    requests.assertCurrent();
  }
  async function run(operation: () => Promise<unknown>, success: string) {
    setBusy(true); setError(""); setMessage("");
    let saved = false;
    try {
      requests.assertCurrent();
      await operation();
      requests.assertCurrent();
      saved = true;
      await reload();
      setMessage(success);
      return true;
    } catch (cause) {
      if (cause instanceof AccessContextChanged) return false;
      setError(saved ? "Perubahan tersimpan, tetapi tampilan kewenangan belum dapat dimuat ulang. Muat ulang sebelum melanjutkan."
        : cause instanceof Error ? cause.message : "Hasil perubahan belum diketahui. Muat ulang sebelum mencoba kembali.");
      return saved;
    } finally { setBusy(false); }
  }
  return { busy, message, error, run, reload: () => run(async () => {}, "Data kewenangan dimuat ulang.") };
}
export type AuthorityManagement = ReturnType<typeof useAuthorityManagement>;

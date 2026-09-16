import { useState } from "react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "./privateRequests";
import { registerEndorsementAccount, updateEndorsementAccount, revokeEndorsementAccount, type InstitutionalEndorsementAccount } from "./workspaceClient";
import { useAuthorityManagement, useAuthorityOfficers, useEndorsements } from "./useAuthorityManagement";
import { AuthorityManagementFrame } from "./AuthorityManagementFrame";
import { EndorsementAccountForm } from "./EndorsementAccountForm";

export function EndorsementAccountSection({ requests }: { requests: PrivateRequests }) {
  const accounts = useEndorsements(requests);
  const officers = useAuthorityOfficers(requests);
  const state = useAuthorityManagement(requests);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<InstitutionalEndorsementAccount | null>(null);
  async function changeState(account: InstitutionalEndorsementAccount) {
    const activate = !account.isActive;
    if (!window.confirm(activate ? "Aktifkan kembali akun pengesahan berdasarkan otorisasi terbaru ini?" : "Nonaktifkan akun pengesahan lembaga ini?")) return;
    await state.run(() => activate
      ? updateEndorsementAccount(requests, account.id, { expectedVersion: account.version, isActive: true })
      : revokeEndorsementAccount(requests, account.id, account.version), activate ? "Akun pengesahan diaktifkan kembali." : "Akun pengesahan lembaga telah dinonaktifkan.");
  }
  return <AuthorityManagementFrame label="Manajemen Akun Pengesahan Lembaga" title="Pendaftaran Akun Pengesahan Lembaga"
    createLabel="Daftarkan Akun" creating={creating} toggle={() => setCreating(!creating)} state={state} error={accounts.error || officers.error}>
    {creating && officers.data && <EndorsementAccountForm officers={officers.data} busy={state.busy} cancel={() => setCreating(false)} submit={async values => {
      if (await state.run(() => registerEndorsementAccount(requests, values), "Akun pengesahan lembaga berhasil didaftarkan.")) setCreating(false);
    }} />}
    {accounts.isPending && <p>Memuat akun pengesahan…</p>}
    {accounts.data?.map(account => <div key={account.id} className="rounded-xl border border-stone-200 p-4">
      {editing?.id === account.id ? <EndorsementAccountForm key={editing.id} initial={editing} officers={officers.data ?? []} busy={state.busy}
        cancel={() => setEditing(null)} submit={async (values, version) => {
          if (await state.run(() => updateEndorsementAccount(requests, account.id, { expectedVersion: version!,
            label: values.label, authorizedOfficerIds: values.authorizedOfficerIds,
          }), "Perubahan akun pengesahan tersimpan.")) setEditing(null);
        }} /> : <>
        <div className="flex flex-wrap justify-between gap-3">
          <div><h4 className="font-semibold">{account.label}</h4><p className="text-xs">{account.isActive ? "Aktif" : "Nonaktif"} · Versi {account.version}</p></div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={state.busy} onClick={() => setEditing(account)}>Ubah</Button>
            <Button size="sm" variant="outline" disabled={state.busy} onClick={() => void changeState(account)}>{account.isActive ? "Nonaktifkan" : "Aktifkan kembali"}</Button>
          </div>
        </div>
        <p className="mt-2 break-all font-mono text-xs">{account.accountAddress}</p>
        <p className="mt-2 text-xs text-stone-600">{account.authorizedOfficerIds.length === 0 ? "Dapat dipilih oleh semua petugas lembaga"
          : account.authorizedOfficerIds.map(id => officers.data?.find(o => o.id === id)?.displayName ?? id).join(", ")}</p>
      </>}
    </div>)}
    {accounts.data?.length === 0 && <p className="text-sm text-stone-500">Belum ada akun pengesahan lembaga yang didaftarkan.</p>}
  </AuthorityManagementFrame>;
}

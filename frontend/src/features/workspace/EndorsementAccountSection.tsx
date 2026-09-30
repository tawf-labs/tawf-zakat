import { useState } from "react";
import { Check, Copy, KeyRound, Loader2, Pencil, RotateCcw, ShieldCheck, Users, XCircle } from "lucide-react";
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
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function changeState(account: InstitutionalEndorsementAccount) {
    const activate = !account.isActive;
    if (!window.confirm(activate ? "Aktifkan kembali akun pengesahan berdasarkan otorisasi terbaru ini?" : "Nonaktifkan akun pengesahan lembaga ini?")) return;
    await state.run(() => activate
      ? updateEndorsementAccount(requests, account.id, { expectedVersion: account.version, isActive: true })
      : revokeEndorsementAccount(requests, account.id, account.version), activate ? "Akun pengesahan diaktifkan kembali." : "Akun pengesahan lembaga telah dinonaktifkan.");
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return <AuthorityManagementFrame label="Manajemen Akun Pengesahan Lembaga" title="Pendaftaran Akun Pengesahan Lembaga"
    createLabel="Daftarkan Akun" creating={creating} toggle={() => setCreating(!creating)} state={state} error={accounts.error || officers.error}>
    {creating && officers.data && <EndorsementAccountForm officers={officers.data} busy={state.busy} cancel={() => setCreating(false)} submit={async values => {
      if (await state.run(() => registerEndorsementAccount(requests, values), "Akun pengesahan lembaga berhasil didaftarkan.")) setCreating(false);
    }} />}

    {accounts.isPending && (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-stone-500">
        <Loader2 className="h-4 w-4 animate-spin text-[#1b765e]" />
        <span>Memuat akun pengesahan…</span>
      </div>
    )}

    {accounts.data?.map(account => (
      <div key={account.id} className="rounded-2xl border border-stone-200/90 bg-stone-50/40 p-5 hover:border-emerald-300/80 transition-all shadow-2xs space-y-3.5">
        {editing?.id === account.id ? <EndorsementAccountForm key={editing.id} initial={editing} officers={officers.data ?? []} busy={state.busy}
          cancel={() => setEditing(null)} submit={async (values, version) => {
            if (await state.run(() => updateEndorsementAccount(requests, account.id, { expectedVersion: version!,
              label: values.label, authorizedOfficerIds: values.authorizedOfficerIds,
            }), "Perubahan akun pengesahan tersimpan.")) setEditing(null);
          }} /> : <>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200/60 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-2 text-[#1b765e]">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <h4 className="font-semibold text-base text-[#17332c]">{account.label}</h4>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                account.isActive
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200/80"
                  : "bg-stone-100 text-stone-600 border-stone-200"
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${account.isActive ? "bg-emerald-600" : "bg-stone-400"}`} />
                {account.isActive ? "Aktif" : "Nonaktif"}
              </span>

              <Button size="sm" variant="outline" disabled={state.busy} onClick={() => setEditing(account)}>
                <Pencil className="mr-1 h-3 w-3 text-stone-500" />
                Ubah
              </Button>
              <Button size="sm" variant="outline" disabled={state.busy} onClick={() => void changeState(account)}>
                {account.isActive ? (
                  <>
                    <XCircle className="mr-1 h-3 w-3 text-amber-600" />
                    Nonaktifkan
                  </>
                ) : (
                  <>
                    <RotateCcw className="mr-1 h-3 w-3 text-emerald-600" />
                    Aktifkan kembali
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-stone-200/80 bg-white p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-2 min-w-0">
              <KeyRound className="h-4 w-4 text-stone-400 shrink-0" />
              <p className="break-all font-mono text-xs text-[#17332c]">{account.accountAddress}</p>
            </div>
            <button
              type="button"
              onClick={() => copyToClipboard(account.accountAddress)}
              title="Salin alamat akun pengesahan"
              className="text-stone-400 hover:text-stone-700 transition-colors p-1"
            >
              {copiedId === account.accountAddress ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-stone-600 pl-1">
            <Users className="h-3.5 w-3.5 text-stone-400 shrink-0" />
            <span className="font-medium text-stone-500">Otorisasi:</span>
            <p className="text-xs text-stone-600">
              {account.authorizedOfficerIds.length === 0
                ? "Dapat dipilih oleh semua petugas lembaga"
                : account.authorizedOfficerIds.map(id => officers.data?.find(o => o.id === id)?.displayName ?? id).join(", ")}
            </p>
          </div>
        </>}
      </div>
    ))}

    {accounts.data?.length === 0 && (
      <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50/50 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100 text-stone-400">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h4 className="mt-3 text-sm font-semibold text-stone-900">Belum ada akun pengesahan lembaga yang didaftarkan.</h4>
        <p className="mt-1 text-xs text-stone-500">Daftarkan akun resmi yang berwenang menandatangani keputusan lembaga.</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => setCreating(true)}>
          <ShieldCheck className="mr-1.5 h-3.5 w-3.5 text-stone-500" />
          Daftarkan Akun Pertama
        </Button>
      </div>
    )}
  </AuthorityManagementFrame>;
}

import { useRef, useState } from "react";
import { Check, Copy, KeyRound, Pencil, Shield, UserCheck, UserX, Wallet } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { linkOfficerAccount, unlinkOfficerAccount, updateOfficer, type OfficerWithAccounts } from "./workspaceClient";
import type { PrivateRequests } from "./privateRequests";
import type { OfficerOperation } from "./useOfficerManagement";
import { OfficerAccountFields, type OfficerAccountInput } from "./OfficerAccountFields";

export function OfficerProfileCard({ officer, requests, run }: { officer: OfficerWithAccounts; requests: PrivateRequests; run: OfficerOperation }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(officer.displayName);
  const [linking, setLinking] = useState(false);
  const [account, setAccount] = useState<OfficerAccountInput>({ account: "", role: "OFFICER" });
  const [busy, setBusy] = useState(false);
  const [copiedAccount, setCopiedAccount] = useState<string | null>(null);
  const submitting = useRef(false);

  async function save(operation: () => Promise<unknown>, message: string) {
    if (submitting.current) return false;
    submitting.current = true; setBusy(true);
    try { return await run(operation, message); }
    finally { submitting.current = false; setBusy(false); }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedAccount(text);
    setTimeout(() => setCopiedAccount(null), 2000);
  };

  const initials = officer.displayName
    ? officer.displayName.split(" ").filter(Boolean).map(n => n[0]).slice(0, 2).join("").toUpperCase()
    : "AM";

  return <article className="space-y-4 rounded-2xl border border-stone-200/90 bg-stone-50/40 p-5 hover:border-emerald-300/80 transition-all shadow-2xs" aria-label={`Profil ${officer.displayName}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-center gap-3.5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#17332c] to-[#1b765e] font-serif font-bold text-white shadow-xs">
          {initials}
        </div>
        <div>
          <h4 className="font-semibold text-base text-[#17332c]">{officer.displayName}</h4>
          <p className="text-xs text-stone-500 font-mono mt-0.5">ID petugas: {officer.id}</p>
        </div>
      </div>
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
        officer.isActive
          ? "bg-emerald-50 text-emerald-800 border-emerald-200/80"
          : "bg-stone-100 text-stone-600 border-stone-200"
      }`}>
        <span className={`h-1.5 w-1.5 rounded-full ${officer.isActive ? "bg-emerald-600" : "bg-stone-400"}`} />
        {officer.isActive ? "Aktif" : "Nonaktif"}
      </span>
    </div>

    {editing && <form onSubmit={async event => {
      event.preventDefault();
      if (await save(() => updateOfficer(requests, officer.id, { displayName: name.trim() }), "Nama petugas tersimpan.")) setEditing(false);
    }} className="flex flex-wrap items-end gap-2 rounded-xl border border-emerald-200 bg-white p-3 shadow-2xs">
      <label htmlFor={`name-${officer.id}`} className="block text-xs font-medium text-stone-700">Nama petugas
        <input id={`name-${officer.id}`} required value={name} onChange={event => setName(event.target.value)}
          className="mt-1 block rounded-lg border border-stone-300 px-3 py-1.5 text-sm focus:border-[#1b765e] focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
      </label>
      <Button disabled={busy || !name.trim()} type="submit" size="sm">Simpan nama</Button>
      <Button disabled={busy} variant="outline" size="sm" type="button" onClick={() => setEditing(false)}>Batal</Button>
    </form>}

    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-stone-200/60">
      <Button disabled={busy} variant="outline" size="sm" onClick={() => { setName(officer.displayName); setEditing(true); }}>
        <Pencil className="mr-1.5 h-3.5 w-3.5 text-stone-500" />
        Ubah nama
      </Button>
      <Button disabled={busy || !officer.isActive} variant="outline" size="sm" onClick={() => setLinking(!linking)}>
        <KeyRound className="mr-1.5 h-3.5 w-3.5 text-stone-500" />
        Tautkan Akun
      </Button>
      <Button disabled={busy} variant="outline" size="sm" onClick={() => void save(() => updateOfficer(requests, officer.id, { isActive: !officer.isActive }), "Status petugas tersimpan.")}>
        {officer.isActive ? (
          <>
            <UserX className="mr-1.5 h-3.5 w-3.5 text-amber-600" />
            Nonaktifkan
          </>
        ) : (
          <>
            <UserCheck className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
            Aktifkan
          </>
        )}
      </Button>
    </div>

    {linking && <form className="space-y-3 rounded-xl border border-emerald-200/90 bg-emerald-50/20 p-4 shadow-2xs" onSubmit={async event => {
      event.preventDefault();
      if (await save(() => linkOfficerAccount(requests, officer.id, { ...account, account: account.account.trim() }), "Akun kerja tertaut.")) {
        setLinking(false); setAccount({ account: "", role: "OFFICER" });
      }
    }}>
      <div className="flex items-center gap-2 pb-1 border-b border-emerald-100">
        <KeyRound className="h-4 w-4 text-[#1b765e]" />
        <h5 className="text-xs font-semibold text-[#17332c]">Tautkan Alamat Dompet ke Petugas Ini</h5>
      </div>
      <OfficerAccountFields value={account} change={setAccount} />
      <div className="flex items-center gap-2 pt-1">
        <Button disabled={busy} type="submit" size="sm">Tautkan</Button>
        <Button disabled={busy} type="button" variant="outline" size="sm" onClick={() => setLinking(false)}>Batal</Button>
      </div>
    </form>}

    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-600">
        <Wallet className="h-3.5 w-3.5 text-stone-400" />
        <span>Akun Kerja Tertaut ({officer.accounts.length})</span>
      </div>

      <ul className="space-y-2">
        {officer.accounts.map(member => (
          <li key={member.account} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200/80 bg-white p-3 shadow-2xs">
            <div className="flex items-center gap-2 min-w-0">
              <code className="break-all font-mono text-xs text-[#17332c] bg-stone-100/80 px-2 py-0.5 rounded border border-stone-200/60">
                {member.account}
              </code>
              <button
                type="button"
                onClick={() => copyToClipboard(member.account)}
                title="Salin alamat dompet"
                className="text-stone-400 hover:text-stone-700 transition-colors p-1"
              >
                {copiedAccount === member.account ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold border ${
                member.role === "ADMIN"
                  ? "bg-purple-100/90 text-purple-900 border-purple-200/80"
                  : member.role === "OFFICER"
                  ? "bg-emerald-100/90 text-emerald-900 border-emerald-200/80"
                  : "bg-stone-100 text-stone-700 border-stone-200"
              }`}>
                {member.role === "ADMIN" && <Shield className="h-3 w-3" />}
                <span className="text-xs">
                  {member.role === "ADMIN" ? "Administrator lembaga" : member.role === "OFFICER" ? "Petugas" : "Pembaca berwenang"} · {member.isActive ? "Aktif" : "Nonaktif"}
                </span>
              </span>

              {member.isActive && (
                <Button
                  disabled={busy}
                  variant="outline"
                  size="sm"
                  aria-label={`Nonaktifkan akun ${member.account}`}
                  onClick={() => void save(() => unlinkOfficerAccount(requests, officer.id, member.account), "Akun dinonaktifkan.")}
                  className="text-stone-600 hover:text-rose-700 hover:border-rose-300"
                >
                  Lepas akun
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {officer.accounts.length === 0 && (
        <p className="rounded-xl border border-dashed border-stone-200 bg-stone-50/50 py-3 text-center text-xs text-stone-500">
          Belum ada akun kerja tertaut.
        </p>
      )}
    </div>

    {busy && <p role="status" className="text-xs font-medium text-amber-700">Sedang menyimpan…</p>}
  </article>;
}

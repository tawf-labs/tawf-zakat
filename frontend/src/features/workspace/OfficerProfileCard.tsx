import { useRef, useState } from "react";
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
  const submitting = useRef(false);
  async function save(operation: () => Promise<unknown>, message: string) {
    if (submitting.current) return false;
    submitting.current = true; setBusy(true);
    try { return await run(operation, message); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <article className="space-y-3 rounded-xl border p-4" aria-label={`Profil ${officer.displayName}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-semibold">{officer.displayName}</h4><span>{officer.isActive ? "Aktif" : "Nonaktif"}</span>
    </div>
    <p className="text-xs text-stone-500">ID petugas: {officer.id}</p>
    {editing && <form onSubmit={async event => {
      event.preventDefault();
      if (await save(() => updateOfficer(requests, officer.id, { displayName: name.trim() }), "Nama petugas tersimpan.")) setEditing(false);
    }} className="flex flex-wrap items-end gap-2">
      <label htmlFor={`name-${officer.id}`}>Nama petugas
        <input id={`name-${officer.id}`} required value={name} onChange={event => setName(event.target.value)} className="ml-2 rounded border p-2" />
      </label><Button disabled={busy || !name.trim()} type="submit">Simpan nama</Button>
      <Button disabled={busy} variant="outline" type="button" onClick={() => setEditing(false)}>Batal</Button>
    </form>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy} variant="outline" onClick={() => { setName(officer.displayName); setEditing(true); }}>Ubah nama</Button>
      <Button disabled={busy || !officer.isActive} variant="outline" onClick={() => setLinking(!linking)}>Tautkan Akun</Button>
      <Button disabled={busy} variant="outline" onClick={() => void save(() => updateOfficer(requests, officer.id, { isActive: !officer.isActive }), "Status petugas tersimpan.")}>
        {officer.isActive ? "Nonaktifkan" : "Aktifkan"}
      </Button>
    </div>
    {linking && <form className="space-y-2 rounded border p-3" onSubmit={async event => {
      event.preventDefault();
      if (await save(() => linkOfficerAccount(requests, officer.id, { ...account, account: account.account.trim() }), "Akun kerja tertaut.")) {
        setLinking(false); setAccount({ account: "", role: "OFFICER" });
      }
    }}><OfficerAccountFields value={account} change={setAccount} />
      <Button disabled={busy} type="submit">Tautkan</Button>
      <Button disabled={busy} type="button" variant="outline" onClick={() => setLinking(false)}>Batal</Button>
    </form>}
    <ul className="space-y-2">{officer.accounts.map(member => <li key={member.account} className="flex flex-wrap items-center justify-between gap-2 rounded bg-stone-50 p-2">
      <code className="break-all text-xs">{member.account}</code>
      <span className="text-xs">{member.role === "ADMIN" ? "Administrator lembaga" : member.role === "OFFICER" ? "Petugas" : "Pembaca berwenang"} · {member.isActive ? "Aktif" : "Nonaktif"}</span>
      {member.isActive && <Button disabled={busy} variant="outline" aria-label={`Nonaktifkan akun ${member.account}`}
        onClick={() => void save(() => unlinkOfficerAccount(requests, officer.id, member.account), "Akun dinonaktifkan.")}>Lepas akun</Button>}
    </li>)}</ul>
    {officer.accounts.length === 0 && <p className="text-sm text-stone-500">Belum ada akun kerja tertaut.</p>}
    {busy && <p role="status">Sedang menyimpan…</p>}
  </article>;
}

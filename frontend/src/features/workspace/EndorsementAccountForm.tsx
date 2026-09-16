import { useState } from "react";
import { Button } from "../../components/ui/Button";
import type { InstitutionalEndorsementAccount, OfficerWithAccounts, registerEndorsementAccount } from "./workspaceClient";

type AccountValues = Parameters<typeof registerEndorsementAccount>[1];
const fieldClass = "mt-1 w-full rounded-lg border border-stone-300 bg-white p-2 text-sm";

export function EndorsementAccountForm({ initial, officers, busy, submit, cancel }: {
  initial?: InstitutionalEndorsementAccount; officers: OfficerWithAccounts[]; busy: boolean;
  submit: (values: AccountValues, version?: number) => Promise<void>; cancel: () => void;
}) {
  const [opened] = useState(initial);
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const [address, setAddress] = useState(initial?.accountAddress ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [authorizedOfficerIds, setOfficers] = useState(initial?.authorizedOfficerIds ?? []);
  return <form className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/30 p-4" onSubmit={event => {
    event.preventDefault();
    void submit({ id, accountAddress: address.trim(), label: label.trim(), authorizedOfficerIds }, opened?.version);
  }}>
    <fieldset disabled={busy} className="space-y-3">
      <label htmlFor={`${id}-address`} className="block text-xs">Alamat Akun Ethereum (Wallet Lembaga) *
        <input id={`${id}-address`} required disabled={!!initial} value={address} onChange={e => setAddress(e.target.value)} className={fieldClass} />
      </label>
      <label htmlFor={`${id}-label`} className="block text-xs">Label / Deskripsi Rekening Pengesahan *
        <input id={`${id}-label`} required value={label} onChange={e => setLabel(e.target.value)} className={fieldClass} />
      </label>
      <fieldset className="space-y-2 rounded border border-stone-200 p-3">
        <legend className="text-xs font-medium">Petugas yang Diotorisasi Memilih Akun Ini (Opsional)</legend>
        <p className="text-xs text-stone-500">Jika tidak ada yang dicentang, semua petugas lembaga dapat memilih akun pengesahan ini.</p>
        {officers.map(officer => <label key={officer.id} className="flex gap-2 text-sm">
          <input type="checkbox" checked={authorizedOfficerIds.includes(officer.id)} disabled={!officer.isActive}
            onChange={e => setOfficers(e.target.checked ? [...authorizedOfficerIds, officer.id] : authorizedOfficerIds.filter(id => id !== officer.id))} />
          {officer.displayName}
        </label>)}
      </fieldset>
    </fieldset>
    <div className="flex gap-2">
      <Button type="submit" size="sm" disabled={busy}>{busy ? "Menyimpan…" : initial ? "Simpan" : "Daftarkan Akun Pengesahan"}</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={cancel}>Batal</Button>
    </div>
  </form>;
}

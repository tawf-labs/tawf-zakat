import { useState } from "react";
import { Button } from "../../components/ui/Button";
import type { InstitutionalEndorsementAccount, OfficerWithAccounts, registerEndorsementAccount } from "./workspaceClient";

type AccountValues = Parameters<typeof registerEndorsementAccount>[1];
const fieldClass = "mt-1.5 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-800 placeholder:text-stone-400 focus:border-[#1b765e] focus:outline-none focus:ring-2 focus:ring-emerald-500/20";

export function EndorsementAccountForm({ initial, officers, busy, submit, cancel }: {
  initial?: InstitutionalEndorsementAccount; officers: OfficerWithAccounts[]; busy: boolean;
  submit: (values: AccountValues, version?: number) => Promise<void>; cancel: () => void;
}) {
  const [opened] = useState(initial);
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const [address, setAddress] = useState(initial?.accountAddress ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [authorizedOfficerIds, setOfficers] = useState(initial?.authorizedOfficerIds ?? []);

  return <form className="space-y-4 rounded-2xl border border-emerald-200/90 bg-emerald-50/25 p-5 shadow-2xs" onSubmit={event => {
    event.preventDefault();
    void submit({ id, accountAddress: address.trim(), label: label.trim(), authorizedOfficerIds }, opened?.version);
  }}>
    <div className="flex items-center gap-2 border-b border-emerald-100 pb-3">
      <div className="rounded-lg bg-emerald-100/80 p-1.5 text-[#1b765e]">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      </div>
      <div>
        <h4 className="text-sm font-semibold text-[#17332c]">{initial ? "Perbarui Akun Pengesahan" : "Pendaftaran Akun Pengesahan Baru"}</h4>
        <p className="text-xs text-stone-500">Daftarkan akun institusional lembaga untuk membubuhkan tanda tangan verifikasi.</p>
      </div>
    </div>

    <fieldset disabled={busy} className="space-y-3.5">
      <label htmlFor={`${id}-address`} className="block text-xs font-semibold text-stone-700">Alamat Akun Ethereum (Wallet Lembaga) *
        <input id={`${id}-address`} required disabled={!!initial} placeholder="0x..." pattern="0x[0-9a-fA-F]{40}" value={address} onChange={e => setAddress(e.target.value)} className={`${fieldClass} font-mono`} />
      </label>
      <label htmlFor={`${id}-label`} className="block text-xs font-semibold text-stone-700">Label / Deskripsi Rekening Pengesahan *
        <input id={`${id}-label`} required placeholder="Contoh: Rekening Pengesahan BAZNAS Utama" value={label} onChange={e => setLabel(e.target.value)} className={fieldClass} />
      </label>
      <fieldset className="space-y-2 rounded-xl border border-stone-200 bg-white p-4 shadow-2xs">
        <legend className="text-xs font-semibold text-stone-800">Petugas yang Diotorisasi Memilih Akun Ini (Opsional)</legend>
        <p className="text-xs text-stone-500">Jika tidak ada yang dicentang, semua petugas lembaga dapat memilih akun pengesahan ini.</p>
        <div className="mt-2 space-y-2">
          {officers.map(officer => (
            <label key={officer.id} className="flex items-center gap-2.5 text-xs font-medium text-stone-700 hover:text-stone-900 cursor-pointer">
              <input type="checkbox" checked={authorizedOfficerIds.includes(officer.id)} disabled={!officer.isActive}
                className="h-4 w-4 rounded border-stone-300 text-[#1b765e] focus:ring-emerald-500"
                onChange={e => setOfficers(e.target.checked ? [...authorizedOfficerIds, officer.id] : authorizedOfficerIds.filter(id => id !== officer.id))} />
              <span>{officer.displayName}</span>
              {!officer.isActive && <span className="text-[10px] text-stone-400">(Nonaktif)</span>}
            </label>
          ))}
        </div>
      </fieldset>
    </fieldset>

    <div className="flex items-center gap-2 pt-2 border-t border-emerald-100">
      <Button type="submit" size="sm" disabled={busy}>{busy ? "Menyimpan…" : initial ? "Simpan" : "Daftarkan Akun Pengesahan"}</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={cancel}>Batal</Button>
    </div>
  </form>;
}

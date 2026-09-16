import { useLayoutEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import type { InstitutionalEndorsementAccount, OfficerProfile } from "./workspaceClient";

/** Mounted under the session key; an account revision invalidates its old selection too. */
export function EndorsementSignerSelector({ operatorAccount, officerProfile, endorsementAccounts = [] }: {
  operatorAccount: string; officerProfile: OfficerProfile | null;
  endorsementAccounts?: InstitutionalEndorsementAccount[];
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selection, setSelection] = useState<{ id: string; version: number } | null>(null);
  const activeAccounts = endorsementAccounts.filter(account => account.isActive);
  const current = activeAccounts.find(account => account.id === selection?.id && account.version === selection.version);
  useLayoutEffect(() => {
    if (selection && !current) setSelection(null);
  }, [selection, current]);
  return <section aria-label="Konteks pengesahan" className="rounded-2xl border border-stone-200 bg-white p-6 shadow-xs">
    <h3 className="text-base font-semibold text-stone-900">Konteks Akun Operasional & Penanda Tangan Lembaga</h3>
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
        <h4 className="text-xs font-semibold">1. Akun Operator (Pribadi)</h4>
        <p className="mt-2 font-semibold">{officerProfile?.displayName || "Petugas Belum Terhubung"}</p>
        <p className="break-all font-mono text-xs">{operatorAccount}</p>
        <p className="mt-2 text-xs">Sesi Aktif · Identitas operator tetap sama saat memilih penanda tangan lembaga.</p>
      </div>
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
        <h4 className="text-xs font-semibold">2. Akun Pengesahan Lembaga</h4>
        {current ? <>
          <p className="mt-2 text-xs font-semibold text-emerald-800">Terpilih</p>
          <p className="font-semibold">{current.label}</p>
          <p className="break-all font-mono text-xs">{current.accountAddress}</p>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDropdownOpen(!dropdownOpen)}>Ganti Akun</Button>
            <Button variant="outline" size="sm" onClick={() => setSelection(null)}>Lepas Konteks</Button>
          </div>
        </> : <>
          <p className="mt-2 text-sm">Tidak ada penanda tangan lembaga yang dipilih.</p>
          {activeAccounts.length > 0
            ? <Button className="mt-3" variant="outline" size="sm" onClick={() => setDropdownOpen(!dropdownOpen)}>Pilih Penanda Tangan</Button>
            : <p className="mt-2 text-xs text-amber-700">Belum ada akun pengesahan lembaga yang diotorisasi untuk profil petugas ini.</p>}
        </>}
      </div>
    </div>
    {dropdownOpen && activeAccounts.length > 0 && <div className="mt-4 space-y-2 rounded-xl border border-stone-200 p-4">
      <Button variant="outline" size="sm" onClick={() => setDropdownOpen(false)}>Tutup</Button>
      {activeAccounts.map(account => <button key={account.id} type="button" className="block w-full rounded-lg border border-stone-200 p-3 text-left"
        onClick={() => { setSelection({ id: account.id, version: account.version }); setDropdownOpen(false); }}>
        <span className="block text-sm font-semibold">{account.label}</span>
        <span className="break-all font-mono text-xs">{account.accountAddress}</span>
      </button>)}
    </div>}
    <p className="mt-4 text-xs text-stone-600">Memilih akun pengesahan lembaga tidak mengubah sesi, hak akses operator, atau ruang kerja.
      Keluar, pergantian akun pribadi, atau perubahan otorisasi membersihkan pilihan ini. Pemilihan ini belum merupakan pengesahan keputusan.</p>
  </section>;
}

import { useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { createOfficer } from "./workspaceClient";
import type { PrivateRequests } from "./privateRequests";
import type { OfficerOperation } from "./useOfficerManagement";
import { OfficerAccountFields, type OfficerAccountInput } from "./OfficerAccountFields";

export function CreateOfficerForm({ requests, run, close }: { requests: PrivateRequests; run: OfficerOperation; close: () => void }) {
  const [name, setName] = useState("");
  const [account, setAccount] = useState<OfficerAccountInput>({ account: "", role: "OFFICER" });
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const retry = useRef<{ body: string; id: string } | null>(null);
  return <form className="mt-4 space-y-4 rounded-2xl border border-emerald-200/90 bg-emerald-50/30 p-5 shadow-2xs" onSubmit={async event => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    const payload = { displayName: name.trim(), account: account.account.trim() || undefined, role: account.role };
    const body = JSON.stringify(payload);
    if (retry.current?.body !== body) retry.current = { body, id: `off_${crypto.randomUUID()}` };
    const saved = await run(() => createOfficer(requests, { ...payload, id: retry.current!.id }), "Profil petugas tersimpan.");
    submitting.current = false; setBusy(false);
    if (saved) close();
  }}>
    <div className="flex items-center gap-2 border-b border-emerald-100 pb-3">
      <div className="rounded-lg bg-emerald-100/80 p-1.5 text-[#1b765e]">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
        </svg>
      </div>
      <div>
        <h4 className="text-sm font-semibold text-[#17332c]">Pendaftaran Petugas Baru</h4>
        <p className="text-xs text-stone-500">Buat identitas operasional amil dan tautkan alamat dompet awal.</p>
      </div>
    </div>
    <fieldset disabled={busy} className="space-y-4">
      <label htmlFor="new-officer-name" className="block text-xs font-medium text-stone-700">Nama petugas
        <input id="new-officer-name" required value={name} onChange={event => setName(event.target.value)}
          placeholder="Contoh: Muhammad Rian, S.E."
          className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:border-[#1b765e] focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
      </label>
      <OfficerAccountFields value={account} change={setAccount} optional />
      <p className="text-xs text-stone-500">{busy ? "Sedang menyimpan…" : "Perubahan belum tersimpan."}</p>
      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" disabled={busy || !name.trim()}>{busy ? "Menyimpan…" : "Simpan Petugas"}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={close}>Batal</Button>
      </div>
    </fieldset>
  </form>;
}

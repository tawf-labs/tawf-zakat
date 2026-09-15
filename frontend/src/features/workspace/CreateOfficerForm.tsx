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
  return <form className="mt-4 space-y-3 rounded-xl border bg-stone-50 p-4" onSubmit={async event => {
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
    <fieldset disabled={busy} className="space-y-3">
    <label htmlFor="new-officer-name" className="block text-sm">Nama petugas
      <input id="new-officer-name" required value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded-lg border p-2" />
    </label>
    <OfficerAccountFields value={account} change={setAccount} optional />
    <p className="text-xs text-stone-600">{busy ? "Sedang menyimpan…" : "Perubahan belum tersimpan."}</p>
    <div className="flex gap-2"><Button type="submit" disabled={busy || !name.trim()}>Simpan Petugas</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={close}>Batal</Button></div>
    </fieldset>
  </form>;
}

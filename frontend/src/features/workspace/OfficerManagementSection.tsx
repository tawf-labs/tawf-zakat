import { useState } from "react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "./privateRequests";
import { useOfficerManagement } from "./useOfficerManagement";
import { CreateOfficerForm } from "./CreateOfficerForm";
import { OfficerProfileCard } from "./OfficerProfileCard";

export function OfficerManagementSection({ requests }: { requests: PrivateRequests }) {
  const [creating, setCreating] = useState(false);
  const { officers, loading, message, error, load, run } = useOfficerManagement(requests);
  return <section className="rounded-2xl border border-stone-200 bg-white p-6">
    <h3 className="font-semibold">Pengelolaan Profil Petugas & Akun Kerja</h3>
    <p className="mt-1 text-sm text-stone-600">Beberapa akun kerja dapat ditautkan kepada satu petugas. Riwayat identitas tetap disimpan.</p>
    <div className="mt-3 flex gap-2">
      <Button variant="outline" disabled={creating} onClick={() => setCreating(true)}>Tambah Petugas</Button>
      <Button variant="outline" disabled={loading} onClick={() => void load()}>Muat ulang petugas</Button>
    </div>
    {message && <p role="status" className="mt-3 text-sm text-emerald-800">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    {creating && <CreateOfficerForm requests={requests} run={run} close={() => setCreating(false)} />}
    {loading && <p role="status" className="mt-3 text-sm">Memuat profil petugas…</p>}
    {!loading && officers.length === 0 && <p className="mt-3 text-sm">Belum ada profil petugas terdaftar.</p>}
    <div className="mt-4 space-y-3">{officers.map(officer => <OfficerProfileCard key={officer.id} officer={officer} requests={requests} run={run} />)}</div>
  </section>;
}

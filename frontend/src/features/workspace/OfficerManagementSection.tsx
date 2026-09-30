import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, UserPlus, Users } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "./privateRequests";
import { useOfficerManagement } from "./useOfficerManagement";
import { CreateOfficerForm } from "./CreateOfficerForm";
import { OfficerProfileCard } from "./OfficerProfileCard";

export function OfficerManagementSection({ requests }: { requests: PrivateRequests }) {
  const [creating, setCreating] = useState(false);
  const { officers, loading, message, error, load, run } = useOfficerManagement(requests);

  return <section className="rounded-2xl border border-[#dbe7dd] bg-white p-6 shadow-xs">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-100 pb-5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-2.5 text-[#1b765e]">
          <Users className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-serif text-lg font-semibold text-[#17332c]">Pengelolaan Profil Petugas & Akun Kerja</h3>
          <p className="mt-0.5 text-xs text-stone-600">Beberapa akun kerja dapat ditautkan kepada satu petugas. Riwayat identitas tetap disimpan.</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 text-stone-500 ${loading ? "animate-spin" : ""}`} />
          Muat ulang petugas
        </Button>
        <Button size="sm" disabled={creating} onClick={() => setCreating(true)}>
          <UserPlus className="mr-1.5 h-3.5 w-3.5 text-white" />
          Tambah Petugas
        </Button>
      </div>
    </div>

    {message && (
      <div role="status" className="mt-4 flex items-center gap-2.5 rounded-xl border border-emerald-200/90 bg-emerald-50/90 p-3.5 text-sm text-emerald-900 shadow-2xs">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        <span>{message}</span>
      </div>
    )}

    {error && (
      <div role="alert" className="mt-4 flex items-center gap-2.5 rounded-xl border border-red-200/90 bg-red-50/90 p-3.5 text-sm text-red-900 shadow-2xs">
        <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
        <span>{error}</span>
      </div>
    )}

    {creating && <CreateOfficerForm requests={requests} run={run} close={() => setCreating(false)} />}

    {loading && (
      <div role="status" className="mt-6 flex items-center justify-center gap-2 py-8 text-sm text-stone-500">
        <Loader2 className="h-4 w-4 animate-spin text-[#1b765e]" />
        <span>Memuat profil petugas…</span>
      </div>
    )}

    {!loading && officers.length === 0 && (
      <div className="mt-6 rounded-2xl border border-dashed border-stone-200 bg-stone-50/50 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100 text-stone-400">
          <Users className="h-6 w-6" />
        </div>
        <h4 className="mt-3 text-sm font-semibold text-stone-900">Belum ada profil petugas terdaftar.</h4>
        <p className="mt-1 text-xs text-stone-500">Mulai daftarkan amil atau petugas operasional yang akan mengelola zakat.</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => setCreating(true)}>
          <UserPlus className="mr-1.5 h-3.5 w-3.5 text-stone-500" />
          Tambah Petugas Pertama
        </Button>
      </div>
    )}

    <div className="mt-5 space-y-3.5">
      {officers.map(officer => (
        <OfficerProfileCard key={officer.id} officer={officer} requests={requests} run={run} />
      ))}
    </div>
  </section>;
}

import { useEffect, useState } from "react";
import { Building2, DoorOpen, KeyRound, LogOut, ShieldAlert, Users } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { useWorkspace } from "./useWorkspace";
import { fetchOnboardingFixtures, type Institution } from "./workspaceClient";

/**
 * The door to an institution's workspace (Spec #68, ticket #69).
 *
 * Three states and nothing in between: wallet not connected, connected but not
 * signed in, signed in. What is shown after signing in is the institution the
 * *session* is for - never one picked from a dropdown afterwards, because the
 * tenant is not the interface's to choose.
 *
 * Capabilities hide controls the server would refuse anyway. They are a courtesy,
 * not a control: every one of these actions is gated again at the API, and the
 * tests that prove it call the API directly rather than through this page.
 */
export function WorkspacePanel() {
  const { address, isConnected, isSignedIn, workspace, error, busy, signIn, signOut } = useWorkspace();
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [chosen, setChosen] = useState<string>("");

  useEffect(() => {
    fetchOnboardingFixtures()
      .then(({ institutions: list }) => {
        setInstitutions(list);
        setChosen((current) => current || list[0]?.id || "");
      })
      .catch(() => setInstitutions([]));
  }, []);

  if (!isConnected) {
    return (
      <section className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
        <KeyRound className="mx-auto h-10 w-10 text-stone-400" />
        <h2 className="mt-4 text-xl font-semibold text-stone-900">Hubungkan wallet lembaga</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-stone-600">
          Ruang kerja dibuka dengan menandatangani tantangan sekali pakai. Alamat wallet saja tidak
          cukup — server memverifikasi tanda tangannya sebelum membuka sesi.
        </p>
      </section>
    );
  }

  if (!isSignedIn || !workspace) {
    return (
      <section className="rounded-2xl border border-stone-200 bg-white p-8">
        <h2 className="text-xl font-semibold text-stone-900">Masuk ruang kerja</h2>
        <p className="mt-2 text-sm text-stone-600">
          Wallet <span className="font-mono text-stone-800">{address}</span> akan diminta
          menandatangani tantangan yang berlaku singkat dan hanya sekali pakai.
        </p>

        <label className="mt-6 block text-sm font-medium text-stone-700" htmlFor="institution">
          Pengelola Zakat
        </label>
        <select
          id="institution"
          value={chosen}
          onChange={(event) => setChosen(event.target.value)}
          className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
        >
          {institutions.map((institution) => (
            <option key={institution.id} value={institution.id}>
              {institution.legalName}
            </option>
          ))}
        </select>

        <Button className="mt-5" disabled={busy || chosen === ""} onClick={() => signIn(chosen)}>
          <DoorOpen className="mr-2 h-4 w-4" />
          {busy ? "Menunggu tanda tangan…" : "Tandatangani dan masuk"}
        </Button>

        {error && (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}
      </section>
    );
  }

  const { institution, role, capabilities, members } = workspace;

  return (
    <section className="space-y-6">
      <header className="rounded-2xl border border-stone-200 bg-white p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-emerald-700" />
              <h2 className="truncate text-xl font-semibold text-stone-900">{institution.legalName}</h2>
            </div>
            <p className="mt-1 text-sm text-stone-600">
              {institution.scopeUnit} · cakupan {institution.scopeLevel} · <code>{institution.id}</code>
            </p>
            <p className="mt-3 text-sm text-stone-700">
              Masuk sebagai <span className="font-mono">{workspace.account}</span> dengan peran{" "}
              <Badge>{role}</Badge>
            </p>
          </div>

          <Button variant="outline" disabled={busy} onClick={() => signOut()}>
            <LogOut className="mr-2 h-4 w-4" />
            Keluar
          </Button>
        </div>

        {institution.isSynthetic && (
          <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Lembaga sintetis untuk pengujian. Identitas, mandat, dan akun penanda tangan lembaga
            sungguhan adalah data onboarding yang belum diisi.
          </p>
        )}
      </header>

      <div className="rounded-2xl border border-stone-200 bg-white p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          Yang boleh Anda lakukan di ruang kerja ini
        </h3>
        <ul className="mt-3 space-y-2 text-sm text-stone-700">
          <li>{capabilities.viewWorkspace ? "✓" : "✕"} Membuka ruang kerja dan membaca data lembaga</li>
          <li>{capabilities.prepareEvidence ? "✓" : "✕"} Menyiapkan dan mengubah bukti lembaga</li>
          <li>{capabilities.manageMembers ? "✓" : "✕"} Mengelola anggota lembaga</li>
        </ul>
        <p className="mt-4 border-t border-stone-100 pt-4 text-xs text-stone-500">
          Kewenangan ini hanya mengatur ruang kerja. Pencatatan bukti dan penerbitan laporan
          diperiksa registry di rantai, dan keanggotaan di sini tidak menggantikannya.
        </p>
      </div>

      {capabilities.manageMembers && members && (
        <div className="rounded-2xl border border-stone-200 bg-white p-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
            <Users className="h-4 w-4" /> Anggota lembaga ({members.length})
          </h3>
          <ul className="mt-3 space-y-2 text-sm">
            {members.map((member) => (
              <li key={member.account} className="flex items-center justify-between gap-3">
                <span className="truncate font-mono text-stone-700">{member.account}</span>
                <Badge>{member.role}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-6 text-sm text-stone-600">
        Belum ada paket bukti pada ruang kerja ini. Data donasi dan penyaluran yang tercatat sebelum
        lembaga dibuat tidak dimasukkan ke ruang kerja mana pun — kepemilikannya dicatat, bukan
        ditebak.
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}

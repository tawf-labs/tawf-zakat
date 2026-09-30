import { useEffect, useState } from "react";
import { Building2, CheckCircle2, DoorOpen, KeyRound, LockKeyhole, ShieldAlert, Sparkles, Users } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { SafeConnectKitButton } from "../../lib/SafeConnectKitProvider";
import { useWorkspaceAccess } from "./useWorkspaceAccess";
import { fetchOnboardingFixtures, type Institution, type Workspace } from "./workspaceClient";
import { AuthorityPanel } from "./AuthorityPanel";
import type { PrivateRequests } from "./privateRequests";
import { WorkspaceShell, WorkspaceShortcut } from "./WorkspaceShell";
import { workspaceSections } from "./workspaceNavigation";
import { EvidencePackagePanel } from "./EvidencePackagePanel";
import { WorkspaceAuthority } from "./WorkspaceAuthority";
import { DisbursementPanel } from "../disbursement";
import { ContributionPanel } from "../contributions";
import { ActivityPanel } from "../activities";
import { AuditFindingQueuePanel } from "./AuditFindingQueuePanel";
import { CertificateIssuancePanel } from "./CertificateIssuancePanel";

const demoWorkspace: Workspace = {
  account: "0x71C8564E68D8a6C89b25B9e04812aF8C89A23E11",
  institution: {
    id: "inst-tawf-01",
    legalName: "Lembaga Amil Zakat Tawf Sejahtera",
    scopeUnit: "DKI Jakarta",
    scopeLevel: "Provinsi",
    mandateNote: "Pengelolaan Zakat, Infaq, Sedekah terdaftar resmi BAZNAS",
    isSynthetic: false,
  },
  role: "ADMIN",
  officer: {
    id: "off-01",
    displayName: "Ahmad Fauzi, S.E.",
    isActive: true,
  },
  capabilities: {
    viewWorkspace: true,
    prepareEvidence: true,
    manageMembers: true,
    manageDisbursement: true,
  },
  members: [
    { account: "0x71C8564E68D8a6C89b25B9e04812aF8C89A23E11", displayName: "Ahmad Fauzi, S.E.", role: "ADMIN" },
    { account: "0x38B132C7d89B25A11F0825B9e04812aF8C811C4", displayName: "Siti Rahmawati", role: "OFFICER" },
  ],
  mandates: [],
  evidencePackages: [],
};

const demoRequests: PrivateRequests = {
  contextId: "demo-preview-context",
  assertCurrent: () => {},
  json: async <T,>() => ({ records: [], items: [], total: 0, mandates: [], findings: [], proposals: [] } as unknown as T),
  blob: async () => new Blob(),
};

/** The session determines the tenant. Navigation never grants access; the API enforces every capability. */
export function WorkspacePanel() {
  return <WorkspaceContents />;
}

function WorkspaceContents() {
  const access = useWorkspaceAccess();
  const { account: address, error, enter: signIn, leave: signOut } = access;
  const busy = access.state === "OPENING";
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [chosen, setChosen] = useState<string>("");
  const [previewMode, setPreviewMode] = useState(false);

  useEffect(() => {
    fetchOnboardingFixtures()
      .then(({ institutions: list }) => {
        setInstitutions(list);
        setChosen((current) => current || list[0]?.id || "");
      })
      .catch(() => setInstitutions([]));
  }, []);

  if (previewMode && !address) {
    const previewBanner = (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#c5a869]/40 bg-gradient-to-r from-amber-50/80 via-white to-emerald-50/80 p-3.5 px-4 text-xs shadow-2xs">
        <div className="flex items-center gap-2 text-stone-700">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-semibold text-[#17332c]">Mode Pratinjau Desain Sidebar & Ruang Kerja</span>
          <span className="hidden sm:inline text-stone-400">|</span>
          <span className="hidden sm:inline text-stone-600">Menampilkan desain UI/UX baru dengan data simulasi amil zakat.</span>
        </div>
        <button
          type="button"
          onClick={() => setPreviewMode(false)}
          className="cursor-pointer font-semibold text-[#1b765e] hover:underline"
        >
          Tutup Pratinjau &times;
        </button>
      </div>
    );

    return (
      <ReadyWorkspace
        workspace={demoWorkspace}
        requests={demoRequests}
        onSignOut={() => setPreviewMode(false)}
        banner={previewBanner}
      />
    );
  }

  if (!address) {
    return (
      <section className="rounded-3xl border border-[#dbe7dd] bg-white p-8 sm:p-10 text-center shadow-xs">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#eaf3e8] to-[#d8ebd5] text-[#1b765e] shadow-2xs">
          <KeyRound className="h-7 w-7" />
        </div>
        <h2 className="mt-5 font-serif text-2xl font-bold text-[#17332c]">Hubungkan dompet digital lembaga</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-stone-600">
          Ruang kerja dibuka dengan menandatangani pesan sekali pakai. Alamat dompet saja tidak cukup — server memeriksa tanda tangan Anda sebelum membuka ruang kerja.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <SafeConnectKitButton>
            {({ show, isConnecting }) => (
              <Button onClick={show} className="cursor-pointer">
                <KeyRound className="mr-2 h-4 w-4" />
                {isConnecting ? "Menghubungkan..." : "Hubungkan Dompet"}
              </Button>
            )}
          </SafeConnectKitButton>
          <button
            type="button"
            onClick={() => setPreviewMode(true)}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[#1b765e]/30 bg-[#f4f8f3] px-4 py-2.5 text-xs font-semibold text-[#17332c] shadow-2xs transition-all hover:bg-[#1b765e] hover:text-white"
          >
            <Sparkles className="h-4 w-4 text-[#c5a869]" />
            Pratinjau Antarmuka Ruang Kerja
          </button>
        </div>
      </section>
    );
  }

  if (access.state !== "READY") {
    return <section className="rounded-2xl border border-stone-200 bg-white p-8">
      <h2 className="text-xl font-semibold text-stone-900">Masuk ruang kerja</h2>
      <p className="mt-2 text-sm text-stone-600">Wallet <span className="break-all font-mono text-stone-800">{address}</span> akan diminta menandatangani tantangan yang berlaku singkat dan hanya sekali pakai.</p>
      <label className="mt-6 block text-sm font-medium text-stone-700" htmlFor="institution">Pengelola Zakat</label>
      <select id="institution" value={chosen} onChange={(event) => setChosen(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base text-stone-900">
        {institutions.map(institution => <option key={institution.id} value={institution.id}>{institution.legalName}</option>)}
      </select>
      <Button className="mt-5" disabled={busy || chosen === ""} onClick={() => signIn(chosen)}>
        <DoorOpen className="mr-2 h-4 w-4" />{busy ? "Menunggu tanda tangan…" : "Tandatangani dan masuk"}
      </Button>
      {error && <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
    </section>;
  }

  const { workspace, requests } = access;
  // Reset both navigation and retained drafts on session or access changes, never on menu selection.
  const sessionKey = `${requests.contextId}:${workspace.role}:${JSON.stringify(workspace.capabilities)}`;
  return <>
    <ReadyWorkspace key={sessionKey} workspace={workspace} requests={requests} onSignOut={signOut} />
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  </>;
}

function ReadyWorkspace({
  workspace,
  requests,
  onSignOut,
  banner,
}: {
  workspace: Workspace;
  requests: PrivateRequests;
  onSignOut: () => void;
  banner?: React.ReactNode;
}) {
  const [allocationRevision, setAllocationRevision] = useState(0);
  const { institution, role, capabilities, members } = workspace;
  const sections = workspaceSections(capabilities);

  return <WorkspaceShell sections={sections} institutionName={institution.legalName} scope={`${institution.scopeUnit} · cakupan ${institution.scopeLevel}`}
    role={role} officerName={workspace.officer?.displayName} onSignOut={onSignOut} banner={banner} renderSection={(id, navigate) => {
      switch (id) {
        case "overview": return <>
          <section className="rounded-2xl border border-[#dbe7dd] bg-[#17332c] p-5 text-white sm:p-6">
            <div className="flex items-start gap-3"><Building2 className="mt-1 h-5 w-5 shrink-0 text-[#c4ed70]" aria-hidden="true" /><div className="min-w-0">
              <p className="text-xs text-[#dbe7dd]">Selamat bekerja{workspace.officer ? `, ${workspace.officer.displayName}` : ""}</p>
              <h3 className="mt-1 break-words font-serif text-xl font-semibold">{institution.legalName}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#dbe7dd]">Pilih pekerjaan dari menu. Hanya bagian yang sedang Anda buka yang ditampilkan.</p>
            </div></div>
          </section>
          {institution.isSynthetic && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Lembaga sintetis untuk pengujian. Identitas, mandat, dan akun penanda tangan lembaga sungguhan adalah data onboarding yang belum diisi.</p>}
          {!workspace.officer && <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />Profil petugas belum tersedia. Tindakan yang memerlukan identitas amil lengkap tetap ditahan.</p>}
          <section className="rounded-2xl border border-[#dbe7dd] bg-white p-5">
            <h3 className="text-sm font-semibold text-[#17332c]">Akses ruang kerja Anda</h3>
            <ul className="mt-4 grid gap-3 text-sm text-stone-700 sm:grid-cols-2">
              {([
                [capabilities.viewWorkspace, "Membaca data lembaga"],
                [capabilities.prepareEvidence, "Menyiapkan bukti"],
                [capabilities.manageMembers, "Mengelola anggota"],
                [capabilities.manageDisbursement, "Mengelola penyaluran"],
              ] as const).map(([enabled, label]) => <li key={label} className="flex items-center gap-2">{enabled ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[#1b765e]" aria-hidden="true" /> : <LockKeyhole className="h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />}<span>{label}<span className="sr-only">{enabled ? ": tersedia" : ": tidak tersedia"}</span></span></li>)}
            </ul>
            <details className="mt-4 border-t border-[#dbe7dd] pt-3">
              <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-stone-600 focus-visible:outline-2 focus-visible:outline-[#1b765e]">Detail akun dan batas kewenangan</summary>
              <dl className="space-y-2 text-xs text-stone-600"><div><dt>Akun kerja</dt><dd className="mt-1 break-all font-mono text-stone-800">{workspace.account}</dd></div><div><dt>ID lembaga</dt><dd className="mt-1 break-all font-mono">{institution.id}</dd></div></dl>
              <p className="mt-3 text-xs leading-relaxed text-stone-600">Kewenangan ini hanya mengatur ruang kerja. Pencatatan bukti dan penerbitan laporan diperiksa di catatan publik; keanggotaan di sini tidak menggantikannya.</p>
            </details>
          </section>
          <section><h3 className="mb-3 text-sm font-semibold text-[#17332c]">Mulai pekerjaan</h3><div className="grid gap-3 sm:grid-cols-2">{sections.filter(section => ["contributions", "disbursement", "activities", "evidence"].includes(section.id)).map(section => <WorkspaceShortcut key={section.id} section={section} onClick={() => navigate(section.id)} />)}</div></section>
        </>;
        case "contributions": return <ContributionPanel requests={requests} canManage={capabilities.prepareEvidence} canRecord={workspace.mandates?.some(m => m.isActive && m.function === "RECORD_CONTRIBUTIONS") ?? false} onAllocated={() => setAllocationRevision(value => value + 1)} />;
        case "disbursement": return <DisbursementPanel requests={requests} canManage={capabilities.manageDisbursement} />;
        case "activities": return <ActivityPanel requests={requests} canManage={capabilities.manageDisbursement} allocationRevision={allocationRevision} />;
        case "certificates": return <CertificateIssuancePanel requests={requests} institutionId={institution.id} canManage={capabilities.manageDisbursement} />;
        case "evidence": return <EvidencePackagePanel requests={requests} canPrepare={capabilities.prepareEvidence} scopeUnit={institution.scopeUnit} scopeLevel={institution.scopeLevel} />;
        case "audit": return <AuditFindingQueuePanel requests={requests} />;
        case "identity": return <WorkspaceAuthority requests={requests} workspace={workspace} view="identity" />;
        case "authority": return <AuthorityPanel requests={requests} workspace={workspace} />;
        case "members": return capabilities.manageMembers ? <>
          <WorkspaceAuthority requests={requests} workspace={workspace} view="management" />
          {members && <section className="rounded-2xl border border-[#dbe7dd] bg-white p-5"><h3 className="flex items-center gap-2 text-sm font-semibold text-[#17332c]"><Users className="h-4 w-4" />Anggota lembaga ({members.length})</h3><ul className="mt-3 divide-y divide-stone-100">{members.map(member => <li key={member.account} className="flex items-start justify-between gap-3 py-3"><div className="min-w-0"><p className="break-all font-mono text-xs text-stone-700">{member.account}</p>{member.displayName && <p className="mt-1 text-xs text-stone-600">{member.displayName}</p>}</div><Badge>{member.role}</Badge></li>)}</ul></section>}
        </> : null;
      }
    }} />;
}

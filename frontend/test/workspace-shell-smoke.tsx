import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceShell } from "../src/features/workspace/WorkspaceShell";
import { workspaceSections, type WorkspaceSectionId } from "../src/features/workspace/workspaceNavigation";

function DraftPanel({ id, revision }: { id: WorkspaceSectionId; revision: number }) {
  const [draft, setDraft] = useState("");
  useEffect(() => { window.dispatchEvent(new CustomEvent("panel-mounted", { detail: id })); }, [id]);
  return <section className="rounded-2xl border border-[#dbe7dd] bg-white p-6">
    <h3 className="mb-4 text-lg font-semibold text-[#17332c]">{id === "overview" ? "Selamat bekerja, Petugas Pengujian" : `Modul ${id}`}</h3>
    {id === "overview" ? <p className="text-sm text-stone-600">Pilih pekerjaan dari menu. Modul dimuat saat pertama kali dibuka.</p> : <>
      <label htmlFor={`draft-${id}`} className="mb-2 block text-sm text-stone-700">Draf {id}</label>
      <input id={`draft-${id}`} value={draft} onChange={event => setDraft(event.target.value)} className="min-h-11 w-full rounded-lg border border-stone-300 px-3" />
      <p className="mt-3 text-sm text-stone-600">Revisi alokasi: {revision}</p>
    </>}
  </section>;
}

function App() {
  const [context, setContext] = useState(1);
  const [admin, setAdmin] = useState(true);
  const [revision, setRevision] = useState(0);
  const [signedOut, setSignedOut] = useState(false);
  const sections = workspaceSections({ viewWorkspace: true, prepareEvidence: true, manageMembers: admin, manageDisbursement: true });
  return <>
    <div style={{ height: 112 }} className="sticky top-0 z-50 flex items-center border-b border-stone-200 bg-white px-6 font-semibold text-[#17332c]">TAWF ZAKAT · Ruang Kerja</div>
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {signedOut ? <p role="status">Sesi berakhir</p> : <WorkspaceShell key={`${context}:${admin}`} sections={sections} institutionName="Lembaga Zakat Pengujian" scope="Jakarta Selatan · cakupan kabupaten" role={admin ? "ADMIN" : "OFFICER"} officerName="Petugas Pengujian" onSignOut={() => setSignedOut(true)} renderSection={id => <DraftPanel id={id} revision={revision} />} />}
      <div className="mt-6 flex flex-wrap gap-3 border-t border-stone-200 pt-4" aria-label="Kontrol fixture pengujian">
        <button onClick={() => setContext(value => value + 1)}>Ganti sesi</button>
        <button onClick={() => setAdmin(value => !value)}>Ganti peran</button>
        <button onClick={() => setRevision(value => value + 1)}>Alokasi tersimpan</button>
      </div>
    </main>
  </>;
}

createRoot(document.getElementById("root")!).render(<App />);

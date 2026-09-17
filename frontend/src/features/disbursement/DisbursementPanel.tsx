import { RealizationQueryScope } from "./RealizationQueryScope";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList, FileCheck, FileClock, Layers } from "lucide-react";
import type { PrivateRequests } from "../workspace/privateRequests";
import {
  archiveProgram,
  emptyProposalDraft,
  getProposalDraft,
  listPrograms,
  listProposalDrafts,
  type Program,
  type ProposalDraft,
  type ProposalDraftSummary,
  type ProposalTotals,
} from "./disbursementClient";
import { ProposalDraftForm } from "./ProposalDraftForm";
import { CreateProgramForm } from "./CreateProgramForm";
import { ProgramDetails, ProposalList } from "./ProgramDetails";
import { ExaminationQueuePanel } from "./ExaminationQueuePanel";
import { IncompleteEvidenceQueuePanel } from "./IncompleteEvidenceQueuePanel";
import type { EditorNavigation } from "./useProposalDraft";

type OpenDraft = { draft: ProposalDraft; summary: ProposalTotals | null };
type PanelTab = "programs" | "queues" | "evidence";

const PANEL_TABS: Array<{ id: PanelTab; label: string; Icon: typeof Layers; tone: string }> = [
  { id: "programs", label: "Program & Draf Pengajuan", Icon: Layers, tone: "text-stone-900" },
  { id: "queues", label: "Antrean Pemeriksa & Revisi", Icon: FileCheck, tone: "text-emerald-900" },
  { id: "evidence", label: "Bukti Belum Lengkap", Icon: FileClock, tone: "text-amber-900" },
];

function DisbursementPanelContent({ requests, canManage }: { requests: PrivateRequests; canManage: boolean }) {
  const [activeTab, setActiveTab] = useState<PanelTab>("programs");
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ProposalDraftSummary[]>([]);
  const [openDraft, setOpenDraft] = useState<OpenDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const navigation = useRef<EditorNavigation>({ dirty: false, pending: false });
  const selection = useRef(0);
  const navigationChanged = useCallback((state: EditorNavigation) => {
    navigation.current = state;
  }, []);

  useEffect(() => {
    let current = true;
    listPrograms(requests)
      .then((list) => {
        if (!current) return;
        setPrograms(list);
        setSelectedProgramId((id) => id ?? list.find((p) => p.status === "ACTIVE")?.id ?? list[0]?.id ?? null);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
      selection.current++;
    };
  }, [requests]);

  useEffect(() => {
    let current = true;
    setDrafts([]);
    if (selectedProgramId)
      listProposalDrafts(requests, selectedProgramId)
        .then((list) => {
          if (current) setDrafts(list);
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [requests, selectedProgramId, revision]);

  function canLeave() {
    if (navigation.current.pending) {
      setError("Selesaikan pemeriksaan penyimpanan draf sebelum berpindah.");
      return false;
    }
    return !navigation.current.dirty || window.confirm("Perubahan draf belum tersimpan. Buang perubahan dan lanjutkan?");
  }

  function clearEditor() {
    selection.current++;
    setOpenDraft(null);
    navigation.current = { dirty: false, pending: false };
    setError(null);
  }

  function selectProgram(id: string | null) {
    if (!canLeave()) return;
    clearEditor();
    setSelectedProgramId(id);
  }

  async function openExisting(id: string) {
    if (openDraft?.draft.id === id || !canLeave()) return;
    clearEditor();
    const attempt = selection.current;
    try {
      const loaded = await getProposalDraft(requests, id);
      if (selection.current === attempt) {
        if (loaded.draft.programId && loaded.draft.programId !== selectedProgramId) {
          setSelectedProgramId(loaded.draft.programId);
        }
        setOpenDraft(loaded);
      }
    } catch (e) {
      if (selection.current === attempt) setError(e instanceof Error ? e.message : "Draf gagal dibuka.");
    }
  }

  function openFromQueue(id: string) {
    setActiveTab("programs");
    openExisting(id);
  }

  const selectedProgram = programs.find((p) => p.id === selectedProgramId) ?? null;

  function openNew() {
    if (!selectedProgram || !canLeave()) return;
    clearEditor();
    setOpenDraft({ draft: emptyProposalDraft(selectedProgram), summary: null });
  }

  async function archive() {
    if (!selectedProgram) return;
    try {
      const archived = await archiveProgram(requests, selectedProgram.id);
      setPrograms((list) => list.map((p) => (p.id === archived.id ? archived : p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Program gagal diarsipkan.");
    }
  }

  if (!canManage) return null;

  return (
    <section className="space-y-6 rounded-2xl border border-stone-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 pb-4">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-emerald-700" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            Program Bantuan dan Pengajuan Penyaluran
          </h3>
        </div>

        {/* Panel Tabs */}
        <div className="flex flex-wrap gap-1 rounded-lg bg-stone-100 p-1 text-xs font-medium">
          {PANEL_TABS.map(({ id, label, Icon, tone }) => (
            <button
              key={id}
              type="button"
              aria-pressed={activeTab === id}
              onClick={() => {
                if (canLeave()) setActiveTab(id);
              }}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${
                activeTab === id ? `bg-white shadow-sm ${tone}` : "text-stone-600 hover:text-stone-900"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "evidence" ? (
        <IncompleteEvidenceQueuePanel requests={requests} onOpenProposal={openFromQueue} />
      ) : activeTab === "queues" ? (
        <ExaminationQueuePanel requests={requests} onOpenDraft={openFromQueue} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-stone-700">
              Program bantuan
              <select
                className="ml-2 min-h-11 min-w-[220px] rounded-lg border border-stone-300 px-3 py-2 text-sm"
                value={selectedProgramId ?? ""}
                onChange={(e) => selectProgram(e.target.value || null)}
              >
                <option value="">Pilih program…</option>
                {programs.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.name} {program.status === "ARCHIVED" ? "(arsip)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <CreateProgramForm
              requests={requests}
              onCreated={(program) => {
                setPrograms((list) => [program, ...list]);
                selectProgram(program.id);
              }}
            />
          </div>
          {selectedProgram && <ProgramDetails program={selectedProgram} onArchive={archive} />}
          {selectedProgram && <ProposalList drafts={drafts} onOpen={openExisting} onNew={openNew} />}
          {openDraft && (
            <ProposalDraftForm
              key={openDraft.draft.id}
              requests={requests}
              initial={openDraft.draft}
              initialSummary={openDraft.summary}
              onNavigationChange={navigationChanged}
              onSaved={(draft, summary) => {
                setError(null);
                setOpenDraft({ draft, summary });
                setRevision((value) => value + 1);
              }}
            />
          )}
        </>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}

export function DisbursementPanel(props: { requests: PrivateRequests; canManage: boolean }) {
  return <RealizationQueryScope key={props.requests.contextId}><DisbursementPanelContent {...props} /></RealizationQueryScope>;
}

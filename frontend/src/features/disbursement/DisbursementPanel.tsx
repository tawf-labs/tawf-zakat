import { useEffect, useState } from "react";
import { ClipboardList, FolderPlus, Plus } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import type { PrivateRequests } from "../workspace/privateRequests";
import {
  archiveProgram,
  createProgram,
  emptyProposalDraft,
  getProposalDraft,
  listPrograms,
  listProposalDrafts,
  type FundType,
  type Program,
  type ProposalDraft,
  type ProposalDraftSummary,
  type ProposalTotals,
} from "./disbursementClient";
import { ProposalDraftForm } from "./ProposalDraftForm";

const FUND_TYPE_LABELS: Record<FundType, string> = {
  ZAKAT: "Zakat",
  INFAK: "Infak",
  SEDEKAH: "Sedekah",
  LAINNYA: "Lainnya",
};

function CreateProgramForm({ requests, onCreated }: { requests: PrivateRequests; onCreated: (program: Program) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [fundType, setFundType] = useState<FundType>("ZAKAT");
  const [scope, setScope] = useState("");
  const [referenceCeiling, setReferenceCeiling] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <FolderPlus className="mr-2 h-4 w-4" /> Program baru
      </Button>
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const program = await createProgram(requests, {
        name,
        purpose,
        fundType,
        scope,
        referenceCeiling: referenceCeiling.trim() ? referenceCeiling.trim() : null,
      });
      onCreated(program);
      setOpen(false);
      setName("");
      setPurpose("");
      setScope("");
      setReferenceCeiling("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Program gagal dibuat.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <h4 className="text-sm font-semibold text-stone-900">Program bantuan baru</h4>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-stone-600 sm:col-span-2">
          Nama program
          <input className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-xs font-medium text-stone-600 sm:col-span-2">
          Tujuan
          <input className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </label>
        <label className="block text-xs font-medium text-stone-600">
          Jenis dana
          <select
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            value={fundType}
            onChange={(e) => setFundType(e.target.value as FundType)}
          >
            {Object.entries(FUND_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-stone-600">
          Cakupan/periode
          <input className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" value={scope} onChange={(e) => setScope(e.target.value)} />
        </label>
        <label className="block text-xs font-medium text-stone-600 sm:col-span-2">
          Pagu referensi (rupiah, opsional — peringatan, bukan saldo bank)
          <input
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            value={referenceCeiling}
            onChange={(e) => setReferenceCeiling(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button type="button" disabled={busy} onClick={submit}>
          {busy ? "Menyimpan…" : "Simpan program"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          Batal
        </Button>
      </div>
    </div>
  );
}

/**
 * Program bantuan and draf pengajuan banyak penerima (Spec #86, ticket #89).
 *
 * Program is durable the moment it is created; a Pengajuan under it stays a
 * draft until submission - which this slice does not implement.
 */
export function DisbursementPanel({ requests, canManage }: { requests: PrivateRequests; canManage: boolean }) {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ProposalDraftSummary[]>([]);
  const [openDraft, setOpenDraft] = useState<{ draft: ProposalDraft; summary: ProposalTotals } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPrograms(requests)
      .then((list) => {
        setPrograms(list);
        setSelectedProgramId((current) => current ?? list.find((p) => p.status === "ACTIVE")?.id ?? list[0]?.id ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Program gagal dimuat."));
  }, [requests]);

  useEffect(() => {
    if (!selectedProgramId) {
      setDrafts([]);
      return;
    }
    listProposalDrafts(requests, selectedProgramId)
      .then(setDrafts)
      .catch((e) => setError(e instanceof Error ? e.message : "Draf pengajuan gagal dimuat."));
  }, [requests, selectedProgramId]);

  const selectedProgram = programs.find((p) => p.id === selectedProgramId) ?? null;

  async function openExisting(id: string) {
    setError(null);
    try {
      const { draft, summary } = await getProposalDraft(requests, id);
      setOpenDraft({ draft, summary });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draf gagal dibuka.");
    }
  }

  async function refreshDrafts() {
    if (!selectedProgramId) return;
    setDrafts(await listProposalDrafts(requests, selectedProgramId));
  }

  if (!canManage) return null;

  return (
    <section className="space-y-6 rounded-2xl border border-stone-200 bg-white p-6">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-emerald-700" />
        <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          Program bantuan dan pengajuan penyaluran
        </h3>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          className="min-w-[220px] rounded-lg border border-stone-300 px-3 py-2 text-sm"
          value={selectedProgramId ?? ""}
          onChange={(e) => setSelectedProgramId(e.target.value || null)}
        >
          <option value="">Pilih program…</option>
          {programs.map((program) => (
            <option key={program.id} value={program.id}>
              {program.name} {program.status === "ARCHIVED" ? "(arsip)" : ""}
            </option>
          ))}
        </select>
        <CreateProgramForm requests={requests} onCreated={(program) => { setPrograms((prev) => [program, ...prev]); setSelectedProgramId(program.id); }} />
      </div>

      {selectedProgram && (
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-stone-900">{selectedProgram.name}</p>
              <p className="mt-1 text-xs text-stone-600">
                {FUND_TYPE_LABELS[selectedProgram.fundType]} · {selectedProgram.scope}
              </p>
              {selectedProgram.referenceCeiling && (
                <p className="mt-1 text-xs text-amber-800">
                  Pagu referensi: Rp {selectedProgram.referenceCeiling} (acuan, bukan saldo bank terverifikasi)
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge>{selectedProgram.status === "ACTIVE" ? "Aktif" : "Arsip"}</Badge>
              {selectedProgram.status === "ACTIVE" && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    archiveProgram(requests, selectedProgram.id).then((program) =>
                      setPrograms((prev) => prev.map((p) => (p.id === program.id ? program : p)))
                    )
                  }
                >
                  Arsipkan
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedProgram && (
        <div>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-stone-900">Draf pengajuan ({drafts.length})</h4>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setOpenDraft({
                  draft: emptyProposalDraft(selectedProgram),
                  summary: { uniqueBeneficiaryCount: 0, aidLineCount: 0, totalsByUnit: {}, isPartial: false },
                })
              }
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Pengajuan baru
            </Button>
          </div>

          <ul className="mt-3 space-y-2">
            {drafts.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => openExisting(d.id)}
                  className="flex w-full items-center justify-between rounded-lg border border-stone-200 bg-white px-3 py-2 text-left text-sm hover:border-emerald-300"
                >
                  <span className="min-w-0 truncate">
                    {d.purpose || "(tanpa tujuan)"} · {d.originOfRequest || "(asal belum diisi)"}
                  </span>
                  <span className="ml-3 shrink-0 text-xs text-stone-500">
                    {d.beneficiaryCount} penerima{d.issueCount > 0 ? ` · ${d.issueCount} masalah` : ""}
                  </span>
                </button>
              </li>
            ))}
            {drafts.length === 0 && <p className="text-xs text-stone-500">Belum ada draf pengajuan pada program ini.</p>}
          </ul>
        </div>
      )}

      {openDraft && selectedProgram && (
        <ProposalDraftForm
          requests={requests}
          program={selectedProgram}
          initial={openDraft.draft.id ? openDraft.draft : null}
          onSaved={async (draft, summary) => {
            setOpenDraft({ draft, summary });
            await refreshDrafts();
          }}
        />
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}

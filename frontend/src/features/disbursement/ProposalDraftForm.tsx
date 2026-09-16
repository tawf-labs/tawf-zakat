import { Save } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "../workspace/privateRequests";
import type { ProposalDraft, ProposalTotals } from "./disbursementClient";
import { ProposalDetails, ProposalRoster, ProposalSummary } from "./ProposalSections";
import { useProposalDraft, type EditorNavigation } from "./useProposalDraft";

/** The parent keys this editor by draft identity; saved and unsaved contents stay distinct. */
export function ProposalDraftForm({ requests, initial, initialSummary, onSaved, onNavigationChange }: {
  requests: PrivateRequests;
  initial: ProposalDraft;
  initialSummary: ProposalTotals | null;
  onSaved: (draft: ProposalDraft, summary: ProposalTotals) => void;
  onNavigationChange: (state: EditorNavigation) => void;
}) {
  const editor = useProposalDraft(requests, initial, initialSummary, onSaved, onNavigationChange);
  const { draft, setDraft, dirty, saving, unknown, summary, error, save } = editor;
  const status = unknown ? "Hasil penyimpanan belum diketahui" : saving ? "Menyimpan…" : dirty
    ? `Belum tersimpan${draft.version ? ` · berdasarkan versi ${draft.version}` : ""}`
    : `Draf server · versi ${draft.version}`;
  return (
    <div className="space-y-4 rounded-2xl border border-stone-200 bg-stone-50 p-4">
      <p role="status" className={`rounded-full px-2.5 py-1 text-xs font-medium ${dirty || unknown
        ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>{status}</p>
      <fieldset disabled={saving || unknown} className="min-w-0 space-y-4">
        <legend className="sr-only">Pengajuan penyaluran</legend>
        <ProposalDetails draft={draft} setDraft={setDraft} />
        <ProposalRoster draft={draft} setDraft={setDraft} />
      </fieldset>
      <section aria-label="Dokumen pengajuan" className="rounded-lg border border-dashed border-stone-300 bg-white p-3 text-xs text-stone-500">
        <h3 className="text-sm font-semibold text-stone-700">Dokumen pengajuan</h3>
        <p className="mt-1">Belum tersedia pada irisan ini. Lampiran dokumen pengajuan akan mengikuti akses dokumen terbatas pada irisan berikutnya.</p>
      </section>
      {!dirty && !unknown && <ProposalSummary summary={summary} />}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <Button type="button" disabled={saving} onClick={save}>
        <Save className="mr-2 h-4 w-4" /> {saving ? "Menyimpan…" : unknown ? "Periksa penyimpanan" : "Simpan draf"}
      </Button>
      <p className="text-xs text-stone-500">Draf boleh disimpan meski belum lengkap. Pengiriman untuk pemeriksaan disediakan pada irisan berikutnya.</p>
    </div>
  );
}

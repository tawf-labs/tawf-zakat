import { Download, FileSpreadsheet, Plus } from "lucide-react";
import { formatIdrAmount } from "../workspace/mandateLabels";
import { Button } from "../../components/ui/Button";
import { newAidLine, newBeneficiary, type ProposalDraft, type ProposalTotals, type TabularFormat } from "./disbursementClient";
import { issuesFor, IssueList } from "./ProposalIssues";
import { BeneficiaryCard } from "./BeneficiaryCard";
import { AidLineRow } from "./AidLineRow";
import { LIST_PAGE_SIZE, Pager, pageOf, usePage } from "./Pagination";

type DraftSectionProps = { draft: ProposalDraft; setDraft: (draft: ProposalDraft) => void };
type RosterSectionProps = DraftSectionProps & {
  onOpenImport?: () => void;
  /** Exports the saved roster; omitted while the draft has never been saved. */
  onExport?: (format: TabularFormat) => void;
};

export function ProposalDetails({ draft, setDraft }: DraftSectionProps) {
  return <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-stone-600">
          Asal permohonan
          <input
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            value={draft.originOfRequest}
            onChange={(e) => setDraft({ ...draft, originOfRequest: e.target.value })}
          />
        </label>
        <label className="block text-xs font-medium text-stone-600">
          Penanggung jawab pengajuan
          <input
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            value={draft.personInCharge}
            onChange={(e) => setDraft({ ...draft, personInCharge: e.target.value })}
          />
        </label>
        <label className="block text-xs font-medium text-stone-600 sm:col-span-2">
          Tujuan pengajuan
          <input
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            value={draft.purpose}
            onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
          />
        </label>
        <label className="block text-xs font-medium text-stone-600">
          Periode bantuan mulai
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            value={draft.aidPeriod?.start ?? ""}
            onChange={(e) => setDraft({ ...draft, aidPeriod: { start: e.target.value, end: draft.aidPeriod?.end ?? "" } })}
          />
        </label>
        <label className="block text-xs font-medium text-stone-600">
          Periode bantuan selesai
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            value={draft.aidPeriod?.end ?? ""}
            onChange={(e) => setDraft({ ...draft, aidPeriod: { start: draft.aidPeriod?.start ?? "", end: e.target.value } })}
          />
        </label>
      </div>
      <IssueList issues={issuesFor(draft.issues, "proposal", null)} />

  </>;
}

export function ProposalRoster({ draft, setDraft, onOpenImport, onExport }: RosterSectionProps) {
  const beneficiaryPager = usePage(draft.beneficiaries.length, LIST_PAGE_SIZE);
  const aidLinePager = usePage(draft.aidLines.length, LIST_PAGE_SIZE);

  const pagedBeneficiaries = pageOf(draft.beneficiaries, beneficiaryPager.page);
  const pagedAidLines = pageOf(draft.aidLines, aidLinePager.page);

  return <>
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-stone-900">
            Penerima ({draft.beneficiaries.length}) dan rincian bantuan ({draft.aidLines.length})
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {onOpenImport && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenImport}
                className="text-xs"
              >
                <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                Impor XLSX / CSV
              </Button>
            )}
            {onExport && draft.beneficiaries.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onExport("xlsx")}
                title="Mengekspor daftar penerima versi tersimpan, lengkap dengan ID stabil untuk diunggah ulang"
                className="text-xs"
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Ekspor daftar penerima
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft({ ...draft, beneficiaries: [...draft.beneficiaries, newBeneficiary()] })}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Tambah penerima
            </Button>
          </div>
        </div>
        {draft.beneficiaries.length > LIST_PAGE_SIZE && (
          <p className="mt-1 text-xs text-stone-500">
            Daftar besar (mis. hasil impor CSV) ditampilkan {LIST_PAGE_SIZE} per halaman agar layar tetap responsif.
          </p>
        )}

        <div className="mt-3 space-y-3">
          {pagedBeneficiaries.map(({ item: b, index: i }) => (
            <BeneficiaryCard
              key={b.id}
              beneficiary={b}
              index={i}
              issues={draft.issues}
              onChange={(next) =>
                setDraft({ ...draft, beneficiaries: draft.beneficiaries.map((row, j) => (j === i ? next : row)) })
              }
              onRemove={() => setDraft({ ...draft, beneficiaries: draft.beneficiaries.filter((_, j) => j !== i), aidLines: draft.aidLines.filter(line => line.beneficiaryId !== b.id) })}
            />
          ))}
        </div>
        <Pager label="Penerima" page={beneficiaryPager.page} pageCount={beneficiaryPager.pageCount} onChange={beneficiaryPager.setPage} />
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-900">Rincian bantuan</h3>
          <Button
            type="button"
            variant="outline"
            disabled={draft.beneficiaries.length === 0}
            onClick={() => setDraft({ ...draft, aidLines: [...draft.aidLines, newAidLine(draft.beneficiaries[0]?.id ?? "")] })}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Tambah rincian
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {pagedAidLines.map(({ item: line, index: i }) => (
            <AidLineRow
              key={line.id}
              line={line}
              index={i}
              beneficiaries={draft.beneficiaries}
              issues={draft.issues}
              onChange={(next) => setDraft({ ...draft, aidLines: draft.aidLines.map((row, j) => (j === i ? next : row)) })}
              onRemove={() => setDraft({ ...draft, aidLines: draft.aidLines.filter((_, j) => j !== i) })}
            />
          ))}
        </div>
        <Pager label="Rincian bantuan" page={aidLinePager.page} pageCount={aidLinePager.pageCount} onChange={aidLinePager.setPage} />
      </section>

  </>;
}

export function ProposalSummary({ summary }: { summary: ProposalTotals | null }) {
  if (!summary) return null;
  return (
    <section aria-label="Ringkasan draf tersimpan" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
      <p>{summary.uniqueBeneficiaryCount} penerima unik · {summary.aidLineCount} baris bantuan
        {summary.isPartial ? " · sebagian nilai belum diketahui" : ""}</p>
      <ul className="mt-1 space-y-0.5">
        {Object.entries(summary.totalsByUnit).map(([unit, amount]) => <li key={unit}>{unit === "IDR" ? `Total ${formatIdrAmount(amount)}` : `${unit}: ${amount}`}</li>)}
      </ul>
    </section>
  );
}

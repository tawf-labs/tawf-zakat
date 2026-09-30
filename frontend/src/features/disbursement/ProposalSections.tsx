import { formatIdrAmount } from "../workspace/mandateLabels";
import type { ProposalDraft, ProposalTotals } from "./disbursementClient";
import { issuesFor, IssueList } from "./ProposalIssues";

type DraftSectionProps = { draft: ProposalDraft; setDraft: (draft: ProposalDraft) => void };

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

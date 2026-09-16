import type { ProposalDraft, RecurringAidWarning } from "./disbursementClient";
import { formatQuantity } from "../../lib/reporting";

export function ProposalExaminationDetails({ draft, warnings }: { draft: ProposalDraft; warnings: RecurringAidWarning[] }) {
  return <div className="space-y-4 text-sm">
    <dl className="grid grid-cols-2 gap-3 rounded-lg bg-stone-50 p-3 text-xs">
      <div><dt>Tujuan</dt><dd className="font-semibold">{draft.purpose}</dd></div>
      <div><dt>Versi</dt><dd>{draft.version}</dd></div>
      <div><dt>Asal permohonan</dt><dd>{draft.originOfRequest}</dd></div>
      <div><dt>Penanggung jawab</dt><dd>{draft.personInCharge}</dd></div>
      <div><dt>Periode bantuan</dt><dd>{draft.aidPeriod?.start} s/d {draft.aidPeriod?.end}</dd></div>
    </dl>
    <h4 className="font-semibold">Penerima dan rincian bantuan</h4>
    <ul className="space-y-3 text-xs">
      {draft.beneficiaries.map(beneficiary => <li key={beneficiary.id} className="rounded-lg border p-3">
        <p className="font-semibold">{beneficiary.name} ({beneficiary.asnaf})</p>
        <p>{beneficiary.identityBasis.kind === "NIK" ? `NIK: ${beneficiary.identityBasis.value}` : `Identitas alternatif: ${beneficiary.identityBasis.description}`}</p>
        {beneficiary.guardian && <p>Wali: {beneficiary.guardian.name} ({beneficiary.guardian.relationship})</p>}
        <ul className="mt-2 list-disc pl-4">
          {draft.aidLines.filter(line => line.beneficiaryId === beneficiary.id).map(line =>
            <li key={line.id}>{line.aidType} · {line.period} · {line.value.kind === "MONEY"
              ? formatQuantity({ amount: line.value.amountRequestedIdr, unit: "IDR" })
              : `${line.value.quantityRequested} ${line.value.unit}`}</li>)}
        </ul>
      </li>)}
    </ul>
    <section aria-label="Peringatan bantuan berulang" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
      <h4 className="font-semibold">Peringatan bantuan berulang ({warnings.length})</h4>
      <p>Pencocokan terbatas pada pengajuan di lembaga ini.</p>
      {warnings.length ? <ul className="mt-2 list-disc pl-4">{warnings.map((warning, index) =>
        <li key={`${warning.beneficiaryId}-${warning.matchedProposalId}-${index}`}>{warning.message}</li>)}
      </ul> : <p>Tidak ada peringatan pada versi yang diajukan ini.</p>}
    </section>
  </div>;
}

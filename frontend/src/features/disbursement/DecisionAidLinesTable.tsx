import { Input } from "../../components/ui/Input";
import { formatQuantity } from "../../lib/reporting";
import type { ProposalDraft } from "./disbursementClient";
import type { DecisionForm } from "./useProposalDecision";

/** Requested versus approved rights per recipient; approved values never exceed the request. */
export function DecisionAidLinesTable({ draft, form, disabled, onChange }: {
  draft: ProposalDraft;
  form: DecisionForm;
  disabled: boolean;
  onChange: (patch: Partial<DecisionForm>) => void;
}) {
  return <section aria-label="Hak bantuan" className="space-y-2">
    <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-900">Hak bantuan penerima</h4>
    <div className="overflow-x-auto rounded-xl border border-stone-200 text-xs">
      <table className="w-full text-left">
        <thead className="border-b border-stone-200 bg-stone-100 font-semibold text-stone-700">
          <tr><th className="p-2.5">Penerima</th><th className="p-2.5">Jenis bantuan</th>
            <th className="p-2.5">Diminta</th><th className="p-2.5">Disetujui</th></tr>
        </thead>
        <tbody className="divide-y divide-stone-100 bg-white">
          {draft.aidLines.map(line => {
            const beneficiary = draft.beneficiaries.find(b => b.id === line.beneficiaryId);
            const isMoney = line.value.kind === "MONEY";
            const requested = line.value.kind === "MONEY"
              ? formatQuantity({ amount: line.value.amountRequestedIdr, unit: "IDR" })
              : `${line.value.quantityRequested} ${line.value.unit}`;
            return <tr key={line.id}>
              <td className="p-2.5"><strong>{beneficiary?.name ?? line.beneficiaryId}</strong>
                <div className="text-[11px] text-stone-500">{beneficiary?.asnaf ?? "-"} · {beneficiary?.addressOrScope ?? "-"}</div></td>
              <td className="p-2.5">{line.aidType} · {line.period}</td>
              <td className="p-2.5 text-stone-600">{requested}
                {line.value.kind === "GOODS" && line.value.valuedAmountIdr != null && line.value.valuationBasis &&
                  <p className="mt-1">Estimasi pengajuan {formatQuantity({ amount: line.value.valuedAmountIdr, unit: "IDR" })}.
                    Dasar: {line.value.valuationBasis}. Biaya aktual dicatat terpisah.</p>}
              </td>
              <td className="p-2.5">{form.action === "APPROVE"
                ? <div className="flex max-w-[180px] items-center gap-1.5">
                    {isMoney && <span className="text-stone-500">Rp</span>}
                    <Input inputMode={isMoney ? "numeric" : "decimal"} aria-label={`Disetujui untuk ${beneficiary?.name ?? line.id}`}
                      disabled={disabled} value={form.approved[line.id] ?? ""} className="h-8 text-xs font-semibold"
                      onChange={e => onChange({ approved: { ...form.approved, [line.id]: e.target.value } })} />
                    {line.value.kind === "GOODS" && <span className="text-stone-500">{line.value.unit}</span>}
                  </div>
                : <span className="font-semibold italic text-red-700">Ditolak</span>}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </section>;
}

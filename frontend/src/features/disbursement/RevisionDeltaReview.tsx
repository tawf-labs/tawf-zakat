import { AlertTriangle, ArrowRight, Check, Plus, Trash2 } from "lucide-react";
import { formatIdrAmount } from "../workspace/mandateLabels";
import type { ProposalRevisionDelta } from "./disbursementClient";

export function RevisionDeltaReview({ delta }: { delta: ProposalRevisionDelta }) {
  const hasBeneficiaryChanges =
    delta.beneficiaries.added.length > 0 ||
    delta.beneficiaries.removed.length > 0 ||
    delta.beneficiaries.modified.length > 0;

  const hasAidLineChanges =
    delta.aidLines.added.length > 0 ||
    delta.aidLines.removed.length > 0 ||
    delta.aidLines.modified.length > 0;

  if (!hasBeneficiaryChanges && !hasAidLineChanges) {
    return (
      <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
        Tidak ada perbedaan data penerima maupun rincian bantuan yang diajukan.
      </div>
    );
  }

  return (
    <div className="space-y-4 text-xs">
      {delta.heldAidLineIds.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">Penahanan Realisasi Berjalan:</p>
            <p className="text-[11px] text-amber-800">
              Sebanyak {delta.heldAidLineIds.length} baris bantuan (yang ditambah atau diubah) ditahan dari realisasi hingga revisi ini disahkan atau ditarik. Baris yang tidak diubah tetap dapat disalurkan normal.
            </p>
          </div>
        </div>
      )}

      {hasBeneficiaryChanges && (
        <div className="space-y-2 rounded-lg border border-stone-200 bg-white p-3">
          <p className="font-semibold text-stone-900">Perubahan Penerima Manfaat:</p>
          {delta.beneficiaries.added.length > 0 && (
            <div className="space-y-1">
              <p className="flex items-center gap-1 font-medium text-emerald-700">
                <Plus className="h-3 w-3" /> Ditambahkan ({delta.beneficiaries.added.length}):
              </p>
              <ul className="list-inside list-disc pl-2 text-stone-700">
                {delta.beneficiaries.added.map((b) => (
                  <li key={b.id}>
                    {b.name} ({b.asnaf} · {b.identityBasis.kind === "NIK" ? `NIK: ${b.identityBasis.value}` : b.identityBasis.description})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {delta.beneficiaries.removed.length > 0 && (
            <div className="space-y-1">
              <p className="flex items-center gap-1 font-medium text-red-700">
                <Trash2 className="h-3 w-3" /> Dihapus ({delta.beneficiaries.removed.length}):
              </p>
              <ul className="list-inside list-disc pl-2 text-stone-700">
                {delta.beneficiaries.removed.map((b) => (
                  <li key={b.id}>
                    {b.name} ({b.asnaf})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {delta.beneficiaries.modified.length > 0 && (
            <div className="space-y-1">
              <p className="flex items-center gap-1 font-medium text-blue-700">
                <Check className="h-3 w-3" /> Diubah ({delta.beneficiaries.modified.length}):
              </p>
              <ul className="space-y-1 pl-2 text-stone-700">
                {delta.beneficiaries.modified.map(({ before, after }) => (
                  <li key={after.id} className="flex items-center gap-2">
                    <span className="line-through text-stone-400">{before.name} ({before.asnaf})</span>
                    <ArrowRight className="h-3 w-3 text-stone-400" />
                    <span className="font-medium text-stone-800">{after.name} ({after.asnaf})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {hasAidLineChanges && (
        <div className="space-y-2 rounded-lg border border-stone-200 bg-white p-3">
          <p className="font-semibold text-stone-900">Perubahan Rincian Bantuan & Hak:</p>
          {delta.aidLines.added.length > 0 && (
            <div className="space-y-1">
              <p className="flex items-center gap-1 font-medium text-emerald-700">
                <Plus className="h-3 w-3" /> Baris Baru ({delta.aidLines.added.length}):
              </p>
              <ul className="list-inside list-disc pl-2 text-stone-700">
                {delta.aidLines.added.map((line) => (
                  <li key={line.id}>
                    {line.aidType} · {line.value.kind === "MONEY" ? formatIdrAmount(line.value.amountRequestedIdr) : `${line.value.quantityRequested} ${line.value.unit}`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {delta.aidLines.removed.length > 0 && (
            <div className="space-y-1">
              <p className="flex items-center gap-1 font-medium text-red-700">
                <Trash2 className="h-3 w-3" /> Baris Dihapus ({delta.aidLines.removed.length}):
              </p>
              <ul className="list-inside list-disc pl-2 text-stone-700">
                {delta.aidLines.removed.map((line) => (
                  <li key={line.id}>
                    {line.aidType} · {line.value.kind === "MONEY" ? formatIdrAmount(line.value.amountRequestedIdr) : `${line.value.quantityRequested} ${line.value.unit}`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {delta.aidLines.modified.length > 0 && (
            <div className="space-y-1">
              <p className="flex items-center gap-1 font-medium text-blue-700">
                <Check className="h-3 w-3" /> Baris Diubah ({delta.aidLines.modified.length}):
              </p>
              <ul className="space-y-2 pl-2 text-stone-700">
                {delta.aidLines.modified.map(({ before, after }) => {
                  const fromText = before.value.kind === "MONEY"
                    ? formatIdrAmount(before.value.amountApprovedIdr ?? before.value.amountRequestedIdr)
                    : `${before.value.quantityApproved ?? before.value.quantityRequested} ${before.value.unit}`;
                  const toText = after.value.kind === "MONEY"
                    ? formatIdrAmount(after.value.amountApprovedIdr ?? after.value.amountRequestedIdr)
                    : `${after.value.quantityApproved ?? after.value.quantityRequested} ${after.value.unit}`;

                  return (
                    <li key={after.id} className="rounded border border-stone-100 bg-stone-50/50 p-2">
                      <p className="font-medium text-stone-800">{after.aidType} (ID: {after.id})</p>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-stone-500">Sebelumnya: {fromText}</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="font-bold text-emerald-800">Menjadi: {toText}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

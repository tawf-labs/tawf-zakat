import { formatIdrAmount } from "../workspace/mandateLabels";
import { REALIZATION_PROGRESS_LABELS, type ProposalRealizationSummary } from "./disbursementClient";

const Metric = ({ label, value, detail }: { label: string; value: string; detail: string }) =>
  <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
    <dt className="text-xs text-stone-600">{label}</dt>
    <dd className="font-mono text-base font-bold text-stone-900">{value}</dd>
    <dd className="text-xs text-stone-600">{detail}</dd>
  </div>;


export function RealizationSummaryMetrics({ summary }: { summary: ProposalRealizationSummary }) {
  return <>
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {summary.lines.some((line) => line.kind === "MONEY") && <>
      <Metric label="Hak disetujui (IDR)" value={formatIdrAmount(summary.totalApprovedIdr)} detail={`${summary.approvedBeneficiaryCount} penerima manfaat`} />
      <Metric label="Tersalur IDR (dilaporkan)" value={formatIdrAmount(summary.totalRealizedIdr)}
        detail={`${summary.realizedBeneficiaryCount} dari ${summary.approvedBeneficiaryCount} penerima · ${summary.paymentEventCount} kejadian`} />
      <Metric label="Sisa hak (IDR)" value={formatIdrAmount(summary.totalRemainingIdr)} detail={REALIZATION_PROGRESS_LABELS[summary.disbursementStatus]} />
      </>}
      <Metric label="Kelengkapan bukti" value={summary.evidenceCompleteness === "EVIDENCE_COMPLETE" ? "Bukti lengkap" : "Bukti perlu dilengkapi"}
        detail={`${summary.pendingEvidenceCount} kejadian belum lengkap buktinya}`} />
    </dl>
    {summary.unitSummaries.length > 0 && (
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
        <p className="text-xs font-semibold text-stone-700">Realisasi barang per jenis dan satuan:</p>
        <div className="mt-1.5 flex flex-wrap gap-2.5">
          {summary.unitSummaries.map((unitSummary) => (
            <span key={JSON.stringify([unitSummary.aidType, unitSummary.unit])} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs text-stone-800 shadow-sm">
              <span className="font-semibold text-stone-900">{unitSummary.aidType} ({unitSummary.unit}):</span>
              <span>disetujui {unitSummary.approved} · tersalur {unitSummary.realized} · sisa {unitSummary.remaining}</span>
            </span>
          ))}
        </div>
      </div>
    )}
    <p className="text-xs text-stone-600">
      {!summary.lines.some((line) => line.kind === "MONEY") && <>{REALIZATION_PROGRESS_LABELS[summary.disbursementStatus]} · {summary.realizedBeneficiaryCount} dari {summary.approvedBeneficiaryCount} penerima. </>}
      Konfirmasi penerima: {summary.confirmedCount} dikonfirmasi · {summary.disputedCount} diperselisihkan. Status tersalur tidak berarti bukti lengkap atau opini audit.
    </p>

    {summary.lines.filter((line) => line.kind === "GOODS").map((line) => <p key={line.aidLineId} className="text-xs text-stone-600">
      {line.beneficiaryName} · {line.aidType}: {line.valuedAmountIdr != null
        ? `Estimasi nilai pengajuan ${formatIdrAmount(line.valuedAmountIdr)}. Dasar: ${line.valuationBasis}`
        : "Nilai IDR belum tersedia dengan dasar penilaian."}
    </p>)}
  </>;
}

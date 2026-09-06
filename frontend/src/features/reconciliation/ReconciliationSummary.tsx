import React from "react";
import { CheckCircle2, Scale as ScaleIcon, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { formatMoney, formatSignedMoney, periodLabel } from "./format";
import type { ReconciliationReport, WireDiscrepancy } from "./types";

interface ReconciliationSummaryProps {
  report: ReconciliationReport;
  /** Entry-level gaps currently on screen, so the headline follows the filters. */
  visibleEntryGaps: WireDiscrepancy[];
  totalFindingCount: number;
  filtered: boolean;
}

/** Sums signed decimal strings without going through a float. */
function sumAmounts(values: string[]): string {
  return values.reduce((total, value) => (BigInt(total) + BigInt(value)).toString(), "0");
}

export function ReconciliationSummary({
  report,
  visibleEntryGaps,
  totalFindingCount,
  filtered,
}: ReconciliationSummaryProps) {
  const unit = report.netDelta.unit;
  const netAmount = filtered
    ? sumAmounts(visibleEntryGaps.map((d) => d.delta.amount))
    : report.netDelta.amount;
  const absoluteAmount = filtered
    ? sumAmounts(visibleEntryGaps.map((d) => d.delta.amount.replace(/^-/, "")))
    : report.absoluteDelta.amount;

  const nothingToShow = visibleEntryGaps.length === 0 && totalFindingCount === 0;
  const claimIsBigger = !netAmount.startsWith("-") && netAmount !== "0";

  if (nothingToShow) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 md:p-8">
        <div className="flex items-start gap-4">
          <CheckCircle2 className="mt-0.5 h-8 w-8 shrink-0 text-emerald-600" />
          <div>
            <h2 className="font-serif text-2xl font-bold text-emerald-900">
              Tidak ada selisih.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-emerald-800">
              Setiap entri pada <strong>{report.claimLabel}</strong> cocok dengan{" "}
              <strong>{report.sourceLabel}</strong>, dan setiap total yang dideklarasikan sama
              dengan jumlah rinciannya. Periode {periodLabel(report.period)}.
            </p>
            <p className="mt-2 text-xs text-emerald-700">
              {report.entryCounts.matched} entri tercocokkan dari {report.entryCounts.claim} baris
              rekap dan {report.entryCounts.source} baris laporan.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#dbe7dd] bg-white p-6 shadow-xs md:p-8">
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
            <ScaleIcon className="h-3.5 w-3.5" />
            Total selisih bersih{filtered ? " (sesuai filter)" : ""}
          </p>
          <p
            className={`mt-2 font-serif text-3xl font-bold tracking-tight sm:text-4xl ${
              netAmount === "0" ? "text-[#17332c]" : "text-amber-700"
            }`}
          >
            {formatSignedMoney({ amount: netAmount, unit })}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-[#5e7a70]">
            {claimIsBigger ? (
              <TrendingUp className="h-4 w-4 text-amber-600" />
            ) : (
              <TrendingDown className="h-4 w-4 text-sky-600" />
            )}
            {netAmount === "0"
              ? "Selisih saling menghapus di tingkat total - periksa rinciannya di bawah."
              : claimIsBigger
                ? `${report.claimLabel} lebih besar daripada ${report.sourceLabel}.`
                : `${report.sourceLabel} lebih besar daripada ${report.claimLabel}.`}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3 md:text-right">
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
              Nilai mutlak
            </dt>
            <dd className="mt-0.5 font-semibold text-[#17332c]">
              {formatMoney({ amount: absoluteAmount, unit })}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
              Selisih per entri
            </dt>
            <dd className="mt-0.5 font-semibold text-[#17332c]">{visibleEntryGaps.length}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
              Selisih jenis total
            </dt>
            <dd className="mt-0.5 font-semibold text-[#17332c]">{totalFindingCount}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
              Entri tercocokkan
            </dt>
            <dd className="mt-0.5 font-semibold text-[#17332c]">{report.entryCounts.matched}</dd>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
              Periode
            </dt>
            <dd className="mt-0.5">
              <Badge variant="info">{periodLabel(report.period)}</Badge>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

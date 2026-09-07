import { CircleHelp, Download, ShieldCheck, ShieldAlert } from "lucide-react";
import { amilStatusLabel } from "./amilText";
import { formatMoney } from "./format";
import type { ReconciliationReport } from "./types";

export function AmilAssessmentPanel({ report, onExport }: {
  report: ReconciliationReport;
  onExport?: () => void;
}) {
  const assessment = report.amilAssessment;
  const status = assessment?.status ?? "NOT_CHECKED";
  const Icon = status === "EXCEEDED" ? ShieldAlert : status === "WITHIN_CEILING" ? ShieldCheck : CircleHelp;
  const color = status === "EXCEEDED" ? "text-red-800" : status === "WITHIN_CEILING" ? "text-emerald-800" : "text-amber-800";
  return (
    <section className="min-w-0 border-y border-[#dbe7dd] py-4" aria-label="Pemeriksaan hak amil">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-start gap-2 text-sm font-semibold">
          <Icon className={`h-5 w-5 shrink-0 ${color}`} aria-hidden="true" />
          <span className={color}>Hak amil: {amilStatusLabel(status)}</span>
        </h3>
        {onExport && (
          <button type="button" onClick={onExport} title="Unduh hasil rekonsiliasi"
            className="inline-flex cursor-pointer items-center gap-2 rounded border border-[#dbe7dd] px-3 py-2 text-xs font-semibold text-[#17332c] hover:bg-[#f4f8f3]">
            <Download className="h-4 w-4" aria-hidden="true" />Unduh hasil
          </button>
        )}
      </div>
      {assessment?.checks.length ? (
        <details className="mt-3" open={status === "EXCEEDED"}>
          <summary className="cursor-pointer text-xs font-semibold text-[#5e7a70]">Rincian hak amil ({assessment.checks.length})</summary>
          <div className="mt-3 max-h-96 overflow-auto" tabIndex={0} role="region" aria-label="Rincian plafon hak amil">
            <table className="w-full min-w-[680px] table-fixed text-left text-xs">
              <thead className="border-b border-[#dbe7dd] text-[#5e7a70]">
                <tr>{["Sisi / PZ / cakupan", "Pengumpulan", "Hak amil", "Plafon 12,5%", "Status"].map((title) =>
                  <th key={title} className="px-2 py-2 font-semibold">{title}</th>
                )}</tr>
              </thead>
              <tbody className="divide-y divide-[#dbe7dd] text-[#17332c]">
                {assessment.checks.map((check) => (
                  <tr key={JSON.stringify([check.side, check.key, check.balanceSheet])} className="align-top">
                    <td className="break-words px-2 py-3">
                      <strong>{check.side === "claim" ? "Klaim" : "Sumber"}</strong>
                      <div>{check.key} / {check.balanceSheet}</div>
                      <div className="mt-1 text-[#5e7a70]">{check.label}</div>
                    </td>
                    {[check.collected, check.actual, check.ceiling].map((value, index) => (
                      <td key={index} className="break-words px-2 py-3 font-mono tabular-nums">
                        {value ? formatMoney(value) : "Tidak tersedia"}
                      </td>
                    ))}
                    <td className="break-words px-2 py-3">
                      <strong className={check.status === "EXCEEDED" ? "text-red-800" : check.status === "NOT_CHECKED" ? "text-amber-800" : "text-emerald-800"}>
                        {amilStatusLabel(check.status)}
                      </strong>
                      {check.reason && <p className="mt-1 text-[#5e7a70]">{check.reason}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : <p className="mt-2 text-xs text-[#5e7a70]">Hasil ini belum memuat pemeriksaan hak amil.</p>}
    </section>
  );
}

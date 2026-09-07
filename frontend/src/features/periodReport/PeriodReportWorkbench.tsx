import { AlertTriangle, Info } from "lucide-react";
import { usePeriodReport } from "./usePeriodReport";
import { PeriodPicker } from "./PeriodPicker";
import { FigureTable } from "./FigureTable";
import { AmilCeilingCard } from "./AmilCeilingCard";
import { AttestationList } from "./AttestationList";
import { NarrativePanel } from "./NarrativePanel";
import { VerdictBanner } from "./VerdictBanner";
import { periodLabel } from "../../lib/reporting";

/** Lays out the period report. Every decision it shows lives in the hook. */
export function PeriodReportWorkbench() {
  const report = usePeriodReport();
  const { figures, verdict } = report;

  return (
    <div className="space-y-6">
      <PeriodPicker
        period={report.period}
        onPeriodChange={report.setPeriod}
        onLoadFigures={() => report.loadFigures()}
        onDraft={report.draftNarrative}
        isLoadingFigures={report.isLoadingFigures}
        isDrafting={report.isDrafting}
      />

      {report.error && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm leading-relaxed text-red-900">{report.error}</p>
        </div>
      )}

      {!figures && !report.error && (
        <div className="flex items-start gap-3 rounded-2xl border border-[#dbe7dd] bg-white p-5">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-[#1b765e]" />
          <p className="text-sm leading-relaxed text-[#3d5b52]">
            Pilih periode pelaporan, lalu hitung angkanya. Angka dihitung dari ledger, bukan
            dikarang - narasi baru disusun setelah angkanya ada.
          </p>
        </div>
      )}

      {figures && (
        <>
          {verdict && (
            <VerdictBanner
              verdict={verdict}
              signable={report.signable}
              onDownload={report.download}
            />
          )}

          <p className="text-xs font-bold uppercase tracking-wider text-[#5e7a70]">
            {periodLabel(figures.period)}
          </p>

          <div className="grid gap-6 lg:grid-cols-2">
            <FigureTable
              title="Pengumpulan"
              description="Per jenis dana, mengikuti PerBAZNAS 1/2023."
              figures={figures.collection}
            />
            <FigureTable
              title="Penyaluran"
              description="Per asnaf. Rupiah dan USDC dilaporkan sebagai satuan yang berbeda dan tidak pernah dijumlahkan."
              figures={figures.distribution}
            />
          </div>

          <AmilCeilingCard amilShare={figures.amilShare} />
          <AttestationList figures={figures} />

          <NarrativePanel
            narrative={report.draft?.narrative ?? null}
            unavailable={report.draftUnavailable}
            requested={report.draftRequested}
            rejected={verdict?.outcome === "DITOLAK"}
          />

          {figures.notes.length > 0 && (
            <div className="rounded-2xl border border-[#dbe7dd] bg-[#f9fbf9] p-5">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
                Batas laporan ini
              </h3>
              <ul className="mt-2 space-y-1.5">
                {figures.notes.map((note) => (
                  <li key={note} className="text-xs leading-relaxed text-[#3d5b52]">
                    - {note}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

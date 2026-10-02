import { useEffect, useState } from "react";
import { ChevronDown, FileBarChart } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "./privateRequests";
import { PreparationTechnicalDetail } from "./PreparationTechnicalDetail";
import { PeriodReportWizard } from "./PeriodReportWizard";
import { PeriodReportReviewWizard } from "./PeriodReportReviewWizard";
import {
  formatCutOff,
  listPeriodReports,
  statusLabel,
  type Period,
  type PeriodReportStatus,
  type PeriodReportSummary,
} from "./periodReportClient";

/**
 * Bukti & laporan: the institution's period reports (ADR-0043, #130).
 *
 * The list comes first, one card per period, then the outlined **Laporan periode
 * baru** button, following the Penyaluran panel. Everything an examiner needs from
 * the locked data - manifests, commitment, files, registry recovery - sits behind
 * each card's *Detail teknis*, closed until asked for.
 *
 * A published report lists its versions; the current one offers **Buat koreksi** (#133),
 * which reopens the wizard on the same period, and older ones stay readable as *Dikoreksi*.
 */

const STATUS_VARIANTS: Record<PeriodReportStatus, "neutral" | "info" | "success" | "warning"> = {
  DRAF: "neutral",
  SIAP_TERBIT: "info",
  TERBIT: "success",
  DIKOREKSI: "warning",
};

const periodKey = (period: Period) => `${period.year}:${period.kind}`;

function ReportCard({ report, open, onToggle, requests, canPrepare, canWriteReport, reviewing, onReview, onChanged, onOpenCosts }: {
  report: PeriodReportSummary; open: boolean; onToggle: () => void; requests: PrivateRequests; canPrepare: boolean;
  /** Report packages are written by officers (the report package routes' own rule). */
  canWriteReport: boolean;
  /** The locked data the review wizard is open on, if any. */
  reviewing: string | null; onReview: (preparationId: string | null) => void; onChanged: () => void;
  onOpenCosts?: () => void;
}) {
  const [technical, setTechnical] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  // A correction locks the period's data again; only a report built from the app's data has a flow to correct it with.
  const canCorrect = canPrepare && report.fromApp && report.published !== null && !reviewing && !correcting;
  return (
    <li className="rounded-xl border border-stone-200 bg-white">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex min-h-11 w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-stone-50">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-stone-900">Laporan penyaluran {report.name}</span>
          <span className="mt-1 block text-xs text-stone-500">
            {report.cutOff ? `Batas data ${formatCutOff(report.cutOff)}` : "Batas data tidak tercatat"}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Badge variant={STATUS_VARIANTS[report.status]}>{statusLabel(report)}</Badge>
          <ChevronDown className={`h-4 w-4 text-stone-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-stone-100 p-4 text-sm text-stone-700">
          {!report.fromApp && (
            <p className="text-xs text-stone-600">Data laporan ini disiapkan dari sumber tempel atau unggahan sebelum alur data aplikasi.</p>
          )}
          {report.fromApp && !report.comparedWithBookkeeping && (
            <p className="text-xs text-stone-600">Angka disusun dari data aplikasi dan tidak dibandingkan dengan pembukuan bendahara.</p>
          )}
          {report.versions.length > 0 && (
            <section aria-label="Versi terbit">
              <h5 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Versi terbit</h5>
              <ul className="mt-2 space-y-2">
                {report.versions.map((version) => (
                  <li key={version.packageId} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-stone-200 p-2 text-xs text-stone-600">
                    <span className="font-semibold text-stone-800">Versi {version.version}</span>
                    <span>terbit {formatCutOff(new Date(version.publishedAt * 1000).toISOString())}</span>
                    {/* Superseded by a later version, yet still readable: what was published stays on record. */}
                    <Badge variant={version.superseded ? "warning" : "success"}>{version.superseded ? "Dikoreksi" : "Berlaku"}</Badge>
                    <a className="underline" href={`/transparansi/laporan?packageId=${encodeURIComponent(version.packageId)}`} target="_blank" rel="noreferrer">Lihat ringkasan publik</a>
                    {!version.superseded && canCorrect && report.status === "TERBIT" && (
                      <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => setCorrecting(true)}>Buat koreksi</Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {correcting && report.published ? (
            <PeriodReportWizard
              requests={requests}
              correcting={{ period: report.period, name: report.name, version: report.published.version }}
              onOpenCosts={onOpenCosts}
              onCancel={() => setCorrecting(false)}
              onLocked={(preparationId) => {
                setCorrecting(false);
                if (canWriteReport) onReview(preparationId);
                onChanged();
              }}
            />
          ) : reviewing ? (
            <PeriodReportReviewWizard key={reviewing} preparationId={reviewing} periodName={report.name} requests={requests}
              onClose={() => onReview(null)} onChanged={onChanged} onOpenCosts={onOpenCosts} />
          ) : report.status === "DIKOREKSI" ? (
            <div className="flex flex-wrap gap-2">
              {canWriteReport && report.fromApp && (
                <Button type="button" variant="outline" onClick={() => onReview(report.preparationId)}>Lanjutkan koreksi</Button>
              )}
              {canCorrect && (
                <Button type="button" variant="ghost" onClick={() => setCorrecting(true)}>Kunci ulang data koreksi</Button>
              )}
            </div>
          ) : canWriteReport && report.fromApp && report.status !== "TERBIT" && (
            <Button type="button" variant="outline" onClick={() => onReview(report.preparationId)}>Tinjau dan terbitkan</Button>
          )}
          <details className="rounded-lg border border-stone-200 bg-stone-50" onToggle={(event) => setTechnical(event.currentTarget.open)}>
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-600">Detail teknis</summary>
            {/* Read only once opened: each locked data set is a full snapshot fetch. */}
            {technical && <div className="space-y-6 border-t border-stone-200 bg-white p-3">
              {report.preparations.map((prep, index) => (
                <section key={prep.id} aria-label={`Data laporan dikunci ${formatCutOff(new Date(prep.createdAt * 1000).toISOString())}`}>
                  {report.preparations.length > 1 && (
                    <h5 className="mb-2 text-xs font-semibold text-stone-500">
                      {index === 0 ? "Data terbaru" : "Data sebelumnya"} · dikunci {formatCutOff(new Date(prep.createdAt * 1000).toISOString())}
                    </h5>
                  )}
                  <PreparationTechnicalDetail preparationId={prep.id} requests={requests} canPrepare={canPrepare} />
                </section>
              ))}
            </div>}
          </details>
        </div>
      )}
    </li>
  );
}

export function PeriodReportPanel({ requests, canPrepare, canWriteReport, onOpenCosts }: {
  requests: PrivateRequests; canPrepare: boolean; canWriteReport: boolean;
  /** Opens Penyaluran, where a cost row a published report locked is corrected (#129). */
  onOpenCosts?: () => void;
}) {
  const [reports, setReports] = useState<PeriodReportSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<{ key: string; preparationId: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listPeriodReports(requests)
      .then(({ reports }) => { if (!cancelled) { setReports(reports); setError(null); } })
      .catch((caught) => {
        if (!cancelled) { setReports([]); setError(caught instanceof Error ? caught.message : "Daftar laporan tidak dapat dibaca."); }
      });
    return () => { cancelled = true; };
  }, [requests, refresh]);

  return (
    <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-100 pb-4">
        <FileBarChart className="h-5 w-5 text-emerald-700" />
        <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Laporan periode</h3>
      </div>

      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {reports === null ? (
        <p className="text-sm text-stone-600">Memuat laporan…</p>
      ) : reports.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-600">
          Belum ada laporan periode. Buat laporan baru untuk mengunci data penyaluran satu periode.
        </p>
      ) : (
        <ul className="space-y-3">
          {reports.map((report) => {
            const key = periodKey(report.period);
            return (
              <ReportCard key={key} report={report} open={openKey === key} requests={requests} canPrepare={canPrepare}
                canWriteReport={canWriteReport} reviewing={reviewing?.key === key ? reviewing.preparationId : null}
                onReview={(preparationId) => setReviewing(preparationId ? { key, preparationId } : null)}
                onChanged={() => { setNotice(null); setRefresh((value) => value + 1); }}
                onToggle={() => setOpenKey(openKey === key ? null : key)} onOpenCosts={onOpenCosts} />
            );
          })}
        </ul>
      )}

      {canPrepare && (creating ? (
        <PeriodReportWizard
          requests={requests}
          onCancel={() => setCreating(false)}
          onLocked={(preparationId, period) => {
            setCreating(false);
            setNotice("Data laporan dikunci. Lanjutkan dengan meninjau angka dan menulis narasi.");
            setOpenKey(periodKey(period));
            // Step 3 (bookkeeping comparison, #132) is optional and not built yet: go on to step 4.
            if (canWriteReport) setReviewing({ key: periodKey(period), preparationId });
            setRefresh((value) => value + 1);
          }}
        />
      ) : (
        <Button type="button" variant="outline" onClick={() => { setNotice(null); setCreating(true); }}>Laporan periode baru</Button>
      ))}
    </section>
  );
}

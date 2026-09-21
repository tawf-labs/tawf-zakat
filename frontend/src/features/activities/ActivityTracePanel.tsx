import { useEffect, useState } from "react";
import { RefreshCw, Route } from "lucide-react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { errorMessage } from "../contributions/contributionUi";
import { ActivityTrackView } from "../traceability/ActivityTrackView";
import { DIFFERENCE_LABELS, getActivityTrace, type AmilTrace } from "../traceability/traceClient";

/**
 * The amil recap: the activity as it stands now, from the same tracks the donor reads, beside the
 * report snapshots that froze it. A snapshot is history; it never overwrites the current status.
 */
export function ActivityTracePanel({ activityId, requests, reloadKey }: { activityId: string; requests: PrivateRequests; reloadKey: unknown }) {
  const [trace, setTrace] = useState<AmilTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    getActivityTrace(requests, activityId)
      .then((loaded) => !cancelled && setTrace(loaded))
      .catch((err) => !cancelled && setError(errorMessage(err, "Gagal memuat penelusuran kegiatan.")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [activityId, requests, reloadKey, refresh]);

  return (
    <section aria-labelledby="activity-trace-heading" className="rounded-xl border border-stone-200 p-4 space-y-4">
      <h4 id="activity-trace-heading" className="text-xs font-bold uppercase tracking-wider text-stone-800 flex items-center gap-1.5">
        <Route className="h-4 w-4 text-emerald-700" aria-hidden />
        Penelusuran dan Rekap Sumber Laporan
      </h4>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
      {!trace && !error && <p className="text-xs text-stone-500">Memuat penelusuran…</p>}
      {trace && (
        <>
          <div>
            <h5 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-stone-600">Status kegiatan terkini</h5>
            <ActivityTrackView track={trace.activity} />
          </div>
          <div className="space-y-2">
            <h5 className="text-[11px] font-bold uppercase tracking-wider text-stone-600">Snapshot sumber laporan (historis)</h5>
            {trace.reportSources.status === "UNAVAILABLE" ? (
              <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <strong>Belum dapat dibaca.</strong> {trace.reportSources.reason}
              </p>
            ) : trace.reportSources.data.length === 0 ? (
              <p className="text-xs text-stone-600">Kegiatan ini belum dibekukan dalam paket laporan mana pun.</p>
            ) : (
              <ul className="space-y-2">
                {trace.reportSources.data.map((source) =>
                  source.status === "READ" ? (
                    <li key={`${source.preparationId}-${source.role}`} className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs space-y-1">
                      <div className="font-semibold text-stone-900">
                        {source.label} · {source.periodKind} {source.periodYear} · cut-off {new Date(source.cutOff).toLocaleDateString("id-ID")}
                      </div>
                      <div className="text-stone-600">
                        Beku: pengajuan versi {source.frozen.proposalVersion}, {source.frozen.allocationCount} alokasi,{" "}
                        {source.frozen.realizationCount} realisasi · komitmen <span className="font-mono">{source.commitment.slice(0, 12)}…</span>
                      </div>
                      {source.differsFromCurrent.length > 0 ? (
                        <div className="text-amber-800">
                          Berbeda dari status terkini: {source.differsFromCurrent.map((d) => DIFFERENCE_LABELS[d]).join(", ")}.
                        </div>
                      ) : (
                        <div className="text-stone-600">Sama dengan status terkini pada angka yang dibandingkan.</div>
                      )}
                    </li>
                  ) : (
                    <li key={`${source.preparationId}-${source.role}`} role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      <strong>{source.label}:</strong> {source.reason}
                    </li>
                  ),
                )}
              </ul>
            )}
          </div>
          <p className="text-[11px] text-stone-500">{trace.claimLimits.report}</p>
          <p className="text-[11px] text-stone-500">{trace.claimLimits.certificate}</p>
        </>
      )}
      <button
        type="button"
        disabled={loading}
        onClick={() => setRefresh((n) => n + 1)}
        className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-xs text-stone-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
      >
        <RefreshCw aria-hidden className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        {loading ? "Memuat ulang…" : "Muat ulang penelusuran"}
      </button>
    </section>
  );
}

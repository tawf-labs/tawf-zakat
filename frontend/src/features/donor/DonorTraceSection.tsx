import { Loader2, RefreshCw, Route } from "lucide-react";
import { formatNominal } from "../contributions/contributionClient";
import type { CurrencyUnit } from "../contributions/contributionClient";
import { ActivityTrackView } from "../traceability/ActivityTrackView";
import { isActivityTrack, type DonorTrace } from "../traceability/traceClient";
import { useEffect } from "react";
import { DonorSessionEndedError, type DonorSessionRecord } from "./donorClient";
import { useDonorTrace } from "./donorQueries";
import { Notice } from "./DonorNotice";
import { DonorRefunds } from "./DonorRefunds";

/** Progress of what the contribution funds, drawn from the same tracks the amil recap reads. */
export function DonorTraceSection({ session, onSessionEnded }: {
  session: DonorSessionRecord;
  onSessionEnded?: (message: string) => void;
}) {
  const trace = useDonorTrace(session);
  useEffect(() => {
    if (trace.error instanceof DonorSessionEndedError) onSessionEnded?.(trace.error.message);
  }, [trace.error, onSessionEnded]);
  return (
    <section aria-labelledby="donor-trace-heading" className="rounded-3xl border border-tawf-green-10 bg-white p-6 sm:p-8 shadow-sm space-y-5">
      <div className="flex items-center gap-3 border-b border-tawf-green-10 pb-4">
        <Route className="w-5 h-5 text-tawf-green-light" aria-hidden />
        <div>
          <h4 id="donor-trace-heading" className="font-serif text-lg font-bold text-tawf-green">Penelusuran Kegiatan</h4>
          <p className="text-xs text-tawf-muted">Kemajuan kegiatan, dana, konfirmasi penerima, dan sertifikat penyaluran ditampilkan terpisah agar tidak tercampur.</p>
        </div>
      </div>
      {trace.isPending ? (
        <p className="text-xs text-tawf-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden />Memuat penelusuran...</p>
      ) : trace.isError ? (
        <Notice tone="error">{trace.error.message}</Notice>
      ) : (
        <TraceBody trace={trace.data} />
      )}
      <button
        type="button"
        disabled={trace.isFetching}
        onClick={() => void trace.refetch()}
        className="inline-flex items-center gap-2 rounded-xl border border-tawf-green-10 px-3 py-2 text-xs text-tawf-green disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-tawf-green-light"
      >
        <RefreshCw aria-hidden className={`h-3 w-3 ${trace.isFetching ? "animate-spin" : ""}`} />
        {trace.isFetching ? "Memuat ulang…" : "Muat ulang penelusuran"}
      </button>
    </section>
  );
}

function TraceBody({ trace }: { trace: DonorTrace }) {
  const { contribution } = trace;
  return (
    <div className="space-y-5">
      {contribution.proofMatchesContributionVersion === false && (
        <Notice tone="warning">
          Bukti kontribusi tercatat untuk versi {contribution.proof.version}, sedangkan kontribusi Anda kini versi {contribution.version}.
          Bukti lama tetap dapat diperiksa, tetapi bukan bukti versi terkini.
        </Notice>
      )}
      {contribution.corrections.length > 0 && (
        <Notice tone="info">
          Kontribusi ini pernah dikoreksi {contribution.corrections.length} kali. Alokasi dan bukti mengikuti versi yang tercatat di bawah.
        </Notice>
      )}
      {trace.changes.map((change, index) => (
        <Notice key={index} tone="info">
          {formatNominal(change.amountExact, change.currencyUnit as CurrencyUnit)} dari kontribusi Anda dialihkan lembaga
          {change.toActivityName ? ` ke kegiatan "${change.toActivityName}"` : " ke kegiatan lain"} pada{" "}
          {new Date(change.at * 1000).toLocaleDateString("id-ID")}.
          <span className="block mt-1"><strong>Alasan pengalihan:</strong> {change.reason}</span>
        </Notice>
      ))}

      <DonorRefunds refunds={trace.refunds} />

      {trace.activities.length === 0 ? (
        <p className="text-xs text-tawf-muted">Belum ada kegiatan yang didanai kontribusi ini.</p>
      ) : (
        <ul className="space-y-6">
          {trace.activities.map((activity) => (
            <li key={activity.allocationId} className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <h5 className="font-serif text-base font-bold text-tawf-green">
                  {isActivityTrack(activity.track) ? activity.track.identity.name : "Kegiatan penyaluran"}
                </h5>
                <span className="text-xs text-tawf-muted">
                  Bagian Anda {formatNominal(activity.allocatedAmountExact, activity.currencyUnit as CurrencyUnit)} dari {activity.pooledAllocationCount} alokasi
                </span>
              </div>
              {activity.allocationBasis === "BEFORE_CORRECTION" && (
                <Notice tone="warning">Alokasi ini dibuat sebelum kontribusi dikoreksi; nilainya sedang ditelaah lembaga.</Notice>
              )}
              {isActivityTrack(activity.track) ? (
                <ActivityTrackView track={activity.track} />
              ) : (
                <Notice tone="warning">Progres kegiatan belum dapat dibaca: {activity.track.reason}</Notice>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-tawf-green-10 pt-4 space-y-1.5 text-[11px] text-tawf-muted">
        <p>{trace.claimLimits.pooled}</p>
        <p>{trace.claimLimits.receipt}</p>
        <p>{trace.claimLimits.certificate}</p>
      </div>
    </div>
  );
}

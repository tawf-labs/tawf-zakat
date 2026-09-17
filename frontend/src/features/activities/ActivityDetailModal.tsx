import { useEffect, useState } from "react";
import { AlertCircle, ShieldCheck, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "../workspace/privateRequests";
import { formatNominal } from "../contributions/contributionClient";
import { errorMessage } from "../contributions/contributionUi";
import { allocationPercent, getActivity, type ActivityDetail } from "./activityClient";
import { ActivityAllocations } from "./ActivityAllocations";
import { TargetAmount } from "./ActivityTable";

export function ActivityDetailModal({
  activityId,
  requests,
  onClose,
}: {
  activityId: string;
  requests: PrivateRequests;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getActivity(requests, activityId)
      .then((data) => !cancelled && setDetail(data))
      .catch((err) => !cancelled && setError(errorMessage(err, "Gagal memuat detail kegiatan.")));
    return () => {
      cancelled = true;
    };
  }, [activityId, requests]);

  const pct = detail ? allocationPercent(detail) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label="Detail kegiatan penyaluran" className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between border-b border-stone-200 px-6 py-4 bg-stone-50/80">
          <div>
            <span className="font-mono text-xs text-stone-500">ID: {activityId}</span>
            <h3 className="mt-1 text-lg font-bold text-stone-900">{detail?.name ?? "Detail Kegiatan Penyaluran"}</h3>
            {detail?.description && <p className="mt-1 text-xs text-stone-600">{detail.description}</p>}
          </div>
          <button onClick={onClose} aria-label="Tutup" className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-200 hover:text-stone-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!detail && !error && <div className="py-12 text-center text-sm text-stone-500">Memuat rincian kegiatan…</div>}
          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

          {detail && (
            <>
              <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Pengajuan disahkan <strong className="font-mono text-stone-800">{detail.proposalId}</strong> versi {detail.proposalVersion}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-stone-200 p-3">
                  <span className="text-xs uppercase tracking-wider text-stone-500">Target Kebutuhan</span>
                  <div className="text-base font-bold text-stone-900"><TargetAmount activity={detail} /></div>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                  <span className="text-xs uppercase tracking-wider text-emerald-800">Teralokasi{pct !== null && ` (${pct}%)`}</span>
                  <div className="text-base font-bold text-emerald-700">{formatNominal(detail.totalAllocatedAmount, detail.currencyUnit)}</div>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                  <span className="text-xs uppercase tracking-wider text-amber-800">Sisa Kebutuhan</span>
                  <div className="text-base font-bold text-amber-700">{formatNominal(detail.unallocatedNeed, detail.currencyUnit)}</div>
                </div>
              </div>

              <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-4 text-xs text-amber-900 space-y-1.5">
                <div className="flex items-center gap-2 font-semibold text-amber-950">
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-700" />
                  Catatan internal lembaga, bukan saldo bank
                </div>
                <p className="leading-relaxed">{detail.disclaimer}</p>
                <p className="border-t border-amber-200 pt-1.5 text-[11px] text-amber-800">
                  <strong>Cakupan penelusuran:</strong> {detail.tracingCoverage}
                </p>
              </div>

              <ActivityAllocations detail={detail} />
            </>
          )}
        </div>

        <div className="border-t border-stone-200 px-6 py-3 bg-stone-50 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>Tutup</Button>
        </div>
      </div>
    </div>
  );
}

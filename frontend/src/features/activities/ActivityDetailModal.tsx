import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowRightLeft, CheckCircle2, Clock, Package, ShieldCheck, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "../workspace/privateRequests";
import { formatNominal } from "../contributions/contributionClient";
import { errorMessage } from "../contributions/contributionUi";
import { allocationPercent, getActivity, type ActivityDetail } from "./activityClient";
import { ActivityAllocations } from "./ActivityAllocations";
import { ActivityTracePanel } from "./ActivityTracePanel";
import { TargetAmount } from "./ActivityTable";
import { ReallocateModal } from "./ReallocateModal";

/** How each availability status reads, so the card, its heading and its button agree. */
const AVAILABILITY = {
  AVAILABLE: {
    title: "Dana Tersedia Untuk Dialihkan",
    card: "bg-emerald-50/80 border-emerald-300 text-emerald-950",
  },
  INDETERMINATE: {
    title: "Status Ketersediaan: Belum Dapat Ditetapkan",
    card: "bg-amber-50/80 border-amber-300 text-amber-950",
  },
  NONE: {
    title: "Status Ketersediaan: Nihil / Habis",
    card: "bg-stone-100 border-stone-300 text-stone-800",
  },
} as const;

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
  const [showReallocate, setShowReallocate] = useState(false);

  /** Resolves to a discard function, so a reload that outlives this modal writes nothing. */
  const loadData = useCallback(() => {
    let cancelled = false;
    getActivity(requests, activityId)
      .then((loaded) => {
        if (!cancelled) setDetail(loaded);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Gagal memuat detail kegiatan."));
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, requests]);

  useEffect(() => loadData(), [loadData]);

  const pct = detail ? allocationPercent(detail) : null;
  const acc = detail?.accountability;
  const reallocs = detail?.reallocations ?? [];
  const availability = acc ? AVAILABILITY[acc.availabilityStatus] : null;
  const shortfall = acc ? BigInt(acc.totalContributionShortfall) : 0n;
  const overCommitment = acc ? BigInt(acc.totalOverCommitmentIdr) : 0n;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Detail kegiatan penyaluran"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden"
      >
        <div className="flex items-start justify-between border-b border-stone-200 px-6 py-4 bg-stone-50/80">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-stone-500">ID: {activityId}</span>
              <span className="rounded bg-stone-200 px-1.5 py-0.5 text-[10px] font-semibold text-stone-700 uppercase">
                Versi {detail?.version ?? 1}
              </span>
            </div>
            <h3 className="mt-1 text-lg font-bold text-stone-900">{detail?.name ?? "Detail Kegiatan Penyaluran"}</h3>
            {detail?.description && <p className="mt-1 text-xs text-stone-600">{detail.description}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-200 hover:text-stone-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!detail && !error && <div className="py-12 text-center text-sm text-stone-500">Memuat rincian kegiatan…</div>}
          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

          {detail && (
            <>
              <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Pengajuan disahkan <strong className="font-mono text-stone-800">{detail.proposalId}</strong> versi {detail.proposalVersion}
                </div>
                {acc?.isRemainderClosed && (
                  <span className="rounded-full bg-stone-200 px-2.5 py-0.5 text-xs font-semibold text-stone-800">
                    Sisa Bantuan Ditutup (SK Sah)
                  </span>
                )}
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

              {/* Akuntabilitas & Ketersediaan Dana */}
              {acc && (
                <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-stone-800 flex items-center gap-1.5">
                      <ArrowRightLeft className="h-4 w-4 text-emerald-700" />
                      Akuntabilitas Keuangan & Ketersediaan Dana Pengalihan
                    </h4>
                    {acc.hasOutstandingAccountability && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Uang Muka Belum Selesai
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                    <div className="rounded-lg border border-stone-200 bg-white p-2.5">
                      <span className="text-xs text-stone-500 block">Realisasi Uang</span>
                      <strong className="text-stone-900 font-semibold">{formatNominal(acc.totalRealizedMoneyIdr, detail.currencyUnit)}</strong>
                    </div>
                    <div className="rounded-lg border border-stone-200 bg-white p-2.5">
                      <span className="text-xs text-stone-500 block">Realisasi Barang (Rupiah)</span>
                      <strong className="text-stone-900 font-semibold">{formatNominal(acc.totalRealizedGoodsIdr, detail.currencyUnit)}</strong>
                    </div>
                    <div className="rounded-lg border border-stone-200 bg-white p-2.5">
                      <span className="text-xs text-stone-500 block">Biaya Aktual</span>
                      <strong className="text-stone-900 font-semibold">{formatNominal(acc.totalExpensesIdr, detail.currencyUnit)}</strong>
                    </div>
                    <div className="rounded-lg border border-stone-200 bg-white p-2.5">
                      <span className="text-xs text-stone-500 block">Uang Muka Petugas</span>
                      <strong className="text-stone-900 font-semibold">{formatNominal(acc.totalAdvancesIdr, detail.currencyUnit)}</strong>
                    </div>
                    <div className="rounded-lg border border-stone-200 bg-white p-2.5">
                      <span className="text-xs text-stone-500 block">Sisa Uang Muka</span>
                      <strong className={acc.hasOutstandingAccountability ? "text-amber-700 font-semibold" : "text-stone-900 font-semibold"}>
                        {formatNominal(acc.unaccountedAdvancesIdr, detail.currencyUnit)}
                      </strong>
                    </div>
                    <div className="rounded-lg border border-stone-200 bg-white p-2.5">
                      <span className="text-xs text-stone-500 block">Hak Bantuan Belum Diserahkan</span>
                      <strong className="text-stone-900 font-semibold">{formatNominal(acc.totalCommittedAidIdr, detail.currencyUnit)}</strong>
                      <span className="mt-0.5 block text-xs text-stone-500">
                        Barang {formatNominal(acc.totalCommittedGoodsIdr, detail.currencyUnit)}
                      </span>
                    </div>
                    <div className="rounded-lg border border-stone-200 bg-white p-2.5">
                      <span className="text-xs text-stone-500 block">Selisih Kontribusi</span>
                      <strong className={shortfall > 0n ? "text-red-700 font-semibold" : "text-stone-900 font-semibold"}>
                        {formatNominal(acc.totalContributionShortfall, detail.currencyUnit)}
                      </strong>
                    </div>
                  </div>

                  {overCommitment > 0n && (
                    <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs leading-relaxed text-red-800">
                      Pengeluaran dan kewajiban kegiatan ini melampaui dana teralokasi sebesar{" "}
                      <strong>{formatNominal(acc.totalOverCommitmentIdr, detail.currencyUnit)}</strong>. Kelebihan ini
                      tetap terlihat dan menunggu telaah lembaga; tidak ditulis menjadi nol.
                    </p>
                  )}

                  {shortfall > 0n && (
                    <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs leading-relaxed text-red-800">
                      Alokasi kegiatan ini berdiri di atas nilai kontribusi yang masih tercatat setelah koreksi atau
                      pengembalian dana. Selisih ini tetap terlihat dan tidak ditulis menjadi nol.
                    </p>
                  )}

                  {/* Ketersediaan Dana Pengalihan Card */}
                  <div className={`rounded-xl p-3.5 border ${availability!.card}`}>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-wider">{availability!.title}</span>
                          {acc.availabilityStatus === "AVAILABLE" && (
                            <span className="text-sm font-extrabold text-emerald-700">
                              {formatNominal(acc.availableForReallocation, detail.currencyUnit)}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed opacity-90">{acc.availabilityReason}</p>
                      </div>

                      {acc.availabilityStatus === "AVAILABLE" && (
                        <Button
                          size="sm"
                          onClick={() => setShowReallocate(true)}
                          className="shrink-0"
                        >
                          <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
                          Alihkan Dana
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Satuan Bantuan Barang (Fisik) */}
              {acc && acc.unitSummaries.length > 0 && (
                <div className="rounded-xl border border-stone-200 bg-white p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-emerald-700" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-stone-800">
                      Rincian Bantuan Barang (Fisik)
                    </h4>
                  </div>
                  <p className="text-xs text-stone-500">
                    Jumlah bantuan fisik dihitung dalam satuannya masing-masing dan tidak dijumlahkan dengan nominal rupiah untuk mencegah penghitungan ganda.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="border-b border-stone-200 text-stone-500">
                          <th className="py-1.5 pr-3">Jenis Bantuan</th>
                          <th className="py-1.5 pr-3">Satuan</th>
                          <th className="py-1.5 pr-3">Disetujui</th>
                          <th className="py-1.5 pr-3">Terealisasi</th>
                          <th className="py-1.5">Sisa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {acc.unitSummaries.map((u, i) => (
                          <tr key={i} className="border-b border-stone-100 last:border-0">
                            <td className="py-1.5 pr-3 font-medium text-stone-900">{u.aidType}</td>
                            <td className="py-1.5 pr-3 text-stone-600">{u.unit}</td>
                            <td className="py-1.5 pr-3 text-stone-800">{u.approved}</td>
                            <td className="py-1.5 pr-3 text-emerald-700 font-medium">{u.realized}</td>
                            <td className="py-1.5 text-amber-700 font-medium">{u.remaining}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Riwayat Pengalihan */}
              {reallocs.length > 0 && (
                <div className="rounded-xl border border-stone-200 bg-white p-4 space-y-2.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-stone-800 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Riwayat Keputusan Pengalihan Alokasi
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="border-b border-stone-200 text-stone-500">
                          <th className="py-1.5 pr-3">Arah</th>
                          <th className="py-1.5 pr-3">Nominal</th>
                          <th className="py-1.5 pr-3">Jenis Dana</th>
                          <th className="py-1.5 pr-3">Alasan</th>
                          <th className="py-1.5 pr-3">Pejabat</th>
                          <th className="py-1.5">Waktu</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reallocs.map((r) => {
                          const isSource = r.sourceActivityId === activityId;
                          return (
                            <tr key={r.id} className="border-b border-stone-100 last:border-0">
                              <td className="py-1.5 pr-3 font-semibold">
                                {isSource ? (
                                  <span className="text-amber-700">Keluar ke {r.targetActivityId}</span>
                                ) : (
                                  <span className="text-emerald-700">Masuk dari {r.sourceActivityId}</span>
                                )}
                              </td>
                              <td className="py-1.5 pr-3 font-mono text-stone-900">
                                {formatNominal(r.amountExact, detail.currencyUnit)}
                              </td>
                              <td className="py-1.5 pr-3 text-stone-600">{r.fundType}</td>
                              <td className="py-1.5 pr-3 text-stone-700">{r.reason}</td>
                              <td className="py-1.5 pr-3 font-mono text-xs text-stone-500">
                                {r.decidedByOfficerId ?? r.decidedByAccount.slice(0, 10) + "…"}
                              </td>
                              <td className="py-1.5 text-stone-500">
                                {new Date(r.occurredAt).toLocaleDateString("id-ID")}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

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

              <ActivityTracePanel activityId={activityId} requests={requests} reloadKey={detail.version} />

              <ActivityAllocations detail={detail} />
            </>
          )}
        </div>

        <div className="border-t border-stone-200 px-6 py-3 bg-stone-50 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Tutup
          </Button>
        </div>
      </div>

      {showReallocate && detail && (
        <ReallocateModal
          requests={requests}
          sourceActivity={detail}
          onClose={() => setShowReallocate(false)}
          onReallocated={loadData}
        />
      )}
    </div>
  );
}


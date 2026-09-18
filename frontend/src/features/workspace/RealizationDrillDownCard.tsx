import type { PrivateRequests } from "./privateRequests";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Download, FileText, HandCoins, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { Button } from "../../components/ui/Button";
import {
  DISPUTE_STATUS_LABELS,
  downloadRealizationDocument,
  getProposalVersion,
  type DisputeStatus,
  type ProposalVersion,
} from "../disbursement/disbursementClient";
import type {
  ProvenanceActivityTrace,
  RealizationCurrentStatus,
  RealizationCurrentView,
} from "../../../../shared/realization-provenance";
import {
  fetchRealizationDrillDown,
  type RealizationDrillDown,
  type RealizationProvenance,
} from "./evidenceClient";
import { formatInstant, formatRupiah, roleLabel } from "./evidenceText";

type ProvenanceRealization = RealizationProvenance["realizations"][number];

const formatSeconds = (seconds: number) => formatInstant(new Date(seconds * 1000).toISOString());

const EVIDENCE_STATUS_LABELS: Record<string, string> = {
  EVIDENCE_PENDING: "bukti belum lengkap",
  EVIDENCE_COMPLETE: "bukti lengkap",
};
const CONFIRMATION_STATUS_LABELS: Record<string, string> = {
  UNCONFIRMED: "belum dikonfirmasi",
  CONFIRMED: "dikonfirmasi",
  DISPUTED: "penerimaan diperselisihkan",
};
const label = (labels: Record<string, string>, value: string | null) => (value ? labels[value] ?? value : "-");

/**
 * Drill-down from a frozen evidence package to the realizations it was built from
 * (Spec #86, ticket #98): proposal version, recipient, handover and documents.
 *
 * Everything shown comes from the provenance frozen with the package. Opening a
 * proposal version or a document reads that exact version or document id; the
 * live state of the proposal is never substituted for it.
 */
export function RealizationDrillDownCard({
  preparationId,
  requests,
}: {
  preparationId: string;
  requests: PrivateRequests;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<RealizationDrillDown | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchRealizationDrillDown(preparationId, requests));
    } catch (caught: any) {
      setError(caught?.message ?? "Gagal memuat penelusuran realisasi.");
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next && !data && !loading) void load();
  };

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-semibold text-stone-900">
            <Search className="h-4 w-4 text-[#0F3D30]" />
            Penelusuran Bukti & Rincian Realisasi
          </h4>
          <p className="mt-0.5 text-xs text-stone-500">
            Telusuri realisasi hingga ke versi pengajuan, penerima, serah terima, dan dokumen bukti.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={toggle}>
          {isOpen ? "Tutup Rincian" : "Buka Rincian Penelusuran"}
        </Button>
      </div>

      {isOpen && (
        <div className="mt-4 space-y-4 border-t border-stone-100 pt-4">
          {loading && <p className="text-xs text-stone-500">Memuat berkas penelusuran dari snapshot terenkripsi…</p>}
          {error && (
            <p role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">
              {error}
            </p>
          )}
          {data?.unreadable.map((entry) => (
            <p key={entry.role} role="alert" className="flex items-start gap-1.5 rounded bg-amber-50 p-2 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                Penelusuran sisi {roleLabel(entry.role)} {entry.status === "FAILED" ? "gagal dibaca" : "belum tersedia"}:{" "}
                {entry.reason} Rincian sisi ini tidak ditampilkan sebagai kosong.
              </span>
            </p>
          ))}
          {data && !data.available && (
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
              <p className="font-semibold text-stone-800">Penelusuran rincian tidak tersedia</p>
              <p className="mt-1">{data.reason}</p>
            </div>
          )}
          {data?.available && <CurrentStatusNotice current={data.current} />}
          {data?.available &&
            data.provenances.map((provenance) => (
              <ProvenanceView key={provenance.role} provenance={provenance} current={data.current} requests={requests} />
            ))}
        </div>
      )}
    </section>
  );
}

/** Says when the live status column was read, and that it does not touch the snapshot. */
function CurrentStatusNotice({ current }: { current: RealizationCurrentView }) {
  if (!current.available) {
    return (
      <p role="alert" className="flex items-start gap-1.5 rounded bg-amber-50 p-2 text-xs text-amber-900">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {current.reason}
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5 rounded border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900">
      <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      Kolom "Status terkini" dibaca dari data kerja pada {formatSeconds(current.observedAt)}. Status itu ditampilkan
      berdampingan dan tidak mengubah rincian yang dibekukan.
    </p>
  );
}

function ProvenanceView({
  provenance,
  current,
  requests,
}: {
  provenance: RealizationProvenance;
  current: RealizationCurrentView;
  requests: PrivateRequests;
}) {
  const { totals } = provenance;
  const live = new Map(
    current.available ? current.realizations.map((status) => [status.realizationId, status] as const) : []
  );
  const activityNames = new Map(
    provenance.activityTrace.available ? provenance.activityTrace.activities.map((a) => [a.activityId, a.name] as const) : []
  );
  return (
    <div className="space-y-3">
      <div className="text-xs text-stone-600">
        <p className="font-semibold text-stone-800">Sisi {roleLabel(provenance.role)}</p>
        <p>
          Cut-off {formatInstant(provenance.cutOff)} · dibekukan {formatSeconds(provenance.frozenAt)}. Status bukti,
          konfirmasi dan penerimaan diperselisihkan adalah status saat dibekukan; perubahan sesudahnya tidak mengubah
          rincian ini.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Figure label="Total bantuan uang" value={`Rp ${formatRupiah(totals.totalRealizedIdr)}`} mono />
        <Figure label="Penerima" value={`${totals.beneficiaryCount} penerima`} mono />
        <Figure label="Kejadian penyerahan" value={`${totals.handoverEventCount} kejadian`} mono />
        <Figure
          label="Bantuan barang"
          value={totals.goods.length === 0 ? "Tidak ada barang" : totals.goods.map((g) => `${g.totalQuantity} ${g.unit}`).join(", ")}
        />
      </div>

      {provenance.excludedAfterCutOff.length > 0 && (
        <p className="flex items-start gap-1.5 rounded bg-amber-50 p-2 text-xs text-amber-900">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {provenance.excludedAfterCutOff.length} realisasi dalam periode ini dicatat setelah cut-off dan belum terperiksa
          pada snapshot ini, bukan tidak ada.
        </p>
      )}

      <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-xs text-emerald-950">
        <p className="flex items-center gap-1.5 font-semibold">
          <ShieldCheck className="h-4 w-4 text-emerald-700" aria-hidden />
          Uang muka dan beban dipisahkan dari penyaluran (AC07)
        </p>
        <p className="mt-1 text-emerald-800">
          Uang muka petugas (Rp {formatRupiah(totals.advancesIdr)}) dan beban pengadaan (Rp {formatRupiah(totals.expensesIdr)})
          tidak dijumlahkan ke bantuan yang diterima penerima.
        </p>
        {provenance.advances.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-emerald-900">
            {provenance.advances.map((advance) => (
              <li key={advance.id}>
                Uang muka {advance.reference}: Rp {formatRupiah(advance.amountIdr)} · dipertanggungjawabkan Rp{" "}
                {formatRupiah(advance.accountedIdr)} ·{" "}
                {advance.unaccountedIdr.startsWith("-")
                  ? `beban melebihi uang muka Rp ${formatRupiah(advance.unaccountedIdr.slice(1))}`
                  : `belum dipertanggungjawabkan Rp ${formatRupiah(advance.unaccountedIdr)}`}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-[11px] italic text-stone-500">
          Pembayaran dan penyerahan barang dicatat oleh lembaga; bukan mutasi bank independen atau transaksi onchain.
        </p>
      </div>

      <ActivityTraceView trace={provenance.activityTrace} />

      <div className="overflow-x-auto rounded-lg border border-stone-200">
        <table className="min-w-full divide-y divide-stone-200 text-left text-xs">
          <thead className="bg-stone-50 text-stone-600">
            <tr>
              <th className="px-3 py-2 font-medium">Realisasi & Pengajuan</th>
              <th className="px-3 py-2 font-medium">Penerima</th>
              <th className="px-3 py-2 font-medium">Nilai / Kuantitas</th>
              <th className="px-3 py-2 font-medium">Metode & Konfirmasi</th>
              <th className="px-3 py-2 font-medium">Dokumen Bukti</th>
              {current.available && <th className="px-3 py-2 font-medium">Status terkini</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 bg-white">
            {provenance.realizations.map((item) => (
              <RealizationRow
                key={item.realizationId}
                item={item}
                activityName={activityNames.get(item.activityId ?? "") ?? null}
                live={current.available ? live.get(item.realizationId) ?? null : undefined}
                requests={requests}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Figure({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50/60 p-2.5">
      <span className="text-stone-500">{label}</span>
      <p className={`mt-1 font-semibold text-stone-900 ${mono ? "font-mono text-sm" : "text-xs"}`}>{value}</p>
    </div>
  );
}

function RealizationRow({
  item,
  activityName,
  live,
  requests,
}: {
  item: ProvenanceRealization;
  activityName: string | null;
  /** `undefined` when no live status column is shown at all. */
  live: RealizationCurrentStatus | null | undefined;
  requests: PrivateRequests;
}) {
  const [version, setVersion] = useState<ProposalVersion | null>(null);
  const [versionOpen, setVersionOpen] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const toggleVersion = async () => {
    const next = !versionOpen;
    setVersionOpen(next);
    if (!next || version) return;
    setRowError(null);
    try {
      setVersion(await getProposalVersion(requests, item.proposalId, item.proposalVersion));
    } catch (caught: any) {
      setRowError(caught?.message ?? `Versi pengajuan v${item.proposalVersion} tidak dapat dibuka.`);
    }
  };

  const download = async (doc: ProvenanceRealization["documents"][number]) => {
    setDownloading(doc.id);
    setRowError(null);
    try {
      const url = URL.createObjectURL(await downloadRealizationDocument(requests, item.proposalId, doc.id));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = doc.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught: any) {
      setRowError(caught?.message ?? `Dokumen ${doc.fileName} tidak dapat diunduh.`);
    } finally {
      setDownloading(null);
    }
  };

  const versionBeneficiary = version?.data.beneficiaries.find((b) => b.id === item.beneficiary.id);

  return (
    <tr className="hover:bg-stone-50/50">
      <td className="px-3 py-2 align-top">
        <span className="font-mono font-medium text-stone-900">{item.realizationId}</span>
        <div className="mt-0.5 text-[11px] text-stone-500">
          Pengajuan {item.proposalId}{" "}
          <button type="button" className="font-medium text-[#0F3D30] underline" onClick={() => void toggleVersion()}>
            v{item.proposalVersion}
          </button>
        </div>
        <div className="mt-0.5 text-[11px] text-stone-500">
          {activityName ? `Kegiatan: ${activityName}` : "Belum terhubung ke kegiatan penyaluran"}
        </div>
        {item.purpose && (
          <div className="mt-0.5 max-w-xs truncate text-[11px] text-stone-600" title={item.purpose}>
            {item.purpose}
          </div>
        )}
        {versionOpen && version && (
          <div className="mt-1 max-w-xs rounded border border-stone-200 bg-stone-50 p-1.5 text-[11px] text-stone-700">
            <p>Versi {version.version}: {version.data.purpose}</p>
            <p>
              {version.data.aidPeriod
                ? `Periode ${version.data.aidPeriod.start} s.d. ${version.data.aidPeriod.end} · `
                : ""}
              {version.data.beneficiaries.length} penerima
            </p>
            <p>
              Penerima pada versi ini: {versionBeneficiary ? `${versionBeneficiary.name} (${versionBeneficiary.asnaf})` : "tidak tercantum"}
            </p>
          </div>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <div className="font-medium text-stone-900">{item.beneficiary.name}</div>
        <div className="font-mono text-[11px] text-stone-500">{item.beneficiary.nikMasked ?? item.beneficiary.id}</div>
        {item.beneficiary.asnaf && (
          <span className="mt-0.5 inline-block rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600">
            {item.beneficiary.asnaf}
          </span>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        {item.amountIdr != null ? (
          <span className="font-mono font-semibold text-stone-900">Rp {formatRupiah(item.amountIdr)}</span>
        ) : item.quantity != null ? (
          <span className="font-mono font-semibold text-emerald-900">
            {item.quantity} {item.unit}
          </span>
        ) : (
          <span className="text-stone-400">-</span>
        )}
        {item.aidLineValuation && (
          <div className="mt-0.5 max-w-xs text-[11px] text-stone-500">
            {item.aidLineValuation.valuedAmountIdr !== null
              ? `Estimasi rincian bantuan: Rp ${formatRupiah(item.aidLineValuation.valuedAmountIdr)} (dasar: ${item.aidLineValuation.valuationBasis}); tidak dijumlahkan ke realisasi rupiah.`
              : "Rincian bantuan tanpa dasar valuasi rupiah."}
          </div>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-700">{item.method}</span>
        <div className="mt-1 text-[11px]">
          {item.confirmationStatus === "CONFIRMED" ? (
            <span className="flex items-center gap-1 font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              Dikonfirmasi ({item.confirmationMethod})
            </span>
          ) : (
            <span className="flex items-center gap-1 font-medium text-amber-700">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              Belum dikonfirmasi
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 align-top">
        {item.documents.length === 0 ? (
          <span className="text-[11px] text-stone-400">Tidak ada dokumen</span>
        ) : (
          <ul className="space-y-0.5">
            {item.documents.map((doc) => (
              <li key={doc.id} className="flex max-w-xs items-center gap-1 text-[11px] text-stone-700">
                <FileText className="h-3.5 w-3.5 shrink-0 text-stone-500" aria-hidden />
                <span className="truncate" title={`${doc.fileName} · SHA-256 ${doc.contentSha256}`}>
                  {doc.documentType}: {doc.fileName}
                </span>
                <button
                  type="button"
                  aria-label={`Unduh ${doc.fileName}`}
                  disabled={downloading === doc.id}
                  onClick={() => void download(doc)}
                  className="shrink-0 text-[#0F3D30] disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {item.disputes.length > 0 && (
          <div className="mt-1 flex items-start gap-1 rounded bg-red-50 p-1 text-[10px] text-red-800">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span>Penerimaan diperselisihkan: {item.disputes.map((d) => `${d.subject} (${d.status})`).join(", ")}</span>
          </div>
        )}
        {rowError && (
          <p role="alert" className="mt-1 text-[11px] text-red-700">
            {rowError}
          </p>
        )}
      </td>
      {live !== undefined && (
        <td className="px-3 py-2 align-top">
          <LiveStatus item={item} live={live} />
        </td>
      )}
    </tr>
  );
}

function LiveStatus({ item, live }: { item: ProvenanceRealization; live: RealizationCurrentStatus | null }) {
  if (!live || !live.found) {
    return <span className="text-[11px] text-amber-800">Realisasi tidak ditemukan lagi pada data kerja.</span>;
  }
  const changed =
    live.evidenceStatus !== item.evidenceStatus ||
    live.confirmationStatus !== item.confirmationStatus ||
    live.documentCount !== item.documents.length ||
    live.disputes.length !== item.disputes.length;
  return (
    <div className="space-y-0.5 text-[11px] text-stone-700">
      {changed ? (
        <span className="inline-block rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-900">Berubah sejak dibekukan</span>
      ) : (
        <span className="inline-block rounded bg-stone-100 px-1.5 py-0.5 text-stone-600">Sama dengan snapshot</span>
      )}
      <p>
        {label(EVIDENCE_STATUS_LABELS, live.evidenceStatus)} · {label(CONFIRMATION_STATUS_LABELS, live.confirmationStatus)}
      </p>
      <p>{live.documentCount} dokumen</p>
      {live.disputes.length > 0 && (
        <p>
          Penerimaan diperselisihkan:{" "}
          {live.disputes
            .map((d) => `${d.subject} (${DISPUTE_STATUS_LABELS[d.status as DisputeStatus] ?? d.status})`)
            .join(", ")}
        </p>
      )}
    </div>
  );
}

/**
 * The activities and contribution allocations frozen with the source. Allocations
 * are pooled funding commitments; nothing here pairs a donor with a recipient.
 */
function ActivityTraceView({ trace }: { trace: ProvenanceActivityTrace }) {
  if (!trace.available) {
    return (
      <p className="flex items-start gap-1.5 rounded bg-amber-50 p-2 text-xs text-amber-900">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Penelusuran kegiatan dan kontribusi tidak dibekukan: {trace.reason}
      </p>
    );
  }
  return (
    <section aria-label="Kegiatan penyaluran dan alokasi kontribusi" className="space-y-2 rounded-lg border border-stone-200 p-3 text-xs text-stone-700">
      <p className="flex items-center gap-1.5 font-semibold text-stone-800">
        <HandCoins className="h-4 w-4 text-[#0F3D30]" aria-hidden />
        Kegiatan penyaluran & alokasi kontribusi hingga cut-off
      </p>
      {trace.activities.length === 0 ? (
        <p>Tidak ada realisasi yang terhubung ke kegiatan penyaluran pada cut-off.</p>
      ) : (
        <ul className="space-y-1.5">
          {trace.activities.map((activity) => (
            <li key={activity.activityId} className="rounded bg-stone-50 p-2">
              <p className="font-medium text-stone-900">
                {activity.name} · pengajuan v{activity.proposalVersion}
              </p>
              <p>
                Teralokasi {Object.entries(activity.allocatedByUnit).map(([unit, amount]) =>
                  unit === "IDR" ? `Rp ${formatRupiah(amount)}` : `${amount} ${unit}`
                ).join(", ") || "belum ada"} dari target Rp {formatRupiah(activity.targetAmount)}
                {activity.targetIsPartial ? " (target belum mencakup barang tanpa valuasi)" : ""} ·{" "}
                {activity.allocations.length} alokasi · {activity.realizationIds.length} realisasi
              </p>
            </li>
          ))}
        </ul>
      )}
      {trace.realizationsWithoutActivity.length > 0 && (
        <p>{trace.realizationsWithoutActivity.length} realisasi belum terhubung ke kegiatan penyaluran pada cut-off.</p>
      )}
      {trace.contributionsWithoutDonor > 0 && (
        <p>{trace.contributionsWithoutDonor} kontribusi teralokasi tidak memuat detail donatur; sumber donor tidak lengkap.</p>
      )}
      <p className="text-[11px] italic text-stone-500">
        {trace.coverage} {trace.disclaimer}
      </p>
    </section>
  );
}

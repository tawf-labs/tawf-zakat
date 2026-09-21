import type { ReactNode } from "react";
import { formatNominal } from "../contributions/contributionClient";
import type { CurrencyUnit } from "../contributions/contributionClient";
import {
  HEADLINE_LABELS,
  OPEN_ITEM_LABELS,
  type ActivityTrack,
  type Track,
} from "./traceClient";
import { CertificateTraceLines } from "./CertificateTraceLines";

/** A track that could not be read says so; it is never drawn as an empty or zero figure. */
function TrackState<T>({ title, track, children }: { title: string; track: Track<T>; children: (data: T) => ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-stone-200 bg-white p-4 space-y-2">
      <h6 className="text-[11px] font-bold uppercase tracking-wider text-stone-600">{title}</h6>
      {track.status === "OK" ? (
        children(track.data)
      ) : (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <strong>Belum dapat dibaca.</strong> {track.reason}
        </p>
      )}
    </section>
  );
}

const Row = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex items-start justify-between gap-3 text-xs">
    <dt className="text-stone-500">{label}</dt>
    <dd className="text-right font-semibold text-stone-900">{value}</dd>
  </div>
);

/**
 * The tracks of one activity, shared by the donor page and the amil recap so both read the same
 * figures. Delivery, funds, confirmation/dispute and the NFT stay in separate sections.
 */
export function ActivityTrackView({ track }: { track: ActivityTrack }) {
  const unit = track.identity.currencyUnit as CurrencyUnit;
  return (
    <div className="space-y-3">
      <TrackState title="Ringkasan penyaluran" track={track.summary}>
        {(s) => (
          <div className="space-y-2">
            <p className="text-sm font-bold text-stone-900" aria-live="polite">{HEADLINE_LABELS[s.headline]}</p>
            {s.openItems.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-amber-900 space-y-0.5">
                {s.openItems.map((item) => (
                  <li key={item}>{OPEN_ITEM_LABELS[item]}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </TrackState>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TrackState title="Progres penyaluran" track={track.distribution}>
          {(d) => (
            <dl className="space-y-1.5">
              <Row label="Penyerahan tercatat" value={d.recordedRealizations} />
              <Row label="Sisa komitmen bantuan" value={formatNominal(d.committedAidIdr, "IDR")} />
              {d.unitSummaries.map((u) => (
                <Row key={`${u.aidType}-${u.unit}`} label={`${u.aidType} (${u.unit})`} value={`${u.realized} dari ${u.approved}, sisa ${u.remaining}`} />
              ))}
              {d.isRemainderClosed && <p className="text-[11px] text-stone-500">Sisa pengajuan telah ditutup lembaga.</p>}
              {d.hasUnvaluedGoods && <p className="text-[11px] text-amber-800">Barang tanpa nilai rupiah tidak dijumlahkan ke rupiah.</p>}
            </dl>
          )}
        </TrackState>

        <TrackState title="Dana dan pertanggungjawaban" track={track.funds}>
          {(f) => (
            <dl className="space-y-1.5">
              <Row label="Dana teralokasi (gabungan)" value={formatNominal(f.totalAllocatedAmount, unit)} />
              <Row label="Realisasi uang" value={formatNominal(f.totalRealizedMoneyIdr, "IDR")} />
              <Row label="Biaya tercatat" value={formatNominal(f.totalExpensesIdr, "IDR")} />
              <Row label="Uang muka belum dipertanggungjawabkan" value={formatNominal(f.unaccountedAdvancesIdr, "IDR")} />
              <p className="text-[11px] text-stone-500">{f.availabilityReason}</p>
            </dl>
          )}
        </TrackState>

        <TrackState title="Konfirmasi dan sengketa" track={track.confirmation}>
          {(c) => (
            <dl className="space-y-1.5">
              <Row label="Dikonfirmasi" value={c.confirmed} />
              <Row label="Belum dikonfirmasi" value={c.unconfirmed} />
              <Row label="Disengketakan" value={c.disputed} />
            </dl>
          )}
        </TrackState>

        <TrackState title="NFT distribusi" track={track.certificates}>
          {(c) => <CertificateTraceLines lines={c.lines} />}
        </TrackState>
      </div>

      <p className="text-[11px] text-stone-500">
        Dibaca pada {new Date(track.identity.observedAt * 1000).toLocaleString("id-ID")} · pengajuan {track.identity.proposalId} versi{" "}
        {track.identity.proposalVersion} · kegiatan versi {track.identity.activityVersion}
      </p>
    </div>
  );
}

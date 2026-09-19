import { ChevronDown } from "lucide-react";
import {
  JENIS_DANA_LIST,
  SOURCE_CHANNELS,
  STATUS_MEANINGS,
  formatNominal,
  type ContributionStatus,
} from "../contributions/contributionClient";
import type { DonorContribution } from "./donorClient";

const STATUS_LABELS: Record<ContributionStatus, string> = {
  RECEIVED: "Diterima Lembaga",
  RECONCILED: "Dicocokkan dengan Bukti Lembaga",
  ENDORSED: "Disahkan Lembaga",
  REJECTED: "Ditolak",
};

const PROOF_STATUS_TEXT: Record<DonorContribution["zkProof"]["status"], string> = {
  NOT_AVAILABLE:
    "Belum tersedia. Bukti keanggotaan kriptografis baru diterbitkan setelah batch kontribusi disahkan lembaga dan dibuktikan; sampai saat itu tidak ada bukti yang ditampilkan.",
};

const labelOf = <T extends string>(list: { value: T; label: string }[], value: T) =>
  list.find((item) => item.value === value)?.label ?? value;

const formatDate = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

export function DonorContributionSummary({ contribution }: { contribution: DonorContribution }) {
  const rejected = contribution.status === "REJECTED";
  const fields: [string, string, string?][] = [
    ["Nama Donatur", contribution.donorName || "Tidak dicantumkan"],
    ["Jenis Dana", labelOf(JENIS_DANA_LIST, contribution.fundType), contribution.purpose || undefined],
    ["Referensi", contribution.sourceReference, labelOf(SOURCE_CHANNELS, contribution.sourceChannel)],
    ["Diterima", formatDate(contribution.receivedAt)],
  ];

  return (
    <section aria-labelledby="donor-contribution-heading" className="rounded-3xl border border-tawf-green-10 bg-white p-6 sm:p-8 shadow-sm space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-tawf-green-10 pb-6">
        <div>
          <h3 id="donor-contribution-heading" className="text-xs font-semibold text-tawf-muted uppercase tracking-wider">
            Kontribusi Anda
          </h3>
          <p className="font-serif text-2xl font-bold text-tawf-green mt-1">
            {formatNominal(contribution.amountExact, contribution.currencyUnit)}
          </p>
        </div>
        <div
          className={`px-3.5 py-1.5 rounded-full border text-xs font-semibold self-start sm:self-auto ${
            rejected ? "border-red-200 bg-red-50 text-red-800" : "border-[#1b765e]/20 bg-[#1b765e]/10 text-tawf-green-light"
          }`}
        >
          {STATUS_LABELS[contribution.status]}
        </div>
      </div>
      <p className="text-xs text-tawf-muted">{STATUS_MEANINGS[contribution.status]}</p>

      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {fields.map(([label, value, detail]) => (
          <div key={label} className="p-4 rounded-2xl bg-[#f4f8f3]/60 border border-tawf-green-10">
            <dt className="text-[11px] font-semibold text-tawf-muted uppercase tracking-wider">{label}</dt>
            <dd className="text-sm font-bold text-tawf-green mt-0.5 break-words">{value}</dd>
            {detail && <dd className="text-xs text-tawf-muted line-clamp-2">{detail}</dd>}
          </div>
        ))}
      </dl>

      <section aria-label="Riwayat koreksi kontribusi" className="space-y-3">
        <h4 className="text-sm font-semibold text-tawf-green">Riwayat Kontribusi · Versi {contribution.version}</h4>
        {contribution.corrections.length === 0 && <p className="text-xs text-tawf-muted">Belum ada koreksi.</p>}
        {contribution.corrections.map(correction => (
          <div key={correction.toVersion} className="rounded-xl border border-tawf-green-10 p-3 text-sm space-y-1">
            <p>Versi {correction.fromVersion} → {correction.toVersion} · {formatDate(correction.createdAt)}</p>
            <p>{formatNominal(correction.fromAmountExact, contribution.currencyUnit)} → {formatNominal(correction.toAmountExact, contribution.currencyUnit)}</p>
            {correction.correctionType === "DUPLICATE" && <p>Catatan ganda dikeluarkan dari pendanaan; nominal historis tetap tersimpan.</p>}
            <p>Alasan: {correction.reason}</p>
          </div>
        ))}
      </section>

      <details className="group rounded-2xl border border-tawf-green-10 bg-[#f4f8f3]/60">
        <summary className="cursor-pointer list-none p-4 flex items-center justify-between text-xs font-semibold text-tawf-green">
          Rincian teknis pembuktian
          <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <p className="px-4 pb-4 text-xs text-tawf-muted leading-relaxed">
          Status bukti kriptografis: {PROOF_STATUS_TEXT[contribution.zkProof.status]}
        </p>
      </details>
    </section>
  );
}

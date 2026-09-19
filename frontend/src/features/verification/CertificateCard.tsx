import { Printer, Lock } from "lucide-react";
import type { PublicContribution } from "./contributionApi";
import { STATUS_BADGES } from "./contributionStatus";

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "Belum tercatat";

export function CertificateCard({ contribution }: { contribution: PublicContribution }) {
  const badge = STATUS_BADGES[contribution.status] ?? STATUS_BADGES.PENDING;
  const isSettled = contribution.status !== "PENDING" && contribution.status !== "REJECTED";

  return (
    <div className="relative overflow-hidden rounded-3xl border-2 border-[#c4ed70] bg-white p-8 sm:p-12 shadow-xl print:border-none print:shadow-none space-y-8">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b-2 border-[#1b765e]/20 pb-6 text-center sm:text-left">
        <div>
          <span className="text-[10px] tracking-[0.2em] uppercase text-[#1b765e] font-bold">Tawf Zakat</span>
          <h2 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[#17332c]">Catatan Kontribusi</h2>
        </div>
        <div className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full border ${badge.tone}`}>
          <badge.Icon className="w-4 h-4" />
          <span className="text-xs font-bold">{badge.label}</span>
        </div>
      </div>

      <div className="space-y-6 text-center sm:text-left">
        <p className="text-sm text-[#17332c] leading-relaxed">{badge.explanation}</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-5 rounded-2xl bg-[#f4f8f3] border border-[#dbe7dd] text-xs">
          <Field label="Referensi" value={contribution.trxId} mono />
          <Field label="Tanggal dicatat" value={formatDate(contribution.recordedAt)} />
          <Field label="Tanggal pembayaran" value={formatDate(contribution.paidAt)} />
        </div>

        <div className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-200/70 text-xs text-amber-900 space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <Lock className="w-4 h-4 text-amber-700 shrink-0" />
            <span>Data yang tidak ditampilkan</span>
          </p>
          <p className="text-[11px] text-amber-800/90 leading-relaxed">
            Nama donatur, nominal, kontak dan dokumen tidak dibuka pada pencarian publik. Halaman ini juga tidak
            menyatakan siapa pemilik kontribusi; pemilik dapat mencocokkan kuitansinya sendiri di bawah.
          </p>
        </div>

        {isSettled && (
          <p className="text-xs text-[#5e7a70] leading-relaxed italic max-w-2xl">
            &quot;Semoga Allah SWT melimpahkan pahala atas apa yang telah ditunaikan dan menjadikannya pembersih harta.&quot;
          </p>
        )}
      </div>

      <div className="flex justify-end pt-6 border-t border-[#dbe7dd]/60 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#17332c] hover:bg-[#1b765e] text-white text-xs font-bold uppercase tracking-wider transition-all shadow-xs cursor-pointer"
        >
          <Printer className="w-3.5 h-3.5" />
          <span>Cetak Catatan</span>
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-[#5e7a70] text-[11px] uppercase font-semibold">{label}</span>
      <p className={`font-bold text-[#17332c] text-sm mt-0.5 break-all ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import { CheckCircle2, Clock, Link2, Printer, RotateCcw, XCircle } from "lucide-react";
import type { CampaignReceipt } from "./campaignReceiptApi";

const STATUS = {
  CONFIRMED: {
    Icon: CheckCircle2,
    tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    label: "Donasi Terkonfirmasi",
    explanation: "Pembayaran donasi ini telah dikonfirmasi oleh penyedia pembayaran dan tercatat untuk kampanye di bawah.",
  },
  PARTIALLY_REFUNDED: {
    Icon: RotateCcw,
    tone: "border-amber-200 bg-amber-50 text-amber-900",
    label: "Dikembalikan Sebagian",
    explanation: "Donasi ini telah dikonfirmasi, lalu sebagian nominalnya dikembalikan kepada donatur.",
  },
  REFUNDED: {
    Icon: RotateCcw,
    tone: "border-amber-200 bg-amber-50 text-amber-900",
    label: "Donasi Dikembalikan",
    explanation: "Donasi ini telah dikembalikan seluruhnya kepada donatur dan tidak lagi dihitung pada kampanye.",
  },
  PENDING: {
    Icon: Clock,
    tone: "border-slate-200 bg-slate-50 text-slate-700",
    label: "Menunggu Pembayaran",
    explanation: "Pembayaran untuk kode ini belum dikonfirmasi. Selesaikan pembayaran Anda, lalu periksa kembali.",
  },
  FAILED: {
    Icon: XCircle,
    tone: "border-rose-200 bg-rose-50 text-rose-800",
    label: "Pembayaran Tidak Berhasil",
    explanation: "Pembayaran untuk kode ini tidak berhasil atau dibatalkan, sehingga tidak ada donasi yang tercatat.",
  },
} as const;

const money = (amount: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount);
const date = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "Belum tercatat";

export function CampaignReceiptCard({ receipt }: { receipt: CampaignReceipt }) {
  const status = STATUS[receipt.status];
  const paid = receipt.amount !== undefined;
  const organizer = receipt.campaign.organizer.organizationName || receipt.campaign.organizer.name;

  return (
    <div className="relative overflow-hidden rounded-3xl border-2 border-[#c4ed70] bg-white p-8 sm:p-12 shadow-xl print:border-none print:shadow-none space-y-8">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b-2 border-[#1b765e]/20 pb-6 text-center sm:text-left">
        <div>
          <span className="text-[10px] tracking-[0.2em] uppercase text-[#1b765e] font-bold">Kampanye Infak</span>
          <h2 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[#17332c]">Bukti Donasi Kampanye</h2>
        </div>
        <div className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full border ${status.tone}`}>
          <status.Icon className="w-4 h-4" />
          <span className="text-xs font-bold">{status.label}</span>
        </div>
      </div>

      <div className="space-y-6 text-center sm:text-left">
        <p className="text-sm text-[#17332c] leading-relaxed">{status.explanation}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5 rounded-2xl bg-[#f4f8f3] border border-[#dbe7dd] text-xs">
          <Field label="Kode bukti donasi" value={receipt.reference} mono />
          {paid && <Field label="Nominal donasi" value={money(receipt.amount!)} />}
          {paid && <Field label="Tanggal pembayaran" value={date(receipt.paidAt)} />}
          {Boolean(receipt.refundedAmount) && <Field label="Dikembalikan" value={money(receipt.refundedAmount!)} />}
          <div className="sm:col-span-2">
            <span className="text-[#5e7a70] text-[11px] uppercase font-semibold">Kampanye tujuan</span>
            <p className="font-bold text-[#17332c] text-sm mt-0.5">
              <Link
                to="/kampanye/$campaignId"
                params={{ campaignId: receipt.campaign.id }}
                className="underline decoration-[#1b765e]/40 underline-offset-4 hover:text-[#1b765e]"
              >
                {receipt.campaign.title}
              </Link>
            </p>
            <p className="text-[#5e7a70] text-xs mt-0.5">oleh {organizer}</p>
          </div>
        </div>

        {receipt.chain && (
          <div className="p-5 rounded-2xl border border-[#dbe7dd] bg-white text-xs space-y-3 text-left">
            <p className="font-bold text-[#17332c] flex items-center gap-2">
              <Link2 className="w-4 h-4 text-[#1b765e] shrink-0" />
              <span>Tercatat di blockchain</span>
            </p>
            <p className="text-[#5e7a70] leading-relaxed">
              Catatan donasi ini telah dikunci pada registry kampanye, sehingga tidak dapat diubah diam-diam.
            </p>
            <Field label="Hash transaksi" value={receipt.chain.transactionHash} mono />
            <Field label="Sidik data catatan" value={receipt.chain.payloadHash} mono />
            <p className="text-[11px] text-[#5e7a70] leading-relaxed">
              Pencatatan membuktikan jejak data donasi, bukan bahwa bantuan telah diterima penerima manfaat.
            </p>
          </div>
        )}

        <p className="text-[11px] text-[#5e7a70] leading-relaxed">
          Nama donatur dan doa tidak ditampilkan pada pemeriksaan ini. Siapa pun yang memegang kode bukti dapat
          melihat halaman ini.
        </p>
      </div>

      <div className="flex justify-end pt-6 border-t border-[#dbe7dd]/60 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#17332c] hover:bg-[#1b765e] text-white text-xs font-bold uppercase tracking-wider transition-all shadow-xs cursor-pointer"
        >
          <Printer className="w-3.5 h-3.5" />
          <span>Cetak Bukti</span>
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

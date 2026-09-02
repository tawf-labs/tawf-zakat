import React from "react";
import { ShieldCheck, Award, Printer, Download, CheckCircle2, QrCode } from "lucide-react";

interface CertificateCardProps {
  receipt: {
    trxId: string;
    donorName: string;
    isAnonymous: boolean;
    amountIDR: number;
    zakatType?: string;
    paidAt?: string;
    batchId?: number;
    salt?: string;
  };
}

export function CertificateCard({ receipt }: CertificateCardProps) {
  const formattedDate = receipt.paidAt
    ? new Date(receipt.paidAt).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : new Date().toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-4">
      {/* Certificate Container */}
      <div className="relative overflow-hidden rounded-3xl border-2 border-[#c4ed70] bg-white p-8 sm:p-12 shadow-xl print:border-none print:shadow-none space-y-8">
        {/* Subtle background Islamic watermark */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(196,237,112,0.12),transparent_70%)] pointer-events-none" />

        {/* Certificate Header */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b-2 border-[#1b765e]/20 pb-6 text-center sm:text-left">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#1b765e] text-[#c4ed70] flex items-center justify-center font-serif text-2xl font-bold">
              Z
            </div>
            <div>
              <span className="text-[10px] tracking-[0.2em] uppercase text-[#1b765e] font-bold">
                Tawf Zakat Protocol
              </span>
              <h2 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[#17332c]">
                Sertifikat Penunaian Zakat
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-[#f4f8f3] px-3.5 py-1.5 rounded-full border border-[#dbe7dd]">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-bold text-emerald-800">
              Terverifikasi Sah & Permanen
            </span>
          </div>
        </div>

        {/* Certificate Body */}
        <div className="space-y-6 text-center sm:text-left">
          <p className="text-xs text-[#5e7a70] uppercase tracking-widest">
            Diberikan sebagai bukti sah penunaian zakat atas nama:
          </p>

          <div className="py-2">
            <h3 className="font-serif text-3xl sm:text-4xl font-bold text-[#17332c] tracking-tight">
              {receipt.isAnonymous ? "Hamba Allah (Anonim)" : receipt.donorName || "Muzakki"}
            </h3>
            <p className="text-xs text-[#5e7a70] mt-1 font-mono">
              ID Transaksi: <strong>{receipt.trxId}</strong>
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-5 rounded-2xl bg-[#f4f8f3] border border-[#dbe7dd] text-xs">
            <div>
              <span className="text-[#5e7a70] text-[11px] uppercase font-semibold">Jenis Ibadah</span>
              <p className="font-bold text-[#17332c] text-sm mt-0.5">
                {receipt.zakatType || "Zakat Maal & Harta"}
              </p>
            </div>
            <div>
              <span className="text-[#5e7a70] text-[11px] uppercase font-semibold">Nominal Zakat</span>
              <p className="font-serif font-bold text-[#1b765e] text-lg mt-0.5">
                Rp {Number(receipt.amountIDR).toLocaleString("id-ID")}
              </p>
            </div>
            <div>
              <span className="text-[#5e7a70] text-[11px] uppercase font-semibold">Tanggal Akad</span>
              <p className="font-bold text-[#17332c] text-sm mt-0.5">{formattedDate}</p>
            </div>
          </div>

          <p className="text-xs text-[#5e7a70] leading-relaxed italic max-w-2xl">
            &quot;Semoga Allah SWT melimpahkan pahala atas apa yang telah Anda tunaikan, memberikan keberkahan atas harta yang tersisa, dan menjadikannya pembersih lahir batin bagi Anda sekeluarga.&quot;
          </p>
        </div>

        {/* Certificate Footer / Stempel */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 pt-6 border-t border-[#dbe7dd]/60 text-xs">
          <div className="space-y-1 text-center sm:text-left">
            <span className="text-[10px] text-[#5e7a70] uppercase tracking-wider font-semibold">
              Kepatuhan Standar
            </span>
            <p className="font-semibold text-[#17332c]">
              Fikih 8 Asnaf BAZNAS & PSAK 109
            </p>
            <p className="text-[11px] text-[#5e7a70]">
              Diawasi oleh Dewan Pengawas Syariah & Auditor Independen
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0 print:hidden">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#17332c] hover:bg-[#1b765e] text-white text-xs font-bold uppercase tracking-wider transition-all shadow-xs cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Cetak Sertifikat</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

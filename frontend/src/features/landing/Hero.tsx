import React from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ShieldCheck, Eye, HeartHandshake, Sparkles, CheckCircle2 } from "lucide-react";
import { Container } from "../../components/layout/Container";
import { Badge } from "../../components/ui/Badge";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-[#f4f8f3] via-white to-white pt-12 pb-20 sm:pt-16 sm:pb-28">
      {/* Subtle background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-96 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(196,237,112,0.25),transparent)] -z-10" />

      <Container>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          {/* Left Column: Copy & CTAs */}
          <div className="lg:col-span-7 space-y-6 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#1b765e]/20 bg-[#1b765e]/5 px-3.5 py-1.5 text-xs font-semibold text-[#1b765e]">
              <Sparkles className="w-3.5 h-3.5 text-[#1b765e]" />
              <span>Transparansi 100% Berbasis Pengawasan Syariah</span>
            </div>

            <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[#17332c] leading-[1.15]">
              Tunaikan Zakat dengan <span className="text-[#1b765e] italic">Ketenangan Hati.</span>
            </h1>

            <p className="text-base sm:text-lg text-[#5e7a70] leading-relaxed max-w-2xl mx-auto lg:mx-0">
              Setiap rupiah dan donasi Anda diawasi langsung oleh <strong>Dewan Pengawas Syariah (DPS)</strong> dan <strong>Auditor Independen</strong>. Saluran dana tercatat secara terbuka, amanah, dan tepat sasaran untuk 8 Asnaf mustahik.
            </p>

            {/* Trust Bullet Badges */}
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4 pt-2 text-xs font-medium text-[#17332c]">
              <div className="flex items-center gap-1.5 bg-[#f4f8f3] px-3 py-1.5 rounded-full border border-[#dbe7dd]">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Maksimal Hak Amil 12.5%</span>
              </div>
              <div className="flex items-center gap-1.5 bg-[#f4f8f3] px-3 py-1.5 rounded-full border border-[#dbe7dd]">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Bukti Serah Terima BAST Asli</span>
              </div>
              <div className="flex items-center gap-1.5 bg-[#f4f8f3] px-3 py-1.5 rounded-full border border-[#dbe7dd]">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Opini Audit WTP Terverifikasi</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3.5 pt-4">
              <Link
                to="/donasi"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-[#17332c] px-7 py-3.5 text-sm font-semibold uppercase tracking-wider text-white hover:bg-[#1b765e] shadow-md hover:shadow-lg transition-all"
              >
                <HeartHandshake className="w-4 h-4" />
                <span>Salurkan Zakat Sekarang</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/transparansi"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border border-[#17332c]/20 bg-white px-7 py-3.5 text-sm font-semibold uppercase tracking-wider text-[#17332c] hover:bg-[#f4f8f3] transition-all"
              >
                <Eye className="w-4 h-4 text-[#1b765e]" />
                <span>Lihat Laporan Kas Real-Time</span>
              </Link>
            </div>
          </div>

          {/* Right Column: Hero Visual Graphic / Card */}
          <div className="lg:col-span-5 flex justify-center">
            <div className="relative w-full max-w-md">
              {/* Decorative card with shadow */}
              <div className="relative rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-xl space-y-6">
                <div className="flex items-center justify-between border-b border-[#dbe7dd]/60 pb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-[#1b765e] flex items-center justify-center text-white font-serif font-bold">
                      Z
                    </div>
                    <div>
                      <h3 className="font-serif text-base font-bold text-[#17332c]">
                        Akad Zakat Digital
                      </h3>
                      <span className="text-[11px] text-[#5e7a70]">
                        Sistem Penyaluran Amanah
                      </span>
                    </div>
                  </div>
                  <Badge variant="sharia">100% Syariah</Badge>
                </div>

                {/* Key Pillars Checklist */}
                <div className="space-y-3.5 text-xs text-[#17332c]">
                  <div className="p-3.5 rounded-2xl bg-[#f4f8f3] border border-[#dbe7dd]/60 flex items-start gap-3">
                    <ShieldCheck className="w-4 h-4 text-[#1b765e] shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-[#17332c]">Otorisasi Dewan Pengawas Syariah</p>
                      <p className="text-[11px] text-[#5e7a70] mt-0.5">Dana hanya cair setelah 2 dari 3 ustadz DPS menyetujui program.</p>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-[#f4f8f3] border border-[#dbe7dd]/60 flex items-start gap-3">
                    <CheckCircle2 className="w-4 h-4 text-[#1b765e] shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-[#17332c]">Kunci Alokasi Otomatis (Code-is-Law)</p>
                      <p className="text-[11px] text-[#5e7a70] mt-0.5">Minimal 87.5% wajib tersalurkan murni untuk 7 Asnaf mustahik.</p>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-[#f4f8f3] border border-[#dbe7dd]/60 flex items-start gap-3">
                    <Eye className="w-4 h-4 text-[#1b765e] shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-[#17332c]">Bukti Penyerahan BAST di IPFS</p>
                      <p className="text-[11px] text-[#5e7a70] mt-0.5">Dokumen serah terima dapat diaudit publik secara bebas biaya.</p>
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <Link
                    to="/donasi"
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-[#c4ed70] hover:bg-[#b5e05d] text-[#17332c] font-bold text-xs uppercase tracking-wider transition-colors shadow-xs"
                  >
                    <span>Hitung & Salurkan Zakat</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

import React from "react";
import { Link } from "@tanstack/react-router";
import { HeartHandshake, ArrowRight, ShieldCheck, Sparkles, CheckCircle2 } from "lucide-react";
import { Container } from "../../components/layout/Container";

export function CtaBanner() {
  return (
    <section className="relative overflow-hidden bg-[#eaf3e8] border-t border-[#dbe7dd] py-20 text-[#17332c]">
      {/* Decorative ambient background like Hero section */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-[radial-gradient(circle,rgba(196,237,112,0.4),transparent_70%)] pointer-events-none -z-0" />

      <Container>
        <div className="max-w-4xl mx-auto text-center space-y-8 relative z-10">
          {/* Ayat Al-Qur'an Header */}
          <div className="space-y-3">
            <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white border border-[#1b765e]/20 text-[#1b765e] text-xs font-semibold uppercase tracking-wider shadow-xs">
              <Sparkles className="w-3.5 h-3.5 text-[#1b765e]" />
              <span>Penyucian Harta & Keberkahan</span>
            </span>
            <p className="font-serif text-xl sm:text-2xl italic text-[#1b765e] leading-relaxed max-w-2xl mx-auto pt-2">
              &quot;Ambillah zakat dari sebagian harta mereka, dengan zakat itu kamu membersihkan dan mensucikan mereka...&quot;
            </p>
            <span className="block text-xs text-[#5e7a70] font-sans font-bold uppercase tracking-widest">
              (QS. At-Taubah: 103)
            </span>
          </div>

          <h2 className="font-serif text-3xl sm:text-5xl font-bold tracking-tight text-[#17332c] leading-tight">
            Mulai Tunaikan Zakat Anda dengan Amanah & Terbuka
          </h2>

          <p className="text-base sm:text-lg text-[#1e3e36] max-w-xl mx-auto leading-relaxed font-normal">
            Bersama kita wujudkan ekosistem zakat Indonesia yang bersih dari korupsi, diawasi oleh para ulama, dan terverifikasi secara akurat.
          </p>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link
              to="/donasi"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-[#1b765e] hover:bg-[#143f34] px-8 py-4 text-xs font-bold uppercase tracking-wider text-white shadow-md hover:shadow-lg transition-all transform hover:-translate-y-0.5 cursor-pointer"
            >
              <HeartHandshake className="w-4 h-4" />
              <span>Salurkan Zakat Sekarang</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/verifikasi"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border border-[#1b765e]/30 bg-white hover:bg-[#f4f8f3] px-8 py-4 text-xs font-bold uppercase tracking-wider text-[#17332c] hover:text-[#1b765e] shadow-xs transition-all cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4 text-[#1b765e]" />
              <span>Cek Bukti Donasi Sebelumnya</span>
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}

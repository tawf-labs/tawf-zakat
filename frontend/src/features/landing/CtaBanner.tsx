import React from "react";
import { Link } from "@tanstack/react-router";
import { HeartHandshake, ArrowRight, ShieldCheck, Sparkles, CheckCircle2 } from "lucide-react";
import { Container } from "../../components/layout/Container";

export function CtaBanner() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-[#17332c] via-[#1b765e] to-[#0f3d30] text-[#f4f8f3] py-20">
      {/* Decorative ambient background */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(196,237,112,0.15),transparent_60%)] pointer-events-none" />

      <Container>
        <div className="max-w-4xl mx-auto text-center space-y-8 relative z-10">
          {/* Ayat Al-Qur'an Header */}
          <div className="space-y-3">
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-white/10 text-[#c4ed70] text-xs font-semibold uppercase tracking-wider backdrop-blur-xs border border-white/10">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Penyucian Harta & Keberkahan</span>
            </span>
            <p className="font-serif text-xl sm:text-2xl italic text-[#c4ed70] leading-relaxed max-w-2xl mx-auto pt-2">
              &quot;Ambillah zakat dari sebagian harta mereka, dengan zakat itu kamu membersihkan dan mensucikan mereka...&quot;
            </p>
            <span className="block text-xs text-[#f4f8f3]/70 font-sans uppercase tracking-widest">
              (QS. At-Taubah: 103)
            </span>
          </div>

          <h2 className="font-serif text-3xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
            Mulai Tunaikan Zakat Anda dengan Amanah & Terbuka
          </h2>

          <p className="text-base text-[#f4f8f3]/80 max-w-xl mx-auto leading-relaxed">
            Bersama kita wujudkan ekosistem zakat Indonesia yang bersih dari korupsi, diawasi oleh para ulama, dan terverifikasi secara akurat.
          </p>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link
              to="/donasi"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-[#c4ed70] px-8 py-4 text-xs font-bold uppercase tracking-wider text-[#17332c] hover:bg-white shadow-lg transition-all"
            >
              <HeartHandshake className="w-4 h-4" />
              <span>Salurkan Zakat Sekarang</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/verifikasi"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border border-white/30 bg-white/5 px-8 py-4 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/15 transition-all backdrop-blur-xs"
            >
              <CheckCircle2 className="w-4 h-4 text-[#c4ed70]" />
              <span>Cek Bukti Donasi Sebelumnya</span>
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}

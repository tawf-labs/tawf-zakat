import React from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Container } from "../../components/layout/Container";

export function Hero() {
  return (
    <section className="relative bg-[#eaf3e8] border-b border-[#dbe7dd] py-14 sm:py-20 lg:py-24 overflow-hidden">
      {/* Ambient background light */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-[radial-gradient(circle,rgba(196,237,112,0.3),transparent_70%)] pointer-events-none -z-10" />

      <Container>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* Left Column: Copy & Actions */}
          <div className="lg:col-span-7 flex flex-col items-start text-left space-y-6">
            {/* Main Heading */}
            <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[#17332c] leading-[1.12]">
              Tunaikan zakat.<br />
              <em className="text-[#1b765e] font-serif italic font-normal">
                Raih ketenangan hati.
              </em>
            </h1>

            {/* Subtitle with High Contrast & Readability */}
            <p className="text-base sm:text-lg text-[#1e3e36] font-normal leading-relaxed max-w-xl">
              Setiap rupiah dan donasi Anda diawasi langsung oleh <strong>Dewan Pengawas Syariah (DPS)</strong> dan <strong>Auditor Independen</strong>. Transparan 100%, amanah, dan tepat sasaran untuk 8 Asnaf mustahik.
            </p>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-4 pt-3">
              <Link
                to="/donasi"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#1b765e] hover:bg-[#143f34] px-7 py-3.5 text-sm font-semibold uppercase tracking-wider text-white shadow-md hover:shadow-lg transition-all transform hover:-translate-y-0.5 cursor-pointer"
              >
                <span>Salurkan Zakat Sekarang</span>
                <ArrowUpRight className="w-4 h-4" />
              </Link>
              <Link
                to="/transparansi"
                className="inline-flex items-center gap-1.5 px-4 py-3.5 text-sm font-bold text-[#17332c] hover:text-[#1b765e] transition-colors"
              >
                <span>Lihat Laporan Penyaluran</span>
                <span className="text-[#1b765e] text-lg font-bold">↗</span>
              </Link>
            </div>
          </div>

          {/* Right Column: Hero Graphic */}
          <div className="lg:col-span-5 flex items-center justify-center">
            <div className="relative w-full max-w-lg">
              <img
                src="/zktbg.png"
                alt="Ilustrasi Transparansi Zakat"
                className="w-full h-auto max-h-[460px] object-contain drop-shadow-md transform hover:scale-[1.02] transition-transform duration-300"
              />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

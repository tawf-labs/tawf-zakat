import React from "react";
import { Link } from "@tanstack/react-router";
import { ShieldCheck, ExternalLink, HeartHandshake, FileText, CheckCircle2 } from "lucide-react";
import { Container } from "./Container";

export function Footer() {
  return (
    <footer className="border-t border-[#dbe7dd] bg-[#f4f8f3] text-[#17332c] pt-16 pb-12">
      <Container>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-12 pb-12 border-b border-[#dbe7dd]">
          {/* Col 1: Brand & Mission */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#1b765e] flex items-center justify-center text-[#c4ed70] font-serif font-bold text-lg shadow-xs">
                Z
              </div>
              <span className="font-serif text-xl font-bold tracking-tight text-[#17332c]">
                TAWF ZAKAT
              </span>
            </div>
            <p className="text-sm text-[#5e7a70] leading-relaxed max-w-md">
              Protokol filantropi Islam modern yang menjamin 100% transparansi penyaluran zakat, infaq, dan sedekah melalui pengawasan terprogram Dewan Pengawas Syariah (DPS) dan Auditor Independen.
            </p>
            <div className="flex items-center gap-2 text-xs text-[#1b765e] font-semibold pt-1">
              <ShieldCheck className="w-4 h-4 shrink-0 text-[#1b765e]" />
              <span>Sesuai Fikih 8 Asnaf BAZNAS & Standar Akuntansi PSAK 109</span>
            </div>
          </div>

          {/* Col 2: Navigasi Cepat */}
          <div className="space-y-3">
            <h4 className="font-serif text-xs font-bold uppercase tracking-wider text-[#17332c]">
              Layanan Muzakki
            </h4>
            <ul className="space-y-2 text-sm text-[#5e7a70]">
              <li>
                <Link to="/donasi" className="hover:text-[#1b765e] transition-colors">
                  Kalkulator Zakat
                </Link>
              </li>
              <li>
                <Link to="/donasi" className="hover:text-[#1b765e] transition-colors">
                  Zakat Penghasilan
                </Link>
              </li>
              <li>
                <Link to="/donasi" className="hover:text-[#1b765e] transition-colors">
                  Zakat Maal & Tabungan
                </Link>
              </li>
              <li>
                <Link to="/donasi" className="hover:text-[#1b765e] transition-colors">
                  Infaq & Sedekah
                </Link>
              </li>
              <li>
                <Link to="/verifikasi" className="hover:text-[#1b765e] transition-colors">
                  Cek Bukti Donasi
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 3: Transparansi Publik */}
          <div className="space-y-3">
            <h4 className="font-serif text-xs font-bold uppercase tracking-wider text-[#17332c]">
              Transparansi
            </h4>
            <ul className="space-y-2 text-sm text-[#5e7a70]">
              <li>
                <Link to="/transparansi" className="hover:text-[#1b765e] transition-colors">
                  Laporan Kas Real-Time
                </Link>
              </li>
              <li>
                <Link to="/transparansi" className="hover:text-[#1b765e] transition-colors">
                  Distribusi 8 Asnaf
                </Link>
              </li>
              <li>
                <Link to="/transparansi" className="hover:text-[#1b765e] transition-colors">
                  Berkas BAST & Penyaluran
                </Link>
              </li>
              <li>
                <Link to="/tata-kelola" className="hover:text-[#1b765e] transition-colors">
                  Portal Pengawas & DPS
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 4: Data Kriptografi / Audit */}
          <div className="space-y-3">
            <h4 className="font-serif text-xs font-bold uppercase tracking-wider text-[#17332c]">
              Audit On-Chain
            </h4>
            <ul className="space-y-2 text-xs text-[#5e7a70] font-mono">
              <li>
                <a
                  href="https://sepolia.arbiscan.io/address/0x5f2394e6bc3dd842831c66253d4433f4f72b4e7b"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-[#1b765e] transition-colors flex items-center gap-1.5"
                >
                  <span>Arbitrum Sepolia Contract</span>
                  <ExternalLink className="w-3 h-3 text-[#1b765e]" />
                </a>
              </li>
              <li>
                <a
                  href="https://app.safe.global/home?safe=sep:0xb4E4253e2aFfdC0710Cb9394b8C4E935F11B00f1"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-[#1b765e] transition-colors flex items-center gap-1.5"
                >
                  <span>Safe Multisig DPS</span>
                  <ExternalLink className="w-3 h-3 text-[#1b765e]" />
                </a>
              </li>
              <li>
                <span className="text-[#5e7a70]/80">Jaringan: Arbitrum Sepolia L1</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#5e7a70]">
          <p>© {new Date().getFullYear()} TAWF Zakat Protocol. Amanah, Transparan, dan Terbuka.</p>
          <p className="text-[11px] text-[#5e7a70]/80">
            Dibangun untuk kebaikan umat dengan integritas data anti-korupsi.
          </p>
        </div>
      </Container>
    </footer>
  );
}

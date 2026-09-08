import React, { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { SafeConnectKitButton } from "../../lib/SafeConnectKitProvider";
import { Menu, X, HeartHandshake, Eye, CheckCircle2, Home, Landmark, Scale, FileCheck, Building2 } from "lucide-react";

export function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenuOpen]);

  const navLinks = [
    { to: "/", label: "Beranda", icon: Home },
    { to: "/donasi", label: "Salurkan Zakat", icon: HeartHandshake },
    { to: "/transparansi", label: "Transparansi", icon: Eye },
    { to: "/verifikasi", label: "Cek Bukti", icon: CheckCircle2 },
    { to: "/rekonsiliasi", label: "Rekonsiliasi", icon: Scale },
    { to: "/laporan-periode", label: "Laporan Periode", icon: FileCheck },
    { to: "/ruang-kerja", label: "Ruang Kerja", icon: Building2 },
    { to: "/tata-kelola", label: "Portal Pengawas", icon: Landmark },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#dbe7dd] bg-white/95 backdrop-blur-md shadow-xs transition-all">
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        {/* Brand Logo */}
        <div className="min-w-0">
          <Link to="/" className="flex items-center gap-2.5 whitespace-nowrap group">
            <div className="w-8 h-8 shrink-0 rounded-xl bg-gradient-to-br from-[#1b765e] to-[#17332c] flex items-center justify-center text-white font-serif font-bold text-base shadow-xs group-hover:scale-105 transition-transform">
              Z
            </div>
            <div className="flex flex-col">
              <span className="font-serif text-lg sm:text-xl font-bold tracking-tight text-[#17332c] leading-none">
                TAWF<span className="hidden sm:inline"> ZAKAT</span>
              </span>
              <span className="hidden sm:block text-[9px] tracking-[0.18em] uppercase text-[#1b765e] font-semibold">
                Transparan & Syariah
              </span>
            </div>
          </Link>
        </div>

        {/* Right Actions */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* Connect Wallet Button */}
          <SafeConnectKitButton>
            {({ isConnected: isWalletConnected, isConnecting, show, address, truncatedAddress }) => {
              return (
                <button
                  onClick={show}
                  className={`px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs font-semibold tracking-wider transition-all duration-200 cursor-pointer flex items-center gap-2 whitespace-nowrap border shadow-2xs ${
                    isWalletConnected
                      ? "bg-[#f4f8f3] text-[#17332c] border-[#1b765e]/30 hover:border-[#1b765e]"
                      : "bg-[#17332c] text-[#f4f8f3] border-transparent hover:bg-[#1b765e]"
                  }`}
                >
                  <span
                    className={`w-2 h-2 shrink-0 rounded-full ${
                      isWalletConnected ? "bg-emerald-500" : isConnecting ? "bg-amber-400 animate-ping" : "bg-slate-300"
                    }`}
                  />
                  <span className="max-w-24 truncate sm:max-w-none">
                    {isWalletConnected
                      ? truncatedAddress || address?.slice(0, 6) + "..." + address?.slice(-4)
                      : isConnecting
                      ? "Menghubungkan..."
                      : <><span className="sm:hidden">Dompet</span><span className="hidden sm:inline">Dompet Web3</span></>}
                  </span>
                </button>
              );
            }}
          </SafeConnectKitButton>

          {/* Mobile Menu Toggle Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="xl:hidden shrink-0 p-2 rounded-lg text-[#17332c] hover:bg-[#f4f8f3] transition-colors border border-[#dbe7dd]"
            type="button"
            aria-label={mobileMenuOpen ? "Tutup menu" : "Buka menu"}
            aria-expanded={mobileMenuOpen}
            aria-controls="primary-navigation-mobile"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      <div className="hidden xl:block border-t border-[#dbe7dd]/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Desktop Nav Links */}
          <nav aria-label="Navigasi utama" className="hidden xl:grid grid-cols-8 gap-1 py-2 text-xs font-semibold text-[#5e7a70]">
            {navLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  activeProps={{
                    className: "text-[#1b765e] bg-[#f4f8f3] font-bold border-b-2 border-[#1b765e]",
                  }}
                  className="min-w-0 whitespace-nowrap px-2 py-2 rounded-lg hover:text-[#1b765e] hover:bg-[#f4f8f3]/60 transition-all flex items-center justify-center gap-1.5"
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Mobile Menu Drawer */}
      {mobileMenuOpen && (
        <nav id="primary-navigation-mobile" aria-label="Navigasi utama" className="xl:hidden max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-[#dbe7dd] bg-white px-4 pt-3 pb-5 space-y-2 shadow-lg animate-in slide-in-from-top-2">
          {navLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMobileMenuOpen(false)}
                activeProps={{
                  className: "text-[#1b765e] bg-[#f4f8f3] font-bold border-l-4 border-[#1b765e]",
                }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold text-[#17332c] hover:bg-[#f4f8f3] transition-colors"
              >
                <Icon className="w-4 h-4 text-[#1b765e]" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}

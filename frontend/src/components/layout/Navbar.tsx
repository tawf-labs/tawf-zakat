import React, { useState } from "react";
import { Link } from "@tanstack/react-router";
import { SafeConnectKitButton } from "../../lib/SafeConnectKitProvider";
import { Menu, X, Shield, HeartHandshake, Eye, CheckCircle2, Home, Landmark } from "lucide-react";
import { useWebSocket } from "../../lib/WebSocketContext";

export function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isConnected } = useWebSocket();

  const navLinks = [
    { to: "/", label: "Beranda", icon: Home },
    { to: "/donasi", label: "Salurkan Zakat", icon: HeartHandshake },
    { to: "/transparansi", label: "Transparansi", icon: Eye },
    { to: "/verifikasi", label: "Cek Bukti", icon: CheckCircle2 },
    { to: "/tata-kelola", label: "Portal Pengawas", icon: Landmark },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#dbe7dd] bg-white/95 backdrop-blur-md shadow-xs transition-all">
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand Logo */}
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#1b765e] to-[#17332c] flex items-center justify-center text-white font-serif font-bold text-base shadow-xs group-hover:scale-105 transition-transform">
              Z
            </div>
            <div className="flex flex-col">
              <span className="font-serif text-lg sm:text-xl font-bold tracking-tight text-[#17332c] leading-none">
                TAWF ZAKAT
              </span>
              <span className="text-[9px] tracking-[0.18em] uppercase text-[#1b765e] font-semibold">
                Transparan & Syariah
              </span>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="hidden lg:flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#5e7a70]">
            {navLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  activeProps={{
                    className: "text-[#1b765e] bg-[#f4f8f3] font-bold border-b-2 border-[#1b765e]",
                  }}
                  className="px-3.5 py-2 rounded-lg hover:text-[#1b765e] hover:bg-[#f4f8f3]/60 transition-all flex items-center gap-1.5"
                >
                  <Icon className="w-3.5 h-3.5" />
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {/* Connect Wallet Button */}
          <SafeConnectKitButton>
            {({ isConnected: isWalletConnected, isConnecting, show, address, truncatedAddress }) => {
              return (
                <button
                  onClick={show}
                  className={`px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs font-semibold tracking-wider transition-all duration-200 cursor-pointer flex items-center gap-2 border shadow-2xs ${
                    isWalletConnected
                      ? "bg-[#f4f8f3] text-[#17332c] border-[#1b765e]/30 hover:border-[#1b765e]"
                      : "bg-[#17332c] text-[#f4f8f3] border-transparent hover:bg-[#1b765e]"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isWalletConnected ? "bg-emerald-500" : isConnecting ? "bg-amber-400 animate-ping" : "bg-slate-300"
                    }`}
                  />
                  <span>
                    {isWalletConnected
                      ? truncatedAddress || address?.slice(0, 6) + "..." + address?.slice(-4)
                      : isConnecting
                      ? "Menghubungkan..."
                      : "Dompet Web3"}
                  </span>
                </button>
              );
            }}
          </SafeConnectKitButton>

          {/* Mobile Menu Toggle Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded-lg text-[#17332c] hover:bg-[#f4f8f3] transition-colors border border-[#dbe7dd]"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-[#dbe7dd] bg-white px-4 pt-3 pb-5 space-y-2 shadow-lg animate-in slide-in-from-top-2">
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
        </div>
      )}
    </header>
  );
}

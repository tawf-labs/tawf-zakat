import React, { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ConnectKitButton } from "connectkit";
import { Wallet, ChevronDown, AlertCircle, Menu, X, Shield, Search } from "lucide-react";
import { sepolia } from "wagmi/chains";
import { useWebSocket } from "../lib/WebSocketContext";

export function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isConnected } = useWebSocket();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#dbe7dd] bg-white/95 backdrop-blur-md shadow-xs transition-all">
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand Logo */}
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2.5 group">
            <img
              src="/logo.png"
              alt="Tawf Logo"
              className="h-8 w-auto object-contain"
              onError={(e) => {
                // Fallback if image fails to render
                e.currentTarget.style.display = "none";
              }}
            />
            <div className="flex flex-col">
              <span className="font-serif text-xl font-bold tracking-tight text-[#17332c] leading-none">
                TAWF ZAKAT
              </span>
              <span className="text-[9px] tracking-[0.18em] uppercase text-[#1b765e] font-semibold">
                Transparent Syariah Protocol
              </span>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-7 text-xs font-semibold uppercase tracking-wider text-[#5e7a70]">
            <a
              href="#why"
              className="hover:text-[#1b765e] transition-colors py-1 hover:underline underline-offset-4"
            >
              Tentang
            </a>
            <a
              href="#campaigns"
              className="hover:text-[#1b765e] transition-colors py-1 hover:underline underline-offset-4"
            >
              Kampanye
            </a>
            <a
              href="#how-it-works"
              className="hover:text-[#1b765e] transition-colors py-1 hover:underline underline-offset-4"
            >
              Alur Kerja
            </a>
            <a
              href="#donate"
              className="hover:text-[#1b765e] transition-colors py-1 hover:underline underline-offset-4"
            >
              Salurkan Zakat
            </a>
            <a
              href="#verify"
              className="hover:text-[#1b765e] transition-colors py-1 hover:underline underline-offset-4"
            >
              Verifikasi
            </a>
            <a
              href="#transparency"
              className="hover:text-[#1b765e] transition-colors py-1 hover:underline underline-offset-4"
            >
              Dashboard Audit
            </a>
            <a
              href="#governance"
              className="hover:text-[#1b765e] transition-colors py-1 hover:underline underline-offset-4"
            >
              Multi-Sig
            </a>
            <Link
              to="/admin/roles"
              className="hover:text-[#1b765e] transition-colors py-1 hover:underline underline-offset-4 text-[#1b765e] flex items-center gap-1 font-bold"
            >
              <Shield className="w-3 h-3 text-[#1b765e]" />
              Kelola Peran
            </Link>
          </nav>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {/* Live WebSocket Indicator Badge */}
          <div
            className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-medium border border-[#dbe7dd] bg-[#f4f8f3] text-[#17332c]"
            title={isConnected ? "WebSocket Real-Time Terhubung" : "Menghubungkan ke Server Real-Time..."}
          >
            <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-400"}`} />
            <span>{isConnected ? "LIVE" : "CONNECTING"}</span>
          </div>

          {/* Quick Donate CTA */}
          <a
            href="#donate"
            className="hidden sm:inline-flex items-center gap-1.5 border border-[#1b765e]/30 bg-[#eaf3e8] hover:bg-[#1b765e] hover:text-white text-[#1b765e] text-xs font-semibold px-3.5 py-1.5 rounded-full transition-all duration-200"
          >
            <Shield className="w-3.5 h-3.5" />
            <span>12.5% Invariant Locked</span>
          </a>

          {/* ConnectKit Wallet Button */}
          <ConnectKitButton.Custom>
            {({ isConnected, isConnecting, show, address, truncatedAddress, ensName, chain }) => {
              if (isConnected && address) {
                const isSepolia = chain?.id === sepolia.id;

                return (
                  <button
                    onClick={show}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-[#1b765e]/30 shadow-xs hover:border-[#1b765e] hover:shadow-sm transition-all text-xs cursor-pointer group"
                  >
                    {!isSepolia ? (
                      <span className="flex items-center gap-1 text-[10px] text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full font-bold">
                        <AlertCircle className="w-3 h-3" /> Pindah Chain
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full font-semibold hidden sm:flex">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        Sepolia
                      </span>
                    )}

                    <div className="w-5 h-5 rounded-full bg-[#1b765e] text-white flex items-center justify-center font-bold text-[9px]">
                      {address.slice(2, 4).toUpperCase()}
                    </div>

                    <span className="font-mono font-bold text-[#17332c]">
                      {ensName ?? truncatedAddress}
                    </span>

                    <ChevronDown className="w-3.5 h-3.5 text-stone-400 group-hover:text-stone-700" />
                  </button>
                );
              }

              return (
                <button
                  onClick={show}
                  disabled={isConnecting}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#1b765e] hover:bg-[#143f34] text-white text-xs font-semibold uppercase tracking-wider shadow-sm active:scale-98 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Wallet className="w-3.5 h-3.5 text-[#c4ed70]" />
                  {isConnecting ? "Membuka..." : "Connect Wallet"}
                </button>
              );
            }}
          </ConnectKitButton.Custom>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg text-[#17332c] hover:bg-[#eaf3e8] transition-colors"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-[#dbe7dd] bg-white px-4 py-4 space-y-3 animate-in slide-in-from-top-2 duration-200">
          <a
            href="#why"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-sm font-semibold text-[#17332c] hover:text-[#1b765e] py-1.5"
          >
            Tentang Kami
          </a>
          <a
            href="#campaigns"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-sm font-semibold text-[#17332c] hover:text-[#1b765e] py-1.5"
          >
            Program & Kampanye
          </a>
          <a
            href="#how-it-works"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-sm font-semibold text-[#17332c] hover:text-[#1b765e] py-1.5"
          >
            Alur Transparansi
          </a>
          <a
            href="#donate"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-sm font-semibold text-[#17332c] hover:text-[#1b765e] py-1.5"
          >
            Salurkan Zakat
          </a>
          <a
            href="#verify"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-sm font-semibold text-[#17332c] hover:text-[#1b765e] py-1.5"
          >
            Verifikasi Kuitansi Merkle
          </a>
          <a
            href="#transparency"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-sm font-semibold text-[#17332c] hover:text-[#1b765e] py-1.5"
          >
            Dashboard Transparansi
          </a>
          <a
            href="#governance"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-sm font-semibold text-[#17332c] hover:text-[#1b765e] py-1.5"
          >
            Multi-Sig 2-of-3 Governance
          </a>
          <Link
            to="/admin/roles"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-sm font-bold text-[#1b765e] py-1.5 flex items-center gap-2"
          >
            <Shield className="w-4 h-4 text-[#1b765e]" />
            Kelola Peran (Admin & DPS Portal)
          </Link>
        </div>
      )}
    </header>
  );
}

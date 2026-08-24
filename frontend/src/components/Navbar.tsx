import React from "react";
import { Link } from "@tanstack/react-router";
import { ShieldCheck, Sparkles } from "lucide-react";

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-[#F9F6F0]/90 border-b border-[#0F3D30]/10 px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand Logo */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-full bg-[#0F3D30] flex items-center justify-center text-[#C5A869] font-serif font-bold text-xl shadow-sm group-hover:bg-[#1A5242] transition-colors">
            T
          </div>
          <div>
            <span className="font-serif text-2xl font-bold tracking-wide text-[#0F3D30] block leading-none">
              TAWF ZAKAT
            </span>
            <span className="text-[10px] tracking-[0.2em] uppercase text-[#C5A869] font-semibold">
              Ethereum L1 Transparency
            </span>
          </div>
        </Link>

        {/* Navigation Links */}
        <nav className="hidden md:flex items-center gap-8 text-xs uppercase tracking-widest font-semibold text-[#1A1A1A]">
          <Link
            to="/"
            hash="donate"
            className="hover:text-[#0F3D30] transition-colors py-1 border-b-2 border-transparent hover:border-[#0F3D30]"
          >
            Salurkan Zakat
          </Link>
          <Link
            to="/"
            hash="verify"
            className="hover:text-[#0F3D30] transition-colors py-1 border-b-2 border-transparent hover:border-[#0F3D30]"
          >
            Verifikasi Muzakki
          </Link>
          <Link
            to="/"
            hash="transparency"
            className="hover:text-[#0F3D30] transition-colors py-1 border-b-2 border-transparent hover:border-[#0F3D30]"
          >
            Dashboard Audit
          </Link>
          <Link
            to="/"
            hash="governance"
            className="hover:text-[#0F3D30] transition-colors py-1 border-b-2 border-transparent hover:border-[#0F3D30]"
          >
            Multi-Sig 2-of-3
          </Link>
        </nav>

        {/* Network & Action Badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-800 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Ethereum Sepolia
          </div>
        </div>
      </div>
    </header>
  );
}

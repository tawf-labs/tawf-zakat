import React from "react";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col justify-between">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-[#F9F6F0]/90 border-b border-[#0F3D30]/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#0F3D30] flex items-center justify-center text-[#C5A869] font-serif font-bold text-lg">
            T
          </div>
          <span className="font-serif text-2xl font-semibold tracking-wide text-[#0F3D30]">
            TAWF ZAKAT
          </span>
        </div>
        <nav className="flex items-center gap-6 text-xs uppercase tracking-widest font-medium text-[#1A1A1A]">
          <a href="#donate" className="hover:text-[#0F3D30] transition-colors">
            Salurkan Zakat
          </a>
          <a href="#verify" className="hover:text-[#0F3D30] transition-colors">
            Verifikasi Muzakki
          </a>
          <a href="#dashboard" className="hover:text-[#0F3D30] transition-colors">
            Transparansi L1
          </a>
        </nav>
      </header>

      {/* Hero Body */}
      <main className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-4xl mx-auto">
        <span className="text-xs uppercase tracking-[0.25em] text-[#C5A869] font-semibold mb-3">
          Zakat Transparency & Anti-Corruption Protocol
        </span>
        <h1 className="text-4xl md:text-6xl font-serif font-medium text-[#0F3D30] leading-tight mb-6">
          Akuntabilitas Zakat Terprogram di Atas Ethereum
        </h1>
        <p className="text-base md:text-lg text-[#555555] max-w-2xl mb-8 leading-relaxed">
          Mengunci hak operasional amil maksimal 12.5% secara <em>code-is-law</em>, memverifikasi donasi fiat via Merkle Batching tanpa gas fee, dan menyalurkan bantuan dengan otorisasi Multi-Sig 2-of-3 terikat bukti IPFS.
        </p>

        <div className="flex flex-wrap gap-4 justify-center">
          <button className="px-8 py-3 rounded-full bg-[#0F3D30] text-[#F9F6F0] font-medium text-sm hover:bg-[#1A5242] transition-colors shadow-sm">
            Salurkan Zakat
          </button>
          <button className="px-8 py-3 rounded-full bg-white text-[#0F3D30] border border-[#0F3D30]/20 font-medium text-sm hover:bg-[#F9F6F0] transition-colors shadow-sm">
            Verifikasi Kuitansi
          </button>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#0F3D30]/10 py-6 text-center text-xs text-[#555555]">
        © 2026 Tawf Foundation. Built for Ethical Web3 Philanthropy.
      </footer>
    </div>
  );
}

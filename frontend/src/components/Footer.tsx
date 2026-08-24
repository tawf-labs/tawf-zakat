import React from "react";
import { ShieldCheck, HeartHandshake, FileCode2 } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-[#0F3D30]/10 bg-[#F9F6F0] py-12 px-6">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
        <div className="md:col-span-2">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-[#0F3D30] flex items-center justify-center text-[#C5A869] font-serif font-bold text-lg">
              T
            </div>
            <span className="font-serif text-xl font-bold tracking-wide text-[#0F3D30]">
              TAWF FOUNDATION
            </span>
          </div>
          <p className="text-sm text-[#555555] max-w-md leading-relaxed">
            Protokol transparansi zakat berbasis kode etik Islam dan kepastian kriptografis di Ethereum. Menjamin alokasi hak asnaf tepat sasaran tanpa manipulasi.
          </p>
        </div>

        <div>
          <h4 className="font-serif font-semibold text-sm uppercase tracking-wider text-[#0F3D30] mb-3">
            Fitur Utama
          </h4>
          <ul className="space-y-2 text-xs text-[#555555]">
            <li>• Multi-Unit Ledger (Fiat IDR & USDC)</li>
            <li>• Merkle Inclusion Proof (Tanpa Gas Fee)</li>
            <li>• Batas Hak Amil 12.5% (Code-is-Law)</li>
            <li>• Otorisasi Multi-Sig 2-of-3</li>
          </ul>
        </div>

        <div>
          <h4 className="font-serif font-semibold text-sm uppercase tracking-wider text-[#0F3D30] mb-3">
            Integritas & Keamanan
          </h4>
          <ul className="space-y-2 text-xs text-[#555555]">
            <li className="flex items-center gap-1.5 text-emerald-800">
              <ShieldCheck className="w-3.5 h-3.5" /> Ethereum Sepolia L1
            </li>
            <li className="flex items-center gap-1.5 text-amber-800">
              <HeartHandshake className="w-3.5 h-3.5" /> Dewan Pengawas Syariah
            </li>
            <li className="flex items-center gap-1.5 text-sky-800">
              <FileCode2 className="w-3.5 h-3.5" /> OpenZeppelin Contracts
            </li>
          </ul>
        </div>
      </div>

      <div className="max-w-7xl mx-auto pt-6 border-t border-[#0F3D30]/10 flex flex-col md:flex-row items-center justify-between text-xs text-[#555555]">
        <p>© 2026 Tawf Foundation. Built for Ethical Web3 Philanthropy.</p>
        <p className="mt-2 md:mt-0 font-serif italic text-sm text-[#0F3D30]">
          "Dan dirikanlah shalat serta tunaikanlah zakat..." (QS. Al-Baqarah: 43)
        </p>
      </div>
    </footer>
  );
}

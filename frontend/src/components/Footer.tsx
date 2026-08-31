import React from "react";
import { ShieldCheck, HeartHandshake, FileCode2, Globe, MessageCircle, Share2, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function Footer() {
  return (
    <footer className="bg-gradient-to-b from-white to-[#f4f8f3] border-t border-[#dbe7dd] pt-16 pb-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 mb-12">
          {/* Brand Column */}
          <div className="lg:col-span-2 space-y-4">
            <Link to="/" className="flex items-center gap-2.5">
              <img
                src="/logo.png"
                alt="Tawf Logo"
                className="h-8 object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              <span className="font-serif text-2xl font-bold tracking-tight text-[#17332c]">
                TAWF ZAKAT
              </span>
            </Link>

            <p className="text-sm text-[#5e7a70] max-w-sm leading-relaxed">
              Protokol transparansi zakat pertama di blockchain yang mengunci hak operasional amil maksimal 12.5% secara <em>code-is-law</em> dan memvalidasi penyaluran dana secara publik.
            </p>

            <div className="flex gap-3 text-[#5e7a70] pt-2">
              <a href="#" className="p-2 rounded-full border border-[#dbe7dd] hover:border-[#1b765e] hover:text-[#1b765e] transition-colors" title="Website">
                <Globe className="h-4 w-4" />
              </a>
              <a href="#" className="p-2 rounded-full border border-[#dbe7dd] hover:border-[#1b765e] hover:text-[#1b765e] transition-colors" title="Komunitas">
                <MessageCircle className="h-4 w-4" />
              </a>
              <a href="#" className="p-2 rounded-full border border-[#dbe7dd] hover:border-[#1b765e] hover:text-[#1b765e] transition-colors" title="Bagikan">
                <Share2 className="h-4 w-4" />
              </a>
              <a href="https://sepolia.etherscan.io" target="_blank" rel="noreferrer" className="p-2 rounded-full border border-[#dbe7dd] hover:border-[#1b765e] hover:text-[#1b765e] transition-colors" title="Etherscan">
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div className="space-y-3">
            <h3 className="font-bold text-sm text-[#17332c] uppercase tracking-wider">
              Protokol
            </h3>
            <ul className="space-y-2 text-xs text-[#5e7a70]">
              <li>
                <a href="#donate" className="hover:text-[#1b765e] transition-colors">
                  Salurkan Zakat
                </a>
              </li>
              <li>
                <a href="#verify" className="hover:text-[#1b765e] transition-colors">
                  Verifikasi Kuitansi Merkle
                </a>
              </li>
              <li>
                <a href="#transparency" className="hover:text-[#1b765e] transition-colors">
                  Dashboard Audit Publik
                </a>
              </li>
              <li>
                <a href="#governance" className="hover:text-[#1b765e] transition-colors">
                  Multi-Sig 2-of-3 Governance
                </a>
              </li>
            </ul>
          </div>

          {/* Pillars */}
          <div className="space-y-3">
            <h3 className="font-bold text-sm text-[#17332c] uppercase tracking-wider">
              Prinsip Syariah
            </h3>
            <ul className="space-y-2 text-xs text-[#5e7a70]">
              <li>• Invariant 12.5% Hak Amil</li>
              <li>• 87.5% Hak Mutlak Mustahik</li>
              <li>• Zero Gas Verification</li>
              <li>• IPFS Attachment Proof</li>
            </ul>
          </div>

          {/* Security */}
          <div className="space-y-3">
            <h3 className="font-bold text-sm text-[#17332c] uppercase tracking-wider">
              Keamanan
            </h3>
            <ul className="space-y-2.5 text-xs text-[#5e7a70]">
              <li className="flex items-center gap-1.5 text-emerald-800 font-medium">
                <ShieldCheck className="w-4 h-4 text-[#1b765e]" /> Ethereum Sepolia L1
              </li>
              <li className="flex items-center gap-1.5 text-emerald-800 font-medium">
                <HeartHandshake className="w-4 h-4 text-[#1b765e]" /> Dewan Pengawas Syariah
              </li>
              <li className="flex items-center gap-1.5 text-emerald-800 font-medium">
                <FileCode2 className="w-4 h-4 text-[#1b765e]" /> OpenZeppelin Standard
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="pt-8 border-t border-[#dbe7dd] flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-[#5e7a70]">
          <p>© 2026 Tawf Foundation. Built for Transparent & Ethical Philanthropy.</p>
          <p className="font-serif italic text-sm text-[#17332c]">
            "Dan dirikanlah shalat serta tunaikanlah zakat..." (QS. Al-Baqarah: 43)
          </p>
        </div>
      </div>
    </footer>
  );
}

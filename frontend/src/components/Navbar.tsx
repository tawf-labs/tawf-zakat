import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ConnectKitButton } from "connectkit";
import { Wallet, ChevronDown, AlertCircle, Shield } from "lucide-react";
import { sepolia } from "wagmi/chains";
import { SafeConnectModal } from "./SafeConnectModal";

export function Navbar() {
  const [showSafeModal, setShowSafeModal] = useState(false);

  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-[#F9F6F0]/90 border-b border-[#0F3D30]/10 px-6 py-3.5 transition-all">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand Logo */}
        <Link to="/" className="flex items-center gap-3 group cursor-pointer">
          <div className="w-10 h-10 rounded-full bg-[#0F3D30] flex items-center justify-center text-[#C5A869] font-serif font-bold text-xl shadow-xs group-hover:bg-[#1A5242] transition-colors">
            T
          </div>
          <div>
            <span className="font-serif text-2xl font-bold tracking-wide text-[#0F3D30] block leading-none">
              TAWF ZAKAT
            </span>
            <span className="text-[10px] tracking-[0.2em] uppercase text-[#C5A869] font-semibold">
              Web 2.5 Syariah Protocol
            </span>
          </div>
        </Link>

        {/* Navigation Links */}
        <nav className="hidden lg:flex items-center gap-8 text-xs uppercase tracking-widest font-semibold text-[#1A1A1A]">
          <Link
            to="/"
            hash="donate"
            className="hover:text-[#0F3D30] transition-colors py-1 border-b-2 border-transparent hover:border-[#0F3D30] cursor-pointer"
          >
            Salurkan Zakat
          </Link>
          <Link
            to="/"
            hash="verify"
            className="hover:text-[#0F3D30] transition-colors py-1 border-b-2 border-transparent hover:border-[#0F3D30] cursor-pointer"
          >
            Verifikasi Muzakki
          </Link>
          <Link
            to="/"
            hash="transparency"
            className="hover:text-[#0F3D30] transition-colors py-1 border-b-2 border-transparent hover:border-[#0F3D30] cursor-pointer"
          >
            Dashboard Audit
          </Link>
          <Link
            to="/"
            hash="governance"
            className="hover:text-[#0F3D30] transition-colors py-1 border-b-2 border-transparent hover:border-[#0F3D30] cursor-pointer"
          >
            Multi-Sig 2-of-3
          </Link>
        </nav>

        {/* Connect Buttons Integration */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowSafeModal(true)}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-full border border-[#0F3D30]/20 bg-white text-[#0F3D30] hover:bg-[#F9F6F0] text-xs font-semibold shadow-2xs transition-all cursor-pointer"
            title="Salin URI WalletConnect untuk Safe Wallet di browser"
          >
            <Shield className="w-3.5 h-3.5 text-[#C5A869]" />
            <span>Koneksi Safe (DPS)</span>
          </button>

          <ConnectKitButton.Custom>
            {({ isConnected, isConnecting, show, address, truncatedAddress, ensName, chain }) => {
              if (isConnected && address) {
                const isSepolia = chain?.id === sepolia.id;

                return (
                  <button
                    onClick={show}
                    className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-white border border-[#0F3D30]/20 shadow-xs hover:border-[#0F3D30] hover:shadow-sm transition-all text-xs cursor-pointer group"
                  >
                    {!isSepolia ? (
                      <span className="flex items-center gap-1 text-[11px] text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full font-bold">
                        <AlertCircle className="w-3 h-3" /> Pindah ke Sepolia
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-[11px] text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full font-semibold hidden sm:flex">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        Sepolia
                      </span>
                    )}

                    <div className="w-5 h-5 rounded-full bg-[#0F3D30] text-[#C5A869] flex items-center justify-center font-bold text-[9px]">
                      {address.slice(2, 4).toUpperCase()}
                    </div>

                    <span className="font-mono font-bold text-[#0F3D30]">
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
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#0F3D30] text-[#F9F6F0] text-xs font-semibold uppercase tracking-wider hover:bg-[#1A5242] shadow-xs active:scale-98 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Wallet className="w-3.5 h-3.5 text-[#C5A869]" />
                  {isConnecting ? "Membuka..." : "Connect Wallet"}
                </button>
              );
            }}
          </ConnectKitButton.Custom>
        </div>
      </div>

      <SafeConnectModal
        isOpen={showSafeModal}
        onClose={() => setShowSafeModal(false)}
      />
    </header>
  );
}

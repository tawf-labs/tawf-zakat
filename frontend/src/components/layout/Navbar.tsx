import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { SafeConnectKitButton } from "../../lib/SafeConnectKitProvider";
import {
  Menu,
  X,
  HeartHandshake,
  Eye,
  CheckCircle2,
  Home,
  Landmark,
  Scale,
  FileCheck,
  Building2,
  User,
  Copy,
  Check,
  LogOut,
  ShieldAlert,
  ChevronDown,
} from "lucide-react";
import { useOptionalWorkspaceAccess } from "../../features/workspace/useWorkspaceAccess";

export function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [identityMenuOpen, setIdentityMenuOpen] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const access = useOptionalWorkspaceAccess();

  useEffect(() => {
    if (!mobileMenuOpen && !identityMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
        setIdentityMenuOpen(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenuOpen, identityMenuOpen]);

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
          {/* Workspace Officer Identity Pill (Ticket #87) */}
          {access?.state === "READY" && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setIdentityMenuOpen((prev) => !prev)}
                className={`px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-full text-xs font-semibold tracking-wide transition-all duration-200 cursor-pointer flex items-center gap-2 whitespace-nowrap border shadow-2xs ${
                  access.workspace.officer
                    ? "bg-[#f4f8f3] text-[#17332c] border-[#1b765e]/30 hover:border-[#1b765e]"
                    : "bg-amber-50 text-amber-900 border-amber-300 hover:border-amber-400"
                }`}
                aria-haspopup="dialog"
                aria-expanded={identityMenuOpen}
                aria-label="Detail identitas petugas dan ruang kerja lembaga"
              >
                <Building2 className="w-3.5 h-3.5 text-[#1b765e] shrink-0" />
                <div className="flex items-center gap-1.5 text-left">
                  <span className="max-w-28 sm:max-w-36 truncate font-medium">
                    {access.workspace.officer?.displayName || "Profil Belum Diatur"}
                  </span>
                  <span className="hidden lg:inline text-[10px] text-stone-400">·</span>
                  <span className="hidden lg:inline max-w-32 truncate text-stone-600 font-normal">
                    {access.workspace.institution.legalName}
                  </span>
                </div>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                    access.workspace.role === "ADMIN"
                      ? "bg-purple-100 text-purple-800"
                      : access.workspace.role === "OFFICER"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-blue-100 text-blue-800"
                  }`}
                >
                  {access.workspace.role}
                </span>
                <ChevronDown className="w-3 h-3 text-stone-400 shrink-0" />
              </button>

              {/* Detail Menu Popover */}
              {identityMenuOpen && (
                <div
                  role="dialog"
                  aria-modal="false"
                  aria-label="Informasi akun kerja dan identitas lembaga"
                  className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border border-[#dbe7dd] bg-white p-4 shadow-xl z-50 text-[#17332c] animate-in fade-in zoom-in-95"
                >
                  <div className="flex items-start justify-between border-b border-[#dbe7dd]/80 pb-3">
                    <div>
                      <h3 className="font-semibold text-sm flex items-center gap-1.5">
                        <User className="w-4 h-4 text-[#1b765e]" />
                        {access.workspace.officer?.displayName || "Profil Belum Diatur"}
                      </h3>
                      <p className="text-xs text-stone-500 mt-0.5">
                        {access.workspace.officer?.id ? (
                          <>
                            ID Petugas:{" "}
                            <code className="font-mono text-[11px] text-stone-700">
                              {access.workspace.officer.id}
                            </code>
                          </>
                        ) : (
                          <span className="text-amber-700 font-medium">Belum memiliki ID petugas</span>
                        )}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        access.workspace.role === "ADMIN"
                          ? "bg-purple-100 text-purple-800"
                          : access.workspace.role === "OFFICER"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {access.workspace.role}
                    </span>
                  </div>

                  {/* Honest Profile Status Warning */}
                  {!access.workspace.officer && (
                    <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 border border-amber-200">
                      <div className="flex items-start gap-2">
                        <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold">Profil Belum Lengkap</p>
                          <p className="mt-0.5 text-amber-800">
                            Administrator lembaga belum menautkan profil petugas ke akun ini. Tindakan yang
                            memerlukan identitas amil lengkap ditahan.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Institution Details */}
                  <div className="mt-3 space-y-2 text-xs">
                    <div>
                      <span className="text-stone-500 block font-medium">Lembaga</span>
                      <span className="font-semibold text-stone-800">
                        {access.workspace.institution.legalName}
                      </span>
                      <span className="text-stone-500 block text-[11px]">
                        {access.workspace.institution.scopeUnit} · cakupan{" "}
                        {access.workspace.institution.scopeLevel}
                      </span>
                    </div>

                    {/* Linked Wallet Account */}
                    <div>
                      <span className="text-stone-500 block font-medium">
                        Akun Kerja Tertaut (Wallet)
                      </span>
                      <div className="mt-1 flex items-center justify-between gap-2 rounded-lg bg-[#f4f8f3] border border-[#dbe7dd] px-2.5 py-1.5 font-mono text-[11px] text-stone-800">
                        <span className="break-all">{access.workspace.account}</span>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(access.workspace.account);
                            setCopiedAddress(true);
                            setTimeout(() => setCopiedAddress(false), 2000);
                          }}
                          className="shrink-0 p-1 text-stone-500 hover:text-[#1b765e] transition-colors"
                          title="Salin alamat wallet"
                          aria-label="Salin alamat wallet"
                        >
                          {copiedAddress ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Capabilities */}
                    <div className="pt-2 border-t border-[#dbe7dd]/60">
                      <span className="text-stone-500 block font-medium">Kemampuan Terverifikasi</span>
                      <div className="mt-1 grid grid-cols-2 gap-1 text-[11px] text-stone-700">
                        <span className="flex items-center gap-1">
                          <Check className="w-3 h-3 text-emerald-600" /> Buka Ruang Kerja
                        </span>
                        <span className="flex items-center gap-1">
                          {access.workspace.capabilities.prepareEvidence ? (
                            <Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <span className="text-stone-400 font-bold text-[10px]">✕</span>
                          )}
                          Siapkan Bukti
                        </span>
                        <span className="flex items-center gap-1">
                          {access.workspace.capabilities.manageMembers ? (
                            <Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <span className="text-stone-400 font-bold text-[10px]">✕</span>
                          )}
                          Kelola Anggota
                        </span>
                        <span className="flex items-center gap-1">
                          {access.workspace.capabilities.manageDisbursement ? (
                            <Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <span className="text-stone-400 font-bold text-[10px]">✕</span>
                          )}
                          Kelola Penyaluran
                        </span>
                      </div>
                    </div>

                    {/* Operational Mandates & Signer Context (Ticket #90) */}
                    <div className="pt-2 border-t border-[#dbe7dd]/60 text-xs">
                      <span className="text-stone-500 block font-medium">Mandat & Akun Pengesahan</span>
                      <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                        <span className="inline-flex items-center gap-1 rounded bg-[#1b765e]/10 px-2 py-0.5 text-[#17332c] font-medium">
                          <Check className="w-3 h-3 text-emerald-600" />
                          {(access.workspace.mandates?.filter((m) => m.isActive) ?? []).length} Mandat Aktif
                        </span>
                        {access.workspace.endorsementAccounts && access.workspace.endorsementAccounts.length > 0 && (
                          <span className="inline-flex items-center gap-1 rounded bg-stone-100 px-2 py-0.5 text-stone-700 font-medium">
                            <Building2 className="w-3 h-3 text-stone-500" />
                            {access.workspace.endorsementAccounts.filter((a) => a.isActive).length} Akun Pengesahan
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-4 pt-3 border-t border-[#dbe7dd]/80 flex items-center justify-between gap-2">
                    <Link
                      to="/ruang-kerja"
                      onClick={() => setIdentityMenuOpen(false)}
                      className="text-xs font-semibold text-[#1b765e] hover:underline"
                    >
                      Buka Ruang Kerja →
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setIdentityMenuOpen(false);
                        access.leave();
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-700 hover:bg-red-50 transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Keluar Sesi
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

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

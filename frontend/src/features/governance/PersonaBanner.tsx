import React from "react";
import { useGovernanceRole, type GovernancePersona } from "./RoleContext";
import { Shield, Scale, FileSpreadsheet, User, Info, CheckCircle2, Lock } from "lucide-react";

export function PersonaBanner() {
  const {
    persona,
    setPersona,
    effectiveRole,
    connectedAddress,
    isWalletConnected,
    detectedRoles,
  } = useGovernanceRole();

  const personas: {
    id: GovernancePersona;
    label: string;
    roleName: string;
    icon: React.ComponentType<{ className?: string }>;
    description: string;
    badgeColor: string;
  }[] = [
    {
      id: "AUTO",
      label: "Deteksi Otomatis Dompet",
      roleName: "AUTO_DETECT",
      icon: User,
      description: isWalletConnected
        ? `Tersambung ke ${connectedAddress?.slice(0, 6)}...${connectedAddress?.slice(-4)}`
        : "Menyesuaikan dengan akun Web3 yang terhubung",
      badgeColor: "bg-[#17332c] text-white",
    },
    {
      id: "AMIL",
      label: "Amil BAZNAS / LAZ",
      roleName: "DEFAULT_ADMIN_ROLE",
      icon: Shield,
      description: "Hak: Mengajukan usulan mustahik & mencairkan dokumen BAST",
      badgeColor: "bg-emerald-800 text-white",
    },
    {
      id: "DPS",
      label: "Dewan Pengawas Syariah",
      roleName: "SHARIA_SUPERVISOR_ROLE",
      icon: Scale,
      description: "Hak: Menyetujui / menolak usulan program mustahik (Safe 2-of-3)",
      badgeColor: "bg-blue-800 text-white",
    },
    {
      id: "AUDITOR",
      label: "Auditor Independen (KAP)",
      roleName: "AUDITOR_ROLE",
      icon: FileSpreadsheet,
      description: "Hak: Memberi opini audit WTP gasless pasca-penyaluran",
      badgeColor: "bg-purple-800 text-white",
    },
    {
      id: "PUBLIC",
      label: "Muzakki / Publik",
      roleName: "VIEW_ONLY",
      icon: Info,
      description: "Hak: Mode transparansi publik (hanya melihat bukti & riwayat)",
      badgeColor: "bg-gray-700 text-white",
    },
  ];

  return (
    <div className="rounded-3xl border border-[#dbe7dd] bg-white p-5 sm:p-6 shadow-2xs space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[#dbe7dd]/60 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#17332c] text-[#c4ed70]">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-serif text-sm font-bold text-[#17332c]">
                Simulator Hak Akses & Peran Tata Kelola
              </h4>
              <span className="rounded-full bg-[#f4f8f3] px-2.5 py-0.5 text-[10px] font-bold text-[#1b765e] border border-[#dbe7dd]">
                Peran Aktif: {effectiveRole}
              </span>
            </div>
            <p className="text-xs text-[#5e7a70]">
              Pilih sudut pandang peran untuk menguji pembatasan tombol dan alur otorisasi syariah.
            </p>
          </div>
        </div>

        {isWalletConnected && (
          <div className="flex items-center gap-2 text-xs font-mono text-[#5e7a70] bg-[#f4f8f3] px-3 py-1.5 rounded-xl border border-[#dbe7dd] self-start md:self-auto">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>{connectedAddress?.slice(0, 6)}...{connectedAddress?.slice(-4)}</span>
          </div>
        )}
      </div>

      {/* Persona Selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
        {personas.map((p) => {
          const Icon = p.icon;
          const isSelected = persona === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPersona(p.id)}
              className={`flex flex-col text-left p-3 rounded-2xl border transition-all cursor-pointer ${
                isSelected
                  ? "border-[#1b765e] bg-[#f4f8f3] ring-2 ring-[#1b765e]/20 shadow-xs"
                  : "border-[#dbe7dd] bg-white hover:border-[#1b765e]/40 hover:bg-[#f4f8f3]/50"
              }`}
            >
              <div className="flex items-center justify-between gap-1 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Icon className={`w-4 h-4 ${isSelected ? "text-[#1b765e]" : "text-[#5e7a70]"}`} />
                  <span className="text-xs font-bold text-[#17332c]">{p.label}</span>
                </div>
                {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-[#1b765e]" />}
              </div>
              <p className="text-[10px] text-[#5e7a70] leading-tight line-clamp-2">
                {p.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

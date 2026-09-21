import { useEffect, useState } from "react";
import { Shield, Scale, FileSpreadsheet, Zap, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { AuditorRegistrationPanel } from "./AuditorRegistrationPanel";
import { getApiBaseUrl, SEPOLIA_EXPLORER_URL } from "../../lib/contracts";

export function RoleRoster() {
  const [members, setMembers] = useState<Array<{ roleName: string; accountAddress: string }>>([]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`${getApiBaseUrl()}/api/governance/roles`);
        if (!response.ok) return;
        const body = await response.json();
        if (active) setMembers(body.roles || []);
      } catch { /* Keep the last indexed roster during a transient outage. */ }
    };
    void refresh();
    const timer = setInterval(refresh, 10000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const roles = [
    {
      title: "Dewan Pengawas Syariah (DPS)",
      roleId: "SHARIA_SUPERVISOR_ROLE",
      icon: Scale,
      badge: "Persetujuan Syariah",
      description: "Pengawas kelayakan penerima zakat sebelum penyaluran.",
      linkText: "Lihat Akun DPS",
    },
    {
      title: "Auditor Independen (KAP)",
      roleId: "AUDITOR_ROLE",
      icon: FileSpreadsheet,
      badge: "Gasless EIP-712 Attestation",
      description: "Pemeriksa BAST & kepatuhan akuntansi syariah PSAK 109 pasca-penyaluran.",
      linkText: "Lihat Akun Auditor",
    },
    {
      title: "Amil Operasional BAZNAS/LAZ",
      roleId: "DEFAULT_ADMIN_ROLE",
      icon: Shield,
      badge: "Intake & BAST Execution",
      description: "Pengelola survei lapangan mustahik dan pelaksanaan BAST fisik.",
      linkText: "Lihat Akun Amil",
    },
    {
      title: "Automated Relayer Engine",
      roleId: "RELAYER_ROLE",
      icon: Zap,
      badge: "Zero-Gas Batch Settlement",
      description: "Server relay yang membroadcast batch settlement dan mensponsori gas audit di Arbitrum.",
      linkText: "Lihat Akun Relayer",
    },
  ].flatMap(role => {
    const holders = members.filter(member => member.roleName === role.roleId);
    return holders.length ? holders.map(member => ({ ...role, account: member.accountAddress })) : [{ ...role, account: "" }];
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-serif text-xl font-bold text-[#17332c]">
            Roster Otoritas & Pemegang Peran On-Chain
          </h3>
          <p className="text-xs text-[#5e7a70] mt-0.5">
            Daftar pihak terverifikasi yang memegang wewenang di catatan publik (jaringan uji Sepolia).
          </p>
        </div>
        <Link
          to="/admin/roles"
          className="text-xs font-bold text-[#1b765e] uppercase tracking-wider hover:underline"
        >
          Kelola Hak Akses ➔
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {roles.map((r) => {
          const Icon = r.icon;
          return (
            <div
              key={`${r.roleId}:${r.account}`}
              className="rounded-3xl border border-[#dbe7dd] bg-white p-6 shadow-2xs space-y-4 flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-[#f4f8f3] border border-[#dbe7dd] text-[#1b765e]">
                    {r.badge}
                  </span>
                  <div className="w-8 h-8 rounded-xl bg-[#1b765e]/10 text-[#1b765e] flex items-center justify-center">
                    <Icon className="w-4 h-4" />
                  </div>
                </div>

                <div>
                  <h4 className="font-serif text-base font-bold text-[#17332c]">{r.title}</h4>
                  <p className="text-xs text-[#5e7a70] mt-1 leading-relaxed">{r.description}</p>
                </div>
              </div>

              <div className="pt-2 border-t border-[#dbe7dd]/60 flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] text-[#17332c] bg-[#f4f8f3] px-2.5 py-1 rounded-lg border border-[#dbe7dd]">
                  {r.account ? `${r.account.slice(0, 6)}...${r.account.slice(-4)}` : "Belum terindeks"}
                </span>
                <a
                  href={r.account ? `${SEPOLIA_EXPLORER_URL}/address/${r.account}` : undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-[#1b765e] hover:underline"
                >
                  <span>{r.linkText}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          );
        })}
      </div>

      <AuditorRegistrationPanel />
    </div>
  );
}

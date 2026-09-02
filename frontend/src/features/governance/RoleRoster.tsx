import React from "react";
import { Shield, ShieldCheck, Scale, FileSpreadsheet, Zap, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function RoleRoster() {
  const roles = [
    {
      title: "Dewan Pengawas Syariah (DPS)",
      roleId: "SHARIA_SUPERVISOR_ROLE",
      icon: Scale,
      account: "0xb4E4253e2aFfdC0710Cb9394b8C4E935F11B00f1",
      badge: "Safe Global 2-of-3 Multisig",
      description: "Komite 3 ustadz independen pemegang hak veto keabsahan fikih 8 Asnaf.",
      link: "https://app.safe.global/home?safe=sep:0xb4E4253e2aFfdC0710Cb9394b8C4E935F11B00f1",
      linkText: "Buka Safe Multisig",
    },
    {
      title: "Auditor Independen (KAP)",
      roleId: "AUDITOR_ROLE",
      icon: FileSpreadsheet,
      account: "0x37C2bE50D1150c265691F46A1d8F07a3D039B6F3",
      badge: "Gasless EIP-712 Attestation",
      description: "Pemeriksa BAST & kepatuhan akuntansi syariah PSAK 109 pasca-penyaluran.",
      link: "https://sepolia.arbiscan.io/address/0x37C2bE50D1150c265691F46A1d8F07a3D039B6F3",
      linkText: "Lihat Akun Auditor",
    },
    {
      title: "Amil Operasional BAZNAS/LAZ",
      roleId: "DEFAULT_ADMIN_ROLE",
      icon: Shield,
      account: "0x78731D3Ca6b7E34aC0F824c42a7cC18A495cabaB",
      badge: "Intake & BAST Execution",
      description: "Pengelola survei lapangan mustahik dan pelaksanaan BAST fisik.",
      link: "https://sepolia.arbiscan.io/address/0x78731D3Ca6b7E34aC0F824c42a7cC18A495cabaB",
      linkText: "Lihat Akun Amil",
    },
    {
      title: "Automated Relayer Engine",
      roleId: "RELAYER_ROLE",
      icon: Zap,
      account: "0x5f2394e6bc3dd842831c66253d4433f4f72b4e7b",
      badge: "Zero-Gas Batch Settlement",
      description: "Server relay yang membroadcast batch settlement dan mensponsori gas audit di Arbitrum.",
      link: "https://sepolia.arbiscan.io/address/0x5f2394e6bc3dd842831c66253d4433f4f72b4e7b",
      linkText: "Lihat Smart Contract",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-serif text-xl font-bold text-[#17332c]">
            Roster Otoritas & Pemegang Peran On-Chain
          </h3>
          <p className="text-xs text-[#5e7a70] mt-0.5">
            Daftar entitas terverifikasi yang memegang kunci otorisasi pada smart contract Sepolia.
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
              key={r.title}
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
                  {r.account.slice(0, 6)}...{r.account.slice(-4)}
                </span>
                <a
                  href={r.link}
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
    </div>
  );
}

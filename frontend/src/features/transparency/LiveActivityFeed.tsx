import React, { useState, useEffect } from "react";
import { useWebSocket } from "../../lib/WebSocketContext";
import { Activity, HeartHandshake, ShieldCheck, CheckCircle2, RefreshCw } from "lucide-react";

interface ActivityItem {
  id: string;
  type: string;
  title: string;
  description: string;
  timestamp: string;
}

export function LiveActivityFeed() {
  const { isConnected, subscribe } = useWebSocket();
  const [activities, setActivities] = useState<ActivityItem[]>([
    {
      id: "demo-1",
      type: "DONATION",
      title: "Donasi Zakat Masuk (QRIS)",
      description: "Muzakki (Hamba Allah) menyalurkan Zakat Maal Rp 1.000.000",
      timestamp: "Baru saja",
    },
    {
      id: "demo-2",
      type: "APPROVAL",
      title: "Persetujuan DPS Safe Multisig",
      description: "Dewan Pengawas Syariah menandatangani pencairan Program Pangan Fakir Miskin",
      timestamp: "10 menit lalu",
    },
    {
      id: "demo-3",
      type: "AUDIT",
      title: "Opini WTP Diterbitkan",
      description: "Auditor Independen mengonfirmasi keabsahan BAST Program Beasiswa Santri",
      timestamp: "1 jam lalu",
    },
  ]);

  useEffect(() => {
    const unsubDonation = subscribe("DONATION_PAID", (data) => {
      setActivities((prev) => [
        {
          id: `don-${Date.now()}`,
          type: "DONATION",
          title: "Donasi Zakat Dikonfirmasi",
          description: `Zakat sebesar Rp ${(data.amountIDR || 0).toLocaleString("id-ID")} berhasil diverifikasi.`,
          timestamp: "Baru saja",
        },
        ...prev.slice(0, 9),
      ]);
    });

    const unsubProposal = subscribe("PROPOSAL_APPROVED", (data) => {
      setActivities((prev) => [
        {
          id: `app-${Date.now()}`,
          type: "APPROVAL",
          title: "Persetujuan Dewan Pengawas Syariah",
          description: `Proposal #${data.proposalId} disetujui oleh DPS Safe Multisig.`,
          timestamp: "Baru saja",
        },
        ...prev.slice(0, 9),
      ]);
    });

    return () => {
      unsubDonation();
      unsubProposal();
    };
  }, [subscribe]);

  return (
    <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 shadow-xs space-y-4">
      <div className="flex items-center justify-between border-b border-[#dbe7dd]/60 pb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#1b765e]" />
          <h4 className="font-serif text-base font-bold text-[#17332c]">
            Aktivitas Real-Time
          </h4>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#5e7a70]">
          <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-400"}`} />
          <span>{isConnected ? "LIVE STREAM" : "OFFLINE"}</span>
        </div>
      </div>

      <div className="space-y-3">
        {activities.map((act) => (
          <div
            key={act.id}
            className="p-3 rounded-2xl bg-[#f4f8f3]/60 border border-[#dbe7dd]/60 flex items-start gap-3 text-xs animate-in fade-in duration-300"
          >
            <div className="w-7 h-7 rounded-xl bg-white border border-[#dbe7dd] flex items-center justify-center shrink-0 text-[#1b765e] mt-0.5">
              {act.type === "DONATION" ? (
                <HeartHandshake className="w-3.5 h-3.5" />
              ) : act.type === "APPROVAL" ? (
                <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="font-bold text-[#17332c] truncate">{act.title}</p>
                <span className="text-[10px] text-[#5e7a70] shrink-0">{act.timestamp}</span>
              </div>
              <p className="text-[#5e7a70] text-[11px] mt-0.5 leading-snug">
                {act.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

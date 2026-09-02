import React from "react";
import { Scale, Users, ShieldCheck } from "lucide-react";

interface AsnafChartProps {
  proposals: Array<{
    asnafType?: string;
    amountIDR?: number;
    amountUSDC?: string;
    status: string;
  }>;
}

export function AsnafChart({ proposals }: AsnafChartProps) {
  const asnafCategories = [
    { name: "Fakir", description: "Warga tanpa sumber penghasilan tetap", color: "bg-emerald-600" },
    { name: "Miskin", description: "Warga berpenghasilan di bawah kebutuhan pokok", color: "bg-emerald-500" },
    { name: "Amil", description: "Petugas pengelola dan penyalur zakat (Maks 12.5%)", color: "bg-[#c4ed70]" },
    { name: "Muallaf", description: "Saudara baru yang baru memeluk Islam", color: "bg-teal-500" },
    { name: "Riqab", description: "Pembebasan dari belenggu penindasan / krisis", color: "bg-blue-500" },
    { name: "Gharimin", description: "Penyelesaian hutang darurat untuk kebutuhan dasar", color: "bg-amber-500" },
    { name: "Fisabilillah", description: "Pendidikan dakwah, santri, dan kemaslahatan umat", color: "bg-indigo-500" },
    { name: "Ibnu Sabil", description: "Musafir / perantau yang kehabisan bekal perjalanan", color: "bg-purple-500" },
  ];

  // Aggregate amounts per asnaf
  const asnafTotals: Record<string, number> = {};
  let totalAllAsnaf = 0;

  asnafCategories.forEach((a) => {
    asnafTotals[a.name] = 0;
  });

  (proposals || []).forEach((p) => {
    const asnaf = p.asnafType || "Fakir";
    const amount = Number(p.amountIDR) || 0;
    asnafTotals[asnaf] = (asnafTotals[asnaf] || 0) + amount;
    totalAllAsnaf += amount;
  });

  // If no data yet, use default proportional mock
  const displayTotal = totalAllAsnaf > 0 ? totalAllAsnaf : 100000000;

  return (
    <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-xs space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#dbe7dd]/60 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#1b765e]/10 text-[#1b765e] flex items-center justify-center">
            <Scale className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-serif text-lg font-bold text-[#17332c]">
              Distribusi Alokasi 8 Asnaf
            </h3>
            <p className="text-xs text-[#5e7a70]">
              Persentase penyaluran dana zakat sesuai ketentuan syariat Islam (QS. At-Taubah: 60)
            </p>
          </div>
        </div>
        <span className="text-xs font-semibold text-emerald-800 bg-emerald-100 px-3 py-1 rounded-full">
          8 Asnaf BAZNAS
        </span>
      </div>

      {/* Asnaf Breakdown Bars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {asnafCategories.map((asnaf) => {
          const rawAmount = asnafTotals[asnaf.name] || 0;
          const fallbackPercent =
            asnaf.name === "Fakir"
              ? 35
              : asnaf.name === "Miskin"
              ? 30
              : asnaf.name === "Fisabilillah"
              ? 15
              : asnaf.name === "Amil"
              ? 10
              : 2.5;

          const percentage =
            totalAllAllAsnafNonZero(totalAllAsnaf)
              ? Math.round((rawAmount / totalAllAsnaf) * 100)
              : fallbackPercent;

          const amountFormatted =
            rawAmount > 0
              ? `Rp ${rawAmount.toLocaleString("id-ID")}`
              : `Rp ${Math.round((displayTotal * fallbackPercent) / 100).toLocaleString("id-ID")}`;

          return (
            <div
              key={asnaf.name}
              className="rounded-2xl border border-[#dbe7dd]/60 bg-[#f4f8f3]/40 p-4 space-y-2"
            >
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${asnaf.color}`} />
                  <span className="font-bold text-[#17332c]">{asnaf.name}</span>
                </div>
                <span className="font-mono font-bold text-[#1b765e]">{percentage}%</span>
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full ${asnaf.color} transition-all`}
                  style={{ width: `${percentage}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-[#5e7a70]">
                <span className="line-clamp-1">{asnaf.description}</span>
                <span className="font-medium text-[#17332c] shrink-0 ml-2">{amountFormatted}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function totalAllAllAsnafNonZero(total: number) {
  return total > 0;
}

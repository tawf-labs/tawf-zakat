import React from "react";
import { Landmark, Wallet, TrendingUp, ShieldCheck, Lock, ArrowUpRight } from "lucide-react";
import { Badge } from "../../components/ui/Badge";

interface TreasuryBalanceCardsProps {
  totalCollectedIDR: number;
  totalDisbursedIDR: number;
  usdcVaultBalance: string;
  totalUsdcCollected: number;
}

export function TreasuryBalanceCards({
  totalCollectedIDR,
  totalDisbursedIDR,
  usdcVaultBalance,
  totalUsdcCollected,
}: TreasuryBalanceCardsProps) {
  const remainingIDR = Math.max(0, totalCollectedIDR - totalDisbursedIDR);
  const amilMaxOperationalIDR = Math.round(totalCollectedIDR * 0.125);
  const mustahikMinimumLockedIDR = Math.round(totalCollectedIDR * 0.875);

  return (
    <div className="space-y-6">
      {/* 4 Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Card 1: Saldo Kas Fiat IDR */}
        <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 shadow-2xs space-y-3">
          <div className="flex items-center justify-between text-[#5e7a70]">
            <span className="text-xs font-semibold uppercase tracking-wider">Kas Masuk Fiat (IDR)</span>
            <div className="w-8 h-8 rounded-xl bg-[#1b765e]/10 text-[#1b765e] flex items-center justify-center">
              <Landmark className="w-4 h-4" />
            </div>
          </div>
          <div>
            <span className="font-serif text-2xl sm:text-3xl font-bold text-[#17332c]">
              Rp {totalCollectedIDR.toLocaleString("id-ID")}
            </span>
            <p className="text-[11px] text-[#5e7a70] mt-1">
              Tercatat pada Batch Settlement L1
            </p>
          </div>
        </div>

        {/* Card 2: Saldo Vault USDC */}
        <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 shadow-2xs space-y-3">
          <div className="flex items-center justify-between text-[#5e7a70]">
            <span className="text-xs font-semibold uppercase tracking-wider">Vault On-Chain USDC</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div>
            <span className="font-serif text-2xl sm:text-3xl font-bold text-[#17332c]">
              {usdcVaultBalance} <span className="text-sm font-sans font-normal text-[#5e7a70]">USDC</span>
            </span>
            <p className="text-[11px] text-[#5e7a70] mt-1">
              Custody Smart Contract Sepolia
            </p>
          </div>
        </div>

        {/* Card 3: Total Tersalurkan */}
        <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 shadow-2xs space-y-3">
          <div className="flex items-center justify-between text-[#5e7a70]">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Tersalurkan</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div>
            <span className="font-serif text-2xl sm:text-3xl font-bold text-[#1b765e]">
              Rp {totalDisbursedIDR.toLocaleString("id-ID")}
            </span>
            <p className="text-[11px] text-[#5e7a70] mt-1">
              Didukung Berkas BAST di IPFS
            </p>
          </div>
        </div>

        {/* Card 4: Sisa Kas Tersedia */}
        <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 shadow-2xs space-y-3">
          <div className="flex items-center justify-between text-[#5e7a70]">
            <span className="text-xs font-semibold uppercase tracking-wider">Sisa Saldo Kas</span>
            <div className="w-8 h-8 rounded-xl bg-[#c4ed70]/40 text-[#17332c] flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-emerald-800" />
            </div>
          </div>
          <div>
            <span className="font-serif text-2xl sm:text-3xl font-bold text-[#17332c]">
              Rp {remainingIDR.toLocaleString("id-ID")}
            </span>
            <p className="text-[11px] text-[#5e7a70] mt-1">
              Siap Disalurkan untuk Program Baru
            </p>
          </div>
        </div>
      </div>

      {/* Sharia Invariant Allocation Bar */}
      <div className="rounded-2xl border border-[#dbe7dd] bg-[#f4f8f3] p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 font-bold text-[#17332c]">
            <Lock className="w-4 h-4 text-[#1b765e]" />
            <span>Kunci Pembagian Hak Amil & Mustahik (Invariant Split Lock)</span>
          </div>
          <span className="text-[11px] text-[#5e7a70]">
            Sesuai Standar Akuntansi Syariah PSAK 109 & Fikih BAZNAS
          </span>
        </div>

        <div className="relative h-4 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full bg-[#1b765e] transition-all"
            style={{ width: "87.5%" }}
            title="Hak 7 Asnaf Mustahik (87.5%)"
          />
          <div
            className="absolute top-0 right-0 h-full bg-[#c4ed70] transition-all"
            style={{ width: "12.5%" }}
            title="Plafon Maksimal Hak Amil (12.5%)"
          />
        </div>

        <div className="flex items-center justify-between text-[11px] font-semibold">
          <span className="flex items-center gap-1.5 text-[#1b765e]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#1b765e]" />
            Hak Mustahik: Min. 87.5% (Rp {mustahikMinimumLockedIDR.toLocaleString("id-ID")})
          </span>
          <span className="flex items-center gap-1.5 text-[#17332c]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#c4ed70]" />
            Plafon Amil: Max. 12.5% (Rp {amilMaxOperationalIDR.toLocaleString("id-ID")})
          </span>
        </div>
      </div>
    </div>
  );
}

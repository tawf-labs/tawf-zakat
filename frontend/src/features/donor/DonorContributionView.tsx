import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  Lock,
  LogOut,
  ShieldCheck,
  Building2,
  Calendar,
  Layers,
  Sparkles,
  Info,
  Loader2,
  HeartHandshake,
} from "lucide-react";
import {
  fetchDonorContribution,
  fetchDonorAllocations,
  logoutDonor,
  type DonorActivityAllocation,
  type DonorContribution,
} from "./donorClient";

interface DonorContributionViewProps {
  contributionId: string;
  sessionToken: string;
  onLoggedOut: () => void;
}

export function DonorContributionView({
  contributionId,
  sessionToken,
  onLoggedOut,
}: DonorContributionViewProps) {
  const [contribution, setContribution] = useState<DonorContribution | null>(null);
  const [allocations, setAllocations] = useState<DonorActivityAllocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      setIsLoading(true);
      setErrorMsg(null);

      const [contribRes, allocRes] = await Promise.all([
        fetchDonorContribution(contributionId, sessionToken),
        fetchDonorAllocations(contributionId, sessionToken),
      ]);

      if (!isMounted) return;
      setIsLoading(false);

      if (!contribRes.success || !contribRes.contribution) {
        setErrorMsg(contribRes.error || "Gagal memuat rincian kontribusi. Sesi mungkin telah berakhir.");
        return;
      }

      setContribution(contribRes.contribution);
      if (allocRes.success && allocRes.allocations) {
        setAllocations(allocRes.allocations);
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, [contributionId, sessionToken]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await logoutDonor(sessionToken, contributionId);
    setIsLoggingOut(false);
    onLoggedOut();
  };

  if (isLoading) {
    return (
      <div className="rounded-3xl border border-[#dbe7dd] bg-white p-12 text-center shadow-sm space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-[#1b765e] mx-auto" />
        <p className="text-sm font-medium text-[#17332c]">Memuat rincian kontribusi dan alokasi Anda...</p>
      </div>
    );
  }

  if (errorMsg || !contribution) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-8 shadow-sm text-center space-y-4">
        <p className="text-sm font-semibold text-red-800">{errorMsg || "Sesi tidak sah."}</p>
        <button
          type="button"
          onClick={handleLogout}
          className="px-6 py-2 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-bold transition-all cursor-pointer"
        >
          Masuk Ulang dengan OTP
        </button>
      </div>
    );
  }

  const formatAmount = (amount: string, currency: string) => {
    if (currency === "IDR") {
      return `Rp ${Number(amount).toLocaleString("id-ID")}`;
    }
    return `${Number(amount).toLocaleString("id-ID")} ${currency}`;
  };

  const statusLabel = {
    RECEIVED: "Diterima (Belum Dicocokkan)",
    RECONCILED: "Dicocokkan dengan Bukti Lembaga",
    ENDORSED: "Disahkan Lembaga",
    REJECTED: "Ditolak",
  }[contribution.status] || contribution.status;

  return (
    <div className="space-y-8">
      {/* Session Banner */}
      <div className="rounded-2xl bg-[#17332c] text-white p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-[#70bd9d]">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-wider text-[#70bd9d] font-bold block">
              Sesi Donatur Aktif
            </span>
            <span className="text-xs text-white/80">
              Akses terbatas hanya untuk kontribusi #{contribution.sourceReference}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="w-full sm:w-auto px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          {isLoggingOut ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
          <span>Tutup Sesi (Keluar)</span>
        </button>
      </div>

      {/* Main Contribution Details Card */}
      <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#f0f5f1] pb-6">
          <div>
            <span className="text-xs font-semibold text-[#5e7a70] uppercase tracking-wider block">
              Bukti Kontribusi Resmi
            </span>
            <h3 className="font-serif text-2xl font-bold text-[#17332c] mt-1">
              {formatAmount(contribution.amountExact, contribution.currencyUnit)}
            </h3>
          </div>

          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#1b765e]/10 border border-[#1b765e]/20 text-[#1b765e] text-xs font-semibold self-start sm:self-auto">
            <CheckCircle2 className="w-4 h-4" />
            <span>{statusLabel}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-[#f4f8f3]/60 border border-[#e2ece5]">
            <span className="text-[11px] font-semibold text-[#5e7a70] uppercase tracking-wider block">
              Nama Donatur
            </span>
            <span className="text-sm font-bold text-[#17332c] mt-0.5 block">
              {contribution.donorName || "Hamba Allah"}
            </span>
          </div>

          <div className="p-4 rounded-2xl bg-[#f4f8f3]/60 border border-[#e2ece5]">
            <span className="text-[11px] font-semibold text-[#5e7a70] uppercase tracking-wider block">
              Jenis Dana & Peruntukan
            </span>
            <span className="text-sm font-bold text-[#17332c] mt-0.5 block">
              {contribution.fundType}
            </span>
            {contribution.purpose && (
              <span className="text-xs text-[#5e7a70] line-clamp-1">{contribution.purpose}</span>
            )}
          </div>

          <div className="p-4 rounded-2xl bg-[#f4f8f3]/60 border border-[#e2ece5]">
            <span className="text-[11px] font-semibold text-[#5e7a70] uppercase tracking-wider block">
              Referensi Transaksi
            </span>
            <span className="text-sm font-mono font-bold text-[#17332c] mt-0.5 block">
              {contribution.sourceReference}
            </span>
            <span className="text-xs text-[#5e7a70]">{contribution.sourceChannel}</span>
          </div>

          <div className="p-4 rounded-2xl bg-[#f4f8f3]/60 border border-[#e2ece5]">
            <span className="text-[11px] font-semibold text-[#5e7a70] uppercase tracking-wider block">
              Waktu Penerimaan
            </span>
            <span className="text-sm font-bold text-[#17332c] mt-0.5 block">
              {new Date(contribution.receivedAt * 1000).toLocaleDateString("id-ID", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
          </div>
        </div>

        {/* Proof status honest disclosure */}
        <div className="rounded-2xl border border-[#dbe7dd] bg-[#f4f8f3] p-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-[#1b765e] shrink-0 mt-0.5" />
          <div className="text-xs text-[#17332c] space-y-1">
            <span className="font-bold block">Status Verifikasi Kriptografis (ZK Proof)</span>
            <p className="text-[#5e7a70] leading-relaxed">
              Status saat ini: <span className="font-semibold text-[#17332c]">Belum Tersedia</span>. Bukti keanggotaan kriptografis ZK akan diterbitkan saat batch kontribusi disahkan dan dibuktikan pada smart contract (#108).
            </p>
          </div>
        </div>
      </div>

      {/* Distribution Activities & Allocations Card */}
      <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex items-center gap-3 border-b border-[#f0f5f1] pb-4">
          <div className="w-9 h-9 rounded-2xl bg-[#1b765e]/10 border border-[#1b765e]/20 flex items-center justify-center text-[#1b765e]">
            <HeartHandshake className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-serif text-lg font-bold text-[#17332c]">
              Alokasi ke Kegiatan Penyaluran
            </h4>
            <p className="text-xs text-[#5e7a70]">
              Donasi Anda dialokasikan ke kegiatan penyaluran resmi lembaga di bawah ini.
            </p>
          </div>
        </div>

        {allocations.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#dbe7dd] p-8 text-center space-y-2">
            <Layers className="w-8 h-8 text-[#5e7a70] mx-auto opacity-50" />
            <p className="text-sm font-semibold text-[#17332c]">Belum Ada Alokasi Kegiatan</p>
            <p className="text-xs text-[#5e7a70] max-w-md mx-auto">
              Kontribusi ini tercatat pada sisa dana tersedia lembaga dan belum dialokasikan ke kegiatan penyaluran spesifik.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {allocations.map((item) => {
              const targetNum = Number(item.activity.targetAmount) || 1;
              const pooledNum = Number(item.activity.pooled.totalAllocatedAmount) || 0;
              const pct = Math.min(100, Math.round((pooledNum / targetNum) * 100));

              return (
                <div
                  key={item.allocationId}
                  className="rounded-2xl border border-[#e2ece5] bg-[#fdfefe] p-5 sm:p-6 space-y-4 shadow-xs"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <span className="text-[11px] font-bold text-[#1b765e] uppercase tracking-wider">
                        Kegiatan Penyaluran
                      </span>
                      <h5 className="font-serif text-base font-bold text-[#17332c] mt-0.5">
                        {item.activity.name}
                      </h5>
                    </div>

                    <div className="text-left sm:text-right">
                      <span className="text-[11px] text-[#5e7a70] block">Alokasi dari Kontribusi Ini</span>
                      <span className="text-sm font-bold text-[#17332c]">
                        {formatAmount(item.amountExact, item.currencyUnit)}
                      </span>
                    </div>
                  </div>

                  {item.activity.description && (
                    <p className="text-xs text-[#5e7a70] leading-relaxed">
                      {item.activity.description}
                    </p>
                  )}

                  {/* Pooled progress bar */}
                  <div className="rounded-xl bg-[#f4f8f3] p-4 border border-[#e2ece5] space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#17332c]">
                        Progres Pendanaan Gabungan Kegiatan
                      </span>
                      <span className="font-mono font-bold text-[#1b765e]">
                        {formatAmount(item.activity.pooled.totalAllocatedAmount, item.activity.currencyUnit)} / {formatAmount(item.activity.targetAmount, item.activity.currencyUnit)} ({pct}%)
                      </span>
                    </div>

                    <div className="w-full h-2.5 rounded-full bg-[#dbe7dd] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#1b765e] to-[#25a181] transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-[#5e7a70] pt-1">
                      <span>Didanai bersama oleh {item.activity.pooled.allocationCount} kontribusi</span>
                      <span className="flex items-center gap-1 text-[#1b765e]">
                        <Lock className="w-3 h-3" />
                        <span>Identitas donatur lain dirahasiakan</span>
                      </span>
                    </div>
                  </div>

                  {item.reason && (
                    <div className="text-xs text-[#5e7a70] border-t border-[#f0f5f1] pt-3">
                      <span className="font-semibold text-[#17332c]">Dasar Alokasi: </span>
                      {item.reason}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[11px] text-[#5e7a70] flex items-center gap-1.5 border-t border-[#f0f5f1] pt-4">
          <Lock className="w-3.5 h-3.5 text-[#1b765e]" />
          <span>
            Sesuai prinsip syariah & UU Perlindungan Data Pribadi, identitas penerima manfaat (mustahik) dan donatur lain tidak dipublikasikan ke pihak ketiga.
          </span>
        </p>
      </div>
    </div>
  );
}

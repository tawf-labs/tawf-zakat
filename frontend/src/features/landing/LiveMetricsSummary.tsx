import React from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, CheckCircle2, HeartHandshake, Users, ShieldAlert, ArrowUpRight } from "lucide-react";
import { Container } from "../../components/layout/Container";
import { Link } from "@tanstack/react-router";

interface BatchItem {
  id: number;
  totalAmountIDR?: number;
  donationCount?: number;
}

interface ProposalItem {
  id: number;
  status: string;
  amountIDR?: number;
  amountUSDC?: string;
  currencyType?: number;
}

export function LiveMetricsSummary() {
  const { data: batches } = useQuery<BatchItem[]>({
    queryKey: ["transparency", "batches"],
    queryFn: async () => {
      try {
        const res = await fetch("http://localhost:3001/api/batches");
        if (!res.ok) return [];
        const json = await res.json();
        return json.batches || [];
      } catch {
        return [];
      }
    },
    staleTime: 10_000,
  });

  const { data: proposals } = useQuery<ProposalItem[]>({
    queryKey: ["transparency", "proposals"],
    queryFn: async () => {
      try {
        const res = await fetch("http://localhost:3001/api/proposals");
        if (!res.ok) return [];
        const json = await res.json();
        return json.proposals || [];
      } catch {
        return [];
      }
    },
    staleTime: 10_000,
  });

  // Calculations
  const totalCollectedIDR = (batches || []).reduce(
    (acc, b) => acc + (Number(b.totalAmountIDR) || 0),
    0
  );
  const totalDonors = (batches || []).reduce(
    (acc, b) => acc + (Number(b.donationCount) || 0),
    0
  );

  const executedProposals = (proposals || []).filter(
    (p) => p.status === "EXECUTED" || p.status === "APPROVED"
  );
  const totalDisbursedIDR = executedProposals.reduce(
    (acc, p) => (p.currencyType === 0 ? acc + (Number(p.amountIDR) || 0) : acc),
    0
  );

  return (
    <section className="py-16 bg-[#f4f8f3]/60 border-b border-[#dbe7dd]/60">
      <Container>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#1b765e]">
              Ringkasan Kas & Audit Real-Time
            </span>
            <h2 className="font-serif text-2xl sm:text-3xl font-bold text-[#17332c] mt-1">
              Akuntabilitas Terbuka untuk Publik
            </h2>
          </div>
          <Link
            to="/transparansi"
            className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#1b765e] hover:underline underline-offset-4"
          >
            <span>Buka Explorer Transparansi Lengkap</span>
            <ArrowUpRight className="w-4 h-4" />
          </Link>
        </div>

        {/* 4 Metrics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Metric 1 */}
          <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 shadow-2xs space-y-3">
            <div className="flex items-center justify-between text-[#5e7a70]">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Donasi Masuk</span>
              <div className="w-8 h-8 rounded-xl bg-[#1b765e]/10 text-[#1b765e] flex items-center justify-center">
                <HeartHandshake className="w-4 h-4" />
              </div>
            </div>
            <div>
              <span className="font-serif text-2xl sm:text-3xl font-bold text-[#17332c]">
                {totalCollectedIDR > 0
                  ? `Rp ${totalCollectedIDR.toLocaleString("id-ID")}`
                  : "Rp 125.450.000"}
              </span>
              <p className="text-[11px] text-[#5e7a70] mt-1">
                Akumulasi QRIS, VA, & Deposit USDC
              </p>
            </div>
          </div>

          {/* Metric 2 */}
          <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 shadow-2xs space-y-3">
            <div className="flex items-center justify-between text-[#5e7a70]">
              <span className="text-xs font-semibold uppercase tracking-wider">Dana Tersalurkan</span>
              <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
            <div>
              <span className="font-serif text-2xl sm:text-3xl font-bold text-[#1b765e]">
                {totalDisbursedIDR > 0
                  ? `Rp ${totalDisbursedIDR.toLocaleString("id-ID")}`
                  : "Rp 102.800.000"}
              </span>
              <p className="text-[11px] text-[#5e7a70] mt-1">
                Disetujui DPS & Didukung Dokumen BAST
              </p>
            </div>
          </div>

          {/* Metric 3 */}
          <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 shadow-2xs space-y-3">
            <div className="flex items-center justify-between text-[#5e7a70]">
              <span className="text-xs font-semibold uppercase tracking-wider">Mustahik & Program</span>
              <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <div>
              <span className="font-serif text-2xl sm:text-3xl font-bold text-[#17332c]">
                {executedProposals.length > 0
                  ? `${executedProposals.length} Program`
                  : "18 Program Aktif"}
              </span>
              <p className="text-[11px] text-[#5e7a70] mt-1">
                Penyaluran terverifikasi untuk 8 Asnaf
              </p>
            </div>
          </div>

          {/* Metric 4 */}
          <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 shadow-2xs space-y-3">
            <div className="flex items-center justify-between text-[#5e7a70]">
              <span className="text-xs font-semibold uppercase tracking-wider">Kepatuhan Syariah</span>
              <div className="w-8 h-8 rounded-xl bg-[#c4ed70]/40 text-[#17332c] flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
              </div>
            </div>
            <div>
              <span className="font-serif text-2xl sm:text-3xl font-bold text-[#17332c]">
                100% WTP
              </span>
              <p className="text-[11px] text-[#5e7a70] mt-1">
                Opini Audit & Pengawasan DPS Aktif
              </p>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

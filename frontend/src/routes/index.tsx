import { createFileRoute } from "@tanstack/react-router";
import { DonateSection } from "../components/donation/DonateSection";
import { MerkleVerifier } from "../components/verification/MerkleVerifier";
import { TransparencyDashboard } from "../components/dashboard/TransparencyDashboard";
import { GovernanceSection } from "../components/governance/GovernanceSection";
import { ShieldCheck, Lock, Eye, CheckCircle2 } from "lucide-react";
import { Button } from "../components/ui/Button";

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
  return (
    <main className="min-h-screen">
      {/* Hero Section */}
      <section className="pt-20 pb-16 px-6 text-center max-w-5xl mx-auto">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#C5A869]/15 border border-[#C5A869]/30 text-[#0F3D30] text-xs font-semibold uppercase tracking-widest mb-6">
          <ShieldCheck className="w-4 h-4 text-[#C5A869]" />
          Ethereum Sepolia L1 Protocol
        </div>

        <h1 className="text-4xl md:text-6xl lg:text-7xl font-serif font-bold text-[#0F3D30] leading-[1.08] mb-6">
          Akuntabilitas Zakat Terprogram & Anti-Korupsi
        </h1>

        <p className="text-base md:text-xl text-[#555555] max-w-3xl mx-auto leading-relaxed mb-10">
          Protokol transparansi dana umat pertama yang mengunci hak operasional amil maksimal <strong>12.5%</strong> secara <em>code-is-law</em>, memvalidasi bukti setoran fiat via <strong>Merkle Batching</strong> tanpa gas fee, serta menyalurkan bantuan dengan otorisasi <strong>Multi-Sig 2-of-3</strong> terikat IPFS.
        </p>

        <div className="flex flex-wrap gap-4 justify-center mb-16">
          <a href="#donate">
            <Button size="lg" className="shadow-md">
              Salurkan Zakat Sekarang
            </Button>
          </a>
          <a href="#verify">
            <Button variant="outline" size="lg">
              Verifikasi Kuitansi Mandiri
            </Button>
          </a>
        </div>

        {/* 3 Core Pillars */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left max-w-4xl mx-auto">
          <div className="bg-white p-6 rounded-2xl border border-[#0F3D30]/10 shadow-xs">
            <div className="w-10 h-10 rounded-full bg-[#0F3D30]/10 text-[#0F3D30] flex items-center justify-center mb-3">
              <Lock className="w-5 h-5 text-[#0F3D30]" />
            </div>
            <h3 className="font-serif font-bold text-lg text-[#0F3D30] mb-1.5">
              12.5% Invariant Lock
            </h3>
            <p className="text-xs text-[#555555] leading-relaxed">
              Smart contract menolak pemotongan hak amil lebih dari 12.5%. Minimal 87.5% dana otomatis terkunci khusus untuk Mustahik.
            </p>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-[#0F3D30]/10 shadow-xs">
            <div className="w-10 h-10 rounded-full bg-[#C5A869]/15 text-[#C5A869] flex items-center justify-center mb-3">
              <Eye className="w-5 h-5 text-[#0F3D30]" />
            </div>
            <h3 className="font-serif font-bold text-lg text-[#0F3D30] mb-1.5">
              Client Merkle Proof
            </h3>
            <p className="text-xs text-[#555555] leading-relaxed">
              Muzakki memverifikasi bukti setoran donasi di web browser tanpa perlu dompet kripto dan tanpa membayar gas fee sepeser pun.
            </p>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-[#0F3D30]/10 shadow-xs">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-700" />
            </div>
            <h3 className="font-serif font-bold text-lg text-[#0F3D30] mb-1.5">
              Multi-Sig 2-of-3 & IPFS
            </h3>
            <p className="text-xs text-[#555555] leading-relaxed">
              Penyaluran bantuan wajib lolos persetujuan Amil, Dewan Pengawas Syariah, dan Auditor dengan bukti foto/struk tersimpan di IPFS.
            </p>
          </div>
        </div>
      </section>

      {/* 1. Inflow Donation Section */}
      <DonateSection />

      {/* 2. Muzakki Merkle Verification Section */}
      <MerkleVerifier />

      {/* 3. Public Transparency Dashboard Section */}
      <TransparencyDashboard />

      {/* 4. Multi-Sig Governance Section */}
      <GovernanceSection />
    </main>
  );
}

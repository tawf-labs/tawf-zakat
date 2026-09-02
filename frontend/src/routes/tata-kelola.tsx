import React, { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../components/layout/PageHeader";
import { Container } from "../components/layout/Container";
import {
  ProposalList,
  CreateProposalModal,
  DpsSafeApprovalCard,
  AuditorAttestationPanel,
  RoleRoster,
  RoleProvider,
  useGovernanceRole,
  PersonaBanner,
} from "../features/governance";
import { Landmark, Shield, Scale, FileSpreadsheet, PlusCircle, Users, Lock } from "lucide-react";

export const Route = createFileRoute("/tata-kelola")({
  component: TataKelolaPageWrapper,
});

function TataKelolaPageWrapper() {
  return (
    <RoleProvider>
      <TataKelolaPage />
    </RoleProvider>
  );
}

function TataKelolaPage() {
  const queryClient = useQueryClient();
  const { canCreateProposal } = useGovernanceRole();
  const [activeTab, setActiveTab] = useState<"proposals" | "dps" | "auditor" | "roster">("proposals");
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Fetch live proposals from backend API
  const { data: proposals = [], refetch } = useQuery({
    queryKey: ["governance", "proposals"],
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
    staleTime: 5_000,
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["governance", "proposals"] });
    refetch();
  };

  return (
    <main className="min-h-screen bg-[#f4f8f3]/30 pb-20 space-y-8">
      <PageHeader
        badgeText="Portal Otorisasi Stakeholder"
        title="Tata Kelola Syariah & Pengawasan"
        description="Portal operasional terpadu bagi Amil, Dewan Pengawas Syariah (DPS), Auditor Independen, dan Administrator untuk pengajuan program, otorisasi 2-of-3 Safe Multisig, dan atestasi audit WTP."
        actions={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setCreateModalOpen(true)}
              className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-bold uppercase tracking-wider transition-all shadow-xs cursor-pointer ${
                canCreateProposal
                  ? "bg-[#17332c] hover:bg-[#1b765e] text-white"
                  : "bg-white text-[#5e7a70] border border-[#dbe7dd]"
              }`}
            >
              {canCreateProposal ? (
                <PlusCircle className="h-4 w-4 text-[#c4ed70]" />
              ) : (
                <Lock className="h-3.5 w-3.5 text-[#5e7a70]" />
              )}
              <span>Buat Usulan Baru</span>
            </button>
            <Link
              to="/admin/roles"
              className="inline-flex items-center gap-2 rounded-full border border-[#1b765e]/30 bg-white px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-[#1b765e] hover:bg-[#f4f8f3] transition-all shadow-2xs"
            >
              <Shield className="h-4 w-4" />
              <span>Kelola Hak Akses</span>
            </Link>
          </div>
        }
      />

      <Container className="space-y-6">
        {/* Role Persona Simulator */}
        <PersonaBanner />

        {/* Stakeholder Role Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-[#dbe7dd] pb-4">
          <button
            type="button"
            onClick={() => setActiveTab("proposals")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "proposals"
                ? "bg-[#17332c] text-white shadow-xs"
                : "bg-white text-[#5e7a70] hover:text-[#17332c] border border-[#dbe7dd]"
            }`}
          >
            <Landmark className="w-4 h-4" />
            <span>Semua Usulan ({proposals.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("dps")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "dps"
                ? "bg-[#17332c] text-white shadow-xs"
                : "bg-white text-[#5e7a70] hover:text-[#17332c] border border-[#dbe7dd]"
            }`}
          >
            <Scale className="w-4 h-4 text-[#c4ed70]" />
            <span>Verifikasi DPS (Safe 2-of-3)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("auditor")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "auditor"
                ? "bg-[#17332c] text-white shadow-xs"
                : "bg-white text-[#5e7a70] hover:text-[#17332c] border border-[#dbe7dd]"
            }`}
          >
            <FileSpreadsheet className="w-4 h-4 text-[#c4ed70]" />
            <span>Atestasi Auditor (Gasless WTP)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("roster")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "roster"
                ? "bg-[#17332c] text-white shadow-xs"
                : "bg-white text-[#5e7a70] hover:text-[#17332c] border border-[#dbe7dd]"
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Roster Otoritas</span>
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === "proposals" && (
          <ProposalList
            proposals={proposals}
            onOpenCreate={() => setCreateModalOpen(true)}
            onRefresh={handleRefresh}
          />
        )}

        {activeTab === "dps" && (
          <DpsSafeApprovalCard
            proposals={proposals}
            onActionComplete={handleRefresh}
          />
        )}

        {activeTab === "auditor" && (
          <AuditorAttestationPanel
            proposals={proposals}
            onActionComplete={handleRefresh}
          />
        )}

        {activeTab === "roster" && <RoleRoster />}
      </Container>

      {/* Create Proposal Modal */}
      <CreateProposalModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={handleRefresh}
      />
    </main>
  );
}

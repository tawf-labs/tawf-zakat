import React, { useState } from "react";
import { Scale, CheckCircle2, ShieldCheck, ExternalLink, Loader2, Lock, AlertCircle } from "lucide-react";
import { approveDisbursementOnChain } from "../../lib/web3Client";
import { useAccount } from "wagmi";
import { useGovernanceRole } from "./RoleContext";
import { toast } from "sonner";

interface DpsSafeApprovalCardProps {
  proposals: any[];
  onActionComplete: () => void;
}

export function DpsSafeApprovalCard({ proposals, onActionComplete }: DpsSafeApprovalCardProps) {
  const { address, isConnected } = useAccount();
  const { canApproveDps, getRestrictionReason } = useGovernanceRole();
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const pendingProposals = proposals.filter((p) => p.status === "Pending" || p.status === "PENDING");

  const handleApprove = async (proposalId: number) => {
    if (!canApproveDps) {
      toast.info("Akses Dibatasi", {
        description: getRestrictionReason("approve"),
      });
      return;
    }

    if (!isConnected || !address) {
      toast.error("Silakan hubungkan dompet anggota DPS terlebih dahulu.");
      return;
    }

    setLoadingId(proposalId);
    try {
      const tx = await approveDisbursementOnChain(proposalId);

      // Synchronize approval state to backend database
      try {
        await fetch(`http://localhost:3001/api/proposals/${proposalId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approverRole: "Dewan Pengawas Syariah",
            txHash: tx.txHash,
          }),
        });
      } catch (syncErr) {
        console.warn("Backend approval sync error:", syncErr);
      }

      toast.success(`Proposal #${proposalId} berhasil disetujui on-chain!`);
      onActionComplete();
    } catch (err: any) {
      console.error("DPS Approval error:", err);
      toast.error(err.message || "Gagal menyetujui proposal.");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-xs space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#dbe7dd]/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#1b765e]/10 text-[#1b765e] flex items-center justify-center">
            <Scale className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-serif text-lg font-bold text-[#17332c]">
              Antrean Verifikasi Dewan Pengawas Syariah (DPS)
            </h3>
            <p className="text-xs text-[#5e7a70]">
              Otorisasi 2-of-3 Safe Multisig sebelum dana zakat dapat dicairkan.
            </p>
          </div>
        </div>

        <a
          href="https://app.safe.global/home?safe=arb-sep:0x5e9B652C4E8a013f6fAb69F0b55377c408B59968"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#f4f8f3] border border-[#dbe7dd] text-xs font-semibold text-[#1b765e] hover:bg-[#1b765e] hover:text-white transition-all shadow-2xs"
        >
          <span>Buka Safe Arbitrum App</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {pendingProposals.length === 0 ? (
        <div className="py-10 text-center text-xs text-[#5e7a70] space-y-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto opacity-70" />
          <p className="font-semibold text-[#17332c]">Semua Proposal Telah Ditelaah</p>
          <p>Tidak ada pengajuan yang sedang menunggu persetujuan DPS saat ini.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pendingProposals.map((p) => {
            const isLoading = loadingId === p.proposalId || loadingId === p.id;
            const pId = p.proposalId || p.id;

            return (
              <div
                key={pId}
                className="p-5 rounded-2xl border border-[#dbe7dd] bg-[#f4f8f3]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-[#17332c]">
                      Proposal #{pId}
                    </span>
                    <span className="text-[11px] font-semibold text-[#1b765e] bg-white px-2 py-0.5 rounded-full border border-[#dbe7dd]">
                      {p.asnafLabel || p.asnafType || "Fakir Miskin"}
                    </span>
                  </div>
                  <p className="font-bold text-sm text-[#17332c]">
                    {p.beneficiaryName ? `Bantuan untuk ${p.beneficiaryName}` : "Program Bantuan Kemanusiaan"}
                  </p>
                  <p className="text-xs text-[#5e7a70]">
                    Nominal:{" "}
                    <strong className="text-[#17332c]">
                      {p.amountIDR ? `Rp ${p.amountIDR.toLocaleString("id-ID")}` : `${p.amountUSDC} USDC`}
                    </strong>{" "}
                    | Hash: <span className="font-mono">{p.beneficiaryHash?.slice(0, 10)}...</span>
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => handleApprove(pId)}
                    className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-xs cursor-pointer ${
                      canApproveDps
                        ? "bg-[#17332c] hover:bg-[#1b765e] text-white"
                        : "bg-[#eaf3e8] text-[#5e7a70] border border-[#dbe7dd]"
                    }`}
                    title={!canApproveDps ? getRestrictionReason("approve") : "Setujui usulan penyaluran sebagai Dewan Pengawas Syariah"}
                  >
                    {isLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : canApproveDps ? (
                      <ShieldCheck className="w-4 h-4 text-[#c4ed70]" />
                    ) : (
                      <Lock className="w-3.5 h-3.5 text-[#5e7a70]" />
                    )}
                    <span>Setujui (DPS)</span>
                    {!canApproveDps && (
                      <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-white text-[#5e7a70] border border-[#dbe7dd]">
                        Khusus DPS
                      </span>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

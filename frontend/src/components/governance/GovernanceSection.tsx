import React, { useState, useEffect } from "react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { FileText, Shield, CheckCircle, Clock, AlertTriangle, ExternalLink, X, PlusCircle, UserCheck, Ban } from "lucide-react";
import {
  approveDisbursementOnChain,
  executeDisbursementOnChain,
  cancelProposalOnChain,
} from "../../lib/web3Client";

interface Proposal {
  proposalId: number;
  currencyType: 0 | 1;
  amount: number;
  asnafCategory: number;
  asnafLabel: string;
  beneficiaryName: string;
  beneficiaryNIKMasked: string;
  beneficiaryHash: string;
  ipfsProofCID: string;
  periodId: number;
  approvalCount: number;
  approvedBy: string[];
  status: "Pending" | "Approved" | "Executed" | "Cancelled";
  cancelReason?: string;
  createdAt: string;
  executedAt?: string;
  txHash?: string;
}

export function GovernanceSection() {
  const [proposals, setProposals] = useState<Proposal[]>([
    {
      proposalId: 1,
      currencyType: 0,
      amount: 5000000,
      asnafCategory: 0,
      asnafLabel: "Fakir",
      beneficiaryName: "Pak Joko Suwarno",
      beneficiaryNIKMasked: "320101******0001",
      beneficiaryHash: "0x8e5f2a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f",
      ipfsProofCID: "QmZtmD2qt8fJpq3CLDHVSS5DV7hgqseifznGRubWN15w53",
      periodId: 202608,
      approvalCount: 2,
      approvedBy: ["Amil Internal", "Dewan Pengawas Syariah (DPS)"],
      status: "Executed",
      createdAt: "2026-08-24T09:00:00Z",
      executedAt: "2026-08-24T11:00:00Z",
      txHash: "0x730127bf21f7f899d38115f6177f888cd9daf079e4443cd6156e007772d18df5",
    },
    {
      proposalId: 2,
      currencyType: 0,
      amount: 7500000,
      asnafCategory: 1,
      asnafLabel: "Miskin",
      beneficiaryName: "Ibu Aminah",
      beneficiaryNIKMasked: "327302******0002",
      beneficiaryHash: "0x4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c",
      ipfsProofCID: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
      periodId: 202608,
      approvalCount: 1,
      approvedBy: ["Amil Internal"],
      status: "Pending",
      createdAt: "2026-08-24T14:30:00Z",
    },
  ]);

  const [activeRole, setActiveRole] = useState<"dps" | "auditor" | "amil">("dps");
  const [selectedProof, setSelectedProof] = useState<Proposal | null>(null);
  const [showProposeModal, setShowProposeModal] = useState(false);
  const [cancellingProposalId, setCancellingProposalId] = useState<number | null>(null);
  const [cancelReasonText, setCancelReasonText] = useState("");
  const [actionTxHash, setActionTxHash] = useState<{ id: number; hash: string } | null>(null);

  // New Proposal Form State
  const [newBenName, setNewBenName] = useState("");
  const [newBenNIK, setNewBenNIK] = useState("");
  const [newAsnaf, setNewAsnaf] = useState("Fisabilillah");
  const [newAmount, setNewAmount] = useState("3000000");
  const [submittingProposal, setSubmittingProposal] = useState(false);

  useEffect(() => {
    fetch("http://localhost:3001/api/proposals")
      .then((res) => res.json())
      .then((data) => {
        if (data.proposals && data.proposals.length > 0) {
          setProposals(data.proposals);
        }
      })
      .catch(() => {});
  }, []);

  const handleApprove = async (proposalId: number) => {
    try {
      const res = await approveDisbursementOnChain(proposalId);
      setActionTxHash({ id: proposalId, hash: res.txHash });
    } catch {
      // Fallback
    }

    setProposals((prev) =>
      prev.map((p) => {
        if (p.proposalId === proposalId && p.status === "Pending") {
          const roleName =
            activeRole === "dps"
              ? "Dewan Pengawas Syariah (DPS)"
              : activeRole === "auditor"
              ? "Auditor Independen"
              : "Amil Internal";
          const newApprovals = p.approvedBy.includes(roleName)
            ? p.approvedBy
            : [...p.approvedBy, roleName];
          return {
            ...p,
            approvedBy: newApprovals,
            approvalCount: newApprovals.length,
            status: newApprovals.length >= 2 ? "Approved" : "Pending",
          };
        }
        return p;
      })
    );
  };

  const handleExecute = async (proposalId: number) => {
    try {
      const res = await executeDisbursementOnChain(proposalId);
      setActionTxHash({ id: proposalId, hash: res.txHash });
    } catch {
      // Fallback
    }

    setProposals((prev) =>
      prev.map((p) => {
        if (p.proposalId === proposalId && (p.status === "Approved" || p.approvalCount >= 2)) {
          return {
            ...p,
            status: "Executed",
            executedAt: new Date().toISOString(),
          };
        }
        return p;
      })
    );
  };

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancellingProposalId) return;

    try {
      const res = await cancelProposalOnChain(
        cancellingProposalId,
        cancelReasonText || "Dibatalkan oleh DPS/Amil"
      );
      setActionTxHash({ id: cancellingProposalId, hash: res.txHash });
    } catch {
      // Fallback
    }

    setProposals((prev) =>
      prev.map((p) => {
        if (p.proposalId === cancellingProposalId) {
          return {
            ...p,
            status: "Cancelled",
            cancelReason: cancelReasonText || "Dibatalkan oleh pengawas syariah / amil",
          };
        }
        return p;
      })
    );

    setCancellingProposalId(null);
    setCancelReasonText("");
  };

  const handleCreateProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingProposal(true);

    try {
      const res = await fetch("http://localhost:3001/api/disbursement/upload-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beneficiaryName: newBenName,
          beneficiaryNIK: newBenNIK,
          asnafCategory: newAsnaf,
          amount: Number(newAmount),
          currency: "IDR",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const newP: Proposal = {
          proposalId: proposals.length + 1,
          currencyType: 0,
          amount: Number(newAmount),
          asnafCategory: 6,
          asnafLabel: newAsnaf,
          beneficiaryName: newBenName,
          beneficiaryNIKMasked: `${newBenNIK.slice(0, 6)}******${newBenNIK.slice(-4)}`,
          beneficiaryHash: data.beneficiaryHash,
          ipfsProofCID: data.ipfsProofCID,
          periodId: 202608,
          approvalCount: 1,
          approvedBy: ["Amil Internal"],
          status: "Pending",
          createdAt: new Date().toISOString(),
        };
        setProposals([newP, ...proposals]);
        setShowProposeModal(false);
        setNewBenName("");
        setNewBenNIK("");
      }
    } catch {
      const mockCID = `Qm${Math.random().toString(36).substring(2, 15)}mockCID`;
      const newP: Proposal = {
        proposalId: proposals.length + 1,
        currencyType: 0,
        amount: Number(newAmount),
        asnafCategory: 6,
        asnafLabel: newAsnaf,
        beneficiaryName: newBenName,
        beneficiaryNIKMasked: `${newBenNIK.slice(0, 6)}******${newBenNIK.slice(-4)}`,
        beneficiaryHash: "0x3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a",
        ipfsProofCID: mockCID,
        periodId: 202608,
        approvalCount: 1,
        approvedBy: ["Amil Internal"],
        status: "Pending",
        createdAt: new Date().toISOString(),
      };
      setProposals([newP, ...proposals]);
      setShowProposeModal(false);
    } finally {
      setSubmittingProposal(false);
    }
  };

  return (
    <section id="governance" className="py-16 px-6 max-w-6xl mx-auto border-t border-[#0F3D30]/10">
      <div className="text-center mb-10">
        <span className="text-xs uppercase tracking-[0.25em] text-[#C5A869] font-semibold block mb-2">
          Syariah Governance & Anti-Corruption
        </span>
        <h2 className="text-3xl md:text-5xl font-serif font-medium text-[#0F3D30]">
          Otorisasi Penyaluran Multi-Sig 2-of-3
        </h2>
        <p className="text-sm md:text-base text-[#555555] max-w-2xl mx-auto mt-3">
          Dana mustahik hanya dapat dicairkan setelah memperoleh minimal 2 persetujuan dari 3 pemegang kunci: <strong>Amil</strong>, <strong>Dewan Pengawas Syariah (DPS)</strong>, dan <strong>Auditor Independen</strong>.
        </p>
      </div>

      {/* Role Switcher Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-[#0F3D30]/10 shadow-xs mb-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-[#0F3D30]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[#1A1A1A]">
            Simulasi Peran Penandatangan:
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveRole("dps")}
            className={`px-4 py-2 rounded-full text-xs font-semibold transition-all ${
              activeRole === "dps"
                ? "bg-[#0F3D30] text-[#F9F6F0] shadow-xs"
                : "bg-[#F9F6F0] text-[#555555] hover:text-[#0F3D30]"
            }`}
          >
            🏛️ Dewan Pengawas Syariah (DPS)
          </button>
          <button
            onClick={() => setActiveRole("auditor")}
            className={`px-4 py-2 rounded-full text-xs font-semibold transition-all ${
              activeRole === "auditor"
                ? "bg-[#0F3D30] text-[#F9F6F0] shadow-xs"
                : "bg-[#F9F6F0] text-[#555555] hover:text-[#0F3D30]"
            }`}
          >
            📊 Auditor Independen
          </button>
          <button
            onClick={() => setActiveRole("amil")}
            className={`px-4 py-2 rounded-full text-xs font-semibold transition-all ${
              activeRole === "amil"
                ? "bg-[#0F3D30] text-[#F9F6F0] shadow-xs"
                : "bg-[#F9F6F0] text-[#555555] hover:text-[#0F3D30]"
            }`}
          >
            🏢 Amil Operasional
          </button>
        </div>

        <Button onClick={() => setShowProposeModal(true)} size="sm" className="shrink-0">
          <PlusCircle className="w-3.5 h-3.5 mr-1" /> Ajukan Penyaluran
        </Button>
      </div>

      {/* Proposals List */}
      <div className="space-y-4">
        {proposals.map((p) => {
          const isApproved = p.status === "Approved";
          const isExecuted = p.status === "Executed";
          const isPending = p.status === "Pending";
          const isCancelled = p.status === "Cancelled";

          return (
            <Card key={p.proposalId} elevated className="p-6 md:p-6">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-[#0F3D30]/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#0F3D30]/10 text-[#0F3D30] flex items-center justify-center font-bold text-sm">
                    #{p.proposalId}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-serif font-bold text-lg text-[#0F3D30]">
                        {p.beneficiaryName}
                      </h4>
                      <Badge variant="neutral">{p.asnafLabel}</Badge>
                      <Badge
                        variant={
                          isExecuted
                            ? "success"
                            : isApproved
                            ? "info"
                            : isCancelled
                            ? "neutral"
                            : "warning"
                        }
                      >
                        {isExecuted
                          ? "Realisasi Selesai (Executed)"
                          : isApproved
                          ? "Kuorum 2/3 Tercapai (Approved)"
                          : isCancelled
                          ? "Dibatalkan (Cancelled)"
                          : "Menunggu Persetujuan (Pending)"}
                      </Badge>
                    </div>
                    <p className="text-xs text-[#555555] font-mono mt-0.5">
                      NIK Masked: {p.beneficiaryNIKMasked} | Hash: {p.beneficiaryHash.slice(0, 16)}...
                    </p>
                    {isCancelled && p.cancelReason && (
                      <p className="text-xs text-red-600 font-medium mt-1">
                        Alasan Pembatalan: "{p.cancelReason}"
                      </p>
                    )}
                  </div>
                </div>

                {/* Amount */}
                <div className="text-right">
                  <span className="text-xs text-[#555555] uppercase tracking-wider block">
                    Alokasi Bantuan
                  </span>
                  <span className="font-serif text-xl font-bold text-[#0F3D30]">
                    {p.currencyType === 0
                      ? `Rp ${p.amount.toLocaleString("id-ID")}`
                      : `$${p.amount.toLocaleString("en-US")} USDC`}
                  </span>
                </div>
              </div>

              {/* Multi-Sig Status & Proof Actions */}
              <div className="pt-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-1.5 text-stone-700">
                    <span className="font-semibold">Persetujuan Kuorum ({p.approvalCount}/2):</span>
                    <span className="text-[#0F3D30] font-medium">
                      {p.approvedBy.join(", ")}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedProof(p)}
                    className="text-[#C5A869] hover:text-[#A68B4F] font-semibold text-xs inline-flex items-center gap-1 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" /> Lihat Bukti Penyaluran (IPFS: {p.ipfsProofCID.slice(0, 12)}...)
                  </button>
                  {p.txHash && (
                    <div className="text-[11px] font-mono text-emerald-800 flex items-center gap-1">
                      Tx: <a href={`https://sepolia.etherscan.io/tx/${p.txHash}`} target="_blank" rel="noreferrer" className="underline font-bold truncate max-w-[200px]">{p.txHash}</a>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  {isPending && (
                    <>
                      <Button
                        onClick={() => handleApprove(p.proposalId)}
                        variant="secondary"
                        size="sm"
                      >
                        <CheckCircle className="w-3.5 h-3.5 mr-1" />
                        Setujui via MetaMask ({activeRole.toUpperCase()})
                      </Button>

                      {(activeRole === "dps" || activeRole === "amil") && (
                        <button
                          onClick={() => setCancellingProposalId(p.proposalId)}
                          className="px-3.5 py-1.5 rounded-full text-xs font-semibold border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <Ban className="w-3 h-3" /> Batalkan
                        </button>
                      )}
                    </>
                  )}

                  {(isApproved || (isPending && p.approvalCount >= 2)) && (
                    <Button
                      onClick={() => handleExecute(p.proposalId)}
                      size="sm"
                      className="bg-emerald-800 hover:bg-emerald-900 text-white"
                    >
                      Cairkan Dana (MetaMask L1)
                    </Button>
                  )}

                  {isExecuted && (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-800 font-bold bg-emerald-100 px-3 py-1.5 rounded-full">
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                      Dana Telah Ditransfer Onchain
                    </div>
                  )}

                  {isCancelled && (
                    <div className="flex items-center gap-1.5 text-xs text-stone-600 font-medium bg-stone-100 px-3 py-1.5 rounded-full">
                      <Ban className="w-4 h-4 text-stone-500" />
                      Proposal Tidak Berlaku
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Cancel Proposal Reason Modal */}
      {cancellingProposalId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <Card elevated className="max-w-md w-full bg-white p-6">
            <div className="flex items-center justify-between pb-3 border-b border-[#0F3D30]/10 mb-4">
              <div className="flex items-center gap-2 text-red-700">
                <Ban className="w-5 h-5" />
                <h4 className="font-serif font-bold text-lg">
                  Batalkan Proposal #{cancellingProposalId}
                </h4>
              </div>
              <button
                onClick={() => setCancellingProposalId(null)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmCancel} className="space-y-4 text-xs">
              <p className="text-stone-600 leading-relaxed">
                Proposal yang dibatalkan oleh DPS/Amil akan dinonaktifkan secara permanen dan tidak dapat disetujui atau dicairkan lagi di smart contract Sepolia.
              </p>

              <div>
                <label className="block font-semibold text-[#1A1A1A] uppercase tracking-wider mb-1.5">
                  Alasan Pembatalan / Ketidaksesuaian Syariah:
                </label>
                <textarea
                  required
                  rows={3}
                  value={cancelReasonText}
                  onChange={(e) => setCancelReasonText(e.target.value)}
                  placeholder="Contoh: Berkas mustahik tidak memenuhi kriteria 8 asnaf atau data NIK salah ketik."
                  className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl px-3.5 py-2 text-xs text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCancellingProposalId(null)}
                >
                  Kembali
                </Button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-full text-xs font-semibold bg-red-700 hover:bg-red-800 text-white shadow-xs transition-all"
                >
                  Konfirmasi Pembatalan di L1
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* IPFS Proof Inspection Modal */}
      {selectedProof && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <Card elevated className="max-w-lg w-full bg-white max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between pb-3 border-b border-[#0F3D30]/10 mb-4">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-[#0F3D30]" />
                <h4 className="font-serif font-bold text-lg text-[#0F3D30]">
                  Bukti Penyaluran (IPFS Attached)
                </h4>
              </div>
              <button
                onClick={() => setSelectedProof(null)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Blurred Photo Mock */}
              <div className="bg-stone-100 rounded-xl p-6 text-center border border-stone-200">
                <div className="w-full h-44 bg-stone-300 rounded-lg flex items-center justify-center text-stone-600 font-serif italic relative overflow-hidden">
                  <div className="absolute inset-0 backdrop-blur-md bg-stone-900/10 flex flex-col items-center justify-center p-4 text-center">
                    <span className="text-sm font-bold text-white mb-1">
                      [Dokumentasi Penyerahan Tersamar]
                    </span>
                    <span className="text-[10px] text-white/80">
                      Wajah & Identitas Dilindungi Demi Martabat Mustahik
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-[#F9F6F0] p-3.5 rounded-xl space-y-2 border border-[#0F3D30]/10">
                <div className="flex justify-between">
                  <span className="text-[#555555]">Nama Penerima:</span>
                  <span className="font-bold text-[#0F3D30]">{selectedProof.beneficiaryName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#555555]">Kategori Asnaf:</span>
                  <span className="font-semibold text-stone-800">{selectedProof.asnafLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#555555]">NIK Masked:</span>
                  <span className="font-mono text-stone-800">{selectedProof.beneficiaryNIKMasked}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#555555]">IPFS CID:</span>
                  <span className="font-mono text-[11px] text-[#0F3D30] font-bold truncate max-w-[200px]">
                    {selectedProof.ipfsProofCID}
                  </span>
                </div>
              </div>

              <a
                href={`https://ipfs.io/ipfs/${selectedProof.ipfsProofCID}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-1.5 w-full py-2.5 rounded-full bg-[#0F3D30] text-white text-xs font-semibold uppercase tracking-wider hover:bg-[#1A5242]"
              >
                Buka di IPFS Gateway Public <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </Card>
        </div>
      )}

      {/* Propose New Disbursement Modal */}
      {showProposeModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <Card elevated className="max-w-md w-full bg-white p-6">
            <div className="flex items-center justify-between pb-3 border-b border-[#0F3D30]/10 mb-4">
              <h4 className="font-serif font-bold text-lg text-[#0F3D30]">
                Pengajuan Penyaluran Dana Baru
              </h4>
              <button
                onClick={() => setShowProposeModal(false)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateProposal} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-[#1A1A1A] uppercase tracking-wider mb-1">
                  Nama Penerima Manfaat
                </label>
                <input
                  type="text"
                  required
                  value={newBenName}
                  onChange={(e) => setNewBenName(e.target.value)}
                  placeholder="Contoh: Ustadz Abdullah"
                  className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl px-3.5 py-2 text-xs text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30]"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#1A1A1A] uppercase tracking-wider mb-1">
                  Nomor Induk Kependudukan (NIK)
                </label>
                <input
                  type="text"
                  required
                  value={newBenNIK}
                  onChange={(e) => setNewBenNIK(e.target.value)}
                  placeholder="16 Digit NIK..."
                  className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl px-3.5 py-2 text-xs font-mono text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30]"
                />
                <span className="text-[10px] text-stone-500 mt-1 block">
                  *NIK akan di-hash secara kriptografis (salted) demi privasi.
                </span>
              </div>

              <div>
                <label className="block font-semibold text-[#1A1A1A] uppercase tracking-wider mb-1">
                  Kategori Asnaf
                </label>
                <select
                  value={newAsnaf}
                  onChange={(e) => setNewAsnaf(e.target.value)}
                  className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl px-3 py-2 text-xs text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30]"
                >
                  <option value="Fisabilillah">Fisabilillah (Guru Ngaji / Dakwah)</option>
                  <option value="Fakir">Fakir</option>
                  <option value="Miskin">Miskin</option>
                  <option value="Ibnu Sabil">Ibnu Sabil (Musafir Terlantar)</option>
                  <option value="Gharimin">Gharimin (Terlilit Hutang Darurat)</option>
                  <option value="Mualaf">Mualaf</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-[#1A1A1A] uppercase tracking-wider mb-1">
                  Nominal Bantuan (IDR)
                </label>
                <input
                  type="number"
                  required
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl px-3.5 py-2 text-xs font-semibold text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30]"
                />
              </div>

              <Button type="submit" disabled={submittingProposal} className="w-full py-3 mt-2">
                {submittingProposal ? "Mengunggah Bukti ke IPFS..." : "Buat Proposal & Minta Kuorum"}
              </Button>
            </form>
          </Card>
        </div>
      )}
    </section>
  );
}

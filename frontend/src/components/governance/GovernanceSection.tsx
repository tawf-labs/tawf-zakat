import { useState, useEffect, useCallback } from "react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { FileText, Shield, CheckCircle, ExternalLink, X, PlusCircle, UserCheck, Ban, Landmark, BarChart3, Building2, RefreshCw } from "lucide-react";
import {
  approveDisbursementOnChain,
  executeDisbursementOnChain,
  cancelProposalOnChain,
  proposeDisbursementOnChain,
} from "../../lib/web3Client";
import { useWallet } from "../../lib/WalletContext";
import { type Hex } from "viem";

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
  disbursementReceiptCID?: string;
  periodId: number;
  approvalCount: number;
  approvedBy: string[];
  status: "Pending" | "Approved" | "Executed" | "Cancelled";
  cancelReason?: string;
  createdAt: string;
  executedAt?: string;
  txHash?: string;
}

const ASNAF_OPTIONS = [
  { id: 1, label: "Fakir", desc: "Tidak memiliki penghasilan dan harta sama sekali" },
  { id: 2, label: "Miskin", desc: "Penghasilan tidak mencukupi kebutuhan pokok dasar" },
  { id: 3, label: "Amil", desc: "Petugas pengelola dan pengadministrasi zakat" },
  { id: 4, label: "Muallaf", desc: "Orang yang baru memeluk Islam atau diteguhkan imannya" },
  { id: 5, label: "Riqab", desc: "Pembebasan belenggu / korban eksploitasi kemanusiaan" },
  { id: 6, label: "Gharimin", desc: "Terlilit hutang darurat untuk kebutuhan primer" },
  { id: 7, label: "Fisabilillah", desc: "Aktivitas dakwah, pendidikan Islam, dan kemaslahatan umat" },
  { id: 8, label: "Ibnu Sabil", desc: "Musafir / penuntut ilmu terlantar dalam perjalanan kebaikan" },
];

export function GovernanceSection() {
  const { address, formattedAddress } = useWallet();

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);

  const [activeRole, setActiveRole] = useState<"dps" | "auditor" | "amil">("dps");
  const [selectedProof, setSelectedProof] = useState<Proposal | null>(null);
  const [showProposeModal, setShowProposeModal] = useState(false);
  const [cancellingProposalId, setCancellingProposalId] = useState<number | null>(null);
  const [cancelReasonText, setCancelReasonText] = useState("");

  // BAST & Execution Modal State (Ticket #29)
  const [executingBastProposal, setExecutingBastProposal] = useState<Proposal | null>(null);
  const [bastBankRef, setBastBankRef] = useState("");
  const [bastAmilName, setBastAmilName] = useState("Amil Operasional BAZNAS/LAZ");
  const [bastSubmitting, setBastSubmitting] = useState(false);

  // New Proposal Form State (Ticket #27)
  const [newProgramTitle, setNewProgramTitle] = useState("Bantuan Pemberdayaan Asnaf");
  const [newBenName, setNewBenName] = useState("");
  const [newBenNIK, setNewBenNIK] = useState("");
  const [newAsnafId, setNewAsnafId] = useState(7);
  const [newAmount, setNewAmount] = useState("3000000");
  const [newCurrencyType, setNewCurrencyType] = useState<0 | 1>(0);
  const [newCity, setNewCity] = useState("Jakarta");
  const [newAssessment, setNewAssessment] = useState("Survei lapangan dan verifikasi kelayakan asnaf telah diverifikasi tim amil.");
  const [newUsdcRecipient, setNewUsdcRecipient] = useState("");
  const [submittingProposal, setSubmittingProposal] = useState(false);

  const fetchProposals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("http://localhost:3001/api/proposals");
      if (res.ok) {
        const data = await res.json();
        if (data.proposals && data.proposals.length > 0) {
          setProposals(data.proposals);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch proposals from backend:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  const handleApprove = async (proposalId: number) => {
    let txHash: string | undefined;
    try {
      const onchainRes = await approveDisbursementOnChain(proposalId);
      txHash = onchainRes.txHash;
    } catch (err) {
      console.warn("Onchain approval skipped or demo fallback:", err);
    }

    const roleName =
      activeRole === "dps"
        ? "Dewan Pengawas Syariah (DPS)"
        : activeRole === "auditor"
        ? "Auditor Independen"
        : "Amil Internal";

    // Sync to Neon DB
    try {
      await fetch(`http://localhost:3001/api/proposals/${proposalId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approverRole: roleName, txHash }),
      });
    } catch (dbErr) {
      console.warn("Failed to sync approval to Neon DB:", dbErr);
    }

    setProposals((prev) =>
      prev.map((p) => {
        if (p.proposalId === proposalId && p.status === "Pending") {
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
    const target = proposals.find((p) => p.proposalId === proposalId);
    if (!target) return;

    if (target.currencyType === 0) {
      // Open BAST upload & bank transfer confirmation modal
      setExecutingBastProposal(target);
      return;
    }

    // Direct USDC Execution on L1
    let txHash: string | undefined;
    try {
      const onchainRes = await executeDisbursementOnChain(proposalId);
      txHash = onchainRes.txHash;
    } catch (err) {
      console.warn("Onchain execute skipped or demo fallback:", err);
    }

    // Sync to Neon DB
    try {
      await fetch(`http://localhost:3001/api/proposals/${proposalId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash }),
      });
    } catch (dbErr) {
      console.warn("Failed to sync execute to Neon DB:", dbErr);
    }

    setProposals((prev) =>
      prev.map((p) => {
        if (p.proposalId === proposalId && (p.status === "Approved" || p.approvalCount >= 2)) {
          return {
            ...p,
            status: "Executed",
            executedAt: new Date().toISOString(),
            txHash: txHash || p.txHash,
          };
        }
        return p;
      })
    );
  };

  const handleExecuteBastSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!executingBastProposal) return;
    setBastSubmitting(true);

    try {
      // 1. Upload BAST metadata & bank ref to Pinata IPFS
      const bastRes = await fetch(
        `http://localhost:3001/api/proposals/${executingBastProposal.proposalId}/bast`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bankReferenceNumber: bastBankRef || `TRX-BSI-${Date.now()}`,
            disbursementChannel: "BANK_TRANSFER",
            signedByAmil: bastAmilName,
            bastDocumentFileName: "berita_acara_serah_terima_zakat.pdf",
            photoEvidenceFileName: "dokumentasi_serah_terima_mustahik.jpg",
          }),
        }
      );
      const bastData = await bastRes.json();
      const receiptCID = bastData.disbursementReceiptCID;

      // 2. Trigger on-chain execution via MetaMask / Safe
      let txHash: string | undefined;
      try {
        const onchainRes = await executeDisbursementOnChain(
          executingBastProposal.proposalId
        );
        txHash = onchainRes.txHash;
      } catch (err) {
        console.warn("Onchain execute fallback:", err);
      }

      // 3. Mark Executed in Neon DB
      await fetch(
        `http://localhost:3001/api/proposals/${executingBastProposal.proposalId}/execute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash }),
        }
      );

      // 4. Update local state
      setProposals((prev) =>
        prev.map((p) => {
          if (p.proposalId === executingBastProposal.proposalId) {
            return {
              ...p,
              status: "Executed",
              disbursementReceiptCID: receiptCID,
              executedAt: new Date().toISOString(),
              txHash: txHash || p.txHash,
            };
          }
          return p;
        })
      );

      setExecutingBastProposal(null);
      setBastBankRef("");
    } catch (err) {
      console.error("Failed to execute BAST & disbursement:", err);
    } finally {
      setBastSubmitting(false);
    }
  };

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancellingProposalId) return;

    let txHash: string | undefined;
    try {
      const onchainRes = await cancelProposalOnChain(
        cancellingProposalId,
        cancelReasonText || "Dibatalkan oleh DPS/Amil"
      );
      txHash = onchainRes.txHash;
    } catch (err) {
      console.warn("Onchain cancel skipped or demo fallback:", err);
    }

    try {
      await fetch(`http://localhost:3001/api/proposals/${cancellingProposalId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cancellerRole:
            activeRole === "dps"
              ? "Dewan Pengawas Syariah (DPS)"
              : "Amil Internal",
          cancelReason: cancelReasonText || "Dibatalkan oleh pengawas syariah / amil",
          txHash,
        }),
      });
    } catch (dbErr) {
      console.warn("Failed to sync cancel to Neon DB:", dbErr);
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
      const selectedAsnafObj = ASNAF_OPTIONS.find((a) => a.id === newAsnafId) || ASNAF_OPTIONS[6];

      // 1. Submit to Intake API: Compute salted hash & pin structured proposal JSON to IPFS
      const intakeRes = await fetch("http://localhost:3001/api/proposals/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programTitle: newProgramTitle,
          asnafCategory: newAsnafId,
          asnafLabel: selectedAsnafObj.label,
          amount: Number(newAmount),
          currencyType: newCurrencyType,
          beneficiaryName: newBenName,
          beneficiaryNIK: newBenNIK,
          locationCity: newCity,
          assessmentSummary: newAssessment,
          periodId: 202608,
          usdcRecipient: newCurrencyType === 1 ? newUsdcRecipient : undefined,
          evidenceFiles: [
            {
              fileName: "dokumen_survei_kelayakan.pdf",
              fileType: "application/pdf",
              description: `Survei kelayakan asnaf ${selectedAsnafObj.label} di ${newCity}`,
            },
          ],
        }),
      });

      const intakeData = await intakeRes.json();
      if (!intakeRes.ok || !intakeData.success) {
        throw new Error(intakeData.error || "Gagal memproses proposal intake");
      }

      const { proposal, onChainParams } = intakeData;
      let onchainProposalId = proposal.proposalId;
      let onchainTxHash: string | undefined;

      // 2. Execute on-chain proposal transaction on Sepolia L1
      try {
        const onchainRes = await proposeDisbursementOnChain({
          currencyType: newCurrencyType,
          amount: Number(newAmount),
          asnafCategory: newAsnafId,
          beneficiaryHash: onChainParams.beneficiaryHash as Hex,
          ipfsProofCID: onChainParams.ipfsProofCID,
          periodId: onChainParams.periodId || 202608,
          usdcRecipient: newCurrencyType === 1 ? newUsdcRecipient : undefined,
        });
        onchainProposalId = onchainRes.proposalId;
        onchainTxHash = onchainRes.txHash;

        // 3. Sync on-chain ID & txHash to Neon DB
        await fetch(`http://localhost:3001/api/proposals/${proposal.proposalId}/sync-tx`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proposalIdOnChain: onchainProposalId,
            txHash: onchainTxHash,
          }),
        });
      } catch (onchainErr) {
        console.warn("On-chain propose skipped or demo fallback:", onchainErr);
      }

      await fetchProposals();
      setShowProposeModal(false);
      setNewBenName("");
      setNewBenNIK("");
      setNewUsdcRecipient("");
    } catch (err: any) {
      console.error("Failed to create proposal:", err);
      alert(`Error: ${err.message || "Gagal membuat proposal"}`);
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
          <UserCheck className="w-4 h-4 text-[#0F3D30]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[#1A1A1A]">
            Peran Penandatangan:
          </span>
          {address && (
            <span className="text-[11px] font-mono text-[#0F3D30] bg-[#0F3D30]/10 px-2 py-0.5 rounded-full font-bold">
              {formattedAddress}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveRole("dps")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              activeRole === "dps"
                ? "bg-[#0F3D30] text-[#F9F6F0] shadow-xs"
                : "bg-[#F9F6F0] text-[#555555] hover:text-[#0F3D30]"
            }`}
          >
            <Landmark className="w-3.5 h-3.5" /> Dewan Pengawas Syariah (DPS)
          </button>
          <button
            onClick={() => setActiveRole("auditor")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              activeRole === "auditor"
                ? "bg-[#0F3D30] text-[#F9F6F0] shadow-xs"
                : "bg-[#F9F6F0] text-[#555555] hover:text-[#0F3D30]"
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" /> Auditor Independen
          </button>
          <button
            onClick={() => setActiveRole("amil")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              activeRole === "amil"
                ? "bg-[#0F3D30] text-[#F9F6F0] shadow-xs"
                : "bg-[#F9F6F0] text-[#555555] hover:text-[#0F3D30]"
            }`}
          >
            <Building2 className="w-3.5 h-3.5" /> Amil Operasional
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchProposals()}
            disabled={loading}
            className="flex items-center gap-1 text-xs text-[#0F3D30] hover:text-[#1A5242] bg-[#F9F6F0] px-3 py-2 rounded-xl border border-stone-200 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-emerald-600" : ""}`} /> Refresh
          </button>
          <Button onClick={() => setShowProposeModal(true)} size="sm" className="shrink-0">
            <PlusCircle className="w-3.5 h-3.5 mr-1" /> Ajukan Penyaluran
          </Button>
        </div>
      </div>

      {/* Proposals List */}
      <div className="space-y-4">
        {proposals.map((p, idx) => {
          const isApproved = p.status === "Approved";
          const isExecuted = p.status === "Executed";
          const isPending = p.status === "Pending";
          const isCancelled = p.status === "Cancelled";

          return (
            <Card key={`gov-proposal-${p.proposalId}-${idx}`} elevated className="p-6 md:p-6">
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
                      className="bg-emerald-800 hover:bg-emerald-900 text-white font-semibold"
                    >
                      {p.currencyType === 1
                        ? "Kirim USDC On-Chain (Amil L1)"
                        : "Unggah BAST & Cairkan (Amil)"}
                    </Button>
                  )}

                  {isExecuted && (
                    <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
                      <div className="flex items-center gap-1.5 text-xs text-emerald-800 font-bold bg-emerald-100 px-3 py-1.5 rounded-full">
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                        Dana Telah Disalurkan
                      </div>
                      {p.disbursementReceiptCID && (
                        <a
                          href={`https://ipfs.io/ipfs/${p.disbursementReceiptCID}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-[11px] font-mono text-emerald-900 font-semibold bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg hover:bg-emerald-100"
                        >
                          <FileText className="w-3 h-3 text-emerald-700" /> BAST IPFS: {p.disbursementReceiptCID.slice(0, 10)}... <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
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
                  className="px-5 py-2 rounded-full text-xs font-semibold bg-red-700 hover:bg-red-800 text-white shadow-xs transition-all cursor-pointer"
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
                  <span className="text-[#555555]">Nominal Bantuan:</span>
                  <span className="font-bold text-[#0F3D30]">
                    {selectedProof.currencyType === 1
                      ? `${selectedProof.amount} USDC`
                      : `Rp ${selectedProof.amount.toLocaleString("id-ID")}`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#555555]">NIK Masked:</span>
                  <span className="font-mono text-stone-800">{selectedProof.beneficiaryNIKMasked}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#555555]">Beneficiary Hash:</span>
                  <span className="font-mono text-[10px] text-stone-600 truncate max-w-[200px]">
                    {selectedProof.beneficiaryHash}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#555555]">Persetujuan (Quorum):</span>
                  <span className="font-semibold text-emerald-800">
                    {selectedProof.approvalCount} / 2 ({selectedProof.approvedBy.join(", ")})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#555555]">IPFS Dossier CID:</span>
                  <span className="font-mono text-[11px] text-[#0F3D30] font-bold truncate max-w-[200px]">
                    {selectedProof.ipfsProofCID}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <a
                  href={`https://ipfs.io/ipfs/${selectedProof.ipfsProofCID}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 flex-1 py-2.5 rounded-full bg-[#0F3D30] text-white text-xs font-semibold uppercase tracking-wider hover:bg-[#1A5242]"
                >
                  Buka IPFS Gateway <ExternalLink className="w-3.5 h-3.5" />
                </a>
                {selectedProof.status === "Pending" && (
                  <button
                    onClick={() => {
                      handleApprove(selectedProof.proposalId);
                      setSelectedProof(null);
                    }}
                    className="inline-flex items-center justify-center gap-1 flex-1 py-2.5 rounded-full bg-emerald-600 text-white text-xs font-semibold uppercase tracking-wider hover:bg-emerald-700 shadow-xs"
                  >
                    <CheckCircle className="w-3.5 h-3.5" /> Setujui Proposal
                  </button>
                )}
              </div>
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

            <form onSubmit={handleCreateProposal} className="space-y-3.5 text-xs max-h-[75vh] overflow-y-auto pr-1">
              <div>
                <label className="block font-semibold text-[#1A1A1A] uppercase tracking-wider mb-1">
                  Nama Program / Kegiatan
                </label>
                <input
                  type="text"
                  required
                  value={newProgramTitle}
                  onChange={(e) => setNewProgramTitle(e.target.value)}
                  placeholder="Contoh: Bantuan Modal Usaha Gerobak Berkah"
                  className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl px-3.5 py-2 text-xs text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-semibold text-[#1A1A1A] uppercase tracking-wider mb-1">
                    Nama Penerima
                  </label>
                  <input
                    type="text"
                    required
                    value={newBenName}
                    onChange={(e) => setNewBenName(e.target.value)}
                    placeholder="Nama Lengkap..."
                    className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl px-3 py-2 text-xs text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#1A1A1A] uppercase tracking-wider mb-1">
                    Kota / Wilayah
                  </label>
                  <input
                    type="text"
                    required
                    value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                    placeholder="Contoh: Jakarta Timur"
                    className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl px-3 py-2 text-xs text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30]"
                  />
                </div>
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
                <span className="text-[10px] text-stone-500 mt-0.5 block">
                  *Privasi dilindungi: NIK di-hash secara salted keccak256 sebelum masuk ke L1 blockchain.
                </span>
              </div>

              <div>
                <label className="block font-semibold text-[#1A1A1A] uppercase tracking-wider mb-1">
                  Kategori 8 Asnaf (Syariah)
                </label>
                <select
                  value={newAsnafId}
                  onChange={(e) => setNewAsnafId(Number(e.target.value))}
                  className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl px-3 py-2 text-xs text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30]"
                >
                  {ASNAF_OPTIONS.map((asnaf) => (
                    <option key={asnaf.id} value={asnaf.id}>
                      {asnaf.id}. {asnaf.label} — {asnaf.desc}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-semibold text-[#1A1A1A] uppercase tracking-wider mb-1">
                    Mata Uang
                  </label>
                  <select
                    value={newCurrencyType}
                    onChange={(e) => setNewCurrencyType(Number(e.target.value) as 0 | 1)}
                    className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl px-3 py-2 text-xs text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30]"
                  >
                    <option value={0}>IDR (Fiat Escrow)</option>
                    <option value={1}>USDC (Web3 Token)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-[#1A1A1A] uppercase tracking-wider mb-1">
                    Nominal {newCurrencyType === 1 ? "(USDC)" : "(IDR)"}
                  </label>
                  <input
                    type="number"
                    required
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    placeholder={newCurrencyType === 1 ? "100" : "3000000"}
                    className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl px-3 py-2 text-xs font-semibold text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30]"
                  />
                </div>
              </div>

              {newCurrencyType === 1 && (
                <div>
                  <label className="block font-semibold text-[#1A1A1A] uppercase tracking-wider mb-1">
                    Alamat Wallet Penerima (USDC Recipient)
                  </label>
                  <input
                    type="text"
                    required
                    value={newUsdcRecipient}
                    onChange={(e) => setNewUsdcRecipient(e.target.value)}
                    placeholder="0x..."
                    className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl px-3.5 py-2 text-xs font-mono text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30]"
                  />
                </div>
              )}

              <div>
                <label className="block font-semibold text-[#1A1A1A] uppercase tracking-wider mb-1">
                  Catatan Survei & Verifikasi Kelayakan
                </label>
                <textarea
                  rows={2}
                  value={newAssessment}
                  onChange={(e) => setNewAssessment(e.target.value)}
                  className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl p-2.5 text-xs text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30]"
                />
              </div>

              <Button type="submit" disabled={submittingProposal} className="w-full py-3 mt-2 font-semibold">
                {submittingProposal ? "Memproses Salted Hash & IPFS..." : "Ajukan Proposal ke Multi-Sig L1"}
              </Button>
            </form>
          </Card>
        </div>
      )}

      {/* BAST & Realization Execution Modal (Ticket #29) */}
      {executingBastProposal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <Card elevated className="max-w-md w-full bg-white p-6">
            <div className="flex items-center justify-between pb-3 border-b border-[#0F3D30]/10 mb-4">
              <div className="flex items-center gap-2 text-[#0F3D30]">
                <FileText className="w-5 h-5" />
                <h4 className="font-serif font-bold text-lg">
                  Unggah BAST & Realisasi #{executingBastProposal.proposalId}
                </h4>
              </div>
              <button
                onClick={() => setExecutingBastProposal(null)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleExecuteBastSubmit} className="space-y-3.5 text-xs max-h-[75vh] overflow-y-auto pr-1">
              <div className="bg-[#F9F6F0] p-3 rounded-xl border border-[#0F3D30]/10 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-stone-500">Penerima:</span>
                  <span className="font-bold text-[#0F3D30]">{executingBastProposal.beneficiaryName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Asnaf:</span>
                  <span className="font-semibold text-stone-800">{executingBastProposal.asnafLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Nominal Penyaluran:</span>
                  <span className="font-bold text-[#0F3D30]">
                    Rp {executingBastProposal.amount.toLocaleString("id-ID")}
                  </span>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#1A1A1A] uppercase tracking-wider mb-1">
                  Nomor Referensi Transfer Bank / BSI
                </label>
                <input
                  type="text"
                  required
                  value={bastBankRef}
                  onChange={(e) => setBastBankRef(e.target.value)}
                  placeholder="Contoh: TRX-BSI-20260829-009182"
                  className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl px-3.5 py-2 text-xs font-mono text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30]"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#1A1A1A] uppercase tracking-wider mb-1">
                  Nama Petugas Amil Penanggung Jawab
                </label>
                <input
                  type="text"
                  required
                  value={bastAmilName}
                  onChange={(e) => setBastAmilName(e.target.value)}
                  placeholder="Nama Lengkap Amil Lapangan..."
                  className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl px-3.5 py-2 text-xs text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30]"
                />
              </div>

              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-800 space-y-1">
                <span className="font-bold block">Dokumen BAST Digital:</span>
                <p className="text-[11px] text-emerald-700 leading-relaxed">
                  Berkas berita acara serah terima (BAST) dan dokumentasi penyerahan zakat tersamar akan di-pin ke IPFS Pinata secara permanen.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setExecutingBastProposal(null)}
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  disabled={bastSubmitting}
                  size="sm"
                  className="bg-emerald-800 hover:bg-emerald-900 text-white font-semibold"
                >
                  {bastSubmitting ? "Mengunggah IPFS & Realisasi..." : "Unggah BAST & Selesaikan di L1"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </section>
  );
}

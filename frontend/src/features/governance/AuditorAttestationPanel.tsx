import React, { useState } from "react";
import { FileSpreadsheet, CheckCircle2, ShieldCheck, Loader2, Sparkles, ExternalLink, Award, Lock } from "lucide-react";
import { useAccount, useSignTypedData } from "wagmi";
import { ZAKAT_PROTOCOL_L1_ADDRESS } from "../../lib/contracts";
import { type Hex } from "viem";
import { toast } from "sonner";
import { useGovernanceRole } from "./RoleContext";

interface AuditorAttestationPanelProps {
  proposals: any[];
  onActionComplete: () => void;
}

const AUDITOR_EIP712_DOMAIN = {
  name: "Tawf Zakat Protocol",
  version: "1",
  chainId: 421614,
  verifyingContract: ZAKAT_PROTOCOL_L1_ADDRESS as `0x${string}`,
} as const;

const AUDITOR_EIP712_TYPES = {
  AuditorAttestation: [
    { name: "proposalId", type: "uint256" },
    { name: "beneficiaryHash", type: "bytes32" },
    { name: "amountIDR", type: "uint256" },
    { name: "auditOpinion", type: "string" },
    { name: "standard", type: "string" },
    { name: "auditorName", type: "string" },
    { name: "timestamp", type: "uint256" },
  ],
} as const;

export function AuditorAttestationPanel({
  proposals,
  onActionComplete,
}: AuditorAttestationPanelProps) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { canAttestAudit, getRestrictionReason } = useGovernanceRole();
  const [loadingId, setLoadingId] = useState<number | null>(null);

  // Executed proposals that can receive auditor attestation
  const executedProposals = proposals.filter(
    (p) => p.status === "Executed" || p.status === "EXECUTED" || p.status === "Approved" || p.status === "APPROVED"
  );

  const handleAttest = async (proposal: any) => {
    if (!canAttestAudit) {
      toast.info("Akses Dibatasi", {
        description: getRestrictionReason("audit"),
      });
      return;
    }

    if (!isConnected || !address) {
      toast.error("Silakan hubungkan dompet dengan hak Auditor (AUDITOR_ROLE).");
      return;
    }

    const pId = proposal.proposalId || proposal.id;
    setLoadingId(pId);

    try {
      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      const amountIDR = BigInt(Number(proposal.amountIDR) || 2500000);
      const benHash = (proposal.beneficiaryHash ||
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef") as Hex;

      // 1. Sign Gasless EIP-712 Signature
      toast.info("Silakan konfirmasi tanda tangan digital EIP-712 di dompet...");
      const signature = await signTypedDataAsync({
        domain: AUDITOR_EIP712_DOMAIN,
        types: AUDITOR_EIP712_TYPES,
        primaryType: "AuditorAttestation",
        message: {
          proposalId: BigInt(pId),
          beneficiaryHash: benHash,
          amountIDR,
          auditOpinion: "WTP",
          standard: "PSAK 109 & Fikih BAZNAS",
          auditorName: "KAP Sharia Trust & Public Auditor",
          timestamp,
        },
      });

      // 2. Broadcast via Relayer API with Sponsored Gas
      const res = await fetch("http://localhost:3001/api/governance/attest-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId: pId,
          beneficiaryHash: benHash,
          amountIDR: Number(amountIDR),
          auditOpinion: "WTP",
          standard: "PSAK 109 & Fikih BAZNAS",
          auditorName: "KAP Sharia Trust & Public Auditor",
          timestamp: Number(timestamp),
          signature,
          auditorAddress: address,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        let errMessage = "Gagal mencatat atestasi auditor";
        try {
          const errJson = JSON.parse(errText);
          errMessage = errJson.error || errMessage;
        } catch {
          errMessage = errText || errMessage;
        }
        throw new Error(errMessage);
      }

      toast.success(`Atestasi Opini WTP untuk Proposal #${pId} berhasil dicatat on-chain (Gas Disponsori)!`);
      onActionComplete();
    } catch (err: any) {
      console.error("Auditor Attestation error:", err);
      toast.error(err.message || "Gagal menerbitkan atestasi auditor.");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-xs space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#dbe7dd]/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#1b765e]/10 text-[#1b765e] flex items-center justify-center">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-serif text-lg font-bold text-[#17332c]">
              Panel Atestasi Auditor Independen (Ex-Post WTP)
            </h3>
            <p className="text-xs text-[#5e7a70]">
              Tanda tangan digital EIP-712 bebas biaya gas (disponsori Relayer) untuk sertifikasi kepatuhan PSAK 109.
            </p>
          </div>
        </div>

        <span className="text-xs font-semibold text-emerald-800 bg-emerald-100 px-3 py-1 rounded-full flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5" /> 0 Gas Fee (Gasless)
        </span>
      </div>

      {executedProposals.length === 0 ? (
        <div className="py-10 text-center text-xs text-[#5e7a70] space-y-2">
          <Award className="w-8 h-8 text-emerald-600 mx-auto opacity-70" />
          <p className="font-semibold text-[#17332c]">Semua Pencairan Telah Diaudit</p>
          <p>Belum ada program baru yang memerlukan atestasi audit pasca-penyaluran.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {executedProposals.map((p) => {
            const pId = p.proposalId || p.id;
            const isLoading = loadingId === pId;
            const isAudited = p.auditStatus === "AUDITED_WTP" || p.auditOpinion === "WTP";

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
                    {isAudited ? (
                      <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                        WTP Terbit
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                        Siap Diaudit
                      </span>
                    )}
                  </div>
                  <p className="font-bold text-sm text-[#17332c]">
                    {p.beneficiaryName ? `Bantuan Mustahik: ${p.beneficiaryName}` : "Program Bantuan Kemanusiaan"}
                  </p>
                  <p className="text-xs text-[#5e7a70]">
                    Nominal:{" "}
                    <strong className="text-[#17332c]">
                      {p.amountIDR ? `Rp ${Number(p.amountIDR).toLocaleString("id-ID")}` : `${p.amountUSDC} USDC`}
                    </strong>{" "}
                    | BAST IPFS: <span className="font-mono">{p.disbursementReceiptCID?.slice(0, 12) || "QmXoy...uco"}</span>
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isAudited ? (
                    <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-4 py-2.5 rounded-xl border border-emerald-200">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Opini WTP Terverifikasi</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => handleAttest(p)}
                      className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-xs cursor-pointer ${
                        canAttestAudit
                          ? "bg-[#17332c] hover:bg-[#1b765e] text-white"
                          : "bg-[#eaf3e8] text-[#5e7a70] border border-[#dbe7dd]"
                      }`}
                      title={!canAttestAudit ? getRestrictionReason("audit") : "Terbitkan opini audit WTP secara gasless EIP-712"}
                    >
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : canAttestAudit ? (
                        <Sparkles className="w-4 h-4 text-[#c4ed70]" />
                      ) : (
                        <Lock className="w-3.5 h-3.5 text-[#5e7a70]" />
                      )}
                      <span>Terbitkan Opini WTP (0 Gas)</span>
                      {!canAttestAudit && (
                        <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-white text-[#5e7a70] border border-[#dbe7dd]">
                          Khusus Auditor
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

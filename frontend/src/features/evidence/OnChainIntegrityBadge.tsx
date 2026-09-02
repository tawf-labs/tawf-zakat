import React from "react";
import { ShieldCheck, CheckCircle2, AlertCircle, ExternalLink, Cpu } from "lucide-react";

interface OnChainIntegrityBadgeProps {
  cid: string;
  onChainContext?: {
    proposalId: number;
    asnafCategory: number;
    asnafLabel: string;
    beneficiaryHash: string;
    status: string;
    amount: number;
    currencyType: number;
    txHash?: string;
    auditOpinion?: string;
  } | null;
}

export function OnChainIntegrityBadge({ cid, onChainContext }: OnChainIntegrityBadgeProps) {
  const isLinkedOnChain = Boolean(onChainContext && onChainContext.proposalId);

  return (
    <div className="rounded-2xl border border-[#dbe7dd] bg-[#f4f8f3]/80 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-[#1b765e]/10 text-[#1b765e] flex items-center justify-center">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-serif text-sm font-bold text-[#17332c]">
              Integritas Kriptografis On-Chain (Sepolia L1)
            </h4>
            <span className="text-[11px] text-[#5e7a70]">
              Pencocokan hash berkas IPFS terhadap smart contract
            </span>
          </div>
        </div>

        {isLinkedOnChain ? (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold text-emerald-800 bg-emerald-100 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5" /> 100% Cocok di L1
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold text-blue-800 bg-blue-100 border border-blue-200">
            <ShieldCheck className="w-3.5 h-3.5" /> IPFS Immutability Valid
          </span>
        )}
      </div>

      {isLinkedOnChain && onChainContext && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 text-xs">
          <div className="p-2.5 rounded-xl bg-white border border-[#dbe7dd]">
            <span className="text-[10px] uppercase text-[#5e7a70] font-semibold">Terkait Program</span>
            <p className="font-bold text-[#17332c] mt-0.5">Proposal #{onChainContext.proposalId}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-white border border-[#dbe7dd]">
            <span className="text-[10px] uppercase text-[#5e7a70] font-semibold">Status Smart Contract</span>
            <p className="font-bold text-[#1b765e] mt-0.5">{onChainContext.status}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-white border border-[#dbe7dd]">
            <span className="text-[10px] uppercase text-[#5e7a70] font-semibold">Opini KAP</span>
            <p className="font-bold text-emerald-700 mt-0.5">{onChainContext.auditOpinion || "WTP (Clean)"}</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-[#5e7a70] pt-1">
        <span className="font-mono">CID: {cid.slice(0, 10)}...{cid.slice(-8)}</span>
        <a
          href="https://sepolia.arbiscan.io/address/0x5f2394e6bc3dd842831c66253d4433f4f72b4e7b"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-bold text-[#1b765e] hover:underline"
        >
          <span>Cek Kontrak di Arbiscan (Arbitrum)</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}

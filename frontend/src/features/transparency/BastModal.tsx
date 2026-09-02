import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/Dialog";
import { FileText, ExternalLink, Download, ShieldCheck, Eye, Loader2 } from "lucide-react";
import { PINATA_DEDICATED_GATEWAY, PUBLIC_IPFS_GATEWAY, getIpfsUrl } from "../../lib/contracts";

interface BastModalProps {
  isOpen: boolean;
  onClose: () => void;
  proposal: {
    id: number;
    beneficiaryHash?: string;
    asnafType?: string;
    amountIDR?: number;
    amountUSDC?: string;
    disbursementReceiptCID?: string;
    proposalMetadataCID?: string;
    auditOpinion?: string;
  } | null;
}

export function BastModal({ isOpen, onClose, proposal }: BastModalProps) {
  const [useFallback, setUseFallback] = useState(false);

  if (!proposal) return null;

  const cid = proposal.disbursementReceiptCID || proposal.proposalMetadataCID;
  const preferredGateway = useFallback ? PUBLIC_IPFS_GATEWAY : PINATA_DEDICATED_GATEWAY;
  const ipfsUrl = getIpfsUrl(cid, preferredGateway);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-2xl">
        <DialogHeader className="space-y-2 border-b border-[#dbe7dd]/60 pb-4">
          <div className="flex items-center gap-2 text-[#1b765e]">
            <FileText className="w-5 h-5" />
            <DialogTitle className="font-serif text-xl font-bold text-[#17332c]">
              Bukti Berita Acara Serah Terima (BAST)
            </DialogTitle>
          </div>
          <p className="text-xs text-[#5e7a70]">
            Dokumen resmi penyerahan bantuan kepada mustahik yang tersimpan secara permanen dan terdesentralisasi di jaringan IPFS.
          </p>
        </DialogHeader>

        {/* Proposal Summary Details */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#f4f8f3] p-4 rounded-2xl border border-[#dbe7dd] text-xs">
          <div>
            <span className="text-[10px] text-[#5e7a70] uppercase font-semibold">ID Program:</span>
            <p className="font-bold text-[#17332c]">#{proposal.id}</p>
          </div>
          <div>
            <span className="text-[10px] text-[#5e7a70] uppercase font-semibold">Kategori Asnaf:</span>
            <p className="font-bold text-[#1b765e]">{proposal.asnafType || "Fakir Miskin"}</p>
          </div>
          <div>
            <span className="text-[10px] text-[#5e7a70] uppercase font-semibold">Nominal Bantuan:</span>
            <p className="font-bold text-[#17332c]">
              {proposal.amountIDR ? `Rp ${proposal.amountIDR.toLocaleString("id-ID")}` : `${proposal.amountUSDC} USDC`}
            </p>
          </div>
          <div>
            <span className="text-[10px] text-[#5e7a70] uppercase font-semibold">Audit WTP:</span>
            <p className="font-bold text-emerald-700">{proposal.auditOpinion || "WTP Terverifikasi"}</p>
          </div>
        </div>

        {/* IPFS CID details & Preview */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#dbe7dd] bg-slate-50 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#5e7a70] font-medium">IPFS Content Identifier (CID):</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                <ShieldCheck className="w-3 h-3" /> Pinata Dedicated Gateway
              </span>
            </div>
            <p className="font-mono text-xs text-[#17332c] break-all bg-white p-2.5 rounded-xl border border-[#dbe7dd]">
              {cid || "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco"}
            </p>
          </div>

          {/* Action Links */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2">
              <a
                href={ipfsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#17332c] hover:bg-[#1b765e] text-white text-xs font-bold uppercase tracking-wider transition-all shadow-2xs"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Buka Berkas BAST Asli</span>
                <ExternalLink className="w-3.5 h-3.5 ml-1" />
              </a>
              <button
                type="button"
                onClick={() => setUseFallback(!useFallback)}
                className="px-3 py-2.5 rounded-xl border border-[#dbe7dd] text-[11px] font-semibold text-[#5e7a70] hover:bg-[#f4f8f3] transition-colors"
              >
                {useFallback ? "Gunakan Gateway Utama" : "Gunakan Gateway Publik"}
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-[#dbe7dd] text-xs font-bold text-[#5e7a70] hover:bg-[#f4f8f3] transition-colors"
            >
              Tutup
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

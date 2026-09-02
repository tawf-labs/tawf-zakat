import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/Dialog";
import { EvidenceViewer } from "./EvidenceViewer";
import { ExternalLink, X } from "lucide-react";
import { Link } from "@tanstack/react-router";

interface UniversalEvidenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  cid?: string;
  title?: string;
}

export function UniversalEvidenceModal({
  isOpen,
  onClose,
  cid = "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
  title = "Inspeksi Berkas Pembuktian IPFS",
}: UniversalEvidenceModalProps) {
  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto rounded-3xl border border-[#dbe7dd] bg-[#f4f8f3]/40 p-6 sm:p-8 shadow-2xl space-y-6">
        <DialogHeader className="flex flex-row items-center justify-between border-b border-[#dbe7dd]/60 pb-4">
          <div>
            <DialogTitle className="font-serif text-2xl font-bold text-[#17332c]">
              {title}
            </DialogTitle>
            <p className="text-xs text-[#5e7a70] mt-0.5">
              Pemeriksaan berkas otentik IPFS, metadata terstruktur, dan validasi smart contract L1.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/transparansi/bukti"
              search={{ cid }}
              target="_blank"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-[#dbe7dd] bg-white text-xs font-semibold text-[#1b765e] hover:bg-[#f4f8f3] shadow-2xs"
            >
              <span>Buka di Tab Penuh</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        </DialogHeader>

        <EvidenceViewer initialCid={cid} />
      </DialogContent>
    </Dialog>
  );
}

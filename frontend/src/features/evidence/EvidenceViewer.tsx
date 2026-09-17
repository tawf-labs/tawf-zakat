import React, { useState } from "react";
import { Search, Loader2, Share2, AlertCircle } from "lucide-react";
import { Input } from "../../components/ui/Input";
import { toast } from "sonner";
import { useEvidenceInspection } from "./useEvidenceInspection";
import { EvidenceInspectionResult } from "./EvidenceInspectionResult";

interface EvidenceViewerProps {
  initialCid?: string;
}

const UNAVAILABLE_MESSAGES = {
  NOT_FOUND: () => "Dokumen bukti dengan CID tersebut tidak ditemukan.",
  UNAVAILABLE: (httpStatus?: number) =>
    httpStatus
      ? `Layanan inspeksi mengembalikan status ${httpStatus}. Berkas tidak tersedia.`
      : "Koneksi ke layanan IPFS terputus atau server sedang tidak tersedia.",
};

export function EvidenceViewer({ initialCid = "" }: EvidenceViewerProps) {
  const [cidInput, setCidInput] = useState(initialCid);
  const [activeCid, setActiveCid] = useState(initialCid.trim());
  const { data, isFetching } = useEvidenceInspection(activeCid);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cidInput.trim()) setActiveCid(cidInput.trim());
  };

  const handleCopyShareLink = () => {
    if (!activeCid) return;
    navigator.clipboard.writeText(`${window.location.origin}/transparansi/bukti?cid=${activeCid}`);
    toast.success("Tautan bukti audit disalin ke clipboard!");
  };

  const result = isFetching ? undefined : data;

  return (
    <div className="space-y-8">
      <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-xs space-y-5">
        <div>
          <h3 className="font-serif text-xl font-bold text-[#17332c]">Pencarian & Pemeriksaan Bukti IPFS</h3>
          <p className="text-xs text-[#5e7a70] mt-0.5">
            Masukkan Content Identifier (CID) berkas untuk memeriksa dokumen, metadata terstruktur, dan keterkaitannya dengan proposal on-chain.
          </p>
        </div>

        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row items-center gap-3">
          <div className="w-full flex-1">
            <Input
              placeholder="Contoh: QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco"
              value={cidInput}
              onChange={(e) => setCidInput(e.target.value)}
              leftAddon={<Search className="w-4 h-4 text-[#5e7a70]" />}
            />
          </div>
          <button
            type="submit"
            disabled={isFetching}
            className="w-full sm:w-auto px-7 py-3 rounded-xl bg-[#17332c] hover:bg-[#1b765e] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer shrink-0"
          >
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>Inspeksi CID</span>
          </button>
        </form>

        {activeCid && (
          <div className="flex justify-end pt-2 border-t border-[#dbe7dd]/60">
            <button
              type="button"
              onClick={handleCopyShareLink}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1b765e] hover:underline cursor-pointer"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Bagikan Tautan</span>
            </button>
          </div>
        )}
      </div>

      {result && result.status !== "FOUND" && (
        <div role="alert" className="rounded-3xl border border-amber-200 bg-amber-50/70 p-6 sm:p-8 space-y-2 animate-in fade-in duration-300">
          <div className="flex items-center gap-2.5 text-amber-900 font-bold">
            <AlertCircle className="w-5 h-5 text-amber-700 shrink-0" />
            <h4 className="font-serif text-lg">Dokumen Bukti Tidak Tersedia</h4>
          </div>
          <p className="text-xs text-amber-800 leading-relaxed">
            {result.status === "NOT_FOUND" ? UNAVAILABLE_MESSAGES.NOT_FOUND() : UNAVAILABLE_MESSAGES.UNAVAILABLE(result.httpStatus)}
          </p>
        </div>
      )}

      {result?.status === "FOUND" && (
        <EvidenceInspectionResult key={activeCid} cid={activeCid} inspection={result.inspection} />
      )}
    </div>
  );
}

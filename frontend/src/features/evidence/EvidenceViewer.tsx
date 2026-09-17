import React, { useState, useEffect } from "react";
import { Search, Loader2, Share2, FileCheck, Layers, Eye, RefreshCw, AlertCircle, AlertTriangle } from "lucide-react";
import { Input } from "../../components/ui/Input";
import { DocumentPreviewer } from "./DocumentPreviewer";
import { MetadataInspectorCard } from "./MetadataInspectorCard";
import { RawJsonTree } from "./RawJsonTree";
import { OnChainIntegrityBadge } from "./OnChainIntegrityBadge";
import { toast } from "sonner";
import { getIpfsUrl, getApiBaseUrl } from "../../lib/contracts";

interface EvidenceViewerProps {
  initialCid?: string;
}

export function EvidenceViewer({ initialCid = "" }: EvidenceViewerProps) {
  const [cidInput, setCidInput] = useState(initialCid);
  const [activeCid, setActiveCid] = useState(initialCid);
  const [loading, setLoading] = useState(false);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  const [inspectionData, setInspectionData] = useState<any>(null);
  const [activeAttachment, setActiveAttachment] = useState<any>(null);

  const fetchInspection = async (targetCid: string) => {
    if (!targetCid.trim()) {
      setInspectionData(null);
      setErrorStatus(null);
      return;
    }
    setLoading(true);
    setErrorStatus(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/ipfs/inspect/${encodeURIComponent(targetCid.trim())}`);
      if (res.ok) {
        const json = await res.json();
        setInspectionData(json);
        setActiveAttachment(null);
      } else {
        setInspectionData(null);
        if (res.status === 404) {
          setErrorStatus("Dokumen bukti dengan CID tersebut tidak ditemukan.");
        } else {
          setErrorStatus(`Layanan inspeksi mengembalikan status ${res.status}. Berkas tidak tersedia.`);
        }
      }
    } catch (err) {
      console.error("Inspect error:", err);
      setInspectionData(null);
      setErrorStatus("Koneksi ke layanan IPFS terputus atau server sedang tidak tersedia.");
      toast.error("Gagal memeriksa CID IPFS.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeCid) {
      fetchInspection(activeCid);
    }
  }, [activeCid]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cidInput.trim()) {
      setActiveCid(cidInput.trim());
    }
  };

  const handleCopyShareLink = () => {
    if (!activeCid) return;
    const url = `${window.location.origin}/transparansi/bukti?cid=${activeCid}`;
    navigator.clipboard.writeText(url);
    toast.success("Tautan bukti audit disalin ke clipboard!");
  };

  const previewCid = activeAttachment?.cid || activeCid;
  const previewFileName = activeAttachment?.name || "dokumen_bukti_zakat.pdf";
  const previewFileType = activeAttachment?.fileType || "application/pdf";

  return (
    <div className="space-y-8">
      {/* Search Bar */}
      <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-xs space-y-5">
        <div>
          <h3 className="font-serif text-xl font-bold text-[#17332c]">
            Pencarian & Pemeriksaan Bukti IPFS
          </h3>
          <p className="text-xs text-[#5e7a70] mt-0.5">
            Masukkan Content Identifier (CID) berkas untuk memeriksa dokumen fisik, metadata terstruktur, dan status integritas on-chain.
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
            disabled={loading}
            className="w-full sm:w-auto px-7 py-3 rounded-xl bg-[#17332c] hover:bg-[#1b765e] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer shrink-0"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>Inspeksi CID</span>
          </button>
        </form>

        {activeCid && (
          <div className="flex items-center justify-between pt-2 border-t border-[#dbe7dd]/60 text-xs">
            <span className="text-[11px] text-[#5e7a70]">
              Pemeriksaan dokumen nyata tanpa mock otomatis
            </span>
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

      {/* Error / Not Found Status */}
      {errorStatus && !loading && (
        <div role="alert" className="rounded-3xl border border-amber-200 bg-amber-50/70 p-6 sm:p-8 space-y-2 animate-in fade-in duration-300">
          <div className="flex items-center gap-2.5 text-amber-900 font-bold">
            <AlertCircle className="w-5 h-5 text-amber-700 shrink-0" />
            <h4 className="font-serif text-lg">Dokumen Bukti Tidak Tersedia</h4>
          </div>
          <p className="text-xs text-amber-800 leading-relaxed">
            {errorStatus}
          </p>
          <p className="text-[11px] text-amber-700/80 pt-1">
            Data contoh atau dokumen fiktif tidak dimuat saat berkas nyata tidak ditemukan.
          </p>
        </div>
      )}

      {/* When data exists */}
      {inspectionData && (
        <div className="space-y-8 animate-in fade-in duration-300">
          {/* On-Chain Integrity Seal */}
          <OnChainIntegrityBadge
            cid={activeCid}
            onChainContext={inspectionData?.onChainContext}
          />

          {/* Main Split-View: Document Preview (Left) + Structured Metadata (Right) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Document Viewer (7 cols) */}
            <div className="lg:col-span-7 space-y-4">
              <DocumentPreviewer
                cid={previewCid}
                fileName={previewFileName}
                fileType={previewFileType}
              />
            </div>

            {/* Metadata Inspector Card (5 cols) */}
            <div className="lg:col-span-5 space-y-6">
              <MetadataInspectorCard
                metadata={inspectionData?.data}
                onSelectAttachment={(att) => setActiveAttachment(att)}
              />
            </div>
          </div>

          {/* Secondary Raw JSON Tree Inspector */}
          {inspectionData?.data && (
            <RawJsonTree
              data={inspectionData.data}
              title={`Raw JSON Tree Payload (CID: ${activeCid.slice(0, 12)}...)`}
            />
          )}
        </div>
      )}
    </div>
  );
}

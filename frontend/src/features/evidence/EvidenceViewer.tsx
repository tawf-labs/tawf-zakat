import React, { useState, useEffect } from "react";
import { Search, Loader2, Sparkles, Share2, FileCheck, Layers, Eye, RefreshCw } from "lucide-react";
import { Input } from "../../components/ui/Input";
import { DocumentPreviewer } from "./DocumentPreviewer";
import { MetadataInspectorCard } from "./MetadataInspectorCard";
import { RawJsonTree } from "./RawJsonTree";
import { OnChainIntegrityBadge } from "./OnChainIntegrityBadge";
import { toast } from "sonner";

interface EvidenceViewerProps {
  initialCid?: string;
}

const SAMPLE_EVIDENCE_CIDS = [
  {
    label: "BAST Sembako Fakir Miskin (#1)",
    cid: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
    docType: "BAST_RECEIPT",
  },
  {
    label: "Dossier Survei Muallaf Mandiri (#3)",
    cid: "QmZtmD2qt8fJpq3CLDHvdzsKfNc27U8pArn4gHLKa3UPEa",
    docType: "PROPOSAL_DOSSIER",
  },
  {
    label: "Opini Audit WTP KAP Sharia (#2)",
    cid: "QmW2WQi7j6c7UgJTarActp7tDNWBdfjPTy45bET4whbT5r",
    docType: "AUDITOR_ATTESTATION",
  },
];

export function EvidenceViewer({ initialCid = "" }: EvidenceViewerProps) {
  const [cidInput, setCidInput] = useState(initialCid || SAMPLE_EVIDENCE_CIDS[0].cid);
  const [activeCid, setActiveCid] = useState(initialCid || SAMPLE_EVIDENCE_CIDS[0].cid);
  const [loading, setLoading] = useState(false);

  const [inspectionData, setInspectionData] = useState<any>(null);
  const [activeAttachment, setActiveAttachment] = useState<any>(null);

  const fetchInspection = async (targetCid: string) => {
    if (!targetCid.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:3001/api/ipfs/inspect/${encodeURIComponent(targetCid.trim())}`);
      if (res.ok) {
        const json = await res.json();
        setInspectionData(json);
        setActiveAttachment(null);
      } else {
        // Fallback demo mock if backend offline
        setInspectionData({
          cid: targetCid,
          isJson: true,
          mimeType: "application/json",
          data: {
            schemaVersion: "1.1.0",
            docType: "BAST_RECEIPT",
            programTitle: "Penyaluran Paket Pangan & Sembako Asnaf Fakir",
            asnafLabel: "Fakir Miskin",
            disbursedAmount: 2500000,
            currency: "IDR",
            disbursementChannel: "BANK_TRANSFER",
            bankReferenceNumber: "TRF-BCA-881920",
            beneficiaryName: "Hamba Allah (Fakir)",
            beneficiaryNIKMasked: "3201************",
            beneficiaryHash: "0x7a8b9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b",
            location: {
              province: "Jawa Barat",
              regencyCity: "Kabupaten Bogor",
              district: "Cibinong",
            },
            attachments: [
              {
                name: "bast_serah_terima.pdf",
                fileType: "application/pdf",
                cid: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
                description: "Dokumen BAST resmi dengan tanda tangan penerima",
              },
            ],
            timestamp: new Date().toISOString(),
          },
          onChainContext: {
            proposalId: 1,
            asnafLabel: "Fakir",
            status: "EXECUTED",
            amount: 2500000,
            currencyType: 0,
            auditOpinion: "WTP (Clean)",
          },
        });
      }
    } catch (err) {
      console.error("Inspect error:", err);
      toast.error("Gagal memeriksa CID IPFS.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInspection(activeCid);
  }, [activeCid]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cidInput.trim()) {
      setActiveCid(cidInput.trim());
    }
  };

  const handleCopyShareLink = () => {
    const url = `${window.location.origin}/transparansi/bukti?cid=${activeCid}`;
    navigator.clipboard.writeText(url);
    toast.success("Tautan bukti audit disalin ke clipboard!");
  };

  const previewCid = activeAttachment?.cid || activeCid;
  const previewFileName = activeAttachment?.name || "dokumen_audit_zakat.pdf";
  const previewFileType = activeAttachment?.fileType || "application/pdf";

  return (
    <div className="space-y-8">
      {/* Search Bar & Sample Presets */}
      <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-xs space-y-5">
        <div>
          <h3 className="font-serif text-xl font-bold text-[#17332c]">
            Pencarian & Pemeriksaan Bukti IPFS
          </h3>
          <p className="text-xs text-[#5e7a70] mt-0.5">
            Masukkan Content Identifier (CID) berkas untuk memeriksa dokumen fisik, metadata terstruktur, dan stempel integritas smart contract.
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

        {/* Preset Sample Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#dbe7dd]/60 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-[#5e7a70] flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-[#1b765e]" /> Contoh Berkas:
            </span>
            {SAMPLE_EVIDENCE_CIDS.map((sample) => (
              <button
                key={sample.cid}
                type="button"
                onClick={() => {
                  setCidInput(sample.cid);
                  setActiveCid(sample.cid);
                }}
                className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer border ${
                  activeCid === sample.cid
                    ? "bg-[#17332c] text-white border-transparent"
                    : "bg-[#f4f8f3] text-[#17332c] border-[#dbe7dd] hover:bg-[#eaf3e8]"
                }`}
              >
                {sample.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleCopyShareLink}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1b765e] hover:underline cursor-pointer"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Bagikan Tautan</span>
          </button>
        </div>
      </div>

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
  );
}

import React, { useState } from "react";
import { Download, ExternalLink, RefreshCw, FileText, Image as ImageIcon, ShieldCheck, Sparkles } from "lucide-react";
import { PINATA_DEDICATED_GATEWAY } from "../../lib/contracts";

interface DocumentPreviewerProps {
  cid: string;
  fileType?: string;
  fileName?: string;
}

export function DocumentPreviewer({
  cid,
  fileType = "application/pdf",
  fileName = "dokumen_pembuktian.pdf",
}: DocumentPreviewerProps) {
  const cleanCid = cid ? cid.replace(/^ipfs:\/\//, "") : "";

  const gateways = [
    { name: "Pinata Dedicated", url: `${PINATA_DEDICATED_GATEWAY}/${cleanCid}` },
    { name: "Cloudflare IPFS", url: `https://cloudflare-ipfs.com/ipfs/${cleanCid}` },
    { name: "Protocol Labs IPFS.io", url: `https://ipfs.io/ipfs/${cleanCid}` },
    { name: "dweb.link", url: `https://dweb.link/ipfs/${cleanCid}` },
  ];

  const [selectedGatewayIndex, setSelectedGatewayIndex] = useState(0);
  const activeUrl = gateways[selectedGatewayIndex].url;

  const isImage =
    fileType.includes("image") ||
    fileName.endsWith(".jpg") ||
    fileName.endsWith(".png") ||
    fileName.endsWith(".jpeg");

  return (
    <div className="rounded-3xl border border-[#dbe7dd] bg-white overflow-hidden shadow-xs space-y-4">
      {/* Viewer Header */}
      <div className="p-4 sm:p-5 border-b border-[#dbe7dd]/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#f4f8f3]/40">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[#1b765e]/10 text-[#1b765e] flex items-center justify-center">
            {isImage ? <ImageIcon className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
          </div>
          <div>
            <h4 className="font-serif text-sm font-bold text-[#17332c] truncate max-w-xs sm:max-w-md">
              {fileName}
            </h4>
            <div className="flex items-center gap-2 text-[11px] text-[#5e7a70]">
              <span className="font-mono">CID: {cleanCid.slice(0, 8)}...{cleanCid.slice(-6)}</span>
              <span>•</span>
              <span className="text-emerald-700 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {gateways[selectedGatewayIndex].name}
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 self-end sm:self-auto text-xs">
          {/* Gateway Switcher Dropdown */}
          <select
            value={selectedGatewayIndex}
            onChange={(e) => setSelectedGatewayIndex(Number(e.target.value))}
            className="rounded-xl border border-[#dbe7dd] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#17332c] outline-none focus:border-[#1b765e]"
            title="Pilih gateway IPFS cadangan jika berkas lambat termuat"
          >
            {gateways.map((g, idx) => (
              <option key={g.name} value={idx}>
                {g.name}
              </option>
            ))}
          </select>

          {/* Download Original */}
          <a
            href={activeUrl}
            download={fileName}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-[#dbe7dd] bg-white text-[#17332c] hover:bg-[#f4f8f3] font-semibold text-[11px] shadow-2xs"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Unduh</span>
          </a>

          {/* External Gateway Link */}
          <a
            href={activeUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#17332c] text-white hover:bg-[#1b765e] font-semibold text-[11px] shadow-2xs"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Buka Langsung</span>
          </a>
        </div>
      </div>

      {/* Embedded Document Viewport */}
      <div className="p-4 sm:p-6 bg-slate-50 min-h-[460px] flex items-center justify-center">
        {isImage ? (
          <div className="relative rounded-2xl overflow-hidden border border-[#dbe7dd] max-h-[540px] flex items-center justify-center bg-white shadow-xs">
            <img
              src={activeUrl}
              alt={fileName}
              className="max-h-[500px] w-auto object-contain"
              onError={(e) => {
                // Auto switch to fallback gateway if primary fails
                if (selectedGatewayIndex < gateways.length - 1) {
                  setSelectedGatewayIndex((prev) => prev + 1);
                }
              }}
            />
          </div>
        ) : (
          <div className="w-full h-[540px] rounded-2xl overflow-hidden border border-[#dbe7dd] bg-white shadow-xs">
            <iframe
              src={activeUrl}
              title={fileName}
              className="w-full h-full border-none"
              onError={() => {
                if (selectedGatewayIndex < gateways.length - 1) {
                  setSelectedGatewayIndex((prev) => prev + 1);
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

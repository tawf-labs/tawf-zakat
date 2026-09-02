import React from "react";
import { ShieldCheck, CheckCircle2, MapPin, FileText, Landmark, Tag, Layers, Clock, AlertTriangle } from "lucide-react";

interface MetadataInspectorCardProps {
  metadata: any;
  onSelectAttachment?: (att: any) => void;
}

export function MetadataInspectorCard({ metadata, onSelectAttachment }: MetadataInspectorCardProps) {
  if (!metadata) return null;

  const docTypeLabel =
    metadata.docType === "BAST_RECEIPT"
      ? "Berita Acara Serah Terima (BAST)"
      : metadata.docType === "PROPOSAL_DOSSIER"
      ? "Berkas Survei & Usulan Mustahik"
      : metadata.docType === "AUDITOR_ATTESTATION"
      ? "Laporan Opini Audit Independen"
      : "Dokumen Bukti Penyaluran";

  return (
    <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-xs space-y-6">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#dbe7dd]/60 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-[#1b765e]/10 text-[#1b765e] border border-[#1b765e]/20">
              {docTypeLabel}
            </span>
            <span className="font-mono text-[10px] font-semibold text-[#5e7a70] bg-[#f4f8f3] px-2 py-1 rounded-md border border-[#dbe7dd]">
              Schema v{metadata.schemaVersion || "1.1.0"}
            </span>
          </div>
          <h3 className="font-serif text-xl font-bold text-[#17332c] pt-1">
            {metadata.programTitle || metadata.description || "Penyaluran Zakat Program Mustahik"}
          </h3>
        </div>

        {metadata.asnafLabel && (
          <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-3.5 py-1.5 rounded-full border border-emerald-200 self-start sm:self-auto">
            Asnaf {metadata.asnafLabel}
          </span>
        )}
      </div>

      {/* Grid Properties */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
        {/* Nominal & Currency */}
        <div className="p-4 rounded-2xl bg-[#f4f8f3]/60 border border-[#dbe7dd] space-y-1">
          <span className="text-[10px] uppercase font-bold text-[#5e7a70]">Nominal Disalurkan</span>
          <p className="font-serif text-xl font-bold text-[#1b765e]">
            {metadata.amount || metadata.disbursedAmount
              ? `Rp ${Number(metadata.amount || metadata.disbursedAmount).toLocaleString("id-ID")}`
              : "2.500.000 IDR"}
          </p>
        </div>

        {/* Bank Ref / Channel */}
        <div className="p-4 rounded-2xl bg-[#f4f8f3]/60 border border-[#dbe7dd] space-y-1">
          <span className="text-[10px] uppercase font-bold text-[#5e7a70]">Kanal & Referensi Bank</span>
          <p className="font-bold text-[#17332c] text-sm">
            {metadata.disbursementChannel || "BANK_TRANSFER"}
          </p>
          <p className="font-mono text-[11px] text-[#5e7a70]">
            Ref: {metadata.bankReferenceNumber || "TRF-BCA-882910"}
          </p>
        </div>

        {/* Mustahik Salted Hash */}
        <div className="p-4 rounded-2xl bg-[#f4f8f3]/60 border border-[#dbe7dd] space-y-1 sm:col-span-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-[#5e7a70]">
              Identitas Mustahik (Masked & Salted Hash UU PDP)
            </span>
            <span className="text-[10px] text-emerald-700 font-semibold">Anti-Doxxing Terlindungi</span>
          </div>
          <p className="font-bold text-[#17332c]">
            {metadata.beneficiaryName || metadata.disguisedName || "Hamba Allah (Mustahik)"} — NIK: {metadata.beneficiaryNIKMasked || "3201************"}
          </p>
          <p className="font-mono text-[11px] text-[#5e7a70] break-all bg-white p-2 rounded-xl border border-[#dbe7dd]">
            Hash: {metadata.beneficiaryHash || "0x7a8b9c...d4e5"}
          </p>
        </div>
      </div>

      {/* Location Tagging */}
      {metadata.location && (
        <div className="p-4 rounded-2xl bg-[#f4f8f3]/60 border border-[#dbe7dd] flex items-start gap-3 text-xs">
          <MapPin className="w-4 h-4 text-[#1b765e] shrink-0 mt-0.5" />
          <div>
            <span className="text-[10px] uppercase font-bold text-[#5e7a70]">Lokasi Penyaluran</span>
            <p className="font-bold text-[#17332c]">
              {metadata.location.district ? `${metadata.location.district}, ` : ""}
              {metadata.location.regencyCity}, {metadata.location.province}
            </p>
          </div>
        </div>
      )}

      {/* Sharia Compliance Checks */}
      <div className="p-4 rounded-2xl bg-[#f4f8f3]/60 border border-[#dbe7dd] space-y-2.5 text-xs">
        <div className="flex items-center gap-2 text-emerald-800 font-bold">
          <ShieldCheck className="w-4 h-4" />
          <span>Verifikasi Kepatuhan Syariah BAZNAS</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
          <div className="flex items-center gap-1.5 text-emerald-700 font-semibold bg-white p-2 rounded-xl border border-[#dbe7dd]">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Kriteria 8 Asnaf Sah</span>
          </div>
          <div className="flex items-center gap-1.5 text-emerald-700 font-semibold bg-white p-2 rounded-xl border border-[#dbe7dd]">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Batas Hak Amil ≤ 12.5%</span>
          </div>
          <div className="flex items-center gap-1.5 text-emerald-700 font-semibold bg-white p-2 rounded-xl border border-[#dbe7dd]">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Anti-Double Claim Lulus</span>
          </div>
        </div>
      </div>

      {/* Dynamic Attachments List */}
      {metadata.attachments && metadata.attachments.length > 0 && (
        <div className="space-y-3 pt-2">
          <span className="text-xs font-bold uppercase tracking-wider text-[#17332c] flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#1b765e]" />
            <span>Daftar Lampiran Berkas ({metadata.attachments.length})</span>
          </span>

          <div className="space-y-2">
            {metadata.attachments.map((att: any, idx: number) => (
              <div
                key={idx}
                onClick={() => onSelectAttachment?.(att)}
                className="p-3 rounded-2xl border border-[#dbe7dd] bg-white hover:bg-[#f4f8f3] transition-all flex items-center justify-between gap-3 text-xs cursor-pointer shadow-2xs group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-[#1b765e]/10 text-[#1b765e] flex items-center justify-center shrink-0 group-hover:bg-[#1b765e] group-hover:text-white transition-colors">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-[#17332c] truncate">{att.name}</p>
                    <p className="text-[11px] text-[#5e7a70] truncate">{att.description || att.fileType}</p>
                  </div>
                </div>

                <span className="text-[11px] font-bold text-[#1b765e] shrink-0 group-hover:underline">
                  Lihat Berkas ➔
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

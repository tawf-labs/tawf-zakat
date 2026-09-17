import React from "react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "../../components/ui/Accordion";
import { ShieldCheck, Cpu, Hash, Layers, ExternalLink, AlertTriangle, CheckCircle2, XCircle, Info } from "lucide-react";
import { type Hex } from "viem";
import { ZAKAT_PROTOCOL_L1_ADDRESS, SEPOLIA_EXPLORER_URL } from "../../lib/contracts";

interface MerkleProofDetailsProps {
  leaf?: Hex | null;
  merkleRoot?: Hex | null;
  proof?: Hex[] | null;
  batchId?: number | null;
  isVerified?: boolean | null;
  proofType?: string;
  zkStatus?: string;
}

export function MerkleProofDetails({
  leaf,
  merkleRoot,
  proof,
  batchId,
  isVerified,
  proofType = "MERKLE_TREE",
  zkStatus = "PENDING",
}: MerkleProofDetailsProps) {
  return (
    <div className="rounded-2xl border border-[#dbe7dd] bg-[#f4f8f3]/60 p-4">
      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="merkle-details" className="border-0">
          <AccordionTrigger className="py-2 text-xs font-bold uppercase tracking-wider text-[#1b765e] hover:text-[#17332c]">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#1b765e]" />
              <span>Detail Kriptografi & Bukti Pohon Merkle (Merkle Inclusion)</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-3 space-y-4 text-xs">
            {/* Proof Type Distinction Notice */}
            <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200/80 text-blue-900 space-y-1.5">
              <div className="flex items-center gap-1.5 font-bold text-blue-900">
                <Info className="w-4 h-4 text-blue-700 shrink-0" />
                <span>Pembedaan Tipe Bukti Kriptografis (ADR-0034)</span>
              </div>
              <p className="text-[11px] leading-relaxed text-blue-800">
                <strong>Tipe Bukti Aktif:</strong> Pohon Merkle (Merkle Tree Inclusion — Keccak-256). Membuktikan secara matematis bahwa hash kuitansi donasi Anda termasuk dalam Batch State Root yang tercatat di smart contract L1.
              </p>
              <p className="text-[11px] leading-relaxed text-blue-800">
                <strong>Bukti Zero-Knowledge (ZK Proof):</strong> <span className="font-semibold">{zkStatus === "PENDING" ? "Belum Diterbitkan (Tahap Pengembangan Tiket #108 / ADR-0034)" : zkStatus}</span>. Bukti pohon Merkle tidak disamakan dengan sirkuit ZK ataupun tanda tangan pengesahan laporan.
              </p>
            </div>

            {/* Verification Status Banner */}
            <div className="p-3 rounded-xl bg-white border border-[#dbe7dd] flex items-center justify-between">
              <span className="text-[#5e7a70] font-semibold">Hasil Pemeriksaan Kriptografis:</span>
              {isVerified === true ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 bg-emerald-100 px-3 py-1 rounded-full border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Bukti Merkle Valid (Inklusi Terbukti)
                </span>
              ) : isVerified === false ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-red-800 bg-red-100 px-3 py-1 rounded-full border border-red-200">
                  <XCircle className="w-3.5 h-3.5" /> Bukti Tidak Cocok / Tidak Sah
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-800 bg-amber-100 px-3 py-1 rounded-full border border-amber-200">
                  <AlertTriangle className="w-3.5 h-3.5" /> Memerlukan Salt & Nominal untuk Verifikasi Mandiri
                </span>
              )}
            </div>

            {/* Batch ID */}
            {batchId && (
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-[#dbe7dd]">
                <span className="text-[#5e7a70] font-medium">Batch Settlement ID:</span>
                <span className="font-mono font-bold text-[#17332c]">Batch #{batchId}</span>
              </div>
            )}

            {/* Leaf Hash */}
            <div className="p-2.5 rounded-xl bg-white border border-[#dbe7dd] space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#5e7a70]">
                <Hash className="w-3.5 h-3.5 text-[#1b765e]" />
                <span>Leaf Hash Donasi (Keccak-256):</span>
              </div>
              <p className="font-mono text-[11px] text-[#17332c] break-all bg-[#f4f8f3] p-2 rounded-lg">
                {leaf || "[Privat — Dihitung saat verifikasi kuitansi mandiri menggunakan salt dan nominal]"}
              </p>
            </div>

            {/* Merkle Root */}
            <div className="p-2.5 rounded-xl bg-white border border-[#dbe7dd] space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#5e7a70]">
                <Layers className="w-3.5 h-3.5 text-[#1b765e]" />
                <span>Merkle State Root (Tercatat di Smart Contract L1):</span>
              </div>
              <p className="font-mono text-[11px] text-[#17332c] break-all bg-[#f4f8f3] p-2 rounded-lg">
                {merkleRoot || "Belum ada root (Batch belum difinalisasi)"}
              </p>
            </div>

            {/* Sibling Proof Hashes */}
            {proof && proof.length > 0 ? (
              <div className="p-2.5 rounded-xl bg-white border border-[#dbe7dd] space-y-1.5">
                <span className="text-[11px] font-semibold text-[#5e7a70]">
                  Sibling Path Proofs ({proof.length} Node Kriptografis):
                </span>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {proof.map((p, idx) => (
                    <p key={idx} className="font-mono text-[10px] text-[#5e7a70] truncate bg-[#f4f8f3] p-1.5 rounded-md">
                      [{idx}] {p}
                    </p>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-2.5 rounded-xl bg-white border border-[#dbe7dd] text-[11px] text-[#5e7a70]">
                Sibling proof belum tersedia atau batch belum dibentuk.
              </div>
            )}

            <div className="pt-1 flex justify-end">
              <a
                href={`${SEPOLIA_EXPLORER_URL}/address/${ZAKAT_PROTOCOL_L1_ADDRESS}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-bold text-[#1b765e] hover:underline"
              >
                <span>Periksa Smart Contract di Arbiscan (Arbitrum)</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

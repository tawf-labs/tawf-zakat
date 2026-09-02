import React from "react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "../../components/ui/Accordion";
import { ShieldCheck, Cpu, Hash, Layers, ExternalLink } from "lucide-react";
import { type Hex } from "viem";

interface MerkleProofDetailsProps {
  leaf?: Hex;
  merkleRoot?: Hex;
  proof?: Hex[];
  batchId?: number;
}

export function MerkleProofDetails({
  leaf,
  merkleRoot,
  proof,
  batchId,
}: MerkleProofDetailsProps) {
  return (
    <div className="rounded-2xl border border-[#dbe7dd] bg-[#f4f8f3]/60 p-4">
      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="merkle-details" className="border-0">
          <AccordionTrigger className="py-2 text-xs font-bold uppercase tracking-wider text-[#1b765e] hover:text-[#17332c]">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4" />
              <span>Lihat Detail Kriptografi & Bukti Pohon Merkle (Khusus Auditor)</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-3 space-y-3 text-xs">
            <p className="text-[#5e7a70] text-[11px] leading-relaxed">
              Bukti inklusi pohon Merkle (Merkle Inclusion Proof) ini membuktikan secara matematis bahwa donasi Anda terkunci secara permanen di dalam Batch Root smart contract Sepolia L1 tanpa perlu biaya gas.
            </p>

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
                <span>Leaf Hash Donasi Anda (Keccak-256):</span>
              </div>
              <p className="font-mono text-[11px] text-[#17332c] break-all bg-[#f4f8f3] p-2 rounded-lg">
                {leaf || "0x7a8b9c...d4e5"}
              </p>
            </div>

            {/* Merkle Root */}
            <div className="p-2.5 rounded-xl bg-white border border-[#dbe7dd] space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#5e7a70]">
                <Layers className="w-3.5 h-3.5 text-[#1b765e]" />
                <span>Merkle State Root (Terkunci di Smart Contract L1):</span>
              </div>
              <p className="font-mono text-[11px] text-[#17332c] break-all bg-[#f4f8f3] p-2 rounded-lg">
                {merkleRoot || "0xf7d294258e3c6ddaf70a36eade232485b366584e76532e0a360d75d20dae061c"}
              </p>
            </div>

            {/* Sibling Proof Hashes */}
            {proof && proof.length > 0 && (
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
            )}

            <div className="pt-1 flex justify-end">
              <a
                href="https://sepolia.etherscan.io/address/0x6014542ce8f759946aa6f3f9af54fb91685065a5"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-bold text-[#1b765e] hover:underline"
              >
                <span>Periksa Smart Contract di Sepolia Etherscan</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

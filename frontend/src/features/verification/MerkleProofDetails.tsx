import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "../../components/ui/Accordion";
import { SEPOLIA_EXPLORER_URL } from "../../lib/contracts";
import type { PublicContribution, ReceiptCheck } from "./contributionApi";

interface MerkleProofDetailsProps {
  contribution: PublicContribution;
  check: ReceiptCheck | null;
}

const checkLabel = (check: ReceiptCheck | null) =>
  !check ? "Belum diperiksa (butuh kuitansi pemilik)"
    : check.isValid ? "Cocok — dihitung ulang oleh server terhadap root batch"
    : "Tidak cocok";

export function MerkleProofDetails({ contribution, check }: MerkleProofDetailsProps) {
  const { batch, membershipProof } = contribution;

  return (
    <div className="rounded-2xl border border-[#dbe7dd] bg-[#f4f8f3]/60 p-4">
      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="technical" className="border-0">
          <AccordionTrigger className="py-2 text-xs font-bold uppercase tracking-wider text-[#1b765e] hover:text-[#17332c]">
            Rincian teknis untuk pemeriksa
          </AccordionTrigger>
          <AccordionContent className="pt-3 space-y-2 text-xs">
            <Row label="Jenis bukti">
              Merkle inclusion (keanggotaan dalam batch). Ini bukan ZK proof dan bukan tanda tangan pengesahan.
            </Row>
            <Row label="ZK proof">Belum tersedia untuk catatan ini.</Row>
            <Row label="Hasil pemeriksaan">{checkLabel(check)}</Row>
            <Row label="Batch">{batch ? `#${batch.batchId}` : "Belum masuk batch"}</Row>
            <Row label="Merkle root (catatan server)">
              <Mono>{batch?.merkleRoot ?? "Belum ada root"}</Mono>
              <span className="block text-[11px] text-[#5e7a70] mt-1">
                Root dibaca dari catatan server; kecocokannya dengan kontrak tidak diperiksa di halaman ini.
              </span>
            </Row>
            {batch?.anchorTxHash && (
              <Row label="Transaksi pencatatan root">
                <a href={`${SEPOLIA_EXPLORER_URL}/tx/${batch.anchorTxHash}`} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 font-bold text-[#1b765e] hover:underline break-all">
                  {batch.anchorTxHash} <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              </Row>
            )}
            {batch && (
              <Row label="Versi batch">Status terkini atau digantikan belum dilacak untuk batch ini.</Row>
            )}
            <Row label="Leaf hash">
              <Mono>{check?.leaf ?? "Dihitung saat pemilik mencocokkan kuitansi"}</Mono>
            </Row>
            <Row label={`Sibling proof (${membershipProof?.siblings.length ?? 0})`}>
              {membershipProof ? membershipProof.siblings.map((sibling, index) => <Mono key={index}>{sibling}</Mono>) : "Belum tersedia"}
            </Row>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="p-2.5 rounded-xl bg-white border border-[#dbe7dd] space-y-1">
      <span className="text-[11px] font-semibold text-[#5e7a70]">{label}</span>
      <div className="text-[#17332c]">{children}</div>
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[11px] break-all bg-[#f4f8f3] p-1.5 rounded-md">{children}</p>;
}

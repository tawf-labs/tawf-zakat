import React, { useState } from "react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../components/ui/Table";
import { Badge } from "../../components/ui/Badge";
import { FileText, ExternalLink, Search, ShieldCheck, CheckCircle2, Clock } from "lucide-react";
import { Input } from "../../components/ui/Input";
import { BastModal } from "./BastModal";

interface ProposalRecord {
  id: number;
  beneficiaryHash?: string;
  asnafType?: string;
  amountIDR?: number;
  amountUSDC?: string;
  currencyType?: number;
  status: string;
  disbursementReceiptCID?: string;
  proposalMetadataCID?: string;
  auditOpinion?: string;
  createdAt?: string;
  executedAt?: string;
  txHash?: string;
}

interface DisbursementTableProps {
  proposals: ProposalRecord[];
}

export function DisbursementTable({ proposals }: DisbursementTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAsnaf, setSelectedAsnaf] = useState("ALL");
  const [selectedProposalForBast, setSelectedProposalForBast] = useState<ProposalRecord | null>(null);

  // Filtered proposals
  const filtered = (proposals || []).filter((p) => {
    const matchesAsnaf = selectedAsnaf === "ALL" || (p.asnafType || "Fakir") === selectedAsnaf;
    const matchesSearch =
      searchTerm === "" ||
      p.id.toString().includes(searchTerm) ||
      (p.beneficiaryHash || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.asnafType || "").toLowerCase().includes(searchTerm.toLowerCase());
    return matchesAsnaf && matchesSearch;
  });

  return (
    <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-xs space-y-6">
      {/* Header & Filter Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#dbe7dd]/60 pb-6">
        <div>
          <h3 className="font-serif text-xl font-bold text-[#17332c]">
            Daftar Penyaluran Bantuan Mustahik
          </h3>
          <p className="text-xs text-[#5e7a70] mt-0.5">
            Laporan riil pencairan dana dilengkapi Berita Acara Serah Terima (BAST) dan stempel audit WTP.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          {/* Search Box */}
          <div className="w-full sm:w-64">
            <Input
              placeholder="Cari ID, Hash, Asnaf..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              leftAddon={<Search className="w-4 h-4 text-[#5e7a70]" />}
            />
          </div>

          {/* Asnaf Filter */}
          <select
            value={selectedAsnaf}
            onChange={(e) => setSelectedAsnaf(e.target.value)}
            className="w-full sm:w-auto rounded-xl border border-[#dbe7dd] bg-white px-3 py-2 text-xs font-semibold text-[#17332c] outline-none focus:border-[#1b765e]"
          >
            <option value="ALL">Semua Asnaf</option>
            <option value="Fakir">Fakir</option>
            <option value="Miskin">Miskin</option>
            <option value="Fisabilillah">Fisabilillah</option>
            <option value="Gharimin">Gharimin</option>
            <option value="Muallaf">Muallaf</option>
            <option value="Ibnu Sabil">Ibnu Sabil</option>
            <option value="Amil">Amil</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center text-[#5e7a70] text-sm">
          Tidak ada data penyaluran yang cocok dengan kriteria pencarian.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID Program</TableHead>
              <TableHead>Asnaf</TableHead>
              <TableHead>Beneficiary Hash (UU PDP)</TableHead>
              <TableHead>Nominal</TableHead>
              <TableHead>Status Otorisasi</TableHead>
              <TableHead>Bukti BAST</TableHead>
              <TableHead>Jejak L1</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono font-bold text-xs text-[#17332c]">
                  #{item.id}
                </TableCell>
                <TableCell>
                  <span className="text-xs font-semibold text-[#1b765e] bg-[#f4f8f3] px-2.5 py-1 rounded-full border border-[#dbe7dd]">
                    {item.asnafType || "Fakir Miskin"}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs text-[#5e7a70]" title={item.beneficiaryHash}>
                  {item.beneficiaryHash
                    ? `${item.beneficiaryHash.slice(0, 8)}...${item.beneficiaryHash.slice(-6)}`
                    : "0x7a8b...9c1d"}
                </TableCell>
                <TableCell className="font-serif font-bold text-sm text-[#17332c]">
                  {item.amountIDR
                    ? `Rp ${item.amountIDR.toLocaleString("id-ID")}`
                    : `${item.amountUSDC} USDC`}
                </TableCell>
                <TableCell>
                  {item.status === "EXECUTED" ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                      <CheckCircle2 className="w-3 h-3" /> Tersalurkan & WTP
                    </span>
                  ) : item.status === "APPROVED" ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-800 bg-blue-100 px-2.5 py-0.5 rounded-full">
                      <ShieldCheck className="w-3 h-3" /> Disetujui DPS
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full">
                      <Clock className="w-3 h-3" /> Menunggu Persetujuan
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => setSelectedProposalForBast(item)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-[#1b765e]/30 bg-[#f4f8f3] text-[11px] font-semibold text-[#1b765e] hover:bg-[#1b765e] hover:text-white transition-all cursor-pointer shadow-2xs"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Lihat BAST</span>
                  </button>
                </TableCell>
                <TableCell>
                  <a
                    href="https://sepolia.etherscan.io/address/0x6014542ce8f759946aa6f3f9af54fb91685065a5"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-mono text-[#5e7a70] hover:text-[#1b765e] hover:underline flex items-center gap-1"
                  >
                    <span>Sepolia L1</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* BAST Modal */}
      <BastModal
        isOpen={!!selectedProposalForBast}
        onClose={() => setSelectedProposalForBast(null)}
        proposal={selectedProposalForBast}
      />
    </div>
  );
}

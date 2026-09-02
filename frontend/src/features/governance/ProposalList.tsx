import React, { useState } from "react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../components/ui/Table";
import { ShieldCheck, CheckCircle2, Clock, PlusCircle, FileText, ExternalLink, Scale, Sparkles } from "lucide-react";
import { ExecuteBastModal } from "./ExecuteBastModal";
import { BastModal } from "../transparency/BastModal";

interface ProposalListProps {
  proposals: any[];
  onOpenCreate: () => void;
  onRefresh: () => void;
}

export function ProposalList({ proposals, onOpenCreate, onRefresh }: ProposalListProps) {
  const [activeTab, setActiveTab] = useState<"ALL" | "PENDING" | "APPROVED" | "EXECUTED">("ALL");
  const [selectedForExecution, setSelectedForExecution] = useState<any | null>(null);
  const [selectedForBastView, setSelectedForBastView] = useState<any | null>(null);

  const filtered = (proposals || []).filter((p) => {
    if (activeTab === "ALL") return true;
    const s = (p.status || "").toUpperCase();
    return s === activeTab;
  });

  return (
    <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-xs space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#dbe7dd]/60 pb-6">
        <div>
          <h3 className="font-serif text-xl font-bold text-[#17332c]">
            Daftar Usulan & Penyaluran Program Zakat
          </h3>
          <p className="text-xs text-[#5e7a70] mt-0.5">
            Kelola alur persetujuan program dari Amil, Dewan Pengawas Syariah, hingga Auditor.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenCreate}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#17332c] hover:bg-[#1b765e] text-white text-xs font-bold uppercase tracking-wider transition-all shadow-xs cursor-pointer self-start sm:self-auto"
        >
          <PlusCircle className="w-4 h-4 text-[#c4ed70]" />
          <span>Buat Usulan Baru</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: "ALL", label: "Semua Usulan" },
          { id: "PENDING", label: "Menunggu DPS" },
          { id: "APPROVED", label: "Siap Dicairkan (BAST)" },
          { id: "EXECUTED", label: "Selesai & WTP" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === tab.id
                ? "bg-[#17332c] text-white shadow-xs"
                : "bg-[#f4f8f3] text-[#5e7a70] hover:text-[#17332c] border border-[#dbe7dd]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center text-xs text-[#5e7a70]">
          Tidak ada proposal pada kategori ini.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Asnaf</TableHead>
              <TableHead>Mustahik / Program</TableHead>
              <TableHead>Nominal</TableHead>
              <TableHead>Status Otorisasi</TableHead>
              <TableHead>Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((p) => {
              const pId = p.proposalId || p.id;
              const statusUpper = (p.status || "").toUpperCase();

              return (
                <TableRow key={pId}>
                  <TableCell className="font-mono font-bold text-xs">#{pId}</TableCell>
                  <TableCell>
                    <span className="text-xs font-semibold text-[#1b765e] bg-[#f4f8f3] px-2.5 py-1 rounded-full border border-[#dbe7dd]">
                      {p.asnafLabel || p.asnafType || "Fakir Miskin"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-semibold text-xs text-[#17332c]">
                        {p.beneficiaryName || "Program Bantuan Kemanusiaan"}
                      </p>
                      <p className="text-[10px] font-mono text-[#5e7a70]">
                        Hash: {p.beneficiaryHash?.slice(0, 10)}...
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="font-serif font-bold text-xs text-[#17332c]">
                    {p.amountIDR ? `Rp ${Number(p.amountIDR).toLocaleString("id-ID")}` : `${p.amountUSDC} USDC`}
                  </TableCell>
                  <TableCell>
                    {statusUpper === "EXECUTED" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" /> Tersalurkan
                      </span>
                    ) : statusUpper === "APPROVED" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-800 bg-blue-100 px-2.5 py-0.5 rounded-full">
                        <ShieldCheck className="w-3 h-3" /> Disetujui DPS
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full">
                        <Clock className="w-3 h-3" /> Menunggu DPS
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {statusUpper === "APPROVED" && (
                        <button
                          type="button"
                          onClick={() => setSelectedForExecution(p)}
                          className="px-3 py-1 rounded-lg bg-[#17332c] hover:bg-[#1b765e] text-white text-[11px] font-bold uppercase tracking-wider transition-colors shadow-2xs"
                        >
                          Cairkan BAST
                        </button>
                      )}
                      {(statusUpper === "EXECUTED" || p.disbursementReceiptCID) && (
                        <button
                          type="button"
                          onClick={() => setSelectedForBastView(p)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#dbe7dd] text-[11px] font-semibold text-[#1b765e] hover:bg-[#f4f8f3]"
                        >
                          <FileText className="w-3 h-3" />
                          <span>BAST</span>
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Execute Modal */}
      <ExecuteBastModal
        isOpen={!!selectedForExecution}
        onClose={() => setSelectedForExecution(null)}
        proposal={selectedForExecution}
        onSuccess={onRefresh}
      />

      {/* BAST Preview Modal */}
      <BastModal
        isOpen={!!selectedForBastView}
        onClose={() => setSelectedForBastView(null)}
        proposal={selectedForBastView}
      />
    </div>
  );
}

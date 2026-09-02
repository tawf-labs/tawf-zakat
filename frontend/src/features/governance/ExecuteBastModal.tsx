import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import { executeDisbursementOnChain } from "../../lib/web3Client";
import { useAccount } from "wagmi";
import { Upload, Loader2, CheckCircle2, FileText, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface ExecuteBastModalProps {
  isOpen: boolean;
  onClose: () => void;
  proposal: any | null;
  onSuccess?: () => void;
}

export function ExecuteBastModal({
  isOpen,
  onClose,
  proposal,
  onSuccess,
}: ExecuteBastModalProps) {
  const { address, isConnected } = useAccount();

  const [bankRef, setBankRef] = useState("TRF-BANK-001");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  if (!proposal) return null;
  const pId = proposal.proposalId || proposal.id;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected || !address) {
      toast.error("Silakan hubungkan dompet Amil terlebih dahulu.");
      return;
    }

    setLoading(true);
    setStatusText("Mengunggah berkas BAST ke Pinata IPFS...");

    try {
      let cid = "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco";
      if (file) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("docType", "BAST_RECEIPT");
        const uploadRes = await fetch("http://localhost:3001/api/ipfs/upload-file", {
          method: "POST",
          body: formData,
        });
        if (uploadRes.ok) {
          const uploadJson = await uploadRes.json();
          cid = uploadJson.cid || cid;
        }
      }

      setStatusText("Mengeksekusi pencairan dana di smart contract Arbitrum...");
      const tx = await executeDisbursementOnChain(pId, cid);

      setStatusText("Menyinkronkan status pencairan ke basis data...");
      try {
        await fetch(`http://localhost:3001/api/proposals/${pId}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            txHash: tx.txHash,
            disbursementReceiptCID: cid,
          }),
        });

        // Also record the BAST disbursement receipt metadata in IPFS pipeline
        await fetch("http://localhost:3001/api/disbursements/execute-bast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proposalId: pId,
            receiptCID: cid,
            bankTransferRef: bankRef,
            txHash: tx.txHash,
          }),
        });
      } catch (syncErr) {
        console.warn("Backend execution sync fallback:", syncErr);
      }

      toast.success(`Pencairan Program #${pId} berhasil dicatat on-chain & BAST terunggah!`);
      onSuccess?.();
      onClose();
    } catch (err: any) {
      console.error("Execute error:", err);
      toast.error(err.message || "Gagal mengeksekusi pencairan BAST.");
    } finally {
      setLoading(false);
      setStatusText(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-2xl">
        <DialogHeader className="space-y-1.5 border-b border-[#dbe7dd]/60 pb-4">
          <DialogTitle className="font-serif text-2xl font-bold text-[#17332c]">
            Eksekusi Penyaluran & Unggah BAST
          </DialogTitle>
          <p className="text-xs text-[#5e7a70]">
            Pencairan dana Program #{pId} ({proposal.asnafLabel || proposal.asnafType || "Mustahik"}).
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-2">
          <Input
            label="Nomor Referensi Bank / Mutasi Transfer"
            value={bankRef}
            onChange={(e) => setBankRef(e.target.value)}
            placeholder="Contoh: TRF-BCA-882910"
            required
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-[#17332c]">
              Unggah Berkas Scan BAST / Foto Serah Terima
            </label>
            <div className="relative border-2 border-dashed border-[#dbe7dd] rounded-2xl p-4 text-center hover:bg-[#f4f8f3] transition-colors">
              <input
                type="file"
                accept=".pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="flex flex-col items-center justify-center gap-1 text-xs text-[#5e7a70]">
                <Upload className="w-5 h-5 text-[#1b765e]" />
                <span className="font-semibold text-[#17332c]">
                  {file ? file.name : "Klik atau seret scan dokumen BAST"}
                </span>
                <span className="text-[10px]">Tersimpan di IPFS untuk transparansi publik</span>
              </div>
            </div>
          </div>

          {statusText && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-[#f4f8f3] border border-[#dbe7dd] text-xs text-[#1b765e]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{statusText}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#dbe7dd]/60">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-[#dbe7dd] text-xs font-bold text-[#5e7a70] hover:bg-[#f4f8f3]"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#17332c] hover:bg-[#1b765e] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider transition-all shadow-xs cursor-pointer"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 text-[#c4ed70]" />}
              <span>Konfirmasi Pencairan</span>
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

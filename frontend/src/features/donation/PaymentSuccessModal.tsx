import React from "react";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/Dialog";
import { CheckCircle2, Copy, Check, ExternalLink, ArrowRight, ShieldCheck, Heart } from "lucide-react";
import { Badge } from "../../components/ui/Badge";

interface PaymentSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  receiptData: {
    trxId: string;
    amount: number | string;
    currency: "IDR" | "USDC";
    donorName: string;
    isAnonymous: boolean;
    zakatType: string;
    salt?: string;
    txHash?: string;
    paidAt?: string;
  } | null;
}

export function PaymentSuccessModal({
  isOpen,
  onClose,
  receiptData,
}: PaymentSuccessModalProps) {
  const [copied, setCopied] = React.useState(false);

  if (!receiptData) return null;

  const handleCopyTrx = () => {
    navigator.clipboard.writeText(receiptData.trxId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-2xl">
        <DialogHeader className="text-center space-y-3 pb-2">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-100 text-emerald-600 shadow-xs">
            <CheckCircle2 className="h-9 w-9" />
          </div>
          <DialogTitle className="font-serif text-2xl font-bold text-[#17332c]">
            Alhamdulillah, Zakat Anda Telah Diterima
          </DialogTitle>
          <p className="text-xs text-[#5e7a70] max-w-sm mx-auto">
            Semoga Allah SWT menerima amal ibadah zakat Anda, membersihkan harta, dan melipatgandakan keberkahan bagi keluarga.
          </p>
        </DialogHeader>

        {/* Receipt Box */}
        <div className="rounded-2xl border border-[#dbe7dd] bg-[#f4f8f3] p-5 space-y-3.5 text-xs text-[#17332c]">
          <div className="flex items-center justify-between border-b border-[#dbe7dd]/60 pb-3">
            <span className="text-[#5e7a70]">Nomor Transaksi:</span>
            <div className="flex items-center gap-1.5 font-mono font-bold text-[#1b765e]">
              <span>{receiptData.trxId}</span>
              <button
                type="button"
                onClick={handleCopyTrx}
                className="p-1 hover:bg-white rounded-md transition-colors"
                title="Salin No. Transaksi"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#5e7a70]">Jenis Akad:</span>
            <span className="font-semibold">{receiptData.zakatType}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#5e7a70]">Nama Muzakki:</span>
            <span className="font-semibold">
              {receiptData.isAnonymous ? "Hamba Allah (Anonim)" : receiptData.donorName || "Muzakki"}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#5e7a70]">Nominal Donasi:</span>
            <span className="font-serif text-base font-bold text-[#1b765e]">
              {receiptData.currency === "IDR"
                ? `Rp ${Number(receiptData.amount).toLocaleString("id-ID")}`
                : `${receiptData.amount} USDC`}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#5e7a70]">Status Pencatatan:</span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
              <ShieldCheck className="w-3 h-3" /> Terverifikasi Sah
            </span>
          </div>

          {receiptData.txHash && (
            <div className="flex items-center justify-between pt-1 border-t border-[#dbe7dd]/60">
              <span className="text-[#5e7a70]">Tx Hash On-Chain:</span>
              <a
                href={`https://sepolia.arbiscan.io/tx/${receiptData.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[#1b765e] hover:underline flex items-center gap-1"
              >
                <span>{receiptData.txHash.slice(0, 8)}...{receiptData.txHash.slice(-6)}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-3 pt-3">
          <Link
            to="/verifikasi"
            search={{ trxId: receiptData.trxId }}
            onClick={onClose}
            className="w-full flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-[#17332c] px-6 py-3.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-[#1b765e] shadow-xs transition-all"
          >
            <span>Cek Sertifikat Donasi</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-3.5 rounded-full border border-[#dbe7dd] text-xs font-bold uppercase tracking-wider text-[#5e7a70] hover:bg-[#f4f8f3] transition-colors"
          >
            Selesai
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

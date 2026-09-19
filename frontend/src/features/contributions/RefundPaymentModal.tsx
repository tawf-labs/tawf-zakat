import { useId, useState } from "react";
import { CheckCircle2, DollarSign, Info } from "lucide-react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { Button } from "../../components/ui/Button";
import {
  formatNominal,
  payRefund,
  type ContributionRefund,
  type CurrencyUnit,
} from "./contributionClient";
import { errorMessage, useOperationIds } from "./contributionUi";

const fieldClass = "w-full text-sm border border-stone-300 rounded-lg p-2 focus:ring-1 focus:outline-none";
const labelClass = "block font-semibold uppercase text-stone-600 mb-1";

export function RefundPaymentModal({
  requests,
  contributionId,
  refund,
  currencyUnit,
  onDone,
  onClose,
  onError,
}: {
  requests: PrivateRequests;
  contributionId: string;
  refund: ContributionRefund;
  currencyUnit: CurrencyUnit;
  onDone: (refund: ContributionRefund) => void;
  onClose: () => void;
  onError: (message: string | null) => void;
}) {
  const proofId = useId();
  const notesId = useId();

  const [paymentProofRef, setPaymentProofRef] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const operations = useOperationIds();

  const submit = async () => {
    if (!paymentProofRef.trim()) {
      onError("Nomor referensi bukti pembayaran pengembalian wajib diisi.");
      return;
    }

    setSubmitting(true);
    onError(null);
    try {
      const intentKey = `pay-refund-${contributionId}-${refund.id}-${paymentProofRef}-${paymentNotes}`;
      const operationId = operations.mint(intentKey);

      const res = await payRefund(requests, contributionId, refund.id, {
        paymentProofRef: paymentProofRef.trim(),
        paymentNotes: paymentNotes.trim() || undefined,
        operationId,
      });

      onDone(res.refund);
    } catch (err) {
      onError(errorMessage(err, "Gagal mencatat realisasi pembayaran pengembalian."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Catat Realisasi Pembayaran Pengembalian"
        className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl border border-stone-200"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-stone-900 flex items-center gap-1.5">
              <DollarSign className="w-5 h-5 text-emerald-600" />
              <span>Realisasi Pembayaran Pengembalian (Tahap 2: Pembayaran)</span>
            </h3>
            <p className="text-xs text-stone-500 mt-1">
              Refund: <code>{refund.id}</code> (Nominal: {formatNominal(refund.amountExact, currencyUnit)})
            </p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 font-bold" aria-label="Tutup">
            ✕
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 text-stone-700 space-y-1">
            <div>
              <span className="font-semibold text-stone-900">Alasan Putusan:</span> {refund.reason}
            </div>
            <div>
              <span className="font-semibold text-stone-900">Dasar Kebijakan:</span> {refund.policyBasis}
            </div>
            <div className="text-[11px] text-stone-500 font-mono">
              Diputuskan oleh: {refund.decidedBy} pada {new Date(refund.decidedAt * 1000).toLocaleString("id-ID")}
            </div>
          </div>

          <div>
            <label htmlFor={proofId} className={labelClass}>
              Nomor Referensi Bukti Transfer / Pembayaran <span className="text-rose-600">*</span>
            </label>
            <input
              id={proofId}
              type="text"
              value={paymentProofRef}
              onChange={(e) => setPaymentProofRef(e.target.value)}
              placeholder="Contoh: TRX-BANK-BCA-88991122"
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor={notesId} className={labelClass}>
              Catatan Realisasi Pembayaran (Opsional)
            </label>
            <textarea
              id={notesId}
              rows={2}
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              placeholder="Contoh: Transfer ke rekening Bank Syariah Indonesia a.n. Donatur (berkas resi terlampir di finance)"
              className={fieldClass}
            />
          </div>

          <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 text-emerald-950 flex items-start gap-2 text-[11px]">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <div>
              <strong>Pemisahan Siklus & Bukti (AC03, AC12):</strong> Tahap ini mencatat bukti riil arus kas keluar
              yang telah dieksekusi bendahara. Sistem menjamin idempotensi: retry transaksi tidak akan mencatat
              pengembalian uang dua kali.
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button size="sm" onClick={submit} disabled={submitting || !paymentProofRef.trim()}>
            {submitting ? "Mencatat Realisasi…" : "Konfirmasi Pembayaran Selesai"}
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useId, useState } from "react";
import { ArrowDownLeft, Info, ShieldAlert } from "lucide-react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { Button } from "../../components/ui/Button";
import {
  decideRefund,
  formatNominal,
  type ContributionRecord,
  type ContributionRefund,
} from "./contributionClient";
import { errorMessage, useOperationIds } from "./contributionUi";

const fieldClass = "w-full text-sm border border-stone-300 rounded-lg p-2 focus:ring-1 focus:outline-none";
const labelClass = "block font-semibold uppercase text-stone-600 mb-1";

export function RefundDecisionModal({
  requests,
  target,
  onDone,
  onClose,
  onError,
}: {
  requests: PrivateRequests;
  target: ContributionRecord;
  onDone: (refund: ContributionRefund) => void;
  onClose: () => void;
  onError: (message: string | null) => void;
}) {
  const amountId = useId();
  const reasonId = useId();
  const policyId = useId();

  const maxRefundable = target.unallocatedAmount ?? target.amountExact;
  const [amountExact, setAmountExact] = useState(maxRefundable);
  const [reason, setReason] = useState("");
  const [policyBasis, setPolicyBasis] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const operations = useOperationIds();

  const submit = async () => {
    if (!amountExact.trim() || !/^\d+$/.test(amountExact.trim()) || amountExact.trim() === "0") {
      onError("Nominal pengembalian harus berupa bilangan bulat positif.");
      return;
    }
    if (!reason.trim()) {
      onError("Alasan permohonan pengembalian wajib diisi.");
      return;
    }
    if (!policyBasis.trim()) {
      onError("Dasar kebijakan lembaga / ketentuan syariah wajib diisi.");
      return;
    }

    setSubmitting(true);
    onError(null);
    try {
      const intentKey = `decide-refund-${target.id}-v${target.version}-${amountExact}-${reason}-${policyBasis}`;
      const operationId = operations.mint(intentKey);

      const res = await decideRefund(requests, target.id, {
        expectedVersion: target.version,
        amountExact: amountExact.trim(),
        reason: reason.trim(),
        policyBasis: policyBasis.trim(),
        operationId,
      });

      onDone(res.refund);
    } catch (err) {
      onError(errorMessage(err, "Gagal mencatat keputusan pengembalian dana."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keputusan Pengembalian Dana"
        className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl border border-stone-200"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-stone-900 flex items-center gap-1.5">
              <ArrowDownLeft className="w-5 h-5 text-indigo-600" />
              <span>Keputusan Pengembalian Dana (Tahap 1: Putusan)</span>
            </h3>
            <p className="text-xs text-stone-500 mt-1">
              Kontribusi: <code>{target.id}</code> (Versi {target.version} · Maksimal Pengembalian:{" "}
              {formatNominal(maxRefundable, target.currencyUnit)})
            </p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 font-bold" aria-label="Tutup">
            ✕
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label htmlFor={amountId} className={labelClass}>
              Nominal Pengembalian ({target.currencyUnit}) <span className="text-rose-600">*</span>
            </label>
            <input
              id={amountId}
              type="text"
              value={amountExact}
              onChange={(e) => setAmountExact(e.target.value)}
              placeholder="Misal: 300000"
              className={fieldClass}
            />
            <span className="text-[11px] text-stone-500 mt-1 block">
              Dana yang belum dialokasikan dan dapat dikembalikan: {formatNominal(maxRefundable, target.currencyUnit)}.
            </span>
          </div>

          <div>
            <label htmlFor={reasonId} className={labelClass}>
              Alasan Pengembalian <span className="text-rose-600">*</span>
            </label>
            <textarea
              id={reasonId}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: Permohonan pembatalan dari donatur karena kelebihan transfer"
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor={policyId} className={labelClass}>
              Dasar Kebijakan Syariah / SOP Lembaga <span className="text-rose-600">*</span>
            </label>
            <input
              id={policyId}
              type="text"
              value={policyBasis}
              onChange={(e) => setPolicyBasis(e.target.value)}
              placeholder="Contoh: SOP Pengembalian Dana Zakat No. 04/2026"
              className={fieldClass}
            />
          </div>

          <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-amber-900 flex items-start gap-2 text-[11px]">
            <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <strong>Kebijakan Syariah & Payout (AC03, US-45):</strong> ZKT <strong>tidak menyediakan payout bank otomatis</strong>.
              Tidak ada hak bebas pengembalian sepihak untuk dana terikat syariah. Keputusan ini mencatat persetujuan
              pengesahan lembaga secara administratif; realisasi pembayaran riil dicatat terpisah pada tahap berikutnya.
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={submitting || !reason.trim() || !policyBasis.trim() || !amountExact.trim()}
          >
            {submitting ? "Mencatat Keputusan…" : "Putuskan Pengembalian"}
          </Button>
        </div>
      </div>
    </div>
  );
}

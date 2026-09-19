import { useId, useState } from "react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { formatNominal, payRefund, type ContributionRefund, type CurrencyUnit } from "./contributionClient";
import { at, errorMessage, toLocalInput, useOperationIds, useActionError } from "./contributionUi";
import { ContributionActionDialog, contributionFieldClass as fieldClass } from "./ContributionActionDialog";

export function RefundPaymentModal({ requests, contributionId, refund, currencyUnit, onDone, onClose, onError }: {
  requests: PrivateRequests; contributionId: string; refund: ContributionRefund; currencyUnit: CurrencyUnit;
  onDone: (refund: ContributionRefund) => void; onClose: () => void; onError: (message: string | null) => void;
}) {
  const id = useId();
  const { error, reportError } = useActionError(onError);
  const [paymentProofRef, setPaymentProofRef] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentTime, setPaymentTime] = useState(() => toLocalInput(Math.floor(Date.now() / 1000)));
  const [submitting, setSubmitting] = useState(false);
  const operations = useOperationIds();
  const submit = async () => {
    if (submitting) return;
    const paidAt = Math.floor(new Date(paymentTime).getTime() / 1000);
    if (!paymentProofRef.trim() || !Number.isSafeInteger(paidAt) || paidAt <= 0) {
      reportError("Bukti pembayaran dan waktu pembayaran aktual wajib diisi.");
      return;
    }
    const input = { paymentProofRef: paymentProofRef.trim(), paymentNotes: paymentNotes.trim() || undefined, paidAt };
    const intent = JSON.stringify([contributionId, refund.id, input]);
    setSubmitting(true);
    reportError(null);
    try {
      const result = await payRefund(requests, contributionId, refund.id, { ...input, operationId: operations.operationFor(intent) });
      operations.settle(intent);
      onDone(result.refund);
    } catch (error) { reportError(errorMessage(error, "Gagal mencatat realisasi pengembalian.")); }
    finally { setSubmitting(false); }
  };
  return (
    <ContributionActionDialog error={error} title="Catat Pembayaran Pengembalian" submitting={submitting} onSubmit={submit} onClose={onClose}
      disabled={!paymentProofRef.trim() || !paymentTime} submitLabel="Catat Pembayaran Selesai"
      summary={<>Nominal: {formatNominal(refund.amountExact, currencyUnit)}</>}>
      <div className="p-3 bg-stone-50 rounded-lg text-stone-700 space-y-1">
        <p>Alasan putusan: {refund.reason}</p><p>Dasar kebijakan: {refund.policyBasis}</p>
        <p>Diputuskan oleh {refund.decidedBy} pada {at(refund.decidedAt)}</p>
      </div>
      <label className="block" htmlFor={`${id}-proof`}>Referensi Bukti Pembayaran (Wajib)</label>
      <input id={`${id}-proof`} value={paymentProofRef} onChange={e => setPaymentProofRef(e.target.value)} className={fieldClass} />
      <label className="block" htmlFor={`${id}-time`}>Waktu Pembayaran Aktual (Wajib)</label>
      <input id={`${id}-time`} type="datetime-local" value={paymentTime} onChange={e => setPaymentTime(e.target.value)} className={fieldClass} />
      <label className="block" htmlFor={`${id}-notes`}>Catatan Pembayaran (Opsional)</label>
      <textarea id={`${id}-notes`} rows={2} value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)} className={fieldClass} />
      <p className="p-3 bg-emerald-50 rounded-lg text-emerald-950">
        Catat pembayaran yang sudah dilaksanakan melalui kanal lembaga. Jika respons terputus, coba lagi dengan isian yang sama.
      </p>
    </ContributionActionDialog>
  );
}

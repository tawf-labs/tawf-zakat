import { useId, useState } from "react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { decideRefund, formatNominal, type ContributionRecord, type ContributionRefund } from "./contributionClient";
import { errorMessage, useOperationIds, useActionError } from "./contributionUi";
import { ContributionActionDialog, contributionFieldClass as fieldClass } from "./ContributionActionDialog";

export function RefundDecisionModal({ requests, target, refunds, onDone, onClose, onError }: {
  requests: PrivateRequests; target: ContributionRecord; refunds: ContributionRefund[];
  onDone: (refund: ContributionRefund) => void; onClose: () => void; onError: (message: string | null) => void;
}) {
  const id = useId();
  const { error, reportError } = useActionError(onError);
  const reserved = refunds.filter(r => r.status !== "CANCELLED").reduce((sum, r) => sum + BigInt(r.amountExact), 0n);
  const remaining = BigInt(target.amountExact) - reserved;
  const maximum = remaining > 0n ? remaining : 0n;
  const [amountExact, setAmountExact] = useState("");
  const [reason, setReason] = useState("");
  const [policyBasis, setPolicyBasis] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const operations = useOperationIds();
  const submit = async () => {
    if (submitting) return;
    if (!/^[1-9]\d*$/.test(amountExact.trim()) || BigInt(amountExact.trim()) > maximum) {
      reportError("Nominal pengembalian harus positif dan tidak melebihi kontribusi setelah keputusan pengembalian sebelumnya.");
      return;
    }
    if (reason.trim().length < 5 || policyBasis.trim().length < 5) {
      reportError("Alasan dan dasar kebijakan lembaga wajib diisi, masing-masing minimal 5 karakter.");
      return;
    }
    const input = { expectedVersion: target.version, amountExact: amountExact.trim(), reason: reason.trim(), policyBasis: policyBasis.trim() };
    const intent = JSON.stringify([target.id, input]);
    setSubmitting(true);
    reportError(null);
    try {
      const result = await decideRefund(requests, target.id, { ...input, operationId: operations.operationFor(intent) });
      operations.settle(intent);
      onDone(result.refund);
    } catch (error) { reportError(errorMessage(error, "Gagal mencatat keputusan pengembalian dana.")); }
    finally { setSubmitting(false); }
  };
  return (
    <ContributionActionDialog error={error} title="Keputusan Pengembalian Dana" submitting={submitting} onSubmit={submit} onClose={onClose}
      disabled={!amountExact.trim() || reason.trim().length < 5 || policyBasis.trim().length < 5} submitLabel="Catat Keputusan"
      summary={<>Versi {target.version} · Maksimal {formatNominal(maximum.toString(), target.currencyUnit)}</>}>
      <label className="block" htmlFor={`${id}-amount`}>Nominal Pengembalian ({target.currencyUnit})</label>
      <input id={`${id}-amount`} value={amountExact} onChange={e => setAmountExact(e.target.value)} className={fieldClass} />
      <p className="text-stone-500">Sisa belum dialokasikan: {formatNominal(target.unallocatedAmount ?? "0", target.currencyUnit)}.
        Pengembalian yang mengurangi pendanaan kegiatan dapat menimbulkan selisih yang perlu diselesaikan lembaga.</p>
      <label className="block" htmlFor={`${id}-reason`}>Alasan Pengembalian</label>
      <textarea id={`${id}-reason`} rows={2} value={reason} onChange={e => setReason(e.target.value)} className={fieldClass} />
      <label className="block" htmlFor={`${id}-policy`}>Dasar Kebijakan Jenis Dana / SOP Lembaga</label>
      <input id={`${id}-policy`} value={policyBasis} onChange={e => setPolicyBasis(e.target.value)} className={fieldClass} />
      <p className="p-3 bg-amber-50 rounded-lg text-amber-900">
        Catat keputusan lembaga sesuai kebijakan jenis dana. Keputusan belum berarti uang telah dikembalikan.
        Pembayaran dilakukan melalui kanal lembaga dan bukti pelaksanaannya dicatat terpisah oleh petugas.
      </p>
    </ContributionActionDialog>
  );
}

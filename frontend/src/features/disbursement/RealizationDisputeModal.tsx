import { useRealizationDisputes } from "./useRealizationQueries";
import { useRealizationMutation, MutationFeedback } from "./useRealizationMutation";
import { useId, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/Dialog";
import type { PrivateRequests } from "../workspace/privateRequests";
import { formatIdrAmount } from "../workspace/mandateLabels";
import {
  COMPLAINANT_TYPE_LABELS,
  DISPUTE_STATUS_LABELS,
  DISPUTE_SUBJECT_LABELS,
  examineRealizationDispute,
  recordRealizationDispute,
  type ComplainantType,
  type DisbursementRealization,
  type DisputeOutcome,
  type DisputeSubject,
} from "./disbursementClient";

/**
 * Objections to receipt or amount, with the authorized examination history. A dispute holds
 * final confirmation; it never deletes or recounts the realization.
 */
export function RealizationDisputeModal({ requests, proposalId, realization, beneficiaryName, isOpen, onClose, onChanged }: {
  requests: PrivateRequests;
  proposalId: string;
  realization: DisbursementRealization;
  beneficiaryName: string;
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const id = useId();
  const query = useRealizationDisputes(requests, proposalId, realization.id, isOpen);
  const disputes = query.data ?? [];
  const isGoods = realization.quantity != null;
  const [complainantType, setComplainantType] = useState<ComplainantType>("BENEFICIARY");
  const [subject, setSubject] = useState<DisputeSubject>("AMOUNT");
  const [amount, setAmount] = useState(realization.amountIdr ?? "");
  const [quantity, setQuantity] = useState(realization.quantity ?? "");
  const [reason, setReason] = useState("");
  const [examining, setExamining] = useState<{ disputeId: string; outcome: DisputeOutcome; notes: string } | null>(null);
  type Write = { kind: "record"; input: Parameters<typeof recordRealizationDispute>[3]; operationId: string }
    | { kind: "examine"; disputeId: string; input: Parameters<typeof examineRealizationDispute>[4]; operationId: string };
  const operation = useRealizationMutation(requests, (write: Write) => write.kind === "record"
    ? recordRealizationDispute(requests, proposalId, realization.id, write.input)
    : examineRealizationDispute(requests, proposalId, realization.id, write.disputeId, write.input), (write) => {
      if (write.kind === "record") setReason(""); else setExamining(null);
      onChanged();
    });
  const busy = operation.locked;
  const record = () => operation.submit((operationId) => ({
    kind: "record",
    operationId,
    input: {
      operationId,
      complainantType,
      subject,
      reason: reason.trim(),
      disputedAmountIdr: isGoods ? null : amount,
      disputedQuantity: isGoods ? quantity : null,
      disputedUnit: isGoods ? realization.unit : null,
    },
  }));
  const examine = () => operation.submit((operationId) => ({ kind: "examine", operationId, disputeId: examining!.disputeId,
    input: { operationId, outcome: examining!.outcome, notes: examining!.notes.trim() } }));

  const realizationDisplay = isGoods
    ? `${realization.quantity} ${realization.unit}`
    : formatIdrAmount(realization.amountIdr ?? "0");

  return <Dialog open={isOpen} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" showCloseButton={!busy}>
      <DialogTitle>Keberatan atas penerimaan</DialogTitle>
      <DialogDescription>
        {beneficiaryName} · {realizationDisplay}. Keberatan menahan konfirmasi akhir; realisasi yang tercatat tidak dihapus atau dihitung ulang.
        Dokumen yang belum lengkap bukan keberatan.
      </DialogDescription>

      {disputes.length > 0 && <section className="space-y-2 text-sm">
        <h4 className="font-semibold">Riwayat keberatan</h4>
        {disputes.map((dispute) => {
          const disputeDisplay = dispute.disputedQuantity != null
            ? `${dispute.disputedQuantity} ${dispute.disputedUnit}`
            : formatIdrAmount(dispute.disputedAmountIdr ?? "0");
          return (
            <article key={dispute.id} className="space-y-1 rounded-lg border border-stone-200 p-3 text-xs">
              <p className="flex flex-wrap justify-between gap-2 font-semibold">
                <span>{DISPUTE_SUBJECT_LABELS[dispute.subject]} · {disputeDisplay}</span>
                <span>{DISPUTE_STATUS_LABELS[dispute.status]}</span>
              </p>
              <p>Pelapor: {COMPLAINANT_TYPE_LABELS[dispute.complainantType]} · {new Date(dispute.createdAt * 1000).toLocaleDateString("id-ID")}</p>
              <p>{dispute.reason}</p>
              {dispute.examinations.length > 0 && <ol className="space-y-1 border-l-2 border-stone-200 pl-2">
                {dispute.examinations.map((exam) => <li key={exam.id}>
                  <span className="font-semibold">{exam.outcome === "RESOLVED" ? "Diselesaikan" : "Diperiksa"}</span>{" "}
                  {new Date(exam.examinedAt * 1000).toLocaleDateString("id-ID")}: {exam.notes}
                </li>)}
              </ol>}
              {dispute.status !== "RESOLVED" && (examining?.disputeId === dispute.id
                ? <form className="space-y-2 pt-1" onSubmit={(event) => { event.preventDefault(); void examine(); }}>
                  <label className="block font-semibold" htmlFor={`${id}-outcome-${dispute.id}`}>
                    Hasil pemeriksaan berwenang
                    <select id={`${id}-outcome-${dispute.id}`} value={examining.outcome} disabled={busy} className="mt-1 w-full rounded-lg border border-stone-300 p-2 font-normal"
                      onChange={(event) => setExamining({ ...examining, outcome: event.target.value as DisputeOutcome })}>
                      <option value="EXAMINED">Sudah diperiksa, keberatan tetap ditahan</option>
                      <option value="RESOLVED">Selesai, tahanan konfirmasi dilepas</option>
                    </select>
                  </label>
                  <label className="block font-semibold" htmlFor={`${id}-exam-notes-${dispute.id}`}>
                    Catatan pemeriksaan
                    <textarea id={`${id}-exam-notes-${dispute.id}`} rows={2} value={examining.notes} disabled={busy} className="mt-1 w-full rounded-lg border border-stone-300 p-2 font-normal"
                      onChange={(event) => setExamining({ ...examining, notes: event.target.value })} />
                  </label>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setExamining(null)}>Batal</Button>
                    <Button type="submit" size="sm" disabled={busy || !examining.notes.trim()}>Simpan hasil</Button>
                  </div>
                </form>
                : <Button type="button" variant="outline" size="sm" disabled={busy}
                  onClick={() => setExamining({ disputeId: dispute.id, outcome: "EXAMINED", notes: "" })}>Catat hasil pemeriksaan</Button>)}
            </article>
          );
        })}
      </section>}

      <form className="space-y-3 border-t border-stone-100 pt-3 text-sm" onSubmit={(event) => { event.preventDefault(); void record(); }}>
        <h4 className="font-semibold">Catat keberatan baru</h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block text-xs font-semibold" htmlFor={`${id}-complainant`}>
            Pelapor
            <select id={`${id}-complainant`} value={complainantType} disabled={busy} className="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm font-normal"
              onChange={(event) => setComplainantType(event.target.value as ComplainantType)}>
              {(Object.keys(COMPLAINANT_TYPE_LABELS) as ComplainantType[]).map((value) => <option key={value} value={value}>{COMPLAINANT_TYPE_LABELS[value]}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold" htmlFor={`${id}-subject`}>
            Bagian yang diperselisihkan
            <select id={`${id}-subject`} value={subject} disabled={busy} className="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm font-normal"
              onChange={(event) => setSubject(event.target.value as DisputeSubject)}>
              {(Object.keys(DISPUTE_SUBJECT_LABELS) as DisputeSubject[]).map((value) => <option key={value} value={value}>{DISPUTE_SUBJECT_LABELS[value]}</option>)}
            </select>
          </label>
          {isGoods ? (
            <label className="block text-xs font-semibold sm:col-span-2" htmlFor={`${id}-quantity`}>
              Kuantitas yang diperselisihkan ({realization.unit})
              <input id={`${id}-quantity`} inputMode="decimal" value={quantity} disabled={busy} className="mt-1 w-full rounded-lg border border-stone-300 p-2 font-mono text-sm font-normal"
                onChange={(event) => setQuantity(event.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
          ) : (
            <label className="block text-xs font-semibold sm:col-span-2" htmlFor={`${id}-amount`}>
              Nominal yang diperselisihkan (Rp)
              <input id={`${id}-amount`} inputMode="numeric" value={amount} disabled={busy} className="mt-1 w-full rounded-lg border border-stone-300 p-2 font-mono text-sm font-normal"
                onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))} />
            </label>
          )}
        </div>
        <label className="block text-xs font-semibold" htmlFor={`${id}-reason`}>
          Uraian keberatan
          <textarea id={`${id}-reason`} rows={2} value={reason} disabled={busy} className="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm font-normal"
            onChange={(event) => setReason(event.target.value)} />
        </label>
        <MutationFeedback operation={operation} />
        {query.error && <p role="alert">{query.error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>Tutup</Button>
          <Button type="submit" size="sm" disabled={busy || !reason.trim() || (isGoods ? !quantity : !amount)}>Catat keberatan</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

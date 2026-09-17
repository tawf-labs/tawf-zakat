import { useRealizationAccounts } from "./useRealizationQueries";
import { useRealizationMutation, MutationFeedback } from "./useRealizationMutation";
import { useId, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/Dialog";
import type { PrivateRequests } from "../workspace/privateRequests";
import { formatIdrAmount } from "../workspace/mandateLabels";
import {
  recordRealizationAdvance,
  recordRealizationExpense,
} from "./disbursementClient";

const inputClass = "mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm font-normal";

/**
 * Officer advances and the expenses accounting for them, kept apart from aid received.
 * A reference record only: it neither pays anything nor keeps full accounts.
 */
export function AdvancesAndExpensesModal({ requests, proposalId, isOpen, onClose, onChanged }: {
  requests: PrivateRequests;
  proposalId: string;
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const id = useId();
  const { advances, expenses, error } = useRealizationAccounts(requests, proposalId, isOpen);
  const [advance, setAdvance] = useState({ amountIdr: "", purpose: "", reference: "" });
  const [expense, setExpense] = useState({ amountIdr: "", purpose: "", payee: "", documentRef: "", advanceId: "" });
  type Write = { kind: "advance"; input: Parameters<typeof recordRealizationAdvance>[2]; operationId: string }
    | { kind: "expense"; input: Parameters<typeof recordRealizationExpense>[2]; operationId: string };
  const operation = useRealizationMutation(requests, async (write: Write) => write.kind === "advance"
    ? recordRealizationAdvance(requests, proposalId, write.input)
    : recordRealizationExpense(requests, proposalId, write.input), (write) => {
      if (write.kind === "advance") setAdvance({ amountIdr: "", purpose: "", reference: "" });
      else setExpense({ amountIdr: "", purpose: "", payee: "", documentRef: "", advanceId: "" });
      onChanged();
    });
  const busy = operation.locked;
  const saveAdvance = () => operation.submit((operationId) => ({ kind: "advance", operationId,
    input: { ...advance, operationId, purpose: advance.purpose.trim(), reference: advance.reference.trim() } }));
  const saveExpense = () => operation.submit((operationId) => ({ kind: "expense", operationId,
    input: { ...expense, operationId, advanceId: expense.advanceId || null, purpose: expense.purpose.trim(),
      payee: expense.payee.trim(), documentRef: expense.documentRef.trim() } }));

  const digits = (value: string) => value.replace(/\D/g, "");

  return <Dialog open={isOpen} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" showCloseButton={!busy}>
      <DialogTitle>Uang muka dan biaya operasional</DialogTitle>
      <DialogDescription>
        Dicatat terpisah dari bantuan yang diterima penerima manfaat, dan tidak pernah dihitung sebagai realisasi bantuan.
      </DialogDescription>

      <section className="space-y-2 text-sm">
        <h4 className="font-semibold">Uang muka petugas</h4>
        {advances.length === 0 ? <p className="text-xs text-stone-600">Belum ada uang muka.</p> : <ul className="space-y-1">
          {advances.map((item) => <li key={item.id} className="rounded-lg border border-stone-200 p-2 text-xs">
            <p className="font-semibold">{item.purpose} · {formatIdrAmount(item.amountIdr)}</p>
            <p>Ref {item.reference} · dipertanggungjawabkan {formatIdrAmount(item.accountedIdr)} · sisa {formatIdrAmount(item.unaccountedIdr)}</p>
          </li>)}
        </ul>}
        <form className="grid grid-cols-1 gap-2 rounded-lg bg-stone-50 p-2 sm:grid-cols-3" onSubmit={(event) => { event.preventDefault(); void saveAdvance(); }}>
          <label className="block text-xs font-semibold" htmlFor={`${id}-adv-amount`}>Nominal (Rp)
            <input id={`${id}-adv-amount`} inputMode="numeric" value={advance.amountIdr} disabled={busy} className={inputClass}
              onChange={(event) => setAdvance({ ...advance, amountIdr: digits(event.target.value) })} /></label>
          <label className="block text-xs font-semibold" htmlFor={`${id}-adv-purpose`}>Tujuan
            <input id={`${id}-adv-purpose`} value={advance.purpose} disabled={busy} className={inputClass}
              onChange={(event) => setAdvance({ ...advance, purpose: event.target.value })} /></label>
          <label className="block text-xs font-semibold" htmlFor={`${id}-adv-ref`}>Referensi pertanggungjawaban
            <input id={`${id}-adv-ref`} value={advance.reference} disabled={busy} className={inputClass}
              onChange={(event) => setAdvance({ ...advance, reference: event.target.value })} /></label>
          <div className="sm:col-span-3"><Button type="submit" size="sm" disabled={busy || !advance.amountIdr || !advance.purpose.trim() || !advance.reference.trim()}>Catat uang muka</Button></div>
        </form>
      </section>

      <section className="space-y-2 border-t border-stone-100 pt-3 text-sm">
        <h4 className="font-semibold">Biaya operasional</h4>
        {expenses.length === 0 ? <p className="text-xs text-stone-600">Belum ada biaya.</p> : <ul className="space-y-1">
          {expenses.map((item) => <li key={item.id} className="rounded-lg border border-stone-200 p-2 text-xs">
            <p className="font-semibold">{item.purpose} · {formatIdrAmount(item.amountIdr)}</p>
            <p>Payee {item.payee} · dokumen {item.documentRef}{item.advanceId ? ` · uang muka ${advances.find((a) => a.id === item.advanceId)?.reference ?? item.advanceId}` : ""}</p>
          </li>)}
        </ul>}
        <form className="grid grid-cols-1 gap-2 rounded-lg bg-stone-50 p-2 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void saveExpense(); }}>
          <label className="block text-xs font-semibold" htmlFor={`${id}-exp-amount`}>Nominal (Rp)
            <input id={`${id}-exp-amount`} inputMode="numeric" value={expense.amountIdr} disabled={busy} className={inputClass}
              onChange={(event) => setExpense({ ...expense, amountIdr: digits(event.target.value) })} /></label>
          <label className="block text-xs font-semibold" htmlFor={`${id}-exp-purpose`}>Tujuan
            <input id={`${id}-exp-purpose`} value={expense.purpose} disabled={busy} className={inputClass}
              onChange={(event) => setExpense({ ...expense, purpose: event.target.value })} /></label>
          <label className="block text-xs font-semibold" htmlFor={`${id}-exp-payee`}>Payee
            <input id={`${id}-exp-payee`} value={expense.payee} disabled={busy} className={inputClass}
              onChange={(event) => setExpense({ ...expense, payee: event.target.value })} /></label>
          <label className="block text-xs font-semibold" htmlFor={`${id}-exp-doc`}>Dokumen rujukan
            <input id={`${id}-exp-doc`} value={expense.documentRef} disabled={busy} className={inputClass}
              onChange={(event) => setExpense({ ...expense, documentRef: event.target.value })} /></label>
          <label className="block text-xs font-semibold sm:col-span-2" htmlFor={`${id}-exp-advance`}>Mempertanggungjawabkan uang muka (opsional)
            <select id={`${id}-exp-advance`} value={expense.advanceId} disabled={busy} className={inputClass}
              onChange={(event) => setExpense({ ...expense, advanceId: event.target.value })}>
              <option value="">Tidak terkait uang muka</option>
              {advances.map((item) => <option key={item.id} value={item.id}>{item.reference} · sisa {formatIdrAmount(item.unaccountedIdr)}</option>)}
            </select></label>
          <div className="sm:col-span-2"><Button type="submit" size="sm"
            disabled={busy || !expense.amountIdr || !expense.purpose.trim() || !expense.payee.trim() || !expense.documentRef.trim()}>Catat biaya</Button></div>
        </form>
      </section>

      <MutationFeedback operation={operation} />
      {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error.message}</p>}
      <div className="flex justify-end"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>Tutup</Button></div>
    </DialogContent>
  </Dialog>;
}

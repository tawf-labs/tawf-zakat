import { compareDecimalStrings } from "../../../../shared/exact-decimal";
import { RealizationPaymentRecipientFields, type PaymentRecipientFields } from "./RealizationPaymentRecipientFields";
import { useId, useState } from "react";
import { RealizationRecipientRows, type RealizationRow } from "./RealizationRecipientRows";
import { Button } from "../../components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/Dialog";
import type { PrivateRequests } from "../workspace/privateRequests";
import { validateRealizationRows } from "./validateRealizationRows";
import {
  DISBURSEMENT_METHOD_LABELS,
  recordRealizations,
  type DisbursementMethod,
  type DisbursementRealization,
  type ProposalDraft,
  type ProposalRealizationSummary,
  type RecordRealizationInput,
} from "./disbursementClient";
import { useRetryableOperation, type OperationState } from "./useRetryableOperation";


const STATE_TEXT: Record<OperationState, string> = {
  IDLE: "Belum tersimpan",
  SAVING: "Menyimpan realisasi…",
  SAVED: "Realisasi tersimpan",
  REFUSED: "Belum tersimpan: periksa isian",
  UNKNOWN: "Hasil penyimpanan belum diketahui",
};

const today = () => {
  const now = new Date(Date.now());
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/**
 * Records one handover, or a group handover for several beneficiaries in one batch.
 * The app records what already happened outside it; it never sends money.
 */
export function RecordRealizationModal({ requests, draft, summary, notice, isOpen, onClose, onRecorded }: {
  requests: PrivateRequests;
  draft: ProposalDraft;
  summary: ProposalRealizationSummary;
  notice: string;
  isOpen: boolean;
  onClose: () => void;
  onRecorded: (records: DisbursementRealization[], summary: ProposalRealizationSummary, addEvidence: boolean) => void;
}) {
  const id = useId();
  const open = summary.lines.filter((line) =>
    line.kind === "GOODS"
      ? (line.quantityRemaining != null && compareDecimalStrings(line.quantityRemaining, "0") > 0)
      : (BigInt(line.amountRemainingIdr ?? "0") > 0n)
  );
  const initialLine = open[0];
  const [rows, setRows] = useState<RealizationRow[]>(() => [
    initialLine?.kind === "GOODS"
      ? { key: crypto.randomUUID(), aidLineId: initialLine.aidLineId, amountIdr: "", quantity: initialLine.quantityRemaining ?? "", unit: initialLine.unit ?? "" }
      : { key: crypto.randomUUID(), aidLineId: initialLine?.aidLineId ?? "", amountIdr: initialLine?.amountRemainingIdr ?? "" }
  ]);
  const [reportedDate, setReportedDate] = useState(today);
  const [method, setMethod] = useState<DisbursementMethod>("CASH");
  const [payment, setPayment] = useState<PaymentRecipientFields>({ enabled: false, name: "", relation: "" });
  const [notes, setNotes] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<{ records: DisbursementRealization[]; summary: ProposalRealizationSummary } | null>(null);

  const operation = useRetryableOperation(
    (payload: RecordRealizationInput) => recordRealizations(requests, draft.id, payload),
    "Hasil penyimpanan belum diketahui. Kirim ulang untuk memeriksa penyimpanan yang sama; realisasi tidak akan tercatat ganda."
  );
  const locked = operation.locked || recorded !== null;

  const lineOf = (aidLineId: string) => summary.lines.find((line) => line.aidLineId === aidLineId);

  function validate(): string | null {
    const [year, month, day] = reportedDate.split("-").map(Number);
    if (!year || !month || !day) return "Tanggal kejadian wajib diisi.";
    const rowProblem = validateRealizationRows(rows, summary);
    if (rowProblem) return rowProblem;
    if (payment.enabled && (!payment.name.trim() || !payment.relation.trim())) return "Nama penerima pembayaran dan hubungannya wajib diisi.";
    return null;
  }

  async function save() {
    const problem = operation.state === "UNKNOWN" ? null : validate();
    setValidation(problem);
    if (problem) return;
    const [year, month, day] = reportedDate.split("-").map(Number);
    const reportedAt = Math.floor(new Date(year!, month! - 1, day!, 12).getTime() / 1000);
    const result = await operation.run((operationId) => ({
      operationId,
      expectedVersion: draft.version,
      batchGroupId: rows.length > 1 ? `kelompok-${operationId}` : null,
      items: rows.map((row) => {
        const line = lineOf(row.aidLineId)!;
        const isGoods = line.kind === "GOODS";
        return {
          aidLineId: row.aidLineId,
          beneficiaryId: line.beneficiaryId,
          method: isGoods ? "GOODS_HANDOVER" : method,
          amountIdr: isGoods ? null : row.amountIdr,
          quantity: isGoods ? row.quantity : null,
          unit: isGoods ? (row.unit || line.unit) : null,
          reportedAt,
          paymentRecipient: payment.enabled ? { name: payment.name.trim(), relation: payment.relation.trim() } : null,
          notes: notes.trim() || null,
        };
      }),
    }));
    if (result) setRecorded({ records: result.records, summary: result.summary });
  }

  function finish(addEvidence: boolean) {
    if (recorded) onRecorded(recorded.records, recorded.summary, addEvidence);
    onClose();
  }

  const status = STATE_TEXT[operation.state];
  return <Dialog open={isOpen} onOpenChange={(next) => { if (!next && !operation.locked) (recorded ? finish(false) : onClose()); }}>
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" showCloseButton={!operation.locked}>
      <DialogTitle>Catat realisasi penyaluran</DialogTitle>
      <DialogDescription>{notice}</DialogDescription>

      <form className="space-y-4 text-sm text-stone-800" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={locked} className="space-y-4">
          <RealizationRecipientRows id={id} rows={rows} setRows={setRows} summary={summary} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold" htmlFor={`${id}-date`}>
              Tanggal kejadian (laporan lapangan)
              <input id={`${id}-date`} type="date" max={today()} value={reportedDate} required className="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm font-normal"
                onChange={(event) => setReportedDate(event.target.value)} />
            </label>
            <label className="block text-xs font-semibold" htmlFor={`${id}-method`}>
              Cara penyaluran uang (barang dicatat sebagai penyerahan barang)
              <select id={`${id}-method`} value={method} className="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm font-normal"
                onChange={(event) => setMethod(event.target.value as DisbursementMethod)}>
                {(["CASH", "BANK_TRANSFER"] as const).map((value) =>
                  <option key={value} value={value}>{DISBURSEMENT_METHOD_LABELS[value]}</option>)}
              </select>
            </label>
          </div>
          <p className="text-xs text-stone-600">Waktu pencatatan server dan akun operator dicatat otomatis, terpisah dari tanggal kejadian.</p>

          <RealizationPaymentRecipientFields value={payment} onChange={setPayment} />

          <label className="block text-xs font-semibold" htmlFor={`${id}-notes`}>
            Catatan pelaksanaan (opsional)
            <input id={`${id}-notes`} value={notes} className="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm font-normal"
              onChange={(event) => setNotes(event.target.value)} />
          </label>
        </fieldset>

        <p role="status" aria-live="polite" className={`rounded-md px-3 py-2 text-xs font-semibold ${operation.state === "SAVED" ? "bg-emerald-50 text-emerald-800" : operation.state === "UNKNOWN" ? "bg-amber-50 text-amber-900" : "bg-stone-100 text-stone-700"}`}>
          {status}
        </p>
        {(validation ?? operation.error) && <p role="alert" className="rounded-md bg-red-50 p-2 text-xs text-red-700">{validation ?? operation.error}</p>}
        {recorded && <p className="text-xs text-stone-700">
          Bukti dapat menyusul. Sampai bukti lengkap, realisasi ini tetap memotong sisa hak dan masuk antrean bukti belum lengkap.
        </p>}

        <div className="flex flex-wrap justify-end gap-2 border-t border-stone-100 pt-3">
          {recorded ? <>
            <Button type="button" variant="outline" size="sm" onClick={() => finish(false)}>Selesai</Button>
            <Button type="button" size="sm" onClick={() => finish(true)}>Unggah bukti sekarang</Button>
          </> : <>
            <Button type="button" variant="outline" size="sm" disabled={operation.locked} onClick={onClose}>Batal</Button>
            <Button type="submit" size="sm" disabled={operation.state === "SAVING" || !open.length}>
              {operation.state === "UNKNOWN" ? "Kirim ulang penyimpanan" : operation.state === "SAVING" ? "Menyimpan…" : "Simpan realisasi"}
            </Button>
          </>}
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

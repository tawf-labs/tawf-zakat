import { RealizationPaymentRecipientFields, type PaymentRecipientFields } from "./RealizationPaymentRecipientFields";
import { useId, useState } from "react";
import { RealizationRecipientRows, type RealizationRow } from "./RealizationRecipientRows";
import { Button } from "../../components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/Dialog";
import type { PrivateRequests } from "../workspace/privateRequests";
import { formatIdrAmount } from "../workspace/mandateLabels";
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
  const open = summary.lines.filter((line) => BigInt(line.amountRemainingIdr) > 0n);
  const [rows, setRows] = useState<RealizationRow[]>(() => [{ key: crypto.randomUUID(), aidLineId: open[0]?.aidLineId ?? "", amountIdr: open[0]?.amountRemainingIdr ?? "" }]);
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
    const chosen = new Set<string>();
    for (const row of rows) {
      const line = lineOf(row.aidLineId);
      if (!line) return "Pilih rincian bantuan untuk setiap baris.";
      if (chosen.has(row.aidLineId)) return `${line.beneficiaryName} dipilih lebih dari sekali.`;
      chosen.add(row.aidLineId);
      if (!/^\d+$/.test(row.amountIdr) || BigInt(row.amountIdr) <= 0n) return `Nominal untuk ${line.beneficiaryName} harus rupiah bulat lebih dari nol.`;
      if (BigInt(row.amountIdr) > BigInt(line.amountRemainingIdr)) return `Nominal untuk ${line.beneficiaryName} melebihi sisa hak ${formatIdrAmount(line.amountRemainingIdr)}.`;
    }
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
      items: rows.map((row) => ({
        aidLineId: row.aidLineId,
        beneficiaryId: lineOf(row.aidLineId)!.beneficiaryId,
        method,
        amountIdr: row.amountIdr,
        reportedAt,
        paymentRecipient: payment.enabled ? { name: payment.name.trim(), relation: payment.relation.trim() } : null,
        notes: notes.trim() || null,
      })),
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
      <DialogTitle>Catat realisasi penyaluran IDR</DialogTitle>
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
              Cara penyaluran
              <select id={`${id}-method`} value={method} className="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm font-normal"
                onChange={(event) => setMethod(event.target.value as DisbursementMethod)}>
                {(Object.keys(DISBURSEMENT_METHOD_LABELS) as DisbursementMethod[]).map((value) =>
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

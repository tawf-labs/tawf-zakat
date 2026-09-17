import { compareDecimalStrings, addDecimalStrings, subtractDecimalStrings, isExactNonNegativeDecimal } from "../../../../shared/exact-decimal";
import { useId, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/Dialog";
import type { PrivateRequests } from "../workspace/privateRequests";
import { formatIdrAmount } from "../workspace/mandateLabels";
import {
  readFileBase64,
  REALIZATION_DOCUMENT_TYPE_LABELS,
  REQUIRED_EVIDENCE_BY_METHOD,
  uploadRealizationDocument,
  type DisbursementRealization,
  type RealizationDocument,
  type RealizationDocumentType,
  type UploadRealizationDocumentInput,
} from "./disbursementClient";
import { useRetryableOperation } from "./useRetryableOperation";

/** How much of a realization its required evidence already accounts for. */
export function evidencedIdr(realization: DisbursementRealization, documents: RealizationDocument[]): bigint {
  const required = REQUIRED_EVIDENCE_BY_METHOD[realization.method];
  return documents
    .filter((doc) => doc.documentType === required)
    .flatMap((doc) => doc.allocations)
    .filter((allocation) => allocation.realizationId === realization.id && allocation.amountIdr != null)
    .reduce((total, allocation) => total + BigInt(allocation.amountIdr!), 0n);
}

export function evidencedQuantity(realization: DisbursementRealization, documents: RealizationDocument[]): string {
  const required = REQUIRED_EVIDENCE_BY_METHOD[realization.method];
  return documents
    .filter((doc) => doc.documentType === required)
    .flatMap((doc) => doc.allocations)
    .filter((allocation) => allocation.realizationId === realization.id && allocation.quantity != null)
    .reduce((total, allocation) => addDecimalStrings(total, allocation.quantity!), "0");
}

/**
 * Uploads a private evidence file and states the amount it evidences per realization.
 * For a group handover one BAST is allocated explicitly to each member of the batch;
 * a photo only supports and allocates nothing.
 */
export function RealizationEvidenceModal({ requests, proposalId, realization, realizations, documents, beneficiaryName, isOpen, onClose, onUploaded }: {
  requests: PrivateRequests;
  proposalId: string;
  realization: DisbursementRealization;
  realizations: DisbursementRealization[];
  documents: RealizationDocument[];
  beneficiaryName: (realization: DisbursementRealization) => string;
  isOpen: boolean;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const id = useId();
  const required = REQUIRED_EVIDENCE_BY_METHOD[realization.method];
  const batch = realization.batchGroupId
    ? realizations.filter((other) => other.batchGroupId === realization.batchGroupId && other.method === realization.method)
    : [realization];
  const isGoods = (target: DisbursementRealization) => target.quantity != null;
  const uncovered = (target: DisbursementRealization) => {
    if (isGoods(target)) {
      return subtractDecimalStrings(target.quantity!, evidencedQuantity(target, documents));
    }
    return (BigInt(target.amountIdr ?? "0") - evidencedIdr(target, documents)).toString();
  };

  const [documentType, setDocumentType] = useState<RealizationDocumentType>(required);
  const [file, setFile] = useState<File | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(batch.map((target) => [target.id, uncovered(target) === "0" ? "" : uncovered(target)])));
  const [validation, setValidation] = useState<string | null>(null);

  const operation = useRetryableOperation(
    ({ realizationId, ...input }: UploadRealizationDocumentInput & { realizationId: string }) =>
      uploadRealizationDocument(requests, proposalId, realizationId, input),
    "Hasil unggah bukti belum diketahui. Kirim ulang untuk memeriksa unggahan yang sama; bukti tidak akan tersimpan ganda."
  );

  async function upload() {
    const allocations = documentType === "SUPPORTING_PHOTO" ? [] : batch
      .filter((target) => amounts[target.id])
      .map((target) => {
        if (isGoods(target)) {
          return {
            realizationId: target.id,
            quantity: amounts[target.id]!,
            unit: target.unit ?? null,
            amountIdr: null,
          };
        }
        return {
          realizationId: target.id,
          amountIdr: amounts[target.id]!,
          quantity: null,
          unit: null,
        };
      });
    const problem = operation.state === "UNKNOWN" ? null
      : !file ? "Pilih berkas bukti."
      : documentType !== "SUPPORTING_PHOTO" && !allocations.some((allocation) => allocation.realizationId === realization.id)
        ? "Sebutkan jumlah yang dibuktikan untuk realisasi ini."
      : allocations.find((allocation) => {
          const target = batch.find((t) => t.id === allocation.realizationId)!;
          if (isGoods(target)) {
            return !allocation.quantity || !isExactNonNegativeDecimal(allocation.quantity)
              || compareDecimalStrings(allocation.quantity, "0") <= 0
              || compareDecimalStrings(allocation.quantity, uncovered(target)) > 0;
          }
          return !allocation.amountIdr || !/^\d+$/.test(allocation.amountIdr)
            || BigInt(allocation.amountIdr) <= 0n || BigInt(allocation.amountIdr) > BigInt(uncovered(target));
        })
        ? "Jumlah yang dibuktikan harus lebih dari nol dan tidak melebihi realisasi yang belum berbukti."
      : null;
    setValidation(problem);
    if (problem) return;
    const contentBase64 = operation.state === "UNKNOWN" ? "" : await readFileBase64(file!);
    const result = await operation.run((operationId) => ({
      operationId,
      realizationId: realization.id,
      documentType,
      fileName: file!.name,
      mimeType: file!.type || "application/octet-stream",
      contentBase64,
      batchGroupId: realization.batchGroupId,
      allocations,
    }));
    if (result) {
      onUploaded();
      onClose();
    }
  }

  return <Dialog open={isOpen} onOpenChange={(next) => { if (!next && !operation.locked) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" showCloseButton={!operation.locked}>
      <DialogTitle>Lengkapi bukti realisasi</DialogTitle>
      <DialogDescription>
        {realization.method === "CASH" || realization.method === "GOODS_HANDOVER"
          ? "Penyerahan tunai atau barang dibuktikan dengan tanda terima atau BAST beserta jumlahnya."
          : "Transfer dan pembayaran penyedia dibuktikan dengan bukti pembayaran."} Berkas disimpan privat; keberadaan berkas tidak membuktikan kebenaran isinya.
      </DialogDescription>

      <form className="space-y-4 text-sm text-stone-800" onSubmit={(event) => { event.preventDefault(); void upload(); }}>
        <fieldset disabled={operation.locked} className="space-y-4">
          <label className="block text-xs font-semibold" htmlFor={`${id}-type`}>
            Jenis bukti
            <select id={`${id}-type`} value={documentType} className="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm font-normal"
              onChange={(event) => setDocumentType(event.target.value as RealizationDocumentType)}>
              {[required, "SUPPORTING_PHOTO" as const].map((type) => <option key={type} value={type}>{REALIZATION_DOCUMENT_TYPE_LABELS[type]}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold" htmlFor={`${id}-file`}>
            Berkas bukti
            <input id={`${id}-file`} type="file" className="mt-1 w-full text-sm font-normal" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>

          {documentType === "SUPPORTING_PHOTO" ? <p className="text-xs text-stone-600">Foto hanya pendukung dan tidak melengkapi bukti.</p> : <div className="space-y-2">
            <p className="text-xs font-semibold">{batch.length > 1 ? "Alokasi bukti kelompok per penerima" : "Jumlah yang dibuktikan"}</p>
            {batch.map((target) => <label key={target.id} className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-[1fr_10rem] sm:items-center" htmlFor={`${id}-alloc-${target.id}`}>
              <span>
                {beneficiaryName(target)} · belum berbukti{" "}
                {isGoods(target) ? `${uncovered(target)} ${target.unit}` : formatIdrAmount(uncovered(target))}
              </span>
              <input id={`${id}-alloc-${target.id}`} inputMode={isGoods(target) ? "decimal" : "numeric"} value={amounts[target.id] ?? ""} className="rounded-lg border border-stone-300 p-2 font-mono text-sm"
                onChange={(event) => setAmounts((current) => ({
                  ...current,
                  [target.id]: isGoods(target)
                    ? event.target.value.replace(/[^0-9.]/g, "")
                    : event.target.value.replace(/\D/g, ""),
                }))} />
            </label>)}
          </div>}
        </fieldset>

        {operation.state !== "IDLE" && <p role="status" aria-live="polite" className="rounded-md bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-700">
          {operation.state === "SAVING" ? "Mengunggah bukti…" : operation.state === "UNKNOWN" ? "Hasil unggah belum diketahui" : operation.state === "SAVED" ? "Bukti tersimpan" : "Bukti belum tersimpan"}
        </p>}
        {(validation ?? operation.error) && <p role="alert" className="rounded-md bg-red-50 p-2 text-xs text-red-700">{validation ?? operation.error}</p>}

        <div className="flex justify-end gap-2 border-t border-stone-100 pt-3">
          <Button type="button" variant="outline" size="sm" disabled={operation.locked} onClick={onClose}>Batal</Button>
          <Button type="submit" size="sm" disabled={operation.state === "SAVING"}>
            {operation.state === "UNKNOWN" ? "Kirim ulang unggahan" : "Unggah bukti"}
          </Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

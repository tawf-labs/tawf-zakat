import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, FileUp, Lock, Paperclip, Trash2, Upload } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/Dialog";
import type { PrivateRequests } from "../workspace/privateRequests";
import { MutationFeedback, useRealizationMutation } from "./useRealizationMutation";
import { realizationKey } from "./useRealizationQueries";
import { base64Of } from "./beneficiaryFile";
import {
  createReceipt,
  deleteReceiptFile,
  downloadReceiptFile,
  RECEIPT_KIND_LABELS,
  uploadReceiptFile,
  type CostItem,
  type Receipt,
  type ReceiptFile,
  type ReceiptKind,
} from "./operationalCostClient";
import { displayDate, matchReceiptFiles } from "./operationalCostRows";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf";
const inputClass = "mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm font-normal";
const labelClass = "block text-xs font-semibold text-stone-700";

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);

function fileProblem(file: File): string | null {
  if (!/\.(jpe?g|png|pdf)$/i.test(file.name) && !["image/jpeg", "image/png", "application/pdf"].includes(file.type)) {
    return "bukan foto JPG/PNG atau PDF";
  }
  if (file.size > MAX_FILE_BYTES) return "melebihi 10 MB";
  if (file.size === 0) return "berkas kosong";
  return null;
}

// One retry identity per chosen file, so trying a failed upload again replays instead of storing twice.
const uploadIds = new WeakMap<File, string>();
const uploadIdOf = (file: File) => {
  let id = uploadIds.get(file);
  if (!id) { id = crypto.randomUUID(); uploadIds.set(file, id); }
  return id;
};

/** Uploads files one by one; returns what failed, each with its reason. */
async function uploadAll(requests: PrivateRequests, proposalId: string, pairs: { file: File; receiptId: string }[]) {
  const failed: { file: File; receiptId: string; reason: string }[] = [];
  for (const { file, receiptId } of pairs) {
    const problem = fileProblem(file);
    if (problem) { failed.push({ file, receiptId, reason: problem }); continue; }
    try {
      await uploadReceiptFile(requests, proposalId, receiptId, {
        operationId: uploadIdOf(file), fileName: file.name, mimeType: file.type || "application/octet-stream",
        contentBase64: await base64Of(file),
      });
    } catch (error) {
      failed.push({ file, receiptId, reason: error instanceof Error ? error.message : "gagal diunggah" });
    }
  }
  return failed;
}

function useRefresh(requests: PrivateRequests) {
  const client = useQueryClient();
  return () => { void client.invalidateQueries({ queryKey: realizationKey(requests) }); };
}

/** Lembar Nota: every nota and surat pernyataan of the proposal, with their files. */
export function ReceiptsSheet({ requests, proposalId, receipts, items, onOpenFiles }: {
  requests: PrivateRequests; proposalId: string; receipts: Receipt[]; items: CostItem[]; onOpenFiles: (receipt: Receipt) => void;
}) {
  const id = useId();
  const [form, setForm] = useState({ kind: "NOTA" as ReceiptKind, reference: "", issuedOn: new Date().toISOString().slice(0, 10), issuer: "" });
  const operation = useRealizationMutation(requests,
    (p: { operationId: string; kind: ReceiptKind; reference: string; issuedOn: string; issuer: string | null }) => createReceipt(requests, proposalId, p),
    () => setForm((f) => ({ ...f, reference: "", issuer: "" })));
  const citedBy = (receiptId: string) => items.filter((i) => i.receiptId === receiptId && i.status === "ACTIVE").length;

  return <div className="space-y-4 text-sm">
    <BulkUpload requests={requests} proposalId={proposalId} receipts={receipts} />

    {receipts.length === 0
      ? <p className="rounded-xl border border-dashed border-stone-200 p-4 text-center text-xs text-stone-600">
          Belum ada nota. Nota dibuat otomatis saat baris biaya dengan No. nota dicatat, atau tambahkan di bawah.
        </p>
      : <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-stone-100 text-left text-stone-700">
            <tr>
              <th className="px-2 py-2">No. nota</th><th className="px-2 py-2">Jenis</th><th className="px-2 py-2">Tanggal</th>
              <th className="px-2 py-2">Penerbit</th><th className="px-2 py-2">Dirujuk</th><th className="px-2 py-2">Berkas</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((receipt) => <tr key={receipt.id} className="border-t border-stone-100">
              <td className="px-2 py-1.5 font-mono">{receipt.reference}</td>
              <td className="px-2 py-1.5">{RECEIPT_KIND_LABELS[receipt.kind]}</td>
              <td className="px-2 py-1.5">{displayDate(receipt.issuedOn)}</td>
              <td className="px-2 py-1.5">{receipt.issuer ?? "—"}</td>
              <td className="px-2 py-1.5">{citedBy(receipt.id)} baris</td>
              <td className="px-2 py-1.5">
                <button type="button" className="inline-flex items-center gap-1 font-semibold text-emerald-800 underline" onClick={() => onOpenFiles(receipt)}>
                  <Paperclip className="h-3.5 w-3.5" /> {receipt.files.length} berkas
                </button>
                {receipt.files.length === 0 && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">belum ada foto</span>}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>}

    <form className="grid grid-cols-1 gap-2 rounded-lg bg-stone-50 p-3 sm:grid-cols-4" onSubmit={(e) => {
      e.preventDefault();
      void operation.submit((operationId) => ({ operationId, kind: form.kind, reference: form.reference.trim(), issuedOn: form.issuedOn,
        issuer: form.issuer.trim() || null }));
    }}>
      <p className="text-xs font-semibold text-stone-800 sm:col-span-4">Tambah nota atau surat pernyataan</p>
      <label className={labelClass} htmlFor={`${id}-kind`}>Jenis bukti
        <select id={`${id}-kind`} value={form.kind} disabled={operation.locked} className={inputClass}
          onChange={(e) => setForm({ ...form, kind: e.target.value as ReceiptKind })}>
          <option value="NOTA">{RECEIPT_KIND_LABELS.NOTA}</option>
          <option value="SURAT_PERNYATAAN">{RECEIPT_KIND_LABELS.SURAT_PERNYATAAN} (nota hilang)</option>
        </select></label>
      <label className={labelClass} htmlFor={`${id}-ref`}>{form.kind === "NOTA" ? "No. nota/kuitansi" : "Nomor/keterangan surat"}
        <input id={`${id}-ref`} value={form.reference} disabled={operation.locked} className={inputClass}
          placeholder={form.kind === "NOTA" ? "mis. KW-012" : "mis. SP-01 struk bensin hilang"} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></label>
      <label className={labelClass} htmlFor={`${id}-date`}>Tanggal
        <input id={`${id}-date`} type="date" value={form.issuedOn} disabled={operation.locked} className={inputClass}
          onChange={(e) => setForm({ ...form, issuedOn: e.target.value })} /></label>
      <label className={labelClass} htmlFor={`${id}-issuer`}>Penerbit (opsional)
        <input id={`${id}-issuer`} value={form.issuer} disabled={operation.locked} className={inputClass} placeholder="mis. Rental Pak Udin"
          onChange={(e) => setForm({ ...form, issuer: e.target.value })} /></label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-4">
        <Button type="submit" size="sm" disabled={operation.locked || !form.reference.trim() || !form.issuedOn}>Tambah</Button>
        {operation.state !== "IDLE" && <MutationFeedback operation={operation} />}
      </div>
    </form>
  </div>;
}

/** Many photos at once, each placed on the nota whose number its file name carries. */
function BulkUpload({ requests, proposalId, receipts }: { requests: PrivateRequests; proposalId: string; receipts: Receipt[] }) {
  const id = useId();
  const refresh = useRefresh(requests);
  const [chosen, setChosen] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ file: File; reason: string }[]>([]);
  const matches = matchReceiptFiles(chosen.map((f) => f.name), receipts);
  const matched = chosen.flatMap((file, i) => (matches[i].receiptId ? [{ file, receiptId: matches[i].receiptId! }] : []));
  const unmatched = chosen.filter((_, i) => !matches[i].receiptId);
  const refOf = (receiptId: string) => receipts.find((r) => r.id === receiptId)?.reference ?? receiptId;

  async function upload() {
    setBusy(true);
    const result = await uploadAll(requests, proposalId, matched);
    setBusy(false);
    setFailed(result);
    setChosen(result.map((f) => f.file));
    refresh();
  }

  return <section className="space-y-2 rounded-lg border border-stone-200 bg-white p-3" aria-labelledby={`${id}-title`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h5 id={`${id}-title`} className="text-xs font-semibold text-stone-900">Unggah massal foto nota</h5>
        <p className="text-[11px] text-stone-600">Beri nama berkas sesuai nomor nota, mis. <span className="font-mono">KW-012.jpg</span> atau <span className="font-mono">KW-012 belakang.jpg</span>.</p>
      </div>
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-stone-50">
        <FileUp className="h-3.5 w-3.5" /> Pilih berkas
        <input type="file" multiple accept={ACCEPT} className="sr-only" disabled={busy}
          onChange={(e) => { setChosen([...(e.target.files ?? [])]); setFailed([]); e.target.value = ""; }} />
      </label>
    </div>
    {chosen.length > 0 && <>
      <ul className="max-h-48 space-y-0.5 overflow-y-auto text-xs" aria-label="Pencocokan berkas dengan nota">
        {chosen.map((file, i) => <li key={`${file.name}-${i}`} className="flex flex-wrap gap-2">
          <span className="font-mono">{file.name}</span>
          {matches[i].receiptId
            ? <span className="text-emerald-800">→ nota {refOf(matches[i].receiptId!)}</span>
            : <span className="text-amber-800">tidak cocok dengan nomor nota mana pun</span>}
          {failed.find((f) => f.file === file) && <span className="text-red-700">· {failed.find((f) => f.file === file)!.reason}</span>}
        </li>)}
      </ul>
      {unmatched.length > 0 && <p className="text-[11px] text-amber-800">{unmatched.length} berkas tidak diunggah. Ubah namanya, atau tambahkan notanya dulu.</p>}
      <Button type="button" size="sm" disabled={busy || matched.length === 0} onClick={() => void upload()}>
        <Upload className="mr-1.5 h-3.5 w-3.5" /> {busy ? "Mengunggah…" : `Unggah ${matched.length} berkas`}
      </Button>
    </>}
  </section>;
}

/** The files of one nota: view, add, and delete a mistaken upload while the nota is not yet evidence. */
export function ReceiptFilesDialog({ requests, proposalId, receipt, onClose }: {
  requests: PrivateRequests; proposalId: string; receipt: Receipt; onClose: () => void;
}) {
  const refresh = useRefresh(requests);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ file: ReceiptFile; url: string } | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const locked = receipt.evidencedAt !== null;

  async function view(file: ReceiptFile) {
    setMessage(null);
    try {
      const blob = await downloadReceiptFile(requests, proposalId, receipt.id, file.id);
      setPreview({ file, url: URL.createObjectURL(new Blob([blob], { type: file.mimeType })) });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Berkas tidak dapat dibuka atau tidak cocok dengan sidik SHA-256-nya.");
    }
  }

  async function add(files: File[]) {
    setBusy(true);
    setMessage(null);
    const failed = await uploadAll(requests, proposalId, files.map((file) => ({ file, receiptId: receipt.id })));
    setBusy(false);
    if (failed.length > 0) setMessage(failed.map((f) => `${f.file.name}: ${f.reason}`).join("; "));
    refresh();
  }

  async function remove(file: ReceiptFile) {
    setBusy(true);
    setMessage(null);
    try {
      await deleteReceiptFile(requests, proposalId, receipt.id, file.id);
      if (preview?.file.id === file.id) setPreview(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Berkas tidak dapat dihapus.");
    }
    setBusy(false);
    refresh();
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" showCloseButton={!busy}>
      <DialogTitle>{RECEIPT_KIND_LABELS[receipt.kind]} {receipt.reference}</DialogTitle>
      <DialogDescription>
        {displayDate(receipt.issuedOn)}{receipt.issuer ? ` · ${receipt.issuer}` : ""}. Dokumen terbatas: hanya anggota ruang kerja lembaga
        yang dapat membukanya. Setiap berkas diperiksa terhadap sidik SHA-256-nya saat dibuka.
      </DialogDescription>
      {locked && <p className="flex items-start gap-1.5 rounded-lg bg-stone-100 p-2 text-xs text-stone-700">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Nota ini sudah menjadi bukti baris biaya tercatat. Berkasnya tidak dapat dihapus;
        tambahkan berkas baru atau koreksi barisnya.
      </p>}
      {receipt.files.length === 0
        ? <p className="text-xs text-stone-600">Belum ada foto atau PDF.</p>
        : <ul className="space-y-1 text-xs">
          {receipt.files.map((file) => <li key={file.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 p-2">
            <span className="font-semibold">{file.fileName}</span>
            <span className="text-stone-500">{sizeText(file.sizeBytes)} · SHA-256 <span className="font-mono">{file.contentSha256.slice(2, 14)}…</span></span>
            <span className="ml-auto flex gap-2">
              <button type="button" className="inline-flex items-center gap-1 font-semibold text-emerald-800 underline" onClick={() => void view(file)}>
                <Eye className="h-3.5 w-3.5" /> Lihat
              </button>
              {!locked && <button type="button" disabled={busy} className="inline-flex items-center gap-1 font-semibold text-red-700 underline"
                onClick={() => void remove(file)}>
                <Trash2 className="h-3.5 w-3.5" /> Hapus
              </button>}
            </span>
          </li>)}
        </ul>}
      {preview && <div className="space-y-1 rounded-lg border border-stone-200 p-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold">{preview.file.fileName}</span>
          <a href={preview.url} download={preview.file.fileName} className="font-semibold text-emerald-800 underline">Unduh</a>
        </div>
        {preview.file.mimeType === "application/pdf"
          ? <iframe title={preview.file.fileName} src={preview.url} className="h-[60vh] w-full rounded" />
          : <img src={preview.url} alt={`Foto ${preview.file.fileName}`} className="max-h-[60vh] w-full rounded object-contain" />}
      </div>}
      {message && <p role="alert" className="rounded-md bg-red-50 p-2 text-xs text-red-700">{message}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-stone-50 ${busy ? "opacity-50" : ""}`}>
          <FileUp className="h-3.5 w-3.5" /> {busy ? "Memproses…" : "Tambah foto/PDF"}
          <input type="file" multiple accept={ACCEPT} className="sr-only" disabled={busy}
            onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ""; if (files.length) void add(files); }} />
        </label>
        <Button type="button" size="sm" disabled={busy} onClick={onClose}>Tutup</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

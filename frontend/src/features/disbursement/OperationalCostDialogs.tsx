import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/Dialog";
import type { PrivateRequests } from "../workspace/privateRequests";
import { formatIdrAmount } from "../workspace/mandateLabels";
import { MutationFeedback, useRealizationMutation } from "./useRealizationMutation";
import {
  correctCostItem,
  getCostItemHistory,
  reimburseTalangan,
  returnPanjar,
  voidCostItem,
  type CostItem,
  type CostItemInput,
  type Panjar,
} from "./operationalCostClient";
import {
  costInputOf,
  costRowIssues,
  displayDate,
  fieldsOfItem,
  fundingLabel,
  fundingOptions,
  normalizeDate,
  receiptByRef,
  withAutoTotal,
  type CostContext,
  type CostField,
  type CostFields,
} from "./operationalCostRows";
import { normalizeQuantity, normalizeRupiah } from "./spreadsheet";

const inputClass = "mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm font-normal";
const labelClass = "block text-xs font-semibold text-stone-700";
const MIN_REASON = 5;
const today = () => new Date().toISOString().slice(0, 10);

/** The cost fields as a form, for a correction and for a draft row on a phone. */
export function CostFieldsForm({ fields, onChange, ctx, purposes, receiptChoice, disabled, showIssues }: {
  fields: CostFields;
  onChange: (fields: CostFields) => void;
  ctx: CostContext;
  purposes: readonly string[];
  /** Pick a recorded nota from a list (a correction), or type its number (a draft). */
  receiptChoice: "select" | "type";
  disabled?: boolean;
  showIssues?: boolean;
}) {
  const id = useId();
  const issues = showIssues ? costRowIssues(fields, ctx) : {};
  const set = (field: CostField, text: string, auto = false) => {
    const next = { ...fields, [field]: text };
    onChange(auto ? withAutoTotal(next) : next);
  };
  const options = fundingOptions(ctx);
  const field = (name: CostField, label: string, input: React.ReactNode, wide = false) => (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label className={labelClass} htmlFor={`${id}-${name}`}>{label}</label>
      {input}
      {issues[name] && <p className="mt-0.5 text-[11px] text-red-700">{issues[name]}</p>}
    </div>
  );
  const text = (name: CostField, extra: React.InputHTMLAttributes<HTMLInputElement> = {}, normalize?: (t: string) => string, auto = false) => (
    <input id={`${id}-${name}`} value={fields[name]} disabled={disabled} className={inputClass} aria-invalid={issues[name] ? true : undefined}
      onChange={(e) => set(name, e.target.value, auto)}
      onBlur={normalize ? (e) => set(name, normalize(e.target.value), auto) : undefined} {...extra} />
  );
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {field("spentOn", "Tanggal", <input id={`${id}-spentOn`} type="date" value={fields.spentOn} disabled={disabled} className={inputClass}
        onChange={(e) => set("spentOn", normalizeDate(e.target.value))} />)}
      {field("purpose", "Keperluan", <>
        {text("purpose", { list: `${id}-purposes`, placeholder: "mis. Bensin" })}
        <datalist id={`${id}-purposes`}>{purposes.map((p) => <option key={p} value={p} />)}</datalist>
      </>)}
      <div className="grid grid-cols-3 gap-2 sm:col-span-2">
        {field("quantity", "Jml (opsional)", text("quantity", { inputMode: "decimal" }, normalizeQuantity, true))}
        {field("unit", "Satuan", text("unit", { placeholder: "liter" }))}
        {field("unitPriceIdr", "Harga (Rp)", text("unitPriceIdr", { inputMode: "numeric" }, normalizeRupiah, true))}
      </div>
      {field("amountIdr", "Total (Rp)", text("amountIdr", { inputMode: "numeric" }, normalizeRupiah))}
      {field("payee", "Dibayarkan kepada", text("payee", { placeholder: "Toko, rental, atau pihak yang dibayar" }))}
      {field("receiptRef", "No. nota/kuitansi", receiptChoice === "select"
        ? <select id={`${id}-receiptRef`} value={fields.receiptRef} disabled={disabled} className={inputClass}
            onChange={(e) => set("receiptRef", e.target.value)}>
            <option value="">Tanpa nota</option>
            {ctx.receipts.map((r) => <option key={r.id} value={r.reference}>{r.reference}{r.kind === "SURAT_PERNYATAAN" ? " (surat pernyataan)" : ""}</option>)}
          </select>
        : <>
            {text("receiptRef", { list: `${id}-receipts`, placeholder: "mis. KW-012" })}
            <datalist id={`${id}-receipts`}>{ctx.receipts.map((r) => <option key={r.id} value={r.reference} />)}</datalist>
          </>)}
      {field("funding", "Sumber dana", <select id={`${id}-funding`} value={fields.funding} disabled={disabled} className={inputClass}
        onChange={(e) => set("funding", e.target.value)}>
        <option value="">Pilih sumber dana…</option>
        {fields.funding && !options.includes(fields.funding) && <option value={fields.funding}>{fields.funding}</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>)}
    </div>
  );
}

type DialogBase = { requests: PrivateRequests; proposalId: string; onClose: () => void };

export function CorrectionDialog({ requests, proposalId, item, ctx, purposes, onClose }: DialogBase & {
  item: CostItem; ctx: CostContext; purposes: readonly string[];
}) {
  const id = useId();
  const [fields, setFields] = useState(() => fieldsOfItem(item, ctx));
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const operation = useRealizationMutation(requests,
    (p: { operationId: string; item: CostItemInput; reason: string }) =>
      correctCostItem(requests, proposalId, item.id, { operationId: p.operationId, expectedVersion: item.version, reason: p.reason, item: p.item }),
    () => onClose());
  const issues = costRowIssues(fields, ctx);
  const valid = Object.keys(issues).length === 0 && reason.trim().length >= MIN_REASON;
  const submit = () => {
    setTried(true);
    if (!valid) return;
    const input = costInputOf(fields, ctx, receiptByRef(fields.receiptRef, ctx.receipts)?.id ?? null);
    void operation.submit((operationId) => ({ operationId, item: input, reason: reason.trim() }));
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !operation.locked) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" showCloseButton={!operation.locked}>
      <DialogTitle>Koreksi baris biaya</DialogTitle>
      <DialogDescription>
        Isian lama tetap tersimpan sebagai riwayat. Baris akan menampilkan nilai baru dengan tanda "dikoreksi".
      </DialogDescription>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <CostFieldsForm fields={fields} onChange={setFields} ctx={ctx} purposes={purposes} receiptChoice="select"
          disabled={operation.locked} showIssues={tried} />
        <div>
          <label className={labelClass} htmlFor={`${id}-reason`}>Alasan koreksi (wajib, minimal {MIN_REASON} karakter)</label>
          <textarea id={`${id}-reason`} value={reason} disabled={operation.locked} rows={2} className={inputClass}
            placeholder="mis. Salah ketik, struk tertulis Rp110.000" onChange={(e) => setReason(e.target.value)} />
          {tried && reason.trim().length < MIN_REASON && <p className="mt-0.5 text-[11px] text-red-700">Tulis alasan koreksi.</p>}
        </div>
        <MutationFeedback operation={operation} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={operation.locked} onClick={onClose}>Batal</Button>
          <Button type="submit" size="sm" disabled={operation.locked}>Simpan koreksi</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

export function VoidDialog({ requests, proposalId, item, ctx, onClose }: DialogBase & { item: CostItem; ctx: CostContext }) {
  const id = useId();
  const [reason, setReason] = useState("");
  const operation = useRealizationMutation(requests,
    (p: { operationId: string; reason: string }) =>
      voidCostItem(requests, proposalId, item.id, { operationId: p.operationId, expectedVersion: item.version, reason: p.reason }),
    () => onClose());
  return <Dialog open onOpenChange={(open) => { if (!open && !operation.locked) onClose(); }}>
    <DialogContent className="max-w-lg" showCloseButton={!operation.locked}>
      <DialogTitle>Batalkan baris biaya?</DialogTitle>
      <DialogDescription>
        {item.purpose} · {formatIdrAmount(item.amountIdr)} · {fundingLabel(item.fundingSource, ctx)}. Baris tidak dihapus:
        tetap tampil tercoret dengan alasannya, tetapi tidak lagi dihitung.
      </DialogDescription>
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim().length >= MIN_REASON) void operation.submit((operationId) => ({ operationId, reason: reason.trim() }));
      }}>
        <label className={labelClass} htmlFor={`${id}-reason`}>Alasan pembatalan (wajib, minimal {MIN_REASON} karakter)
          <textarea id={`${id}-reason`} value={reason} disabled={operation.locked} rows={2} className={inputClass}
            placeholder="mis. Input dobel dari nota yang sama" onChange={(e) => setReason(e.target.value)} />
        </label>
        <MutationFeedback operation={operation} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={operation.locked} onClick={onClose}>Kembali</Button>
          <Button type="submit" size="sm" className="bg-red-700 text-white hover:bg-red-800"
            disabled={operation.locked || reason.trim().length < MIN_REASON}>Batalkan baris</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

const CHANGE_LABELS = { RECORD: "Dicatat", CORRECT: "Dikoreksi", VOID: "Dibatalkan" } as const;

export function HistoryDialog({ requests, proposalId, item, ctx, onClose, onCorrect, onVoid }: DialogBase & {
  item: CostItem; ctx: CostContext; onCorrect?: () => void; onVoid?: () => void;
}) {
  const history = useQuery({
    queryKey: ["operational-cost-history", requests.contextId, proposalId, item.id, item.version],
    queryFn: () => getCostItemHistory(requests, proposalId, item.id),
  });
  const officer = (officerId: string) => ctx.officers.find((o) => o.id === officerId)?.displayName ?? officerId;
  const receiptRef = (receiptId: string | null) => (receiptId ? ctx.receipts.find((r) => r.id === receiptId)?.reference ?? "?" : "—");
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
      <DialogTitle>Riwayat baris biaya</DialogTitle>
      <DialogDescription>Setiap versi tetap tersimpan, termasuk pengoreksi, waktu, dan alasannya.</DialogDescription>
      {history.error && <p role="alert" className="rounded-md bg-red-50 p-2 text-xs text-red-700">{history.error.message}</p>}
      {!history.data ? <p className="text-xs text-stone-500">Memuat riwayat…</p> : <ol className="space-y-2 text-xs">
        {history.data.map((version) => <li key={version.version} className="rounded-lg border border-stone-200 p-2">
          <p className="font-semibold text-stone-900">
            Versi {version.version} · {CHANGE_LABELS[version.change]} oleh {officer(version.actorOfficerId)} ·{" "}
            {new Date(version.at * 1000).toLocaleString("id-ID")}
          </p>
          {version.reason && <p className="text-stone-700">Alasan: {version.reason}</p>}
          <p className={`mt-1 text-stone-600 ${version.item.status === "VOIDED" ? "line-through" : ""}`}>
            {displayDate(version.item.spentOn)} · {version.item.purpose}
            {version.item.quantity ? ` · ${version.item.quantity} ${version.item.unit ?? ""} × ${formatIdrAmount(version.item.unitPriceIdr)}` : ""}
            {" · "}{formatIdrAmount(version.item.amountIdr)} · dibayarkan kepada {version.item.payee} · nota {receiptRef(version.item.receiptId)}
            {" · "}{fundingLabel(version.item.fundingSource, ctx)}
          </p>
        </li>)}
      </ol>}
      <div className="flex flex-wrap justify-end gap-2">
        {onVoid && <Button type="button" variant="outline" size="sm" className="text-red-700" onClick={onVoid}>Batalkan baris</Button>}
        {onCorrect && <Button type="button" variant="outline" size="sm" onClick={onCorrect}>Koreksi</Button>}
        <Button type="button" size="sm" onClick={onClose}>Tutup</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

export function ReimburseDialog({ requests, proposalId, officerId, ctx, items, onClose }: DialogBase & {
  officerId: string; ctx: CostContext; items: CostItem[];
}) {
  const id = useId();
  const outstanding = items.filter((i) => i.status === "ACTIVE" && i.fundingSource.kind === "TALANGAN"
    && i.fundingSource.holderOfficerId === officerId && !i.reimbursementId);
  const [chosen, setChosen] = useState(() => new Set(outstanding.map((i) => i.id)));
  const [paidOn, setPaidOn] = useState(today);
  const [reference, setReference] = useState("");
  const total = outstanding.filter((i) => chosen.has(i.id)).reduce((sum, i) => sum + BigInt(i.amountIdr), 0n);
  const operation = useRealizationMutation(requests,
    (p: { operationId: string; holderOfficerId: string; itemIds: string[]; paidOn: string; reference: string }) =>
      reimburseTalangan(requests, proposalId, p),
    () => onClose());
  const name = ctx.officers.find((o) => o.id === officerId)?.displayName ?? officerId;
  return <Dialog open onOpenChange={(open) => { if (!open && !operation.locked) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" showCloseButton={!operation.locked}>
      <DialogTitle>Tandai talangan {name} sudah diganti</DialogTitle>
      <DialogDescription>Baris yang sudah diganti tidak dapat dikoreksi atau dibatalkan lagi.</DialogDescription>
      <form className="space-y-3 text-sm" onSubmit={(e) => {
        e.preventDefault();
        void operation.submit((operationId) => ({ operationId, holderOfficerId: officerId, itemIds: [...chosen], paidOn, reference: reference.trim() }));
      }}>
        <fieldset className="space-y-1" disabled={operation.locked}>
          <legend className={labelClass}>Baris talangan yang diganti</legend>
          {outstanding.map((item) => <label key={item.id} className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={chosen.has(item.id)} onChange={(e) => {
              const next = new Set(chosen);
              if (e.target.checked) next.add(item.id); else next.delete(item.id);
              setChosen(next);
            }} />
            {displayDate(item.spentOn)} · {item.purpose} · {formatIdrAmount(item.amountIdr)}
          </label>)}
        </fieldset>
        <p className="text-xs font-semibold">Total diganti: {formatIdrAmount(total.toString())}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className={labelClass} htmlFor={`${id}-paid`}>Tanggal diganti
            <input id={`${id}-paid`} type="date" value={paidOn} disabled={operation.locked} className={inputClass} onChange={(e) => setPaidOn(e.target.value)} /></label>
          <label className={labelClass} htmlFor={`${id}-ref`}>Rujukan pembayaran
            <input id={`${id}-ref`} value={reference} disabled={operation.locked} className={inputClass} placeholder="mis. Transfer BSI 8812"
              onChange={(e) => setReference(e.target.value)} /></label>
        </div>
        <MutationFeedback operation={operation} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={operation.locked} onClick={onClose}>Batal</Button>
          <Button type="submit" size="sm" disabled={operation.locked || chosen.size === 0 || !paidOn || !reference.trim()}>Tandai sudah diganti</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

export function PanjarReturnDialog({ requests, proposalId, panjar, remainingIdr, ctx, onClose }: DialogBase & {
  panjar: Panjar; remainingIdr: string; ctx: CostContext;
}) {
  const id = useId();
  const [amountIdr, setAmount] = useState(remainingIdr);
  const [returnedOn, setReturnedOn] = useState(today);
  const [reference, setReference] = useState("");
  const operation = useRealizationMutation(requests,
    (p: { operationId: string; amountIdr: string; returnedOn: string; reference: string }) => returnPanjar(requests, proposalId, panjar.id, p),
    () => onClose());
  const name = ctx.officers.find((o) => o.id === panjar.holderOfficerId)?.displayName ?? panjar.holderOfficerId;
  const over = /^\d+$/.test(amountIdr) && BigInt(amountIdr) > BigInt(remainingIdr);
  return <Dialog open onOpenChange={(open) => { if (!open && !operation.locked) onClose(); }}>
    <DialogContent className="max-w-lg" showCloseButton={!operation.locked}>
      <DialogTitle>Catat pengembalian sisa panjar</DialogTitle>
      <DialogDescription>
        Panjar {name} · {panjar.cashOutRef} · sisa {formatIdrAmount(remainingIdr)}.
      </DialogDescription>
      <form className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3" onSubmit={(e) => {
        e.preventDefault();
        void operation.submit((operationId) => ({ operationId, amountIdr, returnedOn, reference: reference.trim() }));
      }}>
        <label className={labelClass} htmlFor={`${id}-amount`}>Nominal (Rp)
          <input id={`${id}-amount`} inputMode="numeric" value={amountIdr} disabled={operation.locked} className={inputClass}
            onChange={(e) => setAmount(normalizeRupiah(e.target.value))} /></label>
        <label className={labelClass} htmlFor={`${id}-date`}>Tanggal
          <input id={`${id}-date`} type="date" value={returnedOn} disabled={operation.locked} className={inputClass}
            onChange={(e) => setReturnedOn(e.target.value)} /></label>
        <label className={labelClass} htmlFor={`${id}-ref`}>Rujukan
          <input id={`${id}-ref`} value={reference} disabled={operation.locked} className={inputClass} placeholder="mis. Setor kas 30/09"
            onChange={(e) => setReference(e.target.value)} /></label>
        {over && <p className="text-xs text-red-700 sm:col-span-3">Pengembalian melebihi sisa panjar.</p>}
        <div className="sm:col-span-3"><MutationFeedback operation={operation} /></div>
        <div className="flex justify-end gap-2 sm:col-span-3">
          <Button type="button" variant="outline" size="sm" disabled={operation.locked} onClick={onClose}>Batal</Button>
          <Button type="submit" size="sm" disabled={operation.locked || over || !/^\d+$/.test(amountIdr) || amountIdr === "0" || !reference.trim()}>
            Catat pengembalian
          </Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

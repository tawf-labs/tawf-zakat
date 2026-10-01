import { useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Ban, Edit3, History, Paperclip, Plus, Save, Search } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/Tabs";
import type { PrivateRequests } from "../workspace/privateRequests";
import { formatIdrAmount } from "../workspace/mandateLabels";
import { SpreadsheetGrid, type RowFlag } from "./SpreadsheetGrid";
import { MutationFeedback, useRealizationMutation } from "./useRealizationMutation";
import { useRealizationAccounts } from "./useRealizationQueries";
import { useOperationalCosts } from "./useOperationalCosts";
import {
  createReceipt,
  issuePanjar,
  recordCostItems,
  type CostItem,
  type CostItemInput,
  type CostRecordingResult,
  type OperationalCosts,
  type Receipt,
} from "./operationalCostClient";
import {
  costColumns,
  costInputOf,
  costRowIssues,
  displayDate,
  fieldsOfItem,
  FIELD_OF_SERVER_ISSUE,
  fundingLabel,
  newCostDraft,
  receiptByRef,
  type CostContext,
  type CostFields,
  type CostRow,
} from "./operationalCostRows";
import { CorrectionDialog, CostFieldsForm, HistoryDialog, PanjarReturnDialog, ReimburseDialog, VoidDialog } from "./OperationalCostDialogs";
import { ReceiptFilesDialog, ReceiptsSheet } from "./OperationalCostReceipts";

type Sheet = "costs" | "panjar" | "receipts";
type Open =
  | { kind: "correct" | "void" | "history"; itemId: string }
  | { kind: "files"; receiptId: string }
  | { kind: "reimburse"; officerId: string }
  | { kind: "return"; panjarId: string }
  | null;

/** Proposal states in which costs are recorded (mirrors the backend). */
export const COST_STATUSES = ["APPROVED", "REMAINDER_CLOSED", "CANCELLED"] as const;

const HISTORY_LIMIT = 100;
const rowKey = (row: CostRow) => row.key;

type DraftIssue = { fields: CostFields; messages: string[] };

/**
 * Draft rows typed or pasted but not yet recorded, with undo/redo as whole steps and the
 * server's refusals per row. Owned above the roster tabs, so switching tabs or going
 * fullscreen never drops a row nobody has recorded yet.
 */
export function useCostDrafts() {
  const [drafts, setDrafts] = useState<CostRow[]>(() => [newCostDraft()]);
  const [issues, setIssues] = useState<Map<string, DraftIssue>>(new Map());
  const past = useRef<CostRow[][]>([]);
  const future = useRef<CostRow[][]>([]);
  return {
    drafts,
    issues,
    setIssues,
    commit(next: CostRow[]) {
      past.current = [...past.current.slice(-(HISTORY_LIMIT - 1)), drafts];
      future.current = [];
      setDrafts(next);
    },
    undo() {
      const previous = past.current.pop();
      if (!previous) return;
      future.current.push(drafts);
      setDrafts(previous);
    },
    redo() {
      const next = future.current.pop();
      if (!next) return;
      past.current.push(drafts);
      setDrafts(next);
    },
  };
}

const isBlank = (fields: CostFields) => Object.values(fields).every((value) => value.trim() === "");

/**
 * Tab Biaya Operasional (ADR-0042): one row per cost item on an Excel-like grid. Draft rows
 * are typed or pasted, then recorded together; recorded rows lock and change only by a
 * correction with a reason. Costs never count as aid realized.
 */
export type CostDrafts = ReturnType<typeof useCostDrafts>;

export function OperationalCostsTab({ requests, proposalId, expanded, drafts }: {
  requests: PrivateRequests; proposalId: string; expanded: boolean; drafts: CostDrafts;
}) {
  const { overview, ctx, purposes, error, fresh } = useOperationalCosts(requests, proposalId);
  const [sheet, setSheet] = useState<Sheet>("costs");
  const [open, setOpen] = useState<Open>(null);
  const legacy = useRealizationAccounts(requests, proposalId, true);

  if (!overview || !ctx) {
    return error
      ? <p role="alert" className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error.message}</p>
      : <p className="text-xs text-stone-500">Memuat biaya operasional…</p>;
  }
  const item = (itemId: string) => overview.items.find((i) => i.id === itemId);
  const changeable = (i: CostItem) => i.status === "ACTIVE" && !i.reimbursementId;
  const close = () => setOpen(null);
  const dialogBase = { requests, proposalId, onClose: close };

  return <div className={expanded ? "flex min-h-0 flex-1 flex-col gap-3" : "space-y-3"}>
    <p className="text-xs text-stone-600">
      Biaya kegiatan dicatat per item beserta sumber dananya. Biaya operasional tidak pernah dihitung sebagai realisasi bantuan.
    </p>
    <HolderSummary overview={overview} onReimburse={(officerId) => setOpen({ kind: "reimburse", officerId })}
      onReturn={(panjarId) => setOpen({ kind: "return", panjarId })} />

    <Tabs value={sheet} onValueChange={(value) => setSheet(value as Sheet)} className={expanded ? "flex min-h-0 flex-1 flex-col gap-2" : "space-y-2"}>
      <TabsList>
        <TabsTrigger value="costs">Biaya ({overview.items.filter((i) => i.status === "ACTIVE").length})</TabsTrigger>
        <TabsTrigger value="panjar">Panjar ({overview.panjar.length})</TabsTrigger>
        <TabsTrigger value="receipts">Nota ({overview.receipts.length})</TabsTrigger>
      </TabsList>
      {/* The cost sheet stays mounted so unrecorded drafts survive a look at another sheet. */}
      <TabsContent value="costs" forceMount hidden={sheet !== "costs"} className={expanded ? "mt-0 flex min-h-0 flex-1 flex-col" : "mt-0"}>
        <CostSheet requests={requests} proposalId={proposalId} overview={overview} ctx={ctx} purposes={purposes} expanded={expanded}
          fresh={fresh} onOpen={setOpen} store={drafts} />
      </TabsContent>
      <TabsContent value="panjar" className="mt-0">
        <PanjarSheet requests={requests} proposalId={proposalId} overview={overview} ctx={ctx}
          onReturn={(panjarId) => setOpen({ kind: "return", panjarId })} />
      </TabsContent>
      <TabsContent value="receipts" className="mt-0">
        <ReceiptsSheet requests={requests} proposalId={proposalId} receipts={overview.receipts} items={overview.items}
          onOpenFiles={(receipt) => setOpen({ kind: "files", receiptId: receipt.id })} />
      </TabsContent>
    </Tabs>

    {(legacy.advances.length > 0 || legacy.expenses.length > 0) && <details className="rounded-lg border border-stone-200 bg-white p-3 text-xs">
      <summary className="cursor-pointer font-semibold text-stone-800">
        Catatan uang muka & biaya lama ({legacy.advances.length + legacy.expenses.length}) · hanya-baca
      </summary>
      <p className="mt-1 text-stone-600">Dicatat sebelum biaya per item; akan dipindahkan ke lembar ini saat migrasi data.</p>
      <ul className="mt-2 space-y-1">
        {legacy.advances.map((a) => <li key={a.id}>Uang muka · {a.purpose} · {formatIdrAmount(a.amountIdr)} · ref {a.reference}</li>)}
        {legacy.expenses.map((e) => <li key={e.id}>Biaya · {e.purpose} · {formatIdrAmount(e.amountIdr)} · dibayarkan kepada {e.payee} · nota {e.documentRef}</li>)}
      </ul>
    </details>}

    {open?.kind === "correct" && item(open.itemId) && <CorrectionDialog {...dialogBase} item={item(open.itemId)!} ctx={ctx} purposes={purposes} />}
    {open?.kind === "void" && item(open.itemId) && <VoidDialog {...dialogBase} item={item(open.itemId)!} ctx={ctx} />}
    {open?.kind === "history" && item(open.itemId) && <HistoryDialog {...dialogBase} item={item(open.itemId)!} ctx={ctx}
      onCorrect={changeable(item(open.itemId)!) ? () => setOpen({ kind: "correct", itemId: open.itemId }) : undefined}
      onVoid={changeable(item(open.itemId)!) ? () => setOpen({ kind: "void", itemId: open.itemId }) : undefined} />}
    {open?.kind === "files" && overview.receipts.some((r) => r.id === open.receiptId) && <ReceiptFilesDialog {...dialogBase}
      receipt={overview.receipts.find((r) => r.id === open.receiptId)!} />}
    {open?.kind === "reimburse" && <ReimburseDialog {...dialogBase} officerId={open.officerId} ctx={ctx} items={overview.items} />}
    {open?.kind === "return" && overview.panjar.some((p) => p.id === open.panjarId) && <PanjarReturnDialog {...dialogBase}
      panjar={overview.panjar.find((p) => p.id === open.panjarId)!} ctx={ctx}
      remainingIdr={overview.holders.flatMap((h) => h.panjar).find((p) => p.panjarId === open.panjarId)?.remainingIdr ?? "0"} />}
  </div>;
}

/** "Ahmad · talangan Rp 450.000 belum diganti", "Siti · panjar Rp 300.000 · terpakai … · sisa …". */
function HolderSummary({ overview, onReimburse, onReturn }: {
  overview: OperationalCosts; onReimburse: (officerId: string) => void; onReturn: (panjarId: string) => void;
}) {
  const { totals, holders } = overview;
  return <section aria-label="Ringkasan per petugas" className="space-y-2">
    <p className="text-xs text-stone-700">
      Total biaya <strong>{formatIdrAmount(totals.totalItemsIdr)}</strong> · dibayar lembaga langsung atau lewat talangan{" "}
      {formatIdrAmount(totals.directExpensesIdr)} · dari panjar {formatIdrAmount(totals.panjarAccountedIdr)}
    </p>
    {holders.length > 0 && <ul className="flex flex-wrap gap-2">
      {holders.flatMap((holder) => [
        ...(holder.talanganOutstandingIdr !== "0" || holder.talanganReimbursedIdr !== "0" ? [
          <li key={`${holder.officerId}-talangan`} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-950">
            <span>
              <strong>{holder.name}</strong> · talangan{" "}
              {holder.talanganOutstandingIdr !== "0" ? `${formatIdrAmount(holder.talanganOutstandingIdr)} belum diganti` : "lunas"}
              {holder.talanganReimbursedIdr !== "0" && ` · ${formatIdrAmount(holder.talanganReimbursedIdr)} sudah diganti`}
            </span>
            {holder.talanganOutstandingIdr !== "0" && <button type="button" className="font-semibold underline" onClick={() => onReimburse(holder.officerId)}>
              Tandai sudah diganti
            </button>}
          </li>,
        ] : []),
        ...holder.panjar.map((p) => <li key={p.panjarId} className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs text-sky-950">
          <span>
            <strong>{holder.name}</strong> · panjar {formatIdrAmount(p.amountIdr)} ({p.cashOutRef}) · terpakai {formatIdrAmount(p.usedIdr)}
            {p.returnedIdr !== "0" && ` · dikembalikan ${formatIdrAmount(p.returnedIdr)}`} · sisa {formatIdrAmount(p.remainingIdr)}
          </span>
          {p.remainingIdr !== "0" && <button type="button" className="font-semibold underline" onClick={() => onReturn(p.panjarId)}>
            Catat pengembalian sisa
          </button>}
        </li>),
      ])}
    </ul>}
  </section>;
}

function CostSheet({ requests, proposalId, overview, ctx, purposes, expanded, fresh, onOpen, store }: {
  requests: PrivateRequests; proposalId: string; overview: OperationalCosts; ctx: CostContext; purposes: string[]; expanded: boolean;
  fresh: () => Promise<OperationalCosts>; onOpen: (open: Open) => void; store: CostDrafts;
}) {
  const { drafts, commit, undo, redo, issues: draftIssues, setIssues: setDraftIssues } = store;
  const [query, setQuery] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);

  const recorded: CostRow[] = useMemo(
    () => overview.items.map((item) => ({ key: item.id, fields: fieldsOfItem(item, ctx), item })),
    [overview.items, ctx],
  );
  const rows = useMemo(() => [...recorded, ...drafts], [recorded, drafts]);
  const columns = useMemo(() => costColumns(ctx, purposes), [ctx, purposes]);

  // A server refusal stays on its row only until that row is edited.
  const serverIssues = useMemo(() => {
    const byKey = new Map<string, string[]>();
    for (const row of drafts) {
      const issue = draftIssues.get(row.key);
      if (issue && issue.fields === row.fields) byKey.set(row.key, issue.messages);
    }
    return byKey;
  }, [drafts, draftIssues]);

  const flags = useMemo(() => {
    const byKey = new Map<string, RowFlag>();
    for (const item of overview.items) {
      if (item.status === "VOIDED") byKey.set(item.id, { badge: "batal", detail: "Baris dibatalkan; tidak dihitung. Buka riwayat untuk alasannya." });
      else if (item.version > 1) byKey.set(item.id, { badge: "dikoreksi", detail: "Baris dikoreksi; versi sebelumnya ada di riwayat." });
      else if (item.reimbursementId) byKey.set(item.id, { badge: "diganti", detail: "Talangan sudah diganti lembaga; baris tidak dapat dikoreksi." });
    }
    return byKey;
  }, [overview.items]);

  const filled = drafts.filter((row) => !isBlank(row.fields));
  const ready = filled.filter((row) => Object.keys(costRowIssues(row.fields, ctx)).length === 0);

  type Payload = { operationId: string; keys: string[]; fields: CostFields[]; items: CostItemInput[] };
  const operation = useRealizationMutation(requests,
    (p: Payload) => recordCostItems(requests, proposalId, { operationId: p.operationId, items: p.items }),
    (payload, results: CostRecordingResult[]) => {
      const recordedKeys = new Set<string>();
      const issues = new Map(draftIssues);
      for (const result of results) {
        const key = payload.keys[result.index];
        if ("item" in result) { recordedKeys.add(key); issues.delete(key); continue; }
        issues.set(key, { fields: payload.fields[result.index], messages: result.issues.map((i) => {
          const field = FIELD_OF_SERVER_ISSUE[i.field];
          const header = columns.find((c) => c.id === field)?.header;
          return header ? `${header}: ${i.message}` : i.message;
        }) });
      }
      setDraftIssues(issues);
      const remaining = drafts.filter((row) => !recordedKeys.has(row.key));
      commit(remaining.length > 0 ? remaining : [newCostDraft()]);
      const failed = results.length - recordedKeys.size;
      if (recordedKeys.size > 0) toast.success(`${recordedKeys.size} baris biaya tercatat.`);
      if (failed > 0) toast.warning(`${failed} baris belum tercatat dan tetap sebagai draf; lihat tandanya.`);
    });
  const locked = preparing || operation.locked;

  /** Creates the notas the rows name but that do not exist yet, then records the rows in one batch. */
  async function record() {
    if (ready.length === 0) return;
    setPreparing(true);
    setPrepareError(null);
    try {
      const latest = await fresh();
      const receipts: Receipt[] = [...latest.receipts];
      for (const row of ready) {
        const ref = row.fields.receiptRef.trim();
        if (!ref || receiptByRef(ref, receipts)) continue;
        receipts.push(await createReceipt(requests, proposalId, {
          operationId: crypto.randomUUID(), kind: "NOTA", reference: ref, issuedOn: row.fields.spentOn, issuer: row.fields.payee.trim() || null,
        }));
      }
      const current = { ...ctx, panjar: latest.panjar, receipts };
      const batch = ready.map((row) => ({ row, input: costInputOf(row.fields, current, receiptByRef(row.fields.receiptRef, receipts)?.id ?? null) }));
      setPreparing(false);
      await operation.submit((operationId) => ({
        operationId, keys: batch.map((b) => b.row.key), fields: batch.map((b) => b.row.fields), items: batch.map((b) => b.input),
      }));
    } catch (failure) {
      setPreparing(false);
      setPrepareError(failure instanceof Error ? `Nota belum dapat dibuat: ${failure.message}` : "Nota belum dapat dibuat.");
    }
  }

  const active = rows.find((row) => row.key === activeId) ?? null;
  const activeItem = active?.item ?? null;
  const activeReceipt = active ? receiptByRef(active.fields.receiptRef, overview.receipts) : null;
  const changeable = activeItem && activeItem.status === "ACTIVE" && !activeItem.reimbursementId;

  const rowActions = <>
    {activeReceipt && <Button type="button" variant="outline" size="sm" className="text-xs"
      onClick={() => onOpen({ kind: "files", receiptId: activeReceipt.id })}>
      <Paperclip className="mr-1.5 h-3.5 w-3.5" /> Lampiran {activeReceipt.reference} ({activeReceipt.files.length})
    </Button>}
    {activeItem && <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => onOpen({ kind: "history", itemId: activeItem.id })}>
      <History className="mr-1.5 h-3.5 w-3.5" /> Riwayat
    </Button>}
    {changeable && <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => onOpen({ kind: "correct", itemId: activeItem.id })}>
      <Edit3 className="mr-1.5 h-3.5 w-3.5" /> Koreksi
    </Button>}
    {changeable && <Button type="button" variant="outline" size="sm" className="text-xs text-red-700" onClick={() => onOpen({ kind: "void", itemId: activeItem.id })}>
      <Ban className="mr-1.5 h-3.5 w-3.5" /> Batalkan baris
    </Button>}
  </>;

  const recordButton = <Button type="button" size="sm" className="text-xs" disabled={locked || ready.length === 0} onClick={() => void record()}
    title={filled.length > ready.length ? `${filled.length - ready.length} baris draf masih bermasalah dan tidak ikut dicatat` : undefined}>
    <Save className="mr-1.5 h-3.5 w-3.5" /> {preparing || operation.state === "SAVING" ? "Mencatat…" : `Catat ${ready.length} baris`}
  </Button>;

  return <div className={expanded ? "flex min-h-0 flex-1 flex-col gap-2" : "space-y-2"}>
    <div className={expanded ? "flex min-h-0 flex-1 flex-col" : "hidden md:block"}>
      <SpreadsheetGrid<CostRow>
        label="Biaya operasional"
        itemLabel="baris biaya"
        rows={rows}
        rowId={rowKey}
        columns={columns}
        readOnly={locked}
        createRow={() => newCostDraft()}
        onRowsChange={(next) => commit(next.filter((row) => !row.item))}
        onDeleteRows={(ids) => { const gone = new Set(ids); commit(drafts.filter((row) => !gone.has(row.key))); }}
        unsavedNote="Baris draf belum tercatat. Penghapusan dapat diurungkan dengan Ctrl+Z."
        serverIssues={serverIssues}
        flags={flags}
        onUndo={undo}
        onRedo={redo}
        query={query}
        onQueryChange={setQuery}
        onlyIssues={onlyIssues}
        onOnlyIssuesChange={setOnlyIssues}
        rowLock={(row) => (row.item ? (row.item.status === "VOIDED" ? "voided" : "locked") : null)}
        onOpenLocked={(row, columnId) => {
          const receipt = receiptByRef(row.fields.receiptRef, overview.receipts);
          if (columnId === "receiptRef" && receipt) onOpen({ kind: "files", receiptId: receipt.id });
          else if (row.item) onOpen({ kind: "history", itemId: row.item.id });
        }}
        onActiveRowChange={setActiveId}
        actions={<>{rowActions}{recordButton}</>}
        fill={expanded}
      />
      <p className="mt-1 text-[11px] text-stone-500">
        Baris abu-abu sudah tercatat dan terkunci: pilih barisnya lalu Koreksi atau Batalkan baris, atau tekan Enter untuk riwayatnya
        (Enter pada kolom nota membuka lampiran). Nota yang belum ada dibuat otomatis saat baris dicatat.
      </p>
    </div>
    {!expanded && <MobileCosts rows={rows} ctx={ctx} purposes={purposes} locked={locked} query={query} onQueryChange={setQuery}
      serverIssues={serverIssues} receipts={overview.receipts} onOpen={onOpen}
      onDraftChange={(key, fields) => commit(drafts.map((row) => (row.key === key ? { ...row, fields } : row)))}
      onDraftRemove={(key) => commit(drafts.filter((row) => row.key !== key))}
      onDraftAdd={() => commit([...drafts, newCostDraft()])}
      recordButton={recordButton} />}
    {serverIssues.size > 0 && <div role="alert" className="rounded-md bg-red-50 p-2 text-xs text-red-800">
      <p className="font-semibold">Belum tercatat, tetap sebagai draf:</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {rows.flatMap((row, index) => (serverIssues.get(row.key) ?? []).map((message) =>
          <li key={`${row.key}-${message}`}>Baris {index + 1}: {message}</li>))}
      </ul>
    </div>}
    {prepareError && <p role="alert" className="rounded-md bg-red-50 p-2 text-xs text-red-700">{prepareError}</p>}
    {operation.state !== "IDLE" && operation.state !== "SAVED" && <MutationFeedback operation={operation} />}
  </div>;
}

/** Phones get cards, like the recipient list: recorded rows with their actions, drafts as small forms. */
function MobileCosts({ rows, ctx, purposes, locked, query, onQueryChange, serverIssues, receipts, onOpen, onDraftChange, onDraftRemove, onDraftAdd, recordButton }: {
  rows: CostRow[]; ctx: CostContext; purposes: string[]; locked: boolean; query: string; onQueryChange: (query: string) => void;
  serverIssues: Map<string, string[]>; receipts: Receipt[]; onOpen: (open: Open) => void;
  onDraftChange: (key: string, fields: CostFields) => void; onDraftRemove: (key: string) => void; onDraftAdd: () => void;
  recordButton: React.ReactNode;
}) {
  const id = useId();
  const needle = query.trim().toLowerCase();
  const shown = rows.filter((row) => !row.item || !needle || Object.values(row.fields).some((v) => v.toLowerCase().includes(needle)));
  return <div className="space-y-2 md:hidden">
    <label className="relative block">
      <span className="sr-only">Cari baris biaya</span>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
      <input id={`${id}-search`} type="search" value={query} onChange={(e) => onQueryChange(e.target.value)} placeholder="Cari biaya…"
        className="w-full rounded-lg border border-stone-300 bg-white py-2 pl-8 pr-2 text-sm" />
    </label>
    {shown.map((row) => {
      if (!row.item) {
        return <fieldset key={row.key} disabled={locked} className="space-y-2 rounded-xl border border-emerald-200 bg-white p-3">
          <legend className="px-1 text-xs font-semibold text-emerald-900">Baris draf</legend>
          <CostFieldsForm fields={row.fields} onChange={(fields) => onDraftChange(row.key, fields)} ctx={ctx} purposes={purposes}
            receiptChoice="type" showIssues={!isBlank(row.fields)} />
          {serverIssues.get(row.key)?.map((message) => <p key={message} className="text-[11px] text-red-700">{message}</p>)}
          <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => onDraftRemove(row.key)}>Hapus draf</Button>
        </fieldset>;
      }
      const item = row.item;
      const receipt = receiptByRef(row.fields.receiptRef, receipts);
      const changeable = item.status === "ACTIVE" && !item.reimbursementId;
      return <article key={row.key} className={`space-y-1 rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs ${item.status === "VOIDED" ? "text-stone-400" : "text-stone-700"}`}>
        <div className="flex items-baseline justify-between gap-2">
          <p className={`font-semibold text-stone-900 ${item.status === "VOIDED" ? "line-through" : ""}`}>{item.purpose} · {formatIdrAmount(item.amountIdr)}</p>
          <span className="flex gap-1">
            {item.status === "VOIDED" && <span className="rounded bg-stone-200 px-1.5 text-[10px] font-semibold">batal</span>}
            {item.status === "ACTIVE" && item.version > 1 && <span className="rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-900">dikoreksi</span>}
            {item.reimbursementId && <span className="rounded bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-900">diganti</span>}
          </span>
        </div>
        <p className={item.status === "VOIDED" ? "line-through" : ""}>
          {displayDate(item.spentOn)}{item.quantity ? ` · ${item.quantity} ${item.unit ?? ""} × ${formatIdrAmount(item.unitPriceIdr)}` : ""}
          {" · "}dibayarkan kepada {item.payee} · {fundingLabel(item.fundingSource, ctx)}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {receipt && <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => onOpen({ kind: "files", receiptId: receipt.id })}>
            <Paperclip className="mr-1 h-3.5 w-3.5" /> {receipt.reference} ({receipt.files.length})
          </Button>}
          <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => onOpen({ kind: "history", itemId: item.id })}>Riwayat</Button>
          {changeable && <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => onOpen({ kind: "correct", itemId: item.id })}>Koreksi</Button>}
          {changeable && <Button type="button" variant="outline" size="sm" className="text-xs text-red-700" onClick={() => onOpen({ kind: "void", itemId: item.id })}>Batalkan</Button>}
        </div>
      </article>;
    })}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" className="text-xs" disabled={locked} onClick={onDraftAdd}>
        <Plus className="mr-1.5 h-3.5 w-3.5" /> Tambah baris
      </Button>
      {recordButton}
    </div>
  </div>;
}

function PanjarSheet({ requests, proposalId, overview, ctx, onReturn }: {
  requests: PrivateRequests; proposalId: string; overview: OperationalCosts; ctx: CostContext; onReturn: (panjarId: string) => void;
}) {
  const id = useId();
  const empty = { holderOfficerId: "", amountIdr: "", purpose: "", cashOutRef: "", issuedOn: new Date().toISOString().slice(0, 10) };
  const [form, setForm] = useState(empty);
  const operation = useRealizationMutation(requests,
    (p: typeof empty & { operationId: string }) => issuePanjar(requests, proposalId, p),
    () => setForm(empty));
  const usage = new Map(overview.holders.flatMap((h) => h.panjar).map((p) => [p.panjarId, p]));
  const name = (officerId: string) => ctx.officers.find((o) => o.id === officerId)?.displayName ?? officerId;
  const inputClass = "mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm font-normal";
  const labelClass = "block text-xs font-semibold text-stone-700";
  const valid = form.holderOfficerId && /^\d+$/.test(form.amountIdr) && form.amountIdr !== "0" && form.purpose.trim() && form.cashOutRef.trim() && form.issuedOn;

  return <div className="space-y-3 text-sm">
    <p className="text-xs text-stone-600">Panjar adalah uang lembaga yang dibawa petugas. Biaya yang dibayar darinya dicatat di lembar Biaya dengan sumber dana panjar; sisanya dikembalikan.</p>
    {overview.panjar.length === 0
      ? <p className="rounded-xl border border-dashed border-stone-200 p-4 text-center text-xs text-stone-600">Belum ada panjar.</p>
      : <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-stone-100 text-left text-stone-700">
            <tr>
              <th className="px-2 py-2">Tanggal</th><th className="px-2 py-2">Petugas</th><th className="px-2 py-2">Keperluan</th>
              <th className="px-2 py-2">No. bukti kas keluar</th><th className="px-2 py-2 text-right">Nominal</th>
              <th className="px-2 py-2 text-right">Terpakai</th><th className="px-2 py-2 text-right">Dikembalikan</th>
              <th className="px-2 py-2 text-right">Sisa</th><th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {overview.panjar.map((panjar) => {
              const use = usage.get(panjar.id);
              return <tr key={panjar.id} className="border-t border-stone-100">
                <td className="px-2 py-1.5">{displayDate(panjar.issuedOn)}</td>
                <td className="px-2 py-1.5">{name(panjar.holderOfficerId)}</td>
                <td className="px-2 py-1.5">{panjar.purpose}</td>
                <td className="px-2 py-1.5 font-mono">{panjar.cashOutRef}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatIdrAmount(panjar.amountIdr)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatIdrAmount(use?.usedIdr ?? "0")}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatIdrAmount(use?.returnedIdr ?? "0")}</td>
                <td className="px-2 py-1.5 text-right font-mono font-semibold">{formatIdrAmount(use?.remainingIdr ?? "0")}</td>
                <td className="px-2 py-1.5">
                  {use && use.remainingIdr !== "0" && <button type="button" className="font-semibold text-emerald-800 underline" onClick={() => onReturn(panjar.id)}>
                    Catat pengembalian sisa
                  </button>}
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>}

    <form aria-label="Keluarkan panjar" className="grid grid-cols-1 gap-2 rounded-lg bg-stone-50 p-3 sm:grid-cols-5" onSubmit={(e) => {
      e.preventDefault();
      if (valid) void operation.submit((operationId) => ({ ...form, operationId, purpose: form.purpose.trim(), cashOutRef: form.cashOutRef.trim() }));
    }}>
      <p className="text-xs font-semibold text-stone-800 sm:col-span-5">Keluarkan panjar</p>
      <label className={labelClass} htmlFor={`${id}-holder`}>Petugas pemegang
        <select id={`${id}-holder`} value={form.holderOfficerId} disabled={operation.locked} className={inputClass}
          onChange={(e) => setForm({ ...form, holderOfficerId: e.target.value })}>
          <option value="">Pilih petugas…</option>
          {ctx.officers.filter((o) => o.isActive).map((o) => <option key={o.id} value={o.id}>{o.displayName}</option>)}
        </select></label>
      <label className={labelClass} htmlFor={`${id}-amount`}>Nominal (Rp)
        <input id={`${id}-amount`} inputMode="numeric" value={form.amountIdr} disabled={operation.locked} className={inputClass}
          onChange={(e) => setForm({ ...form, amountIdr: e.target.value.replace(/\D/g, "") })} /></label>
      <label className={labelClass} htmlFor={`${id}-purpose`}>Keperluan
        <input id={`${id}-purpose`} value={form.purpose} disabled={operation.locked} className={inputClass} placeholder="mis. Jumat Berkah"
          onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></label>
      <label className={labelClass} htmlFor={`${id}-ref`}>No. bukti kas keluar
        <input id={`${id}-ref`} value={form.cashOutRef} disabled={operation.locked} className={inputClass} placeholder="mis. BKK-001"
          onChange={(e) => setForm({ ...form, cashOutRef: e.target.value })} /></label>
      <label className={labelClass} htmlFor={`${id}-date`}>Tanggal
        <input id={`${id}-date`} type="date" value={form.issuedOn} disabled={operation.locked} className={inputClass}
          onChange={(e) => setForm({ ...form, issuedOn: e.target.value })} /></label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-5">
        <Button type="submit" size="sm" disabled={operation.locked || !valid}>Keluarkan panjar</Button>
        {operation.state !== "IDLE" && <MutationFeedback operation={operation} />}
      </div>
    </form>
  </div>;
}

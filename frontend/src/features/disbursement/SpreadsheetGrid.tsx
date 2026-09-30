import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type MutableRefObject, type ReactNode } from "react";
import { AlertTriangle, History, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/Dialog";
import { parseTsv, toTsv } from "./spreadsheet";

/**
 * One column of the grid. `value` is the editable text of a cell; `apply`
 * writes text back into the row (null = this text cannot be stored here, e.g.
 * an unknown identity kind). A column without `apply` is read-only, and a row
 * where `enabled` is false shows the cell as not applicable.
 */
export type GridColumn<R> = {
  id: string;
  header: string;
  width: number;
  hint?: string;
  value: (row: R) => string;
  apply?: (row: R, text: string) => R | null;
  enabled?: (row: R) => boolean;
  normalize?: (text: string) => string;
  options?: readonly string[];
  validate?: (row: R) => string | null;
  mono?: boolean;
  align?: "right";
};

/** A cell address; `r` is a position among the rows currently shown, not an index into `rows`. */
type Cell = { r: number; c: number };
type Selection = { anchor: Cell; extent: Cell };
type Editing = { r: number; c: number; initial: string };
type Write = { r: number; c: number; text: string };
/** An advisory marker on a row (not an error), e.g. a recipient already aided elsewhere. */
export type RowFlag = { badge: string; detail: string };

const ROW_HEADER_WIDTH = 76;
const PAGE_STEP = 20;

const isEnabled = <R,>(column: GridColumn<R>, row: R) => Boolean(column.apply) && (column.enabled?.(row) ?? true);

export function SpreadsheetGrid<R>({
  label,
  itemLabel,
  rows,
  rowId,
  columns,
  readOnly,
  createRow,
  onRowsChange,
  onDeleteRows,
  deleteImpact,
  serverIssues,
  onUndo,
  onRedo,
  query,
  onQueryChange,
  onlyIssues,
  onOnlyIssuesChange,
  actions,
  flags,
  flagFilter,
  fill = false,
}: {
  label: string;
  /** Lower-case noun for one row, e.g. "penerima". */
  itemLabel: string;
  rows: R[];
  rowId: (row: R) => string;
  columns: GridColumn<R>[];
  readOnly: boolean;
  createRow: () => R;
  onRowsChange: (rows: R[]) => void;
  onDeleteRows: (ids: string[]) => void;
  /** An extra sentence for the delete confirmation, e.g. the aid lines removed with a recipient. */
  deleteImpact?: (ids: string[]) => string | null;
  /** Saved-draft issues the columns cannot check live, keyed by row id. */
  serverIssues: Map<string, string[]>;
  onUndo: () => void;
  onRedo: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  onlyIssues: boolean;
  onOnlyIssuesChange: (only: boolean) => void;
  actions?: ReactNode;
  /** Advisory row markers keyed by row id, shown beside the row number. */
  flags?: Map<string, RowFlag>;
  /** A toolbar toggle that narrows the grid to flagged rows. */
  flagFilter?: { label: string; active: boolean; onChange: (active: boolean) => void };
  /** Grow to the parent's height (fullscreen) instead of capping at 70vh. */
  fill?: boolean;
}) {
  const gridId = useId().replace(/:/g, "");
  const tableRef = useRef<HTMLTableElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editing, setEditingState] = useState<Editing | null>(null);
  const editingRef = useRef<Editing | null>(null);
  const editValue = useRef("");
  const dragging = useRef(false);
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);

  const setEditing = (next: Editing | null) => {
    editingRef.current = next;
    setEditingState(next);
  };

  // Live cell errors, cached per row object so an edit only revalidates the row it touched.
  const errorCache = useMemo(() => new WeakMap<object, (string | null)[]>(), [columns]);
  const errorsOf = (row: R): (string | null)[] => {
    const key = row as object;
    let errors = errorCache.get(key);
    if (!errors) {
      errors = columns.map((column) => (column.enabled?.(row) ?? true ? column.validate?.(row) ?? null : null));
      errorCache.set(key, errors);
    }
    return errors;
  };
  const hasIssue = (row: R) => errorsOf(row).some(Boolean) || (serverIssues.get(rowId(row))?.length ?? 0) > 0;

  // Which rows a filter shows is decided when the filter changes or rows are added/removed, not on
  // every keystroke: fixing a cell under "only problems" must not yank the row away mid-edit.
  const needle = query.trim().toLowerCase();
  const onlyFlagged = Boolean(flagFilter?.active && flags);
  const filtered = needle !== "" || onlyIssues || onlyFlagged;
  const idsKey = rows.map(rowId).join("|");
  const shownIds = useMemo(() => {
    if (!filtered) return null;
    return new Set(
      rows
        .filter((row) => (!onlyIssues || hasIssue(row)) && (!onlyFlagged || flags!.has(rowId(row))) && (!needle || columns.some((col) => col.value(row).toLowerCase().includes(needle))))
        .map(rowId),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately frozen between filter changes
  }, [filtered, needle, onlyIssues, onlyFlagged, flags, idsKey, columns, serverIssues]);
  const visible = useMemo(
    () => rows.flatMap((row, index) => (!shownIds || shownIds.has(rowId(row)) ? [index] : [])),
    [rows, shownIds, rowId],
  );
  const issueRowCount = useMemo(() => rows.filter(hasIssue).length, [rows, errorCache, serverIssues]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastR = visible.length - 1;
  const lastC = columns.length - 1;
  const clamp = (cell: Cell): Cell => ({ r: Math.max(0, Math.min(lastR, cell.r)), c: Math.max(0, Math.min(lastC, cell.c)) });
  const sel = selection && visible.length > 0 ? { anchor: clamp(selection.anchor), extent: clamp(selection.extent) } : null;
  const rect = sel && {
    r0: Math.min(sel.anchor.r, sel.extent.r), r1: Math.max(sel.anchor.r, sel.extent.r),
    c0: Math.min(sel.anchor.c, sel.extent.c), c1: Math.max(sel.anchor.c, sel.extent.c),
  };
  // Deleting is offered for whole rows, picked by their row numbers, not for any cell selection.
  const selectedIds = rect && rect.c0 === 0 && rect.c1 === columns.length - 1
    ? visible.slice(rect.r0, rect.r1 + 1).map((index) => rowId(rows[index]))
    : [];

  const cellId = (cell: Cell) => `${gridId}-r${cell.r}-c${cell.c}`;
  const focusGrid = () => tableRef.current?.focus({ preventScroll: true });

  useEffect(() => {
    if (sel) document.getElementById(cellId(sel.extent))?.scrollIntoView({ block: "nearest", inline: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.extent.r, sel?.extent.c]);

  /** Applies cell writes (positions in `visible`, or past its end to append rows) as one change. */
  function writeCells(writes: Write[], appended = 0): { rejected: number; changed: boolean } {
    const next = rows.slice();
    for (let i = 0; i < appended; i++) next.push(createRow());
    const indexOf = (r: number) => (r < visible.length ? visible[r] : rows.length + (r - visible.length));
    let rejected = 0;
    let changed = appended > 0;
    for (const { r, c, text } of writes) {
      const index = indexOf(r);
      const column = columns[c];
      const row = next[index];
      if (!column || row === undefined || !isEnabled(column, row)) continue;
      const value = column.normalize ? column.normalize(text) : text;
      if (value === column.value(row)) continue;
      const updated = column.apply!(row, value);
      if (!updated) { rejected++; continue; }
      next[index] = updated;
      changed = true;
    }
    if (changed) onRowsChange(next);
    return { rejected, changed };
  }

  function warnRejected(rejected: number) {
    if (rejected > 0) toast.warning(`${rejected} sel tidak diubah: nilainya tidak dikenali untuk kolom tersebut (mis. Dasar identitas: NIK/ALTERNATIF, Bentuk: UANG/BARANG).`);
  }

  function startEdit(cell: Cell, initial?: string) {
    if (readOnly) return;
    const row = rows[visible[cell.r]];
    const column = columns[cell.c];
    if (row === undefined || !isEnabled(column, row)) return;
    const text = initial ?? column.value(row);
    editValue.current = text;
    setSelection({ anchor: cell, extent: cell });
    setEditing({ r: cell.r, c: cell.c, initial: text });
  }

  /** Writes the open editor back; `refocus` is false when focus is leaving the grid (e.g. to Simpan). */
  function commitEdit(move?: { dr: number; dc: number }, refocus = true) {
    const current = editingRef.current;
    if (!current) return;
    setEditing(null);
    const { rejected } = writeCells([{ r: current.r, c: current.c, text: editValue.current }]);
    warnRejected(rejected);
    if (move) {
      const to = clamp({ r: current.r + move.dr, c: current.c + move.dc });
      setSelection({ anchor: to, extent: to });
    }
    if (refocus) focusGrid();
  }

  function cancelEdit() {
    setEditing(null);
    focusGrid();
  }

  function moveTo(dr: number, dc: number, extend: boolean) {
    const base = sel ?? { anchor: { r: 0, c: 0 }, extent: { r: 0, c: 0 } };
    const from = extend ? base.extent : base.anchor;
    const to = clamp({ r: from.r + dr, c: from.c + dc });
    setSelection(extend ? { anchor: base.anchor, extent: to } : { anchor: to, extent: to });
  }

  function rectCells(fn: (r: number, c: number) => string | null): Write[] {
    if (!rect) return [];
    const writes: Write[] = [];
    for (let r = rect.r0; r <= rect.r1; r++) {
      for (let c = rect.c0; c <= rect.c1; c++) {
        const text = fn(r, c);
        if (text !== null) writes.push({ r, c, text });
      }
    }
    return writes;
  }

  function clearSelection() {
    if (readOnly || !rect) return;
    writeCells(rectCells(() => ""));
  }

  function fillDown() {
    if (readOnly || !rect) return;
    const sourceR = rect.r0 === rect.r1 ? rect.r0 - 1 : rect.r0;
    if (sourceR < 0) return;
    const source = rows[visible[sourceR]];
    const { rejected } = writeCells(rectCells((r, c) => (r === sourceR ? null : columns[c].value(source))));
    warnRejected(rejected);
  }

  function copyText(): string {
    if (!rect) return "";
    const matrix: string[][] = [];
    for (let r = rect.r0; r <= rect.r1; r++) {
      const row = rows[visible[r]];
      matrix.push(columns.slice(rect.c0, rect.c1 + 1).map((column) => ((column.enabled?.(row) ?? true) ? column.value(row) : "")));
    }
    return toTsv(matrix);
  }

  function paste(text: string) {
    if (readOnly || !rect) return;
    const matrix = parseTsv(text);
    if (matrix.length === 0) return;
    const single = matrix.length === 1 && matrix[0].length === 1;
    // One copied value into a larger selection fills it, as in Excel.
    if (single && (rect.r0 !== rect.r1 || rect.c0 !== rect.c1)) {
      warnRejected(writeCells(rectCells(() => matrix[0][0])).rejected);
      return;
    }
    const writes: Write[] = [];
    let dropped = 0;
    matrix.forEach((cells, i) => {
      const r = rect.r0 + i;
      // Under a filter, rows past the last shown one are not created: they would be hidden at once.
      if (r > lastR && filtered) { dropped++; return; }
      cells.forEach((text, j) => writes.push({ r, c: rect.c0 + j, text }));
    });
    const appended = filtered ? 0 : Math.max(0, rect.r0 + matrix.length - visible.length);
    const { rejected } = writeCells(writes, appended);
    const lastPasted = { r: Math.min(rect.r0 + matrix.length - 1 - dropped, visible.length - 1 + appended), c: Math.min(lastC, rect.c0 + Math.max(...matrix.map((cells) => cells.length)) - 1) };
    setSelection({ anchor: { r: rect.r0, c: rect.c0 }, extent: lastPasted });
    if (appended > 0) toast.success(`${appended} ${itemLabel} baru ditambahkan dari tempelan.`);
    if (dropped > 0) toast.warning(`${dropped} baris tidak ditempel karena filter sedang aktif. Hapus pencarian/filter untuk menambah baris baru.`);
    warnRejected(rejected);
  }

  // Clipboard events reach the focused grid (or <body> in some browsers); listen at the window
  // and act only while the grid itself — not a cell editor — has focus.
  const clipboard = useRef({ copyText, paste, clearSelection });
  clipboard.current = { copyText, paste, clearSelection };
  useEffect(() => {
    const owns = () => document.activeElement === tableRef.current && !editingRef.current;
    const onCopy = (event: ClipboardEvent) => {
      if (!owns()) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", clipboard.current.copyText());
    };
    const onCut = (event: ClipboardEvent) => {
      onCopy(event);
      if (owns()) clipboard.current.clearSelection();
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!owns()) return;
      event.preventDefault();
      clipboard.current.paste(event.clipboardData?.getData("text/plain") ?? "");
    };
    window.addEventListener("copy", onCopy);
    window.addEventListener("cut", onCut);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("cut", onCut);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  useEffect(() => {
    const stop = () => { dragging.current = false; };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  function onGridKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    if (event.target !== tableRef.current || visible.length === 0) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;
    const handled = () => event.preventDefault();

    if (mod && key.toLowerCase() === "z") { handled(); (event.shiftKey ? onRedo : onUndo)(); return; }
    if (mod && key.toLowerCase() === "y") { handled(); onRedo(); return; }
    if (mod && key.toLowerCase() === "d") { handled(); fillDown(); return; }
    if (mod && key.toLowerCase() === "a") {
      handled();
      setSelection({ anchor: { r: 0, c: 0 }, extent: { r: lastR, c: lastC } });
      return;
    }
    if (mod) return; // leave Ctrl+C / Ctrl+V / Ctrl+S to their own handlers

    const far = Number.MAX_SAFE_INTEGER;
    switch (key) {
      case "ArrowUp": handled(); moveTo(event.altKey ? -far : -1, 0, event.shiftKey); return;
      case "ArrowDown": handled(); moveTo(event.altKey ? far : 1, 0, event.shiftKey); return;
      case "ArrowLeft": handled(); moveTo(0, -1, event.shiftKey); return;
      case "ArrowRight": handled(); moveTo(0, 1, event.shiftKey); return;
      case "Home": handled(); moveTo(0, -far, event.shiftKey); return;
      case "End": handled(); moveTo(0, far, event.shiftKey); return;
      case "PageUp": handled(); moveTo(-PAGE_STEP, 0, event.shiftKey); return;
      case "PageDown": handled(); moveTo(PAGE_STEP, 0, event.shiftKey); return;
      case "Tab": {
        if (!sel) return;
        handled();
        const { r, c } = sel.anchor;
        const forward = !event.shiftKey;
        const next = forward
          ? c < lastC ? { r, c: c + 1 } : { r: Math.min(lastR, r + 1), c: 0 }
          : c > 0 ? { r, c: c - 1 } : { r: Math.max(0, r - 1), c: lastC };
        setSelection({ anchor: next, extent: next });
        return;
      }
      case "Enter":
      case "F2":
        if (sel) { handled(); startEdit(sel.anchor); }
        return;
      case "Escape":
        if (sel && (rect!.r0 !== rect!.r1 || rect!.c0 !== rect!.c1)) { handled(); setSelection({ anchor: sel.anchor, extent: sel.anchor }); }
        return;
      case "Delete":
      case "Backspace":
        handled();
        clearSelection();
        return;
    }
    if (key.length === 1 && !event.altKey && sel) {
      handled();
      startEdit(sel.anchor, key);
    }
  }

  function onEditorKeyDownLatest(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === "Enter") { event.preventDefault(); commitEdit({ dr: event.shiftKey ? -1 : 1, dc: 0 }); }
    else if (event.key === "Tab") { event.preventDefault(); commitEdit({ dr: 0, dc: event.shiftKey ? -1 : 1 }); }
    else if (event.key === "Escape") { event.preventDefault(); cancelEdit(); }
  }

  // Stable identities for the per-row editor callbacks, so memoised rows are not re-rendered by them.
  const editorHandlers = useRef({ keyDown: onEditorKeyDownLatest, blur: () => commitEdit(undefined, false) });
  editorHandlers.current = { keyDown: onEditorKeyDownLatest, blur: () => commitEdit(undefined, false) };
  const [onEditorKeyDown] = useState(() => (event: KeyboardEvent<HTMLInputElement>) => editorHandlers.current.keyDown(event));
  const [onEditorBlur] = useState(() => () => editorHandlers.current.blur());

  function cellAt(target: EventTarget): { cell: Cell; rowHeader: boolean } | null {
    const el = (target as HTMLElement).closest<HTMLElement>("[data-r]");
    if (!el || !tableRef.current?.contains(el)) return null;
    return { cell: { r: Number(el.dataset.r), c: Number(el.dataset.c ?? 0) }, rowHeader: el.dataset.rowHeader === "1" };
  }

  function onMouseDown(event: MouseEvent<HTMLTableElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).tagName === "INPUT") return;
    const hit = cellAt(event.target);
    if (!hit) return;
    event.preventDefault();
    if (editingRef.current) commitEdit();
    focusGrid();
    const { cell, rowHeader } = hit;
    if (rowHeader) {
      const anchor = event.shiftKey && sel ? { r: sel.anchor.r, c: 0 } : { r: cell.r, c: 0 };
      setSelection({ anchor, extent: { r: cell.r, c: lastC } });
    } else {
      setSelection(event.shiftKey && sel ? { anchor: sel.anchor, extent: cell } : { anchor: cell, extent: cell });
    }
    dragging.current = true;
  }

  function onMouseOver(event: MouseEvent<HTMLTableElement>) {
    if (!dragging.current || !sel) return;
    const hit = cellAt(event.target);
    if (!hit) return;
    const extent = hit.rowHeader ? { r: hit.cell.r, c: lastC } : hit.cell;
    if (extent.r !== sel.extent.r || extent.c !== sel.extent.c) setSelection({ anchor: sel.anchor, extent });
  }

  function addRow() {
    onQueryChange("");
    onOnlyIssuesChange(false);
    onRowsChange([...rows, createRow()]);
    const cell = { r: rows.length, c: 0 };
    setSelection({ anchor: cell, extent: cell });
    focusGrid();
  }

  function confirmDelete() {
    if (confirmIds) onDeleteRows(confirmIds);
    setConfirmIds(null);
    setSelection(null);
    focusGrid();
  }

  const tableWidth = ROW_HEADER_WIDTH + columns.reduce((sum, column) => sum + column.width, 0);
  const stickyLeft = ROW_HEADER_WIDTH + (columns[0]?.width ?? 0);
  const activeId = sel ? cellId(sel.anchor) : undefined;
  const impact = confirmIds && deleteImpact ? deleteImpact(confirmIds) : null;

  return (
    <div className={fill ? "flex min-h-0 flex-1 flex-col gap-2" : "space-y-2"}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-52 flex-1 sm:max-w-sm">
          <span className="sr-only">Cari {itemLabel}</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => { onQueryChange(e.target.value); setSelection(null); }}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === "ArrowDown") && visible.length > 0) {
                e.preventDefault();
                setSelection({ anchor: { r: 0, c: 0 }, extent: { r: 0, c: 0 } });
                focusGrid();
              }
            }}
            placeholder="Cari di semua kolom…"
            className="w-full rounded-lg border border-stone-300 bg-white py-1.5 pl-8 pr-2 text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
        <button
          type="button"
          aria-pressed={onlyIssues}
          onClick={() => { onOnlyIssuesChange(!onlyIssues); setSelection(null); }}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
            onlyIssues ? "border-red-300 bg-red-50 text-red-800" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Hanya baris bermasalah ({issueRowCount})
        </button>
        {flagFilter && flags && flags.size > 0 && (
          <button
            type="button"
            aria-pressed={flagFilter.active}
            onClick={() => { flagFilter.onChange(!flagFilter.active); setSelection(null); }}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
              flagFilter.active ? "border-amber-300 bg-amber-50 text-amber-900" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
            }`}
          >
            <History className="h-3.5 w-3.5" />
            {flagFilter.label} ({flags.size})
          </button>
        )}
        <span className="text-xs text-stone-500" aria-live="polite">
          {filtered ? `${visible.length} dari ${rows.length} baris` : `${rows.length} baris`}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!readOnly && selectedIds.length > 0 && (
            <Button type="button" variant="outline" size="sm" className="text-xs text-red-700 hover:text-red-800" onClick={() => setConfirmIds(selectedIds)}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Hapus {selectedIds.length} baris
            </Button>
          )}
          {actions}
        </div>
      </div>

      <div
        className={`overflow-auto rounded-lg border border-stone-300 bg-white ${fill ? "min-h-0 flex-1" : "max-h-[70vh]"}`}
        style={{ scrollPaddingTop: 34, scrollPaddingLeft: stickyLeft }}
      >
        <table
          ref={tableRef}
          role="grid"
          tabIndex={0}
          aria-label={label}
          aria-rowcount={visible.length + 1}
          aria-colcount={columns.length + 1}
          aria-multiselectable
          aria-readonly={readOnly}
          aria-activedescendant={editing ? undefined : activeId}
          onKeyDown={onGridKeyDown}
          onFocus={(event) => {
            if (event.target === tableRef.current && !selection && visible.length > 0) setSelection({ anchor: { r: 0, c: 0 }, extent: { r: 0, c: 0 } });
          }}
          onMouseDown={onMouseDown}
          onMouseOver={onMouseOver}
          onDoubleClick={(event) => {
            const hit = cellAt(event.target);
            if (hit && !hit.rowHeader) startEdit(hit.cell);
          }}
          className="table-fixed border-separate border-spacing-0 text-xs outline-none select-none"
          style={{ width: tableWidth }}
        >
          <colgroup>
            <col style={{ width: ROW_HEADER_WIDTH }} />
            {columns.map((column) => <col key={column.id} style={{ width: column.width }} />)}
          </colgroup>
          <thead>
            <tr aria-rowindex={1}>
              <th scope="col" className="sticky left-0 top-0 z-30 border-b border-r border-stone-300 bg-stone-100 px-2 py-2 text-right font-medium text-stone-500">
                #
              </th>
              {columns.map((column, c) => (
                <th
                  key={column.id}
                  scope="col"
                  aria-colindex={c + 2}
                  title={column.hint}
                  className={`sticky top-0 border-b border-r border-stone-300 bg-stone-100 px-2 py-2 text-left font-semibold text-stone-700 whitespace-nowrap truncate ${c === 0 ? "z-30" : "z-20"}`}
                  style={c === 0 ? { left: ROW_HEADER_WIDTH } : undefined}
                >
                  {column.header}
                  {column.hint?.startsWith("Wajib") && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((index, r) => {
              const row = rows[index];
              const inRows = rect !== null && r >= rect.r0 && r <= rect.r1;
              return (
                <GridRow
                  key={rowId(row)}
                  gridId={gridId}
                  row={row}
                  r={r}
                  rowNumber={index + 1}
                  columns={columns}
                  errors={errorsOf(row)}
                  extra={serverIssues.get(rowId(row))}
                  flag={flags?.get(rowId(row))}
                  selC0={inRows ? rect!.c0 : -1}
                  selC1={inRows ? rect!.c1 : -1}
                  activeC={sel && sel.anchor.r === r ? sel.anchor.c : -1}
                  editing={editing && editing.r === r ? editing : null}
                  editValue={editValue}
                  onEditorKeyDown={onEditorKeyDown}
                  onEditorBlur={onEditorBlur}
                />
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-8 text-center text-stone-500">
                  {filtered ? "Tidak ada baris yang cocok dengan pencarian/filter." : `Belum ada ${itemLabel}.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {options(columns, gridId)}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {!readOnly ? (
          <Button type="button" variant="outline" size="sm" className="text-xs" onClick={addRow}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Tambah baris
          </Button>
        ) : <span />}
        <p className="text-[11px] text-stone-500">
          {readOnly
            ? "Hanya-baca · Ctrl+C untuk menyalin"
            : "Enter/ketik untuk mengubah · Ctrl+C/Ctrl+V salin-tempel dari Excel · Ctrl+D isi ke bawah · Delete kosongkan · Ctrl+Z urungkan"}
        </p>
      </div>

      <Dialog open={confirmIds !== null} onOpenChange={(open) => { if (!open) setConfirmIds(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus {confirmIds?.length ?? 0} baris {itemLabel}?</DialogTitle>
            <DialogDescription>
              {impact ? `${impact} ` : ""}Perubahan belum tersimpan sampai draf disimpan, dan dapat diurungkan dengan Ctrl+Z.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmIds(null)}>Batal</Button>
            <Button type="button" className="bg-red-700 text-white hover:bg-red-800" onClick={confirmDelete}>
              <Trash2 className="mr-1.5 h-4 w-4" /> Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function options<R>(columns: GridColumn<R>[], gridId: string) {
  return columns.filter((column) => column.options).map((column) => (
    <datalist key={column.id} id={`${gridId}-${column.id}-options`}>
      {column.options!.map((option) => <option key={option} value={option} />)}
    </datalist>
  ));
}

type GridRowProps<R> = {
  gridId: string;
  row: R;
  r: number;
  rowNumber: number;
  columns: GridColumn<R>[];
  errors: (string | null)[];
  extra: string[] | undefined;
  flag: RowFlag | undefined;
  selC0: number;
  selC1: number;
  activeC: number;
  editing: Editing | null;
  editValue: MutableRefObject<string>;
  onEditorKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onEditorBlur: () => void;
};

// Rows re-render only when their data or their slice of the selection changes; with hundreds of
// rows this keeps arrow-key navigation and typing from repainting the whole sheet.
const GridRow = memo(function GridRow<R>({
  gridId, row, r, rowNumber, columns, errors, extra, flag, selC0, selC1, activeC, editing, editValue, onEditorKeyDown, onEditorBlur,
}: GridRowProps<R>) {
  const messages = [...errors.filter((e): e is string => e !== null), ...(extra ?? [])];
  const rowSelected = selC0 === 0 && selC1 === columns.length - 1;
  return (
    <tr aria-rowindex={r + 2}>
      <th
        scope="row"
        data-r={r}
        data-row-header="1"
        title={[...messages, ...(flag ? [flag.detail] : [])].join("\n") || `Pilih baris ${rowNumber}`}
        className={`sticky left-0 z-10 cursor-pointer border-b border-r border-stone-200 px-2 py-1.5 text-right font-mono font-normal tabular-nums ${
          rowSelected ? "bg-emerald-100 text-emerald-900" : selC0 >= 0 ? "bg-emerald-50 text-stone-700" : "bg-stone-50 text-stone-500"
        }`}
      >
        <span className="inline-flex items-center gap-1">
          {flag && (
            <span className="rounded bg-amber-100 px-1 font-sans text-[10px] font-semibold text-amber-900" aria-label={flag.detail}>
              {flag.badge}
            </span>
          )}
          {messages.length > 0 && <AlertTriangle className="h-3 w-3 text-red-600" aria-label={`${messages.length} masalah`} />}
          {rowNumber}
        </span>
      </th>
      {columns.map((column, c) => {
        const enabled = column.enabled?.(row) ?? true;
        const error = errors[c];
        const selected = c >= selC0 && c <= selC1;
        const active = c === activeC;
        const text = enabled ? column.value(row) : "";
        const bg = !enabled
          ? "bg-stone-100 text-stone-400"
          : error
            ? selected ? "bg-red-100" : "bg-red-50"
            : selected ? "bg-emerald-50" : "bg-white";
        const isEditing = editing?.c === c;
        return (
          <td
            key={column.id}
            id={`${gridId}-r${r}-c${c}`}
            role="gridcell"
            data-r={r}
            data-c={c}
            aria-colindex={c + 2}
            aria-selected={selected}
            aria-invalid={error ? true : undefined}
            aria-readonly={!enabled || !column.apply ? true : undefined}
            title={error ?? (text.length > 24 ? text : undefined)}
            className={`h-8 border-b border-r border-stone-200 px-2 whitespace-nowrap truncate ${bg} ${
              column.mono ? "font-mono tabular-nums" : ""
            } ${column.align === "right" ? "text-right" : ""} ${c === 0 ? "sticky z-10" : "relative"} ${
              error ? "shadow-[inset_0_0_0_1px_rgb(220_38_38)]" : ""
            } ${active ? "outline-2 -outline-offset-2 outline-emerald-600" : ""}`}
            style={c === 0 ? { left: ROW_HEADER_WIDTH } : undefined}
          >
            {isEditing ? (
              <CellEditor
                initial={editing.initial}
                listId={column.options ? `${gridId}-${column.id}-options` : undefined}
                className={`${column.mono ? "font-mono" : ""} ${column.align === "right" ? "text-right" : ""}`}
                editValue={editValue}
                onKeyDown={onEditorKeyDown}
                onBlur={onEditorBlur}
                label={column.header}
              />
            ) : enabled ? text : "—"}
          </td>
        );
      })}
    </tr>
  );
}) as <R>(props: GridRowProps<R>) => ReactNode;

function CellEditor({
  initial, listId, className, editValue, onKeyDown, onBlur, label,
}: {
  initial: string;
  listId?: string;
  className: string;
  editValue: MutableRefObject<string>;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
  label: string;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);
  return (
    <input
      ref={ref}
      aria-label={label}
      value={value}
      list={listId}
      onChange={(e) => { setValue(e.target.value); editValue.current = e.target.value; }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className={`absolute inset-0 w-full bg-white px-2 text-xs outline-2 -outline-offset-2 outline-emerald-600 ${className}`}
    />
  );
}

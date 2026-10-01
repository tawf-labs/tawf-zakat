import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Download, FileSpreadsheet, Maximize2, Minimize2, Plus, Search } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/Tabs";
import { newAidLine, newBeneficiary, type AidLine, type Beneficiary, type ProposalDraft, type ProposalIssue, type TabularFormat } from "./disbursementClient";
import { BeneficiaryCard } from "./BeneficiaryCard";
import { AidLineRow } from "./AidLineRow";
import { LIST_PAGE_SIZE, Pager, pageOf, usePage } from "./Pagination";
import { SpreadsheetGrid, type GridColumn, type RowFlag } from "./SpreadsheetGrid";
import { aidLineColumns, beneficiaryColumns, CLIENT_VALIDATED_FIELDS } from "./rosterColumns";

type Tab = "recipients" | "aidLines" | "costs";
type Roster = Pick<ProposalDraft, "beneficiaries" | "aidLines">;

const idOf = (row: { id: string }) => row.id;
const HISTORY_LIMIT = 100;

/**
 * Grid edits, pastes and deletions are undoable as whole steps. Only the
 * roster is restored, never the draft's version or issues, so an undo after
 * a save cannot resurrect a stale `expectedVersion`.
 */
function useRosterHistory(draft: ProposalDraft, setDraft: (draft: ProposalDraft) => void) {
  const past = useRef<Roster[]>([]);
  const future = useRef<Roster[]>([]);
  const current: Roster = { beneficiaries: draft.beneficiaries, aidLines: draft.aidLines };
  return {
    commit(next: Partial<Roster>) {
      past.current = [...past.current.slice(-(HISTORY_LIMIT - 1)), current];
      future.current = [];
      setDraft({ ...draft, ...next });
    },
    undo() {
      const previous = past.current.pop();
      if (!previous) return;
      future.current.push(current);
      setDraft({ ...draft, ...previous });
    },
    redo() {
      const next = future.current.pop();
      if (!next) return;
      past.current.push(current);
      setDraft({ ...draft, ...next });
    },
  };
}

/**
 * Saved-draft issues address rows by index at save time; pin them to row ids
 * when they arrive so inserting or deleting rows afterwards cannot move a
 * message onto the wrong person. Fields the grid validates live are left out:
 * the live check is fresher than the last save.
 */
function useServerIssues(issues: ProposalIssue[], scope: ProposalIssue["scope"], rows: { id: string }[]) {
  const [pinned, setPinned] = useState(() => ({ issues, ids: rows.map(idOf) }));
  let current = pinned;
  if (pinned.issues !== issues) {
    current = { issues, ids: rows.map(idOf) };
    setPinned(current);
  }
  return useMemo(() => {
    const byId = new Map<string, string[]>();
    for (const issue of current.issues) {
      if (issue.scope !== scope || issue.rowIndex === null || CLIENT_VALIDATED_FIELDS.has(issue.field)) continue;
      const id = current.ids[issue.rowIndex];
      if (id) byId.set(id, [...(byId.get(id) ?? []), issue.message]);
    }
    return byId;
  }, [current, scope]);
}

export function ProposalRoster({
  draft,
  setDraft,
  readOnly,
  locked,
  onOpenImport,
  onExport,
  saveControl,
  recurring,
  costs,
}: {
  draft: ProposalDraft;
  setDraft: (draft: ProposalDraft) => void;
  /** The proposal is past DRAFT: view, search and copy only. */
  readOnly: boolean;
  /** A save is in flight or unresolved: editing pauses without hiding the tools. */
  locked: boolean;
  onOpenImport?: () => void;
  /** Exports the saved roster; omitted while the draft has never been saved. */
  onExport?: (format: TabularFormat) => void;
  /** The save button and status, repeated in fullscreen where the form footer is covered. */
  saveControl?: ReactNode;
  /** Recipients already aided by other proposals, marked on their rows with a filter toggle. */
  recurring?: { flags: Map<string, RowFlag>; only: boolean; onOnlyChange: (only: boolean) => void };
  /** The Biaya Operasional tab of an approved proposal; `focus` changes to bring it forward. */
  costs?: { render: (expanded: boolean) => ReactNode; focus: number };
}) {
  const [tab, setTab] = useState<Tab>("recipients");
  const [expanded, setExpanded] = useState(false);
  const [queries, setQueries] = useState<Record<Tab, string>>({ recipients: "", aidLines: "", costs: "" });
  const [onlyIssues, setOnlyIssues] = useState<Record<Tab, boolean>>({ recipients: false, aidLines: false, costs: false });
  const history = useRosterHistory(draft, setDraft);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editable = !readOnly && !locked;

  const aidColumns = useMemo(() => aidLineColumns(draft.beneficiaries), [draft.beneficiaries]);
  const recipientIssues = useServerIssues(draft.issues, "recipient", draft.beneficiaries);
  const aidLineIssues = useServerIssues(draft.issues, "aidLine", draft.aidLines);

  // "Lihat di tabel" from the recurring-aid banner turns the filter on; show it on the tab it applies to.
  const onlyRecurring = recurring?.only ?? false;
  useEffect(() => {
    if (onlyRecurring) setTab("recipients");
  }, [onlyRecurring]);

  const costsFocus = costs?.focus ?? 0;
  useEffect(() => {
    if (costsFocus === 0) return;
    setTab("costs");
    document.getElementById("proposal-roster")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [costsFocus]);

  useEffect(() => {
    if (!expanded) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, [expanded]);

  const deleteRecipients = (ids: string[]) => {
    const gone = new Set(ids);
    history.commit({
      beneficiaries: draft.beneficiaries.filter((b) => !gone.has(b.id)),
      aidLines: draft.aidLines.filter((line) => !gone.has(line.beneficiaryId)),
    });
  };
  const recipientDeleteImpact = (ids: string[]) => {
    const gone = new Set(ids);
    const lines = draft.aidLines.filter((line) => gone.has(line.beneficiaryId)).length;
    return lines > 0 ? `Juga menghapus ${lines} rincian bantuan milik penerima ini.` : null;
  };

  const gridProps = (key: Tab) => ({
    readOnly: !editable,
    query: queries[key],
    onQueryChange: (query: string) => setQueries((q) => ({ ...q, [key]: query })),
    onlyIssues: onlyIssues[key],
    onOnlyIssuesChange: (only: boolean) => setOnlyIssues((o) => ({ ...o, [key]: only })),
    onUndo: history.undo,
    onRedo: history.redo,
    fill: expanded,
  });

  const content = (
    <div
      ref={wrapperRef}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (expanded && event.key === "Escape" && !event.defaultPrevented && target.tagName !== "INPUT" && wrapperRef.current?.contains(target)) {
          setExpanded(false);
        }
      }}
      className={expanded ? "fixed inset-0 z-50 flex flex-col gap-3 bg-stone-50 p-4" : "space-y-3"}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded || undefined}
      aria-label={expanded ? "Daftar penerima dan rincian bantuan (layar penuh)" : undefined}
    >
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className={expanded ? "flex min-h-0 flex-1 flex-col gap-3" : "space-y-3"}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="recipients">Penerima ({draft.beneficiaries.length})</TabsTrigger>
            <TabsTrigger value="aidLines">Rincian bantuan ({draft.aidLines.length})</TabsTrigger>
            {costs && <TabsTrigger value="costs">Biaya operasional</TabsTrigger>}
          </TabsList>
          <div className="flex flex-wrap items-center gap-2">
            {onOpenImport && editable && tab !== "costs" && (
              <Button type="button" variant="outline" size="sm" onClick={onOpenImport} className="text-xs">
                <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                Impor XLSX / CSV
              </Button>
            )}
            {onExport && draft.beneficiaries.length > 0 && tab !== "costs" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onExport("xlsx")}
                title="Mengekspor daftar penerima versi tersimpan, lengkap dengan ID stabil untuk diunggah ulang"
                className="text-xs"
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Ekspor daftar penerima
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setExpanded((open) => !open)}
              className="hidden text-xs md:inline-flex"
              title={expanded ? "Kembali ke tampilan biasa (Esc)" : "Buka tabel di layar penuh"}
            >
              {expanded ? <Minimize2 className="mr-1.5 h-3.5 w-3.5" /> : <Maximize2 className="mr-1.5 h-3.5 w-3.5" />}
              {expanded ? "Perkecil" : "Perluas"}
            </Button>
          </div>
        </div>

        <TabsContent value="recipients" className={expanded ? "mt-0 flex min-h-0 flex-1 flex-col" : "mt-0"}>
          <div className={expanded ? "flex min-h-0 flex-1 flex-col" : "hidden md:block"}>
            <SpreadsheetGrid<Beneficiary>
              label="Daftar penerima"
              itemLabel="penerima"
              rows={draft.beneficiaries}
              rowId={idOf}
              columns={beneficiaryColumns}
              createRow={newBeneficiary}
              onRowsChange={(beneficiaries) => history.commit({ beneficiaries })}
              onDeleteRows={deleteRecipients}
              deleteImpact={recipientDeleteImpact}
              serverIssues={recipientIssues}
              flags={recurring?.flags}
              flagFilter={recurring && { label: "Hanya penerima berulang", active: recurring.only, onChange: recurring.onOnlyChange }}
              {...gridProps("recipients")}
            />
          </div>
          {!expanded && (
            <MobileRecipients draft={draft} commit={history.commit} readOnly={!editable} query={queries.recipients}
              onQueryChange={gridProps("recipients").onQueryChange} />
          )}
        </TabsContent>

        <TabsContent value="aidLines" className={expanded ? "mt-0 flex min-h-0 flex-1 flex-col" : "mt-0"}>
          <div className={expanded ? "flex min-h-0 flex-1 flex-col" : "hidden md:block"}>
            <SpreadsheetGrid<AidLine>
              label="Rincian bantuan"
              itemLabel="rincian bantuan"
              rows={draft.aidLines}
              rowId={idOf}
              columns={aidColumns}
              createRow={() => newAidLine("")}
              onRowsChange={(aidLines) => history.commit({ aidLines })}
              onDeleteRows={(ids) => {
                const gone = new Set(ids);
                history.commit({ aidLines: draft.aidLines.filter((line) => !gone.has(line.id)) });
              }}
              serverIssues={aidLineIssues}
              {...gridProps("aidLines")}
            />
          </div>
          {!expanded && (
            <MobileAidLines draft={draft} columns={aidColumns} commit={history.commit} readOnly={!editable} query={queries.aidLines}
              onQueryChange={gridProps("aidLines").onQueryChange} />
          )}
        </TabsContent>
        {costs && (
          <TabsContent value="costs" className={expanded ? "mt-0 flex min-h-0 flex-1 flex-col" : "mt-0"}>
            {costs.render(expanded)}
          </TabsContent>
        )}
      </Tabs>
      {expanded && saveControl && <div className="flex flex-wrap items-center justify-end gap-3 border-t border-stone-200 pt-3">{saveControl}</div>}
    </div>
  );

  return (
    <section id="proposal-roster" aria-label="Penerima dan rincian bantuan" className="scroll-mt-4">
      <h3 className="mb-2 text-sm font-semibold text-stone-900">Penerima dan rincian bantuan{costs ? ", biaya operasional" : ""}</h3>
      {expanded ? createPortal(content, document.body) : content}
    </section>
  );
}

const matches = <R,>(row: R, columns: GridColumn<R>[], needle: string) =>
  !needle || columns.some((column) => column.value(row).toLowerCase().includes(needle));

function MobileSearch({ query, onQueryChange, label }: { query: string; onQueryChange: (query: string) => void; label: string }) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Cari di semua kolom…"
        className="w-full rounded-lg border border-stone-300 bg-white py-2 pl-8 pr-2 text-sm"
      />
    </label>
  );
}

/** Phones keep the card editor; a wide spreadsheet is not workable on a small screen. */
function MobileRecipients({ draft, commit, readOnly, query, onQueryChange }: {
  draft: ProposalDraft; commit: (next: Partial<Roster>) => void; readOnly: boolean; query: string; onQueryChange: (query: string) => void;
}) {
  const needle = query.trim().toLowerCase();
  const shown = draft.beneficiaries.flatMap((item, index) => (matches(item, beneficiaryColumns, needle) ? [{ item, index }] : []));
  const pager = usePage(shown.length, LIST_PAGE_SIZE);
  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-3 md:hidden">
      <MobileSearch query={query} onQueryChange={onQueryChange} label="Cari penerima" />
      {needle && <p className="text-xs text-stone-500">{shown.length} dari {draft.beneficiaries.length} penerima</p>}
      {pageOf(shown, pager.page).map(({ item: { item: b, index: i } }) => (
        <BeneficiaryCard
          key={b.id}
          beneficiary={b}
          index={i}
          issues={draft.issues}
          onChange={(next) => commit({ beneficiaries: draft.beneficiaries.map((row, j) => (j === i ? next : row)) })}
          onRemove={() => commit({
            beneficiaries: draft.beneficiaries.filter((_, j) => j !== i),
            aidLines: draft.aidLines.filter((line) => line.beneficiaryId !== b.id),
          })}
        />
      ))}
      <Pager label="Penerima" page={pager.page} pageCount={pager.pageCount} onChange={pager.setPage} />
      {!readOnly && (
        <Button type="button" variant="outline" size="sm" onClick={() => commit({ beneficiaries: [...draft.beneficiaries, newBeneficiary()] })}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Tambah penerima
        </Button>
      )}
    </fieldset>
  );
}

function MobileAidLines({ draft, columns, commit, readOnly, query, onQueryChange }: {
  draft: ProposalDraft; columns: GridColumn<AidLine>[]; commit: (next: Partial<Roster>) => void; readOnly: boolean; query: string; onQueryChange: (query: string) => void;
}) {
  const needle = query.trim().toLowerCase();
  const shown = draft.aidLines.flatMap((item, index) => (matches(item, columns, needle) ? [{ item, index }] : []));
  const pager = usePage(shown.length, LIST_PAGE_SIZE);
  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-2 md:hidden">
      <MobileSearch query={query} onQueryChange={onQueryChange} label="Cari rincian bantuan" />
      {needle && <p className="text-xs text-stone-500">{shown.length} dari {draft.aidLines.length} rincian</p>}
      {pageOf(shown, pager.page).map(({ item: { item: line, index: i } }) => (
        <AidLineRow
          key={line.id}
          line={line}
          index={i}
          beneficiaries={draft.beneficiaries}
          issues={draft.issues}
          onChange={(next) => commit({ aidLines: draft.aidLines.map((row, j) => (j === i ? next : row)) })}
          onRemove={() => commit({ aidLines: draft.aidLines.filter((_, j) => j !== i) })}
        />
      ))}
      <Pager label="Rincian bantuan" page={pager.page} pageCount={pager.pageCount} onChange={pager.setPage} />
      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={draft.beneficiaries.length === 0}
          onClick={() => commit({ aidLines: [...draft.aidLines, newAidLine(draft.beneficiaries[0]?.id ?? "")] })}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Tambah rincian
        </Button>
      )}
    </fieldset>
  );
}

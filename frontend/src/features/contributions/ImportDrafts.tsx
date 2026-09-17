import { Check, Eye, FileSpreadsheet } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { formatNominal, type ContributionImportDraft, type TabularRow } from "./contributionClient";
import { ImportRowsTable, ImportTotals } from "./ImportRowsTable";

export type OpenedDraft = { draft: ContributionImportDraft; rows: TabularRow[] };

type DraftActions = {
  canManage: boolean;
  onCommit: (draftId: string) => void;
  onDiscard: (draftId: string) => void;
};

function DraftButtons({ draft, canManage, onCommit, onDiscard, commitLabel, discardLabel }: DraftActions & {
  draft: ContributionImportDraft;
  commitLabel: string;
  discardLabel: string;
}) {
  if (!canManage || draft.status !== "DRAFT") return null;
  return (
    <>
      <Button size="sm" onClick={() => onCommit(draft.id)} className="text-xs px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800">
        <Check className="w-3.5 h-3.5 mr-1" />
        {commitLabel}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onDiscard(draft.id)}
        className="text-xs px-2.5 py-1 text-rose-700 hover:bg-rose-50 border-rose-200"
      >
        {discardLabel}
      </Button>
    </>
  );
}

export function ImportDraftList({ drafts, onOpen, ...actions }: DraftActions & {
  drafts: ContributionImportDraft[];
  onOpen: (draftId: string) => void;
}) {
  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-4">
        <h3 className="text-sm font-semibold text-stone-900">Draf Impor Spreadsheet Tersimpan</h3>
        <p className="mt-1 text-xs text-stone-600">
          Draf impor menyimpan pratinjau tabular tanpa mencatat penerimaan kas lembaga. Draf dapat diperiksa kembali atau
          dikomit untuk menghasilkan kontribusi berstatus DITERIMA.
        </p>
      </div>

      {drafts.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-stone-300 rounded-xl bg-stone-50/50">
          <FileSpreadsheet className="mx-auto h-8 w-8 text-stone-400" />
          <h4 className="mt-2 text-sm font-semibold text-stone-900">Belum ada draf impor</h4>
          <p className="mt-1 text-xs text-stone-500">Unggah berkas spreadsheet pada tab "Impor Tabular" untuk menyimpan draf.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200">
          <table className="w-full text-left text-sm text-stone-700">
            <thead className="bg-stone-50 text-xs font-semibold uppercase text-stone-500 border-b border-stone-200">
              <tr>
                <th className="px-4 py-3">Nama Berkas</th>
                <th className="px-4 py-3">Status Draf</th>
                <th className="px-4 py-3">Baris Valid / Total</th>
                <th className="px-4 py-3">Total Nominal Valid</th>
                <th className="px-4 py-3">Waktu Simpan</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {drafts.map((d) => (
                <tr key={d.id} className="hover:bg-stone-50/70">
                  <td className="px-4 py-3 font-semibold text-stone-900 font-mono text-xs">{d.fileName}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-medium ${
                        d.status === "COMMITTED"
                          ? "bg-emerald-100 text-emerald-800"
                          : d.status === "DISCARDED"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {d.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className="text-emerald-700 font-semibold">{d.validRowsCount}</span> / {d.rawRowsCount}
                  </td>
                  <td className="px-4 py-3 font-semibold text-stone-900 text-xs">
                    {formatNominal(d.totalValidAmount, d.currencyUnit)}
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-500">{new Date(d.createdAt * 1000).toLocaleString("id-ID")}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => onOpen(d.id)} className="text-xs px-2.5 py-1">
                        <Eye className="w-3.5 h-3.5 mr-1" />
                        Periksa
                      </Button>
                      <DraftButtons draft={d} {...actions} commitLabel="Komit" discardLabel="Buang" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ImportDraftModal({ opened, onClose, ...actions }: DraftActions & {
  opened: OpenedDraft;
  onClose: () => void;
}) {
  const { draft } = opened;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Draf impor ${draft.fileName}`}
        className="bg-white rounded-2xl max-w-4xl w-full p-6 max-h-[90vh] overflow-y-auto space-y-5 shadow-xl border border-stone-200"
      >
        <div className="flex items-start justify-between border-b border-stone-200 pb-3">
          <div>
            <h3 className="text-base font-bold text-stone-900 flex items-center gap-1.5">
              <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
              <span>Draf Impor: {draft.fileName}</span>
            </h3>
            <div className="mt-1 flex items-center gap-3 text-xs text-stone-500">
              <span>ID: {draft.id}</span>
              <span>Mata Uang: {draft.currencyUnit}</span>
              <span>Status: {draft.status}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 font-bold p-1 text-lg" aria-label="Tutup">
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-stone-50 border border-stone-200 text-xs">
          <ImportTotals
            totalRows={draft.rawRowsCount}
            validRowsCount={draft.validRowsCount}
            invalidRowsCount={draft.invalidRowsCount}
            totalValidAmount={draft.totalValidAmount}
            currencyUnit={draft.currencyUnit}
          />
          <div className="flex items-center gap-2">
            <DraftButtons draft={draft} {...actions} commitLabel="Komit Baris Valid" discardLabel="Buang Draf" />
          </div>
        </div>

        <ImportRowsTable rows={opened.rows} currencyUnit={draft.currencyUnit} />

        <div className="flex justify-end pt-3 border-t border-stone-200">
          <Button variant="outline" onClick={onClose}>
            Tutup
          </Button>
        </div>
      </div>
    </div>
  );
}

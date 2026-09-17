import { Check, X } from "lucide-react";
import { channelLabel, formatNominal, fundTypeLabel, type CurrencyUnit, type TabularRow } from "./contributionClient";
import { rawCell } from "./contributionUi";

/** Every row of an import, valid or not, with its issues beside it; shared by the preview and a saved draft. */
export function ImportRowsTable({ rows, currencyUnit }: { rows: TabularRow[]; currencyUnit: CurrencyUnit }) {
  return (
    <div className="max-h-96 overflow-y-auto rounded-xl border border-stone-200">
      <table className="w-full text-left text-xs">
        <thead className="bg-stone-100 text-stone-600 sticky top-0 border-b border-stone-200">
          <tr>
            <th className="px-3 py-2">Baris</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Referensi</th>
            <th className="px-3 py-2">Kanal</th>
            <th className="px-3 py-2">Nominal</th>
            <th className="px-3 py-2">Jenis Dana</th>
            <th className="px-3 py-2">Catatan Masalah</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-200 bg-white">
          {rows.map((row) => (
            <tr key={row.rowNumber} className={row.isValid ? "hover:bg-stone-50" : "bg-red-50/40 hover:bg-red-50/70"}>
              <td className="px-3 py-2 font-mono">{row.rowNumber}</td>
              <td className="px-3 py-2">
                {row.isValid ? (
                  <span className="inline-flex items-center text-emerald-700 font-semibold gap-1">
                    <Check className="w-3.5 h-3.5" /> Valid
                  </span>
                ) : (
                  <span className="inline-flex items-center text-rose-700 font-semibold gap-1">
                    <X className="w-3.5 h-3.5" /> Gagal
                  </span>
                )}
              </td>
              <td className="px-3 py-2 font-mono">
                {row.contribution?.sourceReference || rawCell(row, "referensi_sumber", "referensi", "no_referensi", "ref")}
              </td>
              <td className="px-3 py-2">
                {row.contribution
                  ? channelLabel(row.contribution.sourceChannel)
                  : rawCell(row, "sumber_kanal", "kanal", "channel", "metode")}
              </td>
              <td className="px-3 py-2 font-mono">
                {row.contribution
                  ? formatNominal(row.contribution.amountExact, currencyUnit)
                  : rawCell(row, "nominal", "jumlah", "amount")}
              </td>
              <td className="px-3 py-2">
                {row.contribution
                  ? fundTypeLabel(row.contribution.fundType)
                  : rawCell(row, "jenis_dana", "dana", "kategori_dana")}
              </td>
              <td className="px-3 py-2 text-rose-700">
                {row.issues.length > 0
                  ? row.issues.map((issue, i) => (
                      <div key={i}>
                        [{issue.column || "baris"}]: {issue.message}
                      </div>
                    ))
                  : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ImportTotals({
  totalRows,
  validRowsCount,
  invalidRowsCount,
  totalValidAmount,
  currencyUnit,
}: {
  totalRows: number;
  validRowsCount: number;
  invalidRowsCount: number;
  totalValidAmount: string;
  currencyUnit: CurrencyUnit;
}) {
  return (
    <div className="flex items-center gap-6">
      <div>
        <span className="text-xs text-stone-500">Total Baris</span>
        <div className="text-base font-bold text-stone-900">{totalRows}</div>
      </div>
      <div>
        <span className="text-xs text-emerald-700">Baris Valid</span>
        <div className="text-base font-bold text-emerald-700">{validRowsCount}</div>
      </div>
      <div>
        <span className="text-xs text-rose-700">Baris Tidak Valid</span>
        <div className="text-base font-bold text-rose-700">{invalidRowsCount}</div>
      </div>
      <div>
        <span className="text-xs text-stone-500">Total Nominal Valid (Parsial)</span>
        <div className="text-base font-bold text-stone-900">{formatNominal(totalValidAmount, currencyUnit)}</div>
      </div>
    </div>
  );
}

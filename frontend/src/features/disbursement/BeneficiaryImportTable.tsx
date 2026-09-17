import { useRef, useState, type KeyboardEvent } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { formatIdrAmount } from "../workspace/mandateLabels";
import type { BeneficiaryRowPreview } from "./disbursementClient";

const aidOf = (row: BeneficiaryRowPreview) => {
  const line = row.aidLine;
  if (!line) return row.cells.nilai_idr || row.cells.jumlah_barang || "-";
  return line.value.kind === "MONEY"
    ? `${line.aidType} · ${formatIdrAmount(line.value.amountRequestedIdr)}`
    : `${line.aidType} · ${line.value.quantityRequested} ${line.value.unit}`;
};

const identityOf = (row: BeneficiaryRowPreview) => {
  const basis = row.beneficiary?.identityBasis;
  if (!basis) return row.cells.nik || row.cells.keterangan_identitas || "-";
  return basis.kind === "NIK" ? basis.value : basis.description;
};

function RowStatus({ row }: { row: BeneficiaryRowPreview }) {
  if (!row.isValid) return <span className="inline-flex items-center gap-1 font-semibold text-rose-700"><AlertCircle className="h-3.5 w-3.5" /> Salah</span>;
  if (row.issues.length > 0) return <span className="inline-flex items-center gap-1 font-semibold text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> Telaah</span>;
  return <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Sah</span>;
}

/**
 * Every row of the file. Rows with problems are focusable; the buttons, or
 * arrow up/down while such a row has focus, move between problems only.
 */
export function BeneficiaryImportTable({ rows }: { rows: BeneficiaryRowPreview[] }) {
  const problemRows = rows.filter((row) => row.issues.length > 0);
  const [current, setCurrent] = useState(-1);
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());

  function focusProblem(index: number) {
    if (problemRows.length === 0) return;
    const next = (index + problemRows.length) % problemRows.length;
    setCurrent(next);
    const element = rowRefs.current.get(problemRows[next].rowNumber);
    element?.focus();
    element?.scrollIntoView?.({ block: "nearest" });
  }

  function onRowKeyDown(event: KeyboardEvent, rowNumber: number) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const index = problemRows.findIndex((row) => row.rowNumber === rowNumber);
    focusProblem(index + (event.key === "ArrowDown" ? 1 : -1));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-xs font-bold uppercase tracking-wider text-stone-600">Pratinjau Seluruh Baris ({rows.length})</h5>
        {problemRows.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span aria-live="polite">{current >= 0 ? `Masalah ${current + 1} dari ${problemRows.length}` : `${problemRows.length} baris perlu diperiksa`}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => focusProblem(current - 1)}>
              <ChevronUp className="mr-1 h-3.5 w-3.5" /> Masalah sebelumnya
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => focusProblem(current + 1)}>
              <ChevronDown className="mr-1 h-3.5 w-3.5" /> Masalah berikutnya
            </Button>
          </div>
        )}
      </div>
      <div className="max-h-64 overflow-y-auto rounded-xl border border-stone-200 text-xs">
        <table className="w-full border-collapse text-left" aria-label="Tabel pratinjau daftar penerima">
          <thead className="sticky top-0 border-b border-stone-200 bg-stone-100 font-semibold text-stone-600">
            <tr>
              <th className="w-12 p-2 text-center">Baris</th>
              <th className="w-20 p-2">Status</th>
              <th className="p-2">Nama Penerima</th>
              <th className="p-2">Identitas</th>
              <th className="p-2">Asnaf</th>
              <th className="p-2">Bantuan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((row) => {
              const hasIssues = row.issues.length > 0;
              return (
                <tr
                  key={row.rowNumber}
                  ref={(element) => { if (element) rowRefs.current.set(row.rowNumber, element); else rowRefs.current.delete(row.rowNumber); }}
                  tabIndex={hasIssues ? 0 : undefined}
                  aria-label={hasIssues ? `Baris ${row.rowNumber}: ${row.issues.map((issue) => issue.message).join(" ")}` : undefined}
                  onKeyDown={hasIssues ? (event) => onRowKeyDown(event, row.rowNumber) : undefined}
                  onFocus={hasIssues ? () => setCurrent(problemRows.indexOf(row)) : undefined}
                  className={`${row.isValid ? "hover:bg-stone-50" : "bg-rose-50/60 hover:bg-rose-50"} focus:outline-2 focus:outline-emerald-600`}
                >
                  <td className="p-2 text-center font-mono text-stone-500">{row.rowNumber}</td>
                  <td className="p-2 text-[11px]"><RowStatus row={row} /></td>
                  <td className="p-2 font-medium text-stone-900">
                    {row.cells.nama || <span className="italic text-stone-400">(kosong)</span>}
                    {hasIssues && (
                      <ul className="mt-1 space-y-0.5 text-[11px] font-medium">
                        {row.issues.map((issue, index) => (
                          <li key={index} className={issue.isWarning ? "text-amber-700" : "text-rose-700"}>{issue.message}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="p-2 font-mono text-stone-700">{identityOf(row)}</td>
                  <td className="p-2 text-stone-700">{row.beneficiary?.asnaf || row.cells.asnaf || "-"}</td>
                  <td className="p-2 text-stone-700">{aidOf(row)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { AlertCircle, AlertTriangle } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { formatIdrAmount } from "../workspace/mandateLabels";
import type { BeneficiaryImportPreviewResult } from "./disbursementClient";

function Stat({ value, label, tone = "neutral" }: { value: number; label: string; tone?: "neutral" | "good" | "bad" }) {
  const styles = {
    neutral: "border-stone-200 bg-stone-50 text-stone-900",
    good: "border-emerald-200 bg-emerald-50/50 text-emerald-800",
    bad: "border-rose-300 bg-rose-50/70 text-rose-800",
  }[tone];
  return (
    <div className={`rounded-xl border p-3 ${styles}`}>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-[11px] font-medium">{label}</div>
    </div>
  );
}

/** Counts, totals per unit, the form data shared into every row, and file-level problems. */
export function BeneficiaryImportSummary({ preview }: { preview: BeneficiaryImportPreviewResult }) {
  const fileProblems = [
    ...preview.fileIssues.map((issue) => issue.message),
    ...preview.issues.filter((issue) => issue.scope === "file").map((issue) => issue.message),
  ];
  const totals = Object.entries(preview.totalsByUnit);

  return (
    <div className="space-y-4 border-t border-stone-200 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-stone-900">
          Hasil Pembacaan: <span className="font-mono font-normal text-stone-700">{preview.fileName}</span>
        </h4>
        {preview.isPartial && (
          <Badge variant="warning" className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Total Parsial (Belum Lengkap)
          </Badge>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-2 rounded-xl border border-stone-200 bg-white p-3 text-xs sm:grid-cols-2">
        <div><dt className="text-stone-500">Program (dari form)</dt><dd className="font-medium text-stone-900">{preview.sharedContext.programName ?? "Belum dipilih"}</dd></div>
        <div><dt className="text-stone-500">Periode bantuan bersama (dipakai bila kolom periode kosong)</dt><dd className="font-medium text-stone-900">{preview.sharedContext.aidPeriod ?? "Belum diisi pada form"}</dd></div>
      </dl>

      {fileProblems.length > 0 && (
        <div role="alert" className="space-y-1 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <p className="flex items-center gap-1.5 font-bold"><AlertCircle className="h-4 w-4" /> Masalah berkas (impor belum dapat diterapkan)</p>
          <ul className="list-disc space-y-0.5 pl-5">{fileProblems.map((message, index) => <li key={index}>{message}</li>)}</ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
        <Stat value={preview.uniqueBeneficiaryCount} label="Penerima Unik" />
        <Stat value={preview.aidLineCount} label="Rincian Bantuan" />
        <Stat value={preview.validRowsCount} label="Baris Valid" tone="good" />
        <Stat value={preview.invalidRowsCount} label="Baris Salah" tone={preview.invalidRowsCount > 0 ? "bad" : "neutral"} />
      </div>

      <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs">
        <p className="mb-1 font-semibold text-stone-700">{preview.isPartial ? "Total Sementara Menurut Unit:" : "Total Menurut Unit:"}</p>
        <ul className="flex flex-wrap gap-3">
          {totals.map(([unit, total]) => (
            <li key={unit} className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1 font-mono">
              <span className="font-semibold text-stone-900">{unit}:</span>
              <span>{unit === "IDR" ? formatIdrAmount(total) : total}</span>
            </li>
          ))}
          {totals.length === 0 && <li className="italic text-stone-400">Belum ada total yang dapat dihitung.</li>}
        </ul>
        {preview.isPartial && (
          <p className="mt-2 text-[11px] text-amber-800">
            * Total ini parsial karena ada baris keliru, masalah berkas, atau bantuan barang tanpa taksiran rupiah. Angka yang salah tidak diubah menjadi nol.
          </p>
        )}
      </div>
    </div>
  );
}

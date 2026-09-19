import { Sparkles } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { BALANCE_SHEET_LABELS } from "./format";
import type { ReportingPeriod } from "./types";

export type BalanceSheetScope = "ALL" | "ON" | "OFF";

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3];

const SCOPE_LABELS: Record<BalanceSheetScope, string> = {
  ALL: "Keduanya (direkonsiliasi terpisah)",
  ON: BALANCE_SHEET_LABELS.ON,
  OFF: BALANCE_SHEET_LABELS.OFF,
};

const fieldClass =
  "mt-1.5 rounded-xl border border-[#dbe7dd] bg-[#f9fbf9] px-3 py-2 text-sm text-[#17332c] outline-none focus:border-[#1b765e]";
const labelClass = "block text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]";

interface ReconciliationControlsProps {
  periodKind: ReportingPeriod["kind"];
  onPeriodKindChange: (kind: ReportingPeriod["kind"]) => void;
  year: number;
  onYearChange: (year: number) => void;
  scope: BalanceSheetScope;
  onScopeChange: (scope: BalanceSheetScope) => void;
  onLoadDemo: () => void;
}

export function ReconciliationControls({
  periodKind,
  onPeriodKindChange,
  year,
  onYearChange,
  scope,
  onScopeChange,
  onLoadDemo,
}: ReconciliationControlsProps) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-[#dbe7dd] bg-white p-5 shadow-xs sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className={labelClass}>Periode pelaporan</label>
          <select
            value={periodKind}
            onChange={(event) => onPeriodKindChange(event.target.value as ReportingPeriod["kind"])}
            className={fieldClass}
          >
            <option value="SEMESTER">Semester (1 Januari-30 Juni)</option>
            <option value="AKHIR_TAHUN">Akhir tahun (1 Januari-31 Desember)</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Tahun</label>
          <select
            value={year}
            onChange={(event) => onYearChange(Number(event.target.value))}
            className={fieldClass}
          >
            {YEAR_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Posisi neraca</label>
          <select
            value={scope}
            onChange={(event) => onScopeChange(event.target.value as BalanceSheetScope)}
            className={fieldClass}
          >
            {(Object.keys(SCOPE_LABELS) as BalanceSheetScope[]).map((value) => (
              <option key={value} value={value}>
                {SCOPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onLoadDemo} type="button">
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          Muat contoh LPZN 2024
        </Button>
        <a
          href="/contoh/lpzn-2024-tabel-2-2-per-jenis-dana.csv"
          download
          className="text-[11px] font-semibold text-[#1b765e] underline underline-offset-2 hover:text-[#17332c]"
        >
          Berkas contoh (Tabel 2.2)
        </a>
        <a
          href="/contoh/lpzn-2024-tabel-2-3-per-jenis-pengelola-zakat.csv"
          download
          className="text-[11px] font-semibold text-[#1b765e] underline underline-offset-2 hover:text-[#17332c]"
        >
          Berkas contoh (Tabel 2.3)
        </a>
      </div>
    </div>
  );
}

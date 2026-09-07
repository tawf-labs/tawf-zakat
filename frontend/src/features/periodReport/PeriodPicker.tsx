import { FileText, Sparkles } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { ReportingPeriod } from "./types";

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3];

const fieldClass =
  "mt-1.5 rounded-xl border border-[#dbe7dd] bg-[#f9fbf9] px-3 py-2 text-sm text-[#17332c] outline-none focus:border-[#1b765e]";
const labelClass = "block text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]";

interface PeriodPickerProps {
  period: ReportingPeriod;
  onPeriodChange: (period: ReportingPeriod) => void;
  onLoadFigures: () => void;
  onDraft: () => void;
  isLoadingFigures: boolean;
  isDrafting: boolean;
}

export function PeriodPicker({
  period,
  onPeriodChange,
  onLoadFigures,
  onDraft,
  isLoadingFigures,
  isDrafting,
}: PeriodPickerProps) {
  const busy = isLoadingFigures || isDrafting;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-[#dbe7dd] bg-white p-5 shadow-xs sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className={labelClass} htmlFor="period-kind">
            Periode pelaporan
          </label>
          <select
            id="period-kind"
            value={period.kind}
            onChange={(event) =>
              onPeriodChange({ ...period, kind: event.target.value as ReportingPeriod["kind"] })
            }
            className={fieldClass}
          >
            <option value="SEMESTER">Semester I (1 Januari-30 Juni)</option>
            <option value="AKHIR_TAHUN">Akhir Tahun (1 Januari-31 Desember)</option>
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="period-year">
            Tahun
          </label>
          <select
            id="period-year"
            value={period.year}
            onChange={(event) => onPeriodChange({ ...period, year: Number(event.target.value) })}
            className={fieldClass}
          >
            {YEAR_OPTIONS.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onLoadFigures} disabled={busy}>
          <FileText className="mr-2 h-3.5 w-3.5" />
          {isLoadingFigures ? "Menghitung..." : "Hitung angka periode"}
        </Button>
        <Button onClick={onDraft} disabled={busy}>
          <Sparkles className="mr-2 h-3.5 w-3.5" />
          {isDrafting ? "Menyusun narasi..." : "Susunkan narasinya"}
        </Button>
      </div>
    </div>
  );
}

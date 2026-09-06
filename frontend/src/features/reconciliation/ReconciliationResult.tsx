import React from "react";
import { Badge } from "../../components/ui/Badge";
import { ReconciliationSummary } from "./ReconciliationSummary";
import { DiscrepancyFilterBar } from "./DiscrepancyFilterBar";
import { DiscrepancyTable } from "./DiscrepancyTable";
import { BALANCE_SHEET_LABELS } from "./format";
import {
  bucketsInReport,
  filterDiscrepancies,
  hasActiveFilters,
  kindsInReport,
  type DiscrepancyFilters,
} from "./reconciliationTools";
import { isEntryLevelKind, type BalanceSheetPosition, type ReconciliationReport } from "./types";

interface ReconciliationResultProps {
  report: ReconciliationReport;
  /** Set when this block covers one balance sheet position on its own. */
  position: BalanceSheetPosition | null;
  filters: DiscrepancyFilters;
  onFiltersChange: (filters: DiscrepancyFilters) => void;
  onExport: () => void;
}

export function ReconciliationResult({
  report,
  position,
  filters,
  onFiltersChange,
  onExport,
}: ReconciliationResultProps) {
  const visible = filterDiscrepancies(report.discrepancies, filters);
  const entryGaps = visible.filter((d) => isEntryLevelKind(d.kind));
  const totalFindings = visible.filter((d) => !isEntryLevelKind(d.kind));
  const filtered = hasActiveFilters(filters);

  return (
    <div className="space-y-6">
      {position && (
        <div className="flex items-center gap-2">
          <Badge variant="info">{BALANCE_SHEET_LABELS[position]}</Badge>
          <span className="text-xs text-[#5e7a70]">
            Direkonsiliasi terpisah dari posisi neraca lainnya.
          </span>
        </div>
      )}

      <ReconciliationSummary
        report={report}
        visibleEntryGaps={entryGaps}
        totalFindingCount={totalFindings.length}
        filtered={filtered}
      />

      {report.discrepancies.length > 0 && (
        <>
          <DiscrepancyFilterBar
            buckets={bucketsInReport(report)}
            kinds={kindsInReport(report)}
            filters={filters}
            onFiltersChange={onFiltersChange}
            shownCount={visible.length}
            totalCount={report.discrepancies.length}
            onExport={onExport}
          />

          <section className="space-y-3">
            <h3 className="font-serif text-xl font-bold text-[#17332c]">
              Rincian selisih per entri
            </h3>
            <p className="text-sm text-[#5e7a70]">
              Terurut dari selisih terbesar. Setiap baris menunjuk Pengelola Zakat, jenis dana, dan
              nilai rupiahnya - itulah yang menentukan kabupaten mana yang perlu dihubungi.
            </p>
            <DiscrepancyTable
              discrepancies={entryGaps}
              claimLabel={report.claimLabel}
              sourceLabel={report.sourceLabel}
              emptyMessage={
                filtered
                  ? "Tidak ada selisih per entri yang cocok dengan filter yang aktif."
                  : "Tidak ada selisih per entri."
              }
            />
          </section>

          {totalFindings.length > 0 && (
            <section className="space-y-3">
              <h3 className="font-serif text-xl font-bold text-[#17332c]">
                Selisih pada total yang dideklarasikan
              </h3>
              <p className="text-sm text-[#5e7a70]">
                Perbandingan grand total yang dicetak kedua laporan, dan penjumlahan di dalam satu
                laporan yang tidak konsisten dengan rinciannya sendiri.
              </p>
              <DiscrepancyTable
                discrepancies={totalFindings}
                claimLabel="Nilai klaim"
                sourceLabel="Nilai sumber"
                emptyMessage="Semua total konsisten."
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}

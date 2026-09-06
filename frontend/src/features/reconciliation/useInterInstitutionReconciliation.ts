import { useMemo, useState } from "react";
import { bucketsUsed, parseLedgerText, type LedgerTextResult } from "./ledgerText";
import {
  runInterInstitutionReconciliation,
  ReconciliationRequestError,
} from "./reconciliationClient";
import { downloadCsv } from "./download";
import {
  exportFileName,
  filterDiscrepancies,
  hasActiveFilters,
  toCsv,
  EMPTY_FILTERS,
  type DiscrepancyFilters,
} from "./reconciliationTools";
import type { BalanceSheetScope } from "./ReconciliationControls";
import type { LedgerSideDraft } from "./LedgerSideEditor";
import {
  LPZN_2024_CLAIM_LABEL,
  LPZN_2024_CLAIM_TEXT,
  LPZN_2024_SOURCE_LABEL,
  LPZN_2024_SOURCE_TEXT,
} from "./lpznDemo";
import type { BalanceSheetPosition, ReconciliationReport, ReportingPeriod } from "./types";

export type ResultBlock = { position: BalanceSheetPosition | null; report: ReconciliationReport };

const emptyDraft = (label: string): LedgerSideDraft => ({
  label,
  text: "",
  dimension: "JENIS_DANA",
});

const rowCount = (parsed: LedgerTextResult) =>
  parsed.side.entries.length + (parsed.side.declaredTotals?.length ?? 0);

/**
 * Holds everything the antar-lembaga workbench does, leaving the component to
 * lay it out: the two drafts, how they parse, running the reconciliation, and
 * getting a result back out as a file.
 */
export function useInterInstitutionReconciliation() {
  const [periodKind, setPeriodKind] = useState<ReportingPeriod["kind"]>("AKHIR_TAHUN");
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [scope, setScope] = useState<BalanceSheetScope>("ALL");

  const [claimDraft, setClaimDraft] = useState(emptyDraft("Rekap Laporan Zakat Wilayah"));
  const [sourceDraft, setSourceDraft] = useState(emptyDraft("Laporan Kinerja Pengelola Zakat"));

  const [results, setResults] = useState<ResultBlock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [filters, setFilters] = useState<DiscrepancyFilters>(EMPTY_FILTERS);

  const claim = useMemo(
    () => parseLedgerText(claimDraft.text, claimDraft.label, claimDraft.dimension),
    [claimDraft]
  );
  const source = useMemo(
    () => parseLedgerText(sourceDraft.text, sourceDraft.label, sourceDraft.dimension),
    [sourceDraft]
  );

  const hasOffBalanceSheetRows = [claim.side, source.side].some((side) =>
    [...side.entries, ...(side.declaredTotals ?? [])].some((row) => row.balanceSheet === "OFF")
  );

  const reconcileOnce = (position: BalanceSheetPosition | null) =>
    runInterInstitutionReconciliation({
      claim: claim.side,
      source: source.side,
      options: {
        period: { kind: periodKind, year },
        // Only widen the server's strict jenis dana vocabulary when a side was
        // explicitly declared to use another dimension.
        ...(claimDraft.dimension === "BEBAS" || sourceDraft.dimension === "BEBAS"
          ? { allowedBuckets: bucketsUsed(claim.side, source.side) }
          : {}),
        ...(position ? { balanceSheet: position } : {}),
      },
    }).then((report) => ({ position, report }));

  const run = async (nextScope: BalanceSheetScope = scope) => {
    setIsRunning(true);
    setError(null);
    try {
      // On and off balance sheet are reconciled separately so a gap on one can
      // never be cancelled by a gap on the other. A single run is only safe when
      // there is nothing off the balance sheet to do the masking.
      const positions: (BalanceSheetPosition | null)[] =
        nextScope === "ALL" ? (hasOffBalanceSheetRows ? ["ON", "OFF"] : [null]) : [nextScope];

      setResults(await Promise.all(positions.map(reconcileOnce)));
      setFilters(EMPTY_FILTERS);
    } catch (caught) {
      setResults([]);
      setError(
        caught instanceof ReconciliationRequestError || caught instanceof Error
          ? caught.message
          : "Rekonsiliasi gagal dijalankan."
      );
    } finally {
      setIsRunning(false);
    }
  };

  const changeScope = (nextScope: BalanceSheetScope) => {
    setScope(nextScope);
    if (results.length > 0) void run(nextScope);
  };

  const loadLpznDemo = () => {
    setClaimDraft({
      label: LPZN_2024_CLAIM_LABEL,
      text: LPZN_2024_CLAIM_TEXT,
      dimension: "JENIS_DANA",
    });
    // Tabel 2.3 is cut per jenis Pengelola Zakat, not per jenis dana.
    setSourceDraft({
      label: LPZN_2024_SOURCE_LABEL,
      text: LPZN_2024_SOURCE_TEXT,
      dimension: "BEBAS",
    });
    setPeriodKind("AKHIR_TAHUN");
    setYear(2024);
    setResults([]);
    setError(null);
    setFilters(EMPTY_FILTERS);
  };

  const exportBlock = ({ position, report }: ResultBlock) => {
    const checkedAt = new Date();
    downloadCsv(
      exportFileName(report, checkedAt),
      toCsv({
        report,
        discrepancies: filterDiscrepancies(report.discrepancies, filters),
        balanceSheet: position,
        checkedAt,
        filtered: hasActiveFilters(filters),
      })
    );
  };

  return {
    periodKind,
    setPeriodKind,
    year,
    setYear,
    scope,
    changeScope,
    claimDraft,
    setClaimDraft,
    sourceDraft,
    setSourceDraft,
    claim,
    source,
    results,
    error,
    isRunning,
    filters,
    setFilters,
    canRun: !isRunning && rowCount(claim) > 0 && rowCount(source) > 0,
    run,
    loadLpznDemo,
    exportBlock,
  };
}

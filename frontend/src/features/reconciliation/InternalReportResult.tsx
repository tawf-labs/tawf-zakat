import { CheckCircle2 } from "lucide-react";
import { downloadCsv } from "../../lib/download";
import { AmilAssessmentPanel } from "./AmilAssessmentPanel";
import { DiscrepancyTable } from "./DiscrepancyTable";
import { formatSignedMoney } from "./format";
import { exportFileName, toCsv } from "./reconciliationTools";
import type { CurrencyUnit, InternalReconciliationResponse } from "./types";

export function InternalReportResult({ result, unit, label, checkedAt }: {
  result: InternalReconciliationResponse;
  unit: CurrencyUnit;
  label: string;
  checkedAt: Date;
}) {
  const report = result.reports[unit];
  if (!report) return null;
  const fileName = result.period ? exportFileName({ ...report, period: result.period }, checkedAt)
    : `snapshot-${checkedAt.toISOString().replace(/[:.]/g, "-")}.csv`;
  const exportReport = () => downloadCsv(`internal-${unit}-${fileName}`, toCsv({
    report, discrepancies: report.discrepancies, balanceSheet: "ON", checkedAt,
    filtered: false, ledgerScope: result,
  }));
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-serif text-lg font-bold text-[#17332c]">{label}</h4>
        {report.balanced ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />Basis data cocok dengan ledger
          </span>
        ) : <span className="font-mono text-sm font-bold text-amber-700">{formatSignedMoney(report.netDelta)}</span>}
      </div>
      <AmilAssessmentPanel report={report} onExport={exportReport} />
      <DiscrepancyTable discrepancies={report.discrepancies} claimLabel={report.claimLabel}
        sourceLabel={report.sourceLabel} emptyMessage="Setiap catatan basis data punya event on-chain yang bersesuaian, dan sebaliknya." />
    </div>
  );
}

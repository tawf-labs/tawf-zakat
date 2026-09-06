import React from "react";
import { AlertOctagon, PlayCircle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { LedgerSideEditor } from "./LedgerSideEditor";
import { LedgerFormatHelp } from "./LedgerFormatHelp";
import { ReconciliationControls } from "./ReconciliationControls";
import { ReconciliationResult } from "./ReconciliationResult";
import { InternalModePanel } from "./InternalModePanel";
import { useInterInstitutionReconciliation } from "./useInterInstitutionReconciliation";

export function ReconciliationWorkbench() {
  const workbench = useInterInstitutionReconciliation();

  return (
    <div className="space-y-8">
      <ReconciliationControls
        periodKind={workbench.periodKind}
        onPeriodKindChange={workbench.setPeriodKind}
        year={workbench.year}
        onYearChange={workbench.setYear}
        scope={workbench.scope}
        onScopeChange={workbench.changeScope}
        onLoadDemo={workbench.loadLpznDemo}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <LedgerSideEditor
          title="Rekap yang Anda susun"
          hint="Laporan Zakat Wilayah - angka yang akan Anda kirim ke BAZNAS pusat."
          draft={workbench.claimDraft}
          onDraftChange={workbench.setClaimDraft}
          parsed={workbench.claim}
        />
        <LedgerSideEditor
          title="Laporan yang mendasarinya"
          hint="Laporan Kinerja dari Pengelola Zakat kabupaten/kota di wilayah Anda."
          draft={workbench.sourceDraft}
          onDraftChange={workbench.setSourceDraft}
          parsed={workbench.source}
        />
      </div>

      <LedgerFormatHelp />

      <div className="flex justify-center">
        <Button
          size="lg"
          onClick={() => void workbench.run()}
          disabled={!workbench.canRun}
          type="button"
        >
          <PlayCircle className="mr-2 h-4 w-4" />
          {workbench.isRunning ? "Merekonsiliasi..." : "Jalankan rekonsiliasi"}
        </Button>
      </div>

      {workbench.error && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5">
          <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div>
            <p className="text-sm font-bold text-red-900">Rekonsiliasi ditolak</p>
            <p className="mt-1 text-sm leading-relaxed text-red-800">{workbench.error}</p>
          </div>
        </div>
      )}

      {workbench.results.map((block) => (
        <ReconciliationResult
          key={block.position ?? "ALL"}
          report={block.report}
          position={block.position}
          filters={workbench.filters}
          onFiltersChange={workbench.setFilters}
          onExport={() => workbench.exportBlock(block)}
        />
      ))}

      <InternalModePanel />
    </div>
  );
}

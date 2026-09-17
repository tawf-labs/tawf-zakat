import { FileSpreadsheet } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { ProposalDocument } from "./disbursementClient";
import type { RosterSource } from "./BeneficiaryImportModal";

/** Where the last imported roster file is: waiting for a draft save, or kept privately with its problems. */
export function BeneficiaryImportNotice({ pendingSource, storedRoster, onReopen }: {
  pendingSource: RosterSource | null;
  storedRoster: ProposalDocument | null;
  onReopen: () => void;
}) {
  if (!pendingSource && !storedRoster) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white p-3 text-xs text-stone-700">
      <p className="flex items-center gap-1.5">
        <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
        {pendingSource
          ? `Berkas impor "${pendingSource.fileName}" akan disimpan privat bersama draf saat draf disimpan.`
          : `Berkas impor tersimpan privat: "${storedRoster!.fileName}".`}
      </p>
      {!pendingSource && storedRoster && (
        <Button type="button" variant="outline" size="sm" onClick={onReopen}>Buka pratinjau & masalah impor</Button>
      )}
    </div>
  );
}

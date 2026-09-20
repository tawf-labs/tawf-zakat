import { Button } from "../../components/ui/Button";
import type { Batch } from "./contributionBatchTypes";

const labels: Record<string, string> = {
  DRAFT: "Draf", ENDORSED: "Disahkan", SUPERSEDED: "Digantikan", ABANDONED: "Draf digantikan",
};

export function BatchHistory({ batches, selected, busy, onSelect }: {
  batches: Batch[];
  selected: Batch;
  busy: boolean;
  onSelect: (id: string) => Promise<void>;
}) {
  if (batches.length < 2) return null;
  return <div className="border rounded-lg p-3 text-xs space-y-1 mt-3">
    <p className="font-semibold text-stone-700">Riwayat batch #{selected.batchNumber}</p>
    <ul className="space-y-1">{batches.map(batch => <li key={batch.id}
      className="flex items-center justify-between gap-2 py-1 border-b last:border-0">
      <span>v{batch.version} ({labels[batch.status] ?? batch.status})
        {batch.id === selected.id ? " — sedang ditampilkan" : ""}
        {batch.correctionReason ? ` — ${batch.correctionReason}` : ""}</span>
      {batch.id !== selected.id && <Button variant="outline" size="sm" disabled={busy}
        onClick={() => void onSelect(batch.id)}>Buka v{batch.version}</Button>}
    </li>)}</ul>
  </div>;
}

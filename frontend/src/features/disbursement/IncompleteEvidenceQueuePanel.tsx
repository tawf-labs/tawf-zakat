import { useIncompleteEvidenceQueue } from "./useRealizationQueries";
import { FileClock, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "../workspace/privateRequests";
import { formatIdrAmount } from "../workspace/mandateLabels";

/** Proposals whose reported realizations still lack the evidence their method requires. */
export function IncompleteEvidenceQueuePanel({ requests, onOpenProposal }: {
  requests: PrivateRequests;
  onOpenProposal: (proposalId: string) => void;
}) {
  const query = useIncompleteEvidenceQueue(requests);
  const queue = query.data ?? [];
  const loading = query.isFetching;
  const error = query.error?.message;

  return <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-800 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-3">
      <div className="flex items-center gap-2">
        <FileClock className="h-5 w-5 text-amber-600" />
        <div>
          <h3 className="font-bold text-stone-900">Bukti realisasi belum lengkap</h3>
          <p className="text-xs text-stone-600">Kejadian sudah memotong sisa hak; lengkapi bukti sesuai cara penyalurannya.</p>
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={loading} className="flex items-center gap-1.5"
        onClick={() => void query.refetch()}>
        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Muat ulang
      </Button>
    </div>

    {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}

    {queue.length === 0 ? <p className="rounded-xl border border-dashed border-stone-200 p-6 text-center text-stone-600">
      {loading ? "Memuat antrean…" : "Tidak ada realisasi dengan bukti belum lengkap."}
    </p> : <ul className="space-y-2">
      {queue.map((item) => <li key={item.proposalId} className="flex flex-col gap-2 rounded-xl border border-stone-200 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-stone-900">{item.purpose}</p>
          <p className="text-xs text-stone-600">
            {item.pendingCount} kejadian · {formatIdrAmount(item.totalPendingIdr)} · terlama {new Date(item.oldestPendingReportedAt * 1000).toLocaleDateString("id-ID")}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenProposal(item.proposalId)}>Buka dan lengkapi bukti</Button>
      </li>)}
    </ul>}
  </section>;
}

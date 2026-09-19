import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { listContributionAllocations } from "../activities/activityClient";
import { formatNominal, fundTypeLabel, type ContributionRecord } from "./contributionClient";
import { errorMessage } from "./contributionUi";

type Loaded = Awaited<ReturnType<typeof listContributionAllocations>>;

/** Where one contribution went: its balance and each allocation, from the same source as the activity page. */
export function ContributionAllocations({ requests, record }: { requests: PrivateRequests; record: ContributionRecord }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listContributionAllocations(requests, record.id)
      .then((data) => !cancelled && setLoaded(data))
      .catch((err) => !cancelled && setError(errorMessage(err, "Gagal memuat alokasi kontribusi.")));
    return () => {
      cancelled = true;
    };
  }, [requests, record.id, record.allocatedAmount]);

  if (record.allocatedAmount === undefined) return null;
  const unit = record.currencyUnit;
  const shortfall = record.shortfallAmount && record.shortfallAmount !== "0" ? record.shortfallAmount : null;

  return (
    <div className="space-y-3 text-xs">
      <h4 className="text-sm font-semibold text-stone-900 flex items-center gap-1.5">
        <Layers className="w-4 h-4 text-emerald-700" />
        Alokasi ke Kegiatan
      </h4>
      <div className="flex flex-wrap gap-4 rounded-xl bg-stone-50 p-3">
        <span>Teralokasi: <strong>{formatNominal(record.allocatedAmount, unit)}</strong></span>
        <span className="text-amber-700">Belum dialokasikan: <strong>{formatNominal(record.unallocatedAmount ?? "0", unit)}</strong></span>
        {shortfall && <span className="text-red-700">Selisih: <strong>{formatNominal(shortfall, unit)}</strong></span>}
      </div>

      {error && <div className="text-red-700">{error}</div>}
      {loaded && loaded.allocations.length === 0 && <div className="text-stone-500">Belum ada alokasi.</div>}
      {loaded?.allocations.map((alloc) => (
        <div key={alloc.id} className="rounded-xl border border-stone-200 p-3 flex flex-col sm:flex-row justify-between gap-2">
          <div>
            <div className="font-semibold text-stone-900">{alloc.activityName}</div>
            <div className="text-stone-500">
              {fundTypeLabel(alloc.fundType)} · {alloc.purpose || "-"} · {alloc.reason}
            </div>
            <div className="text-[11px] text-stone-400 font-mono break-all">
              {alloc.allocatedBy} {alloc.allocatedByOfficerId && `(${alloc.allocatedByOfficerId})`} · versi kontribusi {alloc.contributionVersion} ·{" "}
              {new Date(alloc.allocatedAt * 1000).toLocaleString("id-ID")}
            </div>
          </div>
          <div className="font-bold text-stone-900 whitespace-nowrap">{formatNominal(alloc.amountExact, alloc.currencyUnit)}</div>
        </div>
      ))}
    </div>
  );
}

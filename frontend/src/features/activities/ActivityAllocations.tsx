import { History, Layers } from "lucide-react";
import { channelLabel, formatNominal, fundTypeLabel } from "../contributions/contributionClient";
import type { ActivityDetail } from "./activityClient";

const when = (seconds: number) => new Date(seconds * 1000).toLocaleString("id-ID");

/** The allocations funding one activity and the history of how they were recorded. */
export function ActivityAllocations({ detail }: { detail: ActivityDetail }) {
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="flex items-center gap-2 text-sm font-bold text-stone-900">
            <Layers className="h-4 w-4 text-stone-600" />
            Kontribusi yang Dialokasikan ({detail.allocations.length})
          </h4>
          <span className="text-xs text-stone-500">{detail.contributionCount} kontribusi</span>
        </div>

        {detail.allocations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-6 text-center text-xs text-stone-500">
            Belum ada kontribusi yang dialokasikan ke kegiatan ini.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-stone-200">
            <table className="w-full text-left text-xs text-stone-700">
              <thead className="bg-stone-50 text-[11px] font-semibold uppercase text-stone-500 border-b border-stone-200">
                <tr>
                  <th className="px-3 py-2.5">Kontribusi & Sumber</th>
                  <th className="px-3 py-2.5">Donatur</th>
                  <th className="px-3 py-2.5">Jenis Dana / Peruntukan</th>
                  <th className="px-3 py-2.5">Nominal</th>
                  <th className="px-3 py-2.5">Alasan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {detail.allocations.map((alloc) => (
                  <tr key={alloc.id}>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      <div className="font-semibold text-stone-900">{alloc.contributionId}</div>
                      {alloc.source && (
                        <div className="text-[10px] text-stone-500">
                          {channelLabel(alloc.source.sourceChannel)} ({alloc.source.sourceReference})
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-stone-800">
                      {!alloc.source ? (
                        <span className="text-stone-400 italic">Memerlukan mandat kontribusi</span>
                      ) : (
                        alloc.source.donorName ?? <span className="text-stone-400 italic">Donatur tidak tercatat</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div>{fundTypeLabel(alloc.fundType)}</div>
                      <div className="text-stone-500">{alloc.purpose || "-"}</div>
                    </td>
                    <td className="px-3 py-2 font-bold text-stone-900 whitespace-nowrap">
                      {formatNominal(alloc.amountExact, alloc.currencyUnit)}
                    </td>
                    <td className="px-3 py-2 text-stone-600">{alloc.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail.history.length > 0 && (
        <div>
          <h4 className="flex items-center gap-2 text-sm font-bold text-stone-900 mb-2">
            <History className="h-4 w-4 text-stone-600" />
            Riwayat Alokasi
          </h4>
          <ol className="space-y-1.5 text-[11px] text-stone-600">
            {detail.history.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-stone-200 px-3 py-2">
                <span className="font-semibold text-stone-800">{when(entry.occurredAt)}</span> ·{" "}
                {formatNominal(entry.amountExact, detail.currencyUnit)} dari <span className="font-mono">{entry.contributionId}</span>{" "}
                (versi kontribusi {entry.contributionVersion}) oleh <span className="font-mono">{entry.actorAccount.slice(0, 10)}…</span>
                {entry.actorOfficerId && ` / ${entry.actorOfficerId}`} — {entry.reason}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

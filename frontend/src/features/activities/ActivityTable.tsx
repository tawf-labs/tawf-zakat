import { ShieldCheck } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { formatNominal } from "../contributions/contributionClient";
import { allocationPercent, type DistributionActivity } from "./activityClient";

export function TargetAmount({ activity }: { activity: DistributionActivity }) {
  return (
    <>
      {formatNominal(activity.targetAmount, activity.currencyUnit)}
      {activity.targetIsPartial && (
        <span className="block text-[10px] font-normal text-amber-700">Sebagian: ada bantuan barang tanpa nilai rupiah</span>
      )}
    </>
  );
}

export function ActivityTable({
  activities,
  onOpen,
}: {
  activities: DistributionActivity[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200">
      <table className="w-full text-left text-sm text-stone-700">
        <thead className="bg-stone-50 text-xs font-semibold uppercase text-stone-500 border-b border-stone-200">
          <tr>
            <th className="px-4 py-3">Kegiatan & Pengajuan</th>
            <th className="px-4 py-3">Target Bantuan</th>
            <th className="px-4 py-3">Teralokasi</th>
            <th className="px-4 py-3">Sisa Kebutuhan</th>
            <th className="px-4 py-3">Kontribusi</th>
            <th className="px-4 py-3 text-right">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-200">
          {activities.map((act) => {
            const pct = allocationPercent(act);
            return (
              <tr key={act.id} className="hover:bg-stone-50/70 transition-colors">
                <td className="px-4 py-3.5">
                  <div className="font-semibold text-stone-900">{act.name}</div>
                  <div className="text-xs text-stone-500 flex items-center gap-1 mt-0.5">
                    <ShieldCheck className="w-3 h-3 text-emerald-600" />
                    Pengajuan <span className="font-mono">{act.proposalId}</span> (v{act.proposalVersion})
                  </div>
                </td>
                <td className="px-4 py-3.5 whitespace-nowrap font-medium text-stone-900">
                  <TargetAmount activity={act} />
                </td>
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <div className="font-bold text-emerald-700">{formatNominal(act.totalAllocatedAmount, act.currencyUnit)}</div>
                  {pct !== null && (
                    <div className="w-28 bg-stone-200 rounded-full h-1.5 mt-1 overflow-hidden">
                      <div className="bg-emerald-600 h-1.5 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                  )}
                </td>
                <td className="px-4 py-3.5 whitespace-nowrap text-xs font-semibold text-amber-700">
                  {formatNominal(act.unallocatedNeed, act.currencyUnit)}
                </td>
                <td className="px-4 py-3.5 whitespace-nowrap text-xs text-stone-600">{act.contributionCount} kontribusi</td>
                <td className="px-4 py-3.5 text-right whitespace-nowrap">
                  <Button variant="outline" size="sm" onClick={() => onOpen(act.id)} className="text-xs px-2.5 py-1">
                    Detail Alokasi
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

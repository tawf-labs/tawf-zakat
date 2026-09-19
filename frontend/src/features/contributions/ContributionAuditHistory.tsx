import { History } from "lucide-react";
import type { ContributionHistory } from "./contributionClient";
import { at } from "./contributionUi";

export function ContributionAuditHistory({ history }: { history: ContributionHistory[] }) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-stone-900 flex items-center gap-1.5">
        <History className="w-4 h-4 text-stone-600" />
        <span>Riwayat Audit ({history.length})</span>
      </h4>
      <div className="space-y-2">
        {history.map((hist) => (
          <div
            key={hist.id}
            className="text-xs p-3 rounded-xl border border-stone-200 bg-stone-50/50 flex flex-col md:flex-row md:items-center justify-between gap-2"
          >
            <div>
              <div className="font-semibold text-stone-900 flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded bg-stone-200 font-mono text-[10px]">V{hist.version}</span>
                <span>Tindakan: {hist.action}</span>
                <span className="text-stone-400">→</span>
                <span className="text-emerald-800 font-medium">{hist.toStatus}</span>
              </div>
              <div className="text-stone-500 font-mono text-[11px] mt-0.5">
                Oleh: {hist.actorAccount} {hist.actorOfficerId && `(${hist.actorOfficerId})`}
              </div>
              {hist.notes && <div className="text-stone-600 mt-1 italic">"{hist.notes}"</div>}
            </div>
            <div className="text-[11px] text-stone-400 whitespace-nowrap">{at(hist.occurredAt)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

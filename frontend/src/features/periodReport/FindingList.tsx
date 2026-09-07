import { Badge } from "../../components/ui/Badge";
import { describeFinding } from "./verdictText";
import type { WireFinding } from "./types";

/**
 * Why a draft was rejected, one figure at a time.
 *
 * Every row names the figure, what the draft claimed, and what the ledger says -
 * never a generic message, because a reader who cannot see which number is wrong
 * can only guess at the fix.
 */
export function FindingList({ findings }: { findings: WireFinding[] }) {
  return (
    <ul className="mt-5 space-y-3">
      {findings.map((finding, index) => {
        const described = describeFinding(finding);
        return (
          <li
            key={`${described.kind}-${described.figureName ?? described.excerpt ?? index}`}
            className="rounded-xl border border-red-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="danger">{described.label}</Badge>
              {described.figureName && (
                <code className="text-[11px] text-[#5e7a70]">{described.figureName}</code>
              )}
            </div>

            <p className="mt-2 text-sm leading-relaxed text-red-900">{described.message}</p>

            {(described.claimed || described.expected) && (
              <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
                {described.claimed && (
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
                      Diklaim
                    </dt>
                    <dd className="font-mono font-semibold text-red-800">{described.claimed}</dd>
                  </div>
                )}
                {described.expected && (
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
                      Seharusnya
                    </dt>
                    <dd className="font-mono font-semibold text-emerald-800">
                      {described.expected}
                    </dd>
                  </div>
                )}
              </dl>
            )}

            {described.excerpt && (
              <p className="mt-3 text-xs text-[#5e7a70]">
                Ditemukan di narasi: <span className="font-mono">{described.excerpt}</span>
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

import { ChevronDown, ExternalLink } from "lucide-react";
import { blockExplorerUrl, intervalReading, markReading, trailTotal } from "./durations";
import type { WireDisbursementTrail } from "./types";

/**
 * One disbursement, opened up stage by stage.
 *
 * The block number is what makes this more than a table of dates: a timestamp
 * in a database can be edited quietly, and a block cannot. Where a stage has no
 * indexed event - the auditor's attestation is relayed gasless - no block is
 * shown, rather than a plausible one being invented for the column.
 */
function Trail({ trail }: { trail: WireDisbursementTrail }) {
  const total = trailTotal(trail);

  return (
    <details className="group border-b border-[#eef4ef] last:border-b-0">
      <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 py-2.5 marker:content-['']">
        <span className="font-mono text-sm text-[#17332c]">Penyaluran #{trail.proposalId}</span>
        <span className="text-sm text-[#3d5b52]">
          {total ? intervalReading(total) : "tidak terukur"}
          <ChevronDown className="ml-2 inline h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
        </span>
      </summary>

      <ol className="mb-3 space-y-2 border-l-2 border-[#dbe7dd] pl-4">
        {trail.marks.map((mark) => {
          const explorer = blockExplorerUrl(mark.blockNumber);
          return (
            <li key={mark.stage} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-sm text-[#3d5b52]">{mark.label}</span>
              <span
                className={
                  mark.reached
                    ? "font-mono text-xs text-[#17332c] tabular-nums"
                    : "text-xs text-[#5e7a70] italic"
                }
              >
                {markReading(mark)}
              </span>
              {explorer && (
                <a
                  href={explorer}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-xs text-[#1b765e] hover:underline"
                >
                  blok #{mark.blockNumber}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </li>
          );
        })}
      </ol>
      <dl className="mb-4 space-y-2 pl-4">
        {trail.intervals.map((interval) => (
          <div key={interval.name} className="grid gap-1 text-xs sm:grid-cols-2 sm:gap-4">
            <dt className="text-[#3d5b52]">{interval.label}</dt>
            <dd className="text-[#5e7a70]">{intervalReading(interval)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function DisbursementTrailList({ trails }: { trails: WireDisbursementTrail[] }) {
  return (
    <div className="mt-5 border-t border-[#eef4ef] pt-4">
      <h4 className="text-xs font-bold uppercase text-[#5e7a70]">
        Jejak Waktu Penyaluran
      </h4>

      {trails.length === 0 ? (
        <p className="mt-2 text-sm text-[#5e7a70]">
          Belum ada penyaluran yang tereksekusi pada periode ini, sehingga belum ada jejak waktu
          yang bisa dibuka.
        </p>
      ) : (
        <div className="mt-2">
          {trails.map((trail) => (
            <Trail key={trail.proposalId} trail={trail} />
          ))}
        </div>
      )}
    </div>
  );
}

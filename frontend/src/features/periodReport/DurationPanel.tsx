import { Timer, TrendingDown } from "lucide-react";
import { averageDuration, bottleneckReading, sampleReading } from "./durations";
import { DisbursementTrailList } from "./DisbursementTrailList";
import type { WirePeriodDurations } from "./types";

/**
 * How long the process actually took - the question a lembaga has never been
 * able to answer about itself.
 *
 * Every average carries the number of disbursements underneath it, and a span
 * that could not be measured says so in words. Nothing here renders an absent
 * duration as a number: "0 jam" would read as instant, which is exactly the
 * claim this panel exists to stop anyone making.
 */
export function DurationPanel({ durations }: { durations: WirePeriodDurations }) {
  const bottleneck = bottleneckReading(durations);

  return (
    <section className="border-y border-[#dbe7dd] py-6">
      <div className="flex items-center gap-2.5">
        <Timer className="h-5 w-5 text-[#1b765e]" />
        <h3 className="font-serif text-lg font-bold text-[#17332c]">Durasi Penyaluran</h3>
      </div>

      <p className="mt-1 text-xs leading-relaxed text-[#5e7a70]">
        Lamanya proses di dalam sistem ini, dari pengajuan sampai atestasi - bukan jam kerja
        penyusunan laporan di lembaga.
      </p>

      <dl className="mt-4 divide-y divide-[#eef4ef]">
        {durations.intervals.map((interval) => {
          const average = averageDuration(interval);
          return (
            <div key={interval.name} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
              <dt className="text-sm text-[#3d5b52]">{interval.label}</dt>
              <dd className="text-right">
                <span
                  className={
                    average
                      ? "font-mono text-sm font-semibold text-[#17332c] tabular-nums"
                      : "text-sm text-[#5e7a70] italic"
                  }
                >
                  {average ?? "tidak terukur"}
                </span>
                <span className="ml-2 text-xs text-[#5e7a70]">{sampleReading(interval)}</span>
              </dd>
            </div>
          );
        })}
      </dl>

      {bottleneck && (
        <div className="mt-4 flex items-start gap-3 border-l-2 border-amber-300 bg-amber-50 p-4">
          <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <p className="text-sm leading-relaxed text-amber-900">{bottleneck}</p>
        </div>
      )}

      <DisbursementTrailList trails={durations.trails} />

      {durations.notes.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-[#eef4ef] pt-4">
          {durations.notes.map((note) => (
            <li key={note} className="text-xs leading-relaxed text-[#5e7a70]">
              - {note}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

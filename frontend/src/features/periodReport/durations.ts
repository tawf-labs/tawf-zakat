/**
 * Reading a period's stage durations (ticket #65).
 *
 * Pure, so what the screen and the downloaded file say about a duration is
 * testable without rendering either - and so the two can never disagree.
 *
 * The one rule everything here serves: **an absent duration is never rendered
 * as a number.** A stage nobody has reached yet, and a stage whose timestamp
 * this system never stored, each get their own words. Showing either as "0 jam"
 * would read as instant, which is the opposite of what is true.
 */

import { formatHours, groupDigits } from "../../lib/reporting";
import { SEPOLIA_EXPLORER_URL } from "../../lib/contracts";
import type {
  WireDisbursementTrail,
  WireIntervalAggregate,
  WirePeriodDurations,
  WireStageInterval,
  WireStageMark,
} from "./types";

/** The measured span, or null when there is none to state. */
export const intervalDuration = (interval: WireStageInterval): string | null =>
  interval.state === "SELESAI" && interval.hours !== null ? formatHours(interval.hours) : null;

/**
 * What to show where a duration would be. Falls back to the state's own words
 * only when the server sent no reason, so a reader is never left with a blank.
 */
export function intervalReading(interval: WireStageInterval): string {
  const duration = intervalDuration(interval);
  if (duration) return duration;
  if (interval.reason) return interval.reason;
  if (interval.state === "URUTAN_TERBALIK") return "Urutan waktu terbalik";
  return interval.state === "BELUM_SELESAI" ? "Belum selesai" : "Tidak tercatat";
}

/** The average span of an aggregate, or null when nothing was measurable. */
export const averageDuration = (aggregate: WireIntervalAggregate): string | null =>
  aggregate.averageHours === null ? null : formatHours(aggregate.averageHours);

/**
 * How many disbursements an average rests on, always said beside it.
 *
 * An average drawn from one disbursement is not a trend, and the count is what
 * stops it being read as one. Where there is no average, this says what was
 * left out instead - measured absence rather than silence.
 */
export function sampleReading(aggregate: WireIntervalAggregate): string {
  const { sampleCount, unmeasured } = aggregate;
  const left = [
    unmeasured.belumSelesai > 0 ? `${unmeasured.belumSelesai} belum selesai` : null,
    unmeasured.tidakTercatat > 0 ? `${unmeasured.tidakTercatat} tidak tercatat` : null,
    unmeasured.urutanTerbalik > 0 ? `${unmeasured.urutanTerbalik} urutan waktu terbalik` : null,
  ].filter((part): part is string => part !== null);

  if (sampleCount > 0) {
    const measured = sampleCount === 1
      ? "dari 1 penyaluran - satu kejadian, bukan tren"
      : `dari ${groupDigits(String(sampleCount))} penyaluran`;
    return measured + (left.length ? ` (${left.join(", ")})` : "");
  }

  return left.length === 0
    ? "belum ada penyaluran pada periode ini"
    : `tidak ada yang terukur (${left.join(", ")})`;
}

/** One sentence naming where the time goes, or null when nothing is measurable. */
export function bottleneckReading(durations: WirePeriodDurations): string | null {
  const { slowest } = durations;
  if (!slowest) return null;
  return (
    `Waktu paling banyak hilang di tahap "${slowest.label}": rata-rata ` +
    `${formatHours(slowest.averageHours)}, ${
      slowest.sampleCount === 1
        ? "dari 1 penyaluran - satu kejadian, bukan tren"
        : `dari ${groupDigits(String(slowest.sampleCount))} penyaluran`
    }.`
  );
}

/**
 * A stage's moment, to the minute. Date and time together: a report that shows
 * only the day cannot distinguish two stages passed hours apart.
 */
export function formatStageMoment(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** What a stage marker says about itself, with nothing invented to fill a gap. */
export function markReading(mark: WireStageMark): string {
  if (!mark.reached) return "Belum terlewati";
  return formatStageMoment(mark.at) ?? "Terlewati, tanpa stempel waktu tersimpan";
}

/** The block that fixed a stage, linked to the explorer, or null when none. */
export const blockExplorerUrl = (blockNumber: number | null): string | null =>
  blockNumber === null ? null : `${SEPOLIA_EXPLORER_URL}/block/${blockNumber}`;

/** The end-to-end span of one disbursement, for the trail's summary line. */
export const trailTotal = (trail: WireDisbursementTrail): WireStageInterval | null =>
  trail.intervals.find((interval) => interval.name === "pengajuan_ke_atestasi") ?? null;

/**
 * The file an Amil takes away: the period report as plain text.
 *
 * Pure and free of the DOM, so what the file contains is testable without a
 * browser. Handing it to the browser is `lib/download`'s job.
 *
 * Only a report that passed the validator can be built. That is the second lock
 * on the same rule the screen enforces - a rejected draft has no path to a
 * signature, and a file on somebody's disk outlives the screen that produced it.
 */

import { formatQuantity, periodLabel } from "../../lib/reporting";
import { coverageCounts, formatAuditDate } from "./figures";
import {
  averageDuration,
  bottleneckReading,
  blockExplorerUrl,
  intervalReading,
  markReading,
  sampleReading,
  trailTotal,
} from "./durations";
import { canSign } from "./verdictText";
import type {
  WireDisbursementTrail,
  WireDraft,
  WireFigure,
  WirePeriodDurations,
  WirePeriodFigures,
  WireVerdict,
} from "./types";

const line = (figure: WireFigure): string =>
  `  ${figure.label}: ${formatQuantity(figure.value)}`;

const section = (title: string, body: string[]): string[] =>
  body.length === 0 ? [] : [title, ...body, ""];

/**
 * How long each stage took, in the same words the screen uses.
 *
 * A span with no measurement is written out as the reason it has none. The file
 * outlives the screen that produced it, so a blank or a zero here would be a
 * duration nobody could challenge later.
 */
function durationLines(durations: WirePeriodDurations): string[] {
  const bottleneck = bottleneckReading(durations);
  return [
    ...durations.intervals.map(
      (aggregate) =>
        `  ${aggregate.label}: ${averageDuration(aggregate) ?? "tidak terukur"} ` +
        `(${sampleReading(aggregate)})`
    ),
    ...(bottleneck ? ["", `  ${bottleneck}`] : []),
  ];
}

/** One disbursement's trail: every stage, its moment, and its block number. */
const trailLines = (trail: WireDisbursementTrail): string[] => {
  const total = trailTotal(trail);
  return [
    `  Penyaluran #${trail.proposalId} - pengajuan sampai atestasi: ${
      total ? intervalReading(total) : "tidak terukur"
    }`,
    ...trail.marks.map(
      (mark) =>
        `    ${mark.label}: ${markReading(mark)}` +
        `${mark.blockNumber === null ? "" : ` - blok #${mark.blockNumber} (${blockExplorerUrl(mark.blockNumber)})`}`
    ),
    ...trail.intervals.map((interval) => `    ${interval.label}: ${intervalReading(interval)}`),
  ];
};

export function buildReportDocument(
  figures: WirePeriodFigures,
  draft: WireDraft | null,
  verdict: WireVerdict | null
): string | null {
  if (!draft || !canSign(verdict)) return null;

  const { amilShare } = figures;
  const coverage = coverageCounts(figures);

  return [
    "LAPORAN PERIODE TERVERIFIKASI",
    periodLabel(figures.period),
    "",
    "Setiap angka di dalam laporan ini telah dicocokkan satu per satu dengan catatan",
    "yang mendasarinya oleh validator deterministik, dan lolos tanpa satu pun selisih.",
    "Narasi disusun oleh model bahasa dan tidak pernah menjadi sumber angka.",
    "",
    ...section("PENGUMPULAN", figures.collection.map(line)),
    ...section("PENYALURAN", figures.distribution.map(line)),
    "HAK AMIL",
    `  Pengumpulan: ${formatQuantity(amilShare.collected)}`,
    `  Plafon ${formatQuantity(amilShare.ceilingRatio)}: ${formatQuantity(amilShare.ceiling)}`,
    `  Porsi terpakai: ${formatQuantity(amilShare.actual)} (${formatQuantity(amilShare.actualRatio)})`,
    `  Status: ${amilShare.withinCeiling ? "di dalam plafon" : "MELAMPAUI PLAFON"}`,
    "",
    ...section(
      "ATESTASI AUDITOR",
      figures.attestations.map(
        (attestation) =>
          `  Penyaluran #${attestation.proposalId} - ${attestation.auditorName ?? "auditor tidak dinamai"}` +
          `${attestation.opinion ? ` (${attestation.opinion})` : ""}` +
          `${formatAuditDate(attestation.auditedAt) ? ` - ${formatAuditDate(attestation.auditedAt)}` : ""}`
      )
    ),
    ...section("DURASI PENYALURAN", durationLines(figures.durations)),
    ...section(
      "JEJAK WAKTU PENYALURAN",
      figures.durations.trails.flatMap(trailLines)
    ),
    "CAKUPAN ATESTASI",
    `  Atestasi terbit pada periode ini: ${coverage.attested ?? "tidak dilaporkan"}`,
    `  Penyaluran yang belum diatestasi: ${coverage.unattested ?? "tidak dilaporkan"}`,
    ...(coverage.undatedRows ? [`  Baris tanpa tanggal, dikeluarkan dari periode: ${coverage.undatedRows}`] : []),
    "",
    "NARASI",
    draft.narrative,
    "",
    ...section(
      "CATATAN BATAS LAPORAN",
      figures.notes.map((note) => `  - ${note}`)
    ),
  ].join("\n");
}

export const reportFileName = (period: WirePeriodFigures["period"]): string =>
  `laporan-periode-${period.kind.toLowerCase().replace(/_/g, "-")}-${period.year}.txt`;

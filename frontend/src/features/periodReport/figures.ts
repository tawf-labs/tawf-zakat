/**
 * Reading a named figure out of a period report.
 *
 * The backend returns every figure under a stable machine name, and a screen
 * that hard-codes an index into that list would break the moment a figure is
 * added. Pure, so what the page shows is testable without rendering it.
 */

import type { WireFigure, WirePeriodFigures } from "./types";

export const findFigure = (figures: WirePeriodFigures, name: string): WireFigure | null =>
  figures.figures.find((figure) => figure.name === name) ?? null;

/** A count figure as a number, or null when this report does not carry it. */
export function countOf(figures: WirePeriodFigures, name: string): number | null {
  const figure = findFigure(figures, name);
  if (!figure || figure.value.unit !== "COUNT") return null;
  return Number(figure.value.amount);
}

export type CoverageCounts = {
  /** Attestations the auditor issued inside this period. */
  attested: number | null;
  /** Executed disbursements this period that no auditor has touched yet. */
  unattested: number | null;
  /** Rows left out of every period for want of a usable date. */
  undatedRows: number | null;
};

/**
 * What the auditor has and has not reached. Kept beside the attestation list
 * because a list of what *was* checked, without the count of what was not,
 * flatters the report.
 */
export const coverageCounts = (figures: WirePeriodFigures): CoverageCounts => ({
  attested: countOf(figures, "atestasi.jumlah"),
  unattested: countOf(figures, "atestasi.penyaluran_belum_diatestasi"),
  undatedRows: countOf(figures, "baris.tanpa_tanggal"),
});

/** One date rendering, so the screen and the downloaded file never disagree. */
export function formatAuditDate(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

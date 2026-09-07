/**
 * Wire shapes of the verified period report (backend spec #61).
 *
 * Every amount crosses as a decimal string, so a trillion-scale rupiah figure
 * survives JSON without ever touching a float.
 */

import type { ReportedUnit } from "../../lib/reporting";

export type WireQuantity = { amount: string; unit: ReportedUnit };

export type ReportingPeriod = { kind: "SEMESTER" | "AKHIR_TAHUN"; year: number };

export type WireFigure = { name: string; label: string; value: WireQuantity };

export type WireAttestation = {
  proposalId: number;
  auditorName: string | null;
  auditorAddress: string | null;
  opinion: string | null;
  reportCID: string | null;
  txHash: string | null;
  auditedAt: string | null;
};

export type WireAmilShare = {
  withinCeiling: boolean;
  collected: WireQuantity;
  ceiling: WireQuantity;
  actual: WireQuantity;
  ceilingRatio: WireQuantity;
  actualRatio: WireQuantity;
};

export type WirePeriodFigures = {
  period: ReportingPeriod;
  figures: WireFigure[];
  collection: WireFigure[];
  distribution: WireFigure[];
  amilShare: WireAmilShare;
  attestations: WireAttestation[];
  notes: string[];
};

export const FINDING_KINDS = [
  "KLAIM_TIDAK_COCOK",
  "KLAIM_TIDAK_TERBACA",
  "KLAIM_TIDAK_DIKENAL",
  "KLAIM_GANDA",
  "ANGKA_NARASI_TIDAK_DIKLAIM",
  "PLAFON_HAK_AMIL_TERLAMPAUI",
] as const;

export type FindingKind = (typeof FINDING_KINDS)[number];

export type WireFinding = {
  kind: FindingKind;
  figureName: string | null;
  message: string;
  claimed?: WireQuantity;
  expected?: WireQuantity;
  excerpt?: string;
};

export type WireVerdict = { outcome: "LOLOS" | "DITOLAK"; findings: WireFinding[] };

export type WireDraftClaim =
  | { name: string; value: WireQuantity; statedAmount?: undefined }
  | { name: string; value: null; statedAmount: string };

export type WireDraft = { claims: WireDraftClaim[]; narrative: string };

export type PeriodReportResponse = {
  success: boolean;
  period: ReportingPeriod;
  figures: WirePeriodFigures;
  draft: WireDraft | null;
  verdict: WireVerdict | null;
  /** Present whenever there is no draft, saying why in the open. */
  draftUnavailable?: string;
};

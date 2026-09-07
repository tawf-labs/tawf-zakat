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

/** The four stages of ADR-0006, in the order authority passes through them. */
export const DISBURSEMENT_STAGES = [
  "PENGAJUAN",
  "PERSETUJUAN_DPS",
  "EKSEKUSI",
  "ATESTASI",
] as const;

export type DisbursementStage = (typeof DISBURSEMENT_STAGES)[number];

export type WireStageMark = {
  stage: DisbursementStage;
  label: string;
  reached: boolean;
  /** ISO wall-clock, or null when this system holds no readable one. */
  at: string | null;
  /** The block that fixed this stage on chain, or null when none was indexed. */
  blockNumber: number | null;
};

/**
 * `SELESAI` - measured. `BELUM_SELESAI` - the stage has not been passed yet.
 * `TIDAK_TERCATAT` - no readable timestamp. `URUTAN_TERBALIK` - contradictory
 * timestamps. Unmeasured intervals never stand in for a zero duration.
 */
export type IntervalState = "SELESAI" | "BELUM_SELESAI" | "TIDAK_TERCATAT" | "URUTAN_TERBALIK";

export type WireStageInterval = {
  name: string;
  label: string;
  from: DisbursementStage;
  to: DisbursementStage;
  state: IntervalState;
  /** Whole hours as a decimal string, or null when there is no duration. */
  hours: string | null;
  reason: string | null;
};

export type WireDisbursementTrail = {
  proposalId: number;
  marks: WireStageMark[];
  intervals: WireStageInterval[];
};

export type WireIntervalAggregate = {
  name: string;
  label: string;
  from: DisbursementStage;
  to: DisbursementStage;
  /** Whole hours as a decimal string, or null when nothing was measurable. */
  averageHours: string | null;
  sampleCount: number;
  unmeasured: { belumSelesai: number; tidakTercatat: number; urutanTerbalik: number };
};

export type WirePeriodDurations = {
  intervals: WireIntervalAggregate[];
  slowest: {
    name: string;
    label: string;
    averageHours: string;
    sampleCount: number;
  } | null;
  trails: WireDisbursementTrail[];
  notes: string[];
};

export type WirePeriodFigures = {
  period: ReportingPeriod;
  figures: WireFigure[];
  collection: WireFigure[];
  distribution: WireFigure[];
  amilShare: WireAmilShare;
  attestations: WireAttestation[];
  durations: WirePeriodDurations;
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

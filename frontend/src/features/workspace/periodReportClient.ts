import type { PrivateRequests } from "./privateRequests";
import type { EvidencePreparation } from "./evidenceClient";

/**
 * Laporan periode dari data aplikasi (ADR-0043, #130).
 *
 * The list comes from one summary per institution, never from reading the registry
 * package by package in the browser; the wizard sends only a period and a cut-off.
 */

export type PeriodKind = "SEMESTER" | "AKHIR_TAHUN";
export type Period = { kind: PeriodKind; year: number };
export type PeriodReportStatus = "DRAF" | "SIAP_TERBIT" | "TERBIT" | "DIKOREKSI";

export type PeriodReportSummary = {
  period: Period;
  name: string;
  status: PeriodReportStatus;
  cutOff: string | null;
  preparationId: string;
  fromApp: boolean;
  comparedWithBookkeeping: boolean;
  published: { packageId: string; reportId: string; version: string; publishedAt: number } | null;
  preparations: { id: string; createdAt: number; cutOff: string | null; fromApp: boolean }[];
};

export type PeriodReportPreview = {
  period: Period;
  cutOff: string;
  byFundType: { fundType: string; amountIdr: string }[];
  totalIdr: string;
  goods: { unit: string; quantity: string; handovers: number }[];
  recipients: number;
  handovers: number;
  costs: { directIdr: string; fromAdvanceIdr: string; totalIdr: string; advancesIdr: string; unaccountedAdvancesIdr: string };
  incompleteEvidence: { realizationId: string; recipient: string; program: string | null; amountIdr: string | null; quantity: string | null; unit: string | null }[];
  afterCutOff: number;
  unverified: { reference: string; reason: string }[];
};

const BASE = "/api/evidence/period-reports";

export const listPeriodReports = (requests: PrivateRequests): Promise<{ reports: PeriodReportSummary[] }> =>
  requests.json(BASE);

/** `cutOff` absent means now, as the server sees it; the preview says which instant that was. */
export const previewPeriodReport = (requests: PrivateRequests, period: Period, cutOff: string | null): Promise<{ preview: PeriodReportPreview }> =>
  requests.json(`${BASE}/preview?periodKind=${period.kind}&year=${period.year}${cutOff ? `&cutOff=${encodeURIComponent(cutOff)}` : ""}`);

/** Locks exactly the data the preview showed: same period, same cut-off instant. */
export const lockPeriodReport = (requests: PrivateRequests, period: Period, cutOff: string): Promise<{ preparation: EvidencePreparation }> =>
  requests.json(BASE, { method: "POST", body: JSON.stringify({ period, cutOff }) });

export const STATUS_LABELS: Record<PeriodReportStatus, string> = {
  DRAF: "Draf",
  SIAP_TERBIT: "Siap diterbitkan",
  TERBIT: "Terbit",
  DIKOREKSI: "Dikoreksi",
};

export const statusLabel = (report: Pick<PeriodReportSummary, "status" | "published">) =>
  report.status === "TERBIT" && report.published ? `Terbit · versi ${report.published.version}` : STATUS_LABELS[report.status];

/** A cut-off as staff read it: their own clock, Indonesian date and time. */
export function formatCutOff(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString("id-ID", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

import { getApiBaseUrl } from "../../lib/contracts";
import type { PeriodReportResponse, ReportingPeriod } from "./types";

/** The server's own words when it refuses a request - shown to the Amil as-is. */
export class PeriodReportRequestError extends Error {}

async function postJson(path: string, body: unknown): Promise<PeriodReportResponse> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    throw new PeriodReportRequestError(
      `Server membalas ${response.status} tanpa isi yang bisa dibaca.`
    );
  }

  if (!response.ok || payload?.success === false) {
    throw new PeriodReportRequestError(
      payload?.error || `Laporan periode gagal diambil (HTTP ${response.status}).`
    );
  }

  return payload as PeriodReportResponse;
}

/** The figures alone: computed from the ledger, with no draft and no verdict. */
export const fetchPeriodFigures = (period: ReportingPeriod): Promise<PeriodReportResponse> =>
  postJson("/api/period-report/verify", { period });

/** Figures, a narrative drafted on the server, and the validator's verdict. */
export const requestPeriodDraft = (period: ReportingPeriod): Promise<PeriodReportResponse> =>
  postJson("/api/period-report/draft", { period });

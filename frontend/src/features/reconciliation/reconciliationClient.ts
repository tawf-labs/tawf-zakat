import { getApiBaseUrl } from "../../lib/contracts";
import type {
  InternalReconciliationResponse,
  ReconciliationReport,
  ReportingPeriod,
  WireLedgerSide,
  WireMoney,
} from "./types";

export type InterInstitutionRequest = {
  claim: WireLedgerSide;
  source: WireLedgerSide;
  options: {
    period: ReportingPeriod;
    tolerance?: WireMoney;
    allowedBuckets?: string[];
    balanceSheet?: "ON" | "OFF";
  };
};

/** The server's own words when it refuses a payload - shown to the Amil as-is. */
export class ReconciliationRequestError extends Error {}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    throw new ReconciliationRequestError(
      `Server membalas ${response.status} tanpa isi yang bisa dibaca.`
    );
  }

  if (!response.ok || payload?.success === false) {
    throw new ReconciliationRequestError(
      payload?.error || `Rekonsiliasi gagal dijalankan (HTTP ${response.status}).`
    );
  }

  return payload as T;
}

export async function runInterInstitutionReconciliation(
  request: InterInstitutionRequest
): Promise<ReconciliationReport> {
  const payload = await postJson<{ report: ReconciliationReport }>(
    "/api/reconciliation/antar-lembaga",
    request
  );
  return payload.report;
}

export async function runInternalReconciliation(request?: {
  period?: ReportingPeriod;
  fromBlock?: number;
  toBlock?: number;
}): Promise<InternalReconciliationResponse> {
  return postJson<InternalReconciliationResponse>("/api/reconciliation/internal", request ?? {});
}

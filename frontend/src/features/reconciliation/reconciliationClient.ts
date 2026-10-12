import { createContext, useContext } from "react";
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

/** Authenticated POST supplied by the workspace; this module never holds a credential. */
export type ReconciliationPost = <T>(path: string, body: unknown) => Promise<T>;
export const ReconciliationPostContext = createContext<ReconciliationPost | null>(null);
export function useReconciliationPost(): ReconciliationPost {
  const post = useContext(ReconciliationPostContext);
  if (!post) throw new Error("Rekonsiliasi hanya tersedia di dalam ruang kerja lembaga.");
  return post;
}

export async function runInterInstitutionReconciliation(
  post: ReconciliationPost,
  request: InterInstitutionRequest
): Promise<ReconciliationReport> {
  const payload = await post<{ report: ReconciliationReport }>(
    "/api/reconciliation/antar-lembaga",
    request
  );
  return payload.report;
}

export async function runInternalReconciliation(post: ReconciliationPost, request?: {
  period?: ReportingPeriod;
  fromBlock?: number;
  toBlock?: number;
}): Promise<InternalReconciliationResponse> {
  return post<InternalReconciliationResponse>("/api/reconciliation/internal", request ?? {});
}

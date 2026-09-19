import { useMutation, useQuery } from "@tanstack/react-query";
import type { Hex } from "viem";
import { getApiBaseUrl } from "../../lib/contracts";

/** Mirrors `PublicContributionStatus` in `backend/src/contribution-trace.ts`. */
export type PublicContributionStatus =
  | "PENDING"
  | "PAID"
  | "BATCHED"
  | "RECEIVED"
  | "RECONCILED"
  | "ENDORSED"
  | "REJECTED";

export type PublicRecordKind = "ONLINE_DONATION" | "INSTITUTION_CONTRIBUTION";

export interface BatchRecord {
  batchId: number;
  merkleRoot: Hex | null;
  anchorTxHash: string | null;
  rootSource: "SERVER_RECORD";
  versionStatus: "UNTRACKED";
}

export interface PublicContribution {
  trxId: string;
  recordKind: PublicRecordKind;
  status: PublicContributionStatus;
  recordedAt: string;
  paidAt: string | null;
  batch: BatchRecord | null;
  membershipProof: { type: "MERKLE_INCLUSION"; siblings: Hex[] } | null;
  zkProof: { status: "NOT_AVAILABLE" };
}

export type ContributionLookup =
  | { lookupStatus: "FOUND"; contribution: PublicContribution }
  | { lookupStatus: "NOT_FOUND" }
  | { lookupStatus: "UNAVAILABLE" };

export interface ReceiptCheck {
  checkedBy: "SERVER";
  isValid: boolean;
  leaf: Hex;
  batch: BatchRecord | null;
}

const UNAVAILABLE: ContributionLookup = { lookupStatus: "UNAVAILABLE" };

async function fetchContribution(trxId: string): Promise<ContributionLookup> {
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}/api/public/contributions/${encodeURIComponent(trxId)}`);
  } catch {
    return UNAVAILABLE;
  }
  if (res.status === 404) return { lookupStatus: "NOT_FOUND" };
  if (!res.ok) return UNAVAILABLE;
  const body = await res.json().catch(() => null);
  return body?.lookupStatus === "FOUND" && body.contribution ? body : UNAVAILABLE;
}

export function useContributionLookup(trxId: string) {
  return useQuery({
    queryKey: ["public-contribution", trxId],
    queryFn: () => fetchContribution(trxId),
    enabled: trxId.length > 0,
    retry: false,
    staleTime: 0,
  });
}

export function useReceiptCheck() {
  return useMutation({
    mutationFn: async (input: { trxId: string; salt: string; amountIDR: number }): Promise<ReceiptCheck> => {
      const res = await fetch(`${getApiBaseUrl()}/api/verify-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`Pemeriksaan kuitansi gagal (${res.status}).`);
      return res.json();
    },
  });
}

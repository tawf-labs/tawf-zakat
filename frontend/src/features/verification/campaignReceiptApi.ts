import { useQuery } from "@tanstack/react-query";
import { getApiBaseUrl } from "../../lib/contracts";

export interface CampaignReceipt {
  reference: string;
  status: "CONFIRMED" | "PARTIALLY_REFUNDED" | "REFUNDED" | "PENDING" | "FAILED";
  campaign: { id: string; title: string; organizer: { name: string; organizationName?: string } };
  amount?: number;
  refundedAmount?: number;
  paidAt?: string;
  /** Present only once the donation's record is confirmed on chain. */
  chain?: { transactionHash: string; payloadHash: string };
}
export type CampaignReceiptLookup =
  | { lookupStatus: "FOUND"; receipt: CampaignReceipt }
  | { lookupStatus: "NOT_FOUND" | "UNAVAILABLE" };

/** Campaign donations carry the payment order reference, e.g. CF-1b2c…; everything else is a contribution reference. */
export const isCampaignReference = (reference: string) => /^CF-/i.test(reference.trim());

async function fetchCampaignReceipt(reference: string): Promise<CampaignReceiptLookup> {
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}/api/crowdfunding/receipts/${encodeURIComponent(reference)}`);
  } catch {
    return { lookupStatus: "UNAVAILABLE" };
  }
  if (res.status === 404) return { lookupStatus: "NOT_FOUND" };
  const body = res.ok ? await res.json().catch(() => null) : null;
  return body?.receipt ? { lookupStatus: "FOUND", receipt: body.receipt } : { lookupStatus: "UNAVAILABLE" };
}

export function useCampaignReceiptLookup(reference: string) {
  return useQuery({
    queryKey: ["campaign-receipt", reference],
    queryFn: () => fetchCampaignReceipt(reference),
    enabled: reference.length > 0,
    retry: false,
    staleTime: 0,
  });
}

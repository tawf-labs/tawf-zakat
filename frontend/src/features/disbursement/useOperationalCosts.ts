import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PrivateRequests } from "../workspace/privateRequests";
import { fetchOfficers } from "../workspace/workspaceClient";
import { realizationKey } from "./useRealizationQueries";
import { getOperationalCosts, listCostPurposes } from "./operationalCostClient";
import type { CostContext } from "./operationalCostRows";

/** Costs feed the realization summary, so they live under the realization key and refresh with it. */
const costsKey = (requests: PrivateRequests, proposalId: string) => [...realizationKey(requests), proposalId, "operational-costs"] as const;

export function useOperationalCosts(requests: PrivateRequests, proposalId: string) {
  const client = useQueryClient();
  const key = costsKey(requests, proposalId);
  const overview = useQuery({ queryKey: key, queryFn: () => getOperationalCosts(requests, proposalId) });
  const officers = useQuery({ queryKey: [...realizationKey(requests), "cost-officers"], queryFn: () => fetchOfficers(requests) });
  const purposes = useQuery({ queryKey: [...realizationKey(requests), "cost-purposes"], queryFn: () => listCostPurposes(requests) });

  const ctx: CostContext | null = overview.data && officers.data
    ? { officers: officers.data, panjar: overview.data.panjar, receipts: overview.data.receipts }
    : null;
  return {
    overview: overview.data ?? null,
    ctx,
    purposes: purposes.data ?? [],
    error: overview.error ?? officers.error ?? purposes.error,
    /** The latest overview from the server, for steps that must not act on a stale list. */
    fresh: () => client.fetchQuery({ queryKey: key, queryFn: () => getOperationalCosts(requests, proposalId), staleTime: 0 }),
  };
}

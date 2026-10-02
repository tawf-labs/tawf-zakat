import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AccessContextChanged, type PrivateRequests } from "../workspace/privateRequests";
import { getProposalRealizationSummary, getProposalRealizations, listRealizationDocuments,
  listRealizationDisputes, listIncompleteEvidenceQueue } from "./disbursementClient";

export const realizationKey = (requests: PrivateRequests) => ["realizations", requests.contextId] as const;
const proposalKey = (requests: PrivateRequests, id: string) => [...realizationKey(requests), id] as const;

export function useRealizationOverview(requests: PrivateRequests, id: string, enabled: boolean) {
  const key = proposalKey(requests, id);
  const summary = useQuery({ queryKey: [...key, "summary"], queryFn: () => getProposalRealizationSummary(requests, id), enabled });
  const records = useQuery({ queryKey: [...key, "records"], queryFn: () => getProposalRealizations(requests, id), enabled });
  const documents = useQuery({ queryKey: [...key, "documents"], queryFn: () => listRealizationDocuments(requests, id), enabled });
  return { loaded: summary.data && records.data && documents.data
    ? { ...summary.data, realizations: records.data, documents: documents.data } : null,
    error: summary.error ?? records.error ?? documents.error };
}

export function useRealizationDisputes(requests: PrivateRequests, proposalId: string, id: string, enabled: boolean) {
  return useQuery({ queryKey: [...proposalKey(requests, proposalId), "disputes", id],
    queryFn: () => listRealizationDisputes(requests, proposalId, id), enabled });
}

export function useIncompleteEvidenceQueue(requests: PrivateRequests) {
  return useQuery({ queryKey: [...realizationKey(requests), "incomplete-evidence"], queryFn: () => listIncompleteEvidenceQueue(requests) });
}

export function useInvalidateRealizations(requests: PrivateRequests) {
  const client = useQueryClient();
  return () => {
    try { requests.assertCurrent(); }
    catch (error) { if (error instanceof AccessContextChanged) return; throw error; }
    void client.invalidateQueries({ queryKey: realizationKey(requests) });
  };
}

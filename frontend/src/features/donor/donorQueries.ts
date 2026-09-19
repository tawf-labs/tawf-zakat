import { useQuery } from "@tanstack/react-query";
import {
  fetchDonorAllocations,
  fetchDonorChannel,
  fetchDonorContribution,
  type DonorSessionRecord,
} from "./donorClient";

/**
 * Private reads run inside the per-session QueryClient of `DonorAccessPanel`,
 * so nothing they cache outlives the session that fetched it.
 */
export const useDonorContribution = (session: DonorSessionRecord) =>
  useQuery({
    queryKey: ["donor", "contribution", session.contributionId],
    queryFn: () => fetchDonorContribution(session),
  });

export const useDonorAllocations = (session: DonorSessionRecord) =>
  useQuery({
    queryKey: ["donor", "allocations", session.contributionId],
    queryFn: () => fetchDonorAllocations(session),
  });

export const useDonorChannel = () =>
  useQuery({ queryKey: ["donor", "channel"], queryFn: fetchDonorChannel, retry: false });

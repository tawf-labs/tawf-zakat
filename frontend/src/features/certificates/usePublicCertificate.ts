import { useQuery } from "@tanstack/react-query";
import { fetchPublicCertificate } from "./certificateClient";
import { getApiBaseUrl } from "../../lib/contracts";

export interface CertificateLookup {
  institutionId: string;
  certificateId: string;
  /** A historical version; absent means the official head. */
  version?: string;
}

export function usePublicCertificate(lookup: CertificateLookup | null) {
  return useQuery({
    queryKey: ["public-certificate", lookup?.institutionId, lookup?.certificateId, lookup?.version ?? null],
    queryFn: ({ signal }) => fetchPublicCertificate(getApiBaseUrl(), lookup!.institutionId, lookup!.certificateId, signal, lookup!.version),
    enabled: lookup !== null,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

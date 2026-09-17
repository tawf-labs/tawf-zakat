import { useQuery } from "@tanstack/react-query";
import { getApiBaseUrl } from "../../lib/contracts";

export type EvidenceInspection =
  | { status: "FOUND"; inspection: any }
  | { status: "NOT_FOUND" }
  | { status: "UNAVAILABLE"; httpStatus?: number };

async function inspectCid(cid: string): Promise<EvidenceInspection> {
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}/api/ipfs/inspect/${encodeURIComponent(cid)}`);
  } catch {
    return { status: "UNAVAILABLE" };
  }
  if (res.status === 404) return { status: "NOT_FOUND" };
  if (!res.ok) return { status: "UNAVAILABLE", httpStatus: res.status };
  return { status: "FOUND", inspection: await res.json() };
}

export function useEvidenceInspection(cid: string) {
  return useQuery({
    queryKey: ["evidence-inspection", cid],
    queryFn: () => inspectCid(cid),
    enabled: cid.length > 0,
    retry: false,
  });
}

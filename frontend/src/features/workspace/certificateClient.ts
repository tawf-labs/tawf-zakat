/**
 * Talking to the distribution-stage certificate API (Spec #100, ticket #111).
 *
 * Every call here carries the workspace bearer requests, same as `evidenceClient.ts`. The
 * public verifier lives at a separate, unauthenticated surface (`fetchPublicCertificate`
 * below uses a plain fetch, never `PrivateRequests`) so a restricted field can never end up
 * reachable through this module by accident.
 */
import type { PrivateRequests } from "./privateRequests";
import type { CertificateIssuanceIntent, PublicCertificateSummary } from "../../../../shared/certificate-nft";

export type { CertificateIssuanceIntent, PublicCertificateSummary } from "../../../../shared/certificate-nft";

/** Confirmed vs. disputed/unconfirmed counts for the frozen scope; null until a certificate has
 * been prepared (nothing frozen yet). Never a realization or beneficiary reference. */
export type CertificateContentTotals = { confirmedCount: number; disputedCount: number; unconfirmedCount: number; totalRealizedIdr: string } | null;
export type CertificateStatus = { certificate: CertificateIssuanceIntent; contentTotals: CertificateContentTotals };

const path = (activityId: string, certificateId?: string) =>
  `/api/workspace/activities/${encodeURIComponent(activityId)}/certificates${certificateId ? `/${encodeURIComponent(certificateId)}` : ""}`;

export async function listCertificates(requests: PrivateRequests, activityId: string): Promise<CertificateIssuanceIntent[]> {
  const res = await requests.json<{ certificates: CertificateIssuanceIntent[] }>(path(activityId));
  return res.certificates;
}

export async function getCertificate(requests: PrivateRequests, activityId: string, certificateId: string): Promise<CertificateStatus> {
  return requests.json<CertificateStatus>(path(activityId, certificateId));
}

export async function prepareCertificate(requests: PrivateRequests, institutionId: string, activityId: string, certificateId: string): Promise<CertificateStatus> {
  return requests.json<CertificateStatus>(`${path(activityId, certificateId)}/prepare`, {
    method: "POST", body: JSON.stringify({ institutionId }),
  });
}

export async function submitCertificate(requests: PrivateRequests, institutionId: string, activityId: string, certificateId: string, signature: string): Promise<CertificateIssuanceIntent> {
  const res = await requests.json<{ certificate: CertificateIssuanceIntent }>(`${path(activityId, certificateId)}/submit`, {
    method: "POST", body: JSON.stringify({ institutionId, signature }),
  });
  return res.certificate;
}

export async function retryCertificate(requests: PrivateRequests, institutionId: string, activityId: string, certificateId: string): Promise<CertificateIssuanceIntent> {
  const res = await requests.json<{ certificate: CertificateIssuanceIntent }>(`${path(activityId, certificateId)}/retry`, {
    method: "POST", body: JSON.stringify({ institutionId }),
  });
  return res.certificate;
}

/** Unauthenticated by design: the same allowlisted aggregate any public reader may see. */
export async function fetchPublicCertificate(origin: string, institutionId: string, certificateId: string): Promise<PublicCertificateSummary> {
  const response = await fetch(`${origin}/api/public/certificates/${encodeURIComponent(institutionId)}/${encodeURIComponent(certificateId)}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(typeof payload?.error === "string" ? payload.error : "Sertifikat tidak ditemukan.");
  return payload.certificate as PublicCertificateSummary;
}

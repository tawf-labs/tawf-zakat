/**
 * Talking to the distribution-stage certificate API (Spec #100, ticket #111).
 *
 * Every call here carries the workspace bearer requests, same as `evidenceClient.ts`. The
 * public verifier lives at a separate, unauthenticated surface (`fetchPublicCertificate`
 * below uses a plain fetch, never `PrivateRequests`) so a restricted field can never end up
 * reachable through this module by accident.
 */
import type { PrivateRequests } from "./privateRequests";
import type { CertificateIssuanceIntent, CertificateLineStatus, CorrectionReason, CustodyRecoveryIntent } from "../../../../shared/certificate-nft";

export type { CertificateIssuanceIntent, CertificateLineStatus, CustodyRecoveryIntent, PublicCertificateSummary } from "../../../../shared/certificate-nft";

/** Confirmed vs. disputed/unconfirmed counts for the frozen scope; null until a certificate has
 * been prepared (nothing frozen yet). Never a realization or beneficiary reference. */
export type CertificateContentTotals = { confirmedCount: number; disputedCount: number; unconfirmedCount: number; totalRealizedIdr: string } | null;
export type CertificateStatus = { certificate: CertificateIssuanceIntent; contentTotals: CertificateContentTotals; line?: CertificateLineStatus };

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

/** Prepare the next version of an issued certificate; the officer then signs it like a first issuance. */
export async function prepareCorrection(requests: PrivateRequests, institutionId: string, activityId: string, certificateId: string, reason: CorrectionReason, note: string, expectedPredecessorVersion: string): Promise<CertificateStatus> {
  return requests.json<CertificateStatus>(`${path(activityId, certificateId)}/correct`, {
    method: "POST", body: JSON.stringify({ institutionId, reason, note, expectedPredecessorVersion }),
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

// Compatibility export; the public-only client is owned by the certificate feature.
export { fetchPublicCertificate } from "../certificates/certificateClient";

/** Custody recovery (#113): the target custodian is read from the contract by the server, never sent. */
const recoveriesPath = (activityId: string, certificateId: string) => `${path(activityId, certificateId)}/recoveries`;

export async function listRecoveries(requests: PrivateRequests, activityId: string, certificateId: string): Promise<CustodyRecoveryIntent[]> {
  return (await requests.json<{ recoveries: CustodyRecoveryIntent[] }>(recoveriesPath(activityId, certificateId))).recoveries;
}
export async function prepareRecovery(requests: PrivateRequests, institutionId: string, activityId: string, certificateId: string, decisionRef: string): Promise<CustodyRecoveryIntent> {
  return (await requests.json<{ recovery: CustodyRecoveryIntent }>(recoveriesPath(activityId, certificateId), {
    method: "POST", body: JSON.stringify({ institutionId, decisionRef }),
  })).recovery;
}
export async function getRecovery(requests: PrivateRequests, activityId: string, certificateId: string, recoveryId: string): Promise<CustodyRecoveryIntent> {
  return (await requests.json<{ recovery: CustodyRecoveryIntent }>(`${recoveriesPath(activityId, certificateId)}/${encodeURIComponent(recoveryId)}`)).recovery;
}
export async function sendRecovery(requests: PrivateRequests, step: "submit" | "retry", institutionId: string, activityId: string, certificateId: string, recoveryId: string, signature?: string): Promise<CustodyRecoveryIntent> {
  return (await requests.json<{ recovery: CustodyRecoveryIntent }>(`${recoveriesPath(activityId, certificateId)}/${encodeURIComponent(recoveryId)}/${step}`, {
    method: "POST", body: JSON.stringify({ institutionId, ...(signature ? { signature } : {}) }),
  })).recovery;
}

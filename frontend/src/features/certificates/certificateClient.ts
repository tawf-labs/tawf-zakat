import type { PublicCertificateSummary } from "../../../../shared/certificate-nft";

/** Public allowlisted aggregates only; never sends workspace credentials. */
export async function fetchPublicCertificate(
  origin: string, institutionId: string, certificateId: string, signal?: AbortSignal, version?: string,
): Promise<PublicCertificateSummary> {
  const response = await fetch(
    `${origin}/api/public/certificates/${encodeURIComponent(institutionId)}/${encodeURIComponent(certificateId)}${version ? `/versions/${encodeURIComponent(version)}` : ""}`,
    { cache: "no-store", credentials: "omit", signal },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !payload.certificate) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "Sertifikat tidak ditemukan.");
  }
  return payload.certificate;
}

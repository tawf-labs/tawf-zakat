import { createFileRoute } from "@tanstack/react-router";
import { CertificateVerifier } from "../features/certificates/CertificateVerifier";

interface SertifikatSearchParams {
  institutionId?: string;
  certificateId?: string;
  version?: string;
}

export const Route = createFileRoute("/sertifikat")({
  validateSearch: (search: Record<string, unknown>): SertifikatSearchParams => ({
    institutionId: typeof search.institutionId === "string" ? search.institutionId : undefined,
    certificateId: typeof search.certificateId === "string" ? search.certificateId : undefined,
    version: typeof search.version === "string" && search.version.trim()
      ? search.version.trim()
      : typeof search.version === "number" && Number.isSafeInteger(search.version) && search.version > 0
        ? String(search.version)
        : undefined,
  }),
  component: SertifikatPage,
});

function SertifikatPage() {
  const search = Route.useSearch();
  return <CertificateVerifier key={JSON.stringify(search)} {...search} />;
}

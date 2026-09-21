import { createFileRoute } from "@tanstack/react-router";
import { CertificateVerifier } from "../features/certificates/CertificateVerifier";

interface SertifikatSearchParams {
  institutionId?: string;
  certificateId?: string;
}

export const Route = createFileRoute("/sertifikat")({
  validateSearch: (search: Record<string, unknown>): SertifikatSearchParams => ({
    institutionId: typeof search.institutionId === "string" ? search.institutionId : undefined,
    certificateId: typeof search.certificateId === "string" ? search.certificateId : undefined,
  }),
  component: SertifikatPage,
});

function SertifikatPage() {
  const search = Route.useSearch();
  return <CertificateVerifier key={JSON.stringify(search)} {...search} />;
}

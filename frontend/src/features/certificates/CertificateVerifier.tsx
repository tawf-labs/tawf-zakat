import { useState } from "react";
import { PageHeader } from "../../components/layout/PageHeader";
import { Container } from "../../components/layout/Container";
import { CertificateSearchForm } from "./CertificateSearchForm";
import { CertificateResult } from "./CertificateResult";
import { usePublicCertificate, type CertificateLookup } from "./usePublicCertificate";

interface Props {
  institutionId?: string;
  certificateId?: string;
  /** A trace deep link must inspect the exact version that the reader saw. */
  version?: string;
}

export function CertificateVerifier({ institutionId = "", certificateId = "", version }: Props) {
  const [submitted, setSubmitted] = useState<CertificateLookup | null>(() =>
    institutionId.trim() && certificateId.trim()
      ? { institutionId: institutionId.trim(), certificateId: certificateId.trim(), ...(version?.trim() ? { version: version.trim() } : {}) }
      : null,
  );
  const query = usePublicCertificate(submitted);
  function verify(lookup: CertificateLookup) {
    if (submitted?.institutionId === lookup.institutionId && submitted.certificateId === lookup.certificateId && !submitted.version) {
      void query.refetch();
    } else {
      setSubmitted(lookup);
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f8f3]/30 pb-20 space-y-10">
      <PageHeader
        badgeText="Verifikasi Publik"
        title="Cek Sertifikat Tahap Distribusi"
        description="Periksa penerbit, keterikatan isi, dan status on-chain sebuah sertifikat tahap distribusi. Tidak ada identitas penerima manfaat yang ditampilkan di sini."
      />
      <Container>
        <CertificateSearchForm
          initialInstitutionId={institutionId}
          initialCertificateId={certificateId}
          onEdit={() => setSubmitted(null)}
          onVerify={verify}
        />
        {/* Query retains cached data on refetch errors. A current check must never
            present that earlier success as its verification result. */}
        {submitted && (
          query.fetchStatus === "paused"
            ? <p role="status" className="mt-8 text-sm text-stone-600">Pemeriksaan tertunda. Menunggu koneksi jaringan…</p>
            : query.isFetching || query.isPending
              ? <p role="status" className="mt-8 text-sm text-stone-600">Memeriksa sertifikat…</p>
              : query.isError
                ? <p role="alert" className="mt-8 text-sm text-red-700">{query.error.message}</p>
                : <CertificateResult certificate={query.data} viewingVersion={submitted.version ?? null}
                    onSelectVersion={(version) => setSubmitted({ institutionId: submitted.institutionId, certificateId: submitted.certificateId, ...(version ? { version } : {}) })} />
        )}
      </Container>
    </main>
  );
}

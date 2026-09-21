import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Container } from "../components/layout/Container";
import { Badge } from "../components/ui/Badge";
import { getApiBaseUrl } from "../lib/contracts";
import { fetchPublicCertificate } from "../features/workspace/certificateClient";
import type { PublicCertificateSummary } from "../../../shared/certificate-nft";

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

/** Public certificate verifier (Spec #100, #111): issuer, content-binding and chain status only.
 * No realization or beneficiary reference is ever fetched or rendered on this page. */
function SertifikatPage() {
  const search = Route.useSearch();
  const [institutionId, setInstitutionId] = useState(search.institutionId ?? "");
  const [certificateId, setCertificateId] = useState(search.certificateId ?? "");
  const [submitted, setSubmitted] = useState(
    search.institutionId && search.certificateId ? { institutionId: search.institutionId, certificateId: search.certificateId } : null,
  );

  return (
    <main className="min-h-screen bg-[#f4f8f3]/30 pb-20 space-y-10">
      <PageHeader
        badgeText="Verifikasi Publik"
        title="Cek Sertifikat Tahap Distribusi"
        description="Periksa penerbit, keterikatan isi, dan status on-chain sebuah sertifikat tahap distribusi. Tidak ada identitas penerima manfaat yang ditampilkan di sini."
      />
      <Container>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => { e.preventDefault(); if (institutionId.trim() && certificateId.trim()) setSubmitted({ institutionId: institutionId.trim(), certificateId: certificateId.trim() }); }}
        >
          <label className="flex-1 text-sm">
            ID Lembaga
            <input className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono" value={institutionId} onChange={(e) => setInstitutionId(e.target.value)} />
          </label>
          <label className="flex-1 text-sm">
            ID Sertifikat
            <input className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono" value={certificateId} onChange={(e) => setCertificateId(e.target.value)} />
          </label>
          <button type="submit" className="rounded-full bg-[#0F3D30] px-6 py-2.5 text-xs font-medium uppercase tracking-wider text-[#F9F6F0]">
            Periksa
          </button>
        </form>

        {submitted && <CertificateResult institutionId={submitted.institutionId} certificateId={submitted.certificateId} />}
      </Container>
    </main>
  );
}

function CertificateResult({ institutionId, certificateId }: { institutionId: string; certificateId: string }) {
  const [state, setState] = useState<{ loading: boolean; certificate: PublicCertificateSummary | null; error: string | null }>({ loading: true, certificate: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, certificate: null, error: null });
    fetchPublicCertificate(getApiBaseUrl(), institutionId, certificateId)
      .then((certificate) => { if (!cancelled) setState({ loading: false, certificate, error: null }); })
      .catch((error) => { if (!cancelled) setState({ loading: false, certificate: null, error: error instanceof Error ? error.message : "Sertifikat tidak ditemukan." }); });
    return () => { cancelled = true; };
  }, [institutionId, certificateId]);

  if (state.loading) return <p className="mt-8 text-sm text-stone-600">Memeriksa sertifikat…</p>;
  if (state.error) return <p role="alert" className="mt-8 text-sm text-red-700">{state.error}</p>;
  const c = state.certificate!;

  return (
    <div className="mt-8 rounded-2xl border border-[#dbe7dd] bg-[#f4f8f3]/80 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg font-bold text-[#17332c]">Sertifikat #{c.tokenId}</h3>
        <Badge variant={c.observation.state === "CONFIRMED" ? "success" : c.observation.state === "REVERTED" ? "danger" : "info"}>{c.observation.state}</Badge>
      </div>
      <div className="grid grid-cols-1 gap-2.5 text-xs sm:grid-cols-3">
        <div className="rounded-xl border border-[#dbe7dd] bg-white p-2.5">
          <span className="text-[10px] font-semibold uppercase text-[#5e7a70]">Terkonfirmasi</span>
          <p className="mt-0.5 font-bold text-emerald-700">{c.totals.confirmedCount}</p>
        </div>
        <div className="rounded-xl border border-[#dbe7dd] bg-white p-2.5">
          <span className="text-[10px] font-semibold uppercase text-[#5e7a70]">Belum terkonfirmasi</span>
          <p className="mt-0.5 font-bold text-amber-700">{c.totals.unconfirmedCount}</p>
        </div>
        <div className="rounded-xl border border-[#dbe7dd] bg-white p-2.5">
          <span className="text-[10px] font-semibold uppercase text-[#5e7a70]">Diperselisihkan</span>
          <p className="mt-0.5 font-bold text-red-700">{c.totals.disputedCount}</p>
        </div>
      </div>
      <p className="break-all font-mono text-[11px] text-[#5e7a70]">
        Lembaga {c.institutionId} · Kegiatan {c.activityId} · Versi {c.version}<br />
        Penerbit {c.issuer}<br />
        Akun pemegang (lembaga) {c.custodian}<br />
        Keterikatan isi {c.contentDigest}
      </p>
      <p className="text-[11px] text-[#5e7a70]">
        Token ini terkunci pada akun lembaga dan tidak dapat dipindahtangankan atau diperdagangkan.
        Isi sertifikat tidak menampilkan identitas penerima manfaat.
      </p>
    </div>
  );
}

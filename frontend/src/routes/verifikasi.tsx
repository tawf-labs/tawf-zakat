import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "../components/layout/PageHeader";
import { Container } from "../components/layout/Container";
import { SearchReceiptForm } from "../features/verification";

interface VerifikasiSearchParams {
  trxId?: string;
}

export const Route = createFileRoute("/verifikasi")({
  validateSearch: (search: Record<string, unknown>): VerifikasiSearchParams => {
    return {
      trxId: typeof search.trxId === "string" ? search.trxId : undefined,
    };
  },
  component: VerifikasiPage,
});

function VerifikasiPage() {
  const search = Route.useSearch();

  return (
    <main className="min-h-screen bg-[#f4f8f3]/30 pb-20 space-y-10">
      <PageHeader
        badgeText="Verifikasi Digital Mandiri"
        title="Cek Bukti & Sertifikat Donasi"
        description="Masukkan nomor transaksi Anda (contoh: TRX-…) untuk memastikan donasi tercatat dengan benar dan tidak dapat diubah diam-diam. Gratis dan tanpa dompet digital."
      />

      <Container>
        <SearchReceiptForm initialTrxId={search.trxId || ""} />
      </Container>
    </main>
  );
}

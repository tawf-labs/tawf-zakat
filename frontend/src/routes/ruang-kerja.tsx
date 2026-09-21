import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "../components/layout/PageHeader";
import { Container } from "../components/layout/Container";
import { WorkspacePanel } from "../features/workspace";

export const Route = createFileRoute("/ruang-kerja")({
  component: RuangKerjaPage,
});

function RuangKerjaPage() {
  return (
    <main className="min-h-screen space-y-10 bg-[#f4f8f3]/30 pb-20">
      <PageHeader
        badgeText="Ruang Kerja Lembaga"
        title="Satu Lembaga, Satu Ruang Kerja"
        description="Petugas masuk dengan menandatangani pesan sekali pakai di dompet digital, bukan dengan mengetik alamat. Lembaga yang Anda wakili ditentukan oleh keanggotaan Anda — bukan oleh isi permintaan — dan setiap penolakan terjadi di server, bukan sekadar disembunyikan di tampilan."
      />

      <Container>
        <WorkspacePanel />
      </Container>
    </main>
  );
}

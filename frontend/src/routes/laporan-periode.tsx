import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "../components/layout/PageHeader";
import { Container } from "../components/layout/Container";
import { PeriodReportWorkbench } from "../features/periodReport";

export const Route = createFileRoute("/laporan-periode")({
  component: LaporanPeriodePage,
});

function LaporanPeriodePage() {
  return (
    <main className="min-h-screen space-y-10 bg-[#f4f8f3]/30 pb-20">
      <PageHeader
        badgeText="Laporan Periode Terverifikasi"
        title="Angkanya Diperiksa Sebelum Ditandatangani"
        description="Sistem menghitung angka periode dari ledger, mesin menyusun narasinya, lalu validator deterministik memeriksa setiap angka yang diklaim. Draf yang angkanya menyimpang ditolak - bukan diberi peringatan."
      />

      <Container>
        <PeriodReportWorkbench />
      </Container>
    </main>
  );
}

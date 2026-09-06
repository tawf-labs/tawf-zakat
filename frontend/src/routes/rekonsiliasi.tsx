import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "../components/layout/PageHeader";
import { Container } from "../components/layout/Container";
import { ReconciliationWorkbench } from "../features/reconciliation";

export const Route = createFileRoute("/rekonsiliasi")({
  component: RekonsiliasiPage,
});

function RekonsiliasiPage() {
  return (
    <main className="min-h-screen space-y-10 bg-[#f4f8f3]/30 pb-20">
      <PageHeader
        badgeText="Mesin Rekonsiliasi"
        title="Cek Selisih Laporan Sebelum Dikirim"
        description="Bandingkan rekap Laporan Zakat Wilayah yang Anda susun dengan Laporan Kinerja dari Pengelola Zakat di wilayah Anda. Setiap selisih ditunjukkan beserta lembaga, jenis dana, dan nilai rupiahnya."
      />

      <Container>
        <ReconciliationWorkbench />
      </Container>
    </main>
  );
}

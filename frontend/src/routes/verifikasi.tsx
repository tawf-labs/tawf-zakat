import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "../components/layout/PageHeader";
import { Container } from "../components/layout/Container";
import { SearchReceiptForm } from "../features/verification";
import { CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";

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
        description="Masukkan ID Transaksi atau Hash NIK Anda untuk memastikan donasi telah tercatat secara permanen dan sah dalam buku besar digital tanpa biaya gas."
      />

      <Container>
        <SearchReceiptForm initialTrxId={search.trxId || ""} />
      </Container>
    </main>
  );
}

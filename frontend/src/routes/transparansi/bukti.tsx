import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "../../components/layout/PageHeader";
import { Container } from "../../components/layout/Container";
import { EvidenceViewer } from "../../features/evidence";

interface BuktiSearchParams {
  cid?: string;
}

export const Route = createFileRoute("/transparansi/bukti")({
  validateSearch: (search: Record<string, unknown>): BuktiSearchParams => {
    return {
      cid: typeof search.cid === "string" ? search.cid : undefined,
    };
  },
  component: BuktiPage,
});

function BuktiPage() {
  const search = Route.useSearch();

  return (
    <main className="min-h-screen bg-[#f4f8f3]/30 pb-20 space-y-10">
      <PageHeader
        badgeText="Universal Evidence Inspector"
        title="Pusat Pembuktian Berkas IPFS"
        description="Pemeriksaan dokumen fisik Berita Acara Serah Terima (BAST), berkas survei mustahik, metadata terstruktur v1.1.0, dan rekonsiliasi integritas smart contract Sepolia L1."
      />

      <Container>
        <EvidenceViewer initialCid={search.cid || ""} />
      </Container>
    </main>
  );
}

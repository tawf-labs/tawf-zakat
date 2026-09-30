import { createFileRoute } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { Container } from "../components/layout/Container";
import { WorkspacePanel } from "../features/workspace";

export const Route = createFileRoute("/ruang-kerja")({
  component: RuangKerjaPage,
});

function RuangKerjaPage() {
  return (
    <main className="min-h-screen bg-[#f4f8f3]/50 pb-12">
      <div className="border-b border-[#dbe7dd] bg-white">
        <Container className="py-5 sm:py-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#dbe7dd] bg-[#f4f8f3] text-[#1b765e]"><Building2 className="h-5 w-5" aria-hidden="true" /></span>
            <div><h1 className="font-serif text-2xl font-bold tracking-tight text-[#17332c]">Ruang Kerja Lembaga</h1>
              <p className="mt-1 text-sm leading-relaxed text-stone-600">Satu lembaga, satu ruang kerja. Akses sesuai keanggotaan dan mandat Anda.</p></div>
          </div>
        </Container>
      </div>
      <Container className="pt-5 sm:pt-6">
        <WorkspacePanel />
      </Container>
    </main>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { Container } from "../components/layout/Container";
import { WorkspacePanel } from "../features/workspace";

export const Route = createFileRoute("/ruang-kerja")({
  component: RuangKerjaPage,
});

function RuangKerjaPage() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f4f8f3]/50 pb-0">
      <Container className="pt-4 pb-0">
        <WorkspacePanel />
      </Container>
    </main>
  );
}

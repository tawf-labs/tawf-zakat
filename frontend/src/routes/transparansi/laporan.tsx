import { createFileRoute } from "@tanstack/react-router";
import { PublicReport } from "../../features/reports/PublicReport";
export const Route = createFileRoute("/transparansi/laporan")({
  validateSearch: (search: Record<string, unknown>) => ({ packageId: typeof search.packageId === "string" ? search.packageId : "" }),
  head: () => ({ meta: [{ title: "Ringkasan laporan periode | Tawf" }, { name: "description", content: "Ringkasan publik versi laporan, cakupan pemeriksaan, temuan, dan referensi registry." }] }),
  component: Page,
});
function Page() {
  const { packageId } = Route.useSearch();
  return <main className="mx-auto max-w-4xl space-y-5 px-5 py-10"><h1 className="text-2xl font-bold">Ringkasan publik laporan periode</h1><PublicReport packageId={packageId} /></main>;
}

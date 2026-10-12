import { createFileRoute } from "@tanstack/react-router";
import { CrowdfundingHome } from "../features/crowdfunding/PublicCampaigns";

export const Route = createFileRoute("/kampanye/")({
  validateSearch: (search: Record<string, unknown>): { kategori?: string } =>
    typeof search.kategori === "string" ? { kategori: search.kategori } : {},
  component: CampaignsPage,
});

function CampaignsPage() {
  const { kategori } = Route.useSearch();
  return <CrowdfundingHome key={kategori} initialCategory={kategori} />;
}

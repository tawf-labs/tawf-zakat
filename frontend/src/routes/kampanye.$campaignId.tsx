import { createFileRoute } from "@tanstack/react-router";
import { CampaignDetail } from "../features/crowdfunding/CampaignDetail";

export const Route = createFileRoute("/kampanye/$campaignId")({
  component: Page,
});
function Page() {
  const { campaignId } = Route.useParams();
  return <CampaignDetail key={campaignId} campaignId={campaignId} />;
}

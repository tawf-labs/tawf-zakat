import { createFileRoute } from "@tanstack/react-router";
import { CrowdfundingHome } from "../features/crowdfunding/PublicCampaigns";

export const Route = createFileRoute("/kampanye/")({
  component: CrowdfundingHome,
});

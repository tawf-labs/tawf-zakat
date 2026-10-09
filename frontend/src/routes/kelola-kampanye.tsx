import { createFileRoute } from "@tanstack/react-router";
import { ManageCampaigns } from "../features/crowdfunding/ManageCampaigns";

export const Route = createFileRoute("/kelola-kampanye")({
  component: ManageCampaigns,
});

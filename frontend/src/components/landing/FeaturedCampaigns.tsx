import React from "react";
import { campaigns } from "../../data/campaigns";
import { CampaignCard } from "./CampaignCard";

export function FeaturedCampaigns() {
  return (
    <section className="featured-section bg-[#f4f8f3]/50" id="campaigns">
      <div className="shell">
        <div className="section-heading-row">
          <div className="section-heading">
            <p className="eyebrow">
              <span className="eyebrow-dot" /> Verified Direct Impact
            </p>
            <h2>
              Featured<br />
              <em>Campaigns.</em>
            </h2>
            <p className="section-subtext">
              Support verified projects and track your transparent impact on the blockchain.
            </p>
          </div>

          <a href="#donate" className="text-link">
            View all campaigns <span>↗</span>
          </a>
        </div>

        <div className="featured-grid">
          {campaigns.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} />
          ))}
        </div>
      </div>
    </section>
  );
}

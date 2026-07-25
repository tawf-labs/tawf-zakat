"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CampaignCard } from "@/components/shared/campaign-card";
import { useCampaigns } from "@/hooks/useCampaigns";

export function FeaturedCampaigns() {
  // Reads real campaign pools from ZKTCore. This previously rendered the
  // static @/data/campaigns array, so the homepage advertised campaigns that
  // did not exist on chain.
  const { campaigns, isLoading, error } = useCampaigns();
  const featuredCampaigns = campaigns.slice(0, 3);

  return (
    <section className="py-16 md:py-24 px-4 sm:px-6 bg-background">
      <div className="container mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-4">
          <div className="space-y-3">
            {/* Updated H2 size per guidelines: 40px/36px */}
            <h2 className="font-serif text-[36px] md:text-[40px] font-bold text-foreground">Featured Campaigns</h2>
            <p className="text-muted-foreground max-w-2xl">
              Support verified projects and track your impact on the blockchain.
            </p>
          </div>

          <Link href="/campaigns">
            <button className="inline-flex items-center justify-center gap-2 rounded-full border border-primary/20 text-sm font-medium transition-all h-11 px-6 group hover:bg-primary hover:text-primary-foreground hover:-translate-y-0.5 min-h-[44px]">
              <span className="uppercase tracking-wide-label">View all campaigns</span>
              <ArrowRight className="h-4 w-4 ml-2 transition-transform group-hover:translate-x-1" />
            </button>
          </Link>
        </div>

        {/* Grid - gap-6 = 24px per guidelines */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-80 rounded-xl border border-border bg-muted/40 animate-pulse"
              />
            ))}
          </div>
        ) : error || featuredCampaigns.length === 0 ? (
          <div className="rounded-xl border border-border bg-muted/30 p-10 text-center">
            <p className="text-muted-foreground">
              {error
                ? "Could not load campaigns from the network right now."
                : "No active campaigns yet. Check back soon."}
            </p>
            <Link href="/campaigns" className="mt-4 inline-block text-primary hover:underline">
              Browse all campaigns
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {featuredCampaigns.map((campaign) => (
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                priority  // All featured campaigns are above-the-fold
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

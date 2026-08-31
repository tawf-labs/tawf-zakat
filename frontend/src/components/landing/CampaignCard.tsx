import React from "react";
import { Users, Clock, CircleCheck, ArrowUpRight } from "lucide-react";
import { type Campaign, formatCurrency } from "../../data/campaigns";

interface CampaignCardProps {
  campaign: Campaign;
  onDonate?: () => void;
}

export function CampaignCard({ campaign, onDonate }: CampaignCardProps) {
  const progressPercent = Math.min((campaign.raised / campaign.goal) * 100, 100);

  const handleDonateClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDonate) {
      onDonate();
    } else {
      const el = document.getElementById("donate");
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="bg-white text-[#17332c] rounded-2xl border border-[#dbe7dd] hover:border-[#1b765e] hover:shadow-xl transition-all duration-300 group h-full flex flex-col overflow-hidden relative">
      {/* Image Thumbnail & Badges */}
      <div className="relative h-52 overflow-hidden bg-[#f4f8f3]">
        <img
          src={campaign.image}
          alt={campaign.title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10" />

        {/* Top Badges */}
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <span className="inline-flex items-center justify-center rounded-full px-3 py-1 text-xs font-semibold bg-white/95 text-[#1b765e] backdrop-blur-md shadow-xs">
            {campaign.category}
          </span>
          <span className="inline-flex items-center gap-1.5 bg-[#eaf3e8] text-[#1b765e] border border-[#1b765e]/20 px-2.5 py-1 rounded-full text-xs font-semibold shadow-xs">
            <span className="h-2 w-2 rounded-full bg-[#1b765e] animate-pulse" />
            Active
          </span>
        </div>

        {/* Verified Badge */}
        <div className="absolute bottom-3 right-3">
          <span className="inline-flex items-center gap-1.5 bg-[#1b765e] text-white px-2.5 py-1 rounded-full text-xs font-medium shadow-md">
            <CircleCheck className="h-3.5 w-3.5" />
            Verified Partner
          </span>
        </div>
      </div>

      {/* Content Header */}
      <div className="p-6 pb-3 flex-1 flex flex-col justify-between space-y-3">
        <div>
          <div className="text-xs text-[#6a8279] font-medium flex items-center gap-1.5 mb-2">
            <span>by</span>
            <span className="text-[#1b765e] font-semibold hover:underline">
              {campaign.organization}
            </span>
          </div>

          <h3 className="font-bold text-lg leading-snug tracking-tight text-[#17332c] line-clamp-2 group-hover:text-[#1b765e] transition-colors">
            {campaign.title}
          </h3>
        </div>

        {/* Progress Bar & Statistics */}
        <div className="space-y-3 pt-2">
          <div className="flex justify-between items-baseline text-sm">
            <span className="font-bold text-[#17332c] font-mono text-base">
              {formatCurrency(campaign.raised)}
            </span>
            <span className="text-xs text-[#6a8279]">
              of <strong className="font-mono text-[#17332c]">{formatCurrency(campaign.goal)}</strong>
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-2.5 bg-[#eaf3e8] rounded-full overflow-hidden">
            <div
              className="bg-[#1b765e] h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Meta Info */}
          <div className="flex justify-between items-center text-xs text-[#6a8279] pt-1">
            <div className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-[#1b765e]" />
              <span className="font-medium text-[#17332c]">
                {campaign.donors.toLocaleString()} donors
              </span>
            </div>

            <div className="flex items-center gap-1.5 bg-[#f4f8f3] px-2.5 py-1 rounded-full border border-[#dbe7dd]">
              <Clock className="h-3.5 w-3.5 text-[#1b765e]" />
              <span className="font-semibold text-[#17332c]">
                {campaign.daysLeft} days left
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Donate Action */}
      <div className="p-6 pt-0">
        <button
          onClick={handleDonateClick}
          className="w-full h-11 rounded-full bg-[#1b765e] hover:bg-[#143f34] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 shadow-sm group-hover:shadow-md cursor-pointer"
        >
          Donate Now <ArrowUpRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

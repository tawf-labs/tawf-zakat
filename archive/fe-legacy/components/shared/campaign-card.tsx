"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Users, Clock, CircleCheck } from "lucide-react";
import { Campaign } from "@/hooks/useCampaigns";
import { DonationDialog } from "@/components/donations/donation-dialog";
import { Heart } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";

interface CampaignCardProps {
  campaign: Campaign;
  onDonationSuccess?: () => void;
  priority?: boolean;  // Enable priority loading for above-the-fold images
}

const calculateProgress = (raised: number, goal: number) => {
  const progress = (raised / goal) * 100;
  return Math.min(progress, 100) - 100;
};

const formatCurrency = (amount: number) => {
  return `${amount.toLocaleString('id-ID', { maximumFractionDigits: 0 })} IDRX`;
};

// Real-time daysLeft calculator
const calculateRealTimeDaysLeft = (endDate: number): number => {
  const now = Math.floor(Date.now() / 1000);
  const daysLeft = Math.ceil((endDate - now) / 86400);
  return Math.max(daysLeft, 0);
};

export function CampaignCard({ campaign, onDonationSuccess, priority = false }: CampaignCardProps) {
  const { t } = useLanguage()
  const router = useRouter();
  const [showDonationDialog, setShowDonationDialog] = useState(false);
  const [daysLeft, setDaysLeft] = useState(calculateRealTimeDaysLeft(campaign.endDate));
  const [raisedAmount, setRaisedAmount] = useState(campaign.raised);
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const progress = calculateProgress(raisedAmount, campaign.goal);

  const imageUrl = campaign.image || campaign.imageUrl || "https://images.unsplash.com/photo-1532629345422-7515f3d16bb6?w=500";

  const handleCardClick = () => {
    // Use slug-based URL for cleaner campaign links
    const slug = campaign.slug || `c-${campaign.id}`;
    router.push(`/zakat/${slug}`);
  };

  const handleDonateClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDonationDialog(true);
  };

  // Real-time countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setDaysLeft(calculateRealTimeDaysLeft(campaign.endDate));
    }, 60_000); // Update every minute for efficiency

    return () => clearInterval(timer);
  }, [campaign.endDate]);

  // Sync raised amount with campaign prop
  useEffect(() => {
    setRaisedAmount(campaign.raised);
  }, [campaign.raised]);

  return (
    <div
      onClick={handleCardClick}
      className="bg-card text-card-foreground rounded-2xl gap-6 border border-primary/10 hover:shadow-xl hover:border-primary/30 transition-all duration-300 group h-full flex flex-col cursor-pointer overflow-hidden"
    >
      <div className="relative h-56 overflow-hidden rounded-t-2xl bg-secondary/20">
        {isImageLoading && !imageError && (
          <div className="absolute inset-0 bg-primary/10 animate-pulse" />
        )}
        <Image
          src={imageError ? "https://images.unsplash.com/photo-1532629345422-7515f3d16bb6?w=500" : imageUrl}
          alt={campaign.title}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className={`object-cover transition-all duration-500 group-hover:scale-105 ${isImageLoading ? 'opacity-0' : 'opacity-100'}`}
          placeholder="blur"
          blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAhEAACAQMDBQAAAAAAAAAAAAABAgMABAUGIWGRkqGx0f/EABUBAQEAAAAAAAAAAAAAAAAAAAMF/8QAGhEAAgIDAAAAAAAAAAAAAAAAAAECEgMRMv/aAAwDAQACEQMRAD8AltJagyeH0AthI5xdrLcNM91BF5pX2HaH9bcfaSXWGaRmknyJckliyjqTzSlT54b6bk+h0R+xOJPrsHn1lkfU+nBlpWEXii0PH/iH8WIa/SPzH5IVeVP/xPF"
          priority={priority}
          onLoad={() => setIsImageLoading(false)}
          onError={() => {
            setImageError(true);
            setIsImageLoading(false);
          }}
        />

        {/* Better overlay gradient */}
        <div className="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity" />

        <div className="absolute top-3 left-3 flex flex-col gap-1.5 sm:gap-2 sm:top-4 sm:left-4">
          {/* Updated with uppercase tracking-wide-label per guidelines */}
          <span className="inline-flex items-center justify-center rounded-full px-3 py-1 sm:px-4 sm:py-1.5 text-xs font-semibold bg-white/95 backdrop-blur-sm border border-primary/10 text-primary w-fit uppercase tracking-wide-label">
            {campaign.category || "General"}
          </span>
          {/* NEW: Families Helped Badge */}
          {campaign.familiesHelped && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full bg-primary/95 backdrop-blur-sm text-white text-xs font-medium shadow-md">
              <Heart className="h-3 w-3 fill-white" />
              <span className="truncate max-w-[100px]">{campaign.familiesHelped} {t("campaign.familiesHelped")}</span>
            </span>
          )}
        </div>

        <div className="absolute bottom-3 right-3 sm:bottom-4 sm:right-4">
          {/* Updated with uppercase tracking-wide-label per guidelines */}
          <span className="inline-flex items-center gap-1 bg-primary text-primary-foreground px-2.5 py-1.5 sm:px-3 sm:py-1.5 rounded-full text-xs font-medium shadow-md uppercase tracking-wide-label">
            <CircleCheck className="h-3 w-3" /> {campaign.isVerified ? t("campaign.verified") : t("campaign.unverified")}
          </span>
        </div>
      </div>

      <div className="@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 p-4 sm:p-6 pb-2 space-y-2">
        <div className="text-xs text-muted-foreground font-medium flex items-center gap-1">
          {t("campaign.by")}{" "}
          <span className="text-primary font-semibold hover:underline cursor-pointer line-clamp-1">
            {campaign.organizationName || "Unknown"}
          </span>
        </div>

        <h3 className="font-serif font-extrabold text-base sm:text-lg leading-snug line-clamp-2 group-hover:text-primary transition-colors">
          {campaign.title}
        </h3>
      </div>

      <div className="p-4 sm:p-6 pt-2 flex-1">
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="font-bold text-foreground">
              {formatCurrency(campaign.raised)}
            </span>
            <span className="text-muted-foreground">
              of {formatCurrency(campaign.goal)}
            </span>
          </div>

          <div className="w-full h-2.5 bg-secondary/20 rounded-full overflow-hidden shadow-inner">
            <div
              className="bg-primary h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min((campaign.raised / campaign.goal) * 100, 100)}%` }}
            />
          </div>

          <div className="flex justify-between items-center text-xs text-muted-foreground pt-1">
            <div className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              <span>{campaign.donors.toLocaleString()} {t("campaign.donors")}</span>
            </div>

            {/* Updated with uppercase tracking-wide-label per guidelines */}
            <div className="flex items-center gap-1 bg-secondary/30 px-3 py-1.5 rounded-full">
              <Clock className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground uppercase tracking-wide-label">
                {campaign.daysLeft} {t("campaign.daysLeft")}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 pt-0">
        {/* Updated with uppercase tracking-wide-label per guidelines */}
        <button
          onClick={handleDonateClick}
          className="btn-touch-target w-full h-12 rounded-full bg-primary text-primary-foreground font-semibold hover:bg-primary/90 hover:shadow-md hover:shadow-primary/20 transition-all uppercase tracking-wide-label"
        >
          {t("campaign.donate")}
        </button>
      </div>

      <DonationDialog
        open={showDonationDialog}
        onOpenChange={setShowDonationDialog}
        campaignId={campaign.id}
        campaignTitle={campaign.title}
        campaignGoal={campaign.goal}
        campaignRaised={campaign.raised}
      />
    </div>
  );
}

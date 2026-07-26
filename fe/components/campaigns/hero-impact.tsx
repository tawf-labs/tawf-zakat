"use client";

import Image from "next/image";
import { Heart, ArrowRight } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";

interface HeroImpactProps {
  beneficiaryName: string;
  beneficiaryQuote: string;
  beneficiaryPhoto: string;
  impactMetrics: {
    familiesHelped: number;
    peopleReached: number;
  };
  raised: number;
  goal: number;
  formatCurrency: (amount: number) => string;
  onDonateClick?: () => void;
}

export function HeroImpact({
  beneficiaryName,
  beneficiaryQuote,
  beneficiaryPhoto,
  impactMetrics,
  raised,
  goal,
  formatCurrency,
  onDonateClick,
}: HeroImpactProps) {
  const { t } = useLanguage();
  const progress = Math.min((raised / goal) * 100, 100);

  return (
    <div className="relative overflow-hidden rounded-2xl bg-primary/10 border border-primary/20">
      <div className="grid md:grid-cols-2 gap-6 p-6 lg:p-8">
        {/* Beneficiary Photo */}
        <div className="relative aspect-[4/3] rounded-xl overflow-hidden">
          <Image
            src={beneficiaryPhoto}
            alt={t("impact.beneficiaryPhotoAlt").replace("{name}", beneficiaryName)}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 50vw"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4">
            <div className="flex items-center gap-2 text-white">
              <Heart className="h-4 w-4 fill-red-500 text-red-500" />
              <span className="text-sm font-medium">{t("impact.beneficiaryStory")}</span>
            </div>
          </div>
        </div>

        {/* Impact Numbers & Quote */}
        <div className="flex flex-col justify-center space-y-6">
          {/* Impact Numbers */}
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20">
              <Heart className="h-4 w-4 text-primary fill-primary/20" />
              <span className="text-sm font-semibold text-primary uppercase tracking-wide">
                {t("impact.yourImpactInAction")}
              </span>
            </div>

            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl lg:text-5xl font-bold text-foreground">
                  {impactMetrics.familiesHelped.toLocaleString()}
                </span>
                <span className="text-lg text-muted-foreground">
                  {t("impact.familiesImpacted")}
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-muted-foreground">
                  {impactMetrics.peopleReached.toLocaleString()}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t("impact.peopleReached")}
                </span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-semibold text-foreground">
                  {formatCurrency(raised)}
                </span>
                <span className="text-muted-foreground">
                  {t("campaigns.of")} {formatCurrency(goal)}
                </span>
              </div>
              <div className="w-full h-3 bg-secondary/50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-primary">
                  {Math.round(progress)}%
                </span>
                <span className="text-sm text-muted-foreground ml-1">{t("impact.funded")}</span>
              </div>
            </div>
          </div>

          {/* Quote */}
          {beneficiaryQuote && (
            <div className="relative">
              <div className="absolute -top-2 -left-2 text-6xl text-primary/20 font-serif">&ldquo;</div>
              <blockquote className="relative pl-6 italic text-foreground/90 leading-relaxed">
                {beneficiaryQuote}
              </blockquote>
              <div className="relative pr-6 mt-2 text-right">
                <cite className="text-sm font-semibold text-primary not-italic">
                  - {beneficiaryName}
                </cite>
              </div>
            </div>
          )}

          {/* Donate Now CTA Button */}
          {onDonateClick && (
            <button
              onClick={onDonateClick}
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition-all shadow-lg hover:shadow-xl"
            >
              {t("campaign.donate")}
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Decorative gradient */}
      <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
    </div>
  );
}

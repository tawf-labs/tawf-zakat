"use client";

import { useState } from "react";
import { Heart, Gift } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";

interface ImpactCalculatorProps {
  impactCalculator: Array<{
    amount: number;
    impact: string;
    icon: string;
  }>;
  formatCurrency: (amount: number) => string;
}

export function ImpactCalculator({ impactCalculator, formatCurrency }: ImpactCalculatorProps) {
  const { t } = useLanguage();
  const [hoveredAmount, setHoveredAmount] = useState<number | null>(null);

  const currentImpact = hoveredAmount
    ? impactCalculator.find((item) => item.amount === hoveredAmount)
    : impactCalculator[Math.floor(impactCalculator.length / 2)];

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Gift className="h-5 w-5 text-primary" />
        <h3 className="font-bold text-lg">{t("impact.title")}</h3>
      </div>

      {/* Impact Preview */}
      <div className="bg-primary/10 rounded-lg p-4 border border-primary/20">
        <div className="flex items-center gap-3">
          <span className="text-4xl">{currentImpact?.icon || "♥"}</span>
          <div>
            <p className="text-sm text-muted-foreground">{t("impact.donationProvides")}</p>
            <p className="text-lg font-semibold text-foreground">
              {currentImpact?.impact || "Support for families"}
            </p>
          </div>
        </div>
      </div>

      {/* Impact Options */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">{t("impact.selectAmount")}</p>
        <div className="grid grid-cols-2 gap-2">
          {impactCalculator.map((item) => (
            <button
              key={item.amount}
              onMouseEnter={() => setHoveredAmount(item.amount)}
              onMouseLeave={() => setHoveredAmount(null)}
              onClick={() => setHoveredAmount(item.amount)}
              className={`
                flex items-center gap-2 p-3 rounded-lg border-2 transition-all text-left
                ${hoveredAmount === item.amount
                  ? 'border-primary bg-primary/10 shadow-sm'
                  : 'border-border hover:border-primary/50 hover:bg-accent'
                }
              `}
            >
              <span className="text-xl">{item.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">
                  {(item.amount / 1000).toFixed(0)}K
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {item.impact}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Progress to Next Tier */}
      {hoveredAmount && (
        <div className="pt-3 border-t border-border">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-muted-foreground">{t("impact.progressToNextTier")}</span>
            <span className="font-medium text-primary">{t("impact.almostThere")}</span>
          </div>
          <div className="w-full h-2 bg-secondary/50 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-primary/50 to-primary rounded-full w-3/4 animate-pulse" />
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="pt-3 border-t border-border">
        <p className="text-xs text-center text-muted-foreground">
          <Heart className="h-3 w-3 inline fill-red-500 text-red-500 mx-1" />
          {t("impact.everyDonation")}
        </p>
      </div>
    </div>
  );
}

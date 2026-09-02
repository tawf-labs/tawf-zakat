import React from "react";
import {
  HeartHandshake,
  ShieldCheck,
  Landmark,
  Globe,
  Building2,
  Heart,
  Sparkles,
  Coins,
  Scale,
  Wallet,
  Feather,
  Lock,
  Award,
  RefreshCw,
} from "lucide-react";

const row1Logos = [
  { name: "Global Relief Trust", icon: HeartHandshake },
  { name: "Crescent Aid Org", icon: ShieldCheck },
  { name: "Zakat Foundation", icon: Landmark },
  { name: "Islamic Relief Int.", icon: Globe },
  { name: "Direct Aid Network", icon: Building2 },
  { name: "Pure Heart Foundation", icon: Heart },
  { name: "Hope Worldwide", icon: Sparkles },
];

const row2Logos = [
  { name: "Sadaqah Trust Fund", icon: Coins },
  { name: "Amanah Governance", icon: Scale },
  { name: "FaithFund Network", icon: Wallet },
  { name: "Mercy Worldwide", icon: Feather },
  { name: "TransparentPay", icon: Lock },
  { name: "Barakah Charity", icon: Award },
  { name: "Global Ummah Aid", icon: RefreshCw },
];

export function MarqueeLogos() {
  return (
    <section className="marquee-section">
      <p className="marquee-title">Trusted by leading global relief & charity partners</p>

      <div className="marquee-wrapper">
        {/* Row 1: Forward Marquee */}
        <div className="marquee">
          <div className="marquee_group">
            {row1Logos.map((item, index) => {
              const Icon = item.icon;
              return (
                <div key={`r1-1-${index}`} className="marquee-item">
                  <Icon size={20} />
                  <span>{item.name}</span>
                </div>
              );
            })}
          </div>
          <div className="marquee_group" aria-hidden="true">
            {row1Logos.map((item, index) => {
              const Icon = item.icon;
              return (
                <div key={`r1-2-${index}`} className="marquee-item">
                  <Icon size={20} />
                  <span>{item.name}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Row 2: Reverse Marquee */}
        <div className="marquee marquee-reverse">
          <div className="marquee_group">
            {row2Logos.map((item, index) => {
              const Icon = item.icon;
              return (
                <div key={`r2-1-${index}`} className="marquee-item">
                  <Icon size={20} />
                  <span>{item.name}</span>
                </div>
              );
            })}
          </div>
          <div className="marquee_group" aria-hidden="true">
            {row2Logos.map((item, index) => {
              const Icon = item.icon;
              return (
                <div key={`r2-2-${index}`} className="marquee-item">
                  <Icon size={20} />
                  <span>{item.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

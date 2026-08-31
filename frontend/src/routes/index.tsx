import { createFileRoute } from "@tanstack/react-router";
import { Hero } from "../components/landing/Hero";
import { MarqueeLogos } from "../components/landing/MarqueeLogos";
import { WhySection } from "../components/landing/WhySection";
import { FeaturedCampaigns } from "../components/landing/FeaturedCampaigns";
import { HowItWorks } from "../components/landing/HowItWorks";
import { DonateSection } from "../components/donation/DonateSection";
import { MerkleVerifier } from "../components/verification/MerkleVerifier";
import { TransparencyDashboard } from "../components/dashboard/TransparencyDashboard";
import { GovernanceSection } from "../components/governance/GovernanceSection";
import { ClosingSection } from "../components/landing/ClosingSection";

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
  return (
    <main className="min-h-screen bg-white text-[#17332c] selection:bg-[#c4ed70]/40">
      {/* 1. Hero Section */}
      <Hero />

      {/* 2. Partner Marquee */}
      <MarqueeLogos />

      {/* 3. Value Proposition & Pillars */}
      <WhySection />

      {/* 4. Featured Campaigns Grid */}
      <FeaturedCampaigns />

      {/* 5. How It Works - Step by Step Flow */}
      <HowItWorks />

      {/* 6. Inflow Donation Section (Crypto & Fiat Midtrans) */}
      <DonateSection />

      {/* 7. Muzakki Merkle Verification (Zero Gas Proof) */}
      <MerkleVerifier />

      {/* 8. Public Transparency Dashboard (Multi-Unit Ledger) */}
      <TransparencyDashboard />

      {/* 9. Multi-Sig Governance (Amil, Syariah, Auditor Consensus) */}
      <GovernanceSection />

      {/* 10. Interactive 3D Globe & Closing Banner */}
      <ClosingSection />
    </main>
  );
}

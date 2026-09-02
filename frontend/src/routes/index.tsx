import { createFileRoute } from "@tanstack/react-router";
import {
  Hero,
  LiveMetricsSummary,
  ShariaPillars,
  QuickCalculatorPreview,
  FeaturedPrograms,
  CtaBanner,
} from "../features/landing";
import { MarqueeLogos } from "../components/landing/MarqueeLogos";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <main className="min-h-screen bg-white text-[#17332c] selection:bg-[#c4ed70]/40">
      {/* 1. Hero Section with Warm Indonesian Copywriting */}
      <Hero />

      {/* 2. Live Metrics Summary (Kas Masuk & Keluar Real-Time) */}
      <LiveMetricsSummary />

      {/* 3. 3-Layer Sharia Governance Pillars & 12.5% Invariant Lock */}
      <ShariaPillars />

      {/* 4. Quick BAZNAS Zakat Calculator Simulation with Auto-Fill CTA */}
      <QuickCalculatorPreview />

      {/* 5. Featured 8 Asnaf Aid Campaigns */}
      <FeaturedPrograms />

      {/* 6. Partner Marquee */}
      <MarqueeLogos />

      {/* 7. Inspiring Ayat Al-Qur'an & Closing CTA */}
      <CtaBanner />
    </main>
  );
}

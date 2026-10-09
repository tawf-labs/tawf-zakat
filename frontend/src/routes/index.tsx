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

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
  return (
    <main id="main-content" className="min-h-screen bg-white text-[#17332c] selection:bg-[#c4ed70]/40">
      <Hero />
      <LiveMetricsSummary />
      <ShariaPillars />
      <QuickCalculatorPreview />
      <FeaturedPrograms />
      <MarqueeLogos />
      <CtaBanner />
    </main>
  );
}

import React from "react";
import { ArrowUpRight, Sparkles, Cloud } from "lucide-react";
import { Globe } from "../ui/Globe";

export function ClosingSection() {
  return (
    <section className="closing-section" id="get-started">
      <div className="shell">
        <div className="closing-card">
          {/* Background Ambient Glow & Mesh */}
          <div className="closing-glow-lime" />
          <div className="closing-glow-green" />

          {/* Decorative SVG Clouds & Floating Sparkles */}
          <div className="closing-cloud cloud-1">
            <Cloud size={140} strokeWidth={1} />
          </div>
          <div className="closing-cloud cloud-2">
            <Cloud size={100} strokeWidth={1} />
          </div>
          <div className="closing-sparkle sparkle-1">
            <Sparkles size={24} />
          </div>
          <div className="closing-sparkle sparkle-2">
            <Sparkles size={20} />
          </div>

          {/* Grid pattern overlay */}
          <div className="closing-grid-pattern" />

          {/* Card Content Layout */}
          <div className="closing-content">
            <div className="closing-left">
              <div className="closing-eyebrow">
                <Sparkles size={14} />
                <span>Your next step</span>
              </div>
              <h2>
                Ready to make<br />
                <em>an impact?</em>
              </h2>
              <p>
                Start with a simple calculation. Leave with a clearer path to meaningful change.
              </p>
              <a className="button button-primary" href="#donate">
                Calculate your Zakat <ArrowUpRight size={18} />
              </a>
            </div>

            <div className="closing-right">
              <div className="globe-wrapper">
                <Globe />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

import React from "react";
import { ArrowUpRight } from "lucide-react";

export function Hero() {
  return (
    <section className="hero-section" id="top">
      <div className="shell hero-container">
        <div className="section-heading hero-copy fade-up">
          <p className="eyebrow">
            <span className="eyebrow-dot" /> 100% Transparent Giving
          </p>
          <h1>
            Give with clarity.<br />
            <em>See your impact.</em>
          </h1>
          <p className="hero-text">
            Track your Zakat in real-time. Simple, secure, and 100% transparent from your hands straight to those in need.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#donate">
              Calculate your Zakat <ArrowUpRight size={17} />
            </a>
            <a className="text-link" href="#transparency">
              See live impact <span>↗</span>
            </a>
          </div>
        </div>

        <div className="hero-media fade-up">
          <img
            src="/zktbg.png"
            alt="ZKT Background Illustration"
            className="hero-image"
          />
        </div>
      </div>
    </section>
  );
}

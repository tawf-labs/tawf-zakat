import React, { useEffect, useRef, useState } from "react";
import { Sparkles, ShieldCheck, HeartHandshake, ArrowUpRight } from "lucide-react";

export function WhySection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [isIntersecting, setIsIntersecting] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsIntersecting(true);
        }
      },
      { threshold: 0.2 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section className="section shell" id="why" ref={sectionRef}>
      <div className="section-heading">
        <p className="eyebrow">The Zakat difference</p>
        <h2>
          Giving should feel<br />
          <em>good.</em>
        </h2>
        <p>
          We believe generosity is not just an obligation. It is a powerful force for change — when it is made visible, personal, and trusted.
        </p>
      </div>

      <div className={`feature-grid ${isIntersecting ? "is-stacked-active" : ""}`}>
        <article className="feature-card feature-dark card-1">
          <div className="card-icon-wrapper">
            <Sparkles className="card-icon" size={32} />
          </div>
          <h3>Clarity in every step</h3>
          <p>
            Understand exactly what you owe, where it goes, and the lives it touches.
          </p>
          <a href="#donate">
            Explore the calculator <ArrowUpRight size={18} />
          </a>
        </article>

        <article className="feature-card card-2">
          <div className="card-icon-wrapper">
            <ShieldCheck className="card-icon" size={32} />
          </div>
          <h3>Trust, built in</h3>
          <p>
            Every partner is vetted. Every donation is tracked. No guesswork, just peace of mind.
          </p>
          <div className="feature-stat">
            <strong>100%</strong>
            <span>verified partners</span>
          </div>
        </article>

        <article className="feature-card feature-lime card-3">
          <div className="card-icon-wrapper">
            <HeartHandshake className="card-icon" size={32} />
          </div>
          <h3>Impact you can see</h3>
          <p>
            Follow your contribution from intention to real-world transformation.
          </p>
          <div className="mini-bars">
            <i /><i /><i /><i /><i />
          </div>
        </article>
      </div>
    </section>
  );
}

import React from "react";

const transparencySteps = [
  ["01", "Connect & Verify", "Login easily and get your identity verified automatically."],
  ["02", "Choose Your Cause", "Browse verified campaigns for Zakat, Infaq, or Sodaqah."],
  ["03", "Donate Securely", "Pay via Xellar embedded wallet with one click."],
  ["04", "Track Impact", "Receive an NFT receipt and track your funds on-chain."]
];

export function HowItWorks() {
  return (
    <section className="journey-section" id="about">
      <div className="shell">
        <div className="section-heading compact">
          <p className="eyebrow">How it works</p>
          <h2>
            From intention<br />
            <em>to impact.</em>
          </h2>
        </div>
        <div className="journey-grid">
          {transparencySteps.map(([number, title, copy]) => (
            <article key={number}>
              <span className="step-number">{number}</span>
              <div className="step-line" />
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

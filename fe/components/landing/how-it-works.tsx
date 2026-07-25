export function HowItWorks() {
  return (
    <section className="py-16 md:py-24 px-4 sm:px-6 bg-accent">
      <div className="container mx-auto">
        <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">

          {/* Left Content */}
          <div className="lg:w-1/2 space-y-6">
            {/* Updated H2 size per guidelines: 40px/36px */}
            <h2 className="font-serif text-[36px] md:text-[40px] font-bold text-foreground">How ZKT Works</h2>
            <p className="text-base lg:text-lg text-muted-foreground">
              Experience the future of giving with our seamless, transparent 4-step process.
            </p>

            <div className="space-y-6 pt-4">

              {/* Step 1 */}
              <div className="flex gap-4 group">
                <div className="flex-none h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm font-serif group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  1
                </div>
                <div>
                  <h3 className="font-semibold text-lg font-serif">Connect & Verify</h3>
                  <p className="text-muted-foreground">
                    Login easily and get your identity verified automatically.
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-4 group">
                <div className="flex-none h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm font-serif group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  2
                </div>
                <div>
                  <h3 className="font-semibold text-lg font-serif">Choose Your Cause</h3>
                  <p className="text-muted-foreground">
                    Browse verified campaigns for Zakat, Infaq, or Sodaqah.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-4 group">
                <div className="flex-none h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm font-serif group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  3
                </div>
                <div>
                  <h3 className="font-semibold text-lg font-serif">Donate Securely</h3>
                  <p className="text-muted-foreground">
                    Pay via Xellar embedded wallet with one click.
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex gap-4 group">
                <div className="flex-none h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm font-serif group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  4
                </div>
                <div>
                  <h3 className="font-semibold text-lg font-serif">Track Impact</h3>
                  <p className="text-muted-foreground">
                    Receive an NFT receipt and track your funds on-chain.
                  </p>
                </div>
              </div>

            </div>
          </div>

          {/* Right Box */}
          <div className="lg:w-1/2 bg-card rounded-2xl p-6 lg:p-8 border border-primary/10 shadow-md">
            <div className="space-y-4">

              <div className="bg-background p-5 rounded-2xl border border-primary/10 flex items-center justify-between">
                <span className="font-medium">Donation Sent</span>
                <span className="text-primary font-mono font-bold">Confirmed</span>
              </div>

              <div className="flex justify-center">
                <div className="h-8 w-0.5 border-l-2 border-dashed border-primary/20" />
              </div>

              <div className="bg-background p-5 rounded-2xl border border-primary/10 flex items-center justify-between">
                <span className="font-medium">Smart Contract</span>
                <span className="text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-full font-medium uppercase tracking-wide-label">
                  Processing
                </span>
              </div>

              <div className="flex justify-center">
                <div className="h-8 w-0.5 border-l-2 border-dashed border-primary/20" />
              </div>

              <div className="bg-background p-5 rounded-2xl border border-primary/10 flex items-center justify-between">
                <span className="font-medium">NFT Receipt Minted</span>
                <span className="text-xs bg-secondary/20 text-secondary-foreground px-3 py-1.5 rounded-full font-medium font-mono uppercase tracking-wide-label">
                  0x83...29a
                </span>
              </div>

            </div>
          </div>

        </div>
      </div>
    </section>
  );
}

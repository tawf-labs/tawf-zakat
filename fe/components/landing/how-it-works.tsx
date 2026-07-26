"use client";

import { useLanguage } from "@/components/providers/language-provider";

export function HowItWorks() {
  const { t } = useLanguage();

  return (
    <section className="py-16 md:py-24 px-4 sm:px-6 bg-accent">
      <div className="container mx-auto">
        <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">

          {/* Left Content */}
          <div className="lg:w-1/2 space-y-6">
            <h2 className="font-serif text-[36px] md:text-[40px] font-bold text-foreground">{t("howItWorks.heading")}</h2>
            <p className="text-base lg:text-lg text-muted-foreground">
              {t("howItWorks.description")}
            </p>

            <div className="space-y-6 pt-4">

              {/* Step 1 */}
              <div className="flex gap-4 group">
                <div className="flex-none h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm font-serif group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  1
                </div>
                <div>
                  <h3 className="font-semibold text-lg font-serif">{t("howItWorks.step1.title")}</h3>
                  <p className="text-muted-foreground">
                    {t("howItWorks.step1.desc")}
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-4 group">
                <div className="flex-none h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm font-serif group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  2
                </div>
                <div>
                  <h3 className="font-semibold text-lg font-serif">{t("howItWorks.step2.title")}</h3>
                  <p className="text-muted-foreground">
                    {t("howItWorks.step2.desc")}
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-4 group">
                <div className="flex-none h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm font-serif group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  3
                </div>
                <div>
                  <h3 className="font-semibold text-lg font-serif">{t("howItWorks.step3.title")}</h3>
                  <p className="text-muted-foreground">
                    {t("howItWorks.step3.desc")}
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex gap-4 group">
                <div className="flex-none h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm font-serif group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  4
                </div>
                <div>
                  <h3 className="font-semibold text-lg font-serif">{t("howItWorks.step4.title")}</h3>
                  <p className="text-muted-foreground">
                    {t("howItWorks.step4.desc")}
                  </p>
                </div>
              </div>

            </div>
          </div>

          {/* Right Box */}
          <div className="lg:w-1/2 bg-card rounded-2xl p-6 lg:p-8 border border-primary/10 shadow-md">
            <div className="space-y-4">

              <div className="bg-background p-5 rounded-2xl border border-primary/10 flex items-center justify-between">
                <span className="font-medium">{t("howItWorks.donationSent")}</span>
                <span className="text-primary font-mono font-bold">{t("howItWorks.confirmed")}</span>
              </div>

              <div className="flex justify-center">
                <div className="h-8 w-0.5 border-l-2 border-dashed border-primary/20" />
              </div>

              <div className="bg-background p-5 rounded-2xl border border-primary/10 flex items-center justify-between">
                <span className="font-medium">{t("howItWorks.smartContract")}</span>
                <span className="text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-full font-medium uppercase tracking-wide-label">
                  {t("howItWorks.processing")}
                </span>
              </div>

              <div className="flex justify-center">
                <div className="h-8 w-0.5 border-l-2 border-dashed border-primary/20" />
              </div>

              <div className="bg-background p-5 rounded-2xl border border-primary/10 flex items-center justify-between">
                <span className="font-medium">{t("howItWorks.nftReceiptMinted")}</span>
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

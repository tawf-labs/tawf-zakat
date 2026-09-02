"use client";

import { ShieldCheck, CircleCheckBig, Lock } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";

export function Trusted() {
  const { t } = useLanguage()
  return (
    <section className="py-16 bg-white/30 border-y border-black/50">
      <div className="container px-4 mx-auto">
        {/* Heading */}
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">{t("trusted.title")}</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            {t("trusted.subtitle")}
          </p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Card 1 */}
          <div className="bg-background p-6 rounded-xl shadow-sm border border-black/60 text-center hover:shadow-md transition-shadow">
            <div className="h-12 w-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h3 className="font-bold text-lg mb-2">{t("trusted.sharia.title")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("trusted.sharia.desc")}
            </p>
          </div>

          {/* Card 2 */}
          <div className="bg-background p-6 rounded-xl shadow-sm border border-black/60 text-center hover:shadow-md transition-shadow">
            <div className="h-12 w-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CircleCheckBig className="h-6 w-6" />
            </div>
            <h3 className="font-bold text-lg mb-2">{t("trusted.award.title")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("trusted.award.desc")}
            </p>
          </div>

          {/* Card 3 */}
          <div className="bg-background p-6 rounded-xl shadow-sm border border-black/60 text-center hover:shadow-md transition-shadow">
            <div className="h-12 w-12 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="h-6 w-6" />
            </div>
            <h3 className="font-bold text-lg mb-2">{t("trusted.blockchain.title")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("trusted.blockchain.desc")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

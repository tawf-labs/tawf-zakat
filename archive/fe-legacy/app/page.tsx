"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Heart, Building2, Scale } from "lucide-react"

import { Hero } from "@/components/landing/hero"
import { HowItWorks } from "@/components/landing/how-it-works"
import { FeaturedCampaigns } from "@/components/landing/featured-campaigns"
import { Trusted } from "@/components/landing/badge"
import { useLanguage } from "@/components/providers/language-provider"


export default function HomePage() {
  const { t } = useLanguage()
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <Hero />
      <Trusted />

      {/* Role-based entry section - updated spacing per guidelines */}
      <section className="py-16 md:py-24 px-4 sm:px-6 bg-accent">
        <div className="max-w-6xl mx-auto">
          {/* Updated H2 size per guidelines: 40px/36px */}
          <h2 className="font-serif text-[36px] md:text-[40px] font-bold text-center mb-4 text-foreground">
            {t("landing.roles.title")}
          </h2>
          <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
            {t("landing.roles.subtitle")}
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            {/* Donor Card */}
            <Card className="hover:shadow-lg transition-shadow border-primary/10 rounded-2xl group">
              <CardHeader className="p-6 pb-4">
                <Heart className="h-8 w-8 text-primary mb-3 group-hover:scale-110 transition-transform" />
                <CardTitle className="font-serif">{t("landing.roles.donor.title")}</CardTitle>
                <CardDescription>
                  {t("landing.roles.donor.desc")}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 pt-0">
                <Link href="/campaigns">
                  <Button className="w-full rounded-full uppercase tracking-wide-label">{t("landing.roles.donor.button")}</Button>
                </Link>
              </CardContent>
            </Card>

            {/* Organization Card */}
            <Card className="hover:shadow-lg transition-shadow border-primary/10 rounded-2xl group">
              <CardHeader className="p-6 pb-4">
                <Building2 className="h-8 w-8 text-secondary mb-3 group-hover:scale-110 transition-transform" />
                <CardTitle className="font-serif">{t("landing.roles.org.title")}</CardTitle>
                <CardDescription>
                  {t("landing.roles.org.desc")}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 pt-0">
                <Link href="/organizer">
                  <Button className="w-full rounded-full uppercase tracking-wide-label" variant="outline">
                    {t("landing.roles.org.button")}
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Governance Card */}
            <Card className="hover:shadow-lg transition-shadow border-primary/10 rounded-2xl group">
              <CardHeader className="p-6 pb-4">
                <Scale className="h-8 w-8 text-primary mb-3 group-hover:scale-110 transition-transform" />
                <CardTitle className="font-serif">{t("landing.roles.gov.title")}</CardTitle>
                <CardDescription>
                  {t("landing.roles.gov.desc")}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 pt-0">
                <Link href="/governance">
                  <Button className="w-full rounded-full uppercase tracking-wide-label" variant="secondary">
                    {t("landing.roles.gov.button")}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <FeaturedCampaigns />
      <HowItWorks />
    </main>
  )
}

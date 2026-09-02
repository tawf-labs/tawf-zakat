'use client';

import React from 'react';
import { Shield, TrendingUp } from 'lucide-react';
import Image from 'next/image';
import { useLanguage } from '@/components/providers/language-provider';
import { CardBody, CardContainer, CardItem } from '../ui/3d-card';

export function Hero() {
  const { t } = useLanguage();

  return (
    <section className="relative overflow-hidden bg-[#F9F6F0] py-16 md:py-24 pattern-islamic">
        {/* Decorative circles with 3% opacity per guidelines */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-primary/3 blur-3xl animate-pulse" />
          <div className="absolute top-1/2 -left-48 w-[30rem] h-[30rem] rounded-full bg-secondary/3 blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-64 h-64 rounded-full bg-secondary/3 blur-2xl" />
        </div>

        <div className="absolute inset-0 opacity-20 pointer-events-none">
          <Image
            src="/zkt-hero-background.png"
            alt="hero background"
            fill
            className="object-cover object-left-top"
            priority
          />
        </div>

        <div className="container relative z-10 px-4 sm:px-6 mx-auto">
        <div className="flex flex-col lg:flex-row items-center gap-16 lg:gap-24">
          {/* Left Content */}
          <div className="flex-1 space-y-8 text-center lg:text-left animate-fade-in-up">
            {/* Enhanced badge with gold accent */}
            <div className="inline-flex items-center gap-2 rounded-full border border-secondary/30 bg-secondary/10 px-5 py-2.5 text-sm font-medium text-primary uppercase tracking-wide-label">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></span>
              {t("hero.badge")}
            </div>

            {/* Heading - Updated size per guidelines: 60px/48px */}
            <h1 className="font-serif text-[48px] md:text-[60px] font-bold leading-[1.1] text-foreground">
              {t("hero.title")}
            </h1>

            {/* Description */}
            <p className="text-base lg:text-lg text-muted-foreground max-w-2xl mx-auto lg:mx-0 leading-relaxed">
              {t("hero.subtitle")}
            </p>

            {/* Enhanced stats with proper labels per guidelines */}
              <div className="grid grid-cols-3 gap-4 lg:gap-8 pt-8 border-t border-primary/10">
              <div className="space-y-1 delay-100 animate-fade-in-up">
                <div className="font-serif text-3xl lg:text-4xl font-bold text-primary">$10+</div>
                <div className="text-sm text-foreground font-medium uppercase tracking-wide-label">
                  {t("hero.statDonated")}
                </div>
              </div>
              <div className="space-y-1 delay-200 animate-fade-in-up">
                <div className="font-serif text-3xl lg:text-4xl font-bold text-primary">100%</div>
                <div className="text-sm text-foreground font-medium uppercase tracking-wide-label">
                  {t("hero.statTraceable")}
                </div>
              </div>
              <div className="space-y-1 delay-300 animate-fade-in-up">
                <div className="font-serif text-3xl lg:text-4xl font-bold text-primary">50+</div>
                <div className="text-sm text-foreground font-medium uppercase tracking-wide-label">
                  {t("hero.statDonors")}
                </div>
              </div>
            </div>
           </div>

          {/* Right Mockup Section - with oval mask per guidelines */}
         <CardContainer className="flex-1 w-full max-w-2xl relative delay-400 animate-scale-in">
          {/* Main Browser/Device Mockup with oval mask */}
          <CardBody className="relative oval-mask overflow-hidden border border-primary/10 bg-white aspect-[4/3] shadow-2xl shadow-primary/10">

            {/* IMAGE with oval mask applied via parent */}
            {/* Self-hosted: this previously hotlinked globalgiving.org, an
                uncontrolled third-party origin. */}
            <Image
              src="/community-receiving-food-aid-with-dignity.jpg"
              alt="Community members receiving food aid"
              fill
              className="object-cover w-full h-auto"
            />

            {/* Floating Card - Top Left */}
            {/* <CardItem translateZ={50} className="absolute top-6 left-6 bg-white/95 backdrop-blur-sm p-4 rounded-2xl border border-primary/10 shadow-lg max-w-[160px]">
              <div className="text-xs font-semibold text-primary uppercase tracking-wide-label">Zakat Verified</div>
            </CardItem> */}

            {/* Floating Card - Bottom Right */}
            {/* <CardItem translateZ={20} className="absolute bottom-6 right-6 bg-white/95 backdrop-blur-sm p-4 rounded-2xl border border-primary/10 shadow-lg max-w-[200px]">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wide-label">Impact Tracking</div>
                <div className="text-sm font-bold text-primary font-serif">Real-time Audit</div>
              </div>
            </CardItem> */}
          </CardBody>
        </CardContainer>

        </div>
      </div>
    </section>
  );
}

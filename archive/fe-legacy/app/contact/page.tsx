"use client"

import React from 'react'
import { Mail, ArrowRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { useLanguage } from "@/components/providers/language-provider"

export default function ContactUsPage() {
  const { t } = useLanguage()

  return (
    <main className="min-h-dvh relative overflow-hidden bg-accent">
      {/* Background Grid */}
      <div className="absolute inset-0 bg-grid-slate-200 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.5))] -z-10" style={{backgroundSize: '40px 40px', backgroundImage: 'linear-gradient(to right, rgb(203 213 225 / 0.2) 1px, transparent 1px), linear-gradient(to bottom, rgb(203 213 225 / 0.2) 1px, transparent 1px)'}}></div>
      
      {/* Hero Section */}
      <section className="pt-24 lg:pt-32 pb-16">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            <div className="space-y-4">
              <h1 className="text-5xl lg:text-6xl font-extrabold tracking-tight text-foreground">
                {t('contact.hero.titlePrefix')} <span className="text-primary">{t('contact.hero.titleHighlight')}</span>
              </h1>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                {t('contact.hero.subtitle')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Contact Form - Single Card */}
      <section className="pb-20">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto">
            
            <Card className="border-2 border-border hover:border-primary/50 transition-all duration-300 shadow-2xl bg-white/80 backdrop-blur-sm">
              <CardContent className="p-8 md:p-12">
                <div className="space-y-6">
                  {/* Email Contact */}
                  <div className="text-center space-y-4">
                    <div className="relative inline-block">
                      <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl"></div>
                      <div className="relative w-20 h-20 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/30 mx-auto">
                        <Mail className="w-10 h-10 text-white" />
                      </div>
                    </div>
                    
                    <div>
                      <h3 className="text-2xl font-bold text-foreground mb-2">{t('contact.getInTouch')}</h3>
                      <p className="text-muted-foreground">
                        {t('contact.helpText')}
                      </p>
                    </div>
                  </div>

                  {/* Email Button */}
                  <a 
                    href="mailto:marcell@tawf.xyz" 
                    className="flex items-center justify-center gap-2 w-full bg-primary hover:bg-primary/90 text-white font-semibold py-4 px-6 rounded-lg transition-all duration-300 shadow-lg hover:shadow-xl hover:shadow-primary/20 group"
                  >
                    <Mail className="w-5 h-5" />
                    marcell@tawf.xyz
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </a>

                  {/* Response Time */}
                  <div className="text-center pt-2">
                    <p className="text-sm text-muted-foreground">
                      {t('contact.responseTime')}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

          </div>
        </div>
      </section>
    </main>
  )
}

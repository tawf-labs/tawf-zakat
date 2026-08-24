'use client';

import React from 'react';
import { Wrench, Rocket, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export function UnderDevelopment() {
  return (
    <section className="relative overflow-hidden bg-accent min-h-screen flex items-center justify-center py-20">
      <div className="container px-4 mx-auto">
        <div className="flex flex-col items-center text-center space-y-8 max-w-3xl mx-auto">
          
          {/* Icon */}
          <div className="relative">
            <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full"></div>
            <div className="relative bg-primary/10 p-6 rounded-full border-2 border-primary/20">
              <Wrench className="w-16 h-16 text-primary" />
            </div>
          </div>

          {/* Badge */}
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-medium text-primary">
            Coming Soon
          </div>

          {/* Heading */}
          <h1 className="text-4xl lg:text-6xl font-extrabold tracking-tight text-foreground">
            Mainnet Under <span className="text-primary">Development</span>
          </h1>

          {/* Description */}
          <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">
            We're building a better mainnet platform for you. Meanwhile, you can try all our features on testnet to experience transparent and verified blockchain charity.
          </p>

          {/* CTA Button */}
          <div className="flex flex-col sm:flex-row items-center gap-4 pt-4">
            <a 
              href="https://testnet.zkt.app" 
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center h-14 px-10 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-all shadow-lg shadow-primary/30 group"
            >
              <Rocket className="w-5 h-5 mr-2" />
              Try Testnet Now
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </a>
          </div>

        </div>
      </div>
    </section>
  );
}

export default UnderDevelopment;
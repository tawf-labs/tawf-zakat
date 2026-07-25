// app/layout.tsx
import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Suspense } from "react";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { WalletProvider } from "@/components/providers/web3-provider";
import { CurrencyProvider } from "@/components/providers/currency-provider";
import { LanguageProvider } from "@/components/providers/language-provider";
import { SearchProvider } from "@/components/shared/SearchContext";

export const metadata: Metadata = {
  title: "ZKT — Transparent and Traceable Donation",
  description: "Private, verifiable Zakat with ZK proofs. Built by Tawf Foundation.",
  applicationName: "ZKT",
  openGraph: {
    title: "ZKT — Transparent and Traceable Donation",
    description: "Private, verifiable Zakat with ZK proofs. Built by Tawf Foundation.",
    siteName: "ZKT",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ZKT — Transparent and Traceable Donation",
    description: "Private, verifiable Zakat with ZK proofs. Built by Tawf Foundation.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F9F6F0" },
    { media: "(prefers-color-scheme: dark)", color: "#1A1A1A" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${cormorant.variable} font-sans antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <LanguageProvider>
            <WalletProvider>
                <CurrencyProvider>
                  <SearchProvider>
                    <Header />
                    <Suspense fallback={null}>{children}</Suspense>
                    <Footer />
                    <Toaster />
                  </SearchProvider>
                </CurrencyProvider>
            </WalletProvider>
          </LanguageProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}

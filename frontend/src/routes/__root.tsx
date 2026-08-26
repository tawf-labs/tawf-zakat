import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider } from "connectkit";
import { wagmiConfig } from "../lib/wagmiConfig";
import { WalletProvider } from "../lib/WalletContext";
import React, { useState } from "react";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Tawf Zakat — Zakat Transparency & Anti-Corruption Protocol",
      },
    ],
    links: [
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Inter:wght@300;400;500;600;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: false,
          },
        },
      })
  );

  return (
    <html lang="id">
      <head>
        <HeadContent />
      </head>
      <body className="bg-[#F9F6F0] text-[#1A1A1A] font-sans antialiased min-h-screen flex flex-col justify-between selection:bg-[#C5A869]/30">
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            <ConnectKitProvider
              theme="soft"
              mode="light"
              options={{
                disclaimer: "Platform Transparansi Zakat & Anti-Korupsi Syariah Ethereum L1",
                embedGoogleFonts: false,
                truncateLongENSAddress: true,
                walletConnectName: "WalletConnect QR",
                enforceSupportedChains: true,
              }}
              customTheme={{
                "--ck-font-family": '"Inter", sans-serif',
                "--ck-border-radius": "22px",
                "--ck-primary-button-border-radius": "16px",
                "--ck-secondary-button-border-radius": "16px",
                "--ck-body-background": "#FFFFFF",
                "--ck-body-background-secondary": "#F9F6F0",
                "--ck-body-background-tertiary": "#F2EBE0",
                "--ck-body-color": "#1A1A1A",
                "--ck-body-color-muted": "#666666",
                "--ck-body-color-muted-hover": "#0F3D30",
                "--ck-accent-color": "#0F3D30",
                "--ck-accent-text-color": "#F9F6F0",
                "--ck-focus-color": "#0F3D30",
                "--ck-primary-button-background": "#0F3D30",
                "--ck-primary-button-hover-background": "#1A5242",
                "--ck-primary-button-color": "#F9F6F0",
                "--ck-modal-box-shadow": "0px 24px 48px rgba(15, 61, 48, 0.16)",
                "--ck-dropdown-box-shadow": "0px 12px 32px rgba(15, 61, 48, 0.12)",
              }}
            >
              <WalletProvider>
                <Navbar />
                <div className="flex-1">{children}</div>
                <Footer />
              </WalletProvider>
            </ConnectKitProvider>
          </QueryClientProvider>
        </WagmiProvider>
        <Scripts />
      </body>
    </html>
  );
}

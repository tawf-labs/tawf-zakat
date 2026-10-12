import { HeadContent, Scripts, createRootRoute, useRouterState } from "@tanstack/react-router";
import { Navbar } from "../components/layout/Navbar";
import { Footer } from "../components/layout/Footer";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeConnectKitProvider } from "../lib/SafeConnectKitProvider";
import { wagmiConfig } from "../lib/wagmiConfig";
import { SelectedWalletReconnect } from "../lib/SelectedWalletReconnect";
import { WalletProvider } from "../lib/WalletContext";
import { WebSocketProvider } from "../lib/WebSocketContext";
import { Toaster } from "sonner";
import { ErrorBoundary } from "../components/ui/ErrorBoundary";
import React, { useState } from "react";
import { isCampaignReference } from "../features/verification/campaignReceiptApi";
import { DeploymentGate } from "../components/DeploymentGate";
import { RootWorkspaceAccessProvider } from "../features/workspace/useWorkspaceAccess";
import { CrowdfundingNav, isCrowdfundingPath } from "../features/crowdfunding/CrowdfundingNav";

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
        title: "TAWF — Kebaikan Bersama",
      },
      {
        name: "description",
        content:
          "Temukan kampanye individu dan organisasi, ajukan penggalangan dana, dan telusuri status bukti transparansi kebaikan secara on-chain.",
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
        href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Mono:wght@400;500&family=Inter:wght@300;400;500;600;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
    scripts: [
      {
        src: "https://app.sandbox.midtrans.com/snap/snap.js",
        "data-client-key": "Mid-client-pLqckO1qyvfxRaD4",
      },
    ],
  }),
  shellComponent: RootDocument,
});

function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isWorkspace = pathname.startsWith("/ruang-kerja");

  return (
    <>
      {pathname !== "/" && isCrowdfundingPath(pathname) ? <CrowdfundingNav /> : <Navbar />}
      <ErrorBoundary>
        <div className="flex-1">{children}</div>
      </ErrorBoundary>
      {!isWorkspace && <Footer />}
    </>
  );
}

function RouteDeploymentGate({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Checking a campaign donation does not depend on the institutional contract deployment.
  const campaignReceipt = useRouterState({
    select: (s) => s.location.pathname === "/verifikasi" && isCampaignReference(String((s.location.search as { trxId?: unknown }).trxId ?? "")),
  });
  return isCrowdfundingPath(pathname) || campaignReceipt ? children : <DeploymentGate>{children}</DeploymentGate>;
}

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
      <body className="bg-white text-[#17332c] font-sans antialiased min-h-screen flex flex-col justify-between selection:bg-[#c4ed70]/40">
        <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
          <SelectedWalletReconnect />
          <QueryClientProvider client={queryClient}>
            <SafeConnectKitProvider
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
                "--ck-body-background-secondary": "#f4f8f3",
                "--ck-body-background-tertiary": "#eaf3e8",
                "--ck-body-color": "#17332c",
                "--ck-body-color-muted": "#5e7a70",
                "--ck-body-color-muted-hover": "#1b765e",
                "--ck-accent-color": "#1b765e",
                "--ck-accent-text-color": "#FFFFFF",
                "--ck-focus-color": "#1b765e",
                "--ck-primary-button-background": "#1b765e",
                "--ck-primary-button-hover-background": "#143f34",
                "--ck-primary-button-color": "#FFFFFF",
                "--ck-modal-box-shadow": "0px 24px 48px rgba(27, 118, 94, 0.16)",
                "--ck-dropdown-box-shadow": "0px 12px 32px rgba(27, 118, 94, 0.12)",
              }}
            >
              <RouteDeploymentGate>
              <WalletProvider>
                <WebSocketProvider>
                  <RootWorkspaceAccessProvider>
                    <Toaster richColors position="top-right" closeButton theme="light" />
                    <AppLayout>{children}</AppLayout>
                  </RootWorkspaceAccessProvider>
                </WebSocketProvider>
              </WalletProvider>
              </RouteDeploymentGate>
            </SafeConnectKitProvider>
          </QueryClientProvider>
        </WagmiProvider>
        <Scripts />
      </body>
    </html>
  );
}

import { createRoot } from "react-dom/client";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { connect } from "@wagmi/core";
import { foundry } from "viem/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { SafeConnectKitProvider } from "../src/lib/SafeConnectKitProvider";
import { WorkspacePanel } from "../src/features/workspace/WorkspacePanel";
import { RootWorkspaceAccessProvider } from "../src/features/workspace/useWorkspaceAccess";
import { Navbar } from "../src/components/layout/Navbar";
const listeners = new Map<string, (value: unknown) => void>();
const provider = {
  on(event: string, listener: (value: unknown) => void) { listeners.set(event, listener); },
  removeListener(event: string) { listeners.delete(event); },
  async request(input: unknown) { return (await fetch("/wallet-rpc", { method: "POST", body: JSON.stringify(input) })).json(); },
};
const config = createConfig({ chains: [foundry], connectors: [injected({ target: { id: "test-wallet", name: "Synthetic local wallet", provider: () => provider as any } })], transports: { [foundry.id]: http() } });
await connect(config, { connector: config.connectors[0]! });
const routeTree = createRootRoute({ component: () => <RootWorkspaceAccessProvider>
  <Navbar /><main style={{ paddingTop: 120 }}><WorkspacePanel /></main>
  <button onClick={async () => { const accounts = await (await fetch("/switch-wallet", { method: "POST" })).json(); listeners.get("accountsChanged")?.(accounts); }}>Ganti akun sintetis</button>
</RootWorkspaceAccessProvider> });
const router = createRouter({ routeTree });
createRoot(document.getElementById("root")!).render(<WagmiProvider config={config}><QueryClientProvider client={new QueryClient()}><SafeConnectKitProvider><RouterProvider router={router} /></SafeConnectKitProvider></QueryClientProvider></WagmiProvider>);

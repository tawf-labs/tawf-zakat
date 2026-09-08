import { createRoot } from "react-dom/client";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { connect } from "@wagmi/core";
import { foundry } from "viem/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspacePanel } from "../src/features/workspace/WorkspacePanel";
const provider = { on() {}, removeListener() {}, async request(input: unknown) {
  return (await fetch("/wallet-rpc", { method: "POST", body: JSON.stringify(input) })).json();
} };
const config = createConfig({ chains: [foundry], connectors: [injected({ target: { id: "test-wallet", name: "Synthetic local wallet", provider: () => provider as any } })], transports: { [foundry.id]: http("http://127.0.0.1:18572") } });
await connect(config, { connector: config.connectors[0]! });
createRoot(document.getElementById("root")!).render(<WagmiProvider config={config}><QueryClientProvider client={new QueryClient()}><WorkspacePanel /></QueryClientProvider></WagmiProvider>);

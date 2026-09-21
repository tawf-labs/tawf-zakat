import { fixtureAccess, FixtureAccess } from "./access-fixture";
// Optional browser smoke harness; uses the real certificate panel against the isolated API/EVM fixture.
import { createRoot } from "react-dom/client";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { connect } from "@wagmi/core";
import { foundry } from "viem/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CertificateIssuancePanel } from "../src/features/workspace/CertificateIssuancePanel";
const provider = { on() {}, removeListener() {}, async request(input: unknown) {
  const response = await fetch('/wallet-rpc', { method: 'POST', body: JSON.stringify(input) });
  return response.json();
} };
const config = createConfig({ chains: [foundry], connectors: [injected({ target: { id: 'test-wallet', name: 'Synthetic local wallet', provider: () => provider as any } })], transports: { [foundry.id]: http('http://127.0.0.1:18602') } });
await connect(config, { connector: config.connectors[0]! });
const props = await (await fetch('/smoke-config')).json();
const access = await fixtureAccess(props.token);
createRoot(document.getElementById('root')!).render(<WagmiProvider config={config}><QueryClientProvider client={new QueryClient()}><FixtureAccess access={access}>{requests => <CertificateIssuancePanel requests={requests} institutionId={props.institutionId} canManage />}</FixtureAccess></QueryClientProvider></WagmiProvider>);

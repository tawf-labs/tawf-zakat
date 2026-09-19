/**
 * Browser smoke for Issue #99: the real workspace (sign-in, queues) plus the
 * findings section of one frozen report version, read from `?preparation=&package=`.
 * The section is the same component ReportPackageForm renders for a frozen
 * package; only the route to it is shortened.
 */
import { createRoot } from "react-dom/client";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { connect } from "@wagmi/core";
import { foundry } from "viem/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { SafeConnectKitProvider } from "../src/lib/SafeConnectKitProvider";
import { WorkspacePanel } from "../src/features/workspace/WorkspacePanel";
import { PackageAuditFindingsSection } from "../src/features/workspace/PackageAuditFindingsSection";
import { RootWorkspaceAccessProvider, useWorkspaceAccess } from "../src/features/workspace/useWorkspaceAccess";
import { Navbar } from "../src/components/layout/Navbar";

const listeners = new Map<string, (value: unknown) => void>();
const provider = {
  on(event: string, listener: (value: unknown) => void) { listeners.set(event, listener); },
  removeListener(event: string) { listeners.delete(event); },
  async request(input: unknown) { return (await fetch("/wallet-rpc", { method: "POST", body: JSON.stringify(input) })).json(); },
};
const config = createConfig({ chains: [foundry], connectors: [injected({ target: { id: "test-wallet", name: "Synthetic local wallet", provider: () => provider as any } })], transports: { [foundry.id]: http() } });
await connect(config, { connector: config.connectors[0]! });

const query = new URLSearchParams(location.search);
function VersionFindings() {
  const access = useWorkspaceAccess();
  if (access.state !== "READY") return null;
  return <PackageAuditFindingsSection key={access.requests.contextId} requests={access.requests}
    preparationId={query.get("preparation")!} packageId={query.get("package")!} packageDigest={query.get("digest")!}
    reportId={query.get("report")!} reportVersion={query.get("version")!} />;
}

const routeTree = createRootRoute({ component: () => <RootWorkspaceAccessProvider>
  <Navbar /><main style={{ paddingTop: 120 }}><WorkspacePanel /><VersionFindings /></main>
  <button onClick={async () => { const accounts = await (await fetch("/switch-wallet", { method: "POST" })).json(); listeners.get("accountsChanged")?.(accounts); }}>Ganti akun sintetis</button>
</RootWorkspaceAccessProvider> });
const router = createRouter({ routeTree });
createRoot(document.getElementById("root")!).render(<WagmiProvider config={config}><QueryClientProvider client={new QueryClient()}><SafeConnectKitProvider><RouterProvider router={router} /></SafeConnectKitProvider></QueryClientProvider></WagmiProvider>);

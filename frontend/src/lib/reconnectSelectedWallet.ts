import { reconnect, type Config } from "@wagmi/core";

/** Restore only an explicitly selected, identifiable wallet. Never scan others. */
export async function reconnectSelectedWallet(config: Config): Promise<"done" | "waiting"> {
  if (config.state.status === "connected") return "done";
  const id = await config.storage?.getItem("recentConnectorId");
  // The legacy generic injected connector resolves window.ethereum, whose owner
  // can change when multiple extensions are installed. Require a fresh choice.
  if (!id || id === "injected") return "done";
  const connector = config.connectors.find(candidate => candidate.id === id);
  if (!connector) return "waiting"; // EIP-6963 discovery may announce it later.
  await reconnect(config, { connectors: [connector] });
  return "done";
}

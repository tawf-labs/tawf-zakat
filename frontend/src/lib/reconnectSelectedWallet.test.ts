import { describe, expect, it } from "bun:test";
import { connect, createConfig, createStorage, disconnect, http, type CreateConnectorFn } from "@wagmi/core";
import { mock } from "@wagmi/connectors";
import { sepolia } from "wagmi/chains";
import { reconnectSelectedWallet } from "./reconnectSelectedWallet";

const original = "0x0000000000000000000000000000000000000001";
const other = "0x0000000000000000000000000000000000000002";
function wallet(id: string, address: typeof original | typeof other, authorized = true): CreateConnectorFn {
  const factory = mock({ accounts: [address], features: { reconnect: true, defaultConnected: authorized } });
  return config => ({ ...factory(config), id });
}
async function setup(selected: string | null, authorized = true) {
  const data = new Map<string, string>();
  const storage = createStorage({ storage: {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
  } });
  const config = createConfig({
    chains: [sepolia], transports: { [sepolia.id]: http() }, storage,
    multiInjectedProviderDiscovery: false,
    connectors: [wallet("other", other), wallet("chosen", original, authorized)],
  });
  if (selected) await storage.setItem("recentConnectorId", selected);
  return config;
}

describe("wallet restoration with multiple authorized extensions", () => {
  it("restores only the selected wallet; disconnect never reveals a second account", async () => {
    const config = await setup("chosen");
    await reconnectSelectedWallet(config);
    expect([...config.state.connections.values()].map(c => c.accounts[0])).toEqual([original]);
    await disconnect(config);
    expect(config.state.status).toBe("disconnected");
    expect(config.state.connections.size).toBe(0);
  });
  it("does not fall back when the chosen wallet is unauthorized", async () => {
    const config = await setup("chosen", false);
    await reconnectSelectedWallet(config);
    expect(config.state.connections.size).toBe(0);
  });
  it.each([null, "injected", "missing-wallet"])("does not pick another wallet for %s", async selected => {
    const config = await setup(selected);
    await reconnectSelectedWallet(config);
    expect(config.state.connections.size).toBe(0);
  });
  it("waits for late discovery of the selected provider without connecting another", async () => {
    const config = await setup("late-wallet");
    expect(await reconnectSelectedWallet(config)).toBe("waiting");
    expect(config.state.connections.size).toBe(0);
    const late = config._internal.connectors.setup(wallet("late-wallet", original));
    config._internal.connectors.setState([...config.connectors, late]);
    expect(await reconnectSelectedWallet(config)).toBe("done");
    expect([...config.state.connections.values()].map(c => c.accounts[0])).toEqual([original]);
  });
  it("does not override a manual connection made before late discovery", async () => {
    const config = await setup("missing-wallet");
    await connect(config, { connector: config.connectors[0]! });
    await reconnectSelectedWallet(config);
    expect([...config.state.connections.values()].map(c => c.accounts[0])).toEqual([other]);
  });
});

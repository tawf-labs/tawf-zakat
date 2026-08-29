import { createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { getDefaultConfig } from "connectkit";

export const wagmiConfig = createConfig(
  getDefaultConfig({
    // Your dApp chains
    chains: [sepolia],
    transports: {
      [sepolia.id]: http("https://ethereum-sepolia-rpc.publicnode.com"),
    },

    // Required: WalletConnect Project ID (dari Reown / WalletConnect Cloud)
    walletConnectProjectId:
      (typeof import.meta !== "undefined" && import.meta.env?.VITE_WALLETCONNECT_PROJECT_ID) ||
      "b6808bd11499531c85eddbf3cbc72e65",

    // Required: App Info
    appName: "Tawf Zakat",
    appDescription: "Zakat Transparency & Anti-Corruption Protocol on Ethereum L1",
    appUrl: typeof window !== "undefined" ? window.location.origin : "https://tawf.foundation",
    appIcon: "https://avatars.githubusercontent.com/u/179229932",
  })
);


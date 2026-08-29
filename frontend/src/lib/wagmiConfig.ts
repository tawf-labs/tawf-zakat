import { createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { getDefaultConfig } from "connectkit";

export const wagmiConfig = createConfig(
  getDefaultConfig({
    appName: "Tawf Zakat",
    walletConnectProjectId: "b6808bd11499531c85eddbf3cbc72e65",
    chains: [sepolia],
    transports: {
      [sepolia.id]: http("https://ethereum-sepolia-rpc.publicnode.com"),
    },
    appDescription: "Zakat Transparency & Anti-Corruption Protocol on Ethereum L1",
    ssr: true,
  })
);



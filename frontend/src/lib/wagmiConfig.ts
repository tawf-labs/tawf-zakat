import { createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { getDefaultConfig } from "connectkit";
import { safe } from "wagmi/connectors";

const defaultConfig = getDefaultConfig({
  appName: "Tawf Zakat",
  walletConnectProjectId: "3fcc6bba6f1de962d911bb5b5c3dba68",
  chains: [sepolia],
  transports: {
    [sepolia.id]: http("https://ethereum-sepolia-rpc.publicnode.com"),
  },
  appDescription: "Zakat Transparency & Anti-Corruption Protocol on Ethereum L1",
  appUrl: "https://tawf.foundation",
  appIcon: "https://avatars.githubusercontent.com/u/179229932",
  ssr: true,
});

export const wagmiConfig = createConfig({
  ...defaultConfig,
  connectors: [safe(), ...defaultConfig.connectors],
});


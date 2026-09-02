import { defaultConfig } from "@xellar/kit";
import { sepolia } from "viem/chains";
import type { Config } from "wagmi";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || "YOUR_WALLET_CONNECT_PROJECT_ID";
const xellarAppId = process.env.NEXT_PUBLIC_XELLAR_APP_ID || "d8c6c5a7-e03f-4d6b-a58a-c4403cfb8d6e";
const xellarEnv = (process.env.NEXT_PUBLIC_XELLAR_ENV as "sandbox" | "production") || "sandbox";

export const getClientConfig = (): Config | null => {
  if (typeof window === "undefined") return null;

  return defaultConfig({
    appName: "ZKT",
    walletConnectProjectId,
    xellarAppId,
    xellarEnv,
    chains: [sepolia],
  }) as Config;
};
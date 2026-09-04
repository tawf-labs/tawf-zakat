import { createConfig, http } from "wagmi";
import { arbitrumSepolia, sepolia } from "wagmi/chains";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";

const chains = [arbitrumSepolia, sepolia] as const;
const transports = {
  [arbitrumSepolia.id]: http("https://sepolia-rollup.arbitrum.io/rpc"),
  [sepolia.id]: http("https://ethereum-sepolia-rpc.publicnode.com"),
};

const walletConnectProjectId =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_WALLETCONNECT_PROJECT_ID) ||
  "b6808bd11499531c85eddbf3cbc72e65";

const appMetadata = {
  name: "Tawf Zakat",
  description: "Zakat Transparency & Anti-Corruption Protocol on Ethereum L1",
  url: typeof window !== "undefined" ? window.location.origin : "https://tawf.foundation",
  icons: ["https://avatars.githubusercontent.com/u/179229932"],
};

// `connectkit`'s `getDefaultConfig` transitively pulls in `@aave/account`, which
// touches the `window` global at module load and crashes Node/SSR — and because
// it's a *static* import, no runtime "skip it on the server" branch can prevent
// that module from being evaluated (ES module imports always execute before the
// importing module's own code runs, regardless of how the imported binding is
// used). So the connector set is wired by hand here via wagmi's own SSR-safe
// connector packages instead. `ConnectKitProvider`/`ConnectKitButton` (see
// SafeConnectKitProvider) only need a valid wagmi Config in context for their UI
// — they don't require the config to have been built by `getDefaultConfig`.
//
// Unlike the import above, `walletConnect()`/`coinbaseWallet()` are safe to
// *import* anywhere — the crash risk is in *calling* them: `walletConnect()`
// eagerly restores its session via `@walletconnect/core`, which touches
// `localStorage` and crashes Node/SSR the same way. So those connectors are
// only constructed client-side; the SSR pass just needs a valid Config to
// render the static shell, and real wallet connection always happens after
// hydration.
export const wagmiConfig = import.meta.env.SSR
  ? createConfig({ chains: [...chains], transports })
  : createConfig({
      chains: [...chains],
      transports,
      connectors: [
        injected(),
        coinbaseWallet({ appName: appMetadata.name, appLogoUrl: appMetadata.icons[0] }),
        walletConnect({
          projectId: walletConnectProjectId,
          showQrModal: false,
          metadata: appMetadata,
        }),
      ],
    });


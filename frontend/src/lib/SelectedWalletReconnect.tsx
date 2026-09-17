import { useEffect, useState, useSyncExternalStore } from "react";
import { useConfig, useConnectors } from "wagmi";
import { reconnectSelectedWallet } from "./reconnectSelectedWallet";

/** Runs after WagmiProvider has restored storage, and after late wallet discovery. */
export function SelectedWalletReconnect() {
  const config = useConfig();
  const connectors = useConnectors();
  // Wagmi does not expose hydration completion as a hook. Keep this integration
  // with its persisted store here, rather than racing an arbitrary mount timer.
  const { persist } = config._internal.store as unknown as {
    persist: {
      onFinishHydration(listener: () => void): () => void;
      hasHydrated(): boolean;
    };
  };
  const hydrated = useSyncExternalStore(
    persist.onFinishHydration,
    persist.hasHydrated,
    () => false,
  );
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!hydrated || done) return;
    let active = true;
    reconnectSelectedWallet(config).then(result => {
      if (active && result === "done") setDone(true);
    }).catch(() => {
      // Storage/provider unavailable: remain disconnected for an explicit choice.
      if (active) setDone(true);
    });
    return () => { active = false; };
  }, [config, connectors, hydrated, done]);
  return null;
}

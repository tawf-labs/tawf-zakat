import React, { Suspense, lazy, type ComponentProps } from "react";
import type { ConnectKitButton, ConnectKitProvider } from "connectkit";

const LazyConnectKitProvider = lazy(() =>
  import("connectkit").then((m) => ({ default: m.ConnectKitProvider }))
);

const LazyConnectKitButtonCustom = lazy(() =>
  import("connectkit").then((m) => ({ default: m.ConnectKitButton.Custom }))
);

type SafeConnectKitProviderProps = ComponentProps<typeof ConnectKitProvider>;
type ConnectKitButtonRenderProps = Parameters<
  NonNullable<ComponentProps<typeof ConnectKitButton.Custom>["children"]>
>[0];

/**
 * connectkit transitively imports @aave/account, which touches the `window`
 * global at module load and crashes Node/SSR. The real ConnectKitProvider is
 * only ever needed once a wallet is actually interacted with (client-side),
 * so on the server we skip loading connectkit entirely and just render
 * children — a real runtime branch, not a bundler tree-shaking assumption.
 */
export function SafeConnectKitProvider({ children, ...props }: SafeConnectKitProviderProps) {
  if (typeof window === "undefined") {
    return <>{children}</>;
  }

  return (
    <Suspense fallback={<>{children}</>}>
      <LazyConnectKitProvider {...props}>{children}</LazyConnectKitProvider>
    </Suspense>
  );
}

// Disconnected/idle stand-in used before connectkit has loaded on the client,
// and permanently on the server (no wallet interaction is possible during SSR).
const DISCONNECTED_STATE = {
  isConnected: false,
  isConnecting: false,
  show: () => {},
  address: undefined,
  truncatedAddress: undefined,
} as unknown as ConnectKitButtonRenderProps;

/**
 * SSR-safe drop-in for `<ConnectKitButton.Custom>` — see SafeConnectKitProvider
 * for why connectkit itself must never load during the server render pass.
 */
export function SafeConnectKitButton({
  children,
}: {
  children: (props: ConnectKitButtonRenderProps) => React.ReactNode;
}) {
  if (typeof window === "undefined") {
    return <>{children(DISCONNECTED_STATE)}</>;
  }

  return (
    <Suspense fallback={<>{children(DISCONNECTED_STATE)}</>}>
      <LazyConnectKitButtonCustom>{children}</LazyConnectKitButtonCustom>
    </Suspense>
  );
}

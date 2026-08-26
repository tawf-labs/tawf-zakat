import React, { createContext, useContext, useEffect, useState } from "react";
import { useAccount, useDisconnect, useBalance, useChainId, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";

import { formatUnits } from "viem";

interface WalletContextType {
  address: string | null;
  formattedAddress: string | null;
  balance: string | null;
  chainId: number | null;
  isSepolia: boolean;
  isConnected: boolean;
  disconnect: () => void;
  switchNetwork: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: balanceData } = useBalance({ address });

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isSepolia = chainId === sepolia.id;

  const formattedAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;

  const balance = balanceData
    ? parseFloat(formatUnits(balanceData.value, balanceData.decimals)).toFixed(4)
    : null;

  return (
    <WalletContext.Provider
      value={{
        address: mounted && address ? address : null,
        formattedAddress: mounted ? formattedAddress : null,
        balance: mounted ? balance : null,
        chainId: mounted ? chainId : null,
        isSepolia: mounted ? isSepolia : true,
        isConnected: mounted ? isConnected : false,
        disconnect: () => disconnect(),
        switchNetwork: () => switchChain({ chainId: sepolia.id }),
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}

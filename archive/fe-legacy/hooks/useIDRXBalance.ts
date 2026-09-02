"use client";

import { useAccount, useReadContract } from "wagmi";
import { CONTRACT_ADDRESSES, MockIDRXABI } from "@/lib/abi";
import { formatIDRX } from "@/lib/abi";

export function useIDRXBalance() {
  const { address } = useAccount();

  const {
    data: balance,
    isLoading,
    error,
    refetch,
  } = useReadContract({
    address: CONTRACT_ADDRESSES.MockIDRX,
    abi: MockIDRXABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      staleTime: 30_000, // 30 seconds
      gcTime: 300_000, // 5 minutes (formerly cacheTime)
      refetchOnWindowFocus: true,
    },
  });

  return {
    balance: balance as bigint | undefined,
    formattedBalance: balance ? formatIDRX(balance as bigint) : "0",
    isLoading,
    error,
    refetch,
  };
}

"use client";

import { useState, useCallback } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { CONTRACT_ADDRESSES, VotingTokenABI, ZKTCoreABI } from "@/lib/abi";
import { toast } from "@/components/ui/use-toast";

export function useVotingPower() {
  const { address, isConnected } = useAccount();
  const [isRequesting, setIsRequesting] = useState(false);
  const { writeContractAsync } = useWriteContract();

  const {
    data: votingPower,
    isLoading,
    error,
    refetch,
  } = useReadContract({
    address: CONTRACT_ADDRESSES.VotingNFT,
    abi: VotingTokenABI,
    functionName: "getVotingPower",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      staleTime: 30_000, // 30 seconds
      gcTime: 300_000, // 5 minutes
      refetchOnWindowFocus: true,
    },
  });

  const requestVotingPower = useCallback(async (amount: bigint = BigInt(100 * 10**18)) => {
    if (!isConnected || !address) {
      toast({
        title: "Error",
        description: "Wallet not connected",
        variant: "destructive",
      });
      return;
    }

    setIsRequesting(true);
    try {
      console.log(`Requesting ${amount} voting power...`);
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESSES.ZKTCore,
        abi: ZKTCoreABI,
        functionName: "grantVotingNFT",
        args: [address as `0x${string}`, `voting_power_${amount.toString()}`],
      });

      toast({
        title: "Voting Power Requested",
        description: "Transaction submitted. Your vZKT balance will update shortly.",
      });
      
      return hash;
    } catch (error: any) {
      console.error("Error requesting voting power:", error);
      toast({
        title: "Request Failed",
        description: error?.message || "Failed to request voting power",
        variant: "destructive",
      });
    } finally {
      setIsRequesting(false);
    }
  }, [isConnected, address, writeContractAsync]);

  return {
    votingPower: votingPower as bigint | undefined,
    formattedVotingPower: votingPower ? (Number(votingPower) / 1e18).toFixed(0) : "0",
    isLoading,
    isRequesting,
    error,
    refetch,
    requestVotingPower
  };
}
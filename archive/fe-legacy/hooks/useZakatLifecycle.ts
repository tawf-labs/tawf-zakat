'use client';

import { useCallback, useState } from 'react';
import { useReadContract, useWriteContract, useAccount } from 'wagmi';
import { CONTRACT_ADDRESSES, ZKTCoreABI } from '@/lib/abi';
import { toast } from '@/components/ui/use-toast';

export function useZakatLifecycle(poolId: number | bigint) {
  const { isConnected } = useAccount();
  const [isLoading, setIsLoading] = useState(false);
  const { writeContractAsync } = useWriteContract();

  // Read: Time Remaining
  const { data: timeData, refetch: refetchTime } = useReadContract({
    address: CONTRACT_ADDRESSES.ZKTCore,
    abi: ZKTCoreABI,
    functionName: 'getZakatTimeRemaining',
    args: [BigInt(poolId)],
    query: {
      enabled: !!poolId,
      refetchInterval: 60000, // Refresh every minute
    },
  });

  // Read: Ready for Redistribution
  const { data: isReady, refetch: refetchReady } = useReadContract({
    address: CONTRACT_ADDRESSES.ZKTCore,
    abi: ZKTCoreABI,
    functionName: 'isZakatReadyForRedistribution',
    args: [BigInt(poolId)],
    query: {
      enabled: !!poolId,
    },
  });
  
  // Read: Status String
  const { data: statusString, refetch: refetchStatus } = useReadContract({
    address: CONTRACT_ADDRESSES.ZKTCore,
    abi: ZKTCoreABI,
    functionName: 'getZakatPoolStatusString',
    args: [BigInt(poolId)],
    query: {
       enabled: !!poolId,
    }
  });

  /**
   * Check if pool has timed out (Anyone can call)
   */
  const checkTimeout = useCallback(async () => {
    if (!isConnected) {
        toast({ title: 'Error', description: 'Wallet not connected', variant: 'destructive' });
        return;
    }
    setIsLoading(true);
    try {
        const hash = await writeContractAsync({
            address: CONTRACT_ADDRESSES.ZKTCore,
            abi: ZKTCoreABI,
            functionName: 'checkZakatTimeout',
            args: [BigInt(poolId)],
        });
        toast({ title: 'Status Checked', description: 'Pool status has been updated.' });
        return hash;
    } catch (error: any) {
        console.error("Error checking timeout:", error);
        toast({ title: 'Error', description: error?.message || 'Failed to check timeout', variant: 'destructive' });
    } finally {
        setIsLoading(false);
    }
  }, [poolId, isConnected, writeContractAsync]);

  /**
   * Extend deadline (Sharia Council only)
   */
  const extendDeadline = useCallback(async (reasoning: string) => {
    if (!isConnected) {
        toast({ title: 'Error', description: 'Wallet not connected', variant: 'destructive' });
        return;
    }
    setIsLoading(true);
    try {
        const hash = await writeContractAsync({
            address: CONTRACT_ADDRESSES.ZKTCore,
            abi: ZKTCoreABI,
            functionName: 'councilExtendZakatDeadline',
            args: [BigInt(poolId), reasoning],
        });
        toast({ title: 'Deadline Extended', description: 'Pool deadline has been extended by 14 days.' });
        return hash;
    } catch (error: any) {
        console.error("Error extending deadline:", error);
        toast({ title: 'Error', description: error?.message || 'Failed to extend deadline', variant: 'destructive' });
    } finally {
        setIsLoading(false);
    }
  }, [poolId, isConnected, writeContractAsync]);

  /**
   * Execute Redistribution (Anyone can call after grace period)
   */
  const executeRedistribution = useCallback(async () => {
     if (!isConnected) {
        toast({ title: 'Error', description: 'Wallet not connected', variant: 'destructive' });
        return;
    }
    setIsLoading(true);
    try {
        const hash = await writeContractAsync({
            address: CONTRACT_ADDRESSES.ZKTCore,
            abi: ZKTCoreABI,
            functionName: 'executeZakatRedistribution',
            args: [BigInt(poolId)],
        });
        toast({ title: 'Redistributed', description: 'Funds have been sent to the fallback pool.' });
        return hash;
    } catch (error: any) {
        console.error("Error redistributing:", error);
        toast({ title: 'Error', description: error?.message || 'Failed to redistribute funds', variant: 'destructive' });
    } finally {
        setIsLoading(false);
    }
  }, [poolId, isConnected, writeContractAsync]);

  return {
     timeData: timeData ? {
         remaining: Number(timeData[0]),
         inGracePeriod: timeData[1],
         canRedistribute: timeData[2]
     } : null,
     isReady: isReady as boolean,
     statusString: statusString as string,
     checkTimeout,
     extendDeadline,
     executeRedistribution,
     isLoading,
     refetch: () => { refetchTime(); refetchReady(); refetchStatus(); }
  };
}

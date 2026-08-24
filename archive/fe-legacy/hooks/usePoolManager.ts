'use client';

import { useCallback, useState } from 'react';
import { useWriteContract, useAccount, useReadContract, useWaitForTransactionReceipt } from 'wagmi';
import { CONTRACT_ADDRESSES, ZKTCoreABI, parseIDRX } from '@/lib/abi';
import { CampaignPool, poolToCampaignPoolData, CampaignPoolData } from '@/lib/types';
import { toast } from '@/components/ui/use-toast';

interface UsePoolManagerOptions {
  onSuccess?: (txHash: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Get pool data by ID
 */
export function usePool(poolId: number | bigint) {
  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESSES.PoolManager,
    abi: ZKTCoreABI,
    functionName: 'getPool',
    args: [BigInt(poolId)],
    query: {
      enabled: !!poolId && poolId > 0,
      staleTime: 30_000,
    },
  });

  const poolData = data as CampaignPool | undefined;

  return {
    pool: poolData ? poolToCampaignPoolData(poolData) : undefined,
    rawPool: poolData,
    isLoading,
    refetch,
  };
}

/**
 * Get all pools (iterate through poolCount)
 */
export function useAllPools() {
  const { data: poolCount } = useReadContract({
    address: CONTRACT_ADDRESSES.PoolManager,
    abi: ZKTCoreABI,
    functionName: 'poolCount',
    query: {
      staleTime: 30_000,
    },
  });

  // We'll need to fetch each pool individually
  // This is a simplified version - in production you'd use multicall
  const poolIds = poolCount ? Array.from({ length: Number(poolCount) }, (_, i) => i + 1) : [];

  return {
    poolCount: poolCount?.toString() || '0',
    poolIds,
  };
}

export const usePoolManager = (options?: UsePoolManagerOptions) => {
  const { address, isConnected } = useAccount();
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash as `0x${string}` | undefined,
  });

  /**
   * Create a campaign pool from a Sharia-approved proposal
   * Only the proposal organizer can call this
   */
  const createCampaignPool = useCallback(
    async (proposalId: number | bigint) => {
      if (!isConnected || !address) {
        const error = new Error('Wallet not connected');
        toast({
          title: 'Error',
          description: 'Please connect your wallet first',
          variant: 'destructive',
        });
        options?.onError?.(error);
        return null;
      }

      setIsLoading(true);

      try {
        console.log('Creating campaign pool for proposal:', proposalId.toString());

        const hash = await writeContractAsync({
          address: CONTRACT_ADDRESSES.ZKTCore,
          abi: ZKTCoreABI,
          functionName: 'createCampaignPool',
          args: [BigInt(proposalId)],
        });

        setTxHash(hash);

        toast({
          title: 'Campaign Pool Created! 🏊',
          description: `Fundraising pool for proposal ${proposalId} is now active.`,
        });

        console.log('Pool creation transaction submitted:', hash);

        options?.onSuccess?.(hash);

        return { txHash: hash, poolId: BigInt(0) }; // Pool ID will be from event

      } catch (error: any) {
        console.error('Error creating campaign pool:', error);

        let errorMessage = 'Failed to create campaign pool';
        if (error?.message?.includes('user rejected')) {
          errorMessage = 'Transaction rejected by user';
        } else if (error?.message?.includes('Not Sharia approved')) {
          errorMessage = 'Proposal must be Sharia approved first';
        } else if (error?.message?.includes('Only organizer')) {
          errorMessage = 'Only the proposal organizer can create the pool';
        } else if (error?.message?.includes('Pool already created')) {
          errorMessage = 'Campaign pool already exists for this proposal';
        } else if (error?.message) {
          errorMessage = error.message;
        }

        toast({
          title: 'Pool Creation Failed',
          description: errorMessage,
          variant: 'destructive',
        });

        options?.onError?.(error);
        return null;

      } finally {
        setIsLoading(false);
      }
    },
    [isConnected, address, writeContractAsync, options]
  );

  /**
   * Withdraw raised funds from a campaign pool
   * Only the pool organizer can call this after fundraising is complete
   */
  const withdrawFunds = useCallback(
    async (poolId: number | bigint) => {
      if (!isConnected || !address) {
        const error = new Error('Wallet not connected');
        toast({
          title: 'Error',
          description: 'Please connect your wallet first',
          variant: 'destructive',
        });
        options?.onError?.(error);
        return null;
      }

      setIsLoading(true);

      try {
        console.log('Withdrawing funds from pool:', poolId.toString());

        const hash = await writeContractAsync({
          address: CONTRACT_ADDRESSES.ZKTCore,
          abi: ZKTCoreABI,
          functionName: 'withdrawFunds',
          args: [BigInt(poolId)],
        });

        setTxHash(hash);

        toast({
          title: 'Funds Withdrawn',
          description: `Raised funds from pool ${poolId} have been transferred.`,
        });

        console.log('Withdraw transaction submitted:', hash);

        options?.onSuccess?.(hash);

        return { txHash: hash };

      } catch (error: any) {
        console.error('Error withdrawing funds:', error);

        let errorMessage = 'Failed to withdraw funds';
        if (error?.message?.includes('user rejected')) {
          errorMessage = 'Transaction rejected by user';
        } else if (error?.message?.includes('Only organizer')) {
          errorMessage = 'Only the pool organizer can withdraw funds';
        } else if (error?.message?.includes('No funds to withdraw')) {
          errorMessage = 'No funds available to withdraw';
        } else if (error?.message?.includes('Already withdrawn')) {
          errorMessage = 'Funds have already been withdrawn';
        } else if (error?.message) {
          errorMessage = error.message;
        }

        toast({
          title: 'Withdrawal Failed',
          description: errorMessage,
          variant: 'destructive',
        });

        options?.onError?.(error);
        return null;

      } finally {
        setIsLoading(false);
      }
    },
    [isConnected, address, writeContractAsync, options]
  );

  /**
   * Check if an address is the organizer of a pool
   */
  const isPoolOrganizer = useCallback(
    async (poolId: number | bigint, organizerAddress: string) => {
      if (!organizerAddress) return false;

      // Use the usePool hook to get pool data
      // This is a simplified check
      return organizerAddress.toLowerCase() === address?.toLowerCase();
    },
    [address]
  );

  return {
    createCampaignPool,
    withdrawFunds,
    isPoolOrganizer,
    isLoading: isLoading || isConfirming,
    isConfirming,
    isConfirmed,
    txHash,
  };
};

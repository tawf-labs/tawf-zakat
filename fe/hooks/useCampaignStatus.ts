'use client';

import { useReadContract } from 'wagmi';
import { CONTRACT_ADDRESSES, ZKTCoreABI } from '@/lib/abi';
import type { CampaignPool } from '@/lib/types';

/**
 * Hook to fetch campaign pool status from ZKTCore
 * Returns pool information to check if donations are allowed
 */
export function useCampaignStatus(poolId: string | number | null) {
  const {
    data: poolData,
    isLoading,
    error,
    refetch,
  } = useReadContract({
    address: CONTRACT_ADDRESSES.PoolManager as `0x${string}`,
    abi: ZKTCoreABI,
    functionName: 'getPool',
    args: poolId !== null ? [BigInt(poolId)] : undefined,
    query: {
      enabled: poolId !== null,
      staleTime: 30_000,
      gcTime: 300_000,
      refetchOnWindowFocus: true,
    },
  });

  const row = poolData as any;
  const pool: CampaignPool | null = poolData
    ? {
        poolId: row[0] as bigint,
        proposalId: row[1] as bigint,
        organizer: row[2] as string,
        fundingGoal: row[3] as bigint,
        raisedAmount: row[4] as bigint,
        campaignType: row[5] as number,
        campaignTitle: row[6] as string,
        isActive: row[7] as boolean,
        createdAt: row[8] as bigint,
        donors: row[9] as string[],
        fundsWithdrawn: row[10] as boolean,
      }
    : null;

  return {
    pool,
    statusInfo: pool ? {
      status: pool.isActive ? 'active' : 'inactive',
      description: pool.isActive ? 'Accepting donations' : 'Campaign not accepting donations',
      canDonate: pool.isActive,
    } : null,
    canDonate: pool?.isActive ?? false,
    isLoading,
    error,
    refetch,
  };
}

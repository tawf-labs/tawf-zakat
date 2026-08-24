'use client';

import { useCallback, useState } from 'react';
import { useReadContract } from 'wagmi';
import { CONTRACT_ADDRESSES, ZKTCoreABI } from '@/lib/abi';
import { CampaignPool, poolToCampaignPoolData, CampaignPoolData } from '@/lib/types';

/**
 * Hook to fetch campaign pool data from ZKTCore contract
 * @param poolId - The pool ID to fetch (uint256)
 */
export const useCampaign = (poolId?: number | bigint) => {
  const [isLoading, setIsLoading] = useState(false);

  const { data: pool, isLoading: isReadLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESSES.PoolManager,
    abi: ZKTCoreABI,
    functionName: 'getPool',
    args: poolId ? [BigInt(poolId)] : undefined,
    query: {
      enabled: !!poolId && poolId > 0,
      staleTime: 30_000,
      gcTime: 300_000,
    },
  });

  const reloadCampaign = useCallback(async () => {
    setIsLoading(true);
    try {
      await refetch();
    } finally {
      setIsLoading(false);
    }
  }, [refetch]);

  // Convert raw contract data to UI-friendly format
  const campaignData = pool ? poolToCampaignPoolData(pool as any as CampaignPool) : undefined;

  return {
    campaign: campaignData,
    rawPool: pool as CampaignPool | undefined,
    isLoading: isReadLoading || isLoading,
    refetch: reloadCampaign,
  };
};

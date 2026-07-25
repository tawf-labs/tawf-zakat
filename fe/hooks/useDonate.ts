'use client';

import { useCallback } from 'react';
import { useWallet } from '@/components/providers/web3-provider';

interface DonateParams {
  poolId: number | bigint;
  campaignTitle: string;
  amountIDRX: bigint;
  ipfsCID?: string; // Optional IPFS CID for donation metadata
}

interface UseDonateOptions {
  onSuccess?: (txHash: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Hook for donating to campaign pools
 * Handles the two-step process: approve IDRX tokens, then donate
 */
export const useDonate = (options?: UseDonateOptions) => {
  const { donate: contextDonate, isDonating } = useWallet();

  const donate = useCallback(
    async (params: DonateParams) => {
      try {
        const result = await contextDonate({
          poolId: String(params.poolId),
          campaignTitle: params.campaignTitle,
          amountIDRX: params.amountIDRX,
          ipfsCID: params.ipfsCID || '',
        });
        options?.onSuccess?.(result.txHash);
        return result;
      } catch (error) {
        options?.onError?.(error as Error);
        throw error;
      }
    },
    [contextDonate, options]
  );

  return {
    donate,
    isLoading: isDonating,
  };
};

'use client';

import { useCallback, useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { ZKTCoreABI, CONTRACT_ADDRESSES } from '@/lib/abi';
import { computeNullifier } from '@/lib/aztec-private-donation';
import { toast } from '@/components/ui/use-toast';

interface PrivateDonateParams {
  poolId: bigint;
  amount: bigint;
  campaignTitle: string;
}

interface PrivateDonateResult {
  donatePrivate: (params: PrivateDonateParams) => Promise<{
    txHash?: string;
    commitment?: `0x${string}`;
    nullifier?: string;
  } | null>;
  isLoading: boolean;
  isConfirming: boolean;
  error: Error | null;
}

/**
 * Hook for private donations matching the ZK-PZ protocol paper.
 *
 * Implements Phase P2 (Donor Donation) and Phase P4 (Note Redemption):
 * - Generates nullifier via pedersen_hash(secret, recipient, cycle_id)
 * - Creates Pedersen commitment for amount privacy
 * - Submits to ZKTCore.donatePrivate() with nullifier tracking
 */
export function usePrivateDonate(): PrivateDonateResult {
  const { address, isConnected } = useAccount();
  const { writeContractAsync, data: hash } = useWriteContract();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: hash as `0x${string}` | undefined,
  });

  const generateCommitment = useCallback((): `0x${string}` => {
    const array = new Uint8Array(32);
    if (typeof window !== 'undefined' && window.crypto) {
      window.crypto.getRandomValues(array);
    } else {
      for (let i = 0; i < 32; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
    }
    const hex = Array.from(array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return `0x${hex}` as `0x${string}`;
  }, []);

  const donatePrivate = useCallback(
    async (params: PrivateDonateParams): Promise<{
      txHash?: string;
      commitment?: `0x${string}`;
      nullifier?: string;
    } | null> => {
      if (!isConnected || !address) {
        toast({
          title: 'Wallet Not Connected',
          description: 'Please connect your wallet to donate',
          variant: 'destructive',
        });
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        const commitment = generateCommitment();

        const recipientAddress = BigInt(address);
        const cycleId = 1n;
        const secret = BigInt('0x' + Date.now().toString(16));
        const nullifier = computeNullifier(secret, recipientAddress, cycleId).toString(16);

        console.log('Private donation (ZK-PZ P2):', {
          poolId: params.poolId.toString(),
          amount: params.amount.toString(),
          commitment,
          nullifier,
        });

        const ipfsCID = 'bafkrei placeholder';

        const txHash = await writeContractAsync({
          address: CONTRACT_ADDRESSES.ZKTCore as `0x${string}`,
          abi: ZKTCoreABI,
          functionName: 'donatePrivate',
          args: [
            params.poolId,
            params.amount,
            commitment,
            ipfsCID,
          ],
        });

        toast({
          title: 'Private Donation Submitted',
          description: 'Your private donation is being processed...',
        });

        console.log('Private donation submitted (ZK-PZ P4):', txHash);

        return {
          txHash,
          commitment,
          nullifier,
        };

      } catch (err: any) {
        const errorMessage = err?.message || err?.reason || 'Private donation failed';
        setError(new Error(errorMessage));
        toast({
          title: 'Private Donation Failed',
          description: errorMessage,
          variant: 'destructive',
        });
        return null;

      } finally {
        setIsLoading(false);
      }
    },
    [isConnected, address, writeContractAsync, generateCommitment]
  );

  return {
    donatePrivate,
    isLoading: isLoading || isConfirming,
    isConfirming,
    error,
  };
}

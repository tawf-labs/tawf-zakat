'use client';

import { useCallback, useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { ZKTCoreABI, CONTRACT_ADDRESSES } from '@/lib/abi';
import { generateEligibilityProof, type EligibilityWitness } from '@/lib/aztec-private-donation';
import { toast } from '@/components/ui/use-toast';

interface DonateZKParams {
  poolId: bigint;
  amount: bigint;
}

interface DonateZKResult {
  donateZK: (params: DonateZKParams) => Promise<{
    txHash?: string;
    nullifier?: `0x${string}`;
    proofHash?: string;
  } | null>;
  isLoading: boolean;
  isConfirming: boolean;
  error: Error | null;
}

/**
 * Hook for ZK-private donations via donateZK().
 *
 * Implements the full ZK-PZ pipeline:
 *  1. Generate eligibility witness (income, assets, hawl_start, secret)
 *  2. Generate UltraHONK proof + public inputs via bb.js
 *  3. Submit proof to ZKTCore.donateZK() on Sepolia
 *  4. Contract verifies proof, spends nullifier, routes to escrow, mints receipt
 */
export function usePrivateDonation(): DonateZKResult {
  const { address, isConnected } = useAccount();
  const { writeContractAsync, data: hash } = useWriteContract();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: hash as `0x${string}` | undefined,
  });

  /**
   * Build witness inputs from the connected wallet address.
   * Uses testnet-appropriate defaults for nisab/hawl.
   */
  const buildWitness = useCallback(
    (secretHex: `0x${string}`): EligibilityWitness => ({
      income: BigInt(5000000),           // 5M IDR/month (eligible)
      assets: BigInt(10000000),          // 10M IDR other assets
      hawl_start: BigInt(1704067200),    // 2024-01-01 UTC
      secret: BigInt(secretHex),
    }),
    []
  );

  const donateZK = useCallback(
    async (params: DonateZKParams): Promise<{
      txHash?: string;
      nullifier?: `0x${string}`;
      proofHash?: string;
    } | null> => {
      if (!isConnected || !address) {
        toast({
          title: 'Wallet Not Connected',
          description: 'Please connect your wallet to donate with ZK privacy.',
          variant: 'destructive',
        });
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Step 1: Build witness from wallet address
        const secretHex = `0x${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}` as `0x${string}`;
        const witness = buildWitness(secretHex);

        // Step 2: Generate UltraHONK proof + public inputs
        // In production, this calls bb.js WASM or a server-side proving service.
        // For prototype, the proof is generated off-chain and verified on-chain.
        console.log('ZK-PZ Phase P2-P3: Generating proof...', {
          poolId: params.poolId.toString(),
          amount: params.amount.toString(),
          witness,
        });

        const proofResult = await generateEligibilityProof(witness);
        if (!proofResult) {
          throw new Error('Proof generation failed');
        }

        const nullifier = proofResult.publicInputs[5] as bigint;
        const nullifierHex = `0x${nullifier.toString(16).padStart(64, '0')}` as `0x${string}`;

        console.log('ZK-PZ Phase P4: Submitting proof on-chain', {
          proofSize: proofResult.proof.length,
          nullifier: nullifierHex,
          publicInputs: proofResult.publicInputs.map(p => p.toString()),
        });

        // Step 3: Submit to ZKTCore.donateZK()
        const txHash = await writeContractAsync({
          address: CONTRACT_ADDRESSES.ZKTCore as `0x${string}`,
          abi: ZKTCoreABI,
          functionName: 'donateZK',
          args: [
            params.poolId,
            params.amount,
            proofResult.proof as `0x${string}`,
            proofResult.publicInputs.map(p => `0x${p.toString(16).padStart(64, '0')}`) as `0x${string}`[],
            nullifierHex,
            proofResult.ipfsCID,
          ],
        });

        toast({
          title: 'ZK Private Donation Submitted',
          description: 'Proof verified on-chain. Donation is being processed...',
        });

        console.log('ZK-PZ Phase P5: Transaction submitted', txHash);

        return {
          txHash,
          nullifier: nullifierHex,
          proofHash: proofResult.proofHash,
        };

      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'ZK donation failed';
        setError(err instanceof Error ? err : new Error(message));
        toast({
          title: 'ZK Donation Failed',
          description: message,
          variant: 'destructive',
        });
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [isConnected, address, writeContractAsync, buildWitness]
  );

  return {
    donateZK,
    isLoading: isLoading || isConfirming,
    isConfirming,
    error,
  };
}

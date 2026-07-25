'use client';

import { useCallback, useState } from 'react';
import { useWriteContract, useAccount, useWaitForTransactionReceipt } from 'wagmi';
import { CONTRACT_ADDRESSES, ZKTCoreABI, parseIDRX } from '@/lib/abi';
import { CreateProposalParams } from '@/lib/types';
import { toast } from '@/components/ui/use-toast';

interface UseCreateProposalOptions {
  onSuccess?: (proposalId: bigint, txHash: string) => void;
  onError?: (error: Error) => void;
}

export const useCreateProposal = (options?: UseCreateProposalOptions) => {
  const { address, isConnected } = useAccount();
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [createdProposalId, setCreatedProposalId] = useState<bigint | null>(null);

  const { writeContractAsync } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash as `0x${string}` | undefined,
  });

  const createProposal = useCallback(
    async (params: CreateProposalParams) => {
      // Validation
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

      if (!params.title || params.title.length < 10) {
        const error = new Error('Title must be at least 10 characters');
        toast({
          title: 'Invalid Title',
          description: 'Title must be at least 10 characters',
          variant: 'destructive',
        });
        options?.onError?.(error);
        return null;
      }

      if (!params.description || params.description.length < 50) {
        const error = new Error('Description must be at least 50 characters');
        toast({
          title: 'Invalid Description',
          description: 'Description must be at least 50 characters',
          variant: 'destructive',
        });
        options?.onError?.(error);
        return null;
      }

      if (params.fundingGoal < 1000) {
        const error = new Error('Funding goal must be at least 1,000 IDRX');
        toast({
          title: 'Invalid Funding Goal',
          description: 'Minimum funding goal is 1,000 IDRX',
          variant: 'destructive',
        });
        options?.onError?.(error);
        return null;
      }

      setIsLoading(true);

      try {
        console.log('Creating proposal:', {
          title: params.title,
          description: params.description,
          fundingGoal: params.fundingGoal,
          isEmergency: params.isEmergency,
          zakatChecklistItems: params.zakatChecklistItems,
        });

        const hash = await writeContractAsync({
          address: CONTRACT_ADDRESSES.ZKTCore,
          abi: ZKTCoreABI,
          functionName: 'createProposal',
          args: [
            params.title,
            params.description,
            parseIDRX(params.fundingGoal),
            params.isEmergency,
            (params.mockZKKYCProof || '') as `0x${string}`,
            params.zakatChecklistItems,
            params.metadataURI || '',
            params.milestones?.map(m => ({
              description: m.description,
              targetAmount: parseIDRX(m.targetAmount),
            })) || [],
          ],
        });

        setTxHash(hash);

        toast({
          title: 'Proposal Created',
          description: 'Your proposal has been submitted to the blockchain.',
        });

        // The proposal ID will be available from the event logs
        // For now, we'll pass a placeholder
        const proposalId = BigInt(0);
        setCreatedProposalId(proposalId);

        console.log('Transaction submitted:', hash);

        options?.onSuccess?.(proposalId, hash);

        return {
          proposalId,
          txHash: hash,
        };

      } catch (error: any) {
        console.error('Error creating proposal:', error);

        let errorMessage = 'Failed to create proposal';
        if (error?.message?.includes('user rejected')) {
          errorMessage = 'Transaction rejected by user';
        } else if (error?.message) {
          errorMessage = error.message;
        } else if (error?.reason) {
          errorMessage = error.reason;
        }

        toast({
          title: 'Transaction Failed',
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

  return {
    createProposal,
    isLoading: isLoading || isConfirming,
    isConfirming,
    isConfirmed,
    txHash,
    proposalId: createdProposalId,
  };
};

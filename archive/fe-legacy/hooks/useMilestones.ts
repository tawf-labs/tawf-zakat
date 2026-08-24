'use client';

import { useCallback, useState } from 'react';
import { useWriteContract, useAccount, useReadContract } from 'wagmi';
import { CONTRACT_ADDRESSES, ZKTCoreABI } from '@/lib/abi';
import {
  Milestone,
  MilestoneData,
  MilestoneStatus,
  VoteSupport,
  milestoneToMilestoneData,
  getVoteSupportLabel,
} from '@/lib/types';
import { toast } from '@/components/ui/use-toast';

interface UseMilestonesOptions {
  onSuccess?: (txHash: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Fetch all milestones for a proposal
 */
export function useMilestones(proposalId: number | bigint | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: CONTRACT_ADDRESSES.ZKTCore,
    abi: ZKTCoreABI,
    functionName: 'getMilestones',
    args: proposalId !== undefined ? [BigInt(proposalId)] : undefined,
    query: {
      enabled: proposalId !== undefined,
    },
  });

  const milestones: MilestoneData[] = data
    ? (data as Milestone[]).map(milestoneToMilestoneData)
    : [];

  return {
    milestones,
    isLoading,
    error,
    refetch,
  };
}

/**
 * Fetch a single milestone
 */
export function useMilestone(
  proposalId: number | bigint | undefined,
  milestoneId: number | bigint | undefined
) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: CONTRACT_ADDRESSES.ZKTCore,
    abi: ZKTCoreABI,
    functionName: 'getMilestone',
    args:
      proposalId !== undefined && milestoneId !== undefined
        ? [BigInt(proposalId), BigInt(milestoneId)]
        : undefined,
    query: {
      enabled: proposalId !== undefined && milestoneId !== undefined,
    },
  });

  const milestone: MilestoneData | null = data
    ? milestoneToMilestoneData(data as Milestone)
    : null;

  return {
    milestone,
    isLoading,
    error,
    refetch,
  };
}

/**
 * Get milestone count for a proposal
 */
export function useMilestoneCount(proposalId: number | bigint | undefined) {
  const { data, isLoading, error } = useReadContract({
    address: CONTRACT_ADDRESSES.ZKTCore,
    abi: ZKTCoreABI,
    functionName: 'getMilestoneCount',
    args: proposalId !== undefined ? [BigInt(proposalId)] : undefined,
    query: {
      enabled: proposalId !== undefined,
    },
  });

  return {
    count: data ? Number(data) : 0,
    isLoading,
    error,
  };
}

/**
 * Check if user has voted on a milestone
 */
export function useHasVotedOnMilestone(
  proposalId: number | bigint | undefined,
  milestoneId: number | bigint | undefined,
  voterAddress?: string
) {
  const { data, isLoading, error } = useReadContract({
    address: CONTRACT_ADDRESSES.ZKTCore,
    abi: ZKTCoreABI,
    functionName: 'hasVotedOnMilestone',
    args:
      proposalId !== undefined && milestoneId !== undefined && voterAddress
        ? [BigInt(proposalId), BigInt(milestoneId), voterAddress as `0x${string}`]
        : undefined,
    query: {
      enabled: proposalId !== undefined && milestoneId !== undefined && !!voterAddress,
    },
  });

  return {
    hasVoted: data as boolean | undefined,
    isLoading,
    error,
  };
}

/**
 * Hook for milestone write operations
 */
export const useMilestoneActions = (options?: UseMilestonesOptions) => {
  const { address, isConnected } = useAccount();
  const [isLoading, setIsLoading] = useState(false);

  const { writeContractAsync } = useWriteContract();

  /**
   * Submit proof for a milestone (organizer only)
   */
  const submitMilestoneProof = useCallback(
    async (proposalId: number | bigint, milestoneId: number | bigint, ipfsCID: string) => {
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
        console.log('Submitting milestone proof:', {
          proposalId: proposalId.toString(),
          milestoneId: milestoneId.toString(),
          ipfsCID,
        });

        const hash = await writeContractAsync({
          address: CONTRACT_ADDRESSES.ZKTCore,
          abi: ZKTCoreABI,
          functionName: 'submitMilestoneProof',
          args: [BigInt(proposalId), BigInt(milestoneId), ipfsCID],
        });

        toast({
          title: 'Proof Submitted!',
          description: `Milestone proof has been submitted for review.`,
        });

        console.log('Submit proof transaction:', hash);
        options?.onSuccess?.(hash);

        return { txHash: hash };
      } catch (error: any) {
        console.error('Error submitting milestone proof:', error);

        let errorMessage = 'Failed to submit proof';
        if (error?.message?.includes('user rejected')) {
          errorMessage = 'Transaction rejected by user';
        } else if (error?.message?.includes('Only organizer')) {
          errorMessage = 'Only the campaign organizer can submit proof';
        } else if (error?.message) {
          errorMessage = error.message;
        }

        toast({
          title: 'Submission Failed',
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
   * Start voting on a milestone (after proof submitted)
   */
  const startMilestoneVoting = useCallback(
    async (proposalId: number | bigint, milestoneId: number | bigint) => {
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
        console.log('Starting milestone voting:', {
          proposalId: proposalId.toString(),
          milestoneId: milestoneId.toString(),
        });

        const hash = await writeContractAsync({
          address: CONTRACT_ADDRESSES.ZKTCore,
          abi: ZKTCoreABI,
          functionName: 'startMilestoneVoting',
          args: [BigInt(proposalId), BigInt(milestoneId)],
        });

        toast({
          title: 'Voting Started!',
          description: `Community voting has started for this milestone.`,
        });

        console.log('Start voting transaction:', hash);
        options?.onSuccess?.(hash);

        return { txHash: hash };
      } catch (error: any) {
        console.error('Error starting milestone voting:', error);

        let errorMessage = 'Failed to start voting';
        if (error?.message?.includes('user rejected')) {
          errorMessage = 'Transaction rejected by user';
        } else if (error?.message?.includes('Proof not submitted')) {
          errorMessage = 'Proof must be submitted before starting voting';
        } else if (error?.message) {
          errorMessage = error.message;
        }

        toast({
          title: 'Start Voting Failed',
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
   * Vote on a milestone
   */
  const voteMilestone = useCallback(
    async (
      proposalId: number | bigint,
      milestoneId: number | bigint,
      support: VoteSupport
    ) => {
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
        console.log('Voting on milestone:', {
          proposalId: proposalId.toString(),
          milestoneId: milestoneId.toString(),
          support,
          supportLabel: getVoteSupportLabel(support),
        });

        const hash = await writeContractAsync({
          address: CONTRACT_ADDRESSES.ZKTCore,
          abi: ZKTCoreABI,
          functionName: 'voteMilestone',
          args: [BigInt(proposalId), BigInt(milestoneId), support],
        });

        toast({
          title: 'Vote Cast!',
          description: `You voted ${getVoteSupportLabel(support).toLowerCase()} on milestone ${Number(milestoneId) + 1}.`,
        });

        console.log('Vote milestone transaction:', hash);
        options?.onSuccess?.(hash);

        return { txHash: hash };
      } catch (error: any) {
        console.error('Error voting on milestone:', error);

        let errorMessage = 'Failed to cast vote';
        if (error?.message?.includes('user rejected')) {
          errorMessage = 'Transaction rejected by user';
        } else if (error?.message?.includes('Already voted')) {
          errorMessage = 'You have already voted on this milestone';
        } else if (error?.message?.includes('Voting not active')) {
          errorMessage = 'Voting is not active for this milestone';
        } else if (error?.message) {
          errorMessage = error.message;
        }

        toast({
          title: 'Vote Failed',
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
   * Finalize milestone vote (after voting period ends)
   */
  const finalizeMilestoneVote = useCallback(
    async (proposalId: number | bigint, milestoneId: number | bigint) => {
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
        console.log('Finalizing milestone vote:', {
          proposalId: proposalId.toString(),
          milestoneId: milestoneId.toString(),
        });

        const hash = await writeContractAsync({
          address: CONTRACT_ADDRESSES.ZKTCore,
          abi: ZKTCoreABI,
          functionName: 'finalizeMilestoneVote',
          args: [BigInt(proposalId), BigInt(milestoneId)],
        });

        toast({
          title: 'Vote Finalized!',
          description: `Milestone voting has been finalized.`,
        });

        console.log('Finalize milestone vote transaction:', hash);
        options?.onSuccess?.(hash);

        return { txHash: hash };
      } catch (error: any) {
        console.error('Error finalizing milestone vote:', error);

        let errorMessage = 'Failed to finalize vote';
        if (error?.message?.includes('user rejected')) {
          errorMessage = 'Transaction rejected by user';
        } else if (error?.message?.includes('Voting period not ended')) {
          errorMessage = 'Voting period has not ended yet';
        } else if (error?.message) {
          errorMessage = error.message;
        }

        toast({
          title: 'Finalization Failed',
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
   * Withdraw funds for an approved milestone (organizer only)
   */
  const withdrawMilestoneFunds = useCallback(
    async (poolId: number | bigint, milestoneId: number | bigint) => {
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
        console.log('Withdrawing milestone funds:', {
          poolId: poolId.toString(),
          milestoneId: milestoneId.toString(),
        });

        const hash = await writeContractAsync({
          address: CONTRACT_ADDRESSES.ZKTCore,
          abi: ZKTCoreABI,
          functionName: 'withdrawMilestoneFunds',
          args: [BigInt(poolId), BigInt(milestoneId)],
        });

        toast({
          title: 'Funds Withdrawn!',
          description: `Milestone funds have been transferred to your wallet.`,
        });

        console.log('Withdraw milestone funds transaction:', hash);
        options?.onSuccess?.(hash);

        return { txHash: hash };
      } catch (error: any) {
        console.error('Error withdrawing milestone funds:', error);

        let errorMessage = 'Failed to withdraw funds';
        if (error?.message?.includes('user rejected')) {
          errorMessage = 'Transaction rejected by user';
        } else if (error?.message?.includes('Only organizer')) {
          errorMessage = 'Only the campaign organizer can withdraw funds';
        } else if (error?.message?.includes('Milestone not approved')) {
          errorMessage = 'Milestone must be approved before withdrawing';
        } else if (error?.message?.includes('Already withdrawn')) {
          errorMessage = 'Funds have already been withdrawn for this milestone';
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

  return {
    submitMilestoneProof,
    startMilestoneVoting,
    voteMilestone,
    finalizeMilestoneVote,
    withdrawMilestoneFunds,
    isLoading,
  };
};

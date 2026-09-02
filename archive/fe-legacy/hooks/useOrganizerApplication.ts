'use client';

import { useCallback, useState } from 'react';
import { useWriteContract, useAccount, useReadContract } from 'wagmi';
import { CONTRACT_ADDRESSES, ZKTCoreABI } from '@/lib/abi';
import { toast } from '@/components/ui/use-toast';

interface UseOrganizerApplicationOptions {
  onSuccess?: (applicationId: bigint, txHash: string) => void;
  onError?: (error: Error) => void;
}

export interface OrganizerApplicationParams {
  organizationName: string;
  description: string;
  metadataURI?: string;
}

export interface OrganizerApplication {
  applicationId: bigint;
  applicant: string;
  organizationName: string;
  description: string;
  metadataURI: string;
  status: OrganizerApplicationStatus;
  kycStatus: KYCStatus;
  appliedAt: bigint;
  voteStart: bigint;
  voteEnd: bigint;
  votesFor: bigint;
  votesAgainst: bigint;
  votesAbstain: bigint;
  notes: string;
}

export enum OrganizerApplicationStatus {
  Pending = 0,
  KYCReview = 1,
  CommunityVote = 2,
  Approved = 3,
  Rejected = 4,
  Withdrawn = 5,
}

export enum KYCStatus {
  NotRequired = 0,
  Pending = 1,
  Verified = 2,
  Rejected = 3,
}

/**
 * Get organizer application for an address
 */
export function useGetOrganizerApplication(applicantAddress?: string) {
  const { data: applicationId } = useReadContract({
    address: CONTRACT_ADDRESSES.ZKTCore,
    abi: ZKTCoreABI,
    functionName: 'getApplicantApplicationId',
    args: applicantAddress ? [applicantAddress as `0x${string}`] : undefined,
    query: {
      enabled: !!applicantAddress,
    },
  });

  const { data: application, isLoading } = useReadContract({
    address: CONTRACT_ADDRESSES.ZKTCore,
    abi: ZKTCoreABI,
    functionName: 'getOrganizerApplication',
    args: applicationId && applicationId > 0n ? [applicationId] : undefined,
    query: {
      enabled: !!(applicationId && applicationId > 0n),
    },
  });

  return {
    application,
    applicationId,
    isLoading: applicationId === undefined ? false : isLoading,
  };
}

/**
 * Hook for organizer application operations
 */
export const useOrganizerApplication = (options?: UseOrganizerApplicationOptions) => {
  const { address, isConnected } = useAccount();
  const [isLoading, setIsLoading] = useState(false);

  const { writeContractAsync } = useWriteContract();

  /**
   * Submit an organizer application
   */
  const submitApplication = useCallback(
    async (params: OrganizerApplicationParams) => {
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
        console.log('Submitting organizer application:', params);

        const hash = await writeContractAsync({
          address: CONTRACT_ADDRESSES.ZKTCore,
          abi: ZKTCoreABI,
          functionName: 'proposeOrganizer',
          args: [
            params.organizationName,
            params.description,
            params.metadataURI || '',
          ],
        });

        toast({
          title: 'Application Submitted',
          description: 'Your organizer application has been submitted. It will be reviewed by KYC oracle and then voted on by the community.',
        });

        options?.onSuccess?.(BigInt(0), hash);

        return { txHash: hash };

      } catch (error: any) {
        console.error('Error submitting application:', error);

        let errorMessage = 'Failed to submit application';
        if (error?.message?.includes('user rejected')) {
          errorMessage = 'Transaction rejected by user';
        } else if (error?.message?.includes('Already have an application')) {
          errorMessage = 'You already have an existing application';
        } else if (error?.message) {
          errorMessage = error.message;
        }

        toast({
          title: 'Application Failed',
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
   * Submit application for community voting (after KYC verified)
   */
  const submitForVoting = useCallback(
    async (applicationId: number | bigint) => {
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
        console.log('Submitting application for voting:', applicationId.toString());

        const hash = await writeContractAsync({
          address: CONTRACT_ADDRESSES.ZKTCore,
          abi: ZKTCoreABI,
          functionName: 'submitOrganizerApplicationForVote',
          args: [BigInt(applicationId)],
        });

        toast({
          title: 'Submitted for Voting',
          description: `Application ${applicationId} is now open for community voting.`,
        });

        options?.onSuccess?.(BigInt(applicationId), hash);

        return { txHash: hash };

      } catch (error: any) {
        console.error('Error submitting for voting:', error);

        let errorMessage = 'Failed to submit for voting';
        if (error?.message?.includes('user rejected')) {
          errorMessage = 'Transaction rejected by user';
        } else if (error?.message?.includes('KYC must be verified')) {
          errorMessage = 'Application must be KYC verified first';
        } else if (error?.message?.includes('Invalid status')) {
          errorMessage = 'Application is not in the correct status';
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

  return {
    submitApplication,
    submitForVoting,
    isLoading,
  };
};

/**
 * Check if an address is a verified organizer
 */
export function useIsVerifiedOrganizer(organizerAddress?: string) {
  const { data } = useReadContract({
    address: CONTRACT_ADDRESSES.ZKTCore,
    abi: ZKTCoreABI,
    functionName: 'isVerifiedOrganizer',
    args: organizerAddress ? [organizerAddress as `0x${string}`] : undefined,
    query: {
      enabled: !!organizerAddress,
    },
  });

  return {
    isVerified: data ?? false,
  };
}

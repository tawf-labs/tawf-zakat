"use client";

import { useState, useEffect } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { CONTRACT_ADDRESSES, VotingManagerABI, ZKTCoreABI,  } from "@/lib/abi";
import { Proposal, ProposalStatus, KYCStatus, CampaignType, proposalToProposalData, ProposalData } from "@/lib/types";

/**
 * Hook to fetch multiple proposals
 * @param proposalIds - Array of proposal IDs to fetch
 */
export function useProposals(proposalIds: number[] = [0, 1, 2, 3]) {
  // Build contract calls for all proposals at once
  const contracts = proposalIds.map((id) => ({
    address: CONTRACT_ADDRESSES.ProposalManager,
    abi: ZKTCoreABI,
    functionName: "getProposal" as const,
    args: [BigInt(id)] as const,
  }));

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts,
    query: {
      staleTime: 30_000,
      gcTime: 300_000,
      enabled: proposalIds.length > 0,
    },
  });

  // Fetch vote counts from VotingManager for each proposal
  const voteContracts = proposalIds.flatMap((id) => [
    {
      address: CONTRACT_ADDRESSES.VotingManager,
      abi: VotingManagerABI,
      functionName: "votesFor" as const,
      args: [BigInt(id)] as const,
    },
    {
      address: CONTRACT_ADDRESSES.VotingManager,
      abi: VotingManagerABI,
      functionName: "votesAgainst" as const,
      args: [BigInt(id)] as const,
    },
    {
      address: CONTRACT_ADDRESSES.VotingManager,
      abi: VotingManagerABI,
      functionName: "votesAbstain" as const,
      args: [BigInt(id)] as const,
    },
  ]);

  const { data: voteData } = useReadContracts({
    contracts: voteContracts,
    query: {
      staleTime: 30_000,
      gcTime: 300_000,
      enabled: proposalIds.length > 0,
    },
  });

  const proposals: ProposalData[] = data
    ? data
        .map((proposal, index) => {
          if (!proposal || proposal.status !== "success") {
            return null;
          }

          const proposalData = proposal.result as any;

          if (!proposalData || typeof proposalData !== "object") {
            return null;
          }

          // Extract vote counts from VotingManager (3 entries per proposal: votesFor, votesAgainst, votesAbstain)
          const voteIndex = index * 3;
          const votesForData = voteData?.[voteIndex];
          const votesAgainstData = voteData?.[voteIndex + 1];
          const votesAbstainData = voteData?.[voteIndex + 2];

          const votesFor = votesForData?.status === "success" ? (votesForData.result as bigint) : BigInt(0);
          const votesAgainst = votesAgainstData?.status === "success" ? (votesAgainstData.result as bigint) : BigInt(0);
          const votesAbstain = votesAbstainData?.status === "success" ? (votesAbstainData.result as bigint) : BigInt(0);

          // Map the contract response to our Proposal interface
          const prop: Proposal = {
            proposalId: BigInt(proposalIds[index]),
            organizer: proposalData.organizer || "",
            title: proposalData.title || `Proposal ${proposalIds[index]}`,
            description: proposalData.description || "",
            fundingGoal: proposalData.fundingGoal || BigInt(0),
            isEmergency: proposalData.isEmergency || false,
            mockZKKYCProof: proposalData.mockZKKYCProof || "",
            zakatChecklistItems: proposalData.zakatChecklistItems || [],
            createdAt: proposalData.createdAt || BigInt(0),
            status: proposalData.status !== undefined ? Number(proposalData.status) : ProposalStatus.Draft,
            kycStatus: proposalData.kycStatus !== undefined ? Number(proposalData.kycStatus) : KYCStatus.Pending,
            campaignType: proposalData.campaignType !== undefined ? Number(proposalData.campaignType) : CampaignType.Normal,
            poolId: proposalData.poolId || BigInt(0),
            communityVoteStartTime: proposalData.communityVoteStartTime || BigInt(0),
            communityVoteEndTime: proposalData.communityVoteEndTime || BigInt(0),
            votesFor: votesFor,
            votesAgainst: votesAgainst,
            votesAbstain: votesAbstain,
            communityVotePassed: proposalData.communityVotePassed || false,
            metadataURI: proposalData.metadataURI || "",
          };

          return proposalToProposalData(prop);
        })
        .filter((p): p is ProposalData => p !== null)
    : [];

  return {
    proposals,
    isLoading,
    error,
    refetch,
  };
}

/**
 * Hook to fetch a single proposal
 * @param proposalId - The proposal ID to fetch
 */
export function useProposal(proposalId: number) {
  const { proposals, isLoading, error, refetch } = useProposals([proposalId]);

  return {
    proposal: proposals[0],
    isLoading,
    error,
    refetch,
  };
}

/**
 * Hook to get the total proposal count
 */
export function useProposalCount() {
  const { data, isLoading } = useReadContracts({
    contracts: [
      {
        address: CONTRACT_ADDRESSES.ProposalManager,
        abi: ZKTCoreABI,
        functionName: "proposalCount",
      },
    ],
    query: {
      staleTime: 30_000,
    },
  });

  const count = data?.[0]?.status === "success" ? data[0].result : BigInt(0);

  return {
    proposalCount: count as bigint,
    isLoading,
  };
}

/**
 * Hook to get proposals filtered by status
 * @param status - The ProposalStatus to filter by
 */
export function useProposalsByStatus(status: ProposalStatus) {
  const { proposalCount, isLoading: isLoadingCount } = useProposalCount();
  const proposalCountNum = proposalCount ? Number(proposalCount) : 0;

  // Fetch all proposals (in production, this would be optimized)
  const proposalIds = proposalCountNum > 0 ? Array.from({ length: Math.min(proposalCountNum, 50) }, (_, i) => i) : [];
  const { proposals, isLoading, refetch } = useProposals(proposalIds);

  // Filter by status
  const filteredProposals = proposals.filter(p => p.status === status);

  return {
    proposals: filteredProposals,
    isLoading: isLoading || isLoadingCount,
    refetch,
  };
}

/**
 * Hook to get proposals by organizer address
 * @param organizerAddress - The address of the proposal organizer
 */
export function useProposalsByOrganizer(organizerAddress?: string) {
  const { proposalCount, isLoading: isLoadingCount } = useProposalCount();
  const proposalCountNum = proposalCount ? Number(proposalCount) : 0;

  // Fetch all proposals (in production, this would be optimized with event filtering)
  const proposalIds = proposalCountNum > 0 ? Array.from({ length: Math.min(proposalCountNum, 50) }, (_, i) => i) : [];
  const { proposals, isLoading, refetch } = useProposals(proposalIds);

  // Filter by organizer
  const filteredProposals = organizerAddress
    ? proposals.filter(p => p.organizer.toLowerCase() === organizerAddress.toLowerCase())
    : proposals;

  return {
    proposals: filteredProposals,
    isLoading: isLoading || isLoadingCount,
    refetch,
  };
}

/**
 * Hook to get proposal timeline (status change history)
 * Note: This requires tracking status change events or a contract mapping
 * @param proposalId - The proposal ID to get timeline for
 */
export function useProposalTimeline(proposalId: number | bigint) {
  const [timeline, setTimeline] = useState<Array<{
    status: ProposalStatus;
    timestamp: number;
    transactionHash?: string;
  }>>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!proposalId && proposalId !== 0) return;

    // In a full implementation, this would:
    // 1. Query ProposalStatusUpdated events for this proposalId
    // 2. Parse events to extract status, timestamp, and transaction hash
    // 3. Return sorted timeline of status changes

    // For now, returning empty array as placeholder
    setTimeline([]);
  }, [proposalId]);

  return { timeline, isLoading };
}

/**
 * Hook to get active proposals (in voting period)
 */
export function useActiveProposals() {
  return useProposalsByStatus(ProposalStatus.CommunityVote);
}

/**
 * Hook to get proposals pending review
 */
export function usePendingReviewProposals() {
  return useProposalsByStatus(ProposalStatus.CommunityPassed);
}

/**
 * Hook to get approved proposals
 */
export function useApprovedProposals() {
  const { proposals, isLoading, refetch } = useProposalsByStatus(ProposalStatus.ShariaApproved);
  // Also include PoolCreated and Completed as "approved"
  const { proposals: poolProposals, isLoading: isLoadingPools } = useProposalsByStatus(ProposalStatus.PoolCreated);
  const { proposals: completedProposals, isLoading: isLoadingCompleted } = useProposalsByStatus(ProposalStatus.Completed);

  return {
    proposals: [...proposals, ...poolProposals, ...completedProposals],
    isLoading: isLoading || isLoadingPools || isLoadingCompleted,
    refetch,
  };
}

// Type definitions for ZKTCore smart contract integration

/**
 * Proposal Status Enum
 * Represents the lifecycle state of a proposal in the ZKTCore system
 */
export enum ProposalStatus {
  Draft = 0,
  CommunityVote = 1,
  CommunityPassed = 2,
  CommunityRejected = 3,
  ShariaReview = 4,
  ShariaApproved = 5,
  ShariaRejected = 6,
  PoolCreated = 7,
  Completed = 8,
  Canceled = 9,
}

/**
 * KYC Status Enum
 * Represents the KYC verification status of a proposal
 *
 * IMPORTANT: Values must match smart contract enum in IProposalManager.sol:
 * NotRequired = 0, Pending = 1, Verified = 2, Rejected = 3
 */
export enum KYCStatus {
  NotRequired = 0,
  Pending = 1,
  Verified = 2,
  Rejected = 3,
}

/**
 * Zakat Checklist Item Enum
 * Represents the compliance checklist items for Zakat-compliant campaigns
 *
 * IMPORTANT: Values must match smart contract enum in IProposalManager.sol:
 * RecipientsVerified = 0, FundsDistributionPlan = 1, CompliantWithSharia = 2,
 * TransparencyCommitment = 3, RegularReporting = 4
 */
export enum ZakatChecklistItem {
  RecipientsVerified = 0,
  FundsDistributionPlan = 1,
  CompliantWithSharia = 2,
  TransparencyCommitment = 3,
  RegularReporting = 4,
}

/**
 * Campaign Type Enum
 * Represents the type of campaign
 *
 * IMPORTANT: Values must match smart contract enum in IProposalManager.sol:
 * Normal = 0, ZakatCompliant = 1, Emergency = 2
 */
export enum CampaignType {
  Normal = 0,
  ZakatCompliant = 1,
  Emergency = 2,
}

/**
 * Vote Support Enum
 * Represents the vote option (0=against, 1=for, 2=abstain)
 */
export enum VoteSupport {
  Against = 0,
  For = 1,
  Abstain = 2,
}

/**
 * Milestone Status Enum
 * Represents the lifecycle state of a milestone
 */
export enum MilestoneStatus {
  Pending = 0,        // Milestone created, waiting for proof submission
  ProofSubmitted = 1, // Proof uploaded to IPFS, waiting for voting
  Voting = 2,         // Community voting in progress
  Approved = 3,       // Vote passed, funds can be withdrawn
  Rejected = 4,       // Vote failed, needs re-submission
  Completed = 5,      // Funds withdrawn, milestone complete
}

/**
 * Milestone Input Structure
 * Used when creating a proposal with milestones (user-provided fields only)
 */
export interface MilestoneInput {
  description: string;
  targetAmount: bigint;
}

/**
 * Milestone Structure
 * Full milestone data from the contract
 */
export interface Milestone {
  milestoneId: bigint;
  description: string;
  targetAmount: bigint;
  proofIPFS: string;
  status: MilestoneStatus;
  proofSubmittedAt: bigint;
  voteStart: bigint;
  voteEnd: bigint;
  votesFor: bigint;
  votesAgainst: bigint;
  votesAbstain: bigint;
  releasedAt: bigint;
}

/**
 * UI-friendly Milestone Data
 * Converted from contract Milestone for display purposes
 */
export interface MilestoneData {
  id: string;
  description: string;
  targetAmount: string; // Formatted
  targetAmountRaw: bigint;
  proofIPFS: string;
  status: MilestoneStatus;
  statusLabel: string;
  proofSubmittedAt: string; // Formatted date
  voteStart: string; // Formatted date
  voteEnd: string; // Formatted date
  votesFor: string;
  votesAgainst: string;
  votesAbstain: string;
  releasedAt: string; // Formatted date
  isVotingActive: boolean;
  canSubmitProof: boolean;
  canWithdraw: boolean;
}

/**
 * Proposal Structure
 * Represents a proposal in the ZKTCore contract
 */
export interface Proposal {
  proposalId: bigint;
  organizer: string;
  title: string;
  description: string;
  fundingGoal: bigint;
  isEmergency: boolean;
  mockZKKYCProof: string;
  zakatChecklistItems: string[];
  createdAt: bigint;
  status: ProposalStatus;
  kycStatus: KYCStatus;
  campaignType: CampaignType;
  poolId: bigint;
  communityVoteStartTime: bigint;
  communityVoteEndTime: bigint;
  votesFor: bigint;
  votesAgainst: bigint;
  votesAbstain: bigint;
  communityVotePassed: boolean;
  metadataURI: string;
}

/**
 * Campaign Pool Structure
 * Represents a fundraising pool in the ZKTCore contract
 */
export interface CampaignPool {
  poolId: bigint;
  proposalId: bigint;
  organizer: string;
  fundingGoal: bigint;
  raisedAmount: bigint;
  campaignType: CampaignType;
  campaignTitle: string;
  isActive: boolean;
  createdAt: bigint;
  donors: string[];
  fundsWithdrawn: boolean;
}

/**
 * UI-friendly Proposal Data
 * Converted from contract Proposal for display purposes
 */
export interface ProposalData {
  id: string;
  title: string;
  description: string;
  organizer: string;
  fundingGoal: string; // Formatted
  fundingGoalRaw: bigint;
  isEmergency: boolean;
  status: ProposalStatus;
  kycStatus: KYCStatus;
  campaignType: CampaignType;
  poolId: string;
  createdAt: string; // Formatted date
  createdAtRaw: bigint;
  communityVoteStartTime: string; // Formatted date
  communityVoteEndTime: string; // Formatted date
  votesFor: string; // Formatted
  votesAgainst: string; // Formatted
  votesAbstain: string; // Formatted
  communityVotePassed: boolean;
  isActive: boolean;
  isPendingReview: boolean;
  isShariaApproved: boolean;
  isCompleted: boolean;
  metadataURI: string;
}

/**
 * UI-friendly Campaign Pool Data
 * Converted from contract CampaignPool for display purposes
 */
export interface CampaignPoolData {
  poolId: string;
  proposalId: string;
  organizer: string;
  fundingGoal: string; // Formatted
  fundingGoalRaw: bigint;
  raisedAmount: string; // Formatted
  raisedAmountRaw: bigint;
  campaignType: CampaignType;
  campaignTitle: string;
  isActive: boolean;
  createdAt: string; // Formatted date
  createdAtRaw: bigint;
  donors: string[];
  donorCount: number;
  fundsWithdrawn: boolean;
  progressPercentage: number;
}

/**
 * Create Proposal Parameters
 */
export interface CreateProposalParams {
  title: string;
  description: string;
  fundingGoal: number; // In IDRX (will be converted to wei)
  isEmergency: boolean;
  mockZKKYCProof: string;
  zakatChecklistItems: string[];
  metadataURI?: string;
  milestones: { description: string; targetAmount: number }[]; // In IDRX (will be converted to wei)
}

/**
 * Vote Parameters
 */
export interface VoteParams {
  proposalId: number | bigint;
  support: VoteSupport; // 0=against, 1=for, 2=abstain
}

/**
 * Donate Parameters
 */
export interface DonateParams {
  poolId: number | bigint;
  amount: number; // In IDRX (will be converted to wei)
  ipfsCID?: string;
}

/**
 * Sharia Review Parameters
 */
export interface ShariaReviewParams {
  bundleId: number | bigint;
  proposalId: number | bigint;
  approved: boolean;
  campaignType: CampaignType;
  mockZKReviewProof: string;
}

/**
 * Proposal Status Helper Functions
 */
export function getProposalStatusLabel(status: ProposalStatus): string {
  const labels: Record<ProposalStatus, string> = {
    [ProposalStatus.Draft]: 'Draft',
    [ProposalStatus.CommunityVote]: 'Community Vote',
    [ProposalStatus.CommunityPassed]: 'Community Passed',
    [ProposalStatus.CommunityRejected]: 'Community Rejected',
    [ProposalStatus.ShariaReview]: 'Sharia Review',
    [ProposalStatus.ShariaApproved]: 'Sharia Approved',
    [ProposalStatus.ShariaRejected]: 'Sharia Rejected',
    [ProposalStatus.PoolCreated]: 'Pool Created',
    [ProposalStatus.Completed]: 'Completed',
    [ProposalStatus.Canceled]: 'Canceled',
  };
  return labels[status] || 'Unknown';
}

export function getProposalStatusColor(status: ProposalStatus): string {
  const colors: Record<ProposalStatus, string> = {
    [ProposalStatus.Draft]: 'bg-gray-100 text-gray-700 border-gray-300',
    [ProposalStatus.CommunityVote]: 'bg-blue-100 text-blue-700 border-blue-300',
    [ProposalStatus.CommunityPassed]: 'bg-green-100 text-green-700 border-green-300',
    [ProposalStatus.CommunityRejected]: 'bg-red-100 text-red-700 border-red-300',
    [ProposalStatus.ShariaReview]: 'bg-yellow-100 text-yellow-700 border-yellow-300',
    [ProposalStatus.ShariaApproved]: 'bg-emerald-100 text-emerald-700 border-emerald-300',
    [ProposalStatus.ShariaRejected]: 'bg-red-100 text-red-700 border-red-300',
    [ProposalStatus.PoolCreated]: 'bg-purple-100 text-purple-700 border-purple-300',
    [ProposalStatus.Completed]: 'bg-green-100 text-green-700 border-green-300',
    [ProposalStatus.Canceled]: 'bg-gray-100 text-gray-700 border-gray-300',
  };
  return colors[status] || 'bg-gray-100 text-gray-700 border-gray-300';
}

export function getKYCStatusLabel(status: KYCStatus): string {
  const labels: Record<KYCStatus, string> = {
    [KYCStatus.NotRequired]: 'Not Required',
    [KYCStatus.Pending]: 'Pending',
    [KYCStatus.Verified]: 'Verified',
    [KYCStatus.Rejected]: 'Rejected',
  };
  return labels[status] || 'Unknown';
}

export function getCampaignTypeLabel(type: CampaignType): string {
  const labels: Record<CampaignType, string> = {
    [CampaignType.Normal]: 'Normal',
    [CampaignType.ZakatCompliant]: 'Zakat Compliant',
    [CampaignType.Emergency]: 'Emergency',
  };
  return labels[type] || 'Unknown';
}

export function getVoteSupportLabel(support: VoteSupport): string {
  const labels: Record<VoteSupport, string> = {
    [VoteSupport.Against]: 'Against',
    [VoteSupport.For]: 'For',
    [VoteSupport.Abstain]: 'Abstain',
  };
  return labels[support] || 'Unknown';
}

/**
 * Convert contract Proposal to UI-friendly ProposalData
 */
export function proposalToProposalData(proposal: Proposal): ProposalData {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const isActive = proposal.status === ProposalStatus.CommunityVote &&
    proposal.communityVoteStartTime <= now &&
    proposal.communityVoteEndTime >= now;
  const isPendingReview = proposal.status === ProposalStatus.CommunityPassed;
  const isShariaApproved = proposal.status === ProposalStatus.ShariaApproved ||
    proposal.status === ProposalStatus.PoolCreated ||
    proposal.status === ProposalStatus.Completed;
  const isCompleted = proposal.status === ProposalStatus.Completed;
  const metadataURI = proposal.metadataURI ? proposal.metadataURI.replace("ipfs://", "") : "";

  return {
    id: proposal.proposalId.toString(),
    title: proposal.title,
    description: proposal.description,
    organizer: proposal.organizer,
    fundingGoal: formatIDRX(proposal.fundingGoal),
    fundingGoalRaw: proposal.fundingGoal,
    isEmergency: proposal.isEmergency,
    status: proposal.status,
    kycStatus: proposal.kycStatus,
    campaignType: proposal.campaignType,
    poolId: proposal.poolId.toString(),
    createdAt: formatTimestamp(Number(proposal.createdAt)),
    createdAtRaw: proposal.createdAt,
    communityVoteStartTime: formatTimestamp(Number(proposal.communityVoteStartTime)),
    communityVoteEndTime: formatTimestamp(Number(proposal.communityVoteEndTime)),
    votesFor: proposal.votesFor.toString(),
    votesAgainst: proposal.votesAgainst.toString(),
    votesAbstain: proposal.votesAbstain.toString(),
    communityVotePassed: proposal.communityVotePassed,
    isActive,
    isPendingReview,
    isShariaApproved,
    isCompleted,
    metadataURI
  };
}

/**
 * Convert contract CampaignPool to UI-friendly CampaignPoolData
 */
export function poolToCampaignPoolData(pool: CampaignPool): CampaignPoolData {
  const progressPercentage = pool.fundingGoal > BigInt(0)
    ? Number((pool.raisedAmount * BigInt(100)) / pool.fundingGoal)
    : 0;

  return {
    poolId: pool.poolId.toString(),
    proposalId: pool.proposalId.toString(),
    organizer: pool.organizer,
    fundingGoal: formatIDRX(pool.fundingGoal),
    fundingGoalRaw: pool.fundingGoal,
    raisedAmount: formatIDRX(pool.raisedAmount),
    raisedAmountRaw: pool.raisedAmount,
    campaignType: pool.campaignType,
    campaignTitle: pool.campaignTitle,
    isActive: pool.isActive,
    createdAt: formatTimestamp(Number(pool.createdAt)),
    createdAtRaw: pool.createdAt,
    donors: pool.donors,
    donorCount: pool.donors.length,
    fundsWithdrawn: pool.fundsWithdrawn,
    progressPercentage,
  };
}

/**
 * Helper functions for formatting blockchain data
 */
export function formatIDRX(amount: bigint): string {
  const value = Number(amount) / 1e18;
  return value.toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

export function parseIDRX(amount: number): bigint {
  return BigInt(Math.floor(amount * 1e18));
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('id-ID', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatAddress(address: string): string {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Milestone Status Helper Functions
 */
export function getMilestoneStatusLabel(status: MilestoneStatus): string {
  const labels: Record<MilestoneStatus, string> = {
    [MilestoneStatus.Pending]: 'Pending',
    [MilestoneStatus.ProofSubmitted]: 'Proof Submitted',
    [MilestoneStatus.Voting]: 'Voting',
    [MilestoneStatus.Approved]: 'Approved',
    [MilestoneStatus.Rejected]: 'Rejected',
    [MilestoneStatus.Completed]: 'Completed',
  };
  return labels[status] || 'Unknown';
}

export function getMilestoneStatusColor(status: MilestoneStatus): string {
  const colors: Record<MilestoneStatus, string> = {
    [MilestoneStatus.Pending]: 'bg-gray-100 text-gray-700 border-gray-300',
    [MilestoneStatus.ProofSubmitted]: 'bg-blue-100 text-blue-700 border-blue-300',
    [MilestoneStatus.Voting]: 'bg-yellow-100 text-yellow-700 border-yellow-300',
    [MilestoneStatus.Approved]: 'bg-green-100 text-green-700 border-green-300',
    [MilestoneStatus.Rejected]: 'bg-red-100 text-red-700 border-red-300',
    [MilestoneStatus.Completed]: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  };
  return colors[status] || 'bg-gray-100 text-gray-700 border-gray-300';
}

/**
 * Convert contract Milestone to UI-friendly MilestoneData
 */
export function milestoneToMilestoneData(milestone: Milestone): MilestoneData {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const isVotingActive = milestone.status === MilestoneStatus.Voting &&
    milestone.voteStart <= now &&
    milestone.voteEnd >= now;
  const canSubmitProof = milestone.status === MilestoneStatus.Pending ||
    milestone.status === MilestoneStatus.Rejected;
  const canWithdraw = milestone.status === MilestoneStatus.Approved;

  return {
    id: milestone.milestoneId.toString(),
    description: milestone.description,
    targetAmount: formatIDRX(milestone.targetAmount),
    targetAmountRaw: milestone.targetAmount,
    proofIPFS: milestone.proofIPFS,
    status: milestone.status,
    statusLabel: getMilestoneStatusLabel(milestone.status),
    proofSubmittedAt: milestone.proofSubmittedAt > BigInt(0)
      ? formatTimestamp(Number(milestone.proofSubmittedAt))
      : '-',
    voteStart: milestone.voteStart > BigInt(0)
      ? formatTimestamp(Number(milestone.voteStart))
      : '-',
    voteEnd: milestone.voteEnd > BigInt(0)
      ? formatTimestamp(Number(milestone.voteEnd))
      : '-',
    votesFor: milestone.votesFor.toString(),
    votesAgainst: milestone.votesAgainst.toString(),
    votesAbstain: milestone.votesAbstain.toString(),
    releasedAt: milestone.releasedAt > BigInt(0)
      ? formatTimestamp(Number(milestone.releasedAt))
      : '-',
    isVotingActive,
    canSubmitProof,
    canWithdraw,
  };
}

/**
 * Milestone Vote Parameters
 */
export interface MilestoneVoteParams {
  proposalId: number | bigint;
  milestoneId: number | bigint;
  support: VoteSupport;
}

/**
 * Submit Milestone Proof Parameters
 */
export interface SubmitMilestoneProofParams {
  proposalId: number | bigint;
  milestoneId: number | bigint;
  ipfsCID: string;
}

/**
 * Withdraw Milestone Funds Parameters
 */
export interface WithdrawMilestoneFundsParams {
  poolId: number | bigint;
  milestoneId: number | bigint;
}

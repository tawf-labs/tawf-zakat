/** Allowlisted donor/amil trace HTTP contracts. No dependency on server modules. */
import type { CertificateMintState, CertificateValidity, ReplacementState, ScopeSourceStatus } from "./certificate-nft";
import type { ContributionRefund, DonorContributionCorrection } from "./contribution-lifecycle";

export type Unavailable = { status: "UNAVAILABLE"; reason: string };
export type Track<T> = { status: "OK"; data: T } | Unavailable;
export type ConfirmationCounts = { total: number; confirmed: number; disputed: number; unconfirmed: number };
export type DeliveryHeadline = "NOT_STARTED" | "IN_PROGRESS" | "DELIVERED_WITH_OPEN_ITEMS" | "DELIVERED_AND_SETTLED";
export type OpenItem = "COSTS_UNACCOUNTED" | "GOODS_UNVALUED" | "CONFIRMATION_PENDING" | "DISPUTE_OPEN" | "CONTRIBUTION_SHORTFALL" | "OVER_COMMITMENT" | "PUBLICATION_PENDING" | "SOURCE_UNAVAILABLE";
export type DonorZkProofStatus = "NOT_AVAILABLE" | "UNCONFIRMED" | "PENDING" | "PROVING" | "VERIFIED" | "FAILED" | "SUPERSEDED";
export interface DonorZkProofDetail {
  status: DonorZkProofStatus;
  batchId?: string; batchNumber?: number; version?: number; batchRoot?: string;
  receiptCommitment?: string; txHash?: string; blockNumber?: number; verifiedAt?: number; failureReason?: string;
}
export type CertificateLineView = {
  certificateId: string;
  /** Latest issuance attempt, distinct from the last published version. Reasons are sanitized. */
  issuance: { state: CertificateMintState; reason: string | null };
  published: null | {
    version: string; validity: CertificateValidity | null; observationState: CertificateMintState;
    replacementState: ReplacementState | null; scopeStatus: ScopeSourceStatus | null;
    issuer: string; contentDigest: string; verifierPath: string;
    totals: { confirmedCount: number; disputedCount: number; unconfirmedCount: number };
  };
};
export type CertificateTrack = { lines: CertificateLineView[]; pendingCount: number };
export type ActivityTrackView = {
  identity: { activityId: string; proposalId: string; proposalVersion: number; activityVersion: number; name: string; currencyUnit: string; observedAt: number };
  distribution: Track<{
    proposalStatus: string; isRemainderClosed: boolean; recordedRealizations: number;
    unitSummaries: Array<{ aidType: string; unit: string; approved: string; realized: string; remaining: string }>;
    committedAidIdr: string; hasUnvaluedGoods: boolean;
  }>;
  funds: Track<{
    currencyUnit: string; totalAllocatedAmount: string; totalRealizedMoneyIdr: string; totalRealizedGoodsIdr: string;
    totalExpensesIdr: string;
    totalAdvancesIdr: string; unaccountedAdvancesIdr: string; totalCommittedAidIdr: string;
    totalContributionShortfall: string; totalOverCommitmentIdr: string; availabilityStatus: string; availabilityReason: string;
  }>;
  confirmation: Track<ConfirmationCounts>; certificates: Track<CertificateTrack>;
  summary: Track<{ headline: DeliveryHeadline; openItems: OpenItem[] }>;
};
export type DonorTraceActivity = {
  allocationId: string; allocatedAmountExact: string; currencyUnit: string; fundType: string; allocatedAt: number;
  allocatedAgainstVersion: number; allocationBasis: "CURRENT" | "BEFORE_CORRECTION";
  pooledAllocationCount: number; track: ActivityTrackView | Unavailable;
};
export type DonorReallocation = { kind: "REALLOCATED"; amountExact: string; currencyUnit: string; toActivityName: string | null; at: number; reason: string };
export type DonorRefund = Pick<ContributionRefund, "id" | "status" | "amountExact" | "currencyUnit" | "decidedAt" | "paidAt">;
export type TraceClaimLimits = { pooled: string; receipt: string; certificate: string; report: string };
export type DonorTrace = {
  contribution: { id: string; version: number; status: string; receivedAt: number; corrections: DonorContributionCorrection[]; proof: DonorZkProofDetail; proofMatchesContributionVersion: boolean | null };
  activities: DonorTraceActivity[]; changes: DonorReallocation[]; refunds: Track<DonorRefund[]>;
  claimLimits: TraceClaimLimits; receiptVerifierPath: string;
};
export type Difference = "PROPOSAL_VERSION" | "ALLOCATED_TOTAL" | "REALIZATION_COUNT";
export type FrozenSource = {
  status: "READ"; preparationId: string; label: string; commitment: string; periodKind: string; periodYear: number;
  role: string; cutOff: string; frozenAt: number; currentness: "HISTORICAL_SNAPSHOT";
  frozen: { proposalVersion: number; allocatedByUnit: Record<string, string>; allocationCount: number; realizationCount: number };
  differsFromCurrent: Difference[];
} | { status: "UNAVAILABLE" | "FAILED"; preparationId: string; label: string; role: "CLAIM" | "SOURCE"; reason: string };
export type AmilTrace = { activity: ActivityTrackView; reportSources: Track<FrozenSource[]>; claimLimits: Pick<TraceClaimLimits, "report" | "certificate"> };

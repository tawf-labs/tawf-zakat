import type { PrivateRequests } from "../workspace/privateRequests";
import type { CurrencyUnit, JenisDana, SourceChannel } from "../contributions/contributionClient";

/**
 * Distribution Activities & Contribution Allocations Client (Ticket #103, Spec #100).
 *
 * The types mirror `backend/src/activity.ts` and `activity-store.ts`. An activity follows
 * one approved proposal version; an allocation is an explicit part of an endorsed
 * contribution and keeps its fund type and purpose. Every mutation carries an operationId.
 */

export const FUNDING_RECORD_DISCLAIMER =
  "Catatan pendanaan teralokasi merupakan komitmen pencatatan internal lembaga, bukan saldo bank terverifikasi atau bukti serah terima bantuan fisik.";

/** Program fund type, as `FundType` in `backend/src/disbursement.ts`. */
export type ProgramFundType = "ZAKAT" | "INFAK" | "SEDEKAH" | "LAINNYA";

export type DistributionActivity = {
  id: string;
  institutionId: string;
  proposalId: string;
  proposalVersion: number;
  programId: string;
  programFundType: ProgramFundType;
  name: string;
  description: string | null;
  targetAmount: string;
  /** A goods line has no rupiah valuation, so the target understates the need. */
  targetIsPartial: boolean;
  currencyUnit: CurrencyUnit;
  status: "ACTIVE";
  version: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  totalAllocatedAmount: string;
  unallocatedNeed: string;
  contributionCount: number;
  isFullyAllocated: boolean;
  disclaimer: string;
  tracingCoverage: string;
};

export type ContributionAllocation = {
  id: string;
  institutionId: string;
  contributionId: string;
  activityId: string;
  currencyUnit: CurrencyUnit;
  amountExact: string;
  fundType: JenisDana;
  purpose: string;
  reason: string;
  status: "ACTIVE" | "REALLOCATED";
  allocatedAt: number;
  allocatedBy: string;
  allocatedByOfficerId: string | null;
  contributionVersion: number;
  version: number;
  createdAt: number;
  updatedAt: number;
};

/** Donor-level detail; null when the reader holds no contribution mandate. */
export type AllocationSource = { donorName: string | null; sourceChannel: SourceChannel; sourceReference: string };

export type AllocationHistoryEntry = {
  id: number;
  allocationId: string;
  contributionId: string;
  activityId: string;
  version: number;
  contributionVersion: number;
  action: "ALLOCATE" | "REALLOCATE_OUT" | "REALLOCATE_IN";
  actorAccount: string;
  actorOfficerId: string | null;
  fromStatus: "ACTIVE" | "REALLOCATED" | null;
  toStatus: "ACTIVE" | "REALLOCATED";
  amountExact: string;
  reason: string;
  occurredAt: number;
};

export type ActivityAvailabilityStatus = "AVAILABLE" | "INDETERMINATE" | "NONE";

export type ActivityAccountabilitySummary = {
  activityId: string;
  proposalId: string;
  proposalVersion: number;
  proposalStatus: string;
  currencyUnit: CurrencyUnit;
  isRemainderClosed: boolean;
  totalAllocatedAmount: string;
  totalRealizedMoneyIdr: string;
  totalExpensesIdr: string;
  totalDirectExpensesIdr: string;
  totalAccountedExpensesIdr: string;
  totalAdvancesIdr: string;
  unaccountedAdvancesIdr: string;
  hasOutstandingAccountability: boolean;
  /** Approved money not yet realized: still owed to mustahik. */
  totalCommittedMoneyIdr: string;
  /** Valuation of approved goods not yet handed over. */
  totalCommittedGoodsIdr: string;
  /** The whole outstanding aid commitment, money and goods together. */
  totalCommittedAidIdr: string;
  /** Allocations standing above the contributions still backing them, after a correction. */
  totalContributionShortfall: string;
  /** What spending and commitments exceed this activity's allocation by; zero when they balance. */
  totalOverCommitmentIdr: string;
  hasUnvaluedGoods: boolean;
  unitSummaries: Array<{ aidType: string; unit: string; approved: string; realized: string; remaining: string }>;
  availabilityStatus: ActivityAvailabilityStatus;
  availableForReallocation: string;
  availabilityReason: string;
  disclaimer: string;
};

export type ReallocationDecision = {
  id: string;
  institutionId: string;
  sourceActivityId: string;
  targetActivityId: string;
  sourceAllocationId: string;
  targetAllocationId: string;
  contributionId: string;
  amountExact: string;
  fundType: JenisDana;
  purpose: string;
  reason: string;
  decidedByAccount: string;
  decidedByOfficerId: string | null;
  sourceActivityVersion: number;
  targetActivityVersion: number;
  sourceAllocationVersion: number;
  targetAllocationVersion: number;
  occurredAt: number;
  createdAt: number;
};

export type ActivityDetail = DistributionActivity & {
  allocations: Array<ContributionAllocation & { source: AllocationSource | null }>;
  history: AllocationHistoryEntry[];
  accountability?: ActivityAccountabilitySummary;
  reallocations?: ReallocationDecision[];
};

export type ContributionBalance = {
  allocatedAmount: string;
  unallocatedAmount: string;
  /** Allocations above the recorded amount after a correction. */
  shortfallAmount: string;
};

export type AllocateInput = {
  activityId: string;
  amountExact: string;
  reason: string;
  expectedVersion: number;
  operationId: string;
};

export type ReallocateInput = {
  targetActivityId: string;
  sourceAllocationId: string;
  amountExact: string;
  fundType?: string;
  purpose?: string;
  reason: string;
  /** The source activity version being spent against, as every workspace mutation carries it. */
  expectedVersion: number;
  /** The target activity version the officer read; the server refuses a stale one. */
  expectedTargetActivityVersion?: number;
  operationId: string;
};

export async function listActivities(requests: PrivateRequests): Promise<DistributionActivity[]> {
  const res = await requests.json<{ activities: DistributionActivity[] }>("/api/workspace/activities");
  return res.activities;
}

export async function getActivity(requests: PrivateRequests, id: string): Promise<ActivityDetail> {
  const res = await requests.json<{ activity: ActivityDetail }>(`/api/workspace/activities/${encodeURIComponent(id)}`);
  return res.activity;
}

export async function createActivity(
  requests: PrivateRequests,
  input: { proposalId: string; name?: string; description?: string; operationId: string }
): Promise<DistributionActivity> {
  const res = await requests.json<{ activity: DistributionActivity }>("/api/workspace/activities", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.activity;
}

export async function allocateContribution(
  requests: PrivateRequests,
  contributionId: string,
  input: AllocateInput
): Promise<{ allocation: ContributionAllocation; contributionSummary: ContributionBalance; activitySummary: DistributionActivity }> {
  return requests.json(`/api/workspace/contributions/${encodeURIComponent(contributionId)}/allocate`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listContributionAllocations(
  requests: PrivateRequests,
  contributionId: string
): Promise<{ allocations: Array<ContributionAllocation & { activityName: string }>; history: AllocationHistoryEntry[] }> {
  return requests.json(`/api/workspace/contributions/${encodeURIComponent(contributionId)}/allocations`);
}

export async function getActivityAccountability(
  requests: PrivateRequests,
  activityId: string
): Promise<ActivityAccountabilitySummary> {
  const res = await requests.json<{ accountability: ActivityAccountabilitySummary }>(
    `/api/workspace/activities/${encodeURIComponent(activityId)}/accountability`
  );
  return res.accountability;
}

export async function listReallocations(
  requests: PrivateRequests,
  activityId: string
): Promise<ReallocationDecision[]> {
  const res = await requests.json<{ reallocations: ReallocationDecision[] }>(
    `/api/workspace/activities/${encodeURIComponent(activityId)}/reallocations`
  );
  return res.reallocations;
}

export async function reallocateAllocation(
  requests: PrivateRequests,
  sourceActivityId: string,
  input: ReallocateInput
): Promise<{
  decision: ReallocationDecision;
  sourceAllocation: ContributionAllocation;
  targetAllocation: ContributionAllocation;
  sourceActivitySummary: DistributionActivity;
  targetActivitySummary: DistributionActivity;
  sourceAccountability: ActivityAccountabilitySummary;
}> {
  return requests.json(`/api/workspace/activities/${encodeURIComponent(sourceActivityId)}/reallocate`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Percent of a known target that is allocated; null when the target is partial or zero. */
export function allocationPercent(activity: Pick<DistributionActivity, "targetAmount" | "targetIsPartial" | "totalAllocatedAmount">): number | null {
  const target = BigInt(activity.targetAmount);
  if (activity.targetIsPartial || target === 0n) return null;
  return Number((BigInt(activity.totalAllocatedAmount) * 100n) / target);
}

/**
 * Activity & Allocation Store (Spec #100, Ticket #103).
 *
 * Distribution activities and contribution allocations, durable and isolated by
 * institution. The allocation limit is checked under a row lock on the contribution,
 * one activity per proposal version is held by a lock on the proposal and a unique
 * index, and every mutation is replayed from `activity_operations` on retry.
 */

import { sql, type SQL } from "drizzle-orm";
import {
  ActivityRuleError,
  FUNDING_RECORD_DISCLAIMER,
  TRACING_COVERAGE,
  activityFunding,
  activityTarget,
  allocationTerms,
  calculateActivityAccountability,
  parseExactAmount,
  summarizeAidLines,
  type ActivityAccountabilitySummary,
  type ActivitySummary,
  type AllocationHistoryRecord,
  type ContributionAllocationRecord,
  type ContributionAllocationSummary,
  type ContributionBalance,
  type DistributionActivityRecord,
  type ReallocationDecisionRecord,
} from "./activity";
import {
  beneficiaryPseudonyms,
  fillAllocation,
  fillTargetsFrom,
  type FillResult,
} from "./allocation-fill";
import { normalizeFundType, type JenisDana } from "./contribution";
import { type AidLine, type Beneficiary, type FundType } from "./disbursement";
import type { ActivityTraceData } from "./realization-source";
import { loadOperationalCosts } from "./operational-cost-sql";
import { operationalCostTotals } from "./operational-cost";

type Executor = { execute: (query: SQL) => Promise<unknown> };

export type ActivityDatabase = Executor & {
  transaction: <T>(run: (tx: Executor) => Promise<T>) => Promise<T>;
};

export class ActivityNotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`${what} "${id}" tidak ditemukan pada ruang kerja lembaga ini.`);
    this.name = "ActivityNotFoundError";
  }
}

export class ActivityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivityConflictError";
  }
}

export class AllocationOverLimitError extends Error {
  constructor(
    readonly available: string,
    readonly requested: string
  ) {
    super(
      `Nominal alokasi (${requested}) melebihi sisa kontribusi yang tersedia (${available}). Alokasi baru dibatasi kontribusi tercatat.`
    );
    this.name = "AllocationOverLimitError";
  }
}

export class AllocationAvailabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllocationAvailabilityError";
  }
}

export class ActivityOperationConflictError extends Error {
  constructor() {
    super("Identitas operasi (operationId) sudah digunakan untuk permintaan berbeda.");
    this.name = "ActivityOperationConflictError";
  }
}

export type ActivityOperation = {
  id: string;
  account: string;
  requestHash: string;
};

export type ActivityActor = { account: string; officerId: string | null };

/** Donor-level detail, only for readers holding a contribution mandate. */
export type AllocationSource = {
  donorName: string | null;
  sourceChannel: string;
  sourceReference: string;
};

export type ActivityAllocation = ContributionAllocationRecord & { source: AllocationSource | null };

export type ActivityDetail = ActivitySummary & {
  allocations: ActivityAllocation[];
  history: AllocationHistoryRecord[];
  accountability: ActivityAccountabilitySummary;
  reallocations: ReallocationDecisionRecord[];
};

export type ContributionAllocation = ContributionAllocationRecord & { activityName: string };

const rowsOf = (result: any): any[] =>
  Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];

export const ACTIVITY_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS distribution_activities (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL REFERENCES institutions(id),
    proposal_id TEXT NOT NULL REFERENCES proposal_drafts(id),
    proposal_version INTEGER NOT NULL,
    program_id TEXT NOT NULL REFERENCES programs(id),
    program_fund_type TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    target_amount TEXT NOT NULL,
    target_is_partial BOOLEAN NOT NULL,
    currency_unit TEXT NOT NULL DEFAULT 'IDR',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    version INTEGER NOT NULL DEFAULT 1,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    created_by TEXT NOT NULL,
    CONSTRAINT distribution_activities_status_known CHECK (status IN ('ACTIVE'))
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS distribution_activities_one_per_proposal_version
    ON distribution_activities (institution_id, proposal_id, proposal_version);`,

  // No cascades: an allocation and its history outlive any attempt to delete what they reference.
  `CREATE TABLE IF NOT EXISTS contribution_allocations (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL REFERENCES institutions(id),
    contribution_id TEXT NOT NULL REFERENCES contributions(id),
    activity_id TEXT NOT NULL REFERENCES distribution_activities(id),
    currency_unit TEXT NOT NULL,
    amount_exact TEXT NOT NULL,
    fund_type TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    allocated_at BIGINT NOT NULL,
    allocated_by TEXT NOT NULL,
    allocated_by_officer_id TEXT REFERENCES officer_profiles(id),
    contribution_version INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    CONSTRAINT contribution_allocations_status_known CHECK (status IN ('ACTIVE', 'REALLOCATED'))
  );`,
  `CREATE INDEX IF NOT EXISTS contribution_allocations_by_contribution
    ON contribution_allocations (institution_id, contribution_id);`,
  `CREATE INDEX IF NOT EXISTS contribution_allocations_by_activity
    ON contribution_allocations (institution_id, activity_id);`,

  `CREATE TABLE IF NOT EXISTS allocation_history (
    id SERIAL PRIMARY KEY,
    allocation_id TEXT NOT NULL REFERENCES contribution_allocations(id),
    institution_id TEXT NOT NULL REFERENCES institutions(id),
    contribution_id TEXT NOT NULL REFERENCES contributions(id),
    activity_id TEXT NOT NULL REFERENCES distribution_activities(id),
    version INTEGER NOT NULL,
    contribution_version INTEGER NOT NULL,
    action TEXT NOT NULL,
    actor_account TEXT NOT NULL,
    actor_officer_id TEXT REFERENCES officer_profiles(id),
    from_status TEXT,
    to_status TEXT NOT NULL,
    amount_exact TEXT NOT NULL,
    reason TEXT NOT NULL,
    occurred_at BIGINT NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS reallocation_decisions (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL REFERENCES institutions(id),
    source_activity_id TEXT NOT NULL REFERENCES distribution_activities(id),
    target_activity_id TEXT NOT NULL REFERENCES distribution_activities(id),
    source_allocation_id TEXT NOT NULL REFERENCES contribution_allocations(id),
    target_allocation_id TEXT NOT NULL REFERENCES contribution_allocations(id),
    contribution_id TEXT NOT NULL REFERENCES contributions(id),
    amount_exact TEXT NOT NULL,
    fund_type TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL,
    decided_by_account TEXT NOT NULL,
    decided_by_officer_id TEXT REFERENCES officer_profiles(id),
    source_activity_version INTEGER NOT NULL,
    target_activity_version INTEGER NOT NULL,
    source_allocation_version INTEGER NOT NULL,
    target_allocation_version INTEGER NOT NULL,
    occurred_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS reallocation_decisions_by_source
    ON reallocation_decisions (institution_id, source_activity_id);`,
  `CREATE INDEX IF NOT EXISTS reallocation_decisions_by_target
    ON reallocation_decisions (institution_id, target_activity_id);`,

  // #107 widened the allocation states. Dropping first keeps this re-runnable on a
  // database created before REALLOCATED existed, without hiding a failure to apply it.
  `ALTER TABLE contribution_allocations DROP CONSTRAINT IF EXISTS contribution_allocations_status_known;`,
  `ALTER TABLE contribution_allocations ADD CONSTRAINT contribution_allocations_status_known
    CHECK (status IN ('ACTIVE', 'REALLOCATED'));`,

  // ADR-0037: the per-beneficiary attribution of one allocation, stored rather than
  // recomputed, so a correction or reallocation unwinds deterministically. A share is
  // never deleted; it is marked REVERSED, and no recipient identity is kept here.
  `CREATE TABLE IF NOT EXISTS allocation_beneficiary_shares (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL REFERENCES institutions(id),
    allocation_id TEXT NOT NULL REFERENCES contribution_allocations(id),
    contribution_id TEXT NOT NULL REFERENCES contributions(id),
    activity_id TEXT NOT NULL REFERENCES distribution_activities(id),
    proposal_id TEXT NOT NULL REFERENCES proposal_drafts(id),
    proposal_version INTEGER NOT NULL,
    aid_line_id TEXT NOT NULL,
    beneficiary_id TEXT NOT NULL,
    beneficiary_pseudonym TEXT NOT NULL,
    asnaf TEXT NOT NULL,
    share_exact TEXT NOT NULL,
    aid_line_approved_exact TEXT NOT NULL,
    fill_sequence INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    CONSTRAINT allocation_beneficiary_shares_status_known CHECK (status IN ('ACTIVE', 'REVERSED'))
  );`,
  `CREATE INDEX IF NOT EXISTS allocation_beneficiary_shares_by_contribution
    ON allocation_beneficiary_shares (institution_id, contribution_id);`,
  `CREATE INDEX IF NOT EXISTS allocation_beneficiary_shares_by_aid_line
    ON allocation_beneficiary_shares (institution_id, activity_id, aid_line_id);`,
  `CREATE INDEX IF NOT EXISTS allocation_beneficiary_shares_by_allocation
    ON allocation_beneficiary_shares (institution_id, allocation_id);`,

  `CREATE TABLE IF NOT EXISTS activity_operations (
    institution_id TEXT NOT NULL REFERENCES institutions(id),
    account TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result_json TEXT,
    PRIMARY KEY (institution_id, account, operation_id)
  );`,
];

async function mutateOnce<T>(
  db: ActivityDatabase,
  institutionId: string,
  operation: ActivityOperation,
  mutate: (tx: Executor) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    const inserted = rowsOf(
      await tx.execute(sql`
        INSERT INTO activity_operations (institution_id, account, operation_id, request_hash)
        VALUES (${institutionId}, ${operation.account}, ${operation.id}, ${operation.requestHash})
        ON CONFLICT DO NOTHING RETURNING operation_id
      `)
    );
    if (!inserted.length) {
      const previous = rowsOf(
        await tx.execute(sql`
          SELECT request_hash, result_json FROM activity_operations
          WHERE institution_id = ${institutionId} AND account = ${operation.account} AND operation_id = ${operation.id}
        `)
      )[0];
      if (!previous || previous.request_hash !== operation.requestHash) {
        throw new ActivityOperationConflictError();
      }
      return JSON.parse(previous.result_json) as T;
    }
    const result = await mutate(tx);
    await tx.execute(sql`
      UPDATE activity_operations SET result_json = ${JSON.stringify(result)}
      WHERE institution_id = ${institutionId} AND account = ${operation.account} AND operation_id = ${operation.id}
    `);
    return result;
  });
}

const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: string })?.code === "23505" ||
  (error as { cause?: { code?: string } })?.cause?.code === "23505";

function activityFrom(row: any): DistributionActivityRecord {
  return {
    id: row.id,
    institutionId: row.institution_id,
    proposalId: row.proposal_id,
    proposalVersion: Number(row.proposal_version),
    programId: row.program_id,
    programFundType: row.program_fund_type,
    name: row.name,
    description: row.description ?? null,
    targetAmount: row.target_amount,
    targetIsPartial: Boolean(row.target_is_partial),
    currencyUnit: row.currency_unit,
    status: row.status,
    version: Number(row.version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    createdBy: row.created_by,
  };
}

function allocationFrom(row: any): ContributionAllocationRecord {
  return {
    id: row.id,
    institutionId: row.institution_id,
    contributionId: row.contribution_id,
    activityId: row.activity_id,
    currencyUnit: row.currency_unit,
    amountExact: row.amount_exact,
    fundType: row.fund_type,
    purpose: row.purpose,
    reason: row.reason,
    status: row.status,
    allocatedAt: Number(row.allocated_at),
    allocatedBy: row.allocated_by,
    allocatedByOfficerId: row.allocated_by_officer_id ?? null,
    contributionVersion: Number(row.contribution_version),
    version: Number(row.version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function historyFrom(row: any): AllocationHistoryRecord {
  return {
    id: Number(row.id),
    allocationId: row.allocation_id,
    institutionId: row.institution_id,
    contributionId: row.contribution_id,
    activityId: row.activity_id,
    version: Number(row.version),
    contributionVersion: Number(row.contribution_version),
    action: row.action,
    actorAccount: row.actor_account,
    actorOfficerId: row.actor_officer_id ?? null,
    fromStatus: row.from_status ?? null,
    toStatus: row.to_status,
    amountExact: row.amount_exact,
    reason: row.reason,
    occurredAt: Number(row.occurred_at),
  };
}

function reallocationFrom(row: any): ReallocationDecisionRecord {
  return {
    id: row.id,
    institutionId: row.institution_id,
    sourceActivityId: row.source_activity_id,
    targetActivityId: row.target_activity_id,
    sourceAllocationId: row.source_allocation_id,
    targetAllocationId: row.target_allocation_id,
    contributionId: row.contribution_id,
    amountExact: row.amount_exact,
    fundType: row.fund_type,
    purpose: row.purpose,
    reason: row.reason,
    decidedByAccount: row.decided_by_account,
    decidedByOfficerId: row.decided_by_officer_id ?? null,
    sourceActivityVersion: Number(row.source_activity_version),
    targetActivityVersion: Number(row.target_activity_version),
    sourceAllocationVersion: Number(row.source_allocation_version),
    targetAllocationVersion: Number(row.target_allocation_version),
    occurredAt: Number(row.occurred_at),
    createdAt: Number(row.created_at),
  };
}

/** Every decision that moved funds into or out of this activity, newest first. */
async function reallocationsTouching(
  executor: Executor,
  institutionId: string,
  activityId: string
): Promise<ReallocationDecisionRecord[]> {
  const rows = rowsOf(
    await executor.execute(sql`
      SELECT * FROM reallocation_decisions
      WHERE institution_id = ${institutionId}
        AND (source_activity_id = ${activityId} OR target_activity_id = ${activityId})
      ORDER BY occurred_at DESC, id DESC
    `)
  );
  return rows.map(reallocationFrom);
}

/**
 * Attributes one allocation to the activity's individual mustahik (ADR-0037).
 *
 * The caller must already hold the activity's row lock: the fill reads how much of
 * each aid line is taken and writes the next shares, so two officers allocating to
 * one activity in parallel would otherwise fill the same mustahik twice.
 *
 * Only the pseudonym, the asnaf and the amounts are written. Nothing that names the
 * recipient is copied here, and the fill never touches an `AMIL` line: the amil's
 * right runs through its own path (`amil-policy.ts`), not through a donor's trace.
 */
export async function recordBeneficiaryShares(
  executor: Executor,
  institutionId: string,
  input: {
    allocationId: string;
    contributionId: string;
    activityId: string;
    proposalId: string;
    amountExact: string;
    fundType: JenisDana;
  },
  now: number
): Promise<FillResult> {
  const proposal = rowsOf(
    await executor.execute(sql`
      SELECT id, version, aid_lines_json, beneficiaries_json
      FROM proposal_drafts
      WHERE id = ${input.proposalId} AND institution_id = ${institutionId}
    `)
  )[0];
  if (!proposal) throw new ActivityNotFoundError("Pengajuan", input.proposalId);

  const aidLines: AidLine[] = JSON.parse(proposal.aid_lines_json ?? "[]");
  const beneficiaries: Beneficiary[] = JSON.parse(proposal.beneficiaries_json ?? "[]");
  if (aidLines.length === 0) return { shares: [], unassignedExact: input.amountExact, exclusions: [] };

  const asnafById = new Map(beneficiaries.map((row) => [row.id, row.asnaf]));
  // The pseudonym follows the roster's own order, not the fill order, so its number
  // never discloses where a recipient stands in the priority queue.
  const pseudonyms = beneficiaryPseudonyms(beneficiaries.map((row) => row.id));

  const takenRows = rowsOf(
    await executor.execute(sql`
      SELECT aid_line_id, COALESCE(SUM(share_exact::numeric), 0)::text AS taken
      FROM allocation_beneficiary_shares
      WHERE institution_id = ${institutionId} AND activity_id = ${input.activityId} AND status = 'ACTIVE'
      GROUP BY aid_line_id
    `)
  );
  const allocatedByAidLine = new Map<string, string>(takenRows.map((row) => [row.aid_line_id, row.taken]));

  const result = fillAllocation(
    input.amountExact,
    fillTargetsFrom(aidLines, { asnafOf: (id) => asnafById.get(id) ?? "", allocatedByAidLine }),
    { fundType: input.fundType }
  );

  for (const share of result.shares) {
    await executor.execute(sql`
      INSERT INTO allocation_beneficiary_shares (
        id, institution_id, allocation_id, contribution_id, activity_id, proposal_id, proposal_version,
        aid_line_id, beneficiary_id, beneficiary_pseudonym, asnaf, share_exact, aid_line_approved_exact,
        fill_sequence, status, created_at, updated_at
      ) VALUES (
        ${`share-${crypto.randomUUID()}`}, ${institutionId}, ${input.allocationId}, ${input.contributionId},
        ${input.activityId}, ${proposal.id}, ${Number(proposal.version)},
        ${share.aidLineId}, ${share.beneficiaryId}, ${pseudonyms.get(share.beneficiaryId) ?? "Mustahik"},
        ${share.asnaf}, ${share.shareExact}, ${share.approvedExact},
        ${share.fillSequence}, 'ACTIVE', ${now}, ${now}
      )
    `);
  }
  return result;
}

/**
 * Unwinds an allocation's attribution (#107). Shares are marked, never deleted: what
 * a donor was once shown stays auditable after the money moves.
 */
async function reverseBeneficiaryShares(
  executor: Executor,
  institutionId: string,
  allocationId: string,
  now: number
): Promise<void> {
  await executor.execute(sql`
    UPDATE allocation_beneficiary_shares
    SET status = 'REVERSED', updated_at = ${now}
    WHERE institution_id = ${institutionId} AND allocation_id = ${allocationId} AND status = 'ACTIVE'
  `);
}

async function loadActivityAccountability(
  executor: Executor,
  institutionId: string,
  activityId: string
): Promise<ActivityAccountabilitySummary> {
  const activityRow = rowsOf(
    await executor.execute(sql`
      SELECT a.*, COALESCE(SUM(ca.amount_exact::numeric), 0)::text AS total_allocated
      FROM distribution_activities a
      LEFT JOIN contribution_allocations ca
        ON ca.activity_id = a.id AND ca.institution_id = a.institution_id AND ca.status = 'ACTIVE'
      WHERE a.id = ${activityId} AND a.institution_id = ${institutionId}
      GROUP BY a.id
    `)
  )[0];
  if (!activityRow) throw new ActivityNotFoundError("Kegiatan penyaluran", activityId);

  const proposal = rowsOf(
    await executor.execute(sql`
      SELECT id, version, status, aid_lines_json, remainder_closed_json
      FROM proposal_drafts
      WHERE id = ${activityRow.proposal_id} AND institution_id = ${institutionId}
    `)
  )[0];
  if (!proposal) throw new ActivityNotFoundError("Pengajuan", activityRow.proposal_id);

  const aidLines: AidLine[] = JSON.parse(proposal.aid_lines_json ?? "[]");
  const isRemainderClosed = proposal.status === "REMAINDER_CLOSED" || Boolean(proposal.remainder_closed_json);

  const realizations = rowsOf(
    await executor.execute(sql`
      SELECT aid_line_id, amount_idr, quantity FROM disbursement_realizations
      WHERE institution_id = ${institutionId} AND proposal_id = ${proposal.id}
      ORDER BY recorded_at ASC, id ASC
    `)
  );

  const advances = rowsOf(
    await executor.execute(sql`
      SELECT COALESCE(SUM(amount_idr::numeric), 0)::text AS total
      FROM disbursement_realization_advances
      WHERE institution_id = ${institutionId} AND proposal_id = ${proposal.id}
    `)
  );

  const expenses = rowsOf(
    await executor.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN advance_id IS NULL THEN amount_idr::numeric ELSE 0 END), 0)::text AS direct_total,
        COALESCE(SUM(CASE WHEN advance_id IS NOT NULL THEN amount_idr::numeric ELSE 0 END), 0)::text AS accounted_total
      FROM disbursement_realization_expenses
      WHERE institution_id = ${institutionId} AND proposal_id = ${proposal.id}
    `)
  );

  // ADR-0042 rows sit beside the legacy advance/expense rows until #128 migrates them.
  const costState = await loadOperationalCosts(executor, institutionId, proposal.id);
  const costs = operationalCostTotals(costState.items, costState.panjar);
  const plus = (legacy: string | undefined, added: string) => (BigInt(legacy ?? "0") + BigInt(added)).toString();

  return calculateActivityAccountability({
    activityId: activityRow.id,
    proposalId: proposal.id,
    proposalVersion: Number(proposal.version),
    proposalStatus: proposal.status,
    currencyUnit: activityRow.currency_unit,
    isRemainderClosed,
    totalAllocatedAmount: activityRow.total_allocated,
    totalDirectExpensesIdr: plus(expenses[0]?.direct_total, costs.directExpensesIdr),
    totalAccountedExpensesIdr: plus(expenses[0]?.accounted_total, costs.panjarAccountedIdr),
    totalAdvancesIdr: plus(advances[0]?.total, costs.panjarNetIdr),
    totalContributionShortfall: await activityShortfall(executor, institutionId, activityId),
    aidLines: summarizeAidLines(
      aidLines,
      realizations.map((row) => ({
        aidLineId: row.aid_line_id,
        amountIdr: row.amount_idr ?? null,
        quantity: row.quantity ?? null,
      }))
    ),
  });
}

/**
 * How far this activity's allocations stand above the contributions still backing them
 * after a correction or a paid refund (AC10, #106). Each contribution is counted once,
 * across every activity it funds, and its shortfall is attributed here in proportion to
 * what this activity holds - never inflated by counting the same gap in two activities.
 */
async function activityShortfall(
  executor: Executor,
  institutionId: string,
  activityId: string
): Promise<string> {
  const rows = rowsOf(
    await executor.execute(sql`
      SELECT
        CEIL(COALESCE(SUM(
          GREATEST(shortfall.gap * shortfall.here / NULLIF(shortfall.allocated, 0), 0)
        ), 0))::text AS total
      FROM (
        SELECT
          GREATEST(
            SUM(ca.amount_exact::numeric)
              - GREATEST(c.amount_exact::numeric - COALESCE(r.paid, 0), 0),
            0
          ) AS gap,
          SUM(ca.amount_exact::numeric) AS allocated,
          SUM(CASE WHEN ca.activity_id = ${activityId} THEN ca.amount_exact::numeric ELSE 0 END) AS here
        FROM contribution_allocations ca
        JOIN contributions c ON c.id = ca.contribution_id AND c.institution_id = ca.institution_id
        LEFT JOIN (
          SELECT contribution_id, SUM(amount_exact::numeric) AS paid
          FROM contribution_refunds
          WHERE institution_id = ${institutionId} AND status = 'PAID'
          GROUP BY contribution_id
        ) r ON r.contribution_id = c.id
        WHERE ca.institution_id = ${institutionId} AND ca.status = 'ACTIVE'
          AND ca.contribution_id IN (
            SELECT contribution_id FROM contribution_allocations
            WHERE institution_id = ${institutionId} AND activity_id = ${activityId} AND status = 'ACTIVE'
          )
        GROUP BY c.id, c.amount_exact, r.paid
      ) shortfall
    `)
  );
  // Rounded up in SQL: the reported gap stays whole and never understates this
  // activity's share of it.
  return rows[0]?.total ?? "0";
}

/** Activities with their active allocation totals, in one query; `activityId` narrows to one. */
async function activitySummaries(
  executor: Executor,
  institutionId: string,
  activityId?: string
): Promise<ActivitySummary[]> {
  const rows = rowsOf(
    await executor.execute(sql`
      SELECT a.*,
        COALESCE(SUM(ca.amount_exact::numeric), 0)::text AS total_allocated,
        COUNT(DISTINCT ca.contribution_id) AS contribution_count
      FROM distribution_activities a
      LEFT JOIN contribution_allocations ca
        ON ca.activity_id = a.id AND ca.institution_id = a.institution_id AND ca.status = 'ACTIVE'
      WHERE a.institution_id = ${institutionId}
        ${activityId === undefined ? sql`` : sql`AND a.id = ${activityId}`}
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `)
  );
  return rows.map((row) => {
    const activity = activityFrom(row);
    return {
      ...activity,
      ...activityFunding(activity, row.total_allocated, Number(row.contribution_count)),
      disclaimer: FUNDING_RECORD_DISCLAIMER,
      tracingCoverage: TRACING_COVERAGE,
    };
  });
}

/** What a refund has taken out of a contribution, or is about to (#106, AC12). */
export type RefundTotals = {
  /** Money actually paid back: it is no longer part of the contribution. */
  paid: bigint;
  /** Decided but unpaid: still committed, so it may not be allocated or reallocated away. */
  decided: bigint;
};

const NO_REFUNDS: RefundTotals = { paid: 0n, decided: 0n };

/** Refund totals per contribution, in one query. Contributions without refunds are absent. */
async function refundTotals(
  executor: Executor,
  institutionId: string,
  contributionIds: string[]
): Promise<Map<string, RefundTotals>> {
  if (contributionIds.length === 0) return new Map();
  const rows = rowsOf(
    await executor.execute(sql`
      SELECT contribution_id,
             COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount_exact::numeric ELSE 0 END), 0)::text AS paid_total,
             COALESCE(SUM(CASE WHEN status = 'DECIDED' THEN amount_exact::numeric ELSE 0 END), 0)::text AS decided_total
      FROM contribution_refunds
      WHERE institution_id = ${institutionId}
        AND contribution_id IN (${sql.join(contributionIds.map((id) => sql`${id}`), sql`, `)})
      GROUP BY contribution_id
    `)
  );
  return new Map(
    rows.map((row) => [
      row.contribution_id as string,
      { paid: BigInt(row.paid_total), decided: BigInt(row.decided_total) },
    ])
  );
}

/**
 * What of a contribution may still be committed to an activity: its recorded amount less
 * refunds paid back, less what is already allocated and what a decided refund has claimed.
 */
function allocatableRemainder(totalExact: string, allocatedExact: string, refunds: RefundTotals): bigint {
  const total = BigInt(totalExact);
  const net = total > refunds.paid ? total - refunds.paid : 0n;
  const committed = BigInt(allocatedExact) + refunds.decided;
  return net > committed ? net - committed : 0n;
}

/** Active allocation totals for many contributions, in one query. */
async function allocatedTotals(
  executor: Executor,
  institutionId: string,
  contributionIds: string[]
): Promise<Map<string, string>> {
  if (contributionIds.length === 0) return new Map();
  const rows = rowsOf(
    await executor.execute(sql`
      SELECT contribution_id, SUM(amount_exact::numeric)::text AS total_allocated
      FROM contribution_allocations
      WHERE institution_id = ${institutionId} AND status = 'ACTIVE'
        AND contribution_id IN (${sql.join(contributionIds.map((id) => sql`${id}`), sql`, `)})
      GROUP BY contribution_id
    `)
  );
  return new Map(rows.map((row) => [row.contribution_id as string, row.total_allocated as string]));
}

export function createActivityStore(db: ActivityDatabase) {
  return {
    async ensureSchema(): Promise<void> {
      for (const statement of ACTIVITY_SCHEMA_STATEMENTS) {
        await db.execute(sql.raw(statement));
      }
    },

    async createActivity(
      institutionId: string,
      params: { id?: string; proposalId: string; name?: string; description?: string },
      operation: ActivityOperation,
      actor: ActivityActor,
      now: number
    ): Promise<DistributionActivityRecord> {
      try {
        return await mutateOnce(db, institutionId, operation, async (tx) => {
          // Locked so two officers creating from the same proposal version run one after the other.
          const proposal = rowsOf(
            await tx.execute(sql`
              SELECT p.id, p.program_id, p.version, p.status, p.purpose, p.aid_lines_json, g.fund_type
              FROM proposal_drafts p
              JOIN programs g ON g.id = p.program_id AND g.institution_id = p.institution_id
              WHERE p.id = ${params.proposalId} AND p.institution_id = ${institutionId}
              FOR UPDATE OF p
            `)
          )[0];
          if (!proposal) throw new ActivityNotFoundError("Pengajuan", params.proposalId);
          if (proposal.status !== "APPROVED") {
            throw new ActivityRuleError(
              `Pengajuan "${params.proposalId}" berstatus "${proposal.status}", wajib disahkan (APPROVED) sebelum menjadi kegiatan penyaluran.`
            );
          }

          const existing = rowsOf(
            await tx.execute(sql`
              SELECT id FROM distribution_activities
              WHERE institution_id = ${institutionId} AND proposal_id = ${proposal.id} AND proposal_version = ${proposal.version}
            `)
          )[0];
          if (existing) {
            throw new ActivityConflictError(
              `Kegiatan penyaluran untuk pengajuan "${params.proposalId}" versi ${proposal.version} sudah dibuat.`
            );
          }

          const { targetAmount, targetIsPartial } = activityTarget(JSON.parse(proposal.aid_lines_json));
          const inserted = rowsOf(
            await tx.execute(sql`
              INSERT INTO distribution_activities (
                id, institution_id, proposal_id, proposal_version, program_id, program_fund_type,
                name, description, target_amount, target_is_partial, currency_unit, status, version,
                created_at, updated_at, created_by
              ) VALUES (
                ${params.id ?? `act-${crypto.randomUUID()}`}, ${institutionId}, ${proposal.id}, ${proposal.version},
                ${proposal.program_id}, ${proposal.fund_type},
                ${params.name || proposal.purpose}, ${params.description || null}, ${targetAmount}, ${targetIsPartial},
                'IDR', 'ACTIVE', 1, ${now}, ${now}, ${actor.account}
              )
              RETURNING *
            `)
          )[0];
          return activityFrom(inserted);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ActivityConflictError(
            `Kegiatan penyaluran untuk pengajuan "${params.proposalId}" sudah dibuat, atau ID kegiatan sudah digunakan.`
          );
        }
        throw error;
      }
    },

    async listActivities(institutionId: string): Promise<ActivitySummary[]> {
      return activitySummaries(db, institutionId);
    },

    /** `withSources` adds donor-level detail; pass it only for a contribution-mandate holder. */
    async getActivity(
      institutionId: string,
      activityId: string,
      withSources: boolean
    ): Promise<ActivityDetail | null> {
      const [summary] = await activitySummaries(db, institutionId, activityId);
      if (!summary) return null;

      const allocationRows = rowsOf(
        await db.execute(sql`
          SELECT ca.*, c.donor_name, c.source_channel, c.source_reference
          FROM contribution_allocations ca
          JOIN contributions c ON c.id = ca.contribution_id AND c.institution_id = ca.institution_id
          WHERE ca.activity_id = ${activityId} AND ca.institution_id = ${institutionId}
          ORDER BY ca.allocated_at DESC, ca.id
        `)
      );
      const historyRows = rowsOf(
        await db.execute(sql`
          SELECT * FROM allocation_history
          WHERE activity_id = ${activityId} AND institution_id = ${institutionId}
          ORDER BY occurred_at, id
        `)
      );

      const accountability = await loadActivityAccountability(db, institutionId, activityId);
      const reallocations = await reallocationsTouching(db, institutionId, activityId);

      return {
        ...summary,
        allocations: allocationRows.map((row) => ({
          ...allocationFrom(row),
          source: withSources
            ? { donorName: row.donor_name ?? null, sourceChannel: row.source_channel, sourceReference: row.source_reference }
            : null,
        })),
        history: historyRows.map(historyFrom),
        accountability,
        reallocations,
      };
    },

    async allocateContribution(
      institutionId: string,
      params: {
        contributionId: string;
        activityId: string;
        amountExact: string;
        fundType: string | null;
        purpose: string | null;
        reason: string;
        expectedVersion: number;
      },
      operation: ActivityOperation,
      actor: ActivityActor,
      now: number
    ): Promise<{
      allocation: ContributionAllocationRecord;
      contributionSummary: ContributionAllocationSummary;
      activitySummary: ActivitySummary;
    }> {
      const requested = parseExactAmount(params.amountExact);

      return mutateOnce(db, institutionId, operation, async (tx) => {
        // The lock every allocation of this contribution queues behind: the limit check below is atomic.
        const contribution = rowsOf(
          await tx.execute(sql`
            SELECT * FROM contributions
            WHERE id = ${params.contributionId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!contribution) throw new ActivityNotFoundError("Catatan kontribusi", params.contributionId);
        if (Number(contribution.version) !== params.expectedVersion) {
          throw new ActivityConflictError(
            `Catatan kontribusi "${params.contributionId}" telah diperbarui sejak versi yang Anda muat. Muat ulang sebelum mencoba lagi.`
          );
        }
        if (contribution.status !== "ENDORSED") {
          throw new ActivityRuleError(
            `Kontribusi berstatus "${contribution.status}" belum disahkan lembaga; hanya kontribusi yang disahkan (ENDORSED) dapat dialokasikan.`
          );
        }

        // Locked, not merely read: the per-beneficiary fill below reads how much of each
        // aid line is already taken, so two officers allocating to one activity in
        // parallel must queue rather than fill the same mustahik twice (ADR-0037).
        const activity = rowsOf(
          await tx.execute(sql`
            SELECT * FROM distribution_activities
            WHERE id = ${params.activityId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!activity) throw new ActivityNotFoundError("Kegiatan penyaluran", params.activityId);
        if (contribution.currency_unit !== activity.currency_unit) {
          throw new ActivityRuleError(
            `Mata uang kontribusi (${contribution.currency_unit}) berbeda dengan mata uang kegiatan (${activity.currency_unit}).`
          );
        }

        const terms = allocationTerms({
          contributionFundType: contribution.fund_type,
          contributionPurpose: contribution.purpose ?? "",
          programFundType: activity.program_fund_type as FundType,
          requestedFundType: params.fundType,
          requestedPurpose: params.purpose,
        });

        const allocatedBefore =
          (await allocatedTotals(tx, institutionId, [contribution.id])).get(contribution.id) ?? "0";

        const refunds = (await refundTotals(tx, institutionId, [contribution.id])).get(contribution.id) ?? NO_REFUNDS;
        const available = allocatableRemainder(contribution.amount_exact, allocatedBefore, refunds);

        if (requested > available) {
          throw new AllocationOverLimitError(available.toString(), requested.toString());
        }

        const allocationId = `alloc-${crypto.randomUUID()}`;
        const inserted = rowsOf(
          await tx.execute(sql`
            INSERT INTO contribution_allocations (
              id, institution_id, contribution_id, activity_id, currency_unit,
              amount_exact, fund_type, purpose, reason, status, allocated_at,
              allocated_by, allocated_by_officer_id, contribution_version, version, created_at, updated_at
            ) VALUES (
              ${allocationId}, ${institutionId}, ${contribution.id}, ${activity.id}, ${contribution.currency_unit},
              ${requested.toString()}, ${terms.fundType}, ${terms.purpose}, ${params.reason}, 'ACTIVE', ${now},
              ${actor.account}, ${actor.officerId}, ${params.expectedVersion}, 1, ${now}, ${now}
            )
            RETURNING *
          `)
        )[0];

        await tx.execute(sql`
          INSERT INTO allocation_history (
            allocation_id, institution_id, contribution_id, activity_id, version, contribution_version,
            action, actor_account, actor_officer_id, from_status, to_status, amount_exact, reason, occurred_at
          ) VALUES (
            ${allocationId}, ${institutionId}, ${contribution.id}, ${activity.id}, 1, ${params.expectedVersion},
            'ALLOCATE', ${actor.account}, ${actor.officerId}, NULL, 'ACTIVE', ${requested.toString()}, ${params.reason}, ${now}
          )
        `);

        await recordBeneficiaryShares(
          tx,
          institutionId,
          {
            allocationId,
            contributionId: contribution.id,
            activityId: activity.id,
            proposalId: activity.proposal_id,
            amountExact: requested.toString(),
            fundType: terms.fundType,
          },
          now
        );

        // The contribution's own version is left alone: an allocation is not an edit of
        // the contribution, and bumping it would stale pending reconcile/endorse requests.
        await tx.execute(sql`
          UPDATE distribution_activities SET updated_at = ${now}
          WHERE id = ${activity.id} AND institution_id = ${institutionId}
        `);

        const [activitySummary] = await activitySummaries(tx, institutionId, activity.id);
        const newAllocated = BigInt(allocatedBefore) + requested;
        const netTotal = BigInt(contribution.amount_exact) > refunds.paid
          ? BigInt(contribution.amount_exact) - refunds.paid
          : 0n;
        const unallocatedAfter = allocatableRemainder(
          contribution.amount_exact,
          newAllocated.toString(),
          refunds
        ).toString();
        const shortfallAfter = newAllocated > netTotal ? (newAllocated - netTotal).toString() : "0";

        return {
          allocation: allocationFrom(inserted),
          contributionSummary: {
            contributionId: contribution.id,
            currencyUnit: contribution.currency_unit,
            totalAmount: contribution.amount_exact,
            allocatedAmount: newAllocated.toString(),
            unallocatedAmount: unallocatedAfter,
            shortfallAmount: shortfallAfter,
          },
          activitySummary,
        };
      });
    },

    async listAllocationsForContribution(
      institutionId: string,
      contributionId: string
    ): Promise<{ allocations: ContributionAllocation[]; history: AllocationHistoryRecord[] }> {
      const allocationRows = rowsOf(
        await db.execute(sql`
          SELECT ca.*, a.name AS activity_name
          FROM contribution_allocations ca
          JOIN distribution_activities a ON a.id = ca.activity_id AND a.institution_id = ca.institution_id
          WHERE ca.contribution_id = ${contributionId} AND ca.institution_id = ${institutionId}
          ORDER BY ca.allocated_at DESC, ca.id
        `)
      );
      const historyRows = rowsOf(
        await db.execute(sql`
          SELECT * FROM allocation_history
          WHERE contribution_id = ${contributionId} AND institution_id = ${institutionId}
          ORDER BY occurred_at, id
        `)
      );
      return {
        allocations: allocationRows.map((row) => ({ ...allocationFrom(row), activityName: row.activity_name })),
        history: historyRows.map(historyFrom),
      };
    },

    /**
     * Every activity with its active allocations and the allocated contributions'
     * status and whether they carry donor detail (Spec #86, ticket #98). The donor's
     * name and contact never leave this query; a frozen report source records only
     * that a donor was or was not recorded.
     */
    async readActivityTrace(institutionId: string): Promise<ActivityTraceData> {
      const activityRows = rowsOf(
        await db.execute(sql`
          SELECT * FROM distribution_activities
          WHERE institution_id = ${institutionId}
          ORDER BY created_at, id
        `)
      );
      const allocationRows = rowsOf(
        await db.execute(sql`
          SELECT ca.*, c.status AS contribution_status, (c.donor_name IS NOT NULL AND c.donor_name <> '') AS donor_recorded
          FROM contribution_allocations ca
          JOIN contributions c ON c.id = ca.contribution_id AND c.institution_id = ca.institution_id
          WHERE ca.institution_id = ${institutionId} AND ca.status = 'ACTIVE'
          ORDER BY ca.allocated_at, ca.id
        `)
      );
      const byActivity = new Map<string, ActivityTraceData["activities"][number]["allocations"]>();
      for (const row of allocationRows) {
        const allocation = allocationFrom(row);
        const list = byActivity.get(allocation.activityId) ?? [];
        list.push({
          id: allocation.id,
          contributionId: allocation.contributionId,
          contributionVersion: allocation.contributionVersion,
          amountExact: allocation.amountExact,
          currencyUnit: allocation.currencyUnit,
          fundType: allocation.fundType,
          allocatedAt: allocation.allocatedAt,
          contributionStatus: row.contribution_status,
          donorRecorded: Boolean(row.donor_recorded),
        });
        byActivity.set(allocation.activityId, list);
      }
      return {
        coverage: TRACING_COVERAGE,
        disclaimer: FUNDING_RECORD_DISCLAIMER,
        activities: activityRows.map((row) => {
          const activity = activityFrom(row);
          return {
            id: activity.id,
            proposalId: activity.proposalId,
            proposalVersion: activity.proposalVersion,
            name: activity.name,
            programFundType: activity.programFundType,
            targetAmount: activity.targetAmount,
            targetIsPartial: activity.targetIsPartial,
            createdAt: activity.createdAt,
            allocations: byActivity.get(activity.id) ?? [],
          };
        }),
      };
    },

    /** Balances for the given contributions, keyed by id, in one query. */
    async contributionBalances(
      institutionId: string,
      contributions: Array<{ id: string; amountExact: string; status: string }>
    ): Promise<Map<string, ContributionBalance>> {
      if (contributions.length === 0) return new Map();
      const ids = contributions.map((c) => c.id);
      const totals = await allocatedTotals(db, institutionId, ids);

      const refundMap = await refundTotals(db, institutionId, ids);

      return new Map(
        contributions.map((c) => {
          // A rejected contribution backs nothing, so every allocation on it is a shortfall.
          const total = c.status === "REJECTED" ? "0" : c.amountExact;
          const refunds = refundMap.get(c.id) ?? NO_REFUNDS;
          const allocated = BigInt(totals.get(c.id) ?? "0");
          const net = BigInt(total) > refunds.paid ? BigInt(total) - refunds.paid : 0n;

          return [
            c.id,
            {
              allocatedAmount: allocated.toString(),
              unallocatedAmount: allocatableRemainder(total, allocated.toString(), refunds).toString(),
              shortfallAmount: (allocated > net ? allocated - net : 0n).toString(),
            },
          ];
        })
      );
    },

    async getActivityAccountability(
      institutionId: string,
      activityId: string
    ): Promise<ActivityAccountabilitySummary> {
      return loadActivityAccountability(db, institutionId, activityId);
    },

    async listReallocationsForActivity(
      institutionId: string,
      activityId: string
    ): Promise<ReallocationDecisionRecord[]> {
      const activityRow = rowsOf(
        await db.execute(sql`
          SELECT id FROM distribution_activities
          WHERE id = ${activityId} AND institution_id = ${institutionId}
        `)
      )[0];
      if (!activityRow) throw new ActivityNotFoundError("Kegiatan penyaluran", activityId);

      return reallocationsTouching(db, institutionId, activityId);
    },

    async reallocateAllocation(
      institutionId: string,
      params: {
        sourceActivityId: string;
        targetActivityId: string;
        sourceAllocationId: string;
        amountExact: string;
        fundType?: string | null;
        purpose?: string | null;
        reason: string;
        expectedSourceVersion: number;
        /** Checked when the officer sent one; a stale target is as unsafe as a stale source. */
        expectedTargetVersion: number | null;
      },
      operation: ActivityOperation,
      actor: ActivityActor,
      now: number
    ): Promise<{
      decision: ReallocationDecisionRecord;
      sourceAllocation: ContributionAllocationRecord;
      targetAllocation: ContributionAllocationRecord;
      sourceActivitySummary: ActivitySummary;
      targetActivitySummary: ActivitySummary;
      sourceAccountability: ActivityAccountabilitySummary;
    }> {
      const requested = parseExactAmount(params.amountExact);
      if (params.sourceActivityId === params.targetActivityId) {
        throw new ActivityRuleError("Kegiatan tujuan tidak boleh sama dengan kegiatan sumber.");
      }

      return mutateOnce(db, institutionId, operation, async (tx) => {
        // Lock both activities in deterministic order to prevent deadlocks
        const firstId = params.sourceActivityId < params.targetActivityId ? params.sourceActivityId : params.targetActivityId;
        const secondId = params.sourceActivityId < params.targetActivityId ? params.targetActivityId : params.sourceActivityId;

        await tx.execute(sql`
          SELECT id FROM distribution_activities
          WHERE id = ${firstId} AND institution_id = ${institutionId}
          FOR UPDATE
        `);
        await tx.execute(sql`
          SELECT id FROM distribution_activities
          WHERE id = ${secondId} AND institution_id = ${institutionId}
          FOR UPDATE
        `);

        const sourceActivityRow = rowsOf(
          await tx.execute(sql`
            SELECT * FROM distribution_activities
            WHERE id = ${params.sourceActivityId} AND institution_id = ${institutionId}
          `)
        )[0];
        if (!sourceActivityRow) throw new ActivityNotFoundError("Kegiatan penyaluran sumber", params.sourceActivityId);

        const targetActivityRow = rowsOf(
          await tx.execute(sql`
            SELECT * FROM distribution_activities
            WHERE id = ${params.targetActivityId} AND institution_id = ${institutionId}
          `)
        )[0];
        if (!targetActivityRow) throw new ActivityNotFoundError("Kegiatan penyaluran tujuan", params.targetActivityId);

        if (Number(sourceActivityRow.version) !== params.expectedSourceVersion) {
          throw new ActivityConflictError(
            `Kegiatan sumber telah diperbarui sejak versi yang Anda muat (versi sekarang ${sourceActivityRow.version}, diharapkan ${params.expectedSourceVersion}). Muat ulang sebelum mencoba lagi.`
          );
        }
        if (params.expectedTargetVersion !== null && Number(targetActivityRow.version) !== params.expectedTargetVersion) {
          throw new ActivityConflictError(
            `Kegiatan tujuan telah diperbarui sejak versi yang Anda muat (versi sekarang ${targetActivityRow.version}, diharapkan ${params.expectedTargetVersion}). Muat ulang sebelum mencoba lagi.`
          );
        }

        // The proposals behind both activities are locked in the same order realization,
        // expense and remainder-closure recording lock them (`disbursement-store`). Without
        // this, a realization could commit beside this decision and both would read the
        // same remainder as available, spending it twice (AC04).
        for (const proposalId of [sourceActivityRow.proposal_id, targetActivityRow.proposal_id].sort()) {
          await tx.execute(sql`
            SELECT id FROM proposal_drafts
            WHERE id = ${proposalId} AND institution_id = ${institutionId}
            FOR UPDATE
          `);
        }

        if (sourceActivityRow.currency_unit !== targetActivityRow.currency_unit) {
          throw new ActivityRuleError(
            `Mata uang kegiatan sumber (${sourceActivityRow.currency_unit}) berbeda dengan kegiatan tujuan (${targetActivityRow.currency_unit}).`
          );
        }

        const sourceAllocationRow = rowsOf(
          await tx.execute(sql`
            SELECT * FROM contribution_allocations
            WHERE id = ${params.sourceAllocationId} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!sourceAllocationRow) throw new ActivityNotFoundError("Alokasi sumber", params.sourceAllocationId);
        if (sourceAllocationRow.activity_id !== sourceActivityRow.id) {
          throw new ActivityRuleError("Alokasi sumber tidak berada pada kegiatan sumber yang ditentukan.");
        }
        if (sourceAllocationRow.status !== "ACTIVE") {
          throw new ActivityRuleError(
            `Alokasi sumber berstatus "${sourceAllocationRow.status}", hanya alokasi aktif yang dapat dialihkan.`
          );
        }

        const contribution = rowsOf(
          await tx.execute(sql`
            SELECT * FROM contributions
            WHERE id = ${sourceAllocationRow.contribution_id} AND institution_id = ${institutionId}
            FOR UPDATE
          `)
        )[0];
        if (!contribution) throw new ActivityNotFoundError("Catatan kontribusi", sourceAllocationRow.contribution_id);
        if (contribution.status !== "ENDORSED") {
          throw new ActivityRuleError("Kontribusi belum disahkan (ENDORSED).");
        }
        // A refund already paid back left the contribution; one merely decided is still
        // owed to the donor. Neither may travel on to another activity (AC12, #106).
        const refunds = (await refundTotals(tx, institutionId, [contribution.id])).get(contribution.id) ?? NO_REFUNDS;
        const totalContribution = BigInt(contribution.amount_exact);
        const netContribution = totalContribution > refunds.paid ? totalContribution - refunds.paid : 0n;
        const movable = netContribution > refunds.decided ? netContribution - refunds.decided : 0n;
        if (requested > movable) {
          throw new ActivityRuleError(
            `Nominal pengalihan (${requested.toString()}) melebihi nilai kontribusi yang masih dapat dialihkan (${movable.toString()}) setelah pengembalian dana diperhitungkan.`
          );
        }

        const terms = allocationTerms({
          contributionFundType: contribution.fund_type,
          contributionPurpose: contribution.purpose ?? "",
          programFundType: targetActivityRow.program_fund_type as FundType,
          requestedFundType: params.fundType ?? null,
          requestedPurpose: params.purpose ?? null,
        });

        const accountability = await loadActivityAccountability(tx, institutionId, sourceActivityRow.id);
        if (accountability.availabilityStatus === "INDETERMINATE") {
          throw new AllocationAvailabilityError(
            `Pengalihan belum dapat dilakukan: ${accountability.availabilityReason}`
          );
        }
        if (accountability.availabilityStatus === "NONE" || BigInt(accountability.availableForReallocation) <= 0n) {
          throw new AllocationAvailabilityError(
            "Tidak ada sisa dana yang dapat dialihkan pada kegiatan sumber. Seluruh dana telah terealisasi, terpakai biaya, atau terikat kewajiban bantuan."
          );
        }
        if (requested > BigInt(accountability.availableForReallocation)) {
          throw new AllocationOverLimitError(accountability.availableForReallocation, requested.toString());
        }
        if (requested > BigInt(sourceAllocationRow.amount_exact)) {
          throw new ActivityRuleError(
            `Nominal pengalihan (${requested.toString()}) melebihi nominal alokasi sumber (${sourceAllocationRow.amount_exact}).`
          );
        }

        const sourceAllocAmount = BigInt(sourceAllocationRow.amount_exact);
        const isFullReallocation = requested === sourceAllocAmount;
        const sourceNewStatus = isFullReallocation ? "REALLOCATED" : "ACTIVE";
        const sourceNewAmount = sourceAllocAmount - requested;
        const sourceNewVersion = Number(sourceAllocationRow.version) + 1;

        await tx.execute(sql`
          UPDATE contribution_allocations
          SET status = ${sourceNewStatus},
              amount_exact = ${sourceNewAmount.toString()},
              version = ${sourceNewVersion},
              updated_at = ${now}
          WHERE id = ${sourceAllocationRow.id} AND institution_id = ${institutionId}
        `);

        await tx.execute(sql`
          INSERT INTO allocation_history (
            allocation_id, institution_id, contribution_id, activity_id, version, contribution_version,
            action, actor_account, actor_officer_id, from_status, to_status, amount_exact, reason, occurred_at
          ) VALUES (
            ${sourceAllocationRow.id}, ${institutionId}, ${contribution.id}, ${sourceActivityRow.id},
            ${sourceNewVersion}, ${Number(contribution.version)},
            'REALLOCATE_OUT', ${actor.account}, ${actor.officerId},
            'ACTIVE', ${sourceNewStatus}, ${requested.toString()}, ${params.reason}, ${now}
          )
        `);

        // The moved money can no longer be attributed to the source activity's mustahik.
        // The whole attribution is reversed and what stays behind is filled again, so the
        // result is the same as if the smaller allocation had been made in the first place.
        await reverseBeneficiaryShares(tx, institutionId, sourceAllocationRow.id, now);
        if (sourceNewAmount > 0n) {
          await recordBeneficiaryShares(
            tx,
            institutionId,
            {
              allocationId: sourceAllocationRow.id,
              contributionId: contribution.id,
              activityId: sourceActivityRow.id,
              proposalId: sourceActivityRow.proposal_id,
              amountExact: sourceNewAmount.toString(),
              fundType: normalizeFundType(sourceAllocationRow.fund_type) ?? terms.fundType,
            },
            now
          );
        }

        const targetAllocationId = `alloc-${crypto.randomUUID()}`;
        const insertedTarget = rowsOf(
          await tx.execute(sql`
            INSERT INTO contribution_allocations (
              id, institution_id, contribution_id, activity_id, currency_unit,
              amount_exact, fund_type, purpose, reason, status, allocated_at,
              allocated_by, allocated_by_officer_id, contribution_version, version, created_at, updated_at
            ) VALUES (
              ${targetAllocationId}, ${institutionId}, ${contribution.id}, ${targetActivityRow.id}, ${contribution.currency_unit},
              ${requested.toString()}, ${terms.fundType}, ${terms.purpose}, ${params.reason}, 'ACTIVE', ${now},
              ${actor.account}, ${actor.officerId}, ${Number(contribution.version)}, 1, ${now}, ${now}
            )
            RETURNING *
          `)
        )[0];

        await tx.execute(sql`
          INSERT INTO allocation_history (
            allocation_id, institution_id, contribution_id, activity_id, version, contribution_version,
            action, actor_account, actor_officer_id, from_status, to_status, amount_exact, reason, occurred_at
          ) VALUES (
            ${targetAllocationId}, ${institutionId}, ${contribution.id}, ${targetActivityRow.id},
            1, ${Number(contribution.version)},
            'REALLOCATE_IN', ${actor.account}, ${actor.officerId},
            NULL, 'ACTIVE', ${requested.toString()}, ${params.reason}, ${now}
          )
        `);

        await recordBeneficiaryShares(
          tx,
          institutionId,
          {
            allocationId: targetAllocationId,
            contributionId: contribution.id,
            activityId: targetActivityRow.id,
            proposalId: targetActivityRow.proposal_id,
            amountExact: requested.toString(),
            fundType: terms.fundType,
          },
          now
        );

        const reallocId = `realloc-${crypto.randomUUID()}`;
        const sourceActivityNewVersion = Number(sourceActivityRow.version) + 1;
        const targetActivityNewVersion = Number(targetActivityRow.version) + 1;

        const decisionRow = rowsOf(
          await tx.execute(sql`
            INSERT INTO reallocation_decisions (
              id, institution_id, source_activity_id, target_activity_id,
              source_allocation_id, target_allocation_id, contribution_id,
              amount_exact, fund_type, purpose, reason, decided_by_account, decided_by_officer_id,
              source_activity_version, target_activity_version, source_allocation_version, target_allocation_version,
              occurred_at, created_at
            ) VALUES (
              ${reallocId}, ${institutionId}, ${sourceActivityRow.id}, ${targetActivityRow.id},
              ${sourceAllocationRow.id}, ${targetAllocationId}, ${contribution.id},
              ${requested.toString()}, ${terms.fundType}, ${terms.purpose}, ${params.reason},
              ${actor.account}, ${actor.officerId},
              ${sourceActivityNewVersion}, ${targetActivityNewVersion}, ${sourceNewVersion}, 1,
              ${now}, ${now}
            )
            RETURNING *
          `)
        )[0];

        await tx.execute(sql`
          UPDATE distribution_activities SET updated_at = ${now}, version = ${sourceActivityNewVersion}
          WHERE id = ${sourceActivityRow.id} AND institution_id = ${institutionId}
        `);
        await tx.execute(sql`
          UPDATE distribution_activities SET updated_at = ${now}, version = ${targetActivityNewVersion}
          WHERE id = ${targetActivityRow.id} AND institution_id = ${institutionId}
        `);

        const [updatedSourceSummary] = await activitySummaries(tx, institutionId, sourceActivityRow.id);
        const [updatedTargetSummary] = await activitySummaries(tx, institutionId, targetActivityRow.id);
        const updatedAccountability = await loadActivityAccountability(tx, institutionId, sourceActivityRow.id);

        return {
          decision: reallocationFrom(decisionRow),
          sourceAllocation: allocationFrom({
            ...sourceAllocationRow,
            status: sourceNewStatus,
            amount_exact: sourceNewAmount.toString(),
            version: sourceNewVersion,
            updated_at: now,
          }),
          targetAllocation: {
            ...allocationFrom(insertedTarget),
            sourceAllocationId: sourceAllocationRow.id,
          },
          sourceActivitySummary: updatedSourceSummary,
          targetActivitySummary: updatedTargetSummary,
          sourceAccountability: updatedAccountability,
        };
      });
    },
  };
}

export type ActivityStore = ReturnType<typeof createActivityStore>;

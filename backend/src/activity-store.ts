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
  contributionBalance,
  parseExactAmount,
  type ActivitySummary,
  type AllocationHistoryRecord,
  type ContributionAllocationRecord,
  type ContributionAllocationSummary,
  type ContributionBalance,
  type DistributionActivityRecord,
} from "./activity";
import type { FundType } from "./disbursement";

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
    CONSTRAINT contribution_allocations_status_known CHECK (status IN ('ACTIVE'))
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

      return {
        ...summary,
        allocations: allocationRows.map((row) => ({
          ...allocationFrom(row),
          source: withSources
            ? { donorName: row.donor_name ?? null, sourceChannel: row.source_channel, sourceReference: row.source_reference }
            : null,
        })),
        history: historyRows.map(historyFrom),
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

        const activity = rowsOf(
          await tx.execute(sql`
            SELECT * FROM distribution_activities
            WHERE id = ${params.activityId} AND institution_id = ${institutionId}
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
        const before = contributionBalance(contribution.amount_exact, allocatedBefore);
        if (requested > BigInt(before.unallocatedAmount)) {
          throw new AllocationOverLimitError(before.unallocatedAmount, requested.toString());
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

        // The contribution's own version is left alone: an allocation is not an edit of
        // the contribution, and bumping it would stale pending reconcile/endorse requests.
        await tx.execute(sql`
          UPDATE distribution_activities SET updated_at = ${now}
          WHERE id = ${activity.id} AND institution_id = ${institutionId}
        `);

        const [activitySummary] = await activitySummaries(tx, institutionId, activity.id);
        return {
          allocation: allocationFrom(inserted),
          contributionSummary: {
            contributionId: contribution.id,
            currencyUnit: contribution.currency_unit,
            totalAmount: contribution.amount_exact,
            ...contributionBalance(contribution.amount_exact, (BigInt(allocatedBefore) + requested).toString()),
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

    /** Balances for the given contributions, keyed by id, in one query. */
    async contributionBalances(
      institutionId: string,
      contributions: Array<{ id: string; amountExact: string }>
    ): Promise<Map<string, ContributionBalance>> {
      const totals = await allocatedTotals(db, institutionId, contributions.map((c) => c.id));
      return new Map(
        contributions.map((c) => [c.id, contributionBalance(c.amountExact, totals.get(c.id) ?? "0")])
      );
    },
  };
}

export type ActivityStore = ReturnType<typeof createActivityStore>;

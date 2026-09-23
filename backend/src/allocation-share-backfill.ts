/**
 * Attributing allocations made before per-mustahik shares existed (ADR-0037).
 *
 * An allocation recorded before this feature carries no `allocation_beneficiary_shares`
 * row, so a donor opening it reads "belum dirinci" - honest, but not the whole truth
 * the roster can already answer. This replays the fill for those allocations, oldest
 * first within each activity, so the result is the one the write path would have
 * produced had it existed at the time.
 *
 * `verify` runs the same code inside a transaction that is rolled back: what the
 * operator reads is what `apply` would write, not a second implementation's guess.
 *
 * Nothing already attributed is touched, and a reversed share stays reversed: this
 * fills gaps, it never rewrites a history someone was shown.
 */

import { sql } from "drizzle-orm";
import { recordBeneficiaryShares, type ActivityDatabase } from "./activity-store";
import { normalizeFundType } from "./contribution";
import { rowsOf } from "./sql-rows";

export type ShareBackfillState =
  /** Shares written (or, in verify, that would be written). */
  | "ATTRIBUTED"
  /** Nothing left to attribute: no aid line could take this allocation's money. */
  | "UNATTRIBUTABLE"
  /** The allocation holds no money, after a full reallocation or a correction. */
  | "EMPTY"
  /** The allocation's fund type is not one this deployment knows; left alone. */
  | "UNKNOWN_FUND_TYPE";

export type ShareBackfillOutcome = {
  allocationId: string;
  activityId: string;
  state: ShareBackfillState;
  shareCount: number;
  attributedExact: string;
  unassignedExact: string;
};

export type ShareBackfillReport = {
  /** Active allocations with no active share, before this run wrote any. */
  candidates: number;
  outcomes: ShareBackfillOutcome[];
};

/** Thrown to roll back the verify pass; never escapes this module. */
class DryRun extends Error {
  constructor() {
    super("verify");
  }
}

export async function backfillBeneficiaryShares(
  db: ActivityDatabase,
  options: { apply: boolean; now: number }
): Promise<ShareBackfillReport> {
  const report: ShareBackfillReport = { candidates: 0, outcomes: [] };

  try {
    await db.transaction(async (tx) => {
      const candidates = rowsOf(
        await tx.execute(sql`
          SELECT ca.id, ca.institution_id, ca.contribution_id, ca.activity_id,
                 ca.amount_exact, ca.fund_type, a.proposal_id,
                 (SELECT MIN(h.id) FROM allocation_history h WHERE h.allocation_id = ca.id) AS recorded_seq
          FROM contribution_allocations ca
          JOIN distribution_activities a
            ON a.id = ca.activity_id AND a.institution_id = ca.institution_id
          WHERE ca.status = 'ACTIVE'
            AND NOT EXISTS (
              SELECT 1 FROM allocation_beneficiary_shares s
              WHERE s.allocation_id = ca.id AND s.status = 'ACTIVE'
            )
          -- The history's serial, not the timestamp: two allocations recorded in the same
          -- second must still be replayed in the order the officers actually made them.
          ORDER BY ca.activity_id, recorded_seq NULLS LAST, ca.allocated_at, ca.id
          FOR UPDATE OF ca
        `)
      );
      report.candidates = candidates.length;

      for (const row of candidates) {
        const outcome: ShareBackfillOutcome = {
          allocationId: row.id,
          activityId: row.activity_id,
          state: "UNATTRIBUTABLE",
          shareCount: 0,
          attributedExact: "0",
          unassignedExact: row.amount_exact,
        };
        report.outcomes.push(outcome);

        if (BigInt(row.amount_exact) === 0n) {
          outcome.state = "EMPTY";
          continue;
        }
        const fundType = normalizeFundType(row.fund_type);
        if (!fundType) {
          outcome.state = "UNKNOWN_FUND_TYPE";
          continue;
        }

        // The same lock the live write path takes, for the same reason.
        await tx.execute(sql`
          SELECT id FROM distribution_activities
          WHERE id = ${row.activity_id} AND institution_id = ${row.institution_id}
          FOR UPDATE
        `);

        const result = await recordBeneficiaryShares(
          tx,
          row.institution_id,
          {
            allocationId: row.id,
            contributionId: row.contribution_id,
            activityId: row.activity_id,
            proposalId: row.proposal_id,
            amountExact: row.amount_exact,
            fundType,
          },
          options.now
        );

        const attributed = result.shares.reduce((total, share) => total + BigInt(share.shareExact), 0n);
        outcome.shareCount = result.shares.length;
        outcome.attributedExact = attributed.toString();
        outcome.unassignedExact = result.unassignedExact;
        if (result.shares.length > 0) outcome.state = "ATTRIBUTED";
      }

      if (!options.apply) throw new DryRun();
    });
  } catch (error) {
    if (!(error instanceof DryRun)) throw error;
  }

  return report;
}

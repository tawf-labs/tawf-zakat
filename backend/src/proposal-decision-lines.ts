/**
 * Recovering the aid lines an initial approval decided (follow-up to ticket #93).
 *
 * Until `proposal_decisions.decided_aid_lines_json` existed, an initial approval
 * wrote its approved amounts only to the live draft. The version snapshot kept
 * the submitted content, and a later revision overwrote the draft - leaving the
 * signed `rights_digest` as the only record of what was approved.
 *
 * A candidate is written back only when it reproduces that signed digest, so a
 * recovered line set is exactly the one the approver signed, never a guess:
 *
 * - the live draft, while it is still at the decided version;
 * - the lines the first revision away from that version was compared against
 *   (its delta's removed, modified-before and unchanged lines), put in the
 *   order of the version snapshot.
 *
 * Anything that reproduces neither stays empty and is reported.
 */

import { sql } from "drizzle-orm";
import { computeRightsDigest, type AidLine, type ProposalDecisionAction } from "./disbursement";

type Database = { execute: (query: any) => Promise<any> };

const rowsOf = (result: any): any[] =>
  Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];

export type DecisionLinesOutcome = {
  decisionId: string;
  proposalId: string;
  proposalVersion: number;
  state: "RECOVERED_FROM_DRAFT" | "RECOVERED_FROM_REVISION" | "UNRECOVERABLE";
};

export type DecisionLinesReport = {
  /** APPROVE decisions still without decided lines, before this run wrote any. */
  missing: number;
  outcomes: DecisionLinesOutcome[];
};

function reorderLike(snapshot: AidLine[], lines: AidLine[]): AidLine[] | null {
  const byId = new Map(lines.map((line) => [line.id, line]));
  if (byId.size !== snapshot.length) return null;
  const ordered = snapshot.map((line) => byId.get(line.id));
  return ordered.every(Boolean) ? (ordered as AidLine[]) : null;
}

/**
 * Finds a recoverable line set for every APPROVE decision without one. `apply`
 * writes those that reproduce the signed digest; without it nothing is written.
 */
export async function recoverDecidedAidLines(db: Database, options: { apply: boolean }): Promise<DecisionLinesReport> {
  const decisions = rowsOf(
    await db.execute(sql`
      SELECT d.id, d.institution_id, d.proposal_id, d.proposal_version, d.action, d.decision_reference,
             d.decision_date, d.notes, d.rejection_reason, d.rights_digest,
             v.data_json, p.version AS draft_version, p.aid_lines_json AS draft_aid_lines_json
      FROM proposal_decisions d
      JOIN proposal_versions v ON v.proposal_id = d.proposal_id AND v.version = d.proposal_version
        AND v.institution_id = d.institution_id
      JOIN proposal_drafts p ON p.id = d.proposal_id AND p.institution_id = d.institution_id
      WHERE d.action = 'APPROVE' AND d.decided_aid_lines_json IS NULL
      ORDER BY d.created_at, d.id
    `)
  );

  const outcomes: DecisionLinesOutcome[] = [];
  for (const row of decisions) {
    const version = Number(row.proposal_version);
    const signs = (lines: AidLine[]) =>
      computeRightsDigest(lines, {
        action: row.action as ProposalDecisionAction,
        decisionReference: row.decision_reference,
        decisionDate: row.decision_date,
        notes: row.notes ?? null,
        rejectionReason: row.rejection_reason ?? null,
      }) === row.rights_digest;

    const snapshotLines: AidLine[] = JSON.parse(row.data_json).aidLines ?? [];
    let recovered: { lines: AidLine[]; state: DecisionLinesOutcome["state"] } | null = null;

    if (Number(row.draft_version) === version) {
      const draftLines: AidLine[] = JSON.parse(row.draft_aid_lines_json || "[]");
      if (signs(draftLines)) recovered = { lines: draftLines, state: "RECOVERED_FROM_DRAFT" };
    }
    if (!recovered) {
      const revision = rowsOf(
        await db.execute(sql`
          SELECT delta_json FROM proposal_revisions
          WHERE institution_id = ${row.institution_id} AND proposal_id = ${row.proposal_id} AND from_version = ${version}
          ORDER BY revision_number ASC
          LIMIT 1
        `)
      )[0];
      const delta = revision ? JSON.parse(revision.delta_json || "{}") : null;
      const previous: AidLine[] | null = delta?.aidLines
        ? [
            ...(delta.aidLines.unchanged ?? []),
            ...(delta.aidLines.removed ?? []),
            ...(delta.aidLines.modified ?? []).map((m: { before: AidLine }) => m.before),
          ]
        : null;
      const ordered = previous ? reorderLike(snapshotLines, previous) : null;
      if (ordered && signs(ordered)) recovered = { lines: ordered, state: "RECOVERED_FROM_REVISION" };
    }

    if (recovered && options.apply) {
      await db.execute(sql`
        UPDATE proposal_decisions SET decided_aid_lines_json = ${JSON.stringify(recovered.lines)}
        WHERE id = ${row.id} AND decided_aid_lines_json IS NULL
      `);
    }
    outcomes.push({
      decisionId: row.id,
      proposalId: row.proposal_id,
      proposalVersion: version,
      state: recovered?.state ?? "UNRECOVERABLE",
    });
  }
  return { missing: decisions.length, outcomes };
}

/**
 * Where a disbursement's amount is kept exactly (ticket #80).
 *
 * The sibling of `usdc-deposit-store`, for the other side of the ledger, and it
 * exists for the same reason: `disbursement_proposals.amount` is declared
 * `bigint({ mode: "number" })`, so the driver returns it as a JavaScript number.
 * The chain reader copes today by refusing any proposal above 2^53 minor units,
 * which is safe but turns a valid disbursement into an error.
 *
 * An exact decimal-text column removes the round trip and the refusal together.
 * It changes nothing about how an amount is *interpreted* - that is
 * `readProposalAmount`'s job, and the unit comes from `currencyType` - only
 * about how much of it survives storage.
 *
 * Additive and operator-run, never at boot, for the reasons ADR-0025 gives.
 * The code therefore has to work on both sides of the migration, which is why
 * the projection is chosen from the catalog rather than from the model.
 */

import { sql } from "drizzle-orm";
import * as schema from "./db/schema";
import { rowsOf, type DepositDatabase } from "./usdc-deposit-store";

/** Any Drizzle PostgreSQL handle that can run a statement. */
export type ProposalDatabase = DepositDatabase;

export const EXACT_AMOUNT_COLUMN = "amount_exact" as const;

export const PROPOSAL_AMOUNT_MIGRATION_STATEMENTS = [
  `ALTER TABLE disbursement_proposals ADD COLUMN IF NOT EXISTS ${EXACT_AMOUNT_COLUMN} TEXT`,
] as const;

export async function applyProposalAmountMigration(db: ProposalDatabase): Promise<void> {
  for (const statement of PROPOSAL_AMOUNT_MIGRATION_STATEMENTS) {
    await db.execute(sql.raw(statement));
  }
}

export async function hasExactAmountColumn(db: ProposalDatabase): Promise<boolean> {
  const found = rowsOf(
    await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'disbursement_proposals'
        AND column_name = ${EXACT_AMOUNT_COLUMN}
    `)
  );
  return found.length > 0;
}

/**
 * Which columns a `disbursement_proposals` read may name on this deployment.
 *
 * Drizzle names every column of the model unless told otherwise, so adding one
 * to the model would break every read of the table on an unmigrated database.
 */
export const proposalSelection = (migrated: boolean) => ({
  id: schema.disbursementProposals.id,
  proposalIdOnChain: schema.disbursementProposals.proposalIdOnChain,
  currencyType: schema.disbursementProposals.currencyType,
  amount: schema.disbursementProposals.amount,
  asnafCategory: schema.disbursementProposals.asnafCategory,
  beneficiaryName: schema.disbursementProposals.beneficiaryName,
  beneficiaryNIKMasked: schema.disbursementProposals.beneficiaryNIKMasked,
  beneficiaryHash: schema.disbursementProposals.beneficiaryHash,
  ipfsProofCID: schema.disbursementProposals.ipfsProofCID,
  disbursementReceiptCID: schema.disbursementProposals.disbursementReceiptCID,
  periodId: schema.disbursementProposals.periodId,
  status: schema.disbursementProposals.status,
  cancelReason: schema.disbursementProposals.cancelReason,
  approvalCount: schema.disbursementProposals.approvalCount,
  approvedBy: schema.disbursementProposals.approvedBy,
  txHash: schema.disbursementProposals.txHash,
  auditStatus: schema.disbursementProposals.auditStatus,
  auditorAddress: schema.disbursementProposals.auditorAddress,
  auditorName: schema.disbursementProposals.auditorName,
  auditReportCID: schema.disbursementProposals.auditReportCID,
  auditOpinion: schema.disbursementProposals.auditOpinion,
  auditNotes: schema.disbursementProposals.auditNotes,
  auditedAt: schema.disbursementProposals.auditedAt,
  auditTxHash: schema.disbursementProposals.auditTxHash,
  laiDocumentCID: schema.disbursementProposals.laiDocumentCID,
  financialStatementsCID: schema.disbursementProposals.financialStatementsCID,
  safeStatus: schema.disbursementProposals.safeStatus,
  safeConfirmationsCount: schema.disbursementProposals.safeConfirmationsCount,
  safeConfirmationsRequired: schema.disbursementProposals.safeConfirmationsRequired,
  createdAt: schema.disbursementProposals.createdAt,
  executedAt: schema.disbursementProposals.executedAt,
  ...(migrated ? { amountExact: schema.disbursementProposals.amountExact } : {}),
});

export type ProposalAmountReport = {
  migrated: boolean;
  totalProposals: number;
  /** Rows carrying an exact amount. `null` before the migration. */
  exact: number | null;
  /**
   * USDC proposals still read through the number column. Not an error - the
   * unit is still `currencyType` and the value is still whatever the row holds -
   * but their precision is bounded by 2^53 minor units.
   */
  usdcWithoutExactAmount: number;
  /** Their on-chain proposal ids, so an operator can look rather than count. */
  inexactReferences: number[];
};

export async function verifyProposalAmounts(
  db: ProposalDatabase
): Promise<ProposalAmountReport> {
  const migrated = await hasExactAmountColumn(db);

  const proposals = rowsOf(
    await db.execute(
      migrated
        ? sql`SELECT proposal_id_on_chain, currency_type, amount_exact FROM disbursement_proposals
              ORDER BY proposal_id_on_chain ASC`
        : sql`SELECT proposal_id_on_chain, currency_type FROM disbursement_proposals
              ORDER BY proposal_id_on_chain ASC`
    )
  );

  const inexactUsdc = proposals.filter(
    (row) => Number(row.currency_type) === 1 && !(migrated && row.amount_exact)
  );

  return {
    migrated,
    totalProposals: proposals.length,
    exact: migrated ? proposals.filter((row) => Boolean(row.amount_exact)).length : null,
    usdcWithoutExactAmount: inexactUsdc.length,
    inexactReferences: inexactUsdc.map((row) => Number(row.proposal_id_on_chain)),
  };
}

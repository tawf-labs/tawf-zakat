/**
 * Mode Internal (Spec #55) - maps this protocol's own two representations of the
 * same transaction population onto the shape the reconciliation engine eats.
 *
 * Claim side: what PostgreSQL says happened (batches, the fiat donations behind
 * them, disbursement proposals). Source side: what the indexed chain says.
 *
 * Pure on purpose - it takes rows, not a database handle - so every mapping
 * decision is testable without a connection, and no comparison logic is
 * rewritten here: `reconcile` still does all the comparing.
 *
 * Known gap: a USDC deposit row in `donations` carries only an *estimated* IDR
 * value and no transaction hash, so it cannot be tied back to its USDCDeposited
 * event. Reconciling that stream per deposit needs columns the v0 ticket rules
 * out (no new tables, no migrations), so USDC deposits are deliberately left out
 * of the claim side rather than compared against an estimate.
 */

import {
  type CurrencyUnit,
  type LedgerEntry,
  type LedgerSide,
  type Money,
  type ReportingPeriod,
} from "./reconciliation";

export type InternalDonationRow = {
  trxId: string;
  amountIDR: number;
  batchId?: number | null;
  status?: string;
  paymentMethod?: string | null;
  createdAt?: Date | string | null;
};

export type InternalBatchRow = {
  batchNumber: number;
  totalAmountIDR: number;
  txHash?: string | null;
  status?: string;
  settledAt?: Date | string | null;
};

export type InternalProposalRow = {
  proposalIdOnChain: number;
  currencyType: number; // 0: IDR, 1: USDC
  amount: number;
  status: string; // 'Pending' | 'Approved' | 'Executed' | 'Cancelled'
  txHash?: string | null;
  createdAt?: Date | string | null;
  executedAt?: Date | string | null;
};

export type InternalEventRow = {
  eventName: string;
  txHash: string;
  blockNumber: number;
  logIndex?: number;
  argsJson: string;
};

export type InternalSnapshot = {
  donations: InternalDonationRow[];
  batches: InternalBatchRow[];
  proposals: InternalProposalRow[];
  events: InternalEventRow[];
};

/** The ledger streams the internal mode reconciles. */
export const INTERNAL_BUCKETS = [
  "MERKLE_BATCH",
  "DONASI_FIAT",
  "PROPOSAL",
  "DISBURSEMENT",
] as const;

export const INTERNAL_UNITS: readonly CurrencyUnit[] = ["IDR", "USDC_6DP"];

const CLAIM_LABEL = "Catatan PostgreSQL";
const SOURCE_LABEL = "Event on-chain terindeks";

const USDC_MINOR_UNIT_SCALE = 1_000_000n;

const money = (amount: bigint, unit: CurrencyUnit): Money => ({ amount, unit });

/**
 * Proposal amounts are stored either as whole USDC or as 6-decimal minor units,
 * depending on which writer produced the row. This mirrors the heuristic the
 * proposal read path already uses, so both surfaces read a row the same way.
 */
function toUsdcMinorUnits(amount: number): bigint {
  const value = BigInt(Math.round(amount));
  return value < USDC_MINOR_UNIT_SCALE ? value * USDC_MINOR_UNIT_SCALE : value;
}

function unitOfCurrencyType(currencyType: number): CurrencyUnit {
  return currencyType === 1 ? "USDC_6DP" : "IDR";
}

function proposalAmount(row: InternalProposalRow): Money {
  return row.currencyType === 1
    ? money(toUsdcMinorUnits(row.amount), "USDC_6DP")
    : money(BigInt(Math.round(row.amount)), "IDR");
}

function parseArgs(event: InternalEventRow): Record<string, any> {
  try {
    const parsed = JSON.parse(event.argsJson);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const batchKey = (batchNumber: number | string) => `BATCH#${batchNumber}`;
const proposalKey = (proposalId: number | string) => `PROPOSAL#${proposalId}`;
const disbursementKey = (proposalId: number | string) => `DISBURSEMENT#${proposalId}`;

/** A batch row only claims to be on-chain once it has been settled. */
const isSettled = (batch: InternalBatchRow): boolean =>
  Boolean(batch.txHash) || batch.status === "settled_onchain";

const entry = (
  key: string,
  bucket: string,
  value: Money,
  label: string
): LedgerEntry => ({ key, bucket, balanceSheet: "ON", value, label });

/**
 * Builds both sides of the internal ledger for one currency unit. Rupiah and
 * USDC are never mixed into the same report - they are different units and the
 * engine refuses to add them.
 */
export function buildInternalLedgerSides(
  snapshot: InternalSnapshot,
  unit: CurrencyUnit
): { claim: LedgerSide; source: LedgerSide } {
  const claimEntries: LedgerEntry[] = [];
  const sourceEntries: LedgerEntry[] = [];

  if (unit === "IDR") {
    for (const batch of snapshot.batches) {
      if (!isSettled(batch)) continue;

      claimEntries.push(
        entry(
          batchKey(batch.batchNumber),
          "MERKLE_BATCH",
          money(BigInt(Math.round(batch.totalAmountIDR)), "IDR"),
          `Batch Merkle #${batch.batchNumber}`
        )
      );

      const donationsInBatch = snapshot.donations.filter((d) => d.batchId === batch.batchNumber);
      const donationTotal = donationsInBatch.reduce(
        (sum, d) => sum + BigInt(Math.round(d.amountIDR)),
        0n
      );
      claimEntries.push(
        entry(
          batchKey(batch.batchNumber),
          "DONASI_FIAT",
          money(donationTotal, "IDR"),
          `Donasi fiat dalam batch #${batch.batchNumber} (${donationsInBatch.length} transaksi)`
        )
      );
    }
  }

  for (const proposal of snapshot.proposals) {
    if (unitOfCurrencyType(proposal.currencyType) !== unit) continue;

    // A proposal row claims an on-chain proposal only once it carries its tx.
    if (proposal.txHash) {
      claimEntries.push(
        entry(
          proposalKey(proposal.proposalIdOnChain),
          "PROPOSAL",
          proposalAmount(proposal),
          `Proposal penyaluran #${proposal.proposalIdOnChain}`
        )
      );
    }

    if (proposal.status === "Executed") {
      claimEntries.push(
        entry(
          disbursementKey(proposal.proposalIdOnChain),
          "DISBURSEMENT",
          proposalAmount(proposal),
          `Penyaluran tereksekusi #${proposal.proposalIdOnChain}`
        )
      );
    }
  }

  for (const event of snapshot.events) {
    const args = parseArgs(event);

    switch (event.eventName) {
      case "FiatBatchSettled": {
        if (unit !== "IDR") break;
        const batchId = String(args.batchId ?? "");
        if (batchId === "") break;
        const total = money(BigInt(args.totalAmountIDR ?? 0), "IDR");
        // The settled total is the chain's word on both the batch and the
        // donations that were rolled into it.
        sourceEntries.push(entry(batchKey(batchId), "MERKLE_BATCH", total, `FiatBatchSettled #${batchId}`));
        sourceEntries.push(entry(batchKey(batchId), "DONASI_FIAT", total, `FiatBatchSettled #${batchId}`));
        break;
      }

      case "DisbursementProposed":
      case "DisbursementExecuted": {
        const currencyType = Number(args.currencyType ?? 0);
        if (unitOfCurrencyType(currencyType) !== unit) break;

        const proposalId = String(args.proposalId ?? "");
        if (proposalId === "") break;

        const value = money(BigInt(args.amount ?? 0), unit);
        const isExecution = event.eventName === "DisbursementExecuted";

        sourceEntries.push(
          entry(
            isExecution ? disbursementKey(proposalId) : proposalKey(proposalId),
            isExecution ? "DISBURSEMENT" : "PROPOSAL",
            value,
            `${event.eventName} #${proposalId}`
          )
        );
        break;
      }

      default:
        break;
    }
  }

  return {
    claim: { label: CLAIM_LABEL, entries: claimEntries },
    source: { label: SOURCE_LABEL, entries: sourceEntries },
  };
}

/** Half-open bounds of a reporting period: [from, to). */
export function periodBounds(period: ReportingPeriod): { from: Date; to: Date } {
  const from = new Date(Date.UTC(period.year, 0, 1));
  const to =
    period.kind === "SEMESTER"
      ? new Date(Date.UTC(period.year, 6, 1))
      : new Date(Date.UTC(period.year + 1, 0, 1));
  return { from, to };
}

/** True when a row's timestamp falls inside the reporting period. */
export function withinPeriod(
  timestamp: Date | string | null | undefined,
  period: ReportingPeriod
): boolean {
  if (!timestamp) return true; // an undated row is never hidden by a period filter
  const at = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(at.getTime())) return true;
  const { from, to } = periodBounds(period);
  return at >= from && at < to;
}

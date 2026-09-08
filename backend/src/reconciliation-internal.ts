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
 *
 * Deposits per transaction are examined on their own path instead - see
 * `internal-usdc-source` (ticket #79), which maps them as an evidence-package
 * source in native USDC minor units and reports the ledger side as unsupported
 * until #67 lands the columns that would pair it.
 */

import {
  money,
  type CurrencyUnit,
  type LedgerEntry,
  type LedgerSide,
  type Money,
  type ReportingPeriod,
} from "./reconciliation";
import { proposalAmount, toWholeAmount, unitOfCurrencyType, withinPeriod } from "./ledger-rows";
import { asnafOf } from "./period-report";
import type { AmilBasis } from "./reconciliation-amil";

export type InternalDonationRow = {
  trxId: string;
  amountIDR: number | string;
  batchId?: number | null;
  status?: string;
  paymentMethod?: string | null;
  createdAt?: Date | string | null;
};

export type InternalBatchRow = {
  batchNumber: number;
  totalAmountIDR: number | string;
  txHash?: string | null;
  status?: string;
  settledAt?: Date | string | null;
};

export type InternalProposalRow = {
  proposalIdOnChain: number;
  currencyType: number; // 0: IDR, 1: USDC
  amount: number | string;
  status: string; // 'Pending' | 'Approved' | 'Executed' | 'Cancelled'
  asnafCategory?: string | number | null;
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

function internalAmilBasis(snapshot: InternalSnapshot, unit: CurrencyUnit): AmilBasis {
  const base: AmilBasis = {
    key: "PROTOKOL", label: "Snapshot batch settled dan penyaluran tereksekusi",
    balanceSheet: "ON", collected: null, actual: null,
  };
  if (unit !== "IDR") return { ...base, reason: "Jumlah deposit USDC asli belum tersimpan; estimasi IDR tidak dipakai sebagai basis plafon." };
  const batches = snapshot.batches.filter(isSettled);
  const executed = snapshot.proposals.filter((p) => p.status === "Executed" && p.currencyType === 0);
  if (batches.length === 0 && executed.length === 0) return { ...base, reason: "Tidak ada data batch settled atau penyaluran IDR dalam snapshot ini." };
  const duplicateBatch = new Set(batches.map((b) => b.batchNumber)).size !== batches.length;
  const duplicateProposal = new Set(executed.map((p) => p.proposalIdOnChain)).size !== executed.length;
  if (duplicateBatch || duplicateProposal) return { ...base, reason: "Baris batch atau penyaluran ganda membuat basis hak amil tidak dapat dipastikan." };
  base.collected = money(batches.reduce((sum, b) => sum + toWholeAmount(b.totalAmountIDR, `Batch #${b.batchNumber}`), 0n), unit);
  if (executed.some((p) => asnafOf(p.asnafCategory) === "LAINNYA")) {
    return { ...base, reason: "Asnaf penyaluran tidak lengkap atau tidak dikenal; hak amil tidak dianggap nol." };
  }
  base.actual = money(executed.filter((p) => asnafOf(p.asnafCategory) === "AMIL")
    .reduce((sum, p) => sum + proposalAmount(p).amount, 0n), unit);
  return base;
}

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
          money(toWholeAmount(batch.totalAmountIDR, `Total batch #${batch.batchNumber}`), "IDR"),
          `Batch Merkle #${batch.batchNumber}`
        )
      );

      const donationsInBatch = snapshot.donations.filter((d) => d.batchId === batch.batchNumber);
      const donationTotal = donationsInBatch.reduce(
        (sum, d) => sum + toWholeAmount(d.amountIDR, `Donasi ${d.trxId}`),
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
    claim: { label: CLAIM_LABEL, entries: claimEntries, amilBasis: [internalAmilBasis(snapshot, unit)] },
    source: { label: SOURCE_LABEL, entries: sourceEntries, amilBasis: [{
      key: "PROTOKOL", label: "Event penyaluran terindeks", balanceSheet: "ON",
      collected: null, actual: null,
      reason: "Event penyaluran tidak memuat asnaf; plafon hak amil sisi sumber belum dapat diperiksa.",
    }] },
  };
}

/** Rows as the database hands them over, before this module shapes them. */
export type InternalRowSources = {
  donationRows: Array<Record<string, any>>;
  /** Already mapped by `dbService.getBatches`, hence `batchId` rather than `batchNumber`. */
  batchRows: Array<Record<string, any>>;
  proposalRows: Array<Record<string, any>>;
  eventRows: Array<Record<string, any>>;
};

/**
 * Shapes raw rows into a snapshot, optionally narrowed to one reporting period.
 *
 * The period bound is applied to both sides - database rows by their own
 * timestamps, indexed events by when the indexer recorded them - because
 * narrowing only one side would invent discrepancies for everything outside it.
 */
export function snapshotFromRows(
  sources: InternalRowSources,
  period?: ReportingPeriod
): InternalSnapshot {
  const keep = (timestamp: Date | string | null | undefined) =>
    !period || withinPeriod(timestamp, period);

  return {
    donations: sources.donationRows
      .filter((row) => keep(row.createdAt))
      .map((row) => ({
        trxId: row.trxId,
        amountIDR: row.amountIDR,
        batchId: row.batchId ?? null,
        status: row.status,
        paymentMethod: row.paymentMethod ?? null,
        createdAt: row.createdAt ?? null,
      })),
    batches: sources.batchRows
      .filter((row) => keep(row.settledAt))
      .map((row) => ({
        batchNumber: Number(row.batchId ?? row.batchNumber),
        totalAmountIDR: row.totalAmountIDR,
        txHash: row.txHash ?? null,
        status: row.txHash ? "settled_onchain" : "pending",
        settledAt: row.settledAt ?? null,
      })),
    proposals: sources.proposalRows
      .filter((row) => keep(row.createdAt))
      .map((row) => ({
        proposalIdOnChain: Number(row.proposalIdOnChain),
        currencyType: Number(row.currencyType),
        amount: row.amount,
        status: row.status,
        txHash: row.txHash ?? null,
        asnafCategory: row.asnafCategory ?? null,
        createdAt: row.createdAt ?? null,
        executedAt: row.executedAt ?? null,
      })),
    events: sources.eventRows
      .filter((row) => keep(row.createdAt))
      .map((row) => ({
        eventName: row.eventName,
        txHash: row.txHash,
        blockNumber: Number(row.blockNumber),
        logIndex: Number(row.logIndex ?? 0),
        argsJson: row.argsJson,
      })),
  };
}

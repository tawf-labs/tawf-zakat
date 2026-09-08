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
import {
  proposalAmount,
  readProposalAmount,
  toWholeAmount,
  unitOfCurrencyType,
  withinPeriod,
} from "./ledger-rows";
import { asnafOf } from "./period-report";
import type { AmilBasis } from "./reconciliation-amil";
import {
  mapDepositEvents,
  mapLedgerDeposits,
  USDC_DEPOSIT_BUCKET,
  USDC_DEPOSIT_EVENT,
  type LedgerDepositRow,
} from "./internal-usdc-source";
import type { NormalizedRow, UnverifiedRecord } from "./evidence-source";

export type InternalDonationRow = {
  trxId: string;
  amountIDR: number | string;
  batchId?: number | null;
  status?: string;
  paymentMethod?: string | null;
  createdAt?: Date | string | null;
  /**
   * Native USDC minor units and the deposit's event identity (ticket #67).
   * Absent on a fiat row and on a USDC row written before that ticket, and
   * absence is the signal that the row cannot be paired - never a reason to
   * fall back on `amountIDR`.
   */
  amountUsdc?: string | number | null;
  depositChainId?: number | null;
  depositContract?: string | null;
  depositTxHash?: string | null;
  depositLogIndex?: number | null;
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
  /** The amount as stored exactly (ticket #80). Absent before that migration. */
  amountExact?: string | number | null;
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
  /** Which contract emitted it. Needed to scope deposits to one deployment. */
  contractAddress?: string | null;
  argsJson: string;
};

/** The chain and contract this deployment's deposits belong to. */
export type InternalChainScope = { chainId: number; contract: string };

export type InternalSnapshot = {
  donations: InternalDonationRow[];
  batches: InternalBatchRow[];
  proposals: InternalProposalRow[];
  events: InternalEventRow[];
  /**
   * `null` where the deployment does not name one. Deposits are then left out
   * entirely rather than compared against an unnamed contract, since a key that
   * does not say which chain it came from is not an identity.
   */
  chain?: InternalChainScope | null;
};

/** The ledger streams the internal mode reconciles. */
export const INTERNAL_BUCKETS = [
  "MERKLE_BATCH",
  "DONASI_FIAT",
  "PROPOSAL",
  "DISBURSEMENT",
  USDC_DEPOSIT_BUCKET,
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
  // Both halves are knowable now: deposits carry their native amount (#67) and a
  // disbursement's amount is read from its stored `currencyType` rather than
  // guessed from its size (#80).
  if (unit !== "IDR") return usdcAmilBasis(snapshot, base);

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
 * The USDC ceiling basis: deposits collected, against the amil share disbursed.
 *
 * Every refusal below leaves both figures `null` with its reason. A basis that
 * is partly unknown is not a smaller basis - it is a ceiling nobody can check,
 * and reporting zero for the unknown half would quietly pass every proposal.
 */
function usdcAmilBasis(snapshot: InternalSnapshot, base: AmilBasis): AmilBasis {
  if (!snapshot.chain) {
    return { ...base, reason: "Deployment tidak menyebut chain dan kontrak deposit, sehingga pengumpulan USDC belum dapat dipastikan." };
  }

  const deposits = mapLedgerDeposits(ledgerDepositRows(snapshot), snapshot.chain);
  if (deposits.unverified.length > 0) {
    return {
      ...base,
      reason:
        `${deposits.unverified.length} baris deposit USDC belum terverifikasi, sehingga dasar ` +
        `pengumpulan belum lengkap dan plafon hak amil tidak dapat dihitung.`,
    };
  }

  const executed = snapshot.proposals.filter((p) => p.status === "Executed" && p.currencyType === 1);
  if (deposits.rows.length === 0 && executed.length === 0) {
    return { ...base, reason: "Tidak ada deposit atau penyaluran USDC dalam snapshot ini." };
  }
  if (new Set(executed.map((p) => p.proposalIdOnChain)).size !== executed.length) {
    return { ...base, reason: "Baris penyaluran USDC ganda membuat basis hak amil tidak dapat dipastikan." };
  }
  if (executed.some((p) => asnafOf(p.asnafCategory) === "LAINNYA")) {
    return { ...base, reason: "Asnaf penyaluran USDC tidak lengkap atau tidak dikenal; hak amil tidak dianggap nol." };
  }

  let actual = 0n;
  for (const proposal of executed.filter((p) => asnafOf(p.asnafCategory) === "AMIL")) {
    const read = readProposalAmount(proposal);
    if ("error" in read) return { ...base, reason: `${read.error} Plafon hak amil USDC tidak dapat dihitung.` };
    actual += read.value.amount;
  }

  return {
    ...base,
    label: "Deposit USDC terverifikasi dan penyaluran USDC tereksekusi",
    collected: money(deposits.rows.reduce((sum, row) => sum + BigInt(row.amount), 0n), "USDC_6DP"),
    actual: money(actual, "USDC_6DP"),
  };
}

/** The USDC donation rows of a snapshot, in the shape the deposit mapper reads. */
const ledgerDepositRows = (snapshot: InternalSnapshot): LedgerDepositRow[] =>
  snapshot.donations
    .filter((row) => String(row.paymentMethod ?? "").toUpperCase() === "USDC")
    .map((row) => ({
      trxId: row.trxId,
      amountUsdc: row.amountUsdc ?? null,
      depositChainId: row.depositChainId ?? null,
      depositContract: row.depositContract ?? null,
      depositTxHash: row.depositTxHash ?? null,
      depositLogIndex: row.depositLogIndex ?? null,
      amountIDR: row.amountIDR,
      createdAt: row.createdAt ?? null,
    }));

/** A mapped deposit row, as the engine wants it. The key already carries identity. */
const depositEntry = (row: NormalizedRow): LedgerEntry => ({
  key: row.key,
  bucket: row.bucket,
  balanceSheet: row.balanceSheet,
  value: money(BigInt(row.amount), "USDC_6DP"),
  ...(row.label !== null ? { label: row.label } : {}),
});

/**
 * Deposits on both sides, mapped by the same pure module the evidence package
 * uses (ticket #79), so the two surfaces cannot drift into two answers about one
 * deposit.
 *
 * Ledger rows are read as `LedgerDepositRow`s, which is where the refusal to
 * guess lives: a row with no event identity or no native amount becomes an
 * unverified record with its reason, never an entry carrying `amountIDR`.
 */
function depositSides(snapshot: InternalSnapshot): {
  claim: LedgerEntry[];
  source: LedgerEntry[];
  unverified: UnverifiedRecord[];
} {
  const chain = snapshot.chain;
  if (!chain) {
    // An unscoped deployment cannot form a deposit identity, so nothing is
    // compared. Returning three empty lists would let `reconcile` report a
    // balanced deposit population it never looked at - the empty-list-as-answer
    // this project refuses everywhere else. Every row and event that would have
    // been examined is named as unverified instead.
    const reason =
      "Deployment ini tidak menyebut chain dan kontrak deposit, sehingga identitas deposit tidak " +
      "dapat dibentuk dan tidak ada deposit yang diperbandingkan.";
    return {
      claim: [],
      source: [],
      unverified: [
        ...snapshot.donations
          .filter((row) => String(row.paymentMethod ?? "").toUpperCase() === "USDC")
          .map((row) => ({ side: "CLAIM" as const, reference: row.trxId, reason })),
        ...snapshot.events
          .filter((event) => event.eventName === USDC_DEPOSIT_EVENT)
          .map((event) => ({
            side: "SOURCE" as const,
            reference: `${String(event.txHash).toLowerCase()}#${event.logIndex ?? 0}`,
            reason,
          })),
      ],
    };
  }

  const scope = { chainId: chain.chainId, contract: chain.contract };
  const claimSide = mapLedgerDeposits(ledgerDepositRows(snapshot), scope);
  const sourceSide = mapDepositEvents(
    snapshot.events.map((event) => ({
      eventName: event.eventName,
      txHash: event.txHash,
      logIndex: event.logIndex ?? 0,
      blockNumber: event.blockNumber,
      contractAddress: event.contractAddress ?? "",
      argsJson: event.argsJson,
    })),
    scope
  );

  return {
    claim: claimSide.rows.map(depositEntry),
    source: sourceSide.rows.map(depositEntry),
    unverified: [...claimSide.unverified, ...sourceSide.unverified],
  };
}

/**
 * Builds both sides of the internal ledger for one currency unit. Rupiah and
 * USDC are never mixed into the same report - they are different units and the
 * engine refuses to add them.
 *
 * `unverified` carries the records neither side could prove. They are returned
 * beside the sides rather than dropped, because a deposit that could not be
 * examined is a gap in the comparison, and a comparison that hides its gaps
 * reads as more complete than it is.
 */
export function buildInternalLedgerSides(
  snapshot: InternalSnapshot,
  unit: CurrencyUnit
): { claim: LedgerSide; source: LedgerSide; unverified: UnverifiedRecord[] } {
  const claimEntries: LedgerEntry[] = [];
  const sourceEntries: LedgerEntry[] = [];
  const deposits = unit === "USDC_6DP" ? depositSides(snapshot) : { claim: [], source: [], unverified: [] };
  claimEntries.push(...deposits.claim);
  sourceEntries.push(...deposits.source);

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
    unverified: deposits.unverified,
  };
}

/** Rows as the database hands them over, before this module shapes them. */
export type InternalRowSources = {
  donationRows: Array<Record<string, any>>;
  /** The deployment's chain and contract, for scoping deposits. */
  chain?: InternalChainScope | null;
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
    chain: sources.chain ?? null,
    donations: sources.donationRows
      .filter((row) => keep(row.createdAt))
      .map((row) => ({
        trxId: row.trxId,
        amountIDR: row.amountIDR,
        batchId: row.batchId ?? null,
        status: row.status,
        paymentMethod: row.paymentMethod ?? null,
        createdAt: row.createdAt ?? null,
        // Left exactly as stored. Whether these amount to a provable pairing is
        // the deposit mapper's judgement, not this shaper's.
        amountUsdc: row.amountUsdc6dp ?? row.amountUsdc ?? null,
        depositChainId: row.depositChainId ?? null,
        depositContract: row.depositContract ?? null,
        depositTxHash: row.depositTxHash ?? null,
        depositLogIndex: row.depositLogIndex ?? null,
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
        amountExact: row.amountExact ?? null,
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
        contractAddress: row.contractAddress ?? null,
        argsJson: row.argsJson,
      })),
  };
}

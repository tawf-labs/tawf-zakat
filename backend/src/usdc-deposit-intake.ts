/**
 * The intake boundary for a USDC deposit (ticket #67).
 *
 * A deposit reaches this application once, as an indexed `USDCDeposited` event.
 * Whatever is not preserved here is not recoverable later by any amount of
 * reporting, so this module is the place where two things are kept and a third
 * is refused:
 *
 * 1. **The native amount, exactly.** Minor units stay decimal integers all the
 *    way to storage. `Number` stops being exact at 9.007.199.254.740.991 minor
 *    units, and a magnitude heuristic - "a small number must mean whole USDC" -
 *    silently turns a 0,5 USDC deposit into 500.000 USDC. Neither is applied.
 * 2. **The identity, completely.** Chain, contract, transaction hash and log
 *    index together, so two deposits in one transaction stay two deposits and
 *    the same event read twice stays one row.
 * 3. **No rupiah.** The old path stored only an estimate at a hardcoded rate.
 *    An estimate is not the amount, and a row that keeps only an estimate cannot
 *    be reconciled against the chain at all - which is the whole reason this
 *    ticket exists.
 *
 * The `trxId` is derived from the identity rather than minted randomly. That is
 * what makes reprocessing idempotent: the old random suffix meant a replayed
 * event could never collide with the row it had already produced, so it inserted
 * a second one.
 *
 * Pure: no database, no clock, no network. An event in, a row's values out, or
 * the reason there are none.
 */

import { isHex, readMinorUnits } from "./internal-usdc-source";

export type DepositIdentity = {
  chainId: number;
  /** Lowercased hex. Comparison is case-insensitive; the record is not. */
  contract: string;
  txHash: string;
  logIndex: number;
};

export type DepositEventInput = {
  chainId: number;
  contract: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  /** As decoded: a `bigint` from the ABI, or its decimal text after transport. */
  amountUSDC: unknown;
  donor: unknown;
  isAnonymous: unknown;
  commitmentHash?: unknown;
  /** ISO 8601 instant the deposit was observed at. */
  occurredAt?: string;
};

export type DepositIntakeRecord = {
  trxId: string;
  identity: DepositIdentity;
  /** Native USDC minor units as a decimal integer string. Never a float. */
  amountUsdc6dp: string;
  blockNumber: number;
  donorName: string;
  isAnonymous: boolean;
  commitmentHash: string | null;
  occurredAt: string;
};

/**
 * One deposit's **ledger row identifier**, derived from its identity.
 *
 * Distinct from `depositKeyOf` in `internal-usdc-source`, which is the
 * **reconciliation key** the engine matches two sides on. Both are derived from
 * the same four facts and neither is computed from the other: this one has to be
 * usable as the `/api/donations/:trxId` path segment the row is read back
 * through, so it is hex and dashes only, while the reconciliation key is shaped
 * to read as an identity when it appears in a finding.
 */
export const depositTrxId = (identity: DepositIdentity): string =>
  `USDC-${identity.chainId}-${identity.txHash.toLowerCase()}-${identity.logIndex}`;

/** How a public donor is named. Anonymous rows never carry the address at all. */
const donorNameOf = (donor: string, isAnonymous: boolean): string =>
  isAnonymous ? "Hamba Allah" : `Muzakki Web3 (${donor.slice(0, 6)}...${donor.slice(-4)})`;

export function readDepositIntake(
  input: DepositEventInput
): { record: DepositIntakeRecord } | { error: string } {
  const chainId = Number(input.chainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return { error: `Chain id deposit tidak sah: ${JSON.stringify(input.chainId)}.` };
  }

  if (!isHex(input.contract, 20)) {
    return { error: `Alamat kontrak deposit tidak sah: ${JSON.stringify(input.contract)}.` };
  }

  if (!isHex(input.txHash, 32)) {
    return { error: `Transaction hash deposit tidak sah: ${JSON.stringify(input.txHash)}.` };
  }

  const logIndex = Number(input.logIndex);
  if (!Number.isSafeInteger(logIndex) || logIndex < 0) {
    return { error: `Log index deposit tidak sah: ${JSON.stringify(input.logIndex)}.` };
  }

  const blockNumber = Number(input.blockNumber);
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) {
    return { error: `Nomor blok deposit tidak sah: ${JSON.stringify(input.blockNumber)}.` };
  }

  const amount = readMinorUnits(input.amountUSDC);
  if ("error" in amount) return { error: amount.error };

  const isAnonymous = Boolean(input.isAnonymous);
  const donor = isHex(input.donor, 20) ? (input.donor as string) : "";
  if (!isAnonymous && donor === "") {
    return { error: `Alamat donatur tidak sah: ${JSON.stringify(input.donor)}.` };
  }

  const identity: DepositIdentity = {
    chainId,
    contract: input.contract.trim().toLowerCase(),
    txHash: input.txHash.trim().toLowerCase(),
    logIndex,
  };

  const occurredAt = input.occurredAt ?? new Date(0).toISOString();

  return {
    record: {
      trxId: depositTrxId(identity),
      identity,
      amountUsdc6dp: amount.amount.toString(),
      blockNumber,
      donorName: donorNameOf(donor, isAnonymous),
      isAnonymous,
      commitmentHash: isHex(input.commitmentHash, 32)
        ? (input.commitmentHash as string)
        : null,
      occurredAt,
    },
  };
}

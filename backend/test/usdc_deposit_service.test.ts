/**
 * The deposit intake as the indexer actually calls it (ticket #67).
 *
 * `readDepositIntake` and `saveUsdcDeposit` are tested on their own elsewhere.
 * What this file covers is the wiring between them and the caller: the fields
 * `IndexerEngine` passes across, the refusal path when an event cannot be read,
 * and the in-memory mirror - which is keyed by `trxId` and would therefore
 * silently overwrite a row that a later stage has already moved on from.
 *
 * This process has no `DATABASE_URL`, so `db` is null by design (see
 * `database_isolation.test.ts`). That is exactly the boundary under test here:
 * everything below the durable write still has to behave.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { db, dbService } from "../src/db/index";
import { dataStore } from "../src/store";
import { depositTrxId } from "../src/usdc-deposit-intake";

const CHAIN_ID = 421614;
const CONTRACT = "0x0d6cec28a574aca41b879767b081f6f2b4e9a849";
const TX = `0x${"ab".repeat(32)}`;
const DONOR = "0x1234567890abcdef1234567890abcdef12345678";

const trxIdOf = (logIndex = 0) =>
  depositTrxId({ chainId: CHAIN_ID, contract: CONTRACT, txHash: TX, logIndex });

/** Exactly the shape `IndexerEngine.processEvent` hands over for a deposit. */
const event = (overrides: Record<string, unknown> = {}) => ({
  chainId: CHAIN_ID,
  contract: CONTRACT,
  txHash: TX,
  logIndex: 0,
  blockNumber: 500,
  // The ABI decoder produces a bigint; the indexer passes it through untouched.
  amountUSDC: 1_500_000n,
  donor: DONOR,
  isAnonymous: false,
  commitmentHash: `0x${"cd".repeat(32)}`,
  occurredAt: "2026-02-01T00:00:00.000Z",
  ...overrides,
});

const record = (overrides: Record<string, unknown> = {}) =>
  dbService.recordUSDCDonation(event(overrides) as never);

afterEach(() => {
  for (const logIndex of [0, 1]) dataStore.donations.delete(trxIdOf(logIndex));
});

describe("dbService.recordUSDCDonation", () => {
  it("never opens a database connection in test mode", () => {
    expect(db === null).toBe(true);
  });

  it("carries the amount across as exact minor units", async () => {
    const outcome = await record({ amountUSDC: 500_000n });
    expect(outcome.success).toBe(true);
    if (!outcome.success) return;
    expect(outcome.record.amountUsdc6dp).toBe("500000");
  });

  it("carries chain, contract, transaction and log index across", async () => {
    const outcome = await record({ logIndex: 1 });
    expect(outcome.success).toBe(true);
    if (!outcome.success) return;
    expect(outcome.record.identity).toEqual({
      chainId: CHAIN_ID,
      contract: CONTRACT,
      txHash: TX,
      logIndex: 1,
    });
    expect(outcome.trxId).toBe(trxIdOf(1));
  });

  it("refuses an unreadable event and says why, instead of storing a guess", async () => {
    const outcome = await record({ amountUSDC: 1.5 });
    expect(outcome.success).toBe(false);
    if (outcome.success) return;
    expect(outcome.error).toContain("USDC");
    expect(dataStore.getDonation(trxIdOf())).toBeNull();
  });

  it("records no rupiah estimate for the deposit", async () => {
    await record({ amountUSDC: 1_000_000n });
    // The old path wrote round(1 * 16200). Nothing derives a rupiah figure now.
    expect(dataStore.getDonation(trxIdOf())?.amountIDR).toBe(0);
  });

  it("leaves one mirrored donation when the same event arrives twice", async () => {
    await record();
    await record();
    expect(dataStore.getDonation(trxIdOf())).not.toBeNull();
    expect([...dataStore.donations.keys()].filter((key) => key === trxIdOf())).toHaveLength(1);
  });

  it("does not undo a batch id the mirrored row has since been given", async () => {
    await record();
    const stored = dataStore.getDonation(trxIdOf())!;
    dataStore.recordDonation({ ...stored, status: "BATCHED" }, 7);

    // A restart, a duplicate delivery, a replay: the same log, seen again.
    await record();

    const after = dataStore.getDonation(trxIdOf())!;
    expect(after.batchId).toBe(7);
    expect(after.status).toBe("BATCHED");
  });

  it("keeps two deposits from one transaction as two mirrored donations", async () => {
    await record({ logIndex: 0, amountUSDC: 1_000_000n });
    await record({ logIndex: 1, amountUSDC: 1_500_000n });

    expect(dataStore.getDonation(trxIdOf(0))).not.toBeNull();
    expect(dataStore.getDonation(trxIdOf(1))).not.toBeNull();
    expect(trxIdOf(0)).not.toBe(trxIdOf(1));
  });

  it("does not put the donor address in an anonymous mirrored row", async () => {
    await record({ isAnonymous: true });
    expect(dataStore.getDonation(trxIdOf())?.donorName).toBe("Hamba Allah");
  });
});

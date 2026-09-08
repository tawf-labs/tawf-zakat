/**
 * Reading this deployment's own deposit ledger (Spec #68, ticket #79).
 *
 * The adapter half of `internal-usdc-source`: it knows about SQL, the schema
 * this deployment actually has, and the indexer checkpoint. Every judgement it
 * makes about what those rows *mean* is made in the pure module.
 *
 * One thing is decided here and nowhere else: whether the ledger can carry a
 * deposit's native amount and event identity at all. That is a fact about the
 * installed schema, established by asking the catalog *before* reading rows,
 * because "no rows carry an identity" and "no column can hold one" look
 * identical from the row side and mean opposite things. The columns belong to
 * #67; this module never creates them, and finding them absent is reported, not
 * repaired.
 *
 * Written against Drizzle's driver-agnostic `execute` so it runs on the deployed
 * PostgreSQL and on the PGlite database the tests isolate.
 */

import { sql } from "drizzle-orm";
import { attemptRead, sourceMissing, sourceRead, type SourceRead } from "./source-read";
import type {
  ChainScope,
  DepositEventRow,
  InternalLedgerReader,
  LedgerDepositRead,
  LedgerDepositRow,
} from "./internal-usdc-source";
import { USDC_DEPOSIT_EVENT } from "./internal-usdc-source";

/** Any Drizzle PostgreSQL handle that can run a statement. */
export type LedgerDatabase = { execute: (query: any) => Promise<any> };

const rowsOfResult = (result: any): any[] =>
  Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];

/**
 * The columns #67 adds. All of them, or none of them: a half-migrated ledger
 * cannot pair a deposit either, and treating it as if it could is how a partial
 * migration becomes a confident wrong answer.
 */
export const NATIVE_DEPOSIT_COLUMNS = [
  "amount_usdc_6dp",
  "deposit_chain_id",
  "deposit_contract",
  "deposit_tx_hash",
  "deposit_log_index",
] as const;

export async function hasNativeDepositColumns(db: LedgerDatabase): Promise<boolean> {
  const found = rowsOfResult(
    await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'donations'
    `)
  ).map((row: any) => String(row.column_name));
  return NATIVE_DEPOSIT_COLUMNS.every((column) => found.includes(column));
}

export type LedgerReaderConfig = {
  chainId: number;
  contract: string;
  indexerKey: string;
};

/**
 * The reader the evidence routes take, bound to one deployment's chain,
 * contract and indexer key.
 */
export function createInternalLedgerReader(
  db: LedgerDatabase,
  config: LedgerReaderConfig
): InternalLedgerReader {
  return {
    scope: () => ({ ...config, contract: config.contract.toLowerCase() }),

    async checkpoint(): Promise<ChainScope["checkpoint"]> {
      const rows = rowsOfResult(
        await db.execute(sql`
          SELECT last_indexed_block, status, last_sync_at FROM indexer_state
          WHERE indexer_key = ${config.indexerKey} LIMIT 1
        `)
      );
      const row = rows[0];
      // No checkpoint row is a real state - the indexer has never run here - and
      // is reported as block 0 with the status that says so, never as a
      // checkpoint that happens to be current.
      if (!row) {
        return { lastIndexedBlock: 0, status: "NEVER_INDEXED", lastSyncAt: null };
      }
      const lastSyncAt = row.last_sync_at ? new Date(row.last_sync_at) : null;
      return {
        lastIndexedBlock: Number(row.last_indexed_block ?? 0),
        status: String(row.status ?? "UNKNOWN"),
        lastSyncAt:
          lastSyncAt && !Number.isNaN(lastSyncAt.getTime()) ? lastSyncAt.toISOString() : null,
      };
    },

    depositEvents(fromBlock: number, toBlock: number): Promise<SourceRead<DepositEventRow>> {
      // An inverted range selects nothing, which the indexer legitimately
      // produces before it has read a first block. That is a read, not a failure.
      if (toBlock < fromBlock) return Promise.resolve(sourceRead<DepositEventRow>([]));
      return attemptRead(async () =>
        rowsOfResult(
          await db.execute(sql`
            SELECT tx_hash, log_index, block_number, event_name, contract_address, args_json, created_at
            FROM onchain_events
            WHERE event_name = ${USDC_DEPOSIT_EVENT}
              AND block_number >= ${fromBlock} AND block_number <= ${toBlock}
            ORDER BY block_number ASC, log_index ASC
          `)
        ).map(
          (row: any): DepositEventRow => ({
            eventName: String(row.event_name),
            txHash: String(row.tx_hash),
            logIndex: Number(row.log_index ?? 0),
            blockNumber: Number(row.block_number),
            // The mirror keeps no block hash. `null` says so; it is never filled
            // in from the block number.
            blockHash: null,
            contractAddress: String(row.contract_address ?? ""),
            argsJson: String(row.args_json ?? ""),
            createdAt: row.created_at ?? null,
          })
        )
      );
    },

    async ledgerDeposits(): Promise<LedgerDepositRead> {
      let nativeIdentityAvailable = false;
      try {
        nativeIdentityAvailable = await hasNativeDepositColumns(db);
      } catch (error: any) {
        return {
          nativeIdentityAvailable: false,
          read: sourceMissing<LedgerDepositRow>(
            `Skema ledger tidak dapat diperiksa: ${String(error?.message ?? error)}.`
          ),
        };
      }

      const native = nativeIdentityAvailable
        ? sql`, amount_usdc_6dp, deposit_chain_id, deposit_contract, deposit_tx_hash, deposit_log_index`
        : sql``;

      const read = await attemptRead(async () =>
        rowsOfResult(
          await db.execute(sql`
            SELECT trx_id, amount_idr, created_at${native}
            FROM donations WHERE payment_method = 'USDC' ORDER BY id ASC
          `)
        ).map(
          (row: any): LedgerDepositRow => ({
            trxId: String(row.trx_id),
            amountIDR: row.amount_idr ?? null,
            createdAt: row.created_at ?? null,
            ...(nativeIdentityAvailable
              ? {
                  // Left exactly as stored. Whether a value is a readable amount
                  // is the pure mapper's judgement, not a driver's.
                  amountUsdc: row.amount_usdc_6dp ?? null,
                  depositChainId: row.deposit_chain_id ?? null,
                  depositContract: row.deposit_contract ?? null,
                  depositTxHash: row.deposit_tx_hash ?? null,
                  depositLogIndex: row.deposit_log_index ?? null,
                }
              : {}),
          })
        )
      );

      return { nativeIdentityAvailable, read };
    },
  };
}

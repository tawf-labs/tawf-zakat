import { sql } from "drizzle-orm";
import { keccak256, toHex, type Hex } from "viem";
import type { EvidenceDatabase } from "./evidence-store";

export type RegistryBudgetConfig = { maxWei: bigint; gasLimit: bigint; maxFeePerGas: bigint };
export type RegistryBudgetTransaction = { chainId: number; to: Hex; sender: Hex; nonce: number; data: Hex; gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; value: bigint };
export interface RegistryBudget {
  reserve(transaction: RegistryBudgetTransaction): Promise<void>;
  signed(transaction: RegistryBudgetTransaction, sign: () => Promise<Hex>): Promise<Hex>;
  authorize(transaction: RegistryBudgetTransaction, raw: Hex): Promise<void>;
}
const rows = (result: any): any[] => result.rows ?? result;
const failure = () => new Error("Anggaran relay REPORT tidak tersedia atau transaksi tidak diizinkan.");
export function validateRegistryBudget(config: RegistryBudgetConfig) {
  const max = (1n << 256n) - 1n;
  if ([config.maxWei, config.gasLimit, config.maxFeePerGas].some(n => typeof n !== "bigint" || n <= 0n || n > max)
    || config.gasLimit * config.maxFeePerGas > config.maxWei) throw failure();
}
/** Schema-only bootstrap: does not configure or initialize an allowance. */
export async function ensureRegistryBudgetSchema(db: EvidenceDatabase): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS registry_budget (id INTEGER PRIMARY KEY CHECK(id=1), deployment TEXT NOT NULL, ceiling NUMERIC(78,0) NOT NULL, reserved NUMERIC(78,0) NOT NULL)`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS registry_budget_reservations (identity TEXT PRIMARY KEY, nonce BIGINT NOT NULL UNIQUE, raw TEXT)`);
  await db.execute(sql`ALTER TABLE registry_budget_reservations ADD COLUMN IF NOT EXISTS raw TEXT`);
}
/** One immutable allowance per database, not per environment-selected identifier. Never refunded. */
export function createRegistryBudgetStore(db: EvidenceDatabase, config: RegistryBudgetConfig, deployment: string): RegistryBudget & { ensureSchema(): Promise<void> } {
  validateRegistryBudget(config);
  function identity(t: RegistryBudgetTransaction) {
    if (`${t.chainId}:${t.to.toLowerCase()}:${t.sender.toLowerCase()}` !== deployment.toLowerCase()
      || !Number.isSafeInteger(t.nonce) || t.nonce < 0 || t.value !== 0n || t.gas !== config.gasLimit
      || t.maxFeePerGas !== config.maxFeePerGas || t.maxPriorityFeePerGas !== 0n) throw failure();
    return keccak256(toHex(JSON.stringify([t.chainId, t.to.toLowerCase(), t.sender.toLowerCase(), t.nonce,
      t.data.toLowerCase(), t.gas.toString(), t.maxFeePerGas.toString(), "0", "0"])));
  }
  return {
    ensureSchema: () => ensureRegistryBudgetSchema(db),
    async reserve(t) {
      const key = identity(t), cost = t.gas * t.maxFeePerGas;
      await db.transaction(async tx => {
        await tx.execute(sql`INSERT INTO registry_budget(id,deployment,ceiling,reserved) VALUES(1,${deployment.toLowerCase()},${config.maxWei.toString()},0) ON CONFLICT DO NOTHING`);
        const row = rows(await tx.execute(sql`SELECT * FROM registry_budget WHERE id=1 FOR UPDATE`))[0];
        if (row.deployment !== deployment.toLowerCase() || BigInt(row.ceiling) !== config.maxWei) throw failure();
        if (rows(await tx.execute(sql`SELECT identity FROM registry_budget_reservations WHERE identity=${key}`)).length) return;
        if (BigInt(row.reserved) + cost > BigInt(row.ceiling)
          || rows(await tx.execute(sql`SELECT identity FROM registry_budget_reservations WHERE nonce=${t.nonce}`)).length) throw failure();
        await tx.execute(sql`INSERT INTO registry_budget_reservations(identity,nonce) VALUES(${key},${t.nonce})`);
        await tx.execute(sql`UPDATE registry_budget SET reserved=reserved+${cost.toString()} WHERE id=1`);
      });
    },
    async signed(t, sign) {
      const key = identity(t);
      // This transaction begins only AFTER reserve committed. A signing/storage
      // failure cannot roll the liability back. Concurrent workers reuse the bytes.
      return db.transaction(async tx => {
        const row = rows(await tx.execute(sql`SELECT raw FROM registry_budget_reservations WHERE identity=${key} FOR UPDATE`))[0];
        if (!row) throw failure();
        if (row.raw) return row.raw as Hex;
        const raw = await sign();
        await tx.execute(sql`UPDATE registry_budget_reservations SET raw=${raw} WHERE identity=${key}`);
        return raw;
      });
    },
    async authorize(t, raw) {
      const key = identity(t);
      if (typeof raw !== "string" || !/^0x[0-9a-fA-F]+$/.test(raw)) throw failure();
      const row = rows(await db.execute(sql`SELECT r.identity FROM registry_budget_reservations r JOIN registry_budget b ON b.id=1
        WHERE r.identity=${key} AND r.raw=${raw} AND b.deployment=${deployment.toLowerCase()} AND b.ceiling=${config.maxWei.toString()}`))[0];
      if (!row) throw failure();
    },
  };
}

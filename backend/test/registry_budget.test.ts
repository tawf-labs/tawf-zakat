import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { createRegistryBudgetStore, type RegistryBudgetTransaction } from "../src/registry-budget";
import { createRegistryStore } from "../src/registry-store";
import { createRegistryChain } from "../src/registry-chain";
import { createRelay } from "../src/registry-relay";
import { encodeFunctionResult, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { reportRegistryAbi } from "../../shared/report-registry-abi";
import type { RecordingIntent } from "../../shared/report-registry";

const to = `0x${"1".repeat(40)}` as const, sender = `0x${"2".repeat(40)}` as const;
const deployment = `421614:${to}:${sender}`;
const config = { maxWei: 200n, gasLimit: 10n, maxFeePerGas: 10n };
const transaction = (nonce = 0): RegistryBudgetTransaction => ({ chainId: 421614, to, sender, nonce, data: "0x1234", gas: 10n, maxFeePerGas: 10n, maxPriorityFeePerGas: 0n, value: 0n });

test("SQL reservations survive restart; exact retry is free, changes and ceiling resets are denied", async () => {
  let pg = new PGlite();
  let db = drizzle(pg);
  let budget = createRegistryBudgetStore(db, config, deployment);
  await budget.ensureSchema();
  await budget.reserve(transaction());
  await expect(budget.authorize(transaction(), "0x1234")).rejects.toThrow("Anggaran");
  await budget.signed(transaction(), async () => "0x1234");
  await expect(budget.authorize(transaction(), "0xabcd")).rejects.toThrow("Anggaran");
  await budget.reserve(transaction());
  await expect(budget.reserve({ ...transaction(), data: "0xabcd" })).rejects.toThrow("Anggaran");
  await expect(budget.authorize(transaction(1), "0x1234")).rejects.toThrow("Anggaran");
  await expect(budget.reserve({ ...transaction(1), chainId: 1 })).rejects.toThrow("Anggaran");
  await expect(budget.reserve({ ...transaction(1), value: 1n })).rejects.toThrow("Anggaran");
  const snapshot = await pg.dumpDataDir();
  await pg.close();
  pg = new PGlite({ loadDataDir: snapshot });
  db = drizzle(pg);
  budget = createRegistryBudgetStore(db, config, deployment);
  await budget.ensureSchema();
  await budget.authorize(transaction(), "0x1234");
  expect(await budget.signed(transaction(), async () => { throw new Error("must reuse persisted signed bytes"); })).toBe("0x1234");
  await budget.reserve(transaction());
  await budget.reserve(transaction(1));
  await expect(budget.reserve(transaction(2))).rejects.toThrow("Anggaran");
  await expect(createRegistryBudgetStore(db, { ...config, maxWei: 300n }, deployment).reserve(transaction(2))).rejects.toThrow("Anggaran");
  await expect(createRegistryBudgetStore(db, config, `1:${to}:${sender}`).reserve({ ...transaction(), chainId: 1 })).rejects.toThrow("Anggaran");
  const result = await db.execute(sql`SELECT reserved FROM registry_budget`);
  expect(result.rows[0]!.reserved).toBe("200");
  await pg.close();
}, 15000);

test("concurrent SQL requests cannot overspend the singleton allowance", async () => {
  const pg = new PGlite(), db = drizzle(pg);
  const budget = createRegistryBudgetStore(db, config, deployment);
  await budget.ensureSchema();
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => budget.reserve(transaction(i))));
  expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(2);
  expect((await db.execute(sql`SELECT reserved FROM registry_budget`)).rows[0]!.reserved).toBe("200");
  await pg.close();
}, 15000);

test("intent nonce commit permits budget transaction on same PGlite connection; crash retry/concurrent retry reuse it", async () => {
  const pg = new PGlite(), db = drizzle(pg);
  // Minimal surrounding schema: this test exercises the production reserve method, not a map fake.
  for (const statement of [
    "CREATE TABLE registry_relayer_nonces(deployment TEXT PRIMARY KEY,next_nonce BIGINT NOT NULL)",
    "CREATE TABLE registry_nonce_allocations(institution_id TEXT,intent_id TEXT,deployment TEXT,nonce BIGINT,PRIMARY KEY(institution_id,intent_id),UNIQUE(deployment,nonce))",
    "CREATE TABLE registry_attempts(institution_id TEXT,intent_id TEXT,raw TEXT,hash TEXT,signature TEXT,nonce BIGINT,PRIMARY KEY(institution_id,intent_id))",
  ]) await db.execute(sql.raw(statement));
  const budget = createRegistryBudgetStore(db, config, deployment), store = createRegistryStore(db);
  await budget.ensureSchema();
  await expect(store.reserve("i", "a", deployment, 0, async nonce => {
    await budget.reserve(transaction(nonce));
    throw new Error("crash after committed reservation before signing");
  })).rejects.toThrow("crash");
  let otherBuilds = 0;
  await expect(store.reserve("i", "b", deployment, 0, async nonce => {
    otherBuilds++;
    return { nonce, raw: "0x12", hash: "0x34", signature: "0x56" };
  })).rejects.toThrow("Alokasi nonce");
  expect(otherBuilds).toBe(0);
  let signatures = 0;
  const build = async (nonce: number) => {
    await budget.reserve(transaction(nonce));
    const raw = await budget.signed(transaction(nonce), async () => { signatures++; return "0x12"; });
    return { nonce, raw, hash: "0x34" as const, signature: "0x56" as const };
  };
  const results = await Promise.all([store.reserve("i", "a", deployment, 99, build), store.reserve("i", "a", deployment, 99, build)]);
  expect(results.map(r => Number(r.nonce))).toEqual([0, 0]);
  expect(signatures).toBe(1);
  expect((await db.execute(sql`SELECT reserved FROM registry_budget`)).rows[0]!.reserved).toBe("100");
  expect((await db.execute(sql`SELECT * FROM registry_attempts`)).rows).toHaveLength(1);
  // Another intent cannot leapfrog an allocation while its owner is actively building.
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const second = store.reserve("i", "b", deployment, 0, async nonce => { entered(); await hold; return build(nonce); });
  await started;
  try {
    await expect(store.reserve("i", "c", deployment, 0, build)).rejects.toThrow("Alokasi nonce");
  } finally { release(); }
  expect(Number((await second).nonce)).toBe(1);
  expect((await db.execute(sql`SELECT reserved FROM registry_budget`)).rows[0]!.reserved).toBe("200");
  await pg.close();
}, 15000);

test("builder uses RPC total gas, commits before signing, and refuses unreserved bytes and wrong chain", async () => {
  const pg = new PGlite(), db = drizzle(pg);
  const privateKey = `0x${"0".repeat(63)}1` as Hex, account = privateKeyToAccount(privateKey);
  const budget = createRegistryBudgetStore(db, config, `421614:${to}:${account.address.toLowerCase()}`);
  await budget.ensureSchema();
  let chainId = 421614, estimate = 11n, sends = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as any;
    let result: unknown;
    if (body.method === "eth_chainId") result = `0x${chainId.toString(16)}`;
    else if (body.method === "eth_call") result = encodeFunctionResult({ abi: reportRegistryAbi, functionName: "eip712Domain",
      result: ["0x0f", "Tawf Report Evidence", "1", 421614n, to, `0x${"0".repeat(64)}`, []] });
    else if (body.method === "eth_estimateGas") result = `0x${estimate.toString(16)}`;
    else if (body.method === "eth_sendRawTransaction") { sends++; result = keccak256(body.params[0]); }
    else throw new Error(`Unexpected local mock RPC: ${body.method}`);
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  } });
  try {
    const chain = createRegistryChain({ rpcUrl: String(server.url), chainId: 421614, address: to, privateKey, requiredConfirmations: 1, budgetConfig: config, budget });
    const hash = `0x${"0".repeat(64)}` as Hex;
    const intent: RecordingIntent = { id: "a", domain: chain.domain, authorizationDigest: hash, accountKind: "EOA",
      authorization: { action: hash, institutionId: "i", reportId: "r", version: "1", packageId: "p", predecessor: "", digest: hash,
        policy: "p", outcome: "o", signer: account.address, authorityEpoch: "1", nonce: hash, deadline: "9999999999" },
      observation: { state: "PREPARED", confirmations: 0, requiredConfirmations: 1, confirmationPolicy: "test" } };
    let allocations = 0;
    const store = { ...createRegistryStore(db), attempt: async () => null, reserve: async () => { allocations++; throw new Error("unexpected allocation"); } };
    const relay = createRelay(store, chain, "i", message => new Error(message));
    await expect(relay.send(intent, "0x12")).rejects.toThrow("Estimasi gas");
    const disabled = createRegistryChain({ rpcUrl: String(server.url), chainId: 421614, address: to, privateKey, requiredConfirmations: 1 });
    await expect(createRelay(store, disabled, "i", message => new Error(message)).send(intent, "0x12")).rejects.toThrow("anggaran eksplisit");
    expect(allocations).toBe(0);
    await expect(chain.build(intent, "0x12", 0)).rejects.toThrow("Estimasi gas");
    expect((await db.execute(sql`SELECT * FROM registry_budget_reservations`)).rows).toHaveLength(0);
    estimate = 10n;
    const attempt = await chain.build(intent, "0x12", 0);
    expect((await chain.build(intent, "0x12", 0)).raw).toBe(attempt.raw);
    expect((await db.execute(sql`SELECT reserved FROM registry_budget`)).rows[0]!.reserved).toBe("100");
    await chain.broadcast(attempt);
    expect(sends).toBe(1);
    const raw = await account.signTransaction({ chainId: 421614, to, nonce: 1, gas: 10n, maxFeePerGas: 10n, maxPriorityFeePerGas: 0n, value: 0n, type: "eip1559" });
    await expect(chain.broadcast({ raw, hash: keccak256(raw), nonce: 1, signature: "0x12" })).rejects.toThrow("Anggaran");
    const reservedOnly = { ...transaction(1), sender: account.address, data: "0x" as Hex };
    await budget.reserve(reservedOnly);
    await expect(chain.broadcast({ raw, hash: keccak256(raw), nonce: 1, signature: "0x12" })).rejects.toThrow("Anggaran");
    await budget.signed(reservedOnly, async () => "0xabcd");
    await expect(chain.broadcast({ raw, hash: keccak256(raw), nonce: 1, signature: "0x12" })).rejects.toThrow("Anggaran");
    expect(sends).toBe(1);
    chainId = 1;
    await expect(chain.build(intent, "0x12", 1)).rejects.toThrow("Chain registry");
    expect(sends).toBe(1);
  } finally { server.stop(true); await pg.close(); }
}, 15000);

test("missing budget fails closed before RPC even for an existing signed attempt", async () => {
  const chain = createRegistryChain({ chainId: 421614, rpcUrl: "http://127.0.0.1:1", address: to,
    privateKey: `0x${"0".repeat(63)}1`, requiredConfirmations: 1 });
  await expect(chain.broadcast({ raw: "0x12", hash: "0x34", signature: "0x56", nonce: 0 })).rejects.toThrow("anggaran eksplisit");
});

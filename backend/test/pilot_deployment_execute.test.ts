import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile, stat, symlink, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeFunctionData, getContractAddress, keccak256, parseAbi, parseTransaction, TransactionReceiptNotFoundError, type Address, type Hex } from "viem";
import { CONTRACTS, parsePilotInput, type PilotArtifacts } from "../src/scripts/pilot-deployment-plan";
import { executePilot, openExecutionJournal, runPilotExecutor, MAX_FEE, type ExecutionBundle, type ExecutionJournal } from "../src/scripts/pilot-deployment-execute";

// Random, unfunded test-only accounts. Never access process.env or any external RPC.
function fixture() {
  const account = privateKeyToAccount(generatePrivateKey());
  const signer = privateKeyToAccount(generatePrivateKey()).address;
  const auditor = privateKeyToAccount(generatePrivateKey()).address;
  const admin = account.address;
  const input = parsePilotInput({ chainId: 421614, syntheticOnly: true, institutionId: "SYNTHETIC-EXECUTOR-TEST", budgetWei: "5000000000000000",
    roles: { deployer: admin, admission: admin, administrator: admin, relayer: admin, reportSignatory: signer, validator: admin, zkSigner: admin, custodian: admin, browserOfficer: admin, browserApprover: signer },
    auditor: { address: auditor, mandate: "SYNTHETIC-ONLY" } });
  const common = parseAbi([
    "function enrollInstitution(string institutionId,address admin)", "function setSignatory(string institutionId,address signer,bool active)",
    "function setValidator(address validator,bool active)", "function setSigner(string institutionId,address signer,bool active)",
    "function setCustodian(string institutionId,address custodian)", "function setAuditor(string institutionId,address auditor,bool active,string mandate)",
    "function admissionAuthority() view returns (address)", "function validatorOperator() view returns (address)",
    "function verifier() view returns (address)", "function registry() view returns (address)",
    "function administrators(bytes32 key) view returns (address)", "function administratorEpochs(bytes32 key) view returns (uint256)",
    "function signatories(bytes32 key,address signer) view returns (bool,uint256)", "function validators(address validator) view returns (bool,uint256)",
    "function authorizedSigners(bytes32 key,address signer) view returns (bool)", "function custodianOf(bytes32 key) view returns (address)",
    "function custodyEpochs(bytes32 key) view returns (uint256)", "function auditors(bytes32 key,address auditor) view returns (bool,uint256)",
    "function auditorMandate(string institutionId,address auditor) view returns (string)",
  ]);
  const artifacts = Object.fromEntries(CONTRACTS.map(c => [c.name, {
    source: c.source, abi: [...common, ...(c.constructorTypes.length ? [{ type: "constructor", inputs: c.constructorTypes.map(type => ({ type })), stateMutability: "nonpayable" }] : [])],
    bytecode: "0x6000", bytecodeHash: keccak256("0x6000"),
  }])) as unknown as PilotArtifacts;
  const bundle: ExecutionBundle = { input, artifacts, verifierRuntime: "0x6001", fileHashes: {} };
  const journal: ExecutionJournal = { signed: [], async append(e) { if (e.kind === "header") this.header = e; else this.signed.push(e); } };
  const addresses = CONTRACTS.map((_, i) => getContractAddress({ from: admin, nonce: BigInt(i) }));
  let latest = 0, pending = 0, chain = 421614, gas = 100_000n;
  let failSend = false, failReceipt = false, badCanonical = false, badReadback = false, badVerifier = false, lowConfirmations = false;
  const sent: Hex[] = [], estimates: number[] = [];
  const receipts = new Map<Hex, any>();
  const blockHash = `0x${"ab".repeat(32)}` as Hex;
  const rpc = {
    getChainId: async () => chain,
    getTransactionCount: async ({ blockTag }: any) => blockTag === "pending" ? pending : latest,
    getCode: async ({ address }: { address: Address; blockNumber?: bigint }) => {
      const i = addresses.findIndex(a => a.toLowerCase() === address.toLowerCase());
      if (i >= 0 && latest > i) return i === 1 ? (badVerifier ? "0x6002" : "0x6001") : "0x6000";
      return "0x";
    },
    getBalance: async () => 10n ** 18n,
    getGasPrice: async () => MAX_FEE,
    estimateGas: async () => { estimates.push(latest); return gas; },
    getTransactionReceipt: async ({ hash }: any) => { if (!receipts.has(hash)) throw new TransactionReceiptNotFoundError({ hash }); return receipts.get(hash); },
    getTransaction: async ({ hash }: any) => ({ hash, nonce: latest, from: admin, blockNumber: null }),
    getBlock: async (_args?: { blockNumber?: bigint }) => ({ hash: badCanonical ? "0x00" : blockHash }),
    getBlockNumber: async () => lowConfirmations ? BigInt(latest) : 100n,
    waitForTransactionReceipt: async ({ hash, confirmations }: any) => { expect(confirmations).toBe(2); if (lowConfirmations) throw new Error("mock timeout"); return receipts.get(hash); },
    sendRawTransaction: async ({ serializedTransaction }: any) => {
      // The durable signed event must exist before the broadcaster gets any bytes.
      expect(journal.signed.at(-1)?.raw).toBe(serializedTransaction);
      sent.push(serializedTransaction);
      if (failSend) { failSend = false; throw new Error("mock transport disconnected after persistence"); }
      const tx = parseTransaction(serializedTransaction);
      expect(tx.nonce).toBe(latest);
      expect(tx.value ?? 0n).toBe(0n);
      expect(tx.maxFeePerGas).toBe(MAX_FEE);
      const hash = keccak256(serializedTransaction);
      receipts.set(hash, { transactionHash: hash, status: failReceipt ? "reverted" : "success", from: admin,
        to: tx.to ?? null, contractAddress: latest < 4 ? addresses[latest] : null,
        blockNumber: BigInt(latest + 1), blockHash, gasUsed: 90_000n, effectiveGasPrice: MAX_FEE });
      latest++; pending = latest;
      return hash;
    },
    readContract: async ({ functionName }: any) => {
      if (badReadback) return false;
      switch (functionName) {
        case "verifier": return addresses[1];
        case "registry": return addresses[0];
        case "signatories": case "validators": case "auditors": return [true, 1n];
        case "administratorEpochs": case "custodyEpochs": return 1n;
        case "authorizedSigners": return true;
        case "auditorMandate": return input.auditor!.mandate;
        default: return admin;
      }
    },
  };
  return { bundle, account, journal, rpc, sent, estimates, receipts,
    execute: () => executePilot(bundle, account, rpc as any, journal),
    chain: (v: number) => { chain = v; }, nonce: (v: number) => { latest = v; pending = v; }, pending: (v: number) => { pending = v; },
    gas: (v: bigint) => { gas = v; }, failSend: () => { failSend = true; }, failReceipt: () => { failReceipt = true; },
    badCanonical: () => { badCanonical = true; }, badReadback: () => { badReadback = true; }, badVerifier: () => { badVerifier = true; }, lowConfirmations: () => { lowConfirmations = true; },
  };
}

/** In-memory, unfunded test journal only; never opens an actual execution journal. */
async function tenConfirmedWithPrunedHistory() {
  const f = fixture();
  const estimateGas = f.rpc.estimateGas;
  f.rpc.estimateGas = async () => {
    if (f.estimates.length === 10) throw new Error("mock interrupted before auditor signing");
    return estimateGas();
  };
  await expect(f.execute()).rejects.toThrow("mock interrupted before auditor signing");
  expect(f.journal.signed).toHaveLength(10);
  expect(f.receipts.size).toBe(10);
  f.rpc.estimateGas = estimateGas;
  const stateBlocks: bigint[] = [];
  const getCode = f.rpc.getCode, readContract = f.rpc.readContract;
  const checkState = (blockNumber?: bigint) => {
    if (blockNumber !== undefined) {
      stateBlocks.push(blockNumber);
      if (blockNumber < 90n) throw new Error("mock historical state not available");
    }
  };
  f.rpc.getCode = async args => { checkState(args.blockNumber); return getCode(args); };
  f.rpc.readContract = async args => { checkState(args.blockNumber); return readContract(args); };
  return { f, stateBlocks };
}

test("pruned receipt-block state resumes ten confirmed steps and signs only the remaining auditor action", async () => {
  const { f, stateBlocks } = await tenConfirmedWithPrunedHistory();
  const binding = f.journal.header!.binding;
  const existingHashes = f.journal.signed.map(e => e.hash);
  const result = await f.execute();
  expect(result.status).toBe("confirmed-and-readback-verified");
  expect(result.operationalApproval).toBe(false);
  expect(f.journal.header!.binding).toBe(binding);
  expect(f.journal.signed.slice(0, 10).map(e => e.hash)).toEqual(existingHashes);
  expect(f.sent).toHaveLength(11);
  expect(f.estimates).toEqual(Array.from({ length: 11 }, (_, i) => i));
  const last = parseTransaction(f.journal.signed[10].raw);
  const call = decodeFunctionData({ abi: f.bundle.artifacts.ReportEvidenceRegistry.abi, data: last.data! });
  expect(call.functionName).toBe("setAuditor");
  expect(last.nonce).toBe(10);
  expect(stateBlocks.length).toBeGreaterThan(20);
  expect(stateBlocks.every(block => block === 99n)).toBe(true);
  expect(await f.execute()).toEqual(result);
  expect(f.sent).toHaveLength(11);
});

test("pruned-history resume still rejects a mismatched current role before any new signature", async () => {
  const { f } = await tenConfirmedWithPrunedHistory();
  const readContract = f.rpc.readContract;
  f.rpc.readContract = async args => args.functionName === "signatories" ? [true, 2n] : readContract(args);
  await expect(f.execute()).rejects.toThrow("Contract readback mismatch");
  expect(f.journal.signed).toHaveLength(10);
  expect(f.sent).toHaveLength(10);
});

test("pruned-history resume rejects a reorg during pinned recent-state readback", async () => {
  const { f } = await tenConfirmedWithPrunedHistory();
  const getBlock = f.rpc.getBlock;
  let recentBlockReads = 0;
  f.rpc.getBlock = async args => {
    if (args?.blockNumber === 99n && ++recentBlockReads > 1) return { hash: `0x${"cd".repeat(32)}` };
    return getBlock(args);
  };
  await expect(f.execute()).rejects.toThrow("Readback block changed");
  expect(f.journal.signed).toHaveLength(10);
  expect(f.sent).toHaveLength(10);
});

test("pruned recent state fails closed rather than skipping readback", async () => {
  const { f } = await tenConfirmedWithPrunedHistory();
  const getCode = f.rpc.getCode;
  f.rpc.getCode = async args => {
    if (args.blockNumber !== undefined) throw new Error("mock recent state not available");
    return getCode(args);
  };
  await expect(f.execute()).rejects.toThrow("mock recent state not available");
  expect(f.journal.signed).toHaveLength(10);
  expect(f.sent).toHaveLength(10);
});

test("default plan-only and incomplete broadcast fail before key/network access", async () => {
  expect(await runPilotExecutor([])).toMatchObject({ mode: "plan-only", broadcastEnabled: false });
  await expect(runPilotExecutor(["--broadcast"])).rejects.toThrow("explicit");
  await expect(runPilotExecutor(["--rpc", "https://never-contact.invalid"])).rejects.toThrow("Plan mode");
});

test("all eleven sequential transactions, canonical receipts/readback, no duplicate setters on resume", async () => {
  const f = fixture();
  const result = await f.execute();
  expect(result.status).toBe("confirmed-and-readback-verified");
  expect(result.operationalApproval).toBe(false);
  expect(f.sent).toHaveLength(11);
  expect(f.estimates).toEqual(Array.from({ length: 11 }, (_, i) => i));
  expect(BigInt(result.remainingAggregateWei)).toBeGreaterThanOrEqual(1_000_000_000_000_000n);
  expect(await f.execute()).toEqual(result);
  expect(f.sent).toHaveLength(11);
});

test("transport failure resumes exact persisted bytes, not a new nonce/signature", async () => {
  const f = fixture(); f.failSend();
  await expect(f.execute()).rejects.toThrow("transport");
  expect(f.journal.signed).toHaveLength(1);
  const raw = f.journal.signed[0].raw;
  expect((await f.execute()).status).toBe("confirmed-and-readback-verified");
  expect(f.sent[0]).toBe(raw); expect(f.sent[1]).toBe(raw);
  expect(f.journal.signed).toHaveLength(11);
});

test("persist failure cannot broadcast", async () => {
  const f = fixture(); const append = f.journal.append.bind(f.journal);
  f.journal.append = async e => { if (e.kind === "signed") throw new Error("disk full"); await append(e); };
  await expect(f.execute()).rejects.toThrow("disk full");
  expect(f.sent).toHaveLength(0);
});

test("wrong chain, wrong account, bad artifact, and fee/budget failures stop before broadcast", async () => {
  const wrongChain = fixture(); wrongChain.chain(1);
  await expect(wrongChain.execute()).rejects.toThrow("chain mismatch"); expect(wrongChain.sent).toHaveLength(0);
  const wrongKey = fixture();
  await expect(executePilot(wrongKey.bundle, privateKeyToAccount(generatePrivateKey()), wrongKey.rpc as any, wrongKey.journal)).rejects.toThrow("PRIVATE_KEY address");
  const artifact = fixture(); artifact.bundle.artifacts.Groth16Verifier.bytecode = "0x6002";
  await expect(artifact.execute()).rejects.toThrow("Artifact"); expect(artifact.sent).toHaveLength(0);
  const budget = fixture(); budget.gas(16_000_001n);
  await expect(budget.execute()).rejects.toThrow("budget exceeded"); expect(budget.journal.signed).toHaveLength(0);
  const fee = fixture(); fee.rpc.getGasPrice = async () => MAX_FEE + 1n;
  await expect(fee.execute()).rejects.toThrow("fee ceiling"); expect(fee.sent).toHaveLength(0);
  const low = fixture(); low.bundle.input.budgetWei = "1000000000000000";
  await expect(low.execute()).rejects.toThrow("budget exceeded"); expect(low.sent).toHaveLength(0);
});

test("cumulative reservations reject next signing even though each transaction fits", async () => {
  const f = fixture(); f.gas(9_000_000n);
  await expect(f.execute()).rejects.toThrow("budget exceeded");
  expect(f.sent).toHaveLength(1); expect(f.journal.signed).toHaveLength(1);
});

test("immutable input/artifacts and nonce mismatches block resume", async () => {
  for (const change of ["input", "artifact", "nonce"] as const) {
    const f = fixture(); f.failSend(); await expect(f.execute()).rejects.toThrow();
    if (change === "input") f.bundle.input.institutionId += "-changed";
    if (change === "artifact") f.bundle.fileHashes.changed = keccak256("0x6000");
    if (change === "nonce") f.nonce(1);
    await expect(f.execute()).rejects.toThrow(change === "nonce" ? "Nonce mismatch" : "binding mismatch");
    expect(f.sent).toHaveLength(1);
  }
});

test("failure receipts, noncanonical blocks, readback, verifier pin, and insufficient confirmations never succeed", async () => {
  for (const kind of ["failReceipt", "badCanonical", "badReadback", "badVerifier", "lowConfirmations"] as const) {
    const f = fixture(); f[kind]();
    await expect(f.execute()).rejects.toThrow();
    expect(f.sent.length).toBeLessThanOrEqual(2);
    const count = f.sent.length;
    await expect(f.execute()).rejects.toThrow();
    expect(f.sent).toHaveLength(count); // Never retry a failed mined transaction with a new nonce.
  }
});

test("auditor mandate readback rejects a case-only mismatch without replaying its setter", async () => {
  const f = fixture();
  const readContract = f.rpc.readContract;
  f.rpc.readContract = async args => args.functionName === "auditorMandate"
    ? f.bundle.input.auditor!.mandate.toLowerCase()
    : readContract(args);
  await expect(f.execute()).rejects.toThrow("Contract readback mismatch");
  expect(f.sent).toHaveLength(11);
  await expect(f.execute()).rejects.toThrow("Contract readback mismatch");
  expect(f.sent).toHaveLength(11);
});

test("chain is revalidated after persistence immediately before broadcasting", async () => {
  const f = fixture(); const append = f.journal.append.bind(f.journal);
  f.journal.append = async e => { await append(e); if (e.kind === "signed") f.chain(1); };
  await expect(f.execute()).rejects.toThrow("chain mismatch");
  expect(f.sent).toHaveLength(0); expect(f.journal.signed).toHaveLength(1);
});

test("secure disk journal preserves signed bytes, refuses concurrent writer, symlink and public permissions", async () => {
  const workspace = resolve(import.meta.dir, "../..");
  await mkdir(resolve(workspace, ".scratch"), { recursive: true });
  const dir = await mkdtemp(resolve(workspace, ".scratch/pilot-executor-test-"));
  // mkdtemp is 0700; this test-only ignore file keeps unfunded test signatures out of git.
  await writeFile(resolve(dir, ".gitignore"), "*\n", { mode: 0o600 });
  const path = resolve(dir, "journal.jsonl");
  const j = await openExecutionJournal(path);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect((await stat(dir)).mode & 0o777).toBe(0o700);
  await expect(openExecutionJournal(path)).rejects.toThrow();
  const f = fixture();
  await j.append({ kind: "header", version: 1, binding: keccak256("0x6000"), baseNonce: 0 });
  await j.append({ kind: "signed", index: 0, raw: "0x02", hash: keccak256("0x02") });
  await j.close();
  const resumed = await openExecutionJournal(path);
  expect(resumed.signed[0].raw).toBe("0x02"); await resumed.close();
  const link = resolve(dir, "link.jsonl"); await symlink(path, link);
  await expect(openExecutionJournal(link)).rejects.toThrow();
  const publicFile = resolve(dir, "public.jsonl"); await writeFile(publicFile, "", { mode: 0o644 });
  await expect(openExecutionJournal(publicFile)).rejects.toThrow("0600");
  await writeFile(resolve(dir, "torn.jsonl"), "{", { mode: 0o600 });
  await expect(openExecutionJournal(resolve(dir, "torn.jsonl"))).rejects.toThrow("Torn journal");
  expect(await readFile(path, "utf8")).toContain("header");
  expect(f.sent).toHaveLength(0);

  const actualPath = resolve(dir, "actual-resume.jsonl");
  const actual = await openExecutionJournal(actualPath);
  f.journal.signed = actual.signed;
  f.failSend();
  await expect(executePilot(f.bundle, f.account, f.rpc as any, actual)).rejects.toThrow("transport");
  const raw = actual.signed[0].raw;
  await actual.close();
  const reopened = await openExecutionJournal(actualPath);
  f.journal.signed = reopened.signed;
  const result = await executePilot(f.bundle, f.account, f.rpc as any, reopened);
  expect(result.status).toBe("confirmed-and-readback-verified");
  expect(f.sent[1]).toBe(raw);
  await reopened.close();
});

test("signed journal tampering cannot send; pending nonce cannot be stolen by another transaction", async () => {
  const f = fixture(); f.failSend(); await expect(f.execute()).rejects.toThrow("transport");
  f.journal.signed[0].hash = keccak256("0x01");
  await expect(f.execute()).rejects.toThrow("signed transaction mismatch");
  expect(f.sent).toHaveLength(1);
  const pending = fixture(); pending.failSend(); await expect(pending.execute()).rejects.toThrow("transport");
  pending.pending(1);
  pending.rpc.getTransaction = async () => { throw new Error("original hash not found"); };
  await expect(pending.execute()).rejects.toThrow("original hash not found");
  expect(pending.sent).toHaveLength(1);
});

test("insufficient sender balance and unresolved pending nonce fail without signing", async () => {
  const poor = fixture(); poor.rpc.getBalance = async () => 0n;
  await expect(poor.execute()).rejects.toThrow("balance"); expect(poor.journal.signed).toHaveLength(0);
  const pending = fixture(); pending.pending(1);
  await expect(pending.execute()).rejects.toThrow("pending transactions"); expect(pending.journal.signed).toHaveLength(0);
});

test("CLI diagnostics never echo endpoint credentials or underlying exceptions", async () => {
  const secretMarker = "NEVER_ECHO_RPC_TOKEN";
  const process = Bun.spawn(["bun", "--no-env-file", "src/scripts/pilot-deployment-execute.ts", "--broadcast", "--rpc", `https://${secretMarker}.invalid`], {
    cwd: resolve(import.meta.dir, ".."), env: { PATH: Bun.env.PATH ?? "", NODE_ENV: "test" }, stdout: "pipe", stderr: "pipe",
  });
  const output = await new Response(process.stdout).text() + await new Response(process.stderr).text();
  expect(await process.exited).toBe(1);
  expect(output).toContain("requires explicit");
  expect(output).not.toContain(secretMarker);
});

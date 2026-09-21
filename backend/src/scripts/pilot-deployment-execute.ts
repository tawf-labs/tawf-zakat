/** Synthetic-only executor. Default is offline planning. No funding, server writes or key output.
 * Invoke from backend/ only; --rpc is an explicit HTTP(S) endpoint, never logged.
 * A journal is an append-only secret JSONL file in an existing private, git-ignored workspace
 * directory. Never delete/recreate a journal to retry. A stale .lock after a process crash
 * requires operator inspection/removal (only after ensuring no executor is running).
 */
import { constants } from "node:fs";
import { lstat, open, readFile, realpath, unlink, type FileHandle } from "node:fs/promises";
import { dirname, relative, resolve, sep, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { createPublicClient, encodeDeployData, encodeFunctionData, getContractAddress, http, keccak256,
  parseTransaction, recoverTransactionAddress, toHex, TransactionReceiptNotFoundError,
  type Address, type Hex, type LocalAccount, type PublicClient, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { buildPilotPlan, CONTRACTS, parsePilotInput, type ContractName, type PilotArtifacts, type PilotInput } from "./pilot-deployment-plan";
import { loadPilotArtifacts, runPilotDeployment } from "./pilot-deployment";

export const MAX_FEE = 200_000_000n;
export const EXECUTOR_CAP = 4_000_000_000_000_000n;
export const DEMO_RESERVE = 1_000_000_000_000_000n;
export const GAS_CAP = 20_000_000n;
const root = resolve(import.meta.dir, "../../..");
class Stop extends Error {}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Stop(message); }
const digest = (value: unknown) => keccak256(toHex(JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v)));
const same = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string"
  && /^0x[0-9a-fA-F]{40}$/.test(a) && /^0x[0-9a-fA-F]{40}$/.test(b)
  ? a.toLowerCase() === b.toLowerCase() : a === b;
type Rpc = Pick<PublicClient, "getChainId" | "getTransactionCount" | "getCode" | "getBalance" | "getGasPrice" | "estimateGas" | "getTransactionReceipt" | "getTransaction" | "getBlock" | "getBlockNumber" | "waitForTransactionReceipt" | "sendRawTransaction" | "readContract">;
export type ExecutionBundle = { input: PilotInput; artifacts: PilotArtifacts; verifierRuntime: Hex; fileHashes: Record<string, Hex> };
type Header = { kind: "header"; version: 1; binding: Hex; baseNonce: number };
type Signed = { kind: "signed"; index: number; raw: Hex; hash: Hex };
export interface ExecutionJournal {
  header?: Header;
  signed: Signed[];
  append(event: Header | Signed): Promise<void>;
}

/** Open without truncation, symlink traversal or concurrent writers. Linux directory-fd anchoring
 * keeps subsequent operations in the inspected private directory even if a path is renamed.
 * Same-UID malicious processes/root are outside this local filesystem trust boundary.
 */
export async function openExecutionJournal(path: string, workspace = root): Promise<ExecutionJournal & { close(): Promise<void> }> {
  const absolute = resolve(path);
  const base = await realpath(workspace);
  const rel = relative(base, absolute);
  check(rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(sep), "Journal must be inside workspace");
  let cursor = base;
  for (const part of relative(base, dirname(absolute)).split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    const s = await lstat(cursor);
    check(s.isDirectory() && !s.isSymbolicLink() && !(s.mode & 0o022), "Unsafe journal ancestor");
  }
  const parent = await lstat(dirname(absolute));
  check((parent.mode & 0o777) === 0o700 && parent.uid === process.getuid?.(), "Journal parent must be owned and mode 0700");
  try { execFileSync("git", ["check-ignore", "--quiet", "--", absolute], { cwd: base, stdio: "ignore" }); }
  catch { throw new Stop("Journal must be git-ignored"); }
  const dir = await open(dirname(absolute), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const anchored = `/proc/self/fd/${dir.fd}/${basename(absolute)}`;
  let lock: FileHandle | undefined;
  let file: FileHandle | undefined;
  try {
    const ds = await dir.stat();
    check(ds.ino === parent.ino && ds.dev === parent.dev, "Journal directory changed");
    lock = await open(`${anchored}.lock`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { file = await open(anchored, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      file = await open(anchored, constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW);
    }
    const s = await file.stat();
    check(s.isFile() && s.nlink === 1 && s.uid === process.getuid?.() && (s.mode & 0o777) === 0o600, "Journal must be a single-link owned mode 0600 file");
    await dir.sync();
    const text = await file.readFile("utf8");
    check(text === "" || text.endsWith("\n"), "Torn journal; manual reconciliation required");
    const events = text.trim() ? text.trimEnd().split("\n").map(line => JSON.parse(line)) : [];
    check(!events.length || (events[0].kind === "header" && events[0].version === 1), "Invalid journal header");
    check(events.slice(1).every((e, i) => e.kind === "signed" && e.index === i), "Invalid journal sequence");
    const journal: ExecutionJournal & { close(): Promise<void> } = {
      header: events[0], signed: events.slice(1),
      async append(event) {
        check(event.kind === "header" ? !journal.header : !!journal.header && event.index === journal.signed.length, "Invalid journal append");
        await file!.writeFile(JSON.stringify(event) + "\n");
        await file!.sync(); // Signed bytes MUST reach durable storage before any send.
        if (event.kind === "header") journal.header = event; else journal.signed.push(event);
      },
      async close() { await file!.close(); await lock!.close(); await unlink(`${anchored}.lock`); await dir.close(); },
    };
    return journal;
  } catch (error) {
    await file?.close();
    if (lock) { await lock.close(); await unlink(`${anchored}.lock`); }
    await dir.close();
    throw error;
  }
}

function validateBundle(bundle: ExecutionBundle, account: LocalAccount) {
  const input = parsePilotInput(bundle.input);
  const plan = buildPilotPlan(input);
  check(new Set([...Object.values(input.roles), input.auditor?.address].filter(Boolean)).size === 3, "Exactly three public accounts required");
  check(plan.deployments.length === 4 && plan.actions.length === 7, "Expected four deployments and seven authority actions");
  check([...plan.deployments, ...plan.actions].every(s => same(s.sender, account.address)), "PRIVATE_KEY address does not match every planned sender");
  check(BigInt(input.budgetWei) >= DEMO_RESERVE, "Budget cannot preserve demo reserve");
  for (const spec of CONTRACTS) check(keccak256(bundle.artifacts[spec.name].bytecode) === bundle.artifacts[spec.name].bytecodeHash, "Artifact bytecode hash mismatch");
  check(/^0x(?:[0-9a-fA-F]{2})+$/.test(bundle.verifierRuntime), "Missing pinned verifier runtime");
  return { input, plan, binding: digest({ version: 1, input, artifacts: bundle.artifacts, verifierRuntime: bundle.verifierRuntime, fileHashes: bundle.fileHashes, maxFee: MAX_FEE.toString(), cap: EXECUTOR_CAP.toString(), reserve: DEMO_RESERVE.toString() }) };
}

/** Testable boundary: production passes only the account derived from backend PRIVATE_KEY. */
export async function executePilot(bundle: ExecutionBundle, account: LocalAccount, rpc: Rpc, journal: ExecutionJournal) {
  const { input, plan, binding } = validateBundle(bundle, account);
  const cap = BigInt(input.budgetWei) - DEMO_RESERVE < EXECUTOR_CAP ? BigInt(input.budgetWei) - DEMO_RESERVE : EXECUTOR_CAP;
  const chain = async () => check(await rpc.getChainId() === 421614, "RPC chain mismatch; expected 421614");
  const nonce = (blockTag: "latest" | "pending") => rpc.getTransactionCount({ address: account.address, blockTag });
  await chain();
  check(!(await rpc.getCode({ address: account.address }))?.replace(/^0x$/, ""), "Sender must be a direct EOA");
  if (!journal.header) {
    const baseNonce = await nonce("latest");
    check(baseNonce === await nonce("pending"), "Nonce mismatch; pending transactions exist");
    await journal.append({ kind: "header", version: 1, binding, baseNonce });
  }
  check(journal.header!.binding === binding, "Input or artifact binding mismatch");
  const baseNonce = journal.header!.baseNonce;
  check(Number.isSafeInteger(baseNonce) && baseNonce >= 0, "Invalid journal nonce");
  const addresses = Object.fromEntries(CONTRACTS.map((c, i) => [c.name, getContractAddress({ from: account.address, nonce: BigInt(baseNonce + i) })])) as Record<ContractName, Address>;
  const steps = [...plan.deployments.map(d => ({ contract: d.contract, to: undefined as Address | undefined,
    data: encodeDeployData({ abi: bundle.artifacts[d.contract].abi, bytecode: bundle.artifacts[d.contract].bytecode,
      args: d.args.map(a => typeof a === "object" ? addresses[a.contract] : a) }) })),
  ...plan.actions.map(a => ({ contract: a.contract, to: addresses[a.contract],
    data: encodeFunctionData({ abi: bundle.artifacts[a.contract].abi, functionName: a.functionName, args: a.args }) }))];
  check(journal.signed.length <= steps.length, "Excess journal transactions");
  let committed = 0n;
  let signedGas = 0n;
  const confirmedBlocks: { number: bigint; hash: Hex }[] = [];
  async function checkConfirmedBlocks() {
    const head = await rpc.getBlockNumber();
    for (const block of confirmedBlocks) check(head >= block.number + 1n && (await rpc.getBlock({ blockNumber: block.number })).hash === block.hash, "Previously confirmed dependency reorged; stop and reconcile");
  }
  const read = (contract: ContractName, functionName: string, args: unknown[], blockNumber: bigint) => rpc.readContract({ address: addresses[contract], abi: bundle.artifacts[contract].abi, functionName, args, blockNumber });
  const key = keccak256(toHex(input.institutionId));
  async function readback(index: number, blockNumber: bigint) {
    const c = steps[index].contract;
    const expectRead = async (name: string, args: unknown[], expected: unknown) => {
      const result = await read(c, name, args, blockNumber);
      check(Array.isArray(expected) ? digest(result) === digest(expected) : same(result, expected), "Contract readback mismatch");
    };
    if (index < 4) {
      const code = await rpc.getCode({ address: addresses[c], blockNumber });
      check(code && code !== "0x", "Deployed code missing");
      if (c === "Groth16Verifier") check(keccak256(code) === keccak256(bundle.verifierRuntime), "Pinned verifier bytecode mismatch");
      if (c === "ReportEvidenceRegistry" || c === "ContributionProofRegistry") await expectRead("admissionAuthority", [], input.roles.admission);
      if (c === "ReportEvidenceRegistry") await expectRead("validatorOperator", [], input.roles.admission);
      if (c === "ContributionProofRegistry") await expectRead("verifier", [], addresses.Groth16Verifier);
      if (c === "DistributionCertificateNFT") await expectRead("registry", [], addresses.ReportEvidenceRegistry);
      return;
    }
    const action = plan.actions[index - 4];
    const args = action.args;
    switch (action.functionName) {
      case "enrollInstitution":
        await expectRead("administrators", [key], input.roles.administrator);
        if (c === "ReportEvidenceRegistry") await expectRead("administratorEpochs", [key], 1n);
        break;
      case "setSignatory": await expectRead("signatories", [key, args[1]], [true, 1n]); break;
      case "setValidator": await expectRead("validators", [args[0]], [true, 1n]); break;
      case "setSigner": await expectRead("authorizedSigners", [key, args[1]], args[2]); break;
      case "setCustodian":
        await expectRead("custodianOf", [key], args[1]); await expectRead("custodyEpochs", [key], 1n); break;
      case "setAuditor":
        await expectRead("auditors", [key, args[1]], [true, 1n]);
        await expectRead("auditorMandate", [input.institutionId, args[1]], args[3]); break;
      default: throw new Stop("Unsupported authority action");
    }
  }
  async function receipt(hash: Hex): Promise<TransactionReceipt | undefined> {
    try { return await rpc.getTransactionReceipt({ hash }); }
    catch (e) { if (e instanceof TransactionReceiptNotFoundError) return undefined; throw e; }
  }
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const expectedNonce = baseNonce + index;
    await chain();
    let entry = journal.signed[index];
    if (!entry) {
      await checkConfirmedBlocks();
      check(await nonce("latest") === expectedNonce && await nonce("pending") === expectedNonce, "Nonce mismatch; refusing new signature");
      if (index < 4) check(!(await rpc.getCode({ address: addresses[step.contract] }))?.replace(/^0x$/, ""), "Deployment address already has code");
      check(await rpc.getGasPrice() <= MAX_FEE, "RPC gas price exceeds fee ceiling");
      // Arbitrum eth_estimateGas includes its L1 posting component. Estimate only after
      // preceding dependencies have successful canonical receipts and verified readbacks.
      const estimate = await rpc.estimateGas({ account: account.address, to: step.to, data: step.data, value: 0n, maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: 0n });
      const gas = (estimate * 125n + 99n) / 100n;
      check(estimate > 0n && signedGas + gas <= GAS_CAP && committed + gas * MAX_FEE <= cap, "Executor budget exceeded; no transaction signed");
      check(await rpc.getBalance({ address: account.address }) >= gas * MAX_FEE, "Sender balance below worst-case fee; no funding permitted");
      await chain();
      check(await nonce("latest") === expectedNonce && await nonce("pending") === expectedNonce, "Nonce changed before signing");
      const raw = await account.signTransaction({ type: "eip1559", chainId: 421614, nonce: expectedNonce, to: step.to, data: step.data, value: 0n, gas, maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: 0n });
      entry = { kind: "signed", index, raw, hash: keccak256(raw) };
      await journal.append(entry);
    }
    const tx = parseTransaction(entry.raw);
    check(entry.index === index && entry.hash === keccak256(entry.raw) && same(await recoverTransactionAddress({ serializedTransaction: entry.raw as `0x02${string}` }), account.address), "Journal signed transaction mismatch");
    check(tx.type === "eip1559" && tx.chainId === 421614 && tx.nonce === expectedNonce && same(tx.to, step.to) && tx.data === step.data && (tx.value ?? 0n) === 0n && tx.maxFeePerGas === MAX_FEE && (tx.maxPriorityFeePerGas ?? 0n) === 0n && !tx.accessList?.length, "Journal transaction differs from immutable plan");
    const gas = tx.gas ?? 0n;
    signedGas += gas;
    check(gas > 0n && signedGas <= GAS_CAP && committed + gas * MAX_FEE <= cap, "Journal exceeds executor budget");
    let r = await receipt(entry.hash);
    if (!r) {
      await chain();
      const latest = await nonce("latest"), pending = await nonce("pending");
      check(latest === expectedNonce && (pending === expectedNonce || pending === expectedNonce + 1), "Nonce mismatch; pending journal cannot be replaced");
      if (pending !== expectedNonce) {
        const known = await rpc.getTransaction({ hash: entry.hash });
        check(known.hash === entry.hash && known.nonce === expectedNonce && same(known.from, account.address) && known.blockNumber === null, "Unknown pending nonce owner");
      }
      await checkConfirmedBlocks();
      await chain(); // Actual RPC chain checked before EVERY send, including exact-byte resumption.
      const hash = await rpc.sendRawTransaction({ serializedTransaction: entry.raw });
      check(hash === entry.hash, "Broadcast hash mismatch");
      r = await rpc.waitForTransactionReceipt({ hash: entry.hash, confirmations: 2, timeout: 120_000, pollingInterval: 2_000 });
    } else if (await rpc.getBlockNumber() < r.blockNumber + 1n) {
      r = await rpc.waitForTransactionReceipt({ hash: entry.hash, confirmations: 2, timeout: 120_000, pollingInterval: 2_000 });
    }
    check(r.transactionHash === entry.hash && r.status === "success" && same(r.from, account.address) && same(r.to ?? undefined, step.to), "Receipt failed or belongs to another transaction");
    check(index >= 4 || same(r.contractAddress, addresses[step.contract]), "Deployment receipt address mismatch");
    const again = await receipt(entry.hash);
    check(again?.blockHash === r.blockHash && again.status === "success" && (await rpc.getBlock({ blockNumber: r.blockNumber })).hash === r.blockHash && await rpc.getBlockNumber() >= r.blockNumber + 1n, "Receipt is not canonical with two confirmations");
    check(r.gasUsed > 0n && r.gasUsed <= gas && r.effectiveGasPrice >= 0n && r.effectiveGasPrice <= MAX_FEE, "Receipt cost outside signed bounds");
    // The fixed plan never overwrites an earlier checked postcondition: links/admission
    // are immutable, checked roles/epochs are not overwritten, and signer revocation (if any) targets
    // a different account. Verify that these conditions still hold at recent confirmed
    // state, rather than requiring an archive node to retain deployment-block state.
    // Original receipt/block canonicality remains mandatory above and below.
    const readbackBlock = await rpc.getBlockNumber() - 1n;
    check(readbackBlock >= r.blockNumber, "Readback block precedes confirmed receipt");
    const readbackHash = (await rpc.getBlock({ blockNumber: readbackBlock })).hash;
    check(readbackHash, "Readback block hash missing");
    await readback(index, readbackBlock);
    check((await rpc.getBlock({ blockNumber: readbackBlock })).hash === readbackHash
      && await rpc.getBlockNumber() >= readbackBlock + 1n, "Readback block changed or lost two confirmations");
    confirmedBlocks.push({ number: r.blockNumber, hash: r.blockHash });
    await checkConfirmedBlocks();
    committed += r.gasUsed * r.effectiveGasPrice; // Release reservation only after verified receipt/readback.
  }
  await chain();
  check(await nonce("latest") === baseNonce + steps.length && await nonce("pending") === baseNonce + steps.length, "Final nonce mismatch");
  const blockNumber = await rpc.getBlockNumber() - 1n;
  const blockHash = (await rpc.getBlock({ blockNumber })).hash;
  for (let i = 0; i < steps.length; i++) await readback(i, blockNumber);
  check((await rpc.getBlock({ blockNumber })).hash === blockHash, "Readback block changed");
  await checkConfirmedBlocks();
  return { status: "confirmed-and-readback-verified", chainId: 421614, addresses, transactionHashes: journal.signed.map(e => e.hash), committedWei: committed.toString(), executorCapWei: cap.toString(), remainingAggregateWei: (BigInt(input.budgetWei) - committed).toString(), readbackBlock: blockNumber.toString(), operationalApproval: false };
}

export async function runPilotExecutor(args: string[]) {
  if (!args.includes("--broadcast")) {
    check(args.every((a, i) => a === "--input" || a === "--help" || (i > 0 && args[i - 1] === "--input")), "Plan mode accepts only --input or --help");
    return runPilotDeployment(args);
  }
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    check(!flags.has(flag), "Duplicate executor flag");
    if (flag === "--broadcast") flags.set(flag, "true");
    else {
      check(["--input", "--journal", "--rpc"].includes(flag) && args[i + 1] && !args[i + 1].startsWith("--"), "Unsupported executor arguments");
      flags.set(flag, args[++i]);
    }
  }
  check(flags.has("--input") && flags.has("--journal") && flags.has("--rpc"), "Broadcast requires explicit --input --journal --rpc");
  check(resolve(process.cwd()) === resolve(root, "backend"), "Broadcast must be invoked from backend to use its environment");
  const inputPath = resolve(flags.get("--input")!);
  check(inputPath === resolve(root, ".scratch/demo-release/pilot-public-input.json"), "Broadcast requires the selected public input path");
  const url = new URL(flags.get("--rpc")!);
  check(["http:", "https:"].includes(url.protocol), "RPC must be HTTP(S)");
  const inputText = await readFile(inputPath, "utf8");
  const input = parsePilotInput(JSON.parse(inputText));
  const artifacts = await loadPilotArtifacts();
  const fileHashes: Record<string, Hex> = { input: keccak256(toHex(inputText)) };
  let verifierRuntime: Hex = "0x";
  for (const spec of CONTRACTS) {
    const text = await readFile(resolve(root, `sc/out/${spec.name}.sol/${spec.name}.json`), "utf8");
    const artifact = JSON.parse(text);
    check(artifact.bytecode.object === artifacts[spec.name].bytecode && digest(artifact.abi) === digest(artifacts[spec.name].abi), "Artifact changed during load");
    fileHashes[spec.name] = keccak256(toHex(text));
    if (spec.name === "Groth16Verifier") {
      check(!Object.keys(artifact.deployedBytecode.immutableReferences ?? {}).length, "Verifier runtime has immutable references");
      verifierRuntime = artifact.deployedBytecode.object;
    }
  }
  const secret = process.env.PRIVATE_KEY;
  check(secret && /^0x[0-9a-fA-F]{64}$/.test(secret), "Backend PRIVATE_KEY is required");
  const account = privateKeyToAccount(secret as Hex);
  const bundle = { input, artifacts, verifierRuntime, fileHashes };
  validateBundle(bundle, account);
  const journal = await openExecutionJournal(flags.get("--journal")!);
  try {
    const rpc = createPublicClient({ chain: arbitrumSepolia, transport: http(url.toString(), { retryCount: 0, timeout: 15_000 }), cacheTime: 0 });
    return await executePilot(bundle, account, rpc, journal);
  } finally { await journal.close(); }
}
if (import.meta.main) {
  try { console.log(JSON.stringify(await runPilotExecutor(process.argv.slice(2)), null, 2)); }
  catch (error) {
    // Only messages created in this module are printable; never stringify RPC/library errors.
    console.error(error instanceof Stop ? error.message : "Pilot executor stopped; underlying details redacted. Preserve journal and reconcile before resuming.");
    process.exitCode = 1;
  }
}

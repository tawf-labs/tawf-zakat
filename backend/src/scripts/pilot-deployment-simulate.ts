/** Disposable owned Anvil only. External fork RPC is read-only; no private keys are loaded.
 * bun src/scripts/pilot-deployment-simulate.ts --input public.json --fork
 * PILOT_RPC_URL supplies the fork endpoint. --local-anvil instead runs an empty local chain.
 */
import { readFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, encodeDeployData, encodeFunctionData, http, keccak256, toHex, type Address, type Hex } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { buildPilotPlan, parsePilotInput, type ContractName } from "./pilot-deployment-plan";
import { loadPilotArtifacts } from "./pilot-deployment";

type ForkOptions = { forkUrl?: string; forkBlockNumber?: bigint };
export function assertOwnedLoopbackUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Local execution requires an owned numeric loopback HTTP endpoint");
  }
  return url.origin;
}

/** Port 0 lets the owned process bind an ephemeral port without reservation races.
 * stdout is inspected privately for the bound address, never echoed (Anvil banners may contain keys).
 * No ambient environment is forwarded except executable PATH; storage caching is disabled.
 */
export async function withOwnedAnvil<T>(options: ForkOptions, use: (url: string) => Promise<T>): Promise<T> {
  const args = ["anvil", "--host", "127.0.0.1", "--port", "0", "--chain-id", "421614", "--accounts", "0", "--hardfork", "cancun", "--color", "never"];
  if (options.forkUrl) {
    if (options.forkBlockNumber === undefined) throw new Error("Fork must be pinned to an observed block");
    args.push("--fork-url", options.forkUrl, "--fork-block-number", options.forkBlockNumber.toString(), "--no-storage-caching", "--retries", "0", "--timeout", "15000");
  }
  const child = Bun.spawn(args, { stdin: "ignore", stdout: "pipe", stderr: "ignore", env: { PATH: process.env.PATH ?? "" } });
  let buffer = "";
  let resolveReady!: (url: string) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<string>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const timer = setTimeout(() => rejectReady(new Error("Owned Anvil startup timed out")), 30_000);
  const consume = (async () => {
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer = (buffer + decoder.decode(chunk.value, { stream: true })).slice(-8192);
        const match = buffer.match(/Listening on (127\.0\.0\.1:\d+)/);
        if (match) resolveReady(assertOwnedLoopbackUrl(`http://${match[1]}`));
      }
    } finally { reader.releaseLock(); }
  })();
  void child.exited.then(() => rejectReady(new Error("Owned Anvil exited before startup")));
  // Kill on normal CLI termination as well as callback failure; never target another process.
  const interrupt = () => { child.kill("SIGTERM"); };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const url = await ready;
    if (child.exitCode !== null) throw new Error("Owned Anvil is not running");
    return await use(url);
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    if (child.exitCode === null) child.kill("SIGTERM");
    const force = setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 2000);
    await child.exited;
    clearTimeout(force);
    await consume;
  }
}

export async function simulatePilotDeployment(value: unknown, options: ForkOptions = {}) {
  const plan = buildPilotPlan(parsePilotInput(value));
  const artifacts = await loadPilotArtifacts();
  let forkBlockNumber: bigint | undefined;
  let referenceGasPrice = 100_000_000n; // Explicit local-only benchmark, not a live fee quote.
  if (options.forkUrl) {
    const parsed = new URL(options.forkUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Fork endpoint must use HTTP(S)");
    // This external client has no wallet or write API. All writes below use owned loopback only.
    const upstream = createPublicClient({ transport: http(options.forkUrl, { retryCount: 0, timeout: 15_000 }) });
    if (await upstream.getChainId() !== 421614) throw new Error("Fork RPC chain mismatch: expected 421614");
    forkBlockNumber = options.forkBlockNumber ?? await upstream.getBlockNumber();
    referenceGasPrice = await upstream.getGasPrice();
  } else if (options.forkBlockNumber !== undefined) throw new Error("Fork block requires fork endpoint");

  return withOwnedAnvil({ forkUrl: options.forkUrl, forkBlockNumber }, async ownedUrl => {
    const url = assertOwnedLoopbackUrl(ownedUrl);
    const transport = http(url, { retryCount: 0, timeout: 15_000 });
    const rpc = createPublicClient({ chain: arbitrumSepolia, transport });
    const wallet = createWalletClient({ chain: arbitrumSepolia, transport });
    if (await rpc.getChainId() !== 421614 || !(await rpc.request({ method: "web3_clientVersion" })).toLowerCase().includes("anvil")) throw new Error("Owned node identity mismatch");
    if (forkBlockNumber !== undefined && await rpc.getBlockNumber() !== forkBlockNumber) throw new Error("Owned fork block mismatch");
    // These RPC methods are intentionally impossible to direct to a caller-supplied local/live URL.
    const localRpc = async (method: string, params: unknown[]) => {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000), redirect: "error" });
      const body = await response.json() as { error?: unknown };
      if (!response.ok || body.error) throw new Error("Local Anvil control call failed");
    };
    const localBalanceOverrides: { address: Address; originalWei: string; simulatedWei: string }[] = [];
    for (const address of new Set([plan.roles.deployer, ...plan.actions.map(a => a.sender)])) {
      const original = await rpc.getBalance({ address });
      await localRpc("anvil_impersonateAccount", [address]);
      // Local synthetic credit deliberately removes funding as a simulation obstacle. Never a live transfer.
      const simulated = original > 10n ** 18n ? original : 10n ** 18n;
      await localRpc("anvil_setBalance", [address, toHex(simulated)]);
      localBalanceOverrides.push({ address, originalWei: original.toString(), simulatedWei: simulated.toString() });
    }
    const simulatedAddresses = {} as Record<ContractName, Address>;
    const steps: { label: string; sender: Address; simulatedTransactionHash: Hex; receiptStatus: "success"; gasUsed: string; localEffectiveGasPriceWei: string; localReceiptCostWei: string; executionCostAtReferenceGasPriceWei: string }[] = [];
    const execute = async (label: string, sender: Address, data: Hex, to?: Address) => {
      const gas = await rpc.estimateGas({ account: sender, data, to });
      const hash = await wallet.sendTransaction({ account: sender, data, to, gas: gas + gas / 5n });
      const receipt = await rpc.waitForTransactionReceipt({ hash, timeout: 30_000, pollingInterval: 50 });
      if (receipt.status !== "success" || receipt.from.toLowerCase() !== sender.toLowerCase() || (to && receipt.to?.toLowerCase() !== to.toLowerCase())) throw new Error(`Simulation receipt failed: ${label}`);
      steps.push({ label, sender, simulatedTransactionHash: hash, receiptStatus: "success", gasUsed: receipt.gasUsed.toString(), localEffectiveGasPriceWei: receipt.effectiveGasPrice.toString(), localReceiptCostWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(), executionCostAtReferenceGasPriceWei: (receipt.gasUsed * referenceGasPrice).toString() });
      return receipt;
    };
    for (const deployment of plan.deployments) {
      const artifact = artifacts[deployment.contract];
      const args = deployment.args.map(a => typeof a === "object" ? simulatedAddresses[a.contract] : a);
      if (args.some(a => a === undefined)) throw new Error("Unresolved local dependency");
      const receipt = await execute(`deploy:${deployment.contract}`, deployment.sender, encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args }));
      if (!receipt.contractAddress) throw new Error("Simulation creation address missing");
      const code = await rpc.getCode({ address: receipt.contractAddress });
      if (!code || code === "0x") throw new Error("Simulation deployed code missing");
      simulatedAddresses[deployment.contract] = receipt.contractAddress;
    }
    for (const [index, action] of plan.actions.entries()) {
      await execute(`authority:${index + 1}:${action.contract}.${action.functionName}`, action.sender,
        encodeFunctionData({ abi: artifacts[action.contract].abi, functionName: action.functionName, args: action.args }), simulatedAddresses[action.contract]);
    }
    let readbackChecks = 4; // Each deployment has confirmed runtime code.
    const equal = async (contract: ContractName, functionName: string, args: unknown[], expected: unknown) => {
      const actual = await rpc.readContract({ address: simulatedAddresses[contract], abi: artifacts[contract].abi, functionName, args });
      const normalize = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x) ? x.toLowerCase() : x);
      if (normalize(actual) !== normalize(expected)) throw new Error(`Simulation getter mismatch: ${contract}.${functionName}`);
      readbackChecks++;
    };
    const key = keccak256(toHex(plan.institutionId));
    const r = plan.roles;
    await equal("ReportEvidenceRegistry", "admissionAuthority", [], r.admission);
    await equal("ReportEvidenceRegistry", "validatorOperator", [], r.admission);
    await equal("ReportEvidenceRegistry", "administrators", [key], r.administrator);
    await equal("ReportEvidenceRegistry", "signatories", [key, r.reportSignatory], [true, 1n]);
    await equal("ReportEvidenceRegistry", "validators", [r.validator], [true, 1n]);
    await equal("ContributionProofRegistry", "admissionAuthority", [], r.admission);
    await equal("ContributionProofRegistry", "verifier", [], simulatedAddresses.Groth16Verifier);
    await equal("ContributionProofRegistry", "administrators", [key], r.administrator);
    await equal("ContributionProofRegistry", "authorizedSigners", [key, r.zkSigner], true);
    if (r.administrator !== r.zkSigner) await equal("ContributionProofRegistry", "authorizedSigners", [key, r.administrator], false);
    await equal("DistributionCertificateNFT", "registry", [], simulatedAddresses.ReportEvidenceRegistry);
    await equal("DistributionCertificateNFT", "custodianOf", [key], r.custodian);
    await equal("DistributionCertificateNFT", "resolvedCustodian", [key], r.custodian);
    const auditor = plan.actions.find(a => a.functionName === "setAuditor");
    if (auditor) {
      await equal("ReportEvidenceRegistry", "auditors", [key, auditor.args[1]], [true, 1n]);
      await equal("ReportEvidenceRegistry", "auditorMandate", [plan.institutionId, auditor.args[1]], auditor.args[3]);
    }
    const totalGas = steps.reduce((sum, s) => sum + BigInt(s.gasUsed), 0n);
    const executionCost = totalGas * referenceGasPrice;
    const recommendedExecutionReserve = executionCost * 2n;
    return { mode: "local-anvil-simulation", externalBroadcastEnabled: false, chainId: 421614,
      forkBlockNumber: forkBlockNumber?.toString() ?? null, referenceGasPriceWei: referenceGasPrice.toString(),
      referenceGasPriceSource: options.forkUrl ? "read-only upstream quote" : "fixed local benchmark",
      simulatedAddresses, addressWarning: "SIMULATED ONLY: never activate these addresses in application configuration. No external deployment occurred.",
      artifacts: Object.fromEntries(Object.entries(artifacts).map(([name, a]) => [name, a.bytecodeHash])),
      steps, readbackChecks, localBalanceOverrides, totalExecutionGas: totalGas.toString(),
      budget: { aggregateUserCapWei: plan.budgetWei, executionCostAtReferenceGasPriceWei: executionCost.toString(),
        recommendedExecutionReserveWei: recommendedExecutionReserve.toString(), recommendationBasis: "2x execution-only model, NOT an all-in fee ceiling or authorization; obtain actual Arbitrum fee estimates before approval",
        executionReserveExceedsAggregateCap: recommendedExecutionReserve > BigInt(plan.budgetWei),
        completeLiveCostEstimate: false, unknownCosts: ["Arbitrum L1 posting fees", "account funding transfers", "demo transactions", "fee movement and actual network gas estimation"] },
      warnings: [...plan.warnings, "Local Anvil gas excludes real Arbitrum L1 posting fees; local receipt prices are not live prices.", "Local balances were synthetically raised; this is not a live funding sufficiency check.", "No proof, report publication, NFT issuance or auditor attestation demo transaction was executed; this checks constructors and authority setup only."],
    };
  });
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
      console.log("Usage: bun src/scripts/pilot-deployment-simulate.ts --input public.json (--fork | --local-anvil). --fork requires PILOT_RPC_URL; external writes are never supported.");
    } else {
      if (args.length !== 3 || args[0] !== "--input" || !args[1] || !["--fork", "--local-anvil"].includes(args[2]!)) throw new Error("Invalid arguments");
      const forkUrl = args[2] === "--fork" ? process.env.PILOT_RPC_URL : undefined;
      if (args[2] === "--fork" && !forkUrl) throw new Error("PILOT_RPC_URL required");
      const value = JSON.parse(await readFile(args[1], "utf8"));
      console.log(JSON.stringify(await simulatePilotDeployment(value, { forkUrl }), null, 2));
    }
  } catch {
    // Never log RPC payloads, URLs, process output, environment values or library exception stacks.
    console.error("Pilot local simulation failed. Check public input, verified artifacts, Anvil availability, fork chain 421614 and RPC access. No external transactions were sent.");
    process.exitCode = 1;
  }
}

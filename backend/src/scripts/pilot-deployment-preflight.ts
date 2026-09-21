import { encodeDeployData, type Address, type Hex } from "viem";
import type { PilotArtifacts, PilotPlan } from "./pilot-deployment-plan";

/** Deliberately no wallet/send/request method in this boundary. */
export interface PilotReadRpc {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
  getBalance(args: { address: Address; blockNumber: bigint }): Promise<bigint>;
  getCode(args: { address: Address; blockNumber: bigint }): Promise<Hex | undefined>;
  getTransactionCount(args: { address: Address; blockTag: "pending" }): Promise<number>;
  estimateGas(args: { account: Address; data: Hex; value: bigint; blockNumber: bigint }): Promise<bigint>;
}

export async function preflightPilot(plan: PilotPlan, artifacts: PilotArtifacts, rpc: PilotReadRpc) {
  if (await rpc.getChainId() !== 421614) throw new Error("RPC chain mismatch: expected Arbitrum Sepolia 421614");
  const blockNumber = await rpc.getBlockNumber();
  const gasPrice = await rpc.getGasPrice();
  const senders = [...new Set([...Object.values(plan.roles), ...plan.actions.flatMap(a => a.args.filter((v): v is Address => typeof v === "string" && /^0x[0-9a-f]{40}$/.test(v)))])];
  const accounts = await Promise.all(senders.map(async address => ({ address,
    balanceWei: (await rpc.getBalance({ address, blockNumber })).toString(),
    hasCode: !!((await rpc.getCode({ address, blockNumber }))?.replace(/^0x$/, "")),
    pendingNonce: await rpc.getTransactionCount({ address, blockTag: "pending" }),
  })));
  const deployer = accounts.find(a => a.address === plan.roles.deployer)!;
  if (deployer.hasCode) throw new Error("Deployer has code; this direct-EOA deployment plan does not support smart-account deployment");
  const estimates: { contract: string; status: "estimated" | "pending-dependencies" | "rpc-estimate-failed"; gas?: string; indicativeCostWei?: string; reason?: string }[] = [];
  for (const d of plan.deployments) {
    if (d.dependsOn.length) {
      estimates.push({ contract: d.contract, status: "pending-dependencies", reason: "New dependency addresses/code do not exist. A fresh fork simulation or confirmed deployment receipts are required; no placeholder-address gas estimate." });
      continue;
    }
    const artifact = artifacts[d.contract];
    const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: d.args });
    try {
      const gas = await rpc.estimateGas({ account: d.sender, data, value: 0n, blockNumber });
      estimates.push({ contract: d.contract, status: "estimated", gas: gas.toString(), indicativeCostWei: (gas * gasPrice).toString() });
    } catch {
      // RPC errors may contain credentials, request URLs or headers; do not serialize them.
      estimates.push({ contract: d.contract, status: "rpc-estimate-failed", reason: "RPC could not estimate creation at this block; inspect endpoint/funding using redacted diagnostics." });
    }
  }
  const partialCost = estimates.reduce((sum, e) => sum + BigInt(e.indicativeCostWei ?? "0"), 0n);
  return { mode: "read-only-preflight", broadcastEnabled: false as const, chainId: 421614, blockNumber: blockNumber.toString(),
    gasPriceWei: gasPrice.toString(), accounts, estimates, partialIndicativeCostWei: partialCost.toString(),
    partialEstimateExceedsBudget: partialCost > BigInt(plan.budgetWei), deployerBalanceBelowPartialEstimate: BigInt(deployer.balanceWei) < partialCost,
    completeBudgetEstimate: false as const,
    pending: ["Dependent contract creation and every authority action still need sequential simulation and gas estimates.",
      "gas * current gasPrice is indicative, not an approved maximum fee or an all-inclusive Arbitrum fee quote; set fee caps, safety margin and per-sender funding before execution.",
      "No broadcast/resume journal exists here. A separate receipt-verified, journaled execution step must be approved before any write.",
      "Offchain personal operator/approver membership and ongoing relay budgets are not created or validated by this tool."],
  };
}

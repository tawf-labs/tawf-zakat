/**
 * A local Anvil report registry for the period report suites (#131): deployed fresh,
 * with the validator service enrolled and the officer as the institution's endorsing
 * account. Published local Anvil keys only; no network URL is read from the environment.
 */

import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { foundry } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { reportRegistryAbi } from "../../../shared/report-registry-abi";
import { createRegistryStore } from "../../src/registry-store";
import { createRegistryBudgetStore } from "../../src/registry-budget";
import { createRegistryChain } from "../../src/registry-chain";
import { createReportEndorsement } from "../../src/report-endorsement";
import { amilSinar, SINAR } from "./period-report-fixture";

const deployer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const relayerKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const validatorKey = `0x${"0".repeat(60)}5678` as Hex;

export async function startPeriodReportRegistry(port: number) {
  const rpcUrl = `http://127.0.0.1:${port}`;
  const rpc = createPublicClient({ chain: foundry, transport: http(rpcUrl, { retryCount: 0, timeout: 500 }) });
  const wallet = createWalletClient({ account: deployer, chain: foundry, transport: http(rpcUrl) });
  let occupied = false;
  try { await rpc.getChainId(); occupied = true; } catch { /* The fixture must own this port. */ }
  if (occupied) throw new Error(`Port ${port} sudah digunakan; hentikan fixture Anvil lama.`);
  const node = Bun.spawn(["anvil", "--host", "127.0.0.1", "--port", String(port), "--silent"], { stdout: "ignore", stderr: "pipe" });
  for (let i = 0; i < 50; i++) {
    try { await rpc.getChainId(); break; } catch { await Bun.sleep(100); }
  }
  const artifact = await Bun.file(new URL("../../../sc/out/ReportEvidenceRegistry.sol/ReportEvidenceRegistry.json", import.meta.url)).json();
  const deployment = await wallet.deployContract({ abi: reportRegistryAbi, bytecode: artifact.bytecode.object, args: [deployer.address] });
  const registry = (await rpc.waitForTransactionReceipt({ hash: deployment })).contractAddress!;
  const write = async (functionName: string, args: readonly unknown[]) =>
    rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registry, abi: reportRegistryAbi, functionName, args } as any) });
  await write("setValidator", [privateKeyToAccount(validatorKey).address, true]);
  await write("enrollInstitution", [SINAR, deployer.address]);
  await write("setSignatory", [SINAR, amilSinar.address, true]);

  return {
    rpc,
    mine: () => rpc.request({ method: "evm_mine" as any }),
    /**
     * The registry runtime over a database whose schema this creates. `closed` leaves out
     * the validator key or the relay budget, as a deployment with writes closed does.
     */
    async runtime(db: Parameters<typeof createRegistryStore>[0], closed: { validator?: boolean; budget?: boolean } = {}) {
      const store = createRegistryStore(db);
      await store.ensureSchema();
      const budgetConfig = { maxWei: 10n ** 20n, gasLimit: 5_000_000n, maxFeePerGas: 2_000_000_000n }; // Isolated Anvil only.
      const budget = createRegistryBudgetStore(db, budgetConfig, `31337:${registry.toLowerCase()}:${privateKeyToAccount(relayerKey).address.toLowerCase()}`);
      await budget.ensureSchema();
      const chain = createRegistryChain({
        rpcUrl, chainId: 31337, address: registry, requiredConfirmations: 2, privateKey: relayerKey,
        ...(closed.budget ? {} : { budgetConfig, budget }),
      });
      return { store, chain, ...(closed.validator ? {} : { endorsement: createReportEndorsement(validatorKey) }) };
    },
    async stop() {
      if (node.exitCode === null) { node.kill(); await node.exited; }
    },
  };
}

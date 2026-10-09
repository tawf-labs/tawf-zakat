import { createPublicClient, createWalletClient, encodeDeployData, formatEther, http, keccak256, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { CAMPAIGN_REGISTRY_ABI } from "../campaign-chain";

// Run from backend: bun src/scripts/deploy-campaign-registry.ts [--broadcast]
// Keys stay in environment, never CLI arguments or deployment artifacts.
// This command deploys only the separate campaign registry, not legacy contracts.
async function main() {
  const broadcasting = process.argv.includes("--broadcast");
  if (process.argv.slice(2).some(arg => arg !== "--broadcast")) throw new Error("Deployment check: unknown argument");
  const rpc = process.env.CAMPAIGN_CHAIN_RPC_URL || process.env.REPORT_REGISTRY_RPC_URL;
  if (!rpc || process.env.CAMPAIGN_CHAIN_ID !== "421614") throw new Error("Deployment check: explicit Arbitrum Sepolia configuration required");
  if (process.env.CAMPAIGN_REGISTRY_ADDRESS) throw new Error("Deployment check: registry already configured; refusing duplicate deployment");
  function account(name: string) {
    const key = process.env[name]?.trim();
    if (!key) throw new Error(`Deployment check: missing ${name}`);
    try { return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex); }
    catch { throw new Error(`Deployment check: invalid ${name}`); }
  }
  const administrator = account("PRIVATE_KEY");
  const recorder = account("CAMPAIGN_RECORDER_PRIVATE_KEY");
  if (administrator.address === recorder.address) throw new Error("Deployment check: administrator and recorder must differ");
  const client = createPublicClient({ chain: arbitrumSepolia, transport: http(rpc, { timeout: 20000, retryCount: 1 }) });
  if (await client.getChainId() !== 421614) throw new Error("Deployment check: RPC chain mismatch");
  const artifact = await Bun.file(new URL("../../../sc/out/CampaignEvidenceRegistry.sol/CampaignEvidenceRegistry.json", import.meta.url)).json();
  const bytecode = artifact.bytecode.object as Hex;
  if (!/^0x[0-9a-fA-F]+$/.test(bytecode)) throw new Error("Deployment check: missing compiled bytecode");
  const data = encodeDeployData({ abi: CAMPAIGN_REGISTRY_ABI, bytecode, args: [administrator.address, recorder.address] });
  const gasPrice = (await client.getGasPrice()) * 2n;
  const deploymentGas = (await client.estimateGas({ account: administrator, data })) * 125n / 100n;
  const recorderBalance = await client.getBalance({ address: recorder.address });
  const fundingTarget = parseEther("0.0002");
  const funding = recorderBalance < fundingTarget ? fundingTarget - recorderBalance : 0n;
  const fundingGas = funding ? (await client.estimateGas({ account: administrator, to: recorder.address, value: funding })) * 125n / 100n : 0n;
  const upperBound = (deploymentGas + fundingGas) * gasPrice + funding;
  if (upperBound > parseEther("0.001")) throw new Error("Deployment check: total estimate exceeds 0.001 testnet ETH budget");
  if (await client.getBalance({ address: administrator.address }) < upperBound) throw new Error("Deployment check: deployer balance insufficient");
  console.log(JSON.stringify({ phase: "preflight", chainId: 421614, administrator: administrator.address, recorder: recorder.address, deploymentGas: String(deploymentGas), gasPriceWei: String(gasPrice), recorderFundingETH: formatEther(funding), maximumDeployerSpendETH: formatEther(upperBound), broadcasting }));
  if (!broadcasting) return;

  const output = new URL("../../../docs/deployments/2026-10-09-campaign-registry-arbitrum-sepolia.json", import.meta.url);
  if (await Bun.file(output).exists()) throw new Error("Deployment check: deployment journal already exists; inspect it instead of rebroadcasting");
  const journal: Record<string, unknown> = {
    contract: "CampaignEvidenceRegistry", chainId: 421614, network: "Arbitrum Sepolia", administrator: administrator.address,
    recorder: recorder.address, source: "sc/src/CampaignEvidenceRegistry.sol", createdAt: new Date().toISOString(),
    creationBytecodeHash: keccak256(bytecode), status: "PREPARED",
  };
  const save = () => Bun.write(output, JSON.stringify(journal, null, 2) + "\n");
  await save();
  const wallet = createWalletClient({ chain: arbitrumSepolia, account: administrator, transport: http(rpc, { timeout: 20000, retryCount: 0 }) });
  // Journal each broadcast before waiting: never blindly redeploy after timeout.
  const deploymentHash = await wallet.deployContract({ abi: CAMPAIGN_REGISTRY_ABI, bytecode, args: [administrator.address, recorder.address], gas: deploymentGas, gasPrice });
  journal.deploymentTransactionHash = deploymentHash; journal.status = "DEPLOYMENT_PENDING"; await save();
  console.log(JSON.stringify({ phase: "deployment_sent", transactionHash: deploymentHash }));
  const receipt = await client.waitForTransactionReceipt({ hash: deploymentHash, confirmations: 2, timeout: 180000 });
  if (receipt.status !== "success" || !receipt.contractAddress || receipt.from.toLowerCase() !== administrator.address.toLowerCase()) throw new Error("Deployment check: unsuccessful or unexpected receipt");
  const address = receipt.contractAddress;
  const contract = { address, abi: CAMPAIGN_REGISTRY_ABI };
  const [storedAdmin, storedRecorder, code, block] = await Promise.all([
    client.readContract({ ...contract, functionName: "administrator" }),
    client.readContract({ ...contract, functionName: "recorder" }),
    client.getBytecode({ address }), client.getBlock({ blockNumber: receipt.blockNumber }),
  ]);
  if (!code || code === "0x" || block.hash !== receipt.blockHash || (storedAdmin as Address).toLowerCase() !== administrator.address.toLowerCase() || (storedRecorder as Address).toLowerCase() !== recorder.address.toLowerCase()) throw new Error("Deployment check: deployed state mismatch");
  Object.assign(journal, { status: "DEPLOYED", address, deploymentBlock: String(receipt.blockNumber), deploymentBlockHash: receipt.blockHash, runtimeBytecodeHash: keccak256(code), deploymentGasUsed: String(receipt.gasUsed), explorer: `${arbitrumSepolia.blockExplorers.default.url}/address/${address}` });
  await save();
  if (funding) {
    const fundingHash = await wallet.sendTransaction({ to: recorder.address, value: funding, gas: fundingGas, gasPrice });
    journal.recorderFundingTransactionHash = fundingHash; journal.recorderFundingWei = String(funding); await save();
    console.log(JSON.stringify({ phase: "recorder_funding_sent", transactionHash: fundingHash }));
    const funded = await client.waitForTransactionReceipt({ hash: fundingHash, confirmations: 2, timeout: 180000 });
    if (funded.status !== "success") throw new Error("Deployment check: recorder funding failed");
  }
  journal.status = "DEPLOYED_AND_RECORDER_FUNDED";
  journal.checkedAt = new Date().toISOString(); await save();
  console.log(JSON.stringify({ phase: "complete", address, chainId: 421614, deploymentTransactionHash: deploymentHash, recorder: recorder.address, recorderBalanceETH: formatEther(await client.getBalance({ address: recorder.address })), explorer: journal.explorer, journal: output.pathname }));
}
await main().catch(error => {
  const message = error instanceof Error && error.message.startsWith("Deployment check:") ? error.message : "Deployment RPC or filesystem operation failed; inspect the journal before retrying. Credentials suppressed.";
  console.error(message);
  process.exitCode = 1;
});

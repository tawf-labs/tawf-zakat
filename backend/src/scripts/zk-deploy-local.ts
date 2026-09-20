/** Deploy the pinned #108 pair to a loopback Anvil instance only. */
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { join } from "node:path";
const url = process.env.ZK_RPC_URL ?? "http://127.0.0.1:8545";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("Only local RPC is supported.");
const key = process.env.ZK_RELAY_PRIVATE_KEY;
const institution = process.env.ZK_INSTITUTION_ID;
if (!key || !institution) throw new Error("Set ZK_RELAY_PRIVATE_KEY (funded local test account) and ZK_INSTITUTION_ID.");
const account = privateKeyToAccount(key as Hex);
const publicClient = createPublicClient({ chain: foundry, transport: http(url) });
if (await publicClient.getChainId() !== foundry.id) throw new Error("Expected local chain 31337.");
const wallet = createWalletClient({ account, chain: foundry, transport: http(url) });
async function deploy(name: string, args: unknown[] = []) {
  const artifact = await Bun.file(join(import.meta.dir, `../../../sc/out/${name}.sol/${name}.json`)).json();
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Deployment failed.");
  console.log(`${name}: ${receipt.contractAddress}; deployment gas ${receipt.gasUsed}`);
  return { address: receipt.contractAddress, abi: artifact.abi };
}
const verifier = await deploy("Groth16Verifier");
const registry = await deploy("ContributionProofRegistry", [verifier.address, account.address]);
const hash = await wallet.writeContract({ address: registry.address, abi: registry.abi, functionName: "enrollInstitution", args: [institution, account.address] });
if ((await publicClient.waitForTransactionReceipt({ hash })).status !== "success") throw new Error("Enrollment failed.");
console.log(`ZK_REGISTRY_ADDRESS=${registry.address}`);

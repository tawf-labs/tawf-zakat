import { createWalletClient, createPublicClient, http, getAddress, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const roleAddress = (key: string) => {
    if (!process.env[key]) throw new Error(`${key} is required`);
    const address = getAddress(process.env[key]!);
    if (address === zeroAddress) throw new Error(`${key} must not be zero`);
    return address;
  };
  const admin = roleAddress("DEPLOY_ADMIN_ADDRESS");
  const relayer = roleAddress("DEPLOY_RELAYER_ADDRESS");
  const dps = roleAddress("DEPLOY_DPS_ADDRESS");
  const auditor = roleAddress("DEPLOY_AUDITOR_ADDRESS");
  if (new Set([admin, dps, auditor].map(a => a.toLowerCase())).size !== 3 || auditor.toLowerCase() === relayer.toLowerCase()) {
    throw new Error("Use separate admin, DPS and auditor wallets; auditor must not be the relayer");
  }
  console.log(JSON.stringify({ chainId: 421614, admin, relayer, dps, auditor, deployments: ["MockUSDC", "ZakatProtocolL1"], seedTransactions: 0 }));
  if (!process.argv.includes("--broadcast")) {
    console.log("Dry run only. Review role addresses; --broadcast sends two testnet deployment transactions.");
    return;
  }
  if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error("DEPLOYER_PRIVATE_KEY is required; no built-in key is used");
  const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
  const rpc = process.env.SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpc) });
  if (await publicClient.getChainId() !== 421614) throw new Error("Wrong RPC chain");
  if (await publicClient.getBalance({ address: account.address }) === 0n) throw new Error("Deployer needs testnet ETH");
  const wallet = createWalletClient({ account, chain: arbitrumSepolia, transport: http(rpc) });
  const artifact = (name: string) => JSON.parse(readFileSync(resolve(import.meta.dir, `../../../sc/out/${name}.sol/${name}.json`), "utf8"));
  const deploy = async (name: string, args: readonly unknown[]) => {
    const compiled = artifact(name);
    const hash = await wallet.deployContract({ abi: compiled.abi, bytecode: compiled.bytecode.object as Hex, args });
    console.log(JSON.stringify({ contract: name, txHash: hash }));
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} deployment failed`);
    return receipt;
  };
  const usdc = await deploy("MockUSDC", []);
  const protocol = await deploy("ZakatProtocolL1", [usdc.contractAddress, admin, relayer, dps, auditor]);
  const result = { chainId: 421614, protocol: protocol.contractAddress, usdc: usdc.contractAddress,
    deploymentBlock: String(protocol.blockNumber), admin, relayer, dps, auditor };
  writeFileSync(resolve(import.meta.dir, `../../deployment-${Date.now()}.json.bak`), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
  console.log("No database or application config was changed. Configure both apps and verify roles before enabling the indexer.");
}

main().catch(() => {
  console.error("Deployment failed. Check required role addresses, fresh deployer key, Foundry artifacts and testnet RPC/balance. No automatic retry is performed.");
  process.exitCode = 1;
});

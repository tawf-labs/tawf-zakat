import { createWalletClient, createPublicClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import fs from "fs";
import path from "path";

// Load ABIs and Bytecodes from Foundry compilation
const zakatArtifactPath = path.resolve(__dirname, "../../../sc/out/ZakatProtocolL1.sol/ZakatProtocolL1.json");
const mockUsdcArtifactPath = path.resolve(__dirname, "../../../sc/out/MockUSDC.sol/MockUSDC.json");

const zakatArtifact = JSON.parse(fs.readFileSync(zakatArtifactPath, "utf8"));
const mockUsdcArtifact = JSON.parse(fs.readFileSync(mockUsdcArtifactPath, "utf8"));

async function main() {
  console.log("=================================================================");
  console.log("🚀 DEPLOYING ZAKAT PROTOCOL TO ARBITRUM SEPOLIA (CHAIN ID: 421614)");
  console.log("=================================================================");

  const privateKey = (process.env.PRIVATE_KEY || "0xa405eefba6b7795f28a6ca2cb3fb55bdafbb6a4efba7b7b9e047f113f4a28d61") as `0x${string}`;
  const account = privateKeyToAccount(privateKey);

  const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";

  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: arbitrumSepolia,
    transport: http(rpcUrl),
  });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`👤 Deployer Address: ${account.address}`);
  console.log(`💰 ETH Balance:      ${formatEther(balance)} ETH`);

  if (balance === 0n) {
    throw new Error("❌ Deployer balance is 0 on Arbitrum Sepolia. Please fund the deployer address.");
  }

  // 1. Deploy MockUSDC with Faucet for free minting on Arbitrum Sepolia
  console.log("\n📦 1. Deploying MockUSDC (6 Decimals + Free Mint Faucet)...");
  const usdcDeployTx = await walletClient.deployContract({
    abi: mockUsdcArtifact.abi,
    bytecode: mockUsdcArtifact.bytecode.object as `0x${string}`,
    args: [],
  });
  console.log(`⏳ Waiting for MockUSDC deployment tx: ${usdcDeployTx}`);
  const usdcReceipt = await publicClient.waitForTransactionReceipt({ hash: usdcDeployTx });
  const usdcAddress = usdcReceipt.contractAddress!;
  console.log(`✅ MockUSDC deployed at: ${usdcAddress}`);

  // Mint initial test balance to deployer
  console.log("🪙 Minting 1,000,000 USDC to deployer...");
  const mintTx = await walletClient.writeContract({
    address: usdcAddress,
    abi: mockUsdcArtifact.abi,
    functionName: "mint",
    args: [account.address, 1_000_000n * 1_000_000n], // 1M USDC (6 decimals)
  });
  await publicClient.waitForTransactionReceipt({ hash: mintTx });
  console.log(`✅ Minted 1,000,000 USDC (tx: ${mintTx})`);

  // 2. Deploy ZakatProtocolL1
  console.log("\n📦 2. Deploying ZakatProtocolL1 on Arbitrum Sepolia...");
  const zakatDeployTx = await walletClient.deployContract({
    abi: zakatArtifact.abi,
    bytecode: zakatArtifact.bytecode.object as `0x${string}`,
    args: [
      usdcAddress,       // _usdcAddress
      account.address,   // _admin
      account.address,   // _relayer
      account.address,   // _dps (Dewan Pengawas Syariah)
      account.address,   // _auditor
    ],
  });
  console.log(`⏳ Waiting for ZakatProtocolL1 deployment tx: ${zakatDeployTx}`);
  const zakatReceipt = await publicClient.waitForTransactionReceipt({ hash: zakatDeployTx });
  const zakatAddress = zakatReceipt.contractAddress!;
  console.log(`✅ ZakatProtocolL1 deployed at: ${zakatAddress}`);

  console.log("\n=================================================================");
  console.log("🎉 ARBITRUM SEPOLIA DEPLOYMENT SUMMARY");
  console.log("=================================================================");
  console.log(`Network:              Arbitrum Sepolia (Chain ID: 421614)`);
  console.log(`RPC URL:              ${rpcUrl}`);
  console.log(`ZakatProtocolL1:      ${zakatAddress}`);
  console.log(`USDC Contract:        ${usdcAddress}`);
  console.log(`Deployer / Admin:     ${account.address}`);
  console.log(`Arbiscan Explorer:    https://sepolia.arbiscan.io/address/${zakatAddress}`);
  console.log("=================================================================\n");

  return {
    zakatAddress,
    usdcAddress,
    deployer: account.address,
    rpcUrl,
  };
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});

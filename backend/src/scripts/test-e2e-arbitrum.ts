import { createWalletClient, createPublicClient, http, parseUnits, formatUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { CONTRACT_CONFIG } from "../config";
import fs from "fs";
import path from "path";

const zakatArtifactPath = path.resolve(__dirname, "../../../sc/out/ZakatProtocolL1.sol/ZakatProtocolL1.json");
const mockUsdcArtifactPath = path.resolve(__dirname, "../../../sc/out/MockUSDC.sol/MockUSDC.json");

const zakatArtifact = JSON.parse(fs.readFileSync(zakatArtifactPath, "utf8"));
const mockUsdcArtifact = JSON.parse(fs.readFileSync(mockUsdcArtifactPath, "utf8"));

async function testArbitrumE2E() {
  console.log("=================================================================");
  console.log("🧪 TESTING LIVE ON-CHAIN TRANSACTIONS ON ARBITRUM SEPOLIA");
  console.log("=================================================================");

  const privateKey = (process.env.PRIVATE_KEY || "0xa405eefba6b7795f28a6ca2cb3fb55bdafbb6a4efba7b7b9e047f113f4a28d61") as `0x${string}`;
  const account = privateKeyToAccount(privateKey);
  const rpcUrl = "https://sepolia-rollup.arbitrum.io/rpc";

  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: arbitrumSepolia,
    transport: http(rpcUrl),
  });

  const zakatAddress = CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS;
  const usdcAddress = CONTRACT_CONFIG.SEPOLIA_USDC_ADDRESS;

  console.log(`📍 Contract: ${zakatAddress}`);
  console.log(`📍 USDC:     ${usdcAddress}`);
  console.log(`👤 Signer:   ${account.address}`);

  // 1. Approve USDC for ZakatProtocol
  console.log("\n1️⃣ Approving 500 USDC for ZakatProtocol on Arbitrum Sepolia...");
  const approveAmount = parseUnits("500", 6);
  const approveTx = await walletClient.writeContract({
    address: usdcAddress,
    abi: mockUsdcArtifact.abi,
    functionName: "approve",
    args: [zakatAddress, approveAmount],
  });
  console.log(`⏳ Waiting for approve tx: ${approveTx}`);
  await publicClient.waitForTransactionReceipt({ hash: approveTx });
  console.log(`✅ Approved (https://sepolia.arbiscan.io/tx/${approveTx})`);

  // 2. Deposit 100 USDC to Protocol
  console.log("\n2️⃣ Depositing 100 USDC to Protocol...");
  const depositAmount = parseUnits("100", 6);
  const depositTx = await walletClient.writeContract({
    address: zakatAddress,
    abi: zakatArtifact.abi,
    functionName: "depositUSDC",
    args: [depositAmount, false, "0x0000000000000000000000000000000000000000000000000000000000000000"],
  });
  console.log(`⏳ Waiting for deposit tx: ${depositTx}`);
  await publicClient.waitForTransactionReceipt({ hash: depositTx });
  console.log(`✅ Deposited 100 USDC (https://sepolia.arbiscan.io/tx/${depositTx})`);

  // 3. Record Fiat Batch Settlement on-chain
  const batchId = BigInt(Math.floor(Date.now() / 1000) % 1000000);
  console.log(`\n3️⃣ Recording Fiat Batch #${batchId} Settlement...`);
  const mockRoot = "0x8b926f1457b19b6b56ae010d1fefa7012ee61e25170b2e56f92e0cc22684a593" as Hex;
  const batchTx = await walletClient.writeContract({
    address: zakatAddress,
    abi: zakatArtifact.abi,
    functionName: "recordFiatBatchSettlement",
    args: [batchId, mockRoot, 25000000n],
  });
  console.log(`⏳ Waiting for batch tx: ${batchTx}`);
  await publicClient.waitForTransactionReceipt({ hash: batchTx });
  console.log(`✅ Recorded Batch Settlement (https://sepolia.arbiscan.io/tx/${batchTx})`);

  // 4. Propose Disbursement
  console.log("\n4️⃣ Proposing Disbursement for Asnaf Fakir...");
  const benHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as Hex;
  const proposeTx = await walletClient.writeContract({
    address: zakatAddress,
    abi: zakatArtifact.abi,
    functionName: "proposeDisbursement",
    args: [
      1, // currencyType: 1 (USDC)
      parseUnits("50", 6), // 50 USDC
      1, // Asnaf: Fakir
      benHash,
      "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
      202609n,
      account.address,
    ],
  });
  console.log(`⏳ Waiting for propose tx: ${proposeTx}`);
  await publicClient.waitForTransactionReceipt({ hash: proposeTx });
  console.log(`✅ Proposed Proposal (https://sepolia.arbiscan.io/tx/${proposeTx})`);

  // 5. Read Proposal Counter & Balances
  const proposalCount = await publicClient.readContract({
    address: zakatAddress,
    abi: zakatArtifact.abi,
    functionName: "proposalCounter",
  });
  const mustahikVaultUSDC = await publicClient.readContract({
    address: zakatAddress,
    abi: zakatArtifact.abi,
    functionName: "mustahikVaultUSDC",
  });
  const amilTreasuryUSDC = await publicClient.readContract({
    address: zakatAddress,
    abi: zakatArtifact.abi,
    functionName: "amilTreasuryUSDC",
  });

  console.log("\n=================================================================");
  console.log("📊 ARBITRUM SEPOLIA ON-CHAIN STATE");
  console.log("=================================================================");
  console.log(`Total Proposals:        ${proposalCount}`);
  console.log(`Mustahik Vault USDC:    ${formatUnits(mustahikVaultUSDC as bigint, 6)} USDC (87.5%)`);
  console.log(`Amil Treasury USDC:     ${formatUnits(amilTreasuryUSDC as bigint, 6)} USDC (12.5% Hak Amil)`);
  console.log("=================================================================\n");

  console.log("🎉 ALL ARBITRUM SEPOLIA TRANSACTIONS EXECUTED SUCCESSFULLY!");
  process.exit(0);
}

testArbitrumE2E().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

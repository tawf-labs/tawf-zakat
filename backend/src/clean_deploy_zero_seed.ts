import { createWalletClient, createPublicClient, http, keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import postgres from "postgres";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("=== 100% CLEAN REDEPLOYMENT & ZERO SEEDING DATABASE RESET ===");

  const privateKey = process.env.PRIVATE_KEY as Hex;
  if (!privateKey) throw new Error("PRIVATE_KEY missing from environment");
  const account = privateKeyToAccount(privateKey);
  const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });

  const safeAddress = "0xb4E4253e2aFfdC0710Cb9394b8C4E935F11B00f1";
  const usdcAddress = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
  const auditorAddress = "0xe8A4Ee352B95A4FC08667Df5d85c167006FE2A2f"; // Wallet C

  console.log("Deployer (Admin & Relayer):", account.address);
  console.log("DPS (Safe 2-of-3 Multisig):", safeAddress);
  console.log("Auditor (Wallet C):        ", auditorAddress);

  // 1. Load Artifact
  const artifactPath = path.resolve(__dirname, "../../sc/out/ZakatProtocolL1.sol/ZakatProtocolL1.json");
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const abi = artifact.abi;
  const bytecode = artifact.bytecode.object as Hex;

  // 2. Deploy fresh ZakatProtocolL1
  console.log("\n[1/4] Deploying pristine ZakatProtocolL1 to Ethereum Sepolia...");
  const deployTx = await walletClient.deployContract({
    abi,
    bytecode,
    args: [
      usdcAddress,
      account.address, // Admin
      account.address, // Relayer
      safeAddress,     // DPS
      auditorAddress,  // Auditor (Wallet C)
    ],
  });
  console.log("Deploy TxHash:", deployTx);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: deployTx });
  const newContractAddress = receipt.contractAddress;
  if (!newContractAddress) throw new Error("Contract address missing from receipt");
  console.log(`>>> BRAND NEW CONTRACT DEPLOYED: ${newContractAddress} (Block ${receipt.blockNumber}) <<<`);

  // 3. Grant Safe Multi-Sig Admin & Relayer roles for full governance flexibility
  console.log("\n[2/4] Granting DEFAULT_ADMIN_ROLE and RELAYER_ROLE to Safe Wallet...");
  const defaultAdminRole = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const relayerRole = keccak256(toHex("RELAYER_ROLE"));
  const shariaSupervisorRole = keccak256(toHex("SHARIA_SUPERVISOR_ROLE"));
  const auditorRole = keccak256(toHex("AUDITOR_ROLE"));

  const grantTx1 = await walletClient.writeContract({
    address: newContractAddress,
    abi,
    functionName: "grantRole",
    args: [defaultAdminRole, safeAddress],
  });
  await publicClient.waitForTransactionReceipt({ hash: grantTx1 });

  const grantTx2 = await walletClient.writeContract({
    address: newContractAddress,
    abi,
    functionName: "grantRole",
    args: [relayerRole, safeAddress],
  });
  await publicClient.waitForTransactionReceipt({ hash: grantTx2 });
  console.log("Safe DPS granted administrative permissions!");

  // 4. Wipe Database Completely (ZERO ROWS / NO SEED)
  console.log("\n[3/4] Wiping Neon PostgreSQL Database (Zero Seed / Clean Slate)...");
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is missing");
  const sql = postgres(dbUrl);
  await sql`TRUNCATE TABLE disbursement_proposals RESTART IDENTITY CASCADE;`;
  await sql`TRUNCATE TABLE merkle_batches RESTART IDENTITY CASCADE;`;
  await sql`TRUNCATE TABLE donations RESTART IDENTITY CASCADE;`;
  await sql`TRUNCATE TABLE onchain_events RESTART IDENTITY CASCADE;`;
  await sql`TRUNCATE TABLE role_members RESTART IDENTITY CASCADE;`;
  await sql`TRUNCATE TABLE indexer_state RESTART IDENTITY CASCADE;`;

  // Seed Initial Clean Indexer State from deployment block
  await sql`
    INSERT INTO indexer_state (contract_address, last_indexed_block, last_sync_at, status, total_events_indexed)
    VALUES (${newContractAddress}, ${Number(receipt.blockNumber)}, NOW(), 'HEALTHY', 0);
  `;

  // Seed Initial Role Members Roster
  await sql`
    INSERT INTO role_members (role_hash, role_name, account_address, is_active, granted_at_block)
    VALUES 
      (${defaultAdminRole}, 'DEFAULT_ADMIN_ROLE', ${account.address}, true, ${Number(receipt.blockNumber)}),
      (${defaultAdminRole}, 'DEFAULT_ADMIN_ROLE', ${safeAddress}, true, ${Number(receipt.blockNumber)}),
      (${relayerRole}, 'RELAYER_ROLE', ${account.address}, true, ${Number(receipt.blockNumber)}),
      (${shariaSupervisorRole}, 'SHARIA_SUPERVISOR_ROLE', ${safeAddress}, true, ${Number(receipt.blockNumber)}),
      (${auditorRole}, 'AUDITOR_ROLE', ${auditorAddress}, true, ${Number(receipt.blockNumber)});
  `;

  await sql.end();
  console.log("Database completely emptied and initialized to clean 0-state!");

  // 5. Update Config Files
  console.log("\n[4/4] Updating configuration files...");
  // Update backend/.env
  const backendEnvPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(backendEnvPath)) {
    let envContent = fs.readFileSync(backendEnvPath, "utf8");
    envContent = envContent.replace(
      /ZAKAT_PROTOCOL_L1_ADDRESS=.*/g,
      `ZAKAT_PROTOCOL_L1_ADDRESS=${newContractAddress}`
    );
    fs.writeFileSync(backendEnvPath, envContent);
    console.log("Updated backend/.env ->", newContractAddress);
  }

  // Update backend/src/config.ts
  const backendConfigPath = path.resolve(__dirname, "config.ts");
  if (fs.existsSync(backendConfigPath)) {
    let configContent = fs.readFileSync(backendConfigPath, "utf8");
    configContent = configContent.replace(
      /0x[a-fA-F0-9]{40}/g,
      (match) => (match.toLowerCase() === usdcAddress.toLowerCase() ? usdcAddress : newContractAddress)
    );
    fs.writeFileSync(backendConfigPath, configContent);
    console.log("Updated backend/src/config.ts ->", newContractAddress);
  }

  // Update frontend/src/lib/contracts.ts
  const feContractsPath = path.resolve(__dirname, "../../frontend/src/lib/contracts.ts");
  if (fs.existsSync(feContractsPath)) {
    let feContent = fs.readFileSync(feContractsPath, "utf8");
    feContent = feContent.replace(
      /export const ZAKAT_PROTOCOL_L1_ADDRESS = .*/g,
      `export const ZAKAT_PROTOCOL_L1_ADDRESS = "${newContractAddress}";`
    );
    fs.writeFileSync(feContractsPath, feContent);
    console.log("Updated frontend/src/lib/contracts.ts ->", newContractAddress);
  }

  console.log("\n=== 100% CLEAN DEPLOY & EMPTY DATABASE FINISHED! ===");
  console.log("Smart Contract Address:  ", newContractAddress);
  console.log("Admin / Relayer Address: ", account.address);
  console.log("DPS (Safe Multisig):     ", safeAddress);
  console.log("Auditor (Wallet C):       ", auditorAddress);
  console.log("Deployment Block:        ", Number(receipt.blockNumber));
  console.log("Database State:           0 Proposals, 0 Batches, 0 Donations");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});

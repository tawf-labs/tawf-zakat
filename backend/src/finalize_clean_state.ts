import postgres from "postgres";
import * as fs from "fs";
import * as path from "path";
import { keccak256, toHex } from "viem";

async function main() {
  const newContractAddress = "0x2d6fe1e81b633e8a310d1365524f4fb47024f7d7";
  const blockNumber = 11611777;
  const adminAddress = "0x5e9B652C4E8a013f6fAb69F0b55377c408B59968";
  const safeAddress = "0xb4E4253e2aFfdC0710Cb9394b8C4E935F11B00f1";
  const auditorAddress = "0xe8A4Ee352B95A4FC08667Df5d85c167006FE2A2f";
  const usdcAddress = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

  console.log("=== FINALIZING CLEAN 0-STATE & DB RESET ===");
  console.log("Contract:", newContractAddress);
  console.log("Block:   ", blockNumber);

  const defaultAdminRole = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const relayerRole = keccak256(toHex("RELAYER_ROLE"));
  const shariaSupervisorRole = keccak256(toHex("SHARIA_SUPERVISOR_ROLE"));
  const auditorRole = keccak256(toHex("AUDITOR_ROLE"));

  // 1. Wipe Database Completely (ZERO ROWS / NO SEED)
  console.log("\n[1/3] Wiping Neon PostgreSQL Database (Zero Seed / Clean Slate)...");
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
    INSERT INTO indexer_state (indexer_key, last_indexed_block, last_sync_at, status, total_events_indexed)
    VALUES ('sepolia_zakat_l1', ${blockNumber}, NOW(), 'HEALTHY', 0)
    ON CONFLICT (indexer_key) DO UPDATE SET 
      last_indexed_block = ${blockNumber},
      last_sync_at = NOW(),
      status = 'HEALTHY',
      total_events_indexed = 0;
  `;

  // Seed Initial Role Members Roster
  await sql`
    INSERT INTO role_members (role_hash, role_name, account_address, is_active, granted_at_block)
    VALUES 
      (${defaultAdminRole}, 'DEFAULT_ADMIN_ROLE', ${adminAddress}, true, ${blockNumber}),
      (${defaultAdminRole}, 'DEFAULT_ADMIN_ROLE', ${safeAddress}, true, ${blockNumber}),
      (${relayerRole}, 'RELAYER_ROLE', ${adminAddress}, true, ${blockNumber}),
      (${shariaSupervisorRole}, 'SHARIA_SUPERVISOR_ROLE', ${safeAddress}, true, ${blockNumber}),
      (${auditorRole}, 'AUDITOR_ROLE', ${auditorAddress}, true, ${blockNumber});
  `;

  await sql.end();
  console.log("Database completely emptied and initialized to clean 0-state!");

  // 2. Update Config Files
  console.log("\n[2/3] Updating configuration files...");
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
  console.log("Admin / Relayer Address: ", adminAddress);
  console.log("DPS (Safe Multisig):     ", safeAddress);
  console.log("Auditor (Wallet C):       ", auditorAddress);
  console.log("Deployment Block:        ", blockNumber);
  console.log("Database State:           0 Proposals, 0 Batches, 0 Donations");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});

import { createPublicClient, formatEther, getAddress, http, parseAbi, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import postgres from "postgres";
import { CONTRACT_CONFIG } from "../config";
import { GOVERNANCE_ROLE_HASHES } from "../governance-roles";

// Read-only inventory. Never print connection strings, keys, or raw provider errors.
const rpc = createPublicClient({ transport: http(CONTRACT_CONFIG.RPC_URL, { retryCount: 0, timeout: 15000 }) });
const abi = parseAbi([
  "function proposalCounter() view returns (uint256)",
  "function totalCollectedIDR() view returns (uint256)",
  "function totalCollectedUSDC() view returns (uint256)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function usdcToken() view returns (address)",
]);
const address = getAddress(CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS);
const key = process.env.PRIVATE_KEY;
const signer = key ? privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`).address : undefined;
try {
  const [chainId, bytecode, counter, fiat, usdc, token] = await Promise.all([
    rpc.getChainId(), rpc.getCode({ address }),
    ...(["proposalCounter", "totalCollectedIDR", "totalCollectedUSDC", "usdcToken"] as const).map(functionName => rpc.readContract({address, abi, functionName})),
  ]);
  console.log(JSON.stringify({ chainId, address, hasCode: !!bytecode && bytecode !== "0x", proposalCounter: String(counter), totalCollectedIDR: String(fiat), totalCollectedUSDC: String(usdc), token, signer }));
  if (signer) {
    console.log(JSON.stringify({ signer, balanceETH: formatEther(await rpc.getBalance({ address: signer })),
      admin: await rpc.readContract({ address, abi, functionName: "hasRole", args: [zeroHash, signer] }),
      relayer: await rpc.readContract({ address, abi, functionName: "hasRole", args: [GOVERNANCE_ROLE_HASHES.RELAYER_ROLE, signer] }),
    }));
  }
} catch { console.error("RPC inspection failed (details suppressed to protect provider credentials)"); process.exitCode = 1; }
if (process.env.DATABASE_URL) {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15 });
  try {
    const tables = await sql`select table_name from information_schema.tables where table_schema='public' order by table_name`;
    const counts: Record<string, number> = {};
    for (const { table_name } of tables) {
      if (["donations", "merkle_batches", "disbursement_proposals", "onchain_events", "role_members", "auditor_profiles", "institutions", "institution_memberships", "evidence_preparations", "evidence_sources", "evidence_files"].includes(table_name)) {
        const [row] = await sql`select count(*)::int as count from ${sql(table_name)}`;
        counts[table_name] = row!.count;
      }
    }
    console.log(JSON.stringify({ databaseTables: tables.map(t => t.table_name), counts }));
  } catch { console.error("Database inspection failed (connection details suppressed)"); process.exitCode = 1; }
  finally { await sql.end({ timeout: 2 }); }
}

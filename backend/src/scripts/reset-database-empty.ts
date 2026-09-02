import { db } from "../db/index";
import * as schema from "../db/schema";
import { dataStore } from "../store";
import { sql } from "drizzle-orm";

async function resetDatabaseEmpty() {
  console.log("=================================================================");
  console.log("🧹 COMPLETE DATABASE RESET (CLEAN SLATE / 0 ROWS)");
  console.log("=================================================================");

  if (!db) {
    console.error("❌ Database connection is not available.");
    process.exit(1);
  }

  try {
    // 1. Wipe all transactional and proposal data
    console.log("🗑️ Wiping all proposals, donations, batches, and events...");
    await db.execute(sql`DELETE FROM disbursement_proposals;`);
    await db.execute(sql`DELETE FROM donations;`);
    await db.execute(sql`DELETE FROM merkle_batches;`);
    await db.execute(sql`DELETE FROM onchain_events;`);
    await db.execute(sql`DELETE FROM indexer_state;`);
    await db.execute(sql`DELETE FROM role_members;`);
    console.log("✅ All tables wiped clean (0 rows)!");

    // 2. Clear in-memory stores
    dataStore.proposals.clear();
    dataStore.donations.clear();
    dataStore.batches.clear();

    // 3. Initialize fresh indexer state for Arbitrum Sepolia
    console.log("\n⚙️ Initializing indexer state for Arbitrum Sepolia...");
    await db.insert(schema.indexerState).values({
      indexerKey: "arbitrum_sepolia_zakat_l1",
      lastIndexedBlock: 304590800,
      status: "SYNCING",
      totalEventsIndexed: 0,
    });

    // 4. Initialize governance role members
    console.log("👥 Initializing governance role roster...");
    await db.insert(schema.roleMembers).values([
      {
        roleHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        roleName: "DEFAULT_ADMIN_ROLE",
        accountAddress: "0x5e9B652C4E8a013f6fAb69F0b55377c408B59968",
        label: "Amil Operasional BAZNAS/LAZ",
        grantedBy: "0x5e9B652C4E8a013f6fAb69F0b55377c408B59968",
        txHash: "0x72337598476f98e315d7687cc8d4894ed28f1be926cbede0cab440fc65a28fb4",
      },
      {
        roleHash: "0x59a1c48e5837ad7a7f3dcedcbe129bf3249ec4fbf651fd4f5e2600ead39fe2f5",
        roleName: "SHARIA_SUPERVISOR_ROLE",
        accountAddress: "0x5e9B652C4E8a013f6fAb69F0b55377c408B59968",
        label: "Dewan Pengawas Syariah (DPS)",
        grantedBy: "0x5e9B652C4E8a013f6fAb69F0b55377c408B59968",
        txHash: "0x72337598476f98e315d7687cc8d4894ed28f1be926cbede0cab440fc65a28fb4",
      },
      {
        roleHash: "0x3003ae5751e460db709762380ceeb0a0a748c8f2a9e2fe711468f692be74570c",
        roleName: "AUDITOR_ROLE",
        accountAddress: "0x37C2bE50D1150c265691F46A1d8F07a3D039B6F3",
        label: "KAP Sharia Trust & Public Auditor",
        grantedBy: "0x5e9B652C4E8a013f6fAb69F0b55377c408B59968",
        txHash: "0x72337598476f98e315d7687cc8d4894ed28f1be926cbede0cab440fc65a28fb4",
      },
      {
        roleHash: "0xe2b7fb3b832174769106daebcfd6d1970523240dda11281102db9363b83b0dc4",
        roleName: "RELAYER_ROLE",
        accountAddress: "0x5e9B652C4E8a013f6fAb69F0b55377c408B59968",
        label: "Gasless Relayer Engine",
        grantedBy: "0x5e9B652C4E8a013f6fAb69F0b55377c408B59968",
        txHash: "0x72337598476f98e315d7687cc8d4894ed28f1be926cbede0cab440fc65a28fb4",
      },
    ]);

    console.log("\n=================================================================");
    console.log("✨ DATABASE IS NOW COMPLETELY RESET (0 PROPOSALS, 0 DONATIONS)!");
    console.log("   Ready for 100% fresh manual end-to-end testing.");
    console.log("=================================================================\n");
    process.exit(0);
  } catch (err) {
    console.error("❌ Reset failed:", err);
    process.exit(1);
  }
}

resetDatabaseEmpty();

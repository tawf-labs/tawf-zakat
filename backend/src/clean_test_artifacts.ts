import postgres from "postgres";

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is missing");
  const sql = postgres(dbUrl);

  console.log("=== CLEANING UP TEST ARTIFACTS FROM DATABASE ===");

  // 1. Clean all test disbursement proposals
  console.log("[1/3] Truncating disbursement_proposals table...");
  await sql`TRUNCATE TABLE disbursement_proposals RESTART IDENTITY CASCADE;`;

  // 2. Clean test donations (Keep only the 2 real paid donations from Midtrans test)
  console.log("[2/3] Cleaning test donations (keeping real user TRX-20260901-3691 & TRX-20260901-5117)...");
  await sql`
    DELETE FROM donations 
    WHERE trx_id NOT IN ('TRX-20260901-3691', 'TRX-20260901-5117');
  `;

  // 3. Clean test merkle batches (Keep only the real on-chain batch #1)
  console.log("[3/3] Cleaning test merkle batches...");
  await sql`
    DELETE FROM merkle_batches 
    WHERE batch_number != 1;
  `;

  // Ensure batch #1 has the exact on-chain tx_hash and values
  await sql`
    UPDATE merkle_batches 
    SET 
      tx_hash = '0x00864829980a49c0c2ab444bba99c899f98ec597c5054a714efd88ca155ebb30',
      merkle_root = '0x39ffd6b45b4133f140d1fbcd0199c9025ce04d63ad68852dbcbbb272ad1206ad',
      total_amount_idr = 6000000,
      item_count = 2,
      status = 'settled_onchain'
    WHERE batch_number = 1;
  `;

  // Update donations to point to batch_id = 1
  await sql`
    UPDATE donations 
    SET 
      batch_id = 1,
      status = 'BATCHED'
    WHERE trx_id IN ('TRX-20260901-3691', 'TRX-20260901-5117');
  `;

  const proposalsCount = await sql`SELECT count(*) FROM disbursement_proposals;`;
  const donationsCount = await sql`SELECT count(*) FROM donations;`;
  const batchesCount = await sql`SELECT count(*) FROM merkle_batches;`;

  console.log("\n=== DATABASE CLEANUP COMPLETED! ===");
  console.log("Disbursement Proposals:", proposalsCount[0].count, "rows (Clean 0-state)");
  console.log("Donations:             ", donationsCount[0].count, "rows (2 real paid donations)");
  console.log("Merkle Batches:        ", batchesCount[0].count, "rows (Batch #1 settled on Sepolia)");

  await sql.end();
}

main().catch((err) => {
  console.error("Cleanup error:", err);
  process.exit(1);
});

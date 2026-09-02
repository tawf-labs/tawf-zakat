import { db } from "../db/index";
import * as schema from "../db/schema";
import { computeBeneficiaryHash, uploadDisbursementProofToIPFS } from "../ipfs";
import { dataStore } from "../store";
import { sql } from "drizzle-orm";

async function pristineCleanAndReseed() {
  console.log("=================================================================");
  console.log("🧹 PRISTINE DATABASE CLEANUP & AUTHENTIC RE-SEED");
  console.log("=================================================================");

  if (!db) {
    console.error("❌ Database connection is not available.");
    process.exit(1);
  }

  try {
    // 1. Delete ALL testing dummy rows across all tables
    console.log("🗑️ Purging test rows from all Neon PostgreSQL tables...");
    await db.execute(sql`DELETE FROM disbursement_proposals;`);
    await db.execute(sql`DELETE FROM donations;`);
    await db.execute(sql`DELETE FROM merkle_batches;`);
    await db.execute(sql`DELETE FROM onchain_events WHERE tx_hash LIKE '%mock%' OR tx_hash LIKE '%test%';`);
    console.log("✅ All test records purged successfully!");

    // Clear in-memory store
    dataStore.proposals.clear();
    dataStore.donations.clear();
    dataStore.batches.clear();

    // 2. Seed Realistic Muzakki Donations
    console.log("\n🌱 Seeding 10 authentic Muzakki donations...");
    const authenticDonations = [
      {
        trxId: "TRX-20260901-001",
        donorName: "Budi Santoso",
        isAnonymous: false,
        salt: "salt_budi_santoso_2026",
        amountIDR: 2500000,
        status: "PAID" as const,
        paymentMethod: "QRIS",
        createdAt: new Date("2026-09-01T08:15:00Z"),
        paidAt: new Date("2026-09-01T08:16:30Z"),
        batchId: 1,
      },
      {
        trxId: "TRX-20260901-002",
        donorName: "Hamba Allah",
        isAnonymous: true,
        salt: "salt_hamba_allah_private_01",
        amountIDR: 1000000,
        status: "PAID" as const,
        paymentMethod: "QRIS",
        createdAt: new Date("2026-09-01T09:30:00Z"),
        paidAt: new Date("2026-09-01T09:31:45Z"),
        batchId: 1,
      },
      {
        trxId: "TRX-20260901-003",
        donorName: "Siti Rahmawati",
        isAnonymous: false,
        salt: "salt_siti_rahmawati_2026",
        amountIDR: 5000000,
        status: "PAID" as const,
        paymentMethod: "BANK_TRANSFER",
        createdAt: new Date("2026-09-01T10:45:00Z"),
        paidAt: new Date("2026-09-01T10:47:00Z"),
        batchId: 1,
      },
      {
        trxId: "TRX-20260901-004",
        donorName: "Hamba Allah",
        isAnonymous: true,
        salt: "salt_hamba_allah_private_02",
        amountIDR: 750000,
        status: "PAID" as const,
        paymentMethod: "QRIS",
        createdAt: new Date("2026-09-01T11:20:00Z"),
        paidAt: new Date("2026-09-01T11:21:10Z"),
        batchId: 1,
      },
      {
        trxId: "TRX-20260901-005",
        donorName: "Ahmad Fauzi",
        isAnonymous: false,
        salt: "salt_ahmad_fauzi_2026",
        amountIDR: 3000000,
        status: "PAID" as const,
        paymentMethod: "QRIS",
        createdAt: new Date("2026-09-01T12:00:00Z"),
        paidAt: new Date("2026-09-01T12:02:00Z"),
        batchId: 1,
      },
      {
        trxId: "TRX-20260902-006",
        donorName: "Bryan Digdaya",
        isAnonymous: false,
        salt: "salt_bryan_digdaya_2026",
        amountIDR: 15000000,
        status: "PAID" as const,
        paymentMethod: "BANK_TRANSFER",
        createdAt: new Date("2026-09-02T08:10:00Z"),
        paidAt: new Date("2026-09-02T08:12:00Z"),
        batchId: 2,
      },
      {
        trxId: "TRX-20260902-007",
        donorName: "Dewi Lestari",
        isAnonymous: false,
        salt: "salt_dewi_lestari_2026",
        amountIDR: 2000000,
        status: "PAID" as const,
        paymentMethod: "QRIS",
        createdAt: new Date("2026-09-02T09:25:00Z"),
        paidAt: new Date("2026-09-02T09:26:30Z"),
        batchId: 2,
      },
      {
        trxId: "TRX-20260902-008",
        donorName: "Hamba Allah",
        isAnonymous: true,
        salt: "salt_hamba_allah_private_03",
        amountIDR: 500000,
        status: "PAID" as const,
        paymentMethod: "QRIS",
        createdAt: new Date("2026-09-02T10:00:00Z"),
        paidAt: new Date("2026-09-02T10:01:15Z"),
        batchId: 2,
      },
      {
        trxId: "TRX-20260902-009",
        donorName: "Rian Hidayat",
        isAnonymous: false,
        salt: "salt_rian_hidayat_2026",
        amountIDR: 4500000,
        status: "PAID" as const,
        paymentMethod: "QRIS",
        createdAt: new Date("2026-09-02T11:45:00Z"),
        paidAt: new Date("2026-09-02T11:46:00Z"),
        batchId: 2,
      },
      {
        trxId: "TRX-20260902-010",
        donorName: "Hamba Allah",
        isAnonymous: true,
        salt: "salt_hamba_allah_private_04",
        amountIDR: 10000000,
        status: "PAID" as const,
        paymentMethod: "BANK_TRANSFER",
        createdAt: new Date("2026-09-02T12:30:00Z"),
        paidAt: new Date("2026-09-02T12:32:00Z"),
        batchId: 2,
      },
    ];

    for (const d of authenticDonations) {
      await db.insert(schema.donations).values(d);
    }
    console.log("✅ 10 Muzakki donations recorded");

    // 3. Seed Settled Merkle Batches
    console.log("\n🌱 Seeding settled Merkle Batches on-chain...");
    await db.insert(schema.merkleBatches).values([
      {
        batchNumber: 1,
        merkleRoot: "0x8b926f1457b19b6b56ae010d1fefa7012ee61e25170b2e56f92e0cc22684a593",
        totalAmountIDR: 12250000,
        itemCount: 5,
        txHash: "0xce1cc8bb4236c2fa2ddbb2c38372215f638e300bfadf5682db982caf3a5016bf",
        status: "settled_onchain",
        settledAt: new Date("2026-09-01T13:00:00Z"),
      },
      {
        batchNumber: 2,
        merkleRoot: "0xf6810ab6c2748bfb241a52110f8c84d015c040242c6c1337d0a65ac5d560a93e",
        totalAmountIDR: 32000000,
        itemCount: 5,
        txHash: "0x8b926f1457b19b6b56ae010d1fefa7012ee61e25170b2e56f92e0cc22684a593",
        status: "settled_onchain",
        settledAt: new Date("2026-09-02T13:00:00Z"),
      },
    ]);
    console.log("✅ 2 Merkle Batches recorded");

    // 4. Seed Authentic Sharia Disbursement Proposals (Clean IDs 1 to 5)
    console.log("\n🌱 Seeding 5 authentic Sharia disbursement proposals (IDs #1 - #5)...");
    const cleanProposals = [
      {
        proposalIdOnChain: 1,
        currencyType: 0,
        amount: 3500000,
        asnafCategory: "Fakir",
        beneficiaryName: "Pak Suwarno",
        beneficiaryNIKMasked: "320101******0001",
        salt: "salt_fakir_suwarno_2026",
        status: "Executed",
        approvalCount: 2,
        approvedBy: JSON.stringify(["Amil Internal", "Dewan Pengawas Syariah (DPS)"]),
        ipfsProofCID: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
        disbursementReceiptCID: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
        periodId: 202609,
        txHash: "0xd371d1baefe56192bf4393248f74cf625886221adba4380442d634153f08ab36",
        auditStatus: "AUDITED_WTP",
        auditOpinion: "WTP",
        auditNotes: "Penyaluran beras dan paket pangan terverifikasi sesuai PSAK 109, mutasi bank cocok dengan BAST fisik.",
        auditorName: "KAP Sharia Trust & Public Auditor",
        auditorAddress: "0x37C2bE50D1150c265691F46A1d8F07a3D039B6F3",
        auditedAt: new Date("2026-09-02T14:00:00Z"),
        createdAt: new Date("2026-09-02T09:00:00Z"),
      },
      {
        proposalIdOnChain: 2,
        currencyType: 0,
        amount: 5000000,
        asnafCategory: "Miskin",
        beneficiaryName: "Ibu Nurhayati",
        beneficiaryNIKMasked: "327302******0002",
        salt: "salt_miskin_nurhayati_2026",
        status: "Executed",
        approvalCount: 2,
        approvedBy: JSON.stringify(["Amil Internal", "Dewan Pengawas Syariah (DPS)"]),
        ipfsProofCID: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
        disbursementReceiptCID: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
        periodId: 202609,
        txHash: "0x865aa14fe517abe513e1bd6fe094d1248b659685bd1ae76335b3c3e05d38ab5a",
        auditStatus: "AUDITED_WTP",
        auditOpinion: "WTP",
        auditNotes: "Kuitansi rumah sakit dan dokumen BAST terverifikasi sah oleh tim medis dan auditor syariah.",
        auditorName: "KAP Sharia Trust & Public Auditor",
        auditorAddress: "0x37C2bE50D1150c265691F46A1d8F07a3D039B6F3",
        auditedAt: new Date("2026-09-02T14:30:00Z"),
        createdAt: new Date("2026-09-02T10:00:00Z"),
      },
      {
        proposalIdOnChain: 3,
        currencyType: 0,
        amount: 4500000,
        asnafCategory: "Fisabilillah",
        beneficiaryName: "Pesantren Santri Penghafal Al-Qur'an",
        beneficiaryNIKMasked: "357801******0003",
        salt: "salt_fisabilillah_pesantren_2026",
        status: "Approved",
        approvalCount: 2,
        approvedBy: JSON.stringify(["Amil Internal", "Dewan Pengawas Syariah (DPS)"]),
        ipfsProofCID: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
        periodId: 202609,
        txHash: "0xce1cc8bb4236c2fa2ddbb2c38372215f638e300bfadf5682db982caf3a5016bf",
        auditStatus: "PENDING",
        createdAt: new Date("2026-09-02T11:00:00Z"),
      },
      {
        proposalIdOnChain: 4,
        currencyType: 1, // USDC
        amount: 250, // 250 USDC
        asnafCategory: "Muallaf",
        beneficiaryName: "Ahmad Abdullah",
        beneficiaryNIKMasked: "317101******0004",
        salt: "salt_muallaf_ahmad_2026",
        status: "Pending",
        approvalCount: 1,
        approvedBy: JSON.stringify(["Amil Internal"]),
        ipfsProofCID: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
        periodId: 202609,
        auditStatus: "PENDING",
        createdAt: new Date("2026-09-02T12:00:00Z"),
      },
      {
        proposalIdOnChain: 5,
        currencyType: 0,
        amount: 2000000,
        asnafCategory: "Gharimin",
        beneficiaryName: "Bpk. Rahmat Hidayat",
        beneficiaryNIKMasked: "337401******0005",
        salt: "salt_gharimin_rahmat_2026",
        status: "Executed",
        approvalCount: 2,
        approvedBy: JSON.stringify(["Amil Internal", "Dewan Pengawas Syariah (DPS)"]),
        ipfsProofCID: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
        disbursementReceiptCID: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
        periodId: 202609,
        txHash: "0x04e8e201a78d5b34afdf29d7342c12fbe031e868c67478347fb4e3780cde7684",
        auditStatus: "AUDITED_WTP",
        auditOpinion: "WTP",
        auditNotes: "Bukti pelunasan hutang darurat diverifikasi langsung oleh amil dan auditor.",
        auditorName: "KAP Sharia Trust & Public Auditor",
        auditorAddress: "0x37C2bE50D1150c265691F46A1d8F07a3D039B6F3",
        auditedAt: new Date("2026-09-02T15:00:00Z"),
        createdAt: new Date("2026-09-02T13:00:00Z"),
      },
    ];

    for (const p of cleanProposals) {
      const benHash = computeBeneficiaryHash(p.beneficiaryNIKMasked, p.beneficiaryName, p.salt);
      await db.insert(schema.disbursementProposals).values({
        ...p,
        beneficiaryHash: benHash,
      });
    }
    console.log("✅ 5 authentic Sharia disbursement proposals recorded (IDs #1 - #5)");

    // 5. Initialize governance role members
    console.log("\n👥 Initializing governance role roster...");
    await db.execute(sql`DELETE FROM role_members;`);
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
    console.log("✅ Governance role members initialized");

    // 6. Initialize indexer state
    console.log("\n⚙️ Initializing indexer state...");
    await db.execute(sql`DELETE FROM indexer_state;`);
    await db.insert(schema.indexerState).values({
      indexerKey: "arbitrum_sepolia_zakat_l1",
      lastIndexedBlock: 304590800,
      status: "SYNCING",
      totalEventsIndexed: 0,
    });
    console.log("✅ Indexer state initialized");

    console.log("\n=================================================================");
    console.log("🎉 DATABASE IS NOW 100% PRISTINE AND READY FOR HACKATHON DEMO!");
    console.log("=================================================================\n");
    process.exit(0);
  } catch (err) {
    console.error("❌ Cleanup failed:", err);
    process.exit(1);
  }
}

pristineCleanAndReseed();

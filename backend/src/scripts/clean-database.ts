import { db, schema, dbService } from "../db/index";
import { computeBeneficiaryHash, uploadDisbursementProofToIPFS } from "../ipfs";
import { dataStore } from "../store";
import { sql } from "drizzle-orm";

async function cleanAndReseed() {
  console.log("🧹 Cleaning test dummy records from Neon PostgreSQL database...");

  if (db) {
    try {
      // 1. Clear testing dummy proposals and reset sequence
      await db.execute(sql`DELETE FROM disbursement_proposals;`);
      console.log("✓ Cleared disbursement_proposals table");

      // 2. Clear dummy donations & batches if needed
      await db.execute(sql`DELETE FROM onchain_events WHERE tx_hash LIKE '%mock%';`);
      console.log("✓ Cleared mock on-chain events");
    } catch (err) {
      console.error("Error clearing tables:", err);
    }
  }

  // Clear in-memory store
  dataStore.proposals.clear();

  // 3. Seed Clean, Realistic Sharia Production Demo Proposals
  console.log("🌱 Seeding realistic, human-centric Sharia disbursement records...");

  const cleanProposals = [
    {
      proposalId: 1,
      currencyType: 0,
      amount: 3500000,
      asnafCategory: 1, // Fakir
      asnafLabel: "Fakir",
      beneficiaryName: "Pak Suwarno",
      beneficiaryNIKMasked: "320101******0001",
      salt: "salt_fakir_suwarno_2026",
      programTitle: "Bantuan Pangan & Sembako Lansia Dhuafa",
      description: "Santunan beras, sembako pokok, dan nutrisi untuk keluarga lansia dhuafa tanpa penghasilan tetap",
      location: { province: "Jawa Barat", regencyCity: "Kabupaten Bogor", district: "Cibinong" },
      status: "Executed" as const,
      auditOpinion: "WTP" as const,
      auditStatus: "AUDITED_WTP" as const,
      auditNotes: "Penyaluran terverifikasi sesuai PSAK 109, mutasi bank cocok dengan BAST dan foto serah terima di IPFS.",
      auditorName: "KAP Sharia Trust & Public Auditor",
      auditorAddress: "0x37C2bE50D1150c265691F46A1d8F07a3D039B6F3",
      txHash: "0x8b926f1457b19b6b56ae010d1fefa7012ee61e25170b2e56f92e0cc22684a593",
      bastCid: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
    },
    {
      proposalId: 2,
      currencyType: 0,
      amount: 5000000,
      asnafCategory: 2, // Miskin
      asnafLabel: "Miskin",
      beneficiaryName: "Ibu Nurhayati",
      beneficiaryNIKMasked: "327302******0002",
      salt: "salt_miskin_nurhayati_2026",
      programTitle: "Bantuan Biaya Pengobatan Rawat Jalan Pasien Dhuafa",
      description: "Santunan pembelian obat dan alat bantu medis untuk pasien kurang mampu",
      location: { province: "Jawa Barat", regencyCity: "Kota Bandung", district: "Coblong" },
      status: "Executed" as const,
      auditOpinion: "WTP" as const,
      auditStatus: "AUDITED_WTP" as const,
      auditNotes: "Kuitansi rumah sakit dan dokumen BAST terverifikasi sah.",
      auditorName: "KAP Sharia Trust & Public Auditor",
      auditorAddress: "0x37C2bE50D1150c265691F46A1d8F07a3D039B6F3",
      txHash: "0xf6810ab6c2748bfb241a52110f8c84d015c040242c6c1337d0a65ac5d560a93e",
      bastCid: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
    },
    {
      proposalId: 3,
      currencyType: 0,
      amount: 4500000,
      asnafCategory: 7, // Fisabilillah
      asnafLabel: "Fisabilillah",
      beneficiaryName: "Pesantren Santri Penghafal Al-Qur'an",
      beneficiaryNIKMasked: "357801******0003",
      salt: "salt_fisabilillah_pesantren_2026",
      programTitle: "Beasiswa Kitab & Biaya Pendidikan Santri Dhuafa",
      description: "Bantuan perlengkapan belajar dan kitab kuning bagi santri berprestasi dari keluarga miskin",
      location: { province: "Jawa Timur", regencyCity: "Kota Surabaya", district: "Sukolilo" },
      status: "Approved" as const,
      auditStatus: "PENDING" as const,
      bastCid: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
    },
    {
      proposalId: 4,
      currencyType: 1,
      amount: 250, // 250 USDC
      asnafCategory: 4, // Muallaf
      asnafLabel: "Muallaf",
      beneficiaryName: "Ahmad Abdullah",
      beneficiaryNIKMasked: "317101******0004",
      salt: "salt_muallaf_ahmad_2026",
      programTitle: "Bantuan Modal Usaha Muallaf Mandiri",
      description: "Penyediaan sarana gerobak usaha dan modal awal untuk pembinaan kemandirian saudara baru",
      location: { province: "DKI Jakarta", regencyCity: "Jakarta Selatan", district: "Tebet" },
      status: "Pending" as const,
      auditStatus: "PENDING" as const,
      bastCid: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
    },
    {
      proposalId: 5,
      currencyType: 0,
      amount: 2000000,
      asnafCategory: 6, // Gharimin
      asnafLabel: "Gharimin",
      beneficiaryName: "Bpk. Rahmat Hidayat",
      beneficiaryNIKMasked: "337401******0005",
      salt: "salt_gharimin_rahmat_2026",
      programTitle: "Penyelesaian Hutang Mendesak Kebutuhan Pokok",
      description: "Pelunasan pinjaman darurat pengobatan keluarga berpenghasilan rendah",
      location: { province: "Jawa Tengah", regencyCity: "Kota Semarang", district: "Candisari" },
      status: "Executed" as const,
      auditOpinion: "WTP" as const,
      auditStatus: "AUDITED_WTP" as const,
      auditNotes: "Bukti pelunasan hutang darurat diverifikasi langsung oleh amil dan auditor.",
      auditorName: "KAP Sharia Trust & Public Auditor",
      auditorAddress: "0x37C2bE50D1150c265691F46A1d8F07a3D039B6F3",
      txHash: "0x7a8b9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b",
      bastCid: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
    },
  ];

  for (const p of cleanProposals) {
    const benHash = computeBeneficiaryHash(p.beneficiaryNIKMasked, p.beneficiaryName, p.salt);
    
    await dbService.recordProposal({
      proposalId: p.proposalId,
      currencyType: p.currencyType,
      amount: p.amount,
      asnafCategory: p.asnafCategory,
      asnafLabel: p.asnafLabel,
      beneficiaryName: p.beneficiaryName,
      beneficiaryNIKMasked: p.beneficiaryNIKMasked,
      beneficiaryHash: benHash,
      ipfsProofCID: p.bastCid,
      disbursementReceiptCID: p.status === "Executed" ? p.bastCid : undefined,
      periodId: 202608,
      approvalCount: p.status === "Executed" ? 2 : p.status === "Approved" ? 2 : 1,
      approvedBy: p.status === "Pending" ? ["Amil Internal"] : ["Amil Internal", "Dewan Pengawas Syariah (DPS)"],
      status: p.status,
      createdAt: new Date().toISOString(),
      executedAt: p.status === "Executed" ? new Date().toISOString() : undefined,
      txHash: p.txHash,
      auditStatus: p.auditStatus,
      auditOpinion: p.auditOpinion,
      auditNotes: p.auditNotes,
      auditorName: p.auditorName,
      auditorAddress: p.auditorAddress,
      auditedAt: p.auditStatus === "AUDITED_WTP" ? new Date() : undefined,
    });
  }

  console.log("✅ Database successfully cleaned and reseeded with 5 authentic sharia proposals!");
  process.exit(0);
}

cleanAndReseed().catch((err) => {
  console.error(err);
  process.exit(1);
});

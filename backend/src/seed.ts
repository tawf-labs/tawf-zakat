import { dataStore } from "./store";
import { computeDonationLeaf, type DonationRecord } from "./merkle";
import { computeBeneficiaryHash, uploadDisbursementProofToIPFS } from "./ipfs";
import { dbService } from "./db/index";

export async function runSeeder() {
  // 1. Seed 10 Realistic Donations Synchronously to Store
  const sampleDonations: DonationRecord[] = [
    {
      trxId: "TRX-20260824-001",
      donorName: "Budi Santoso",
      isAnonymous: false,
      salt: "salt_budi_123",
      amountIDR: 2500000,
      timestamp: "2026-08-24T08:15:00Z",
    },
    {
      trxId: "TRX-20260824-002",
      donorName: "Hamba Allah",
      isAnonymous: true,
      salt: "hamba_allah_secret_x99",
      amountIDR: 1000000,
      timestamp: "2026-08-24T09:30:00Z",
    },
    {
      trxId: "TRX-20260824-003",
      donorName: "Siti Rahmawati",
      isAnonymous: false,
      salt: "salt_siti_456",
      amountIDR: 5000000,
      timestamp: "2026-08-24T10:45:00Z",
    },
    {
      trxId: "TRX-20260824-004",
      donorName: "Hamba Allah",
      isAnonymous: true,
      salt: "secret_salt_kuitansi_777",
      amountIDR: 750000,
      timestamp: "2026-08-24T11:20:00Z",
    },
    {
      trxId: "TRX-20260824-005",
      donorName: "Ahmad Fauzi",
      isAnonymous: false,
      salt: "salt_ahmad_888",
      amountIDR: 3000000,
      timestamp: "2026-08-24T12:00:00Z",
    },
    {
      trxId: "TRX-20260824-006",
      donorName: "Hamba Allah",
      isAnonymous: true,
      salt: "hamba_allah_private_002",
      amountIDR: 15000000,
      timestamp: "2026-08-24T13:10:00Z",
    },
    {
      trxId: "TRX-20260824-007",
      donorName: "Dewi Lestari",
      isAnonymous: false,
      salt: "salt_dewi_333",
      amountIDR: 2000000,
      timestamp: "2026-08-24T14:25:00Z",
    },
    {
      trxId: "TRX-20260824-008",
      donorName: "Hamba Allah",
      isAnonymous: true,
      salt: "zk_secret_salt_999",
      amountIDR: 500000,
      timestamp: "2026-08-24T15:00:00Z",
    },
    {
      trxId: "TRX-20260824-009",
      donorName: "Rian Hidayat",
      isAnonymous: false,
      salt: "salt_rian_111",
      amountIDR: 4500000,
      timestamp: "2026-08-24T15:45:00Z",
    },
    {
      trxId: "TRX-20260824-010",
      donorName: "Hamba Allah",
      isAnonymous: true,
      salt: "muzakki_receipt_key_alpha",
      amountIDR: 10000000,
      timestamp: "2026-08-24T16:30:00Z",
    },
  ];

  // Immediately populate in-memory store
  for (const d of sampleDonations) {
    dataStore.recordDonation(d, 1);
  }

  const batch1 = dataStore.settleBatch(
    1,
    sampleDonations,
    "0x8b926f1457b19b6b56ae010d1fefa7012ee61e25170b2e56f92e0cc22684a593"
  );

  const sampleDonation2: DonationRecord = {
    trxId: "TRX-20260826-3488",
    donorName: "Bryan Digdaya",
    isAnonymous: false,
    salt: "salt_q5uravo2gt_1787733439579",
    amountIDR: 3500000,
    timestamp: "2026-08-26T08:37:19.579Z",
  };
  dataStore.recordDonation(sampleDonation2, 2);
  const batch2 = dataStore.settleBatch(
    2,
    [sampleDonation2],
    "0xf6810ab6c2748bfb241a52110f8c84d015c040242c6c1337d0a65ac5d560a93e"
  );

  // Background sync to Neon DB
  (async () => {
    try {
      for (const d of sampleDonations) {
        await dbService.recordDonation(d, 1);
      }
      await dbService.recordDonation(sampleDonation2, 2);

      await dbService.recordBatchSettlement(
        1,
        batch1.merkleRoot,
        batch1.totalAmountIDR,
        batch1.itemCount,
        batch1.txHash
      );
      await dbService.recordBatchSettlement(
        2,
        batch2.merkleRoot,
        batch2.totalAmountIDR,
        batch2.itemCount,
        batch2.txHash
      );

      // Seed Proposals
      const benHash1 = computeBeneficiaryHash("3201012345670001", "Pak Joko Suwarno", "secret_salt_joko_1");
      const ipfs1 = await uploadDisbursementProofToIPFS({
        beneficiaryName: "Pak Joko Suwarno",
        beneficiaryNIKMasked: "320101******0001",
        beneficiaryHash: benHash1,
        asnafCategory: "Fakir",
        amount: 5000000,
        currency: "IDR",
        description: "Bantuan Santunan Pangan & Sembako Mustahik Lansia Dhuafa",
        timestamp: "2026-08-24T10:00:00Z",
        evidenceFiles: [
          { fileName: "penyerahan_sembako.jpg", fileType: "image/jpeg", description: "Foto serah terima paket pangan" },
        ],
      });

      await dbService.recordProposal({
        proposalId: 1,
        currencyType: 0,
        amount: 5000000,
        asnafCategory: 0,
        asnafLabel: "Fakir",
        beneficiaryName: "Pak Joko Suwarno",
        beneficiaryNIKMasked: "320101******0001",
        beneficiaryHash: benHash1,
        ipfsProofCID: ipfs1.cid,
        periodId: 202608,
        approvalCount: 2,
        approvedBy: ["Amil Internal", "Dewan Pengawas Syariah (DPS)"],
        status: "Executed",
        createdAt: "2026-08-24T09:00:00Z",
        executedAt: "2026-08-24T11:00:00Z",
      });

      const benHash2 = computeBeneficiaryHash("3273029876540002", "Ibu Aminah", "secret_salt_aminah_2");
      const ipfs2 = await uploadDisbursementProofToIPFS({
        beneficiaryName: "Ibu Aminah",
        beneficiaryNIKMasked: "327302******0002",
        beneficiaryHash: benHash2,
        asnafCategory: "Miskin",
        amount: 7500000,
        currency: "IDR",
        description: "Bantuan Biaya Operasi & Pengobatan Pasien Dhuafa",
        timestamp: "2026-08-24T14:00:00Z",
        evidenceFiles: [
          { fileName: "surat_keterangan_rumah_sakit.pdf", fileType: "application/pdf", description: "Surat rujukan medis" },
        ],
      });

      await dbService.recordProposal({
        proposalId: 2,
        currencyType: 0,
        amount: 7500000,
        asnafCategory: 1,
        asnafLabel: "Miskin",
        beneficiaryName: "Ibu Aminah",
        beneficiaryNIKMasked: "327302******0002",
        beneficiaryHash: benHash2,
        ipfsProofCID: ipfs2.cid,
        periodId: 202608,
        approvalCount: 1,
        approvedBy: ["Amil Internal"],
        status: "Pending",
        createdAt: "2026-08-24T14:30:00Z",
      });
    } catch (err) {
      console.error("Neon DB async seeding error:", err);
    }
  })();
}

if (import.meta.main) {
  runSeeder();
}

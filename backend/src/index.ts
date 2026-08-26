import { Hono } from "hono";
import { cors } from "hono/cors";
import { dataStore } from "./store";
import { runSeeder } from "./seed";
import { computeDonationLeaf, MerkleTree, type DonationRecord } from "./merkle";
import { computeBeneficiaryHash, uploadDisbursementProofToIPFS, type DisbursementMetadata } from "./ipfs";
import { settleBatchOnChain } from "./relayer";
import { dbService } from "./db/index";
import { type Hex } from "viem";

// Auto-seed demo data on startup
runSeeder();

const app = new Hono();

app.use("/*", cors());

// Health Check
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "zakat-protocol-backend",
    timestamp: new Date().toISOString(),
  });
});

// 1. Inflow: Simulate/Record Fiat QRIS Donation & Generate Receipt with Secret Salt
app.post("/api/donations/fiat", async (c) => {
  try {
    const body = await c.req.json();
    const { donorName, isAnonymous, amountIDR } = body;

    if (!amountIDR || amountIDR <= 0) {
      return c.json({ error: "Invalid donation amount" }, 400);
    }

    const timestamp = new Date().toISOString();
    const dateStr = timestamp.slice(0, 10).replace(/-/g, "");
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const trxId = `TRX-${dateStr}-${randomSuffix}`;
    const salt = `salt_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;

    const record: DonationRecord = {
      trxId,
      donorName: isAnonymous ? "Hamba Allah" : donorName || "Muzakki",
      isAnonymous: Boolean(isAnonymous),
      salt,
      amountIDR: Number(amountIDR),
      timestamp,
    };

    await dbService.recordDonation(record, 1);

    return c.json({
      success: true,
      message: "Donation recorded successfully",
      receipt: {
        trxId: record.trxId,
        donorName: record.donorName,
        isAnonymous: record.isAnonymous,
        salt: record.salt,
        amountIDR: record.amountIDR,
        timestamp: record.timestamp,
        batchId: 1,
      },
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to process donation" }, 500);
  }
});

// 2. Muzakki Verification: Verify Receipt via Merkle Inclusion Proof
app.post("/api/verify-receipt", async (c) => {
  try {
    const body = await c.req.json();
    const { trxId, salt, amountIDR } = body;

    if (!trxId || !salt || !amountIDR) {
      return c.json({ error: "Missing required fields: trxId, salt, amountIDR" }, 400);
    }

    const result = await dbService.getProofForTrx(trxId, salt, Number(amountIDR));

    if (!result) {
      // If not in recorded map, still calculate leaf for user preview
      const leaf = computeDonationLeaf(trxId, salt, Number(amountIDR));
      return c.json({
        isValid: false,
        message: "Transaction not found in settled batch",
        leaf,
        proof: [],
      });
    }

    return c.json({
      isValid: result.isValid,
      batchId: result.batchId,
      merkleRoot: result.merkleRoot,
      leaf: result.leaf,
      proof: result.proof,
      verifiedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to verify receipt" }, 500);
  }
});

// 3. Batches: List Settled Merkle Batches
app.get("/api/batches", async (c) => {
  const batchList = await dbService.getBatches();
  return c.json({
    success: true,
    totalBatches: batchList.length,
    batches: batchList,
  });
});

// 4. Governance: List Disbursement Proposals
app.get("/api/proposals", async (c) => {
  const proposalList = await dbService.getProposals();
  return c.json({
    success: true,
    totalProposals: proposalList.length,
    proposals: proposalList,
  });
});

// 5. Governance: Upload Proof & Generate IPFS CID for Disbursement
app.post("/api/disbursement/upload-proof", async (c) => {
  try {
    const body = await c.req.json();
    const {
      beneficiaryName,
      beneficiaryNIK,
      asnafCategory,
      amount,
      currency,
      description,
      secretSalt,
    } = body;

    if (!beneficiaryName || !beneficiaryNIK || !amount || !asnafCategory) {
      return c.json({ error: "Missing required beneficiary details" }, 400);
    }

    const salt = secretSalt || `salt_mustahik_${Date.now()}`;
    const beneficiaryHash = computeBeneficiaryHash(beneficiaryNIK, beneficiaryName, salt);
    const maskedNIK = `${beneficiaryNIK.slice(0, 6)}******${beneficiaryNIK.slice(-4)}`;

    const metadata: DisbursementMetadata = {
      beneficiaryName,
      beneficiaryNIKMasked: maskedNIK,
      beneficiaryHash,
      asnafCategory,
      amount: Number(amount),
      currency: currency || "IDR",
      description: description || "Penyaluran Hak Asnaf Zakat",
      timestamp: new Date().toISOString(),
      evidenceFiles: [
        {
          fileName: "penyerahan_bantuan_blur.jpg",
          fileType: "image/jpeg",
          description: "Dokumentasi penyerahan bantuan kepada penerima manfaat",
        },
      ],
    };

    const ipfsResult = await uploadDisbursementProofToIPFS(metadata);

    return c.json({
      success: true,
      beneficiaryHash,
      secretSalt: salt,
      ipfsProofCID: ipfsResult.cid,
      ipfsGatewayUrl: ipfsResult.gatewayUrl,
      metadata,
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to upload proof to IPFS" }, 500);
  }
});

// 6. Relayer: Settle Merkle Batch Onchain to Ethereum Sepolia
app.post("/api/relayer/settle-batch", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const batchId = Number(body.batchId) || dataStore.batches.size + 1;

    // Get donations for this batch
    let donationList = Array.from(dataStore.donations.values()).filter(d => d.batchId === batchId);
    if (donationList.length === 0) {
      donationList = Array.from(dataStore.donations.values());
    }

    if (donationList.length === 0) {
      // Create a default donation if empty
      const sampleDonation: DonationRecord = {
        trxId: `TRX-${Date.now()}`,
        donorName: "Muzakki Online",
        isAnonymous: false,
        salt: `salt_${Date.now()}`,
        amountIDR: 2500000,
        timestamp: new Date().toISOString(),
      };
      donationList = [sampleDonation];
    }

    const leaves = donationList.map((d) =>
      computeDonationLeaf(d.trxId, d.salt, d.amountIDR)
    );
    const tree = new MerkleTree(leaves);
    const root = tree.getRoot();
    const totalAmount = donationList.reduce((acc, d) => acc + d.amountIDR, 0);

    const onChainResult = await settleBatchOnChain(batchId, root, totalAmount, false);

    dataStore.settleBatch(batchId, donationList, onChainResult.txHash);

    return c.json({
      success: true,
      batchId,
      merkleRoot: root,
      totalAmountIDR: totalAmount,
      itemCount: donationList.length,
      txHash: onChainResult.txHash,
      explorerUrl: onChainResult.explorerUrl,
      onChainConfirmed: onChainResult.success,
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to settle batch onchain" }, 500);
  }
});

const port = Number(process.env.PORT) || 3001;
console.log(`🚀 Zakat Protocol API running at http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};

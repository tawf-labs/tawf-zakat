import { Hono } from "hono";
import { cors } from "hono/cors";
import { dataStore } from "./store";
import { runSeeder } from "./seed";
import { computeDonationLeaf, MerkleTree, type DonationRecord } from "./merkle";
import {
  computeBeneficiaryHash,
  uploadDisbursementProofToIPFS,
  uploadProposalDossierToIPFS,
  type DisbursementMetadata,
  type ProposalDossierMetadata,
} from "./ipfs";
import { settleBatchOnChain } from "./relayer";
import { dbService } from "./db/index";
import { type Hex } from "viem";
import { chargeQRIS, verifyMidtransSignature, checkMidtransStatus, createSnapTransaction } from "./midtrans";

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

// 1. Inflow: Create Fiat QRIS Invoice (Status: PENDING)
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
    const finalDonorName = isAnonymous ? "Hamba Allah" : donorName || "Muzakki";

    // Create single clean Snap Transaction on Midtrans to avoid order_id session collision
    const snapResult = await createSnapTransaction(trxId, Number(amountIDR), finalDonorName);

    const qrString = `00020101021226500016ID.CO.MIDTRANS.WWW01189360099900000000000215${trxId}520453995303360540${amountIDR}5802ID5910TAWF ZAKAT6007JAKARTA6304`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrString)}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const record: DonationRecord = {
      trxId,
      donorName: finalDonorName,
      isAnonymous: Boolean(isAnonymous),
      salt,
      amountIDR: Number(amountIDR),
      timestamp,
      status: "PENDING",
      paymentMethod: "QRIS",
      qrString,
      qrUrl,
    };

    await dbService.recordDonation(record);

    return c.json({
      success: true,
      message: "Invoice generated successfully with Snap",
      invoice: {
        trxId: record.trxId,
        donorName: record.donorName,
        isAnonymous: record.isAnonymous,
        salt: record.salt,
        amountIDR: record.amountIDR,
        timestamp: record.timestamp,
        status: "PENDING",
        paymentMethod: "QRIS",
        qrString: record.qrString,
        qrUrl: record.qrUrl,
        snapToken: snapResult.token,
        redirectUrl: snapResult.redirectUrl,
        expiresAt,
        isMock: snapResult.isMock,
      },
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to process donation" }, 500);
  }
});

// 1b. Inflow: Query Donation Status (with live Midtrans sync)
app.get("/api/donations/status/:trxId", async (c) => {
  const trxId = c.req.param("trxId");
  if (!trxId) {
    return c.json({ error: "Missing trxId parameter" }, 400);
  }

  let donation = await dbService.getDonationByTrxId(trxId);
  if (!donation) {
    return c.json({ error: "Donation not found", success: false }, 404);
  }

  // If still PENDING, query Midtrans API live to check if paid via external Midtrans Simulator
  if (donation.status === "PENDING") {
    const midtransCheck = await checkMidtransStatus(trxId);
    if (midtransCheck && midtransCheck.isSettled) {
      const paidTime = midtransCheck.settlementTime || new Date().toISOString();
      await dbService.markDonationAsPaid(trxId, paidTime);
      donation.status = "PAID";
      donation.paidAt = paidTime;
    }
  }

  return c.json({
    success: true,
    donation: {
      trxId: donation.trxId,
      donorName: donation.donorName,
      isAnonymous: donation.isAnonymous,
      salt: donation.salt,
      amountIDR: donation.amountIDR,
      status: donation.status || "PENDING",
      paymentMethod: donation.paymentMethod || "QRIS",
      qrString: donation.qrString,
      qrUrl: donation.qrUrl,
      timestamp: donation.timestamp,
      paidAt: donation.paidAt,
      batchId: (donation as any).batchId,
    },
  });
});

// 1c. Inflow: Midtrans Payment Webhook (Idempotent & Signature-Verified)
app.post("/api/webhooks/payment", async (c) => {
  try {
    const body = await c.req.json();
    const {
      order_id,
      status_code,
      gross_amount,
      signature_key,
      transaction_status,
      settlement_time,
    } = body;

    if (!order_id) {
      return c.json({ error: "Missing order_id" }, 400);
    }

    const donation = await dbService.getDonationByTrxId(order_id);
    if (!donation) {
      return c.json({ error: "Donation order not found", success: false }, 404);
    }

    // Idempotency: If already paid or batched, acknowledge immediately without duplicate work
    if (donation.status === "PAID" || donation.status === "BATCHED") {
      return c.json({
        success: true,
        message: "Payment notification already processed",
        status: donation.status,
        trxId: order_id,
      });
    }

    // Verify SHA-512 Signature
    const serverKey = process.env.MIDTRANS_SERVER_KEY || "SB-Mid-server-TESTKEY12345";
    const isValidSignature = verifyMidtransSignature(
      order_id,
      status_code || "200",
      gross_amount || `${donation.amountIDR}.00`,
      serverKey,
      signature_key || ""
    );

    if (!isValidSignature) {
      return c.json(
        {
          error: "Unauthorized: Invalid Midtrans signature key",
          success: false,
        },
        401
      );
    }

    // If status is settlement / capture, transition to PAID
    if (transaction_status === "settlement" || transaction_status === "capture" || !transaction_status) {
      const paidTimestamp = settlement_time || new Date().toISOString();
      const updated = await dbService.markDonationAsPaid(order_id, paidTimestamp);

      return c.json({
        success: true,
        message: "Payment successfully settled and marked as PAID",
        status: "PAID",
        trxId: order_id,
        donation: updated,
      });
    }

    return c.json({
      success: true,
      message: `Webhook notification acknowledged (status: ${transaction_status})`,
      status: donation.status,
      trxId: order_id,
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to process payment webhook" }, 500);
  }
});

// 1d. Inflow: Sandbox Payment Simulator (One-Click for Demo / Judges)
app.post("/api/webhooks/simulator", async (c) => {
  try {
    const body = await c.req.json();
    const { trxId } = body;

    if (!trxId) {
      return c.json({ error: "Missing trxId parameter" }, 400);
    }

    const donation = await dbService.getDonationByTrxId(trxId);
    if (!donation) {
      return c.json({ error: "Donation not found", success: false }, 404);
    }

    const paidTimestamp = new Date().toISOString();
    const updated = await dbService.markDonationAsPaid(trxId, paidTimestamp);

    return c.json({
      success: true,
      message: "Payment successfully simulated and marked as PAID in Sandbox",
      donation: {
        trxId: updated?.trxId || trxId,
        donorName: updated?.donorName || donation.donorName,
        isAnonymous: updated?.isAnonymous ?? donation.isAnonymous,
        salt: updated?.salt || donation.salt,
        amountIDR: updated?.amountIDR || donation.amountIDR,
        status: "PAID",
        paymentMethod: "QRIS",
        paidAt: paidTimestamp,
      },
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to simulate payment" }, 500);
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

// 1c. Inflow: Record Web3 USDC Donation (Status: PAID)
app.post("/api/donations/usdc", async (c) => {
  try {
    const body = await c.req.json();
    const { trxId, txHash, donorAddress, donorName, isAnonymous, amountUSDC, salt, commitmentHash } = body;

    if (!amountUSDC || amountUSDC <= 0) {
      return c.json({ error: "Invalid donation amount" }, 400);
    }

    const timestamp = new Date().toISOString();
    const finalTrxId = trxId || `TRX-USDC-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const finalSalt = salt || `salt_usdc_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;
    const finalDonorName = isAnonymous ? "Hamba Allah" : donorName || "Muzakki Web3";
    const amountIDREstimate = Math.round(Number(amountUSDC) * 16000); // 1 USDC ~ 16,000 IDR accounting equivalent

    const record: DonationRecord = {
      trxId: finalTrxId,
      donorName: finalDonorName,
      isAnonymous: Boolean(isAnonymous),
      salt: finalSalt,
      amountIDR: amountIDREstimate,
      timestamp,
      status: "PAID",
      paymentMethod: "USDC",
      qrString: txHash || commitmentHash || (donorAddress ? `Donor: ${donorAddress}` : undefined),
      paidAt: timestamp,
    };

    await dbService.recordDonation(record);

    return c.json({
      success: true,
      message: "USDC donation recorded successfully",
      donation: {
        trxId: record.trxId,
        donorName: record.donorName,
        isAnonymous: record.isAnonymous,
        salt: record.salt,
        amountUSDC: Number(amountUSDC),
        amountIDR: record.amountIDR,
        txHash,
        status: "PAID",
        paymentMethod: "USDC",
        paidAt: timestamp,
      },
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to record USDC donation" }, 500);
  }
});

const ASNAF_LABELS: Record<number, string> = {
  1: "Fakir",
  2: "Miskin",
  3: "Amil",
  4: "Muallaf",
  5: "Riqab",
  6: "Gharimin",
  7: "Fisabilillah",
  8: "Ibnu Sabil",
};

// 4. Governance: List Disbursement Proposals
app.get("/api/proposals", async (c) => {
  const proposalList = await dbService.getProposals();
  return c.json({
    success: true,
    totalProposals: proposalList.length,
    proposals: proposalList,
  });
});

// 4a. Governance: Proposal Intake & Salted Hash Dossier Pipeline (Ticket #27)
app.post("/api/proposals/intake", async (c) => {
  try {
    const body = await c.req.json();
    const {
      programTitle,
      asnafCategory,
      asnafLabel,
      amount,
      currencyType,
      beneficiaryName,
      beneficiaryNIK,
      locationCity,
      assessmentSummary,
      periodId,
      usdcRecipient,
      secretSalt,
      evidenceFiles,
    } = body;

    if (!programTitle || !asnafCategory || !amount || !beneficiaryName || !beneficiaryNIK) {
      return c.json(
        {
          error: "Missing required fields: programTitle, asnafCategory, amount, beneficiaryName, and beneficiaryNIK are required",
          success: false,
        },
        400
      );
    }

    const numericAsnaf = Number(asnafCategory);
    const resolvedAsnafLabel = asnafLabel || ASNAF_LABELS[numericAsnaf] || "Fisabilillah";
    const salt = secretSalt || `salt_mustahik_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const beneficiaryHash = computeBeneficiaryHash(beneficiaryNIK, beneficiaryName, salt);
    const maskedNIK =
      beneficiaryNIK.length >= 10
        ? `${beneficiaryNIK.slice(0, 6)}******${beneficiaryNIK.slice(-4)}`
        : "3171************";
    const disguisedName = `Bpk/Ibu ${beneficiaryName.charAt(0)}*** (Mustahik-${beneficiaryHash.slice(2, 8)})`;

    const dossierMetadata: ProposalDossierMetadata = {
      programTitle,
      asnafCategory: numericAsnaf,
      asnafLabel: resolvedAsnafLabel,
      amount: Number(amount),
      currency: currencyType === 1 ? "USDC" : "IDR",
      disguisedName,
      locationCity: locationCity || "Indonesia",
      beneficiaryHash,
      beneficiaryNIKMasked: maskedNIK,
      assessmentSummary: assessmentSummary || "Survei kelayakan asnaf telah diverifikasi oleh tim amil",
      timestamp: new Date().toISOString(),
      evidenceFiles: evidenceFiles || [
        {
          fileName: "berkas_survei_kelayakan.pdf",
          fileType: "application/pdf",
          description: "Dokumen hasil survei mustahik dan rekomendasi asnaf",
        },
      ],
    };

    const ipfsResult = await uploadProposalDossierToIPFS(dossierMetadata);

    const existingProposals = await dbService.getProposals();
    const temporaryProposalId = existingProposals.length + 1;

    const proposalRecord = {
      proposalId: temporaryProposalId,
      currencyType: Number(currencyType || 0),
      amount: Number(amount),
      asnafCategory: numericAsnaf,
      asnafLabel: resolvedAsnafLabel,
      beneficiaryName,
      beneficiaryNIKMasked: maskedNIK,
      beneficiaryHash,
      ipfsProofCID: ipfsResult.cid,
      periodId: Number(periodId || 202608),
      approvalCount: 1,
      approvedBy: ["Amil Internal (Pengusul)"],
      status: "Pending" as const,
      createdAt: new Date().toISOString(),
    };

    await dbService.recordProposal(proposalRecord);

    return c.json({
      success: true,
      message: "Proposal intake successful and pinned to IPFS",
      proposal: proposalRecord,
      secretSalt: salt,
      ipfsGatewayUrl: ipfsResult.gatewayUrl,
      onChainParams: {
        currencyType: Number(currencyType || 0),
        amount: Number(amount),
        asnafCategory: numericAsnaf,
        beneficiaryHash,
        ipfsProofCID: ipfsResult.cid,
        periodId: Number(periodId || 202608),
        usdcRecipient: usdcRecipient || null,
      },
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to intake proposal", success: false }, 500);
  }
});

// 4b. Governance: Sync Proposal On-chain Transaction
app.post("/api/proposals/:id/sync-tx", async (c) => {
  try {
    const idParam = c.req.param("id");
    const currentId = Number(idParam);
    const body = await c.req.json();
    const { proposalIdOnChain, txHash } = body;

    const synced = await dbService.syncProposalTx(
      currentId,
      Number(proposalIdOnChain || currentId),
      txHash
    );

    return c.json({
      success: true,
      message: "Proposal synced with on-chain transaction",
      proposal: synced,
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to sync proposal transaction", success: false }, 500);
  }
});

// 4c. Governance: Create Disbursement Proposal
app.post("/api/proposals", async (c) => {
  try {
    const body = await c.req.json();
    const {
      proposalId,
      currencyType,
      amount,
      asnafCategory,
      asnafLabel,
      beneficiaryName,
      beneficiaryNIKMasked,
      beneficiaryHash,
      ipfsProofCID,
      periodId,
      txHash,
    } = body;

    const proposal = {
      proposalId: Number(proposalId),
      currencyType: Number(currencyType || 0),
      amount: Number(amount),
      asnafCategory: Number(asnafCategory || 0),
      asnafLabel: asnafLabel || "Fisabilillah",
      beneficiaryName: beneficiaryName || "Mustahik",
      beneficiaryNIKMasked: beneficiaryNIKMasked || "3171************",
      beneficiaryHash: beneficiaryHash || "0x0000000000000000000000000000000000000000000000000000000000000000",
      ipfsProofCID: ipfsProofCID || "QmPendingProofCID",
      periodId: Number(periodId || 202608),
      approvalCount: 1,
      approvedBy: ["Amil Internal (Pengusul)"],
      status: "Pending",
      createdAt: new Date().toISOString(),
      txHash,
    };

    await dbService.recordProposal(proposal);

    return c.json({
      success: true,
      message: "Proposal created and recorded successfully",
      proposal,
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to create proposal" }, 500);
  }
});

// 4c. Governance: Approve Proposal
app.post("/api/proposals/:id/approve", async (c) => {
  try {
    const idParam = c.req.param("id");
    const proposalId = Number(idParam);
    const body = await c.req.json();
    const { approverRole, txHash } = body;

    const roleName = approverRole || "Dewan Pengawas Syariah";
    const updated = await dbService.approveProposal(proposalId, roleName, txHash);

    return c.json({
      success: true,
      message: "Proposal approved successfully",
      proposal: updated,
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to approve proposal" }, 500);
  }
});

// 4d. Governance: Cancel Proposal (Ticket #28)
app.post("/api/proposals/:id/cancel", async (c) => {
  try {
    const idParam = c.req.param("id");
    const proposalId = Number(idParam);
    const body = await c.req.json();
    const { cancelReason, txHash } = body;

    const reason = cancelReason || "Dibatalkan oleh Pengawas Syariah / Amil";
    const updated = await dbService.cancelProposal(proposalId, reason, txHash);

    return c.json({
      success: true,
      message: "Proposal cancelled successfully",
      proposal: updated,
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to cancel proposal" }, 500);
  }
});

// 4d. Governance: Execute Proposal
app.post("/api/proposals/:id/execute", async (c) => {
  try {
    const idParam = c.req.param("id");
    const proposalId = Number(idParam);
    const body = await c.req.json();
    const { txHash } = body;

    const updated = await dbService.executeProposal(proposalId, txHash);

    return c.json({
      success: true,
      message: "Proposal executed successfully",
      proposal: updated,
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to execute proposal" }, 500);
  }
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
    const batches = await dbService.getBatches();
    const batchId = Number(body.batchId) || batches.length + 1;

    // Get unbatched PAID donations
    let donationList = await dbService.getUnbatchedPaidDonations();

    if (donationList.length === 0) {
      // Fallback: If no pending paid donations, check all donations in store for demo/test
      donationList = Array.from(dataStore.donations.values()).filter(d => d.status === "PAID" || !d.status);
    }

    if (donationList.length === 0) {
      // Create a default donation if completely empty
      const sampleDonation: DonationRecord = {
        trxId: `TRX-${Date.now()}`,
        donorName: "Muzakki Online",
        isAnonymous: false,
        salt: `salt_${Date.now()}`,
        amountIDR: 2500000,
        status: "PAID",
        timestamp: new Date().toISOString(),
      };
      donationList = [sampleDonation];
      await dbService.recordDonation(sampleDonation);
    }

    const leaves = donationList.map((d) =>
      computeDonationLeaf(d.trxId, d.salt, d.amountIDR)
    );
    const tree = new MerkleTree(leaves);
    const root = tree.getRoot();
    const totalAmount = donationList.reduce((acc, d) => acc + d.amountIDR, 0);

    const onChainResult = await settleBatchOnChain(batchId, root, totalAmount, false);

    // Save batch and mark all included donations as BATCHED in DB and Memory
    await dbService.recordBatchSettlement(batchId, root, totalAmount, donationList.length, onChainResult.txHash);
    await dbService.markDonationsBatched(donationList.map(d => d.trxId), batchId);

    // Register tree in memory for instant proof verification
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

import reportExaminationRoutes from "./routes/report-examination";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { dataStore } from "./store";
import { computeDonationLeaf, MerkleTree, type DonationRecord } from "./merkle";
import { inspectIpfsCid, PINATA_DEDICATED_GATEWAY, PUBLIC_IPFS_GATEWAY } from "./ipfs";
import { settleBatchOnChain } from "./relayer";
import { dbService } from "./db/index";
import { checkReceipt, lookupContribution } from "./contribution-trace";
import { CONTRACT_CONFIG } from "./config";
import { verifyMidtransSignature, checkMidtransStatus, createSnapTransaction } from "./midtrans";
import { workspaceRuntime } from "./workspace-runtime";
import { recordSettledDonation, rememberGatewayIntent } from "./gateway-contribution";
import { indexerEngine } from "./indexer";
import { eventBus, createWebSocketHandler, websocket } from "./ws";
import reconciliationRoutes from "./routes/reconciliation";
import periodReportRoutes from "./routes/period-report";
import reportAuthorityRoutes from "./routes/report-authority";
import workspaceRoutes from "./routes/workspace";
import disbursementRoutes from "./routes/disbursement";
import contributionRoutes from "./routes/contribution";
import activityRoutes from "./routes/activity";
import evidenceRoutes from "./routes/evidence";
import reportPackageRoutes from "./routes/report-package";
import reportAuditFindingsRoutes from "./routes/report-audit-findings";
import registryRecoveryRoutes from "./routes/registry-recovery";
import registryRecordingRoutes from "./routes/registry-recording";
import donorAccessRoutes from "./routes/donor-access";
import contributionBatchRoutes from "./routes/contribution-batches";
import { certificateRoutes, publicCertificateRoutes } from "./routes/certificates";
import receiptVerificationRoutes from "./routes/receipt-verification";
import { installWorkspaceRuntime } from "./workspace-wiring";

// Start background indexer polling for Sepolia L1 events
// Can be disabled via ENABLE_EMBEDDED_INDEXER=false when running a dedicated standalone indexer worker in production
const shouldRunEmbeddedIndexer =
  process.env.ENABLE_EMBEDDED_INDEXER !== "false" && process.env.NODE_ENV !== "test" && process.env.DEPLOYMENT_PENDING !== "true";

if (shouldRunEmbeddedIndexer) {
  indexerEngine.start();
}

const app = new Hono();

app.use("/*", cors());

app.use("/api/*", async (c, next) => {
  if (process.env.DEPLOYMENT_PENDING === "true") {
    return c.json({ success: false, error: "Deployment baru belum dikonfigurasi. Database sedang dalam mode reset." }, 503);
  }
  return next();
});

// Realtime WebSocket Endpoint (ADR-0011)
app.get("/ws", createWebSocketHandler());

// Reconciliation Engine (Spec #55) - lives in its own route module
app.route("/api/reconciliation", reconciliationRoutes);

// Laporan Periode Terverifikasi (Spec #61) - likewise its own route module
app.route("/api/period-report", periodReportRoutes);

// Ruang kerja lembaga (Spec #68) - tenancy and access, its own module again.
// Tests bind their own runtime; here it is wired from the deployment's config,
// and stays unconfigured (503) rather than pretending to work without one.
installWorkspaceRuntime();
app.route("/api/workspace/authority", reportAuthorityRoutes);
app.route("/api/workspace", workspaceRoutes);
app.route("/api/workspace", disbursementRoutes);
app.route("/api/workspace", contributionRoutes);
app.route("/api/workspace", contributionBatchRoutes);
app.route("/api/workspace", activityRoutes);
app.route("/api/workspace", certificateRoutes);
app.route("/api/donor", donorAccessRoutes);
app.route("/api/public", receiptVerificationRoutes);
app.route("/api/public", publicCertificateRoutes);
app.use("/api/evidence/*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  c.header("Vary", "Authorization");
  await next();
});
app.route("/", reportExaminationRoutes);
app.route("/api/evidence", registryRecordingRoutes);
app.route("/api/workspace", registryRecoveryRoutes);
app.route("/api/evidence", reportAuditFindingsRoutes);
app.route("/api/evidence", reportPackageRoutes);
app.route("/api/evidence", evidenceRoutes);

app.get("/api/ipfs/gateway", (c) => {
  return c.json({
    success: true,
    dedicatedGateway: PINATA_DEDICATED_GATEWAY,
    publicGateway: PUBLIC_IPFS_GATEWAY,
  });
});

// Health Check
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "zakat-protocol-backend",
    deploymentPending: process.env.DEPLOYMENT_PENDING === "true",
    contractAddress: CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS,
    chainId: CONTRACT_CONFIG.CHAIN_ID,
    timestamp: new Date().toISOString(),
  });
});

// Online payments reach the institution's ledger as RECEIVED contributions, recorded by the system.
// Reconciliation and endorsement remain with people. Idempotent, and never allowed to fail a payment.
const GATEWAY_EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
// The webhook falls back to a built-in demo key when none is configured, so a forged notification
// would verify. Without a real server key nothing from the gateway may enter the ledger.
const recordGatewayPayment = async (donation: DonationRecord) => {
  if (!process.env.MIDTRANS_SERVER_KEY?.trim()) return;
  try {
    const runtime = workspaceRuntime();
    if (!runtime?.contributions) return;
    const outcome = await recordSettledDonation(runtime.contributions, donation, runtime.now());
    if (outcome === "NO_INTENT") {
      // No gateway intent was ever saved for this trxId, so no contribution was recorded
      // (see rememberGatewayIntent in handleFiatDonation). The donor stays paid, but their
      // OTP donor-access page will never show an allocation until someone notices this log.
      console.error(`[gateway-contribution] no intent for ${donation.trxId}; contribution not recorded`);
    }
  } catch (error) {
    // Never let a ledger-recording failure fail the payment itself; log with enough
    // detail (trxId + real error) that a missing contribution can actually be traced.
    console.error(`[gateway-contribution] failed to record contribution for ${donation.trxId}:`, error);
  }
};

// 1. Inflow: Create Fiat QRIS Invoice (Status: PENDING)
const handleFiatDonation = async (c: any) => {
  try {
    const body = await c.req.json();
    const { donorName, isAnonymous, amountIDR, zakatType, paymentMethod } = body;
    const donorContact = typeof body.donorContact === "string" && body.donorContact.trim() ? body.donorContact.trim() : null;
    if (donorContact && (donorContact.length > 254 || !GATEWAY_EMAIL.test(donorContact))) {
      return c.json({ error: "Email donor tidak valid", success: false }, 400);
    }

    if (!amountIDR || amountIDR <= 0) {
      return c.json({ error: "Invalid donation amount", success: false }, 400);
    }

    const timestamp = new Date().toISOString();
    const dateStr = timestamp.slice(0, 10).replace(/-/g, "");
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const trxId = `TRX-${dateStr}-${randomSuffix}`;
    const salt = body.salt || `salt_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;
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
      paymentMethod: (paymentMethod || "QRIS").toUpperCase(),
      qrString,
      qrUrl,
    };

    await dbService.recordDonation(record);

    const gatewayInstitution = process.env.GATEWAY_INSTITUTION_ID?.trim();
    const contributions = workspaceRuntime()?.contributions;
    if (gatewayInstitution && contributions) {
      try {
        await rememberGatewayIntent(contributions, {
          trxId, institutionId: gatewayInstitution, zakatType: String(zakatType || "Zakat"), donorContact,
        }, Math.floor(Date.now() / 1000));
      } catch { console.error("Niat donasi gateway tidak tersimpan."); }
    }

    return c.json({
      success: true,
      message: "Invoice generated successfully with Snap",
      trxId: record.trxId,
      snapToken: snapResult.token,
      redirectUrl: snapResult.redirectUrl,
      donation: record,
      invoice: {
        trxId: record.trxId,
        donorName: record.donorName,
        isAnonymous: record.isAnonymous,
        salt: record.salt,
        amountIDR: record.amountIDR,
        timestamp: record.timestamp,
        status: "PENDING",
        paymentMethod: record.paymentMethod,
        qrString,
        qrUrl,
        snapToken: snapResult.token,
        redirectUrl: snapResult.redirectUrl,
        expiresAt,
        isMock: snapResult.isMock,
      },
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to process donation", success: false }, 500);
  }
};

app.post("/api/donations", handleFiatDonation);
app.post("/api/donations/fiat", handleFiatDonation);

// 1b. Inflow: public contribution lookup (the pending check also syncs Midtrans settlement)
const syncPendingPayment = async (donation: DonationRecord) => {
  if (donation.status === "PAID") return recordGatewayPayment(donation);
  if (donation.status !== "PENDING") return;
  const midtransCheck = await checkMidtransStatus(donation.trxId);
  if (midtransCheck && midtransCheck.isSettled) {
    const paidTime = midtransCheck.settlementTime || new Date().toISOString();
    await dbService.markDonationAsPaid(donation.trxId, paidTime);
    donation.status = "PAID";
    donation.paidAt = paidTime;
    await recordGatewayPayment(donation);
  }
};

const LOOKUP_HTTP_STATUS = { FOUND: 200, NOT_FOUND: 404, UNAVAILABLE: 503 } as const;

const contributionLookupHandler = (param: string, syncPayment: boolean) => async (c: any) => {
  c.header("Cache-Control", "no-store");
  const trxId = c.req.param(param)?.trim();
  if (!trxId) return c.json({ success: false, lookupStatus: "NOT_FOUND" }, 400);
  const lookup = await lookupContribution(trxId, syncPayment ? syncPendingPayment : undefined);
  return c.json({ success: lookup.lookupStatus === "FOUND", ...lookup }, LOOKUP_HTTP_STATUS[lookup.lookupStatus]);
};

app.get("/api/donations/status/:trxId", contributionLookupHandler("trxId", true));
app.get("/api/donations/:trxId", contributionLookupHandler("trxId", false));
app.get("/api/public/contributions/:id", contributionLookupHandler("id", false));

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
      await recordGatewayPayment(donation);
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
      await recordGatewayPayment({ ...donation, ...(updated ?? {}), paidAt: paidTimestamp });

      eventBus.broadcast("DONATION_PAID", {
        trxId: order_id,
        amountIDR: updated?.amountIDR || donation.amountIDR,
        donorName: updated?.donorName || donation.donorName,
        isAnonymous: updated?.isAnonymous || donation.isAnonymous,
        paidAt: paidTimestamp,
      });

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
    // Same ledger entry a real webhook would produce (#104 depends on it existing).
    await recordGatewayPayment({ ...donation, ...(updated ?? {}), paidAt: paidTimestamp });

    eventBus.broadcast("DONATION_PAID", {
      trxId,
      amountIDR: updated?.amountIDR || donation.amountIDR,
      donorName: updated?.donorName || donation.donorName,
      isAnonymous: updated?.isAnonymous || donation.isAnonymous,
      paidAt: paidTimestamp,
    });

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

// 2. Owner receipt check: Merkle inclusion recomputed on the server against its batch record
app.post("/api/verify-receipt", async (c) => {
  c.header("Cache-Control", "no-store");
  const body = await c.req.json().catch(() => null);
  const trxId = typeof body?.trxId === "string" ? body.trxId.trim() : "";
  const salt = typeof body?.salt === "string" ? body.salt : "";
  const amountIDR = Number(body?.amountIDR);
  if (!trxId || !salt || !Number.isSafeInteger(amountIDR) || amountIDR <= 0) {
    return c.json({ error: "Missing required fields: trxId, salt, amountIDR" }, 400);
  }
  try {
    return c.json(await checkReceipt(trxId, salt, amountIDR));
  } catch (error) {
    console.error("Receipt check failed:", error);
    return c.json({ error: "Pemeriksaan kuitansi belum dapat dilakukan." }, 503);
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
    const { trxId, txHash, donorAddress, donor, donorName, isAnonymous, amountUSDC, salt, commitmentHash, blockNumber } = body;

    if (!amountUSDC || Number(amountUSDC) <= 0) {
      return c.json({ error: "Invalid donation amount" }, 400);
    }

    const effectiveDonor = donor || donorAddress || "Muzakki Web3";
    const timestamp = new Date().toISOString();
    const finalTrxId = trxId || `USDC-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const finalSalt = salt || `salt_usdc_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;
    const finalDonorName = isAnonymous ? "Hamba Allah" : (donorName || (effectiveDonor.startsWith("0x") ? `Muzakki (${effectiveDonor.slice(0, 6)}...${effectiveDonor.slice(-4)})` : effectiveDonor));
    
    // Human amount in USDC: raw / 1e6 if large or direct number
    const numUSDC = Number(amountUSDC);
    const humanUSDC = numUSDC > 1e6 ? numUSDC / 1e6 : numUSDC;
    const amountIDREstimate = Math.round(humanUSDC * 16200); // 1 USDC ~ 16,200 IDR

    const record: DonationRecord = {
      trxId: finalTrxId,
      donorName: finalDonorName,
      isAnonymous: Boolean(isAnonymous),
      salt: finalSalt,
      amountIDR: amountIDREstimate,
      timestamp,
      status: "PAID",
      paymentMethod: "USDC",
      qrString: txHash || commitmentHash || (effectiveDonor.startsWith("0x") ? `Donor: ${effectiveDonor}` : undefined),
      paidAt: timestamp,
    };

    await dbService.recordDonation(record);

    return c.json({
      success: true,
      message: "USDC donation recorded successfully in unified ledger",
      trxId: record.trxId,
      record,
      donation: {
        trxId: record.trxId,
        donorName: record.donorName,
        isAnonymous: record.isAnonymous,
        salt: record.salt,
        amountUSDC: humanUSDC,
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

// Historical proposal reads remain available to public transparency and landing pages.
app.get("/api/proposals", async (c) => {
  const proposalList = await dbService.getProposals();
  return c.json({
    success: true,
    totalProposals: proposalList.length,
    proposals: proposalList,
  });
});

// 6. Relayer: Settle Merkle Batch Onchain to Ethereum Sepolia
app.post("/api/relayer/settle-batch", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const batches = await dbService.getBatches();
    let batchId = Number(body.batchId);
    if (!batchId) {
      batchId = 2;
      const existingBatchNumbers = new Set(batches.map((b) => b.batchId));
      while (existingBatchNumbers.has(batchId)) {
        batchId++;
      }
    }

    const donationList = await dbService.getUnbatchedPaidDonations();
    if (donationList.length === 0) {
      return c.json({
        success: false,
        error: "Tidak ada donasi fiat PAID yang belum dibatch",
      }, 409);
    }

    const leaves = donationList.map((d) =>
      computeDonationLeaf(d.trxId, d.salt, d.amountIDR)
    );
    const tree = new MerkleTree(leaves);
    const root = tree.getRoot();
    const totalAmount = donationList.reduce((acc, d) => acc + d.amountIDR, 0);

    const onChainResult = await settleBatchOnChain(batchId, root, totalAmount, true);
    if (!onChainResult.success) {
      return c.json({
        success: false,
        error: onChainResult.error || "Gagal menyiarkan settlement batch ke smart contract Arbitrum Sepolia",
      }, 500);
    }

    // Save batch and mark all included donations as BATCHED in DB and Memory
    await dbService.recordBatchSettlement(batchId, root, totalAmount, donationList.length, onChainResult.txHash);
    await dbService.markDonationsBatched(donationList.map(d => d.trxId), batchId);

    // Register tree in memory for instant proof verification
    dataStore.settleBatch(batchId, donationList, onChainResult.txHash);

    eventBus.broadcast("MERKLE_BATCH_SETTLED", {
      batchId,
      merkleRoot: root,
      totalAmountIDR: totalAmount,
      itemCount: donationList.length,
      txHash: onChainResult.txHash,
    });

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

// 12. Indexer Status & Health (ADR-0008)
app.get("/api/indexer/status", async (c) => {
  try {
    const state = await dbService.getIndexerState();
    return c.json({
      success: true,
      indexer: state,
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to get indexer status" }, 500);
  }
});

// 13. Public On-Chain Events Audit Trail (ADR-0008)
app.get("/api/events", async (c) => {
  try {
    const limit = Number(c.req.query("limit")) || 50;
    const events = await dbService.getOnchainEvents(limit);
    return c.json({
      success: true,
      count: events.length,
      events,
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to get on-chain events" }, 500);
  }
});

// 14. Governance Role Members Roster (ADR-0008)
app.get("/api/governance/roles", async (c) => {
  try {
    const roles = await dbService.getRoleMembers();
    return c.json({
      success: true,
      roles,
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to get role members" }, 500);
  }
});

// 15. Universal IPFS Evidence Inspector (Ticket #46 & ADR-0013)
app.get("/api/ipfs/inspect/:cid", async (c) => {
  try {
    const cidParam = c.req.param("cid");
    if (!cidParam) {
      return c.json({ error: "Missing IPFS CID parameter", success: false }, 400);
    }

    const inspection = await inspectIpfsCid(cidParam);

    // Reconcile with on-chain proposals in database
    const proposals = await dbService.getProposals();
    const matchingProposal = proposals.find(
      (p) =>
        p.ipfsProofCID === cidParam ||
        p.disbursementReceiptCID === cidParam ||
        p.auditReportCID === cidParam
    );

    let onChainContext = null;
    if (matchingProposal) {
      onChainContext = {
        proposalId: matchingProposal.proposalId,
        asnafCategory: matchingProposal.asnafCategory,
        asnafLabel: matchingProposal.asnafLabel,
        beneficiaryHash: matchingProposal.beneficiaryHash,
        status: matchingProposal.status,
        amount: matchingProposal.amount,
        currencyType: matchingProposal.currencyType,
        txHash: matchingProposal.txHash,
        auditOpinion: matchingProposal.auditOpinion,
        auditStatus: matchingProposal.auditStatus,
        executedAt: matchingProposal.executedAt,
      };
    }

    return c.json({
      success: true,
      ...inspection,
      onChainContext,
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to inspect IPFS CID", success: false }, 500);
  }
});

// 16. Manual Trigger Sync (Admin / Test Hook)
app.post("/api/indexer/trigger-sync", async (c) => {
  try {
    const syncResult = await indexerEngine.syncOnce();
    return c.json({
      success: true,
      message: "Manual sync cycle completed",
      ...syncResult,
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to run sync cycle" }, 500);
  }
});

const port = Number(process.env.PORT) || 3001;
console.log(`🚀 Zakat Protocol API running at http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
  websocket,
};

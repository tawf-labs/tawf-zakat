import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { dataStore, type SettledBatch, type ProposalRecord } from "../store";
import { computeDonationLeaf, MerkleTree, type DonationRecord } from "../merkle";
import { type Hex, createPublicClient, http, parseAbi } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { desc, eq, or } from "drizzle-orm";
import { CONTRACT_CONFIG } from "../config";

const syncPublicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(CONTRACT_CONFIG.RPC_URL),
});

const PROPOSAL_SYNC_ABI = parseAbi([
  "function proposals(uint256) view returns (uint256 proposalId, uint8 currencyType, uint256 amount, uint8 asnafCategory, bytes32 beneficiaryHash, string ipfsProofCID, uint256 periodId, address usdcRecipient, uint256 approvalCount, uint8 status)",
]);

const databaseUrl = process.env.DATABASE_URL;

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

if (databaseUrl) {
  try {
    const client = postgres(databaseUrl, { max: 10 });
    dbInstance = drizzle(client, { schema });
    console.log("Connected to Neon PostgreSQL database via Drizzle ORM");
    // Ensure new columns & indexer tables exist
    const initStatements = [
      `ALTER TABLE disbursement_proposals ADD COLUMN IF NOT EXISTS disbursement_receipt_cid text;`,
      `ALTER TABLE disbursement_proposals ADD COLUMN IF NOT EXISTS tx_hash text;`,
      `ALTER TABLE disbursement_proposals ADD COLUMN IF NOT EXISTS audit_status text DEFAULT 'PENDING';`,
      `ALTER TABLE disbursement_proposals ADD COLUMN IF NOT EXISTS auditor_address text;`,
      `ALTER TABLE disbursement_proposals ADD COLUMN IF NOT EXISTS auditor_name text;`,
      `ALTER TABLE disbursement_proposals ADD COLUMN IF NOT EXISTS audit_report_cid text;`,
      `ALTER TABLE disbursement_proposals ADD COLUMN IF NOT EXISTS audit_opinion text;`,
      `ALTER TABLE disbursement_proposals ADD COLUMN IF NOT EXISTS audit_notes text;`,
      `ALTER TABLE disbursement_proposals ADD COLUMN IF NOT EXISTS audited_at timestamp;`,
      `ALTER TABLE disbursement_proposals ADD COLUMN IF NOT EXISTS audit_tx_hash text;`,
      `ALTER TABLE disbursement_proposals ADD COLUMN IF NOT EXISTS lai_document_cid text;`,
      `ALTER TABLE disbursement_proposals ADD COLUMN IF NOT EXISTS financial_statements_cid text;`,
      `CREATE TABLE IF NOT EXISTS auditor_profiles (
         id SERIAL PRIMARY KEY,
         account_address TEXT NOT NULL UNIQUE,
         name TEXT NOT NULL,
         kap_license_number TEXT NOT NULL,
         license_proof_cid TEXT NOT NULL,
         is_active BOOLEAN NOT NULL DEFAULT TRUE,
         registered_by TEXT NOT NULL,
         registered_at TIMESTAMP DEFAULT NOW(),
         updated_at TIMESTAMP DEFAULT NOW()
       );`,
      `CREATE TABLE IF NOT EXISTS indexer_state (
         id SERIAL PRIMARY KEY,
         indexer_key TEXT NOT NULL UNIQUE DEFAULT 'sepolia_zakat_l1',
         last_indexed_block INTEGER NOT NULL DEFAULT 11569000,
         last_sync_at TIMESTAMP DEFAULT NOW(),
         status TEXT NOT NULL DEFAULT 'SYNCING',
         total_events_indexed INTEGER NOT NULL DEFAULT 0
       );`,
      `CREATE TABLE IF NOT EXISTS onchain_events (
         id SERIAL PRIMARY KEY,
         tx_hash TEXT NOT NULL,
         block_number INTEGER NOT NULL,
         log_index INTEGER NOT NULL DEFAULT 0,
         event_name TEXT NOT NULL,
         contract_address TEXT NOT NULL,
         args_json TEXT NOT NULL,
         created_at TIMESTAMP DEFAULT NOW()
       );`,
      `CREATE TABLE IF NOT EXISTS role_members (
         id SERIAL PRIMARY KEY,
         role_hash TEXT NOT NULL,
         role_name TEXT NOT NULL,
         account_address TEXT NOT NULL,
         is_active BOOLEAN NOT NULL DEFAULT TRUE,
         granted_at_block INTEGER,
         revoked_at_block INTEGER,
         tx_hash TEXT,
         updated_at TIMESTAMP DEFAULT NOW()
       );`,
    ];

    Promise.all(
      initStatements.map((sql) =>
        client.unsafe(sql).catch((err) => {
          // ignore notices or warnings
        })
      )
    );
  } catch (err) {
    console.warn("Neon database connection failed, falling back to local data store:", err);
  }
}

export const db = dbInstance;

// Helper DB Services
export const dbService = {
  async recordDonation(record: DonationRecord, batchNumber?: number) {
    // In-memory update
    dataStore.recordDonation(record, batchNumber);

    // Neon DB update
    if (db) {
      try {
        await db.insert(schema.donations).values({
          trxId: record.trxId,
          donorName: record.donorName,
          isAnonymous: record.isAnonymous,
          amountIDR: record.amountIDR,
          salt: record.salt,
          status: record.status || "PENDING",
          paymentMethod: record.paymentMethod || "QRIS",
          qrString: record.qrString || null,
          qrUrl: record.qrUrl || null,
          batchId: batchNumber || null,
        }).onConflictDoUpdate({
          target: schema.donations.trxId,
          set: {
            status: record.status || "PENDING",
            qrString: record.qrString || null,
            qrUrl: record.qrUrl || null,
          },
        });
      } catch (err) {
        console.error("Failed to insert donation to DB:", err);
      }
    }

    return record;
  },

  async getDonationByTrxId(trxId: string): Promise<(DonationRecord & { batchId?: number }) | null> {
    if (db) {
      try {
        const rows = await db
          .select()
          .from(schema.donations)
          .where(eq(schema.donations.trxId, trxId))
          .limit(1);
        if (rows.length > 0) {
          const row = rows[0];
          return {
            trxId: row.trxId,
            donorName: row.donorName,
            isAnonymous: row.isAnonymous,
            amountIDR: row.amountIDR,
            salt: row.salt,
            status: (row.status as any) || "PENDING",
            paymentMethod: row.paymentMethod,
            qrString: row.qrString || undefined,
            qrUrl: row.qrUrl || undefined,
            timestamp: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
            paidAt: row.paidAt ? row.paidAt.toISOString() : undefined,
            batchId: row.batchId || undefined,
          };
        }
      } catch (err) {
        console.error("Failed to query donation from DB:", err);
      }
    }

    return (dataStore.getDonation(trxId) as any) || null;
  },

  async markDonationAsPaid(trxId: string, paidAt?: string): Promise<DonationRecord | null> {
    const timeStr = paidAt || new Date().toISOString();
    
    // In-memory update
    const memoryRecord = dataStore.updateDonationStatus(trxId, "PAID", timeStr);

    // DB update
    if (db) {
      try {
        await db
          .update(schema.donations)
          .set({
            status: "PAID",
            paidAt: new Date(timeStr),
          })
          .where(eq(schema.donations.trxId, trxId));
      } catch (err) {
        console.error("Failed to update donation to PAID in DB:", err);
      }
    }

    return memoryRecord;
  },

  async getUnbatchedPaidDonations(): Promise<DonationRecord[]> {
    if (db) {
      try {
        const rows = await db
          .select()
          .from(schema.donations)
          .where(eq(schema.donations.status, "PAID"));
        
        const unbatched = rows.filter((r) => r.batchId === null || r.batchId === undefined);
        if (unbatched.length > 0) {
          return unbatched.map((row) => ({
            trxId: row.trxId,
            donorName: row.donorName,
            isAnonymous: row.isAnonymous,
            amountIDR: row.amountIDR,
            salt: row.salt,
            status: "PAID",
            paymentMethod: row.paymentMethod,
            qrString: row.qrString || undefined,
            qrUrl: row.qrUrl || undefined,
            timestamp: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
            paidAt: row.paidAt ? row.paidAt.toISOString() : undefined,
          }));
        }
      } catch (err) {
        console.error("Failed to fetch unbatched paid donations from DB:", err);
      }
    }

    return Array.from(dataStore.donations.values()).filter(
      (d) => d.status === "PAID" && (!d.batchId || d.batchId === 0)
    );
  },

  async markDonationsBatched(trxIds: string[], batchNumber: number) {
    for (const trxId of trxIds) {
      dataStore.updateDonationStatus(trxId, "BATCHED");
      const record = dataStore.donations.get(trxId);
      if (record) {
        record.batchId = batchNumber;
      }
    }

    if (db) {
      try {
        for (const trxId of trxIds) {
          await db
            .update(schema.donations)
            .set({
              status: "BATCHED",
              batchId: batchNumber,
            })
            .where(eq(schema.donations.trxId, trxId));
        }
      } catch (err) {
        console.error("Failed to update donations to BATCHED in DB:", err);
      }
    }
  },

  async recordBatchSettlement(
    batchNumber: number,
    merkleRoot: Hex,
    totalAmountIDR: number,
    itemCount: number,
    txHash?: string
  ): Promise<SettledBatch> {
    // In-memory update
    const batch: SettledBatch = {
      batchId: batchNumber,
      merkleRoot,
      totalAmountIDR,
      itemCount,
      settledAt: new Date().toISOString(),
      txHash,
    };
    dataStore.batches.set(batchNumber, batch);

    // Neon DB update
    if (db) {
      try {
        await db
          .insert(schema.merkleBatches)
          .values({
            batchNumber,
            merkleRoot,
            totalAmountIDR,
            itemCount,
            txHash: txHash || null,
            status: "settled_onchain",
          })
          .onConflictDoUpdate({
            target: schema.merkleBatches.batchNumber,
            set: {
              merkleRoot,
              totalAmountIDR,
              itemCount,
              txHash: txHash || null,
              status: "settled_onchain",
            },
          });
      } catch (err) {
        console.error("Failed to insert settled batch to Neon DB:", err);
      }
    }

    return batch;
  },

  async getBatches() {
    if (db) {
      try {
        const rows = await db.select().from(schema.merkleBatches).orderBy(desc(schema.merkleBatches.batchNumber));
        if (rows.length > 0) {
          return rows.map((r) => ({
            batchId: r.batchNumber,
            merkleRoot: r.merkleRoot as Hex,
            totalAmountIDR: r.totalAmountIDR,
            itemCount: r.itemCount,
            settledAt: r.settledAt ? r.settledAt.toISOString() : new Date().toISOString(),
            txHash: r.txHash || undefined,
          }));
        }
      } catch (err) {
        console.error("Failed to fetch batches from Neon DB:", err);
      }
    }
    return Array.from(dataStore.batches.values());
  },

  async getProposals() {
    if (db) {
      try {
        const rows = await db.select().from(schema.disbursementProposals).orderBy(desc(schema.disbursementProposals.proposalIdOnChain));
        // Auto-sync pending proposals with on-chain smart contract (only if beneficiaryHash matches)
        for (const r of rows) {
          if (r.status === "Pending" && r.proposalIdOnChain > 0 && r.beneficiaryHash) {
            try {
              const onchainP = await syncPublicClient.readContract({
                address: CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS,
                abi: PROPOSAL_SYNC_ABI,
                functionName: "proposals",
                args: [BigInt(r.proposalIdOnChain)],
              });
              const onchainBenHash = onchainP[4] as string;
              const onchainStatus = Number(onchainP[9]);
              const onchainApprovals = Number(onchainP[8]);

              // Verify that the on-chain proposal record actually matches this database proposal's beneficiaryHash
              if (
                onchainBenHash &&
                r.beneficiaryHash &&
                onchainBenHash.toLowerCase() === r.beneficiaryHash.toLowerCase()
              ) {
                if (onchainStatus === 1 || onchainApprovals >= 2) {
                  r.status = "Approved";
                  r.approvalCount = onchainApprovals;
                  r.safeStatus = "EXECUTED_ONCHAIN";
                  r.safeConfirmationsCount = 2;
                  r.approvedBy = JSON.stringify(["Amil Internal (Pengusul)", "Dewan Pengawas Syariah (DPS)"]);
                  
                  // Update database
                  db.update(schema.disbursementProposals).set({
                    status: "Approved",
                    approvalCount: onchainApprovals,
                    approvedBy: r.approvedBy,
                    safeStatus: "EXECUTED_ONCHAIN",
                    safeConfirmationsCount: 2,
                  }).where(eq(schema.disbursementProposals.id, r.id)).catch(() => {});
                }
              }
            } catch (err) {}
          }
        }

        if (rows.length > 0) {
          return rows.map((r) => {
            const pId = r.proposalIdOnChain || r.id;
            const isUSDC = r.currencyType === 1;
            const amountVal = Number(r.amount);
            const amountUSDCVal = isUSDC
              ? amountVal > 100000
                ? (amountVal / 1000000).toString()
                : amountVal.toString()
              : undefined;

            return {
              id: pId,
              proposalId: pId,
              currencyType: (r.currencyType as 0 | 1) || 0,
              amount: amountVal,
              amountIDR: !isUSDC ? amountVal : undefined,
              amountUSDC: amountUSDCVal,
              asnafCategory: 0,
              asnafLabel: r.asnafCategory || "Fakir Miskin",
              asnafType: r.asnafCategory || "Fakir Miskin",
              beneficiaryName: r.beneficiaryName,
              beneficiaryNIKMasked: r.beneficiaryNIKMasked,
              beneficiaryHash: r.beneficiaryHash as Hex,
              ipfsProofCID: r.ipfsProofCID,
              disbursementReceiptCID: r.disbursementReceiptCID || undefined,
              periodId: r.periodId,
              approvalCount: r.approvalCount,
              approvedBy: JSON.parse(r.approvedBy || "[]"),
              status: r.status as "Pending" | "Approved" | "Executed" | "Cancelled",
              cancelReason: r.cancelReason || undefined,
              createdAt: r.createdAt ? r.createdAt.toISOString() : new Date().toISOString(),
              executedAt: r.executedAt ? r.executedAt.toISOString() : undefined,
              txHash: r.txHash || undefined,
              // Ex-Post Auditor Attestation
              auditStatus: (r.auditStatus as "PENDING" | "AUDITED_WTP" | "DISPUTED") || "PENDING",
              auditorAddress: r.auditorAddress || undefined,
              auditorName: r.auditorName || undefined,
              auditReportCID: r.auditReportCID || undefined,
              auditOpinion: (r.auditOpinion as any) || undefined,
            auditNotes: r.auditNotes || undefined,
            auditedAt: r.auditedAt ? r.auditedAt.toISOString() : undefined,
            auditTxHash: r.auditTxHash || undefined,
              safeConfirmationsCount: r.safeConfirmationsCount || 0,
              safeConfirmationsRequired: r.safeConfirmationsRequired || 2,
            };
          });
        }
      } catch (err) {
        console.error("Failed to fetch proposals from Neon DB:", err);
      }
    }
    return Array.from(dataStore.proposals.values()).sort(
      (a, b) => b.proposalId - a.proposalId
    );
  },

  async getProofForTrx(trxId: string, salt: string, amountIDR: number) {
    return dataStore.getProofForTrx(trxId, salt, amountIDR);
  },

  async recordProposal(proposalData: any) {
    dataStore.proposals.set(proposalData.proposalId, proposalData);

    if (db) {
      try {
        await db.insert(schema.disbursementProposals).values({
          proposalIdOnChain: proposalData.proposalId,
          currencyType: proposalData.currencyType || 0,
          amount: proposalData.amount,
          asnafCategory: proposalData.asnafLabel || "Fisabilillah",
          beneficiaryName: proposalData.beneficiaryName,
          beneficiaryNIKMasked: proposalData.beneficiaryNIKMasked,
          beneficiaryHash: proposalData.beneficiaryHash,
          ipfsProofCID: proposalData.ipfsProofCID,
          periodId: proposalData.periodId || 202608,
          status: proposalData.status || "Pending",
          approvalCount: proposalData.approvalCount || 1,
          approvedBy: JSON.stringify(proposalData.approvedBy || ["Amil Internal (Pengusul)"]),
          safeStatus: "IDLE",
          safeConfirmationsCount: 0,
          safeConfirmationsRequired: 2,
        }).onConflictDoUpdate({
          target: schema.disbursementProposals.id,
          set: {
            status: proposalData.status || "Pending",
            approvalCount: proposalData.approvalCount || 1,
            approvedBy: JSON.stringify(proposalData.approvedBy || ["Amil Internal (Pengusul)"]),
          },
        });
      } catch (err) {
        console.error("Failed to insert proposal to Neon DB:", err);
      }
    }

    return proposalData;
  },

  async approveProposal(
    proposalId: number,
    approverRole: string,
    txHash?: string,
    safeData?: { isPendingSafeQuorum?: boolean; confirmationsCount?: number; confirmationsRequired?: number }
  ) {
    const memory = dataStore.proposals.get(proposalId);
    const isSafePending = safeData?.isPendingSafeQuorum && !txHash;

    let newCount = isSafePending ? (memory?.approvalCount || 1) : 2;
    let newApprovedBy = isSafePending
      ? (memory?.approvedBy || ["Amil Internal (Pengusul)"])
      : ["Amil Internal (Pengusul)", approverRole];
    let newStatus = isSafePending ? "Pending" : "Approved";
    let safeStatus = isSafePending ? "PENDING_SAFE_SIGNATURES" : (txHash ? "EXECUTED_ONCHAIN" : "IDLE");
    let safeConfirmationsCount = safeData?.confirmationsCount || (isSafePending ? 1 : 2);
    let safeConfirmationsRequired = safeData?.confirmationsRequired || 2;

    if (memory) {
      if (!isSafePending && !memory.approvedBy.includes(approverRole)) {
        memory.approvedBy.push(approverRole);
        memory.approvalCount = memory.approvedBy.length;
      }
      if (!isSafePending && memory.approvalCount >= 2) {
        memory.status = "Approved";
      }
      memory.safeStatus = safeStatus as any;
      memory.safeConfirmationsCount = safeConfirmationsCount;
      memory.safeConfirmationsRequired = safeConfirmationsRequired;

      newCount = memory.approvalCount;
      newApprovedBy = memory.approvedBy;
      newStatus = memory.status;
    }

    if (db) {
      try {
        await db
          .update(schema.disbursementProposals)
          .set({
            approvalCount: newCount,
            approvedBy: JSON.stringify(newApprovedBy),
            status: newStatus,
            safeStatus,
            safeConfirmationsCount,
            safeConfirmationsRequired,
            txHash: txHash || undefined,
          })
          .where(
            or(
              eq(schema.disbursementProposals.proposalIdOnChain, proposalId),
              eq(schema.disbursementProposals.id, proposalId)
            )
          );
      } catch (err) {
        console.error("Failed to update proposal approval in Neon DB:", err);
      }
    }

    return memory || {
      proposalId,
      approvalCount: newCount,
      approvedBy: newApprovedBy,
      status: newStatus,
      safeStatus,
      safeConfirmationsCount,
      safeConfirmationsRequired,
    };
  },

  async executeProposal(proposalId: number, txHash?: string, receiptCID?: string) {
    const memory = dataStore.proposals.get(proposalId);
    const executedAt = new Date().toISOString();

    if (memory) {
      memory.status = "Executed";
      memory.executedAt = executedAt;
      if (txHash) memory.txHash = txHash;
      if (receiptCID) memory.disbursementReceiptCID = receiptCID;
    }

    if (db) {
      try {
        await db
          .update(schema.disbursementProposals)
          .set({
            status: "Executed",
            executedAt: new Date(executedAt),
            ...(txHash ? { txHash } : {}),
            ...(receiptCID ? { disbursementReceiptCID: receiptCID } : {}),
          })
          .where(
            or(
              eq(schema.disbursementProposals.proposalIdOnChain, proposalId),
              eq(schema.disbursementProposals.id, proposalId)
            )
          );
      } catch (err) {
        console.error("Failed to execute proposal in Neon DB:", err);
      }
    }

    return memory || { proposalId, status: "Executed", executedAt, txHash, disbursementReceiptCID: receiptCID };
  },

  async syncProposalTx(currentId: number, proposalIdOnChain: number, txHash?: string) {
    let memory = dataStore.proposals.get(currentId);
    if (memory) {
      memory.proposalId = proposalIdOnChain;
      if (txHash) memory.txHash = txHash;
      dataStore.proposals.delete(currentId);
      dataStore.proposals.set(proposalIdOnChain, memory);
    } else {
      memory = {
        proposalId: proposalIdOnChain,
        currencyType: 0,
        amount: 0,
        asnafCategory: 0,
        asnafLabel: "Fisabilillah",
        beneficiaryName: "Mustahik",
        beneficiaryNIKMasked: "3171************",
        beneficiaryHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        ipfsProofCID: "QmPendingProofCID",
        periodId: 202608,
        approvalCount: 1,
        approvedBy: ["Amil Internal (Pengusul)"],
        status: "Pending",
        createdAt: new Date().toISOString(),
        txHash,
      };
      dataStore.proposals.set(proposalIdOnChain, memory);
    }

    if (db) {
      try {
        await db
          .update(schema.disbursementProposals)
          .set({
            proposalIdOnChain,
            status: "Pending",
          })
          .where(eq(schema.disbursementProposals.proposalIdOnChain, currentId));
      } catch (err) {
        console.error("Failed to sync proposal tx to Neon DB:", err);
      }
    }

    return memory;
  },

  async cancelProposal(proposalId: number, cancelReason: string, _txHash?: string) {
    const memory = dataStore.proposals.get(proposalId);

    if (memory) {
      memory.status = "Cancelled";
      memory.cancelReason = cancelReason;
      if (_txHash) memory.txHash = _txHash;
    }

    if (db) {
      try {
        await db
          .update(schema.disbursementProposals)
          .set({
            status: "Cancelled",
            cancelReason,
          })
          .where(eq(schema.disbursementProposals.proposalIdOnChain, proposalId));
      } catch (err) {
        console.error("Failed to cancel proposal in Neon DB:", err);
      }
    }

    return memory || { proposalId, status: "Cancelled", cancelReason, txHash: _txHash };
  },

  async attachBastReceipt(proposalId: number, receiptCID: string, receiptMetadata: any) {
    const memory = dataStore.proposals.get(proposalId);
    if (memory) {
      memory.disbursementReceiptCID = receiptCID;
    }

    if (db) {
      try {
        await db
          .update(schema.disbursementProposals)
          .set({
            disbursementReceiptCID: receiptCID,
          })
          .where(eq(schema.disbursementProposals.proposalIdOnChain, proposalId));
      } catch (err) {
        console.error("Failed to attach BAST receipt in Neon DB:", err);
      }
    }

    return memory || { proposalId, disbursementReceiptCID: receiptCID };
  },

  async attestProposal(
    proposalId: number,
    attestation: {
      auditorName: string;
      auditorAddress: string;
      auditOpinion: "WTP" | "WDP" | "TW" | "TMP";
      auditNotes?: string;
      auditReportCID: string;
      auditTxHash?: string;
      laiDocumentCID: string;
      financialStatementsCID: string;
    }
  ) {
    const memory = dataStore.proposals.get(proposalId);
    const auditedAt = new Date().toISOString();
    // Only a clean WTP opinion is undisputed; WDP/TW/TMP all mean the auditor
    // flagged a material issue, so any of them routes the proposal to DISPUTED.
    const auditStatus = attestation.auditOpinion === "WTP" ? "AUDITED_WTP" : "DISPUTED";

    if (memory) {
      memory.auditStatus = auditStatus;
      memory.auditorName = attestation.auditorName;
      memory.auditorAddress = attestation.auditorAddress;
      memory.auditOpinion = attestation.auditOpinion;
      memory.auditNotes = attestation.auditNotes;
      memory.auditReportCID = attestation.auditReportCID;
      memory.auditedAt = auditedAt;
      memory.auditTxHash = attestation.auditTxHash;
      memory.laiDocumentCID = attestation.laiDocumentCID;
      memory.financialStatementsCID = attestation.financialStatementsCID;
    }

    if (db) {
      try {
        await db
          .update(schema.disbursementProposals)
          .set({
            auditStatus,
            auditorName: attestation.auditorName,
            auditorAddress: attestation.auditorAddress,
            auditOpinion: attestation.auditOpinion,
            auditNotes: attestation.auditNotes,
            auditReportCID: attestation.auditReportCID,
            auditedAt: new Date(),
            auditTxHash: attestation.auditTxHash,
            laiDocumentCID: attestation.laiDocumentCID,
            financialStatementsCID: attestation.financialStatementsCID,
          })
          .where(eq(schema.disbursementProposals.proposalIdOnChain, proposalId));
      } catch (err) {
        console.error("Failed to attest proposal in Neon DB:", err);
      }
    }

    return memory || {
      proposalId,
      auditStatus,
      ...attestation,
      auditedAt,
    };
  },

  async getAuditOverview() {
    const proposals = await this.getProposals();
    const executed = proposals.filter((p) => p.status === "Executed");
    const audited = executed.filter((p) => p.auditStatus === "AUDITED_WTP");
    const disputed = executed.filter((p) => p.auditStatus === "DISPUTED");
    const pendingAudit = executed.filter((p) => !p.auditStatus || p.auditStatus === "PENDING");

    const totalDisbursedIDR = executed
      .filter((p) => p.currencyType === 0)
      .reduce((acc, p) => acc + p.amount, 0);
    const totalDisbursedUSDC = executed
      .filter((p) => p.currencyType === 1)
      .reduce((acc, p) => acc + p.amount, 0);

    const wtpRatePercentage =
      executed.length > 0 ? Math.round((audited.length / executed.length) * 100) : 100;

    return {
      totalExecutedDisbursements: executed.length,
      totalAudited: audited.length,
      totalDisputed: disputed.length,
      totalPendingAudit: pendingAudit.length,
      wtpRatePercentage,
      totalDisbursedIDR,
      totalDisbursedUSDC,
      standard: "PSAK 109 / SAS 109 & BAZNAS Sharia Compliance Standard",
    };
  },

  // --- INDEXER & ON-CHAIN EVENT PERSISTENCE (ADR-0008) ---
  async getIndexerState(indexerKey: string = "sepolia_zakat_l1") {
    if (db) {
      try {
        const rows = await db
          .select()
          .from(schema.indexerState)
          .where(eq(schema.indexerState.indexerKey, indexerKey))
          .limit(1);
        if (rows.length > 0) return rows[0];
      } catch (err) {
        console.error("Failed to query indexer state:", err);
      }
    }
    return {
      id: 1,
      indexerKey,
      lastIndexedBlock: 11569000,
      lastSyncAt: new Date(),
      status: "SYNCING",
      totalEventsIndexed: 0,
    };
  },

  async updateIndexerState(
    lastIndexedBlock: number,
    status: string = "SYNCED",
    eventsIncrement: number = 0,
    indexerKey: string = "sepolia_zakat_l1"
  ) {
    if (db) {
      try {
        const existing = await this.getIndexerState(indexerKey);
        const newTotal = (existing.totalEventsIndexed || 0) + eventsIncrement;
        await db
          .insert(schema.indexerState)
          .values({
            indexerKey,
            lastIndexedBlock,
            status,
            totalEventsIndexed: newTotal,
            lastSyncAt: new Date(),
          })
          .onConflictDoUpdate({
            target: schema.indexerState.indexerKey,
            set: {
              lastIndexedBlock,
              status,
              totalEventsIndexed: newTotal,
              lastSyncAt: new Date(),
            },
          });
      } catch (err) {
        console.error("Failed to update indexer state in Neon DB:", err);
      }
    }
  },

  async recordOnchainEvent(event: {
    txHash: string;
    blockNumber: number;
    logIndex?: number;
    eventName: string;
    contractAddress: string;
    argsJson: string;
  }) {
    if (db) {
      try {
        await db.insert(schema.onchainEvents).values({
          txHash: event.txHash,
          blockNumber: event.blockNumber,
          logIndex: event.logIndex || 0,
          eventName: event.eventName,
          contractAddress: event.contractAddress.toLowerCase(),
          argsJson: event.argsJson,
        });
      } catch (err) {
        console.error("Failed to record onchain event:", err);
      }
    }
  },

  async getOnchainEvents(limit: number = 50) {
    if (db) {
      try {
        return await db
          .select()
          .from(schema.onchainEvents)
          .orderBy(desc(schema.onchainEvents.blockNumber))
          .limit(limit);
      } catch (err) {
        console.error("Failed to fetch onchain events:", err);
      }
    }
    return [];
  },

  // --- ROLE REGISTRY METHODS (ADR-0008) ---
  async grantRoleMember(
    roleHash: string,
    roleName: string,
    accountAddress: string,
    blockNumber?: number,
    txHash?: string
  ) {
    const normalizedAddr = accountAddress.toLowerCase();
    if (db) {
      try {
        const existing = await db
          .select()
          .from(schema.roleMembers)
          .where(eq(schema.roleMembers.accountAddress, normalizedAddr));
        const matched = existing.find((r) => r.roleHash.toLowerCase() === roleHash.toLowerCase());

        if (matched) {
          await db
            .update(schema.roleMembers)
            .set({
              isActive: true,
              grantedAtBlock: blockNumber || matched.grantedAtBlock,
              txHash: txHash || matched.txHash,
              updatedAt: new Date(),
            })
            .where(eq(schema.roleMembers.id, matched.id));
        } else {
          await db.insert(schema.roleMembers).values({
            roleHash,
            roleName,
            accountAddress: normalizedAddr,
            isActive: true,
            grantedAtBlock: blockNumber || null,
            txHash: txHash || null,
          });
        }
      } catch (err) {
        console.error("Failed to grant role member in DB:", err);
      }
    }
  },

  async revokeRoleMember(
    roleHash: string,
    accountAddress: string,
    blockNumber?: number,
    txHash?: string
  ) {
    const normalizedAddr = accountAddress.toLowerCase();
    if (db) {
      try {
        const existing = await db
          .select()
          .from(schema.roleMembers)
          .where(eq(schema.roleMembers.accountAddress, normalizedAddr));
        const matched = existing.find((r) => r.roleHash.toLowerCase() === roleHash.toLowerCase());

        if (matched) {
          await db
            .update(schema.roleMembers)
            .set({
              isActive: false,
              revokedAtBlock: blockNumber || null,
              txHash: txHash || matched.txHash,
              updatedAt: new Date(),
            })
            .where(eq(schema.roleMembers.id, matched.id));
        }
      } catch (err) {
        console.error("Failed to revoke role member in DB:", err);
      }
    }
  },

  async getRoleMembers() {
    if (db) {
      try {
        return await db
          .select()
          .from(schema.roleMembers)
          .where(eq(schema.roleMembers.isActive, true));
      } catch (err) {
        console.error("Failed to fetch role members from DB:", err);
      }
    }
    // Fallback default known members
    return [
      {
        id: 1,
        roleHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        roleName: "DEFAULT_ADMIN_ROLE",
        accountAddress: "0x5e9b652c4e8a013f6fab69f0b55377c408b59968",
        isActive: true,
        grantedAtBlock: 11569000,
        revokedAtBlock: null,
        txHash: null,
        updatedAt: new Date(),
      },
      {
        id: 2,
        roleHash: "0x59a1c48e5837ad7a7f3dcedcbe129bf3249ec4fbf651fd4f5e2600ead39fe2f5",
        roleName: "SHARIA_SUPERVISOR_ROLE",
        accountAddress: "0xb4e4253e2affdc0710cb9394b8c4e935f11b00f1",
        isActive: true,
        grantedAtBlock: 11569000,
        revokedAtBlock: null,
        txHash: null,
        updatedAt: new Date(),
      },
    ];
  },

  // --- AUDITOR IDENTITY REGISTRY (one-time onboarding, source of truth for attestations) ---
  async upsertAuditorProfile(profile: {
    accountAddress: string;
    name: string;
    kapLicenseNumber: string;
    licenseProofCID: string;
    registeredBy: string;
  }) {
    const normalizedAddr = profile.accountAddress.toLowerCase();

    if (db) {
      try {
        const [row] = await db
          .insert(schema.auditorProfiles)
          .values({
            accountAddress: normalizedAddr,
            name: profile.name,
            kapLicenseNumber: profile.kapLicenseNumber,
            licenseProofCID: profile.licenseProofCID,
            registeredBy: profile.registeredBy,
          })
          .onConflictDoUpdate({
            target: schema.auditorProfiles.accountAddress,
            set: {
              name: profile.name,
              kapLicenseNumber: profile.kapLicenseNumber,
              licenseProofCID: profile.licenseProofCID,
              registeredBy: profile.registeredBy,
              isActive: true,
              updatedAt: new Date(),
            },
          })
          .returning();
        return row;
      } catch (err) {
        console.error("Failed to upsert auditor profile in Neon DB:", err);
      }
    }

    return {
      id: 0,
      accountAddress: normalizedAddr,
      name: profile.name,
      kapLicenseNumber: profile.kapLicenseNumber,
      licenseProofCID: profile.licenseProofCID,
      isActive: true,
      registeredBy: profile.registeredBy,
      registeredAt: new Date(),
      updatedAt: new Date(),
    };
  },

  async getAuditorProfile(accountAddress: string) {
    const normalizedAddr = accountAddress.toLowerCase();
    if (db) {
      try {
        const rows = await db
          .select()
          .from(schema.auditorProfiles)
          .where(eq(schema.auditorProfiles.accountAddress, normalizedAddr));
        return rows.find((r) => r.isActive) || null;
      } catch (err) {
        console.error("Failed to fetch auditor profile from Neon DB:", err);
      }
    }
    return null;
  },

  async getAuditorProfiles() {
    if (db) {
      try {
        return await db
          .select()
          .from(schema.auditorProfiles)
          .where(eq(schema.auditorProfiles.isActive, true));
      } catch (err) {
        console.error("Failed to fetch auditor profiles from Neon DB:", err);
      }
    }
    return [];
  },

  // --- USDC ON-CHAIN DONATION AUTO-RECORDING ---
  async recordUSDCDonation(data: {
    txHash: string;
    donor: string;
    amountUSDC: number; // Raw USDC value (6 decimals or human number)
    isAnonymous: boolean;
    commitmentHash?: string;
    blockNumber?: number;
    timestamp?: string;
  }) {
    const timestampStr = data.timestamp || new Date().toISOString();
    const dateStr = timestampStr.slice(0, 10).replace(/-/g, "");
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const trxId = `USDC-${dateStr}-${randomSuffix}`;
    const salt = `usdc_salt_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;

    // Compute approximate IDR equivalent for unified ledger reporting (e.g. 1 USDC = ~16,200 IDR)
    // Human amount in USDC: raw / 1e6
    const humanUSDC = data.amountUSDC > 1e6 ? data.amountUSDC / 1e6 : data.amountUSDC;
    const estimatedIDR = Math.round(humanUSDC * 16200);

    const record: DonationRecord = {
      trxId,
      donorName: data.isAnonymous ? "Hamba Allah" : `Muzakki Web3 (${data.donor.slice(0, 6)}...${data.donor.slice(-4)})`,
      isAnonymous: Boolean(data.isAnonymous),
      salt,
      amountIDR: estimatedIDR,
      timestamp: timestampStr,
      status: "PAID",
      paymentMethod: "USDC",
    };

    if (db) {
      try {
        await db.insert(schema.donations).values({
          trxId,
          donorName: record.donorName,
          isAnonymous: record.isAnonymous,
          amountIDR: record.amountIDR,
          salt: record.salt,
          status: "PAID",
          paymentMethod: "USDC",
          createdAt: new Date(timestampStr),
          paidAt: new Date(timestampStr),
        }).onConflictDoNothing();
      } catch (err) {
        console.error("Failed to record USDC donation in DB:", err);
      }
    }

    dataStore.recordDonation(record);
    return { success: true, record, trxId };
  },
};




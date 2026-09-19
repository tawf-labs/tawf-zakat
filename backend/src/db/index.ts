import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { dataStore, type SettledBatch, type ProposalRecord } from "../store";
import { computeDonationLeaf, MerkleTree, type DonationRecord } from "../merkle";
import { formatUnits, type Hex } from "viem";
import { and, asc, desc, eq, gte, inArray, lte, or } from "drizzle-orm";
import { CONTRACT_CONFIG } from "../config";
import { STAGE_EVENT_NAMES } from "../disbursement-duration";
import { governanceChain, type GOVERNANCE_ACTIONS, type GovernanceMetadata } from "../governance-chain";
import { attemptRead, sourceMissing, type SourceRead } from "../source-read";
import { randomUUID } from "node:crypto";
import {
  readDepositIntake,
  type DepositEventInput,
  type DepositIntakeRecord,
} from "../usdc-deposit-intake";
import { donationSelection, hasNativeDepositColumns, saveUsdcDeposit } from "../usdc-deposit-store";
import { hasExactAmountColumn, proposalSelection, saveConfirmedProposal } from "../proposal-amount-store";

/**
 * Whether this deployment's `donations` table can hold a deposit identity
 * (#67). Resolved on first use and kept, so the catalog is not queried once per
 * indexed event or once per read.
 */
let depositColumnsPresent: boolean | null = null;

/**
 * The columns a `donations` query may name on *this* deployment.
 *
 * Running the migration is deliberately separate from deploying the code, so a
 * database without the deposit columns is a supported state - and Drizzle names
 * every column of the model unless told otherwise, which would fail every read.
 */
/**
 * A donation row as this deployment can actually answer for it.
 *
 * The deposit fields are optional rather than nullable: on an unmigrated
 * database they are not `null`, they are not there at all, and a reader that
 * has to tell those apart is asking a question the table cannot answer.
 */
export type DonationLedgerRow = Omit<schema.Donation, DepositColumn> &
  Partial<Pick<schema.Donation, DepositColumn>>;

type DepositColumn =
  | "amountUsdc6dp"
  | "depositChainId"
  | "depositContract"
  | "depositTxHash"
  | "depositLogIndex";

/**
 * A proposal row as this deployment can answer for it. `amountExact` is optional
 * rather than nullable: before the migration it is not there at all.
 */
export type ProposalLedgerRow = Omit<schema.DisbursementProposal, "amountExact"> &
  Partial<Pick<schema.DisbursementProposal, "amountExact">>;

/** Whether `disbursement_proposals` can hold an exact amount (#80). */
let proposalExactColumnPresent: boolean | null = null;

async function proposalAmountColumn(): Promise<boolean> {
  if (db) proposalExactColumnPresent ??= await hasExactAmountColumn(db);
  return proposalExactColumnPresent ?? false;
}

async function proposalColumns() {
  return proposalSelection(await proposalAmountColumn());
}

async function donationColumns() {
  if (db) depositColumnsPresent ??= await hasNativeDepositColumns(db);
  return donationSelection(depositColumnsPresent ?? false);
}

const indexerKeyForDeployment = () => `${CONTRACT_CONFIG.CHAIN_ID}:${CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS.toLowerCase()}`;

// Test imports must never connect to (or run startup DDL against) the demo DB.
const databaseUrl = process.env.NODE_ENV === "test" ? undefined : process.env.DATABASE_URL;

/** The narrow projection `readProposalStageEvents` returns. */
type StageEventRow = { eventName: string; blockNumber: number; argsJson: string };

/** Why a source is MISSING rather than empty: there is no ledger to read at all. */
const NO_DATABASE =
  "Deployment ini tidak memiliki basis data ledger (DATABASE_URL belum disetel), sehingga periode ini belum pernah dibaca.";

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

if (databaseUrl) {
  try {
    const client = postgres(databaseUrl, { max: 10 });
    dbInstance = drizzle(client, { schema });
    console.log("Connected to Neon PostgreSQL database via Drizzle ORM");
    // Ensure new columns & indexer tables exist
    const initStatements = [
      `CREATE UNIQUE INDEX IF NOT EXISTS disbursement_proposals_proposal_id_on_chain_unique ON disbursement_proposals (proposal_id_on_chain);`,
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
  async confirmGovernance(action: keyof typeof GOVERNANCE_ACTIONS, txHash: string, proposalId?: number, metadata?: GovernanceMetadata, signature?: Hex) {
    const confirmed = await governanceChain.confirm(action, txHash, proposalId, metadata, signature);
    const p = confirmed.proposal;
    const canonical = {
      currencyType: p.currencyType, amountExact: p.amountExact, asnafCategory: p.asnafLabel,
      beneficiaryHash: p.beneficiaryHash, ipfsProofCID: p.ipfsProofCID,
      periodId: p.periodId, approvalCount: p.approvalCount, status: p.status,
      txHash, ...(action === "execute" ? { executedAt: new Date(confirmed.timestamp) } : {}),
      ...(action === "cancel" ? { cancelReason: confirmed.cancelReason } : {}),
      ...(action === "propose" && metadata ? { beneficiaryName: metadata.beneficiaryName ?? "", beneficiaryNIKMasked: metadata.beneficiaryNIKMasked ?? "" } : {}),
      ...(action === "execute" && metadata?.disbursementReceiptCID ? { disbursementReceiptCID: metadata.disbursementReceiptCID } : {}),
    };
    if (db) {
      await saveConfirmedProposal(db, {
        ...canonical, proposalIdOnChain: p.proposalId,
        ...(action === "propose" ? { createdAt: new Date(confirmed.timestamp) } : {}),
      }, await proposalAmountColumn());
    }
    const memory = dataStore.proposals.get(p.proposalId);
    const record = { ...memory, ...p, currencyType: p.currencyType as 0 | 1,
      beneficiaryName: metadata?.beneficiaryName ?? memory?.beneficiaryName ?? "", beneficiaryNIKMasked: metadata?.beneficiaryNIKMasked ?? memory?.beneficiaryNIKMasked ?? "",
      disbursementReceiptCID: metadata?.disbursementReceiptCID ?? memory?.disbursementReceiptCID,
      approvedBy: memory?.approvedBy ?? [], txHash,
      ...(action === "execute" ? { executedAt: confirmed.timestamp } : {}),
      ...(action === "cancel" ? { cancelReason: confirmed.cancelReason } : {}),
    };
    dataStore.proposals.set(p.proposalId, record);
    return record;
  },

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
          paidAt: record.paidAt ? new Date(record.paidAt) : null,
        }).onConflictDoUpdate({
          target: schema.donations.trxId,
          set: {
            status: record.status || "PENDING",
            ...(record.paidAt ? { paidAt: new Date(record.paidAt) } : {}),
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
          .select(await donationColumns())
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
        // A failed read must not fall through to the in-memory store and read as "not found".
        console.error("Failed to query donation from DB:", err);
        throw err;
      }
    }

    return (dataStore.getDonation(trxId) as any) || null;
  },

  async getContributionByIdOrRef(idOrRef: string): Promise<schema.ContributionRow | null> {
    if (db) {
      try {
        const rows = await db
          .select()
          .from(schema.contributions)
          .where(or(eq(schema.contributions.id, idOrRef), eq(schema.contributions.sourceReference, idOrRef)))
          .limit(1);
        return rows[0] || null;
      } catch (err) {
        console.error("Failed to query contribution from DB:", err);
        return null;
      }
    }
    return null;
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
          .select(await donationColumns())
          .from(schema.donations)
          .where(and(
            eq(schema.donations.status, "PAID"),
            eq(schema.donations.paymentMethod, "QRIS"),
          ));
        
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
      (d) => d.status === "PAID" && (d.paymentMethod || "QRIS") === "QRIS" && (!d.batchId || d.batchId === 0)
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

  async getBatchByNumber(batchNumber: number) {
    if (db) {
      try {
        const rows = await db
          .select()
          .from(schema.merkleBatches)
          .where(eq(schema.merkleBatches.batchNumber, batchNumber));
        if (rows.length > 0) {
          const r = rows[0];
          return {
            batchId: r.batchNumber,
            merkleRoot: r.merkleRoot as Hex,
            totalAmountIDR: r.totalAmountIDR,
            itemCount: r.itemCount,
            settledAt: r.settledAt ? r.settledAt.toISOString() : new Date().toISOString(),
            txHash: r.txHash || undefined,
          };
        }
      } catch (err) {
        console.error("Failed to fetch batch by number from Neon DB:", err);
      }
    }
    return dataStore.batches.get(batchNumber) || null;
  },

  async getProposals() {
    if (db) {
      try {
        const rows = await db.select(await proposalColumns()).from(schema.disbursementProposals).orderBy(desc(schema.disbursementProposals.proposalIdOnChain));
        const verified = new Map<number, Awaited<ReturnType<typeof governanceChain.readProposal>>>();
        // Reconcile every status, including a previously incorrect Executed row.
        for (const r of rows) {
          try {
            const p = await governanceChain.readProposal(r.proposalIdOnChain);
            if (p.beneficiaryHash.toLowerCase() !== r.beneficiaryHash.toLowerCase()) continue;
            verified.set(r.id, p);
            if (r.status !== p.status || r.approvalCount !== p.approvalCount) {
              await db.update(schema.disbursementProposals).set({
                status: p.status, approvalCount: p.approvalCount,
                ...(p.status !== "Executed" ? { executedAt: null } : {}),
              }).where(eq(schema.disbursementProposals.id, r.id));
              r.status = p.status;
              r.approvalCount = p.approvalCount;
              if (p.status !== "Executed") r.executedAt = null;
            }
          } catch {
            // A failed RPC must not certify stale data as ready for audit.
          }
        }

        if (rows.length > 0) {
          return rows.map((r) => {
            const pId = r.proposalIdOnChain || r.id;
            const isUSDC = r.currencyType === 1;
            const exact = verified.get(r.id)?.amountExact ?? r.amountExact;
            const amountVal = exact != null
              ? BigInt(exact) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(exact) : exact
              : isUSDC ? null : r.amount;
            const amountUSDCVal = isUSDC && exact != null ? formatUnits(BigInt(exact), 6) : undefined;

            return {
              id: pId,
              proposalId: pId,
              currencyType: (r.currencyType as 0 | 1) || 0,
              amount: amountVal,
              amountExact: exact ?? null,
              amountIDR: !isUSDC ? amountVal : undefined,
              amountUSDC: amountUSDCVal,
              chainVerified: verified.has(r.id),
              asnafCategory: verified.get(r.id)?.asnafCategory ?? 0,
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

    const totalFor = (currencyType: number) => {
      const rows = executed.filter((p) => p.currencyType === currencyType);
      if (rows.some((p) => p.amount === null)) return null;
      const total = rows.reduce((sum, p) => sum + BigInt(p.amount!), 0n);
      return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : total.toString();
    };
    const totalDisbursedIDR = totalFor(0);
    const totalDisbursedUSDC = totalFor(1);

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
  async getIndexerState(indexerKey: string = indexerKeyForDeployment()) {
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
      lastIndexedBlock: Math.max(0, CONTRACT_CONFIG.INDEXER_START_BLOCK - 1),
      lastSyncAt: new Date(),
      status: "SYNCING",
      totalEventsIndexed: 0,
    };
  },

  async updateIndexerState(
    lastIndexedBlock: number,
    status: string = "SYNCED",
    eventsIncrement: number = 0,
    indexerKey: string = indexerKeyForDeployment()
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

  /**
   * Raw donation rows, as stored. Reconciliation needs the whole population
   * including batched ones, which the batching read paths deliberately exclude.
   */
  async getDonationRows() {
    if (db) {
      try {
        return await db.select(await donationColumns()).from(schema.donations).orderBy(asc(schema.donations.id));
      } catch (err) {
        console.error("Failed to fetch donation rows:", err);
      }
    }
    return [];
  },

  /**
   * Raw proposal rows, as stored. Unlike `getProposals` this reads nothing from
   * the chain and writes nothing back: a reconciliation must compare the
   * database as it stands, not a database it just repaired.
   */
  async getProposalRows() {
    if (db) {
      try {
        return await db
          .select(await proposalColumns())
          .from(schema.disbursementProposals)
          .orderBy(asc(schema.disbursementProposals.proposalIdOnChain));
      } catch (err) {
        console.error("Failed to fetch proposal rows:", err);
      }
    }
    return [];
  },

  /**
   * Every indexed event inside a block range, oldest first.
   *
   * Additive to `getOnchainEvents`, which returns only the newest rows and is
   * shaped for the activity feed. Reconciliation needs the whole population of a
   * range instead, so it reads through here and leaves the feed path untouched.
   */
  async getOnchainEventsInRange(fromBlock: number, toBlock: number) {
    if (db) {
      try {
        return await db
          .select()
          .from(schema.onchainEvents)
          .where(
            and(
              gte(schema.onchainEvents.blockNumber, fromBlock),
              lte(schema.onchainEvents.blockNumber, toBlock)
            )
          )
          .orderBy(asc(schema.onchainEvents.blockNumber), asc(schema.onchainEvents.logIndex));
      } catch (err) {
        console.error("Failed to fetch onchain events in range:", err);
      }
    }
    return [];
  },

  /**
   * The honest readers (Spec #68, ticket #70).
   *
   * Their `get*` counterparts above answer every question with a list, so a
   * query that threw is indistinguishable from a period that held no rows -
   * and the report built on top calls both `0`. These say which of the three
   * things happened instead, and leave it to the caller to decide what a
   * missing or failed source means for the figures it was about to publish.
   *
   * `MISSING` is reserved for a deployment with no database configured at all.
   * It is knowledge this module has before it tries, never inferred from an
   * exception, which is why it is not produced by `attemptRead`.
   */
  async readDonationRows(): Promise<SourceRead<DonationLedgerRow>> {
    if (!db) return sourceMissing(NO_DATABASE);
    return attemptRead(async () =>
      db!.select(await donationColumns()).from(schema.donations).orderBy(asc(schema.donations.id))
    );
  },

  async readProposalRows(): Promise<SourceRead<ProposalLedgerRow>> {
    if (!db) return sourceMissing(NO_DATABASE);
    return attemptRead(async () =>
      db!
        .select(await proposalColumns())
        .from(schema.disbursementProposals)
        .orderBy(asc(schema.disbursementProposals.proposalIdOnChain))
    );
  },

  async readOnchainEventsInRange(
    fromBlock: number,
    toBlock: number
  ): Promise<SourceRead<schema.OnchainEvent>> {
    if (!db) return sourceMissing(NO_DATABASE);
    // An inverted range is not a failure: it is a range that selects nothing,
    // which the indexer legitimately produces before it has read a first block.
    if (toBlock < fromBlock) return { status: "READ", rows: [] };
    return attemptRead(() =>
      db!
        .select()
        .from(schema.onchainEvents)
        .where(
          and(
            gte(schema.onchainEvents.blockNumber, fromBlock),
            lte(schema.onchainEvents.blockNumber, toBlock)
          )
        )
        .orderBy(asc(schema.onchainEvents.blockNumber), asc(schema.onchainEvents.logIndex))
    );
  },

  async readProposalStageEvents(): Promise<SourceRead<StageEventRow>> {
    if (!db) return sourceMissing(NO_DATABASE);
    return attemptRead(() =>
      db!
        .select({
          eventName: schema.onchainEvents.eventName,
          blockNumber: schema.onchainEvents.blockNumber,
          argsJson: schema.onchainEvents.argsJson,
        })
        .from(schema.onchainEvents)
        .where(inArray(schema.onchainEvents.eventName, STAGE_EVENT_NAMES))
        .orderBy(asc(schema.onchainEvents.blockNumber), asc(schema.onchainEvents.logIndex))
    );
  },

  /**
   * Settled batches, read from the database only.
   *
   * `getBatches` falls back to the in-process store when the database holds no
   * rows, which is right for the activity feed and wrong for a report: an empty
   * table would silently become whatever this process happens to remember.
   */
  async readBatches(): Promise<SourceRead<SettledBatch>> {
    if (!db) return sourceMissing(NO_DATABASE);
    return attemptRead(async () => {
      const rows = await db!
        .select()
        .from(schema.merkleBatches)
        .orderBy(desc(schema.merkleBatches.batchNumber));
      return rows.map((r) => ({
        batchId: r.batchNumber,
        merkleRoot: r.merkleRoot as Hex,
        totalAmountIDR: r.totalAmountIDR,
        itemCount: r.itemCount,
        settledAt: r.settledAt ? r.settledAt.toISOString() : new Date().toISOString(),
        txHash: r.txHash || undefined,
      }));
    });
  },

  /**
   * The indexed events that mark a disbursement's stages (Spec #61, ticket #65).
   *
   * Read-only and narrow: only the three events of the disbursement lifecycle,
   * and only for the block number each one fixes a stage at. The attestation is
   * relayed gasless and is not among the indexed events, so it has no row here
   * and the period report reports its block number as absent rather than
   * guessing one.
   */
  async getProposalStageEvents() {
    if (db) {
      try {
        return await db
          .select({
            eventName: schema.onchainEvents.eventName,
            blockNumber: schema.onchainEvents.blockNumber,
            argsJson: schema.onchainEvents.argsJson,
          })
          .from(schema.onchainEvents)
          .where(
            inArray(schema.onchainEvents.eventName, STAGE_EVENT_NAMES)
          )
          .orderBy(asc(schema.onchainEvents.blockNumber), asc(schema.onchainEvents.logIndex));
      } catch (err) {
        console.error("Failed to fetch proposal stage events:", err);
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
    // An empty registry or unavailable database must not invent privileged wallets.
    return [];
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

  /**
   * Records one indexed USDC deposit, at most once (ticket #67).
   *
   * Three things changed here and each was a way a deposit stopped being
   * checkable:
   *
   * - The amount no longer passes through `Number`, is no longer rescaled by a
   *   magnitude heuristic, and is no longer stored only as an estimated rupiah
   *   figure at a hardcoded rate. It is kept as exact minor units.
   * - The row carries the chain, contract, transaction hash and log index it
   *   came from, so it can be paired with the event that produced it.
   * - The `trxId` is derived from that identity instead of a random suffix, so
   *   a reprocessed event lands on the row it already wrote rather than beside
   *   it.
   *
   * Reading the event and keeping it are separate: `readDepositIntake` decides
   * what the event says, `saveUsdcDeposit` decides what the database does about
   * it, and neither can be reached without the other having succeeded.
   */
  async recordUSDCDonation(
    event: DepositEventInput
  ): Promise<
    | { success: true; record: DepositIntakeRecord; trxId: string; stored: "INSERTED" | "UNCHANGED" }
    | { success: false; error: string }
  > {
    const read = readDepositIntake({
      ...event,
      occurredAt: event.occurredAt ?? new Date().toISOString(),
    });
    if ("error" in read) return { success: false, error: read.error };

    const { record } = read;
    // One salt for both copies of the row. Two would give the durable row and
    // the in-memory mirror different leaves for the same donation.
    const salt = `usdc_salt_${randomUUID()}`;
    let stored: "INSERTED" | "UNCHANGED" = "UNCHANGED";

    if (db) {
      try {
        // The catalog is asked once per process, not once per deposit: the
        // columns cannot appear or vanish while the indexer is running, and a
        // migration is a restart-worthy event either way.
        depositColumnsPresent ??= await hasNativeDepositColumns(db);
        const outcome = await saveUsdcDeposit(db, record, {
          salt,
          migrated: depositColumnsPresent,
        });
        stored = outcome.stored;
        if (!outcome.identityPreserved) {
          console.warn(
            `[USDC] Migrasi identitas deposit (#67) belum diterapkan pada deployment ini, ` +
              `sehingga ${record.trxId} tersimpan tanpa jumlah native dan identitas event. ` +
              `Jumlahnya tetap utuh pada onchain_events (${record.identity.txHash}#` +
              `${record.identity.logIndex}) dan baris ini menjadi lengkap setelah migrasi ` +
              `dijalankan dan event diindeks ulang. Estimasi rupiah tidak dipakai sebagai gantinya.`
          );
        }
      } catch (err) {
        console.error("Failed to record USDC donation in DB:", err);
        return { success: false, error: String((err as any)?.message ?? err) };
      }
    }

    // The in-memory mirror is keyed by trxId, so a reprocessed event would
    // overwrite the row - including a batch id it has since been given. An
    // already known deposit is left exactly as it is.
    if (!dataStore.getDonation(record.trxId)) {
      dataStore.recordDonation({
        trxId: record.trxId,
        donorName: record.donorName,
        isAnonymous: record.isAnonymous,
        salt,
        // Rupiah is not the unit this deposit was made in, and no rate is
        // applied to invent one. The native amount lives on the stored row.
        amountIDR: 0,
        timestamp: record.occurredAt,
        status: "PAID",
        paymentMethod: "USDC",
      });
    }

    return { success: true, record, trxId: record.trxId, stored };
  },
};

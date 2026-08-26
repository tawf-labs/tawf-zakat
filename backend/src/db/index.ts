import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { dataStore, type SettledBatch, type ProposalRecord } from "../store";
import { computeDonationLeaf, MerkleTree, type DonationRecord } from "../merkle";
import { type Hex } from "viem";
import { desc, eq } from "drizzle-orm";

const databaseUrl = process.env.DATABASE_URL;

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

if (databaseUrl) {
  try {
    const client = postgres(databaseUrl, { max: 10 });
    dbInstance = drizzle(client, { schema });
    console.log("Connected to Neon PostgreSQL database via Drizzle ORM");
  } catch (err) {
    console.warn("Neon database connection failed, falling back to local data store:", err);
  }
}

export const db = dbInstance;

// Helper DB Services
export const dbService = {
  async recordDonation(record: DonationRecord, batchNumber: number = 1) {
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
        }).onConflictDoNothing();
      } catch (err) {
        console.error("Failed to insert donation to DB:", err);
      }
    }

    return record;
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
        if (rows.length > 0) {
          return rows.map((r) => ({
            proposalId: r.proposalIdOnChain,
            currencyType: r.currencyType as 0 | 1,
            amount: r.amount,
            asnafCategory: 0,
            asnafLabel: r.asnafCategory,
            beneficiaryName: r.beneficiaryName,
            beneficiaryNIKMasked: r.beneficiaryNIKMasked,
            beneficiaryHash: r.beneficiaryHash as Hex,
            ipfsProofCID: r.ipfsProofCID,
            periodId: r.periodId,
            approvalCount: r.approvalCount,
            approvedBy: JSON.parse(r.approvedBy || "[]"),
            status: r.status as "Pending" | "Approved" | "Executed" | "Cancelled",
            cancelReason: r.cancelReason || undefined,
            createdAt: r.createdAt ? r.createdAt.toISOString() : new Date().toISOString(),
            executedAt: r.executedAt ? r.executedAt.toISOString() : undefined,
          }));
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
          approvedBy: JSON.stringify(proposalData.approvedBy || ["Amil Internal"]),
        });
      } catch (err) {
        console.error("Failed to insert proposal to Neon DB:", err);
      }
    }

    return proposalData;
  },
};

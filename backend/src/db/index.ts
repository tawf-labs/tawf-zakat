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
          approvedBy: JSON.stringify(proposalData.approvedBy || ["Amil Internal (Pengusul)"]),
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

  async approveProposal(proposalId: number, approverRole: string, _txHash?: string) {
    const memory = dataStore.proposals.get(proposalId);
    let newCount = 2;
    let newApprovedBy = ["Amil Internal (Pengusul)", approverRole];
    let newStatus = "Approved";

    if (memory) {
      if (!memory.approvedBy.includes(approverRole)) {
        memory.approvedBy.push(approverRole);
        memory.approvalCount = memory.approvedBy.length;
      }
      if (memory.approvalCount >= 2) {
        memory.status = "Approved";
      }
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
          })
          .where(eq(schema.disbursementProposals.proposalIdOnChain, proposalId));
      } catch (err) {
        console.error("Failed to update proposal approval in Neon DB:", err);
      }
    }

    return memory || { proposalId, approvalCount: newCount, approvedBy: newApprovedBy, status: newStatus };
  },

  async executeProposal(proposalId: number, _txHash?: string) {
    const memory = dataStore.proposals.get(proposalId);
    const executedAt = new Date().toISOString();

    if (memory) {
      memory.status = "Executed";
      memory.executedAt = executedAt;
    }

    if (db) {
      try {
        await db
          .update(schema.disbursementProposals)
          .set({
            status: "Executed",
            executedAt: new Date(executedAt),
          })
          .where(eq(schema.disbursementProposals.proposalIdOnChain, proposalId));
      } catch (err) {
        console.error("Failed to execute proposal in Neon DB:", err);
      }
    }

    return memory || { proposalId, status: "Executed", executedAt };
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
};


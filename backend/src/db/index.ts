import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { dataStore } from "../store";
import { computeDonationLeaf, MerkleTree, type DonationRecord } from "../merkle";
import { type Hex } from "viem";

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
    // Fallback store
    dataStore.recordDonation(record, batchNumber);

    if (db) {
      try {
        await db.insert(schema.donations).values({
          trxId: record.trxId,
          donorName: record.donorName,
          isAnonymous: record.isAnonymous,
          amountIDR: record.amountIDR,
          salt: record.salt,
        });
      } catch (err) {
        console.error("Failed to insert donation to DB:", err);
      }
    }

    return record;
  },

  async getBatches() {
    return Array.from(dataStore.batches.values());
  },

  async getProposals() {
    return Array.from(dataStore.proposals.values()).sort(
      (a, b) => b.proposalId - a.proposalId
    );
  },

  async getProofForTrx(trxId: string, salt: string, amountIDR: number) {
    return dataStore.getProofForTrx(trxId, salt, amountIDR);
  },

  async createProposal(proposalData: any) {
    dataStore.proposals.set(proposalData.proposalId, proposalData);
    return proposalData;
  },
};

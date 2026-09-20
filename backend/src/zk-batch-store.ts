/**
 * ZK Contribution Batch Store (Spec #100, Issue #108)
 *
 * Manages small snapshot batches of institution-endorsed contributions (#102),
 * computes Poseidon Merkle roots, isolates private witnesses, and tracks
 * persistent receipt proof verifications.
 */

import { sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { buildPoseidon } from "circomlibjs";

export const SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const TREE_DEPTH = 4;
export const MAX_BATCH_LEAVES = 16; // 2^4

export const ZK_BATCH_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS zk_contribution_batches (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL REFERENCES institutions(id),
    batch_number INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    merkle_root TEXT NOT NULL,
    total_amount_exact TEXT NOT NULL,
    currency_unit TEXT NOT NULL,
    fund_type TEXT NOT NULL,
    item_count INTEGER NOT NULL,
    leaves_json TEXT NOT NULL DEFAULT '[]',
    endorsed_by TEXT,
    endorsement_mandate_id TEXT,
    endorsed_at BIGINT,
    tx_hash TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS zk_contribution_batch_items (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES zk_contribution_batches(id) ON DELETE CASCADE,
    contribution_id TEXT NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
    leaf_index INTEGER NOT NULL,
    leaf_hash TEXT NOT NULL,
    receipt_commitment TEXT NOT NULL,
    witness_data_json TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS zk_contribution_receipt_proofs (
    id TEXT PRIMARY KEY,
    contribution_id TEXT NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
    batch_id TEXT NOT NULL REFERENCES zk_contribution_batches(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'PENDING',
    public_signals_json TEXT,
    proof_json TEXT,
    tx_hash TEXT,
    block_number INTEGER,
    verified_at BIGINT,
    failure_reason TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    CONSTRAINT zk_proof_uniq UNIQUE (contribution_id, batch_id, version)
  );`,
  `ALTER TABLE zk_contribution_batches ADD COLUMN IF NOT EXISTS cutoff BIGINT;`,
  `ALTER TABLE zk_contribution_batches ADD COLUMN IF NOT EXISTS endorsement_mandate_version INTEGER;`,
  `ALTER TABLE zk_contribution_batches ADD COLUMN IF NOT EXISTS predecessor_batch_id TEXT REFERENCES zk_contribution_batches(id);`,
  `ALTER TABLE zk_contribution_batches ADD COLUMN IF NOT EXISTS correction_reason TEXT;`,
  `ALTER TABLE zk_contribution_batches ADD COLUMN IF NOT EXISTS source_proof_ref TEXT;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS zk_proof_receipt_version_unique ON zk_contribution_receipt_proofs (contribution_id, version);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS zk_batch_active_version_unique ON zk_contribution_batches (institution_id, batch_number, version) WHERE status <> 'ABANDONED';`,
  `DROP INDEX IF EXISTS zk_batch_inst_num_ver_uniq;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS zk_batch_active_predecessor_unique ON zk_contribution_batches (predecessor_batch_id) WHERE predecessor_batch_id IS NOT NULL AND status <> 'ABANDONED';`,
  `DROP INDEX IF EXISTS zk_batch_predecessor_uniq;`,
  `ALTER TABLE zk_contribution_batches ADD COLUMN IF NOT EXISTS replaces_draft_id TEXT REFERENCES zk_contribution_batches(id);`,
  `CREATE TABLE IF NOT EXISTS zk_contribution_receipt_proof_history (
    id TEXT PRIMARY KEY,
    contribution_id TEXT NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
    batch_id TEXT NOT NULL REFERENCES zk_contribution_batches(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    batch_version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL,
    public_signals_json TEXT,
    proof_json TEXT,
    tx_hash TEXT,
    block_number INTEGER,
    verified_at BIGINT,
    failure_reason TEXT,
    created_at BIGINT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS zk_proof_hist_contrib ON zk_contribution_receipt_proof_history(contribution_id, version, created_at DESC);`,
];

export interface BatchItemWitness {
  contributionId: string;
  batchNumber: number;
  batchVersion: number;
  version: number;
  institutionId: string;
  batchRoot: string;
  receiptCommitment: string;
  institutionKey: string;
  contributionIdHash: string;
  fundType: number;
  amount: string;
  salt: string;
  purposeHash: string;
  pathElements: string[];
  pathIndices: number[];
}

export interface ContributionBatchDetail {
  id: string;
  institutionId: string;
  batchNumber: number;
  version: number;
  status: "DRAFT" | "ENDORSED" | "SUPERSEDED" | "ABANDONED";
  merkleRoot: string;
  totalAmountExact: string;
  currencyUnit: string;
  fundType: string;
  itemCount: number;
  predecessorBatchId: string | null;
  replacesDraftId: string | null;
  correctionReason: string | null;
  sourceProofRef: string | null;
  endorsedBy: string | null;
  endorsementMandateId: string | null;
  endorsementMandateVersion: number | null;
  endorsedAt: number | null;
  txHash: string | null;
  createdAt: number;
  cutoff: number;
  updatedAt: number;
  items: {
    id: string;
    contributionId: string;
    leafIndex: number;
    leafHash: string;
    receiptCommitment: string;
  }[];
}

export interface ReceiptProofRecord {
  id: string;
  contributionId: string;
  batchId: string;
  version: number;
  status: "PENDING" | "PROVING" | "VERIFIED" | "FAILED" | "SUPERSEDED";
  publicSignals: string[] | null;
  proof: Record<string, unknown> | null;
  txHash: string | null;
  blockNumber: number | null;
  verifiedAt: number | null;
  failureReason: string | null;
  createdAt: number;
  updatedAt: number;
}

export function toField(value: bigint | string | Hex): bigint {
  if (typeof value === "string") {
    if (value.startsWith("0x")) {
      return BigInt(value) % SNARK_SCALAR_FIELD;
    }
    return BigInt(value) % SNARK_SCALAR_FIELD;
  }
  return value % SNARK_SCALAR_FIELD;
}

export function toFieldHex(value: bigint): string {
  return "0x" + value.toString(16).padStart(64, "0");
}

let poseidonInstance: any = null;
export async function getPoseidon() {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
  return poseidonInstance;
}

export interface ZkBatchStore {
  ensureSchema(): Promise<void>;
  batchIsCurrent(institutionId: string, batchId: string): Promise<boolean>;
  claimProof(contributionId: string, batchId: string, version: number, now: number): Promise<boolean>;
  publicReceipt(reference: string): Promise<any | null>;
  createBatch(params: {
    institutionId: string;
    contributionIds: string[];
    fundType: string;
    currencyUnit: string;
    cutoff?: number;
    now: number;
  }): Promise<ContributionBatchDetail>;
  createReplacementBatch(params: {
    institutionId: string;
    predecessorBatchId: string;
    expectedBatchVersion: number;
    reason: string;
    sourceProofRef: string;
    now: number;
  }): Promise<ContributionBatchDetail>;
  endorseBatch(params: {
    institutionId: string;
    batchId: string;
    endorsedBy: string;
    endorsementMandateId?: string;
    txHash?: string;
    now: number;
  }): Promise<ContributionBatchDetail>;
  getBatch(institutionId: string, batchId: string): Promise<ContributionBatchDetail | null>;
  listBatches(institutionId: string): Promise<ContributionBatchDetail[]>;
  getBatchHistory(institutionId: string, batchId: string): Promise<ContributionBatchDetail[]>;
  getBatchItemWitness(
    institutionId: string,
    batchId: string,
    contributionId: string
  ): Promise<BatchItemWitness | null>;
  getReceiptProof(
    contributionId: string,
    version?: number,
    batchId?: string
  ): Promise<ReceiptProofRecord | null>;
  saveReceiptProof(params: {
    id?: string;
    contributionId: string;
    batchId: string;
    version: number;
    status: "PENDING" | "PROVING" | "VERIFIED" | "FAILED" | "SUPERSEDED";
    publicSignals?: string[];
    proof?: Record<string, unknown>;
    txHash?: string;
    blockNumber?: number;
    verifiedAt?: number;
    failureReason?: string;
    now: number;
  }): Promise<ReceiptProofRecord>;
}

function mapContributionBatch(row: any, iRows: any[]): ContributionBatchDetail {
  return {
    id: row.id,
    institutionId: row.institution_id,
    batchNumber: Number(row.batch_number),
    version: Number(row.version),
    status: row.status,
    merkleRoot: row.merkle_root,
    totalAmountExact: row.total_amount_exact,
    currencyUnit: row.currency_unit,
    fundType: row.fund_type,
    itemCount: Number(row.item_count),
    predecessorBatchId: row.predecessor_batch_id ?? null,
    replacesDraftId: row.replaces_draft_id ?? null,
    correctionReason: row.correction_reason ?? null,
    sourceProofRef: row.source_proof_ref ?? null,
    endorsedBy: row.endorsed_by,
    endorsementMandateId: row.endorsement_mandate_id,
    endorsementMandateVersion: row.endorsement_mandate_version == null ? null : Number(row.endorsement_mandate_version),
    endorsedAt: row.endorsed_at ? Number(row.endorsed_at) : null,
    txHash: row.tx_hash,
    createdAt: Number(row.created_at),
    cutoff: Number(row.cutoff ?? row.created_at),
    updatedAt: Number(row.updated_at),
    items: iRows.map((it: any) => ({
      id: it.id,
      contributionId: it.contribution_id,
      leafIndex: Number(it.leaf_index),
      leafHash: it.leaf_hash,
      receiptCommitment: it.receipt_commitment,
    })),
  };
}

export function createZkBatchStore(db: any): ZkBatchStore {
  return {
    async batchIsCurrent(institutionId: string, batchId: string) {
      const batchRes = await db.execute(sql`
        SELECT b.status, b.version, b.id,
          (SELECT COUNT(*) FROM zk_contribution_batches s WHERE s.predecessor_batch_id = b.id) as successor_count
        FROM zk_contribution_batches b
        WHERE b.id = ${batchId} AND b.institution_id = ${institutionId}
      `);
      const bRows = batchRes.rows ?? batchRes;
      if (!bRows.length) return false;
      const b = bRows[0];
      if (b.status === "ABANDONED" || b.status === "SUPERSEDED" || Number(b.successor_count) > 0) return false;

      const result = await db.execute(sql`
        SELECT bi.witness_data_json, c.version, c.status
        FROM zk_contribution_batch_items bi
        JOIN zk_contribution_batches b ON b.id = bi.batch_id
        JOIN contributions c ON c.id = bi.contribution_id
        WHERE b.id = ${batchId} AND b.institution_id = ${institutionId}
      `);
      const rows = result.rows ?? result;
      return rows.length > 0 && rows.every((r: any) => r.status === 'ENDORSED' && Number(r.version) === JSON.parse(r.witness_data_json).version);
    },
    async claimProof(contributionId: string, batchId: string, version: number, now: number) {
      const result = await db.execute(sql`
        INSERT INTO zk_contribution_receipt_proofs (id, contribution_id, batch_id, version, status, created_at, updated_at)
        VALUES (${`proof-${batchId}-${contributionId}-v${version}`}, ${contributionId}, ${batchId}, ${version}, 'PROVING', ${now}, ${now})
        ON CONFLICT (contribution_id, version) DO UPDATE SET status = 'PROVING', updated_at = EXCLUDED.updated_at
        WHERE zk_contribution_receipt_proofs.status IN ('FAILED', 'PENDING') AND zk_contribution_receipt_proofs.batch_id = EXCLUDED.batch_id
        RETURNING id
      `);
      return (result.rows ?? result).length === 1;
    },
    async publicReceipt(reference: string) {
      const result = await db.execute(sql`
        SELECT c.id, c.institution_id, c.version AS current_version, c.status AS contribution_status,
               p.status, p.version, p.tx_hash, p.block_number, p.verified_at, p.batch_id,
               b.batch_number, b.version AS batch_version, b.status AS batch_status,
               b.merkle_root, b.endorsed_by, b.endorsed_at,
               bi.receipt_commitment,
               (SELECT COUNT(*) FROM zk_contribution_batches s WHERE s.predecessor_batch_id = b.id) as successor_count
        FROM contributions c
        LEFT JOIN LATERAL (
          SELECT * FROM zk_contribution_receipt_proofs WHERE contribution_id = c.id
          ORDER BY version DESC, created_at DESC LIMIT 1
        ) p ON true
        LEFT JOIN zk_contribution_batches b ON p.batch_id = b.id
        LEFT JOIN zk_contribution_batch_items bi ON bi.batch_id = b.id AND bi.contribution_id = c.id
        WHERE c.id = ${reference}
      `);
      const rows = result.rows ?? result;
      if (!rows[0]) return null;
      const row = rows[0];

      let batchIsCurrent = false;
      if (row.batch_id && row.batch_status === "ENDORSED" && Number(row.successor_count) === 0) {
        const itemsRes = await db.execute(sql`
          SELECT bi.witness_data_json, c2.version, c2.status
          FROM zk_contribution_batch_items bi
          JOIN contributions c2 ON c2.id = bi.contribution_id
          WHERE bi.batch_id = ${row.batch_id}
        `);
        const iRows = itemsRes.rows ?? itemsRes;
        batchIsCurrent = iRows.length > 0 && iRows.every((r: any) => r.status === 'ENDORSED' && Number(r.version) === JSON.parse(r.witness_data_json).version);
      }

      const histRes = await db.execute(sql`
        SELECT * FROM zk_contribution_receipt_proof_history
        WHERE contribution_id = ${reference}
        ORDER BY created_at DESC
      `);
      const history = (histRes.rows ?? histRes).map((h: any) => ({
        version: Number(h.version),
        batchId: h.batch_id,
        batchVersion: Number(h.batch_version),
        status: h.status,
        txHash: h.tx_hash,
        blockNumber: h.block_number ? Number(h.block_number) : null,
        verifiedAt: h.verified_at ? Number(h.verified_at) : null,
      }));

      return {
        ...row,
        batchIsCurrent,
        batch_is_current: batchIsCurrent,
        history,
      };
    },
    async ensureSchema(): Promise<void> {
      await db.transaction(async (tx: any) => {
        for (const statement of ZK_BATCH_SCHEMA_STATEMENTS) await tx.execute(sql.raw(statement));
        await archiveReceiptProofs(tx);
      });
    },

    async createBatch({
      institutionId,
      contributionIds,
      fundType,
      currencyUnit,
      cutoff,
      now,
    }: {
      institutionId: string;
      contributionIds: string[];
      fundType: string;
      currencyUnit: string;
      cutoff?: number;
      now: number;
    }): Promise<ContributionBatchDetail> {
      return db.transaction(async (db: any) => {
      await db.execute(sql`SELECT id FROM institutions WHERE id = ${institutionId} FOR UPDATE`);
      if (new Set(contributionIds).size !== contributionIds.length) throw new Error("ID kontribusi ganda.");
      if (contributionIds.length === 0) {
        throw new Error("Batch minimal harus memuat satu kontribusi yang sah.");
      }
      if (contributionIds.length > MAX_BATCH_LEAVES) {
        throw new Error(
          `Jumlah kontribusi melebihi kapasitas batch tracer (maksimal ${MAX_BATCH_LEAVES}).`
        );
      }

      // Fetch contributions and verify they belong to this institution and are ENDORSED
      const contributionsRes = await db.execute(sql`
        SELECT id, institution_id, amount_exact, currency_unit, fund_type, purpose, status, version, received_at
        FROM contributions
        WHERE id IN (${sql.join(contributionIds.map(id => sql`${id}`), sql`, `)})
          AND institution_id = ${institutionId}
        FOR UPDATE
      `);

      const rows = contributionsRes.rows ?? contributionsRes;
      if (rows.length !== contributionIds.length) {
        throw new Error("Ada kontribusi yang tidak ditemukan atau tidak milik lembaga ini.");
      }

      // Enforce AC08: Only ENDORSED contributions can enter an authorized batch
      if (!Number.isSafeInteger(cutoff ?? now) || (cutoff ?? now) > now) throw new Error("Cutoff tidak sah.");
      for (const row of rows) {
        if (Number(row.received_at) > (cutoff ?? now)) throw new Error("Kontribusi melewati cutoff.");
        if (row.status !== "ENDORSED") {
          throw new Error(
            `Kontribusi ${row.id} berstatus "${row.status}"; hanya kontribusi yang disahkan (ENDORSED) yang boleh masuk batch.`
          );
        }
        if (row.fund_type !== fundType) {
          throw new Error(`Semua kontribusi dalam batch harus memiliki jenis dana yang sama (${fundType}).`);
        }
        if (row.currency_unit !== currencyUnit) {
          throw new Error(`Semua kontribusi dalam batch harus memiliki satuan mata uang yang sama (${currencyUnit}).`);
        }
      }

      // Map rows in input order
      const rowMap = new Map<string, any>(rows.map((r: any) => [r.id, r]));
      const orderedRows = contributionIds.map(id => rowMap.get(id)!);

      // Determine next batch number for institution
      const lastBatchRes = await db.execute(sql`
        SELECT MAX(batch_number) as max_num FROM zk_contribution_batches
        WHERE institution_id = ${institutionId}
      `);
      const maxRows = lastBatchRes.rows ?? lastBatchRes;
      const nextBatchNumber = (maxRows[0]?.max_num != null ? Number(maxRows[0].max_num) : 0) + 1;

      const batchId = `zk-batch-${institutionId}-${nextBatchNumber}`;

      const snapshot = await buildBatchSnapshot(institutionId, nextBatchNumber, 1, fundType, orderedRows);
      const { leaves, batchRootHex, totalAmountExact } = snapshot;

      // Insert batch record
      await db.execute(sql`
        INSERT INTO zk_contribution_batches (
          id, institution_id, batch_number, version, status, merkle_root,
          total_amount_exact, currency_unit, fund_type, item_count,
          leaves_json, cutoff, created_at, updated_at
        ) VALUES (
          ${batchId}, ${institutionId}, ${nextBatchNumber}, 1, 'DRAFT', ${batchRootHex},
          ${totalAmountExact.toString()}, ${currencyUnit}, ${fundType}, ${orderedRows.length},
          ${JSON.stringify(leaves.map(l => toFieldHex(l)))}, ${cutoff ?? now}, ${now}, ${now}
        )
      `);

      const itemsList = await insertSnapshotItems(db, batchId, snapshot, now);

      return {
        id: batchId,
        institutionId,
        batchNumber: nextBatchNumber,
        version: 1,
        status: "DRAFT",
        merkleRoot: batchRootHex,
        totalAmountExact: totalAmountExact.toString(),
        currencyUnit,
        fundType,
        itemCount: orderedRows.length,
        predecessorBatchId: null,
        replacesDraftId: null,
        correctionReason: null,
        sourceProofRef: null,
        endorsedBy: null,
        endorsementMandateId: null,
        endorsementMandateVersion: null,
        endorsedAt: null,
        txHash: null,
        createdAt: now,
        cutoff: cutoff ?? now,
        updatedAt: now,
        items: itemsList,
      };
      });
    },

    async createReplacementBatch({
      institutionId,
      predecessorBatchId,
      expectedBatchVersion,
      reason,
      sourceProofRef,
      now,
    }: {
      institutionId: string;
      predecessorBatchId: string;
      expectedBatchVersion: number;
      reason: string;
      sourceProofRef: string;
      now: number;
    }): Promise<ContributionBatchDetail> {
      return db.transaction(async (tx: any) => {
        await tx.execute(sql`SELECT id FROM institutions WHERE id = ${institutionId} FOR UPDATE`);
        if (!reason?.trim()) throw new Error("Alasan koreksi batch wajib disertakan.");
        if (!sourceProofRef?.trim()) throw new Error("Referensi bukti sumber koreksi batch wajib disertakan.");

        const predRes = await tx.execute(sql`
          SELECT * FROM zk_contribution_batches
          WHERE id = ${predecessorBatchId} AND institution_id = ${institutionId}
          FOR UPDATE
        `);
        const predRows = predRes.rows ?? predRes;
        if (predRows.length === 0) throw new Error("Batch pendahulu tidak ditemukan.");
        const pred = predRows[0];
        if (Number(pred.version) !== expectedBatchVersion) {
          throw new Error("Versi batch pendahulu tidak cocok (stale version).");
        }
        const refreshingDraft = pred.status === "DRAFT";
        if (!refreshingDraft && pred.status !== "ENDORSED") {
          throw new Error("Batch telah memiliki batch koreksi atau sudah ditinggalkan; koreksi bersaing tidak diperbolehkan.");
        }
        if (refreshingDraft) {
          // Serialize with worker checkpoint writes. Signed bytes may already be broadcast;
          // never replace their target, even after an ambiguous RPC response.
          const operations = await tx.execute(sql`SELECT id, raw_transaction, tx_hash FROM zk_publications
            WHERE batch_id = ${pred.id} FOR UPDATE`);
          if ((operations.rows ?? operations).some((op: any) => op.raw_transaction || op.tx_hash)) {
            throw new Error("Transaksi draf telah ditandatangani; rekonsiliasi hasil chain sebelum koreksi.");
          }
        }
        const officialPredecessor = refreshingDraft ? pred.predecessor_batch_id : pred.id;

        const existingSuccessorRes = await tx.execute(sql`
          SELECT id FROM zk_contribution_batches
          WHERE predecessor_batch_id = ${predecessorBatchId} AND status <> 'ABANDONED'
          FOR UPDATE
        `);
        const existingSuccessorRows = existingSuccessorRes.rows ?? existingSuccessorRes;
        if (existingSuccessorRows.length > 0) {
          throw new Error("Batch pengganti sudah ada untuk pendahulu ini. Dua koreksi bersaing tidak diperbolehkan.");
        }

        const predItemsRes = await tx.execute(sql`
          SELECT * FROM zk_contribution_batch_items
          WHERE batch_id = ${predecessorBatchId}
          ORDER BY leaf_index ASC
        `);
        const predItems = predItemsRes.rows ?? predItemsRes;
        const contribIds = predItems.map((it: any) => it.contribution_id);

        const contribsRes = await tx.execute(sql`
          SELECT id, institution_id, amount_exact, currency_unit, fund_type, purpose, status, version, received_at
          FROM contributions
          WHERE id IN (${sql.join(contribIds.map((id: string) => sql`${id}`), sql`, `)})
            AND institution_id = ${institutionId}
          FOR UPDATE
        `);
        const contribRows = contribsRes.rows ?? contribsRes;
        const contribMap = new Map<string, any>(contribRows.map((r: any) => [r.id, r]));

        const newBatchVersion = Number(pred.version) + (refreshingDraft ? 0 : 1);
        const nextBatchNumber = Number(pred.batch_number);
        const batchId = `zk-batch-${institutionId}-${nextBatchNumber}-v${newBatchVersion}-${randomUUID()}`;

        const orderedRows = predItems.map((it: any) => {
          const row = contribMap.get(it.contribution_id);
          if (!row) throw new Error(`Kontribusi ${it.contribution_id} tidak ditemukan.`);
          return row;
        }).filter((row: any) => row.status !== "REJECTED");
        const snapshot = await buildBatchSnapshot(institutionId, nextBatchNumber, newBatchVersion, pred.fund_type, orderedRows);
        const { leaves, batchRootHex, totalAmountExact } = snapshot;

        await tx.execute(sql`
          UPDATE zk_contribution_batches
          SET status = ${refreshingDraft ? 'ABANDONED' : 'SUPERSEDED'}, updated_at = ${now}
          WHERE id = ${predecessorBatchId}
        `);

        if (refreshingDraft) {
          await tx.execute(sql`UPDATE zk_publications SET status = 'BLOCKED', error = 'Draf digantikan; pengesahan baru diperlukan.', updated_at = ${now}
            WHERE batch_id = ${pred.id}`);
        }
        await tx.execute(sql`
          INSERT INTO zk_contribution_batches (
            id, institution_id, batch_number, version, status, merkle_root,
            total_amount_exact, currency_unit, fund_type, item_count,
            leaves_json, cutoff, predecessor_batch_id, correction_reason, source_proof_ref, replaces_draft_id,
            created_at, updated_at
          ) VALUES (
            ${batchId}, ${institutionId}, ${nextBatchNumber}, ${newBatchVersion}, 'DRAFT', ${batchRootHex},
            ${totalAmountExact.toString()}, ${pred.currency_unit}, ${pred.fund_type}, ${snapshot.items.length},
            ${JSON.stringify(leaves.map(l => toFieldHex(l)))}, ${pred.cutoff ?? now},
            ${officialPredecessor}, ${reason}, ${sourceProofRef}, ${refreshingDraft ? pred.id : null}, ${now}, ${now}
          )
        `);

        const itemsList = await insertSnapshotItems(tx, batchId, snapshot, now);

        return {
          id: batchId,
          institutionId,
          batchNumber: nextBatchNumber,
          version: newBatchVersion,
          status: "DRAFT",
          merkleRoot: batchRootHex,
          totalAmountExact: totalAmountExact.toString(),
          currencyUnit: pred.currency_unit,
          fundType: pred.fund_type,
          itemCount: snapshot.items.length,
          predecessorBatchId: officialPredecessor,
          replacesDraftId: refreshingDraft ? pred.id : null,
          correctionReason: reason,
          sourceProofRef,
          endorsedBy: null,
          endorsementMandateId: null,
          endorsementMandateVersion: null,
          endorsedAt: null,
          txHash: null,
          createdAt: now,
          cutoff: Number(pred.cutoff ?? now),
          updatedAt: now,
          items: itemsList,
        };
      });
    },

    async endorseBatch({
      institutionId,
      batchId,
      endorsedBy,
      endorsementMandateId,
      txHash,
      now,
    }: {
      institutionId: string;
      batchId: string;
      endorsedBy: string;
      endorsementMandateId?: string;
      txHash?: string;
      now: number;
    }): Promise<ContributionBatchDetail> {
      const batch = await this.getBatch(institutionId, batchId);
      if (!batch) {
        throw new Error("Batch tidak ditemukan.");
      }
      if (batch.status === "ENDORSED") {
        return batch; // Idempotent
      }

      await db.execute(sql`
        UPDATE zk_contribution_batches
        SET status = 'ENDORSED',
            endorsed_by = ${endorsedBy},
            endorsement_mandate_id = ${endorsementMandateId ?? null},
            tx_hash = ${txHash ?? null},
            endorsed_at = ${now},
            updated_at = ${now}
        WHERE id = ${batchId} AND institution_id = ${institutionId}
      `);

      return (await this.getBatch(institutionId, batchId))!;
    },

    async getBatch(institutionId: string, batchId: string): Promise<ContributionBatchDetail | null> {
      const batchRes = await db.execute(sql`
        SELECT * FROM zk_contribution_batches
        WHERE id = ${batchId} AND institution_id = ${institutionId}
      `);
      const bRows = batchRes.rows ?? batchRes;
      if (bRows.length === 0) return null;
      const row = bRows[0];

      const itemsRes = await db.execute(sql`
        SELECT id, contribution_id, leaf_index, leaf_hash, receipt_commitment
        FROM zk_contribution_batch_items
        WHERE batch_id = ${batchId}
        ORDER BY leaf_index ASC
      `);
      const iRows = itemsRes.rows ?? itemsRes;

      return mapContributionBatch(row, iRows);
    },

    async listBatches(institutionId: string): Promise<ContributionBatchDetail[]> {
      const batchRes = await db.execute(sql`
        SELECT * FROM zk_contribution_batches
        WHERE institution_id = ${institutionId}
        ORDER BY batch_number DESC, version DESC
      `);
      const bRows = batchRes.rows ?? batchRes;

      const result: ContributionBatchDetail[] = [];
      for (const row of bRows) {
        const itemsRes = await db.execute(sql`
          SELECT id, contribution_id, leaf_index, leaf_hash, receipt_commitment
          FROM zk_contribution_batch_items
          WHERE batch_id = ${row.id}
          ORDER BY leaf_index ASC
        `);
        const iRows = itemsRes.rows ?? itemsRes;

        result.push(mapContributionBatch(row, iRows));
      }
      return result;
    },

    async getBatchHistory(institutionId: string, batchId: string): Promise<ContributionBatchDetail[]> {
      const targetRes = await db.execute(sql`
        SELECT batch_number FROM zk_contribution_batches
        WHERE id = ${batchId} AND institution_id = ${institutionId}
      `);
      const targetRows = targetRes.rows ?? targetRes;
      if (targetRows.length === 0) return [];
      const batchNumber = Number(targetRows[0].batch_number);

      const batchRes = await db.execute(sql`
        SELECT * FROM zk_contribution_batches
        WHERE institution_id = ${institutionId} AND batch_number = ${batchNumber}
        ORDER BY version ASC, created_at ASC, CASE WHEN status = 'ABANDONED' THEN 0 ELSE 1 END
      `);
      const bRows = batchRes.rows ?? batchRes;

      const result: ContributionBatchDetail[] = [];
      for (const row of bRows) {
        const itemsRes = await db.execute(sql`
          SELECT id, contribution_id, leaf_index, leaf_hash, receipt_commitment
          FROM zk_contribution_batch_items
          WHERE batch_id = ${row.id}
          ORDER BY leaf_index ASC
        `);
        const iRows = itemsRes.rows ?? itemsRes;

        result.push(mapContributionBatch(row, iRows));
      }
      return result;
    },

    async getBatchItemWitness(
      institutionId: string,
      batchId: string,
      contributionId: string
    ): Promise<BatchItemWitness | null> {
      // Confirmed access: only authorized processors can load witness data
      const res = await db.execute(sql`
        SELECT bi.witness_data_json
        FROM zk_contribution_batch_items bi
        JOIN zk_contribution_batches b ON bi.batch_id = b.id
        WHERE bi.batch_id = ${batchId}
          AND bi.contribution_id = ${contributionId}
          AND b.institution_id = ${institutionId}
      `);
      const rows = res.rows ?? res;
      if (rows.length === 0) return null;
      return JSON.parse(rows[0].witness_data_json) as BatchItemWitness;
    },

    async getReceiptProof(
      contributionId: string,
      version?: number,
      batchId?: string
    ): Promise<ReceiptProofRecord | null> {
      const res = await db.execute(
        batchId !== undefined
          ? sql`SELECT * FROM (
              SELECT id, contribution_id, batch_id, version, status, public_signals_json, proof_json,
                tx_hash, block_number, verified_at, failure_reason, created_at, updated_at
              FROM zk_contribution_receipt_proofs
              UNION ALL
              SELECT id, contribution_id, batch_id, version, status, public_signals_json, proof_json,
                tx_hash, block_number, verified_at, failure_reason, created_at, created_at AS updated_at
              FROM zk_contribution_receipt_proof_history
            ) records WHERE contribution_id = ${contributionId} AND batch_id = ${batchId}
              AND (${version ?? null}::integer IS NULL OR version = ${version ?? null})
            ORDER BY version DESC, updated_at DESC LIMIT 1`
          : version !== undefined
          ? sql`
              SELECT * FROM zk_contribution_receipt_proofs
              WHERE contribution_id = ${contributionId} AND version = ${version}
              ORDER BY created_at DESC
              LIMIT 1
            `
          : sql`
              SELECT * FROM zk_contribution_receipt_proofs
              WHERE contribution_id = ${contributionId}
              ORDER BY version DESC, created_at DESC
              LIMIT 1
            `
      );
      const rows = res.rows ?? res;
      if (rows.length === 0) return null;
      const row = rows[0];

      return {
        id: row.id,
        contributionId: row.contribution_id,
        batchId: row.batch_id,
        version: Number(row.version),
        status: row.status,
        publicSignals: row.public_signals_json ? JSON.parse(row.public_signals_json) : null,
        proof: row.proof_json ? JSON.parse(row.proof_json) : null,
        txHash: row.tx_hash,
        blockNumber: row.block_number ? Number(row.block_number) : null,
        verifiedAt: row.verified_at ? Number(row.verified_at) : null,
        failureReason: row.failure_reason,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      };
    },

    async saveReceiptProof({
      id,
      contributionId,
      batchId,
      version,
      status,
      publicSignals,
      proof,
      txHash,
      blockNumber,
      verifiedAt,
      failureReason,
      now,
    }: {
      id?: string;
      contributionId: string;
      batchId: string;
      version: number;
      status: "PENDING" | "PROVING" | "VERIFIED" | "FAILED" | "SUPERSEDED";
      publicSignals?: string[];
      proof?: Record<string, unknown>;
      txHash?: string;
      blockNumber?: number;
      verifiedAt?: number;
      failureReason?: string;
      now: number;
    }): Promise<ReceiptProofRecord> {
      const proofId = id ?? `proof-${batchId}-${contributionId}-v${version}`;
      const pubSigJson = publicSignals ? JSON.stringify(publicSignals) : null;
      const proofJson = proof ? JSON.stringify(proof) : null;

      await db.transaction(async (db: any) => {
        await db.execute(sql`SELECT id FROM contributions WHERE id = ${contributionId} FOR UPDATE`);
        await archiveReceiptProofs(db, contributionId);
        await db.execute(sql`
          INSERT INTO zk_contribution_receipt_proofs (
            id, contribution_id, batch_id, version, status,
            public_signals_json, proof_json, tx_hash, block_number, verified_at, failure_reason,
            created_at, updated_at
          ) VALUES (
            ${proofId}, ${contributionId}, ${batchId}, ${version}, ${status},
            ${pubSigJson}, ${proofJson}, ${txHash ?? null}, ${blockNumber ?? null},
            ${verifiedAt ?? null}, ${failureReason ?? null}, ${now}, ${now}
          )
          ON CONFLICT (contribution_id, version) DO UPDATE SET
            batch_id = EXCLUDED.batch_id,
            status = EXCLUDED.status,
            public_signals_json = CASE WHEN zk_contribution_receipt_proofs.batch_id = EXCLUDED.batch_id THEN COALESCE(EXCLUDED.public_signals_json, zk_contribution_receipt_proofs.public_signals_json) ELSE EXCLUDED.public_signals_json END,
            proof_json = CASE WHEN zk_contribution_receipt_proofs.batch_id = EXCLUDED.batch_id THEN COALESCE(EXCLUDED.proof_json, zk_contribution_receipt_proofs.proof_json) ELSE EXCLUDED.proof_json END,
            tx_hash = CASE WHEN zk_contribution_receipt_proofs.batch_id = EXCLUDED.batch_id THEN COALESCE(EXCLUDED.tx_hash, zk_contribution_receipt_proofs.tx_hash) ELSE EXCLUDED.tx_hash END,
            block_number = CASE WHEN zk_contribution_receipt_proofs.batch_id = EXCLUDED.batch_id THEN COALESCE(EXCLUDED.block_number, zk_contribution_receipt_proofs.block_number) ELSE EXCLUDED.block_number END,
            verified_at = CASE WHEN zk_contribution_receipt_proofs.batch_id = EXCLUDED.batch_id THEN COALESCE(EXCLUDED.verified_at, zk_contribution_receipt_proofs.verified_at) ELSE EXCLUDED.verified_at END,
            failure_reason = EXCLUDED.failure_reason,
            updated_at = EXCLUDED.updated_at
          WHERE (zk_contribution_receipt_proofs.status <> 'VERIFIED' OR EXCLUDED.status = 'VERIFIED' OR zk_contribution_receipt_proofs.batch_id <> EXCLUDED.batch_id)
        `);

        await db.execute(sql`
          INSERT INTO zk_contribution_receipt_proof_history (
            id, contribution_id, batch_id, version, batch_version, status,
            public_signals_json, proof_json, tx_hash, block_number, verified_at, failure_reason,
            created_at
          ) VALUES (
            ${`hist-${proofId}-${now}`}, ${contributionId}, ${batchId}, ${version},
            COALESCE((SELECT version FROM zk_contribution_batches WHERE id = ${batchId}), 1),
            ${status}, ${pubSigJson}, ${proofJson}, ${txHash ?? null}, ${blockNumber ?? null},
            ${verifiedAt ?? null}, ${failureReason ?? null}, ${now}
          )
          ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            public_signals_json = COALESCE(EXCLUDED.public_signals_json, zk_contribution_receipt_proof_history.public_signals_json),
            proof_json = COALESCE(EXCLUDED.proof_json, zk_contribution_receipt_proof_history.proof_json),
            tx_hash = COALESCE(EXCLUDED.tx_hash, zk_contribution_receipt_proof_history.tx_hash),
            block_number = COALESCE(EXCLUDED.block_number, zk_contribution_receipt_proof_history.block_number),
            verified_at = COALESCE(EXCLUDED.verified_at, zk_contribution_receipt_proof_history.verified_at),
            failure_reason = EXCLUDED.failure_reason
        `);

      });
      return (await this.getReceiptProof(contributionId, version))!;
    },
  };
}

function getFundTypeIndex(fundType: string): number {
  switch (fundType) {
    case "ZAKAT":
      return 0;
    case "FITRAH":
      return 1;
    case "INFAK_SEDEKAH":
      return 2;
    case "KURBAN":
      return 3;
    case "DSKL":
      return 4;
    default:
      throw new Error("Jenis dana tidak didukung.");
  }
}

// Domain-separated public context binds this receipt to one batch and both versions.
export function contributionContext(id: string, batch: number, batchVersion: number, receiptVersion: number): bigint {
  return toField(keccak256(encodeAbiParameters(
    [{type: "string"}, {type: "string"}, {type: "uint256"}, {type: "uint256"}, {type: "uint256"}],
    ["ZKT_CONTRIBUTION_MEMBERSHIP_V1", id, BigInt(batch), BigInt(batchVersion), BigInt(receiptVersion)],
  )));
}

/** Leaves and paths always use the same ordered population, including after exclusions. */
async function buildBatchSnapshot(institutionId: string, batchNumber: number, batchVersion: number,
  fundType: string, rows: { id: string; version: number; status: string; amount_exact: string; purpose: string }[]) {
  if (rows.length > MAX_BATCH_LEAVES) throw new Error("Kapasitas batch terlampaui.");
  const poseidon = await getPoseidon();
  const hash = (values: bigint[]) => BigInt(poseidon.F.toString(poseidon(values)));
  const institutionKey = toField(keccak256(Buffer.from(institutionId)));
  const fundTypeIndex = getFundTypeIndex(fundType);
  let totalAmountExact = 0n;
  const members = rows.map(row => {
    if (row.status !== "ENDORSED") throw new Error("Kontribusi belum disahkan.");
    const amount = BigInt(row.amount_exact);
    if (amount <= 0n || amount >= SNARK_SCALAR_FIELD) throw new Error("Nominal di luar batas circuit.");
    totalAmountExact += amount;
    const salt = toField("0x" + randomBytes(32).toString("hex"));
    const context = contributionContext(row.id, batchNumber, batchVersion, Number(row.version));
    const purposeHash = toField(keccak256(Buffer.from(row.purpose || "")));
    const leaf = hash([context, amount, salt, BigInt(fundTypeIndex), purposeHash]);
    return { row, amount, salt, context, purposeHash, leaf, commitment: hash([institutionKey, context, leaf]) };
  });
  const leaves = members.map(m => m.leaf);
  while (leaves.length < MAX_BATCH_LEAVES) leaves.push(0n);
  const layers = [leaves];
  for (let level = 0; level < TREE_DEPTH; level++) {
    const layer = layers[level];
    const parents: bigint[] = [];
    for (let i = 0; i < layer.length; i += 2) parents.push(hash([layer[i], layer[i + 1]]));
    layers.push(parents);
  }
  const root = layers[TREE_DEPTH][0];
  const items = members.map((member, leafIndex) => {
    const pathElements: string[] = [];
    const pathIndices: number[] = [];
    let index = leafIndex;
    for (let level = 0; level < TREE_DEPTH; level++) {
      pathElements.push(layers[level][index ^ 1].toString());
      pathIndices.push(index % 2);
      index = Math.floor(index / 2);
    }
    const witness: BatchItemWitness = {
      contributionId: member.row.id, version: Number(member.row.version), institutionId, batchNumber, batchVersion,
      batchRoot: root.toString(), receiptCommitment: member.commitment.toString(), institutionKey: institutionKey.toString(),
      contributionIdHash: member.context.toString(), fundType: fundTypeIndex, amount: member.amount.toString(),
      salt: member.salt.toString(), purposeHash: member.purposeHash.toString(), pathElements, pathIndices,
    };
    return { contributionId: member.row.id, leafIndex, leafHash: toFieldHex(member.leaf),
      receiptCommitment: toFieldHex(member.commitment), witness };
  });
  return { leaves, batchRootHex: toFieldHex(root), totalAmountExact, items };
}

async function insertSnapshotItems(db: any, batchId: string, snapshot: Awaited<ReturnType<typeof buildBatchSnapshot>>, now: number) {
  const items: ContributionBatchDetail["items"] = [];
  for (const { witness, ...item } of snapshot.items) {
    const id = `${batchId}-item-${item.leafIndex}`;
    await db.execute(sql`INSERT INTO zk_contribution_batch_items
      (id, batch_id, contribution_id, leaf_index, leaf_hash, receipt_commitment, witness_data_json, created_at)
      VALUES (${id}, ${batchId}, ${item.contributionId}, ${item.leafIndex}, ${item.leafHash},
        ${item.receiptCommitment}, ${JSON.stringify(witness)}, ${now})`);
    items.push({ id, ...item });
  }
  return items;
}

/** Backfill legacy receipts and archive the old row before replacement in the same transaction. */
async function archiveReceiptProofs(db: any, contributionId?: string) {
  await db.execute(sql`INSERT INTO zk_contribution_receipt_proof_history
    (id, contribution_id, batch_id, version, batch_version, status, public_signals_json,
      proof_json, tx_hash, block_number, verified_at, failure_reason, created_at)
    SELECT 'archive-' || p.id || '-' || p.batch_id || '-' || p.status || '-' || COALESCE(p.tx_hash, ''),
      p.contribution_id, p.batch_id, p.version, b.version, p.status, p.public_signals_json,
      p.proof_json, p.tx_hash, p.block_number, p.verified_at, p.failure_reason, p.updated_at
    FROM zk_contribution_receipt_proofs p JOIN zk_contribution_batches b ON b.id = p.batch_id
    WHERE (${contributionId ?? null}::text IS NULL OR p.contribution_id = ${contributionId ?? null})
      AND NOT EXISTS (SELECT 1 FROM zk_contribution_receipt_proof_history h
        WHERE h.contribution_id = p.contribution_id AND h.batch_id = p.batch_id AND h.version = p.version
          AND h.status = p.status AND h.tx_hash IS NOT DISTINCT FROM p.tx_hash)
    ON CONFLICT (id) DO NOTHING`);
}

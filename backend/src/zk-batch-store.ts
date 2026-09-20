/**
 * ZK Contribution Batch Store (Spec #100, Issue #108)
 *
 * Manages small snapshot batches of institution-endorsed contributions (#102),
 * computes Poseidon Merkle roots, isolates private witnesses, and tracks
 * persistent receipt proof verifications.
 */

import { sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
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
  `CREATE UNIQUE INDEX IF NOT EXISTS zk_proof_receipt_version_unique ON zk_contribution_receipt_proofs (contribution_id, version);`,
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
  status: "DRAFT" | "ENDORSED" | "SUPERSEDED";
  merkleRoot: string;
  totalAmountExact: string;
  currencyUnit: string;
  fundType: string;
  itemCount: number;
  endorsedBy: string | null;
  endorsementMandateId: string | null;
  endorsedAt: number | null;
  txHash: string | null;
  createdAt: number;
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
  getBatchItemWitness(
    institutionId: string,
    batchId: string,
    contributionId: string
  ): Promise<BatchItemWitness | null>;
  getReceiptProof(
    contributionId: string,
    version?: number
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
    endorsedBy: row.endorsed_by,
    endorsementMandateId: row.endorsement_mandate_id,
    endorsedAt: row.endorsed_at ? Number(row.endorsed_at) : null,
    txHash: row.tx_hash,
    createdAt: Number(row.created_at),
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
        SELECT c.id, c.institution_id, c.version AS current_version,
               p.status, p.version, p.tx_hash, p.block_number, p.verified_at,
               b.batch_number, b.merkle_root, b.endorsed_by, b.endorsed_at,
               bi.receipt_commitment
        FROM contributions c
        LEFT JOIN LATERAL (
          SELECT * FROM zk_contribution_receipt_proofs WHERE contribution_id = c.id
          ORDER BY version DESC, created_at DESC LIMIT 1
        ) p ON true
        LEFT JOIN zk_contribution_batches b ON p.batch_id = b.id
        LEFT JOIN zk_contribution_batch_items bi ON bi.batch_id = b.id AND bi.contribution_id = c.id
        WHERE c.id = ${reference}
      `);
      return (result.rows ?? result)[0] ?? null;
    },
    async ensureSchema(): Promise<void> {
      for (const statement of ZK_BATCH_SCHEMA_STATEMENTS) {
        await db.execute(sql.raw(statement));
      }
    },

    async createBatch({
      institutionId,
      contributionIds,
      fundType,
      currencyUnit,
      now,
    }: {
      institutionId: string;
      contributionIds: string[];
      fundType: string;
      currencyUnit: string;
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
        SELECT id, institution_id, amount_exact, currency_unit, fund_type, purpose, status, version
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
      for (const row of rows) {
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

      const poseidon = await getPoseidon();
      const F = poseidon.F;

      const instKey = toField(keccak256(Buffer.from(institutionId)));
      const fundTypeIndex = getFundTypeIndex(fundType);

      // Determine next batch number for institution
      const lastBatchRes = await db.execute(sql`
        SELECT MAX(batch_number) as max_num FROM zk_contribution_batches
        WHERE institution_id = ${institutionId}
      `);
      const maxRows = lastBatchRes.rows ?? lastBatchRes;
      const nextBatchNumber = (maxRows[0]?.max_num != null ? Number(maxRows[0].max_num) : 0) + 1;

      const batchId = `zk-batch-${institutionId}-${nextBatchNumber}`;

      // Compute leaves
      const leaves: bigint[] = [];
      const itemWitnesses: {
        contributionId: string;
        version: number;
        amount: string;
        salt: string;
        purposeHash: string;
        leafHash: bigint;
        receiptCommitment: bigint;
      }[] = [];

      let totalAmountExact = 0n;

      for (let i = 0; i < orderedRows.length; i++) {
        const row = orderedRows[i];
        const amountExact = BigInt(row.amount_exact);
        if (amountExact <= 0n || amountExact >= SNARK_SCALAR_FIELD) throw new Error("Nominal di luar batas circuit.");
        totalAmountExact += amountExact;

        // Random secret salt prevents dictionary attacks against public commitments.
        const salt = toField("0x" + randomBytes(32).toString("hex"));
        const contribIdHash = contributionContext(row.id, nextBatchNumber, 1, Number(row.version));
        const purposeHash = toField(keccak256(Buffer.from(row.purpose || "")));

        // leaf = Poseidon([contribIdHash, amount, salt, fundType, purposeHash])
        const leafHash = BigInt(
          F.toString(poseidon([contribIdHash, amountExact, salt, BigInt(fundTypeIndex), purposeHash]))
        );
        // receiptCommitment = Poseidon([instKey, contribIdHash, leafHash])
        const receiptCommitment = BigInt(
          F.toString(poseidon([instKey, contribIdHash, leafHash]))
        );

        leaves.push(leafHash);
        itemWitnesses.push({
          contributionId: row.id,
          version: Number(row.version),
          amount: amountExact.toString(),
          salt: salt.toString(),
          purposeHash: purposeHash.toString(),
          leafHash,
          receiptCommitment,
        });
      }

      // Pad remaining leaves up to 16 with zero leaf
      while (leaves.length < MAX_BATCH_LEAVES) {
        leaves.push(0n);
      }

      // Build Merkle Tree layers
      const layers: bigint[][] = [leaves];
      let currentLayer = leaves;

      for (let level = 0; level < TREE_DEPTH; level++) {
        const nextLayer: bigint[] = [];
        for (let i = 0; i < currentLayer.length; i += 2) {
          const left = currentLayer[i];
          const right = currentLayer[i + 1];
          const parent = BigInt(F.toString(poseidon([left, right])));
          nextLayer.push(parent);
        }
        layers.push(nextLayer);
        currentLayer = nextLayer;
      }

      const batchRoot = currentLayer[0];
      const batchRootHex = toFieldHex(batchRoot);

      // Insert batch record
      await db.execute(sql`
        INSERT INTO zk_contribution_batches (
          id, institution_id, batch_number, version, status, merkle_root,
          total_amount_exact, currency_unit, fund_type, item_count,
          leaves_json, created_at, updated_at
        ) VALUES (
          ${batchId}, ${institutionId}, ${nextBatchNumber}, 1, 'DRAFT', ${batchRootHex},
          ${totalAmountExact.toString()}, ${currencyUnit}, ${fundType}, ${orderedRows.length},
          ${JSON.stringify(leaves.map(l => toFieldHex(l)))}, ${now}, ${now}
        )
      `);

      // Insert batch items with witness data
      const itemsList: ContributionBatchDetail["items"] = [];

      for (let idx = 0; idx < itemWitnesses.length; idx++) {
        const item = itemWitnesses[idx];
        const itemId = `${batchId}-item-${idx}`;

        // Compute Merkle path for this index
        const pathElements: string[] = [];
        const pathIndices: number[] = [];

        let currentIdx = idx;
        for (let level = 0; level < TREE_DEPTH; level++) {
          const isRight = currentIdx % 2 === 1;
          const siblingIdx = isRight ? currentIdx - 1 : currentIdx + 1;
          const sibling = layers[level][siblingIdx];
          pathElements.push(sibling.toString());
          pathIndices.push(isRight ? 1 : 0);
          currentIdx = Math.floor(currentIdx / 2);
        }

        const witnessObj: BatchItemWitness = {
          contributionId: item.contributionId,
          batchNumber: nextBatchNumber,
          batchVersion: 1,
          version: item.version,
          institutionId,
          batchRoot: batchRoot.toString(),
          receiptCommitment: item.receiptCommitment.toString(),
          institutionKey: instKey.toString(),
          contributionIdHash: contributionContext(item.contributionId, nextBatchNumber, 1, item.version).toString(),
          fundType: fundTypeIndex,
          amount: item.amount,
          salt: item.salt,
          purposeHash: item.purposeHash,
          pathElements,
          pathIndices,
        };

        const leafHex = toFieldHex(item.leafHash);
        const commitmentHex = toFieldHex(item.receiptCommitment);

        await db.execute(sql`
          INSERT INTO zk_contribution_batch_items (
            id, batch_id, contribution_id, leaf_index, leaf_hash, receipt_commitment, witness_data_json, created_at
          ) VALUES (
            ${itemId}, ${batchId}, ${item.contributionId}, ${idx}, ${leafHex}, ${commitmentHex},
            ${JSON.stringify(witnessObj)}, ${now}
          )
        `);

        itemsList.push({
          id: itemId,
          contributionId: item.contributionId,
          leafIndex: idx,
          leafHash: leafHex,
          receiptCommitment: commitmentHex,
        });
      }

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
        endorsedBy: null,
        endorsementMandateId: null,
        endorsedAt: null,
        txHash: null,
        createdAt: now,
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
        ORDER BY batch_number DESC
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
      version?: number
    ): Promise<ReceiptProofRecord | null> {
      const res = await db.execute(
        version !== undefined
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
          status = EXCLUDED.status,
          public_signals_json = COALESCE(EXCLUDED.public_signals_json, zk_contribution_receipt_proofs.public_signals_json),
          proof_json = COALESCE(EXCLUDED.proof_json, zk_contribution_receipt_proofs.proof_json),
          tx_hash = COALESCE(EXCLUDED.tx_hash, zk_contribution_receipt_proofs.tx_hash),
          block_number = COALESCE(EXCLUDED.block_number, zk_contribution_receipt_proofs.block_number),
          verified_at = COALESCE(EXCLUDED.verified_at, zk_contribution_receipt_proofs.verified_at),
          failure_reason = EXCLUDED.failure_reason,
          updated_at = EXCLUDED.updated_at
        WHERE zk_contribution_receipt_proofs.batch_id = EXCLUDED.batch_id AND zk_contribution_receipt_proofs.status <> 'VERIFIED'
      `);

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

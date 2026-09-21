/**
 * ZK Contribution Batch & Proof routes (Spec #100, Issue #108).
 *
 * Endpoints:
 *   POST   /api/workspace/contribution-batches                          create a batch from endorsed contributions
 *   GET    /api/workspace/contribution-batches                          list batches for the institution
 *   GET    /api/workspace/contribution-batches/:id                      get batch detail with items
 *   POST   /api/workspace/contribution-batches/:id/endorse              officer endorses batch & registers root onchain
 *   POST   /api/workspace/contribution-batches/:id/proofs/:contributionId/process  generate Groth16 proof & verify on EVM
 *   GET    /api/workspace/contribution-batches/:id/proofs/:contributionId          inspect proof status
 *
 * Privacy & Security (ADR-0034, Spec #100):
 * - Private witness (amount, salt, purpose, Merkle siblings) stays server-side (AC15).
 * - Only public commitments (batchRoot, receiptCommitment, txHash) are published (AC03, AC15).
 * - Groth16 proofs are verified against the Solidity verifier on EVM (AC04, AC18).
 * - Honest status reporting: no simulated or mock proofs (AC20).
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { workspaceRuntime, type WorkspaceRuntime } from "../workspace-runtime";
import { authenticateWorkspace, badRequest, refuse } from "../workspace-session";
import { authorize } from "../tenancy";
import { operationalActor, OperationalAccessDenied } from "../operational-access";
import { text } from "./evidence-preparation";
import { inspectPublications, runZkPublication } from "../zk-publication";

export const contributionBatchRoutes = new Hono();
contributionBatchRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

contributionBatchRoutes.onError((error, c) => {
  if (error instanceof OperationalAccessDenied) {
    return c.json({ success: false, error: error.message }, 403);
  }
  return c.json({ success: false, error: "Terjadi kesalahan internal pada batch kontribusi." }, 500);
});

const runtimeOf = (): WorkspaceRuntime => {
  const runtime = workspaceRuntime();
  if (!runtime || !runtime.zkBatches) {
    throw new Error("Layanan ZK Contribution Batch belum dikonfigurasi.");
  }
  return runtime;
};

type BatchFunction = "RECORD_CONTRIBUTIONS" | "ENDORSE_CONTRIBUTIONS";
// The endorser must review the exact snapshot root it endorses, so reading a
// batch is open to either mandate; every write keeps its single owner.
const BATCH_READERS = ["RECORD_CONTRIBUTIONS", "ENDORSE_CONTRIBUTIONS"] as const;

async function batchActor(
  c: Context,
  institutionId: string | undefined,
  required: BatchFunction | readonly BatchFunction[]
) {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, institutionId);
  if (!auth.ok) return { response: auth.response } as const;
  if (!authorize(auth.session.role, "prepareEvidence")) return { response: refuse(c, 403, "forbidden") } as const;

  const actor = await operationalActor(runtime, auth.session);
  const functions = typeof required === "string" ? [required] : required;
  const granted = functions.find((fn) => actor.allows(fn, {}));
  // `require` produces the mandate check's own refusal wording when none is held.
  const mandate = actor.require(granted ?? functions[0]);
  return {
    runtime,
    session: auth.session,
    mandate,
    identity: { account: auth.session.account, officerId: actor.officer.id },
  } as const;
}

/**
 * 1. Create a batch from ENDORSED contributions.
 */
contributionBatchRoutes.post("/contribution-batches", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  let institutionId = text(body.institutionId) || undefined;

  const gate = await batchActor(c, institutionId, "RECORD_CONTRIBUTIONS");
  if ("response" in gate) return gate.response;
  institutionId = gate.session.institutionId;

  const contributionIds = Array.isArray(body.contributionIds)
    ? (body.contributionIds.filter((id) => typeof id === "string" && id.trim()) as string[])
    : [];
  if (contributionIds.length === 0) {
    return badRequest(c, "contributionIds wajib memuat minimal satu ID kontribusi.");
  }

  const fundType = text(body.fundType);
  const currencyUnit = text(body.currencyUnit);
  if (!fundType || !currencyUnit) {
    return badRequest(c, "fundType dan currencyUnit wajib disertakan.");
  }

  try {
    const batch = await gate.runtime.zkBatches!.createBatch({
      institutionId,
      contributionIds,
      fundType,
      currencyUnit,
      cutoff: typeof body.cutoff === "number" ? body.cutoff : undefined,
      now: gate.runtime.now(),
    });
    return c.json({ success: true, batch }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: "Batch tidak dapat dibuat. Periksa ID unik, nominal, jenis dana dan status ENDORSED semua kontribusi." }, 400);
  }
});

/**
 * 2. List batches for an institution.
 */
contributionBatchRoutes.get("/contribution-batches", async (c) => {
  let institutionId = c.req.query("institutionId")?.trim();

  const gate = await batchActor(c, institutionId, BATCH_READERS);
  if ("response" in gate) return gate.response;
  institutionId = gate.session.institutionId;

  const batches = await gate.runtime.zkBatches!.listBatches(institutionId);
  return c.json({ success: true, batches });
});

/**
 * 3. Get batch detail by ID.
 */
contributionBatchRoutes.get("/contribution-batches/:id", async (c) => {
  const batchId = c.req.param("id")?.trim();
  let institutionId = c.req.query("institutionId")?.trim();
  if (!batchId) {
    return badRequest(c, "batchId dan institutionId wajib disertakan.");
  }

  const gate = await batchActor(c, institutionId, BATCH_READERS);
  if ("response" in gate) return gate.response;
  institutionId = gate.session.institutionId;

  const batch = await gate.runtime.zkBatches!.getBatch(institutionId, batchId);
  if (!batch) {
    return c.json({ success: false, error: "Batch kontribusi tidak ditemukan." }, 404);
  }

  return c.json({ success: true, batch, operations: gate.runtime.zkPublications ? await inspectPublications(gate.runtime, institutionId, batchId) : [] });
});

/**
 * 4. Endorse batch and register batch root onchain.
 * Requires ENDORSE_CONTRIBUTIONS mandate (AC08).
 */
contributionBatchRoutes.post("/contribution-batches/:id/endorse", async (c) => {
  const batchId = c.req.param("id")?.trim();
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  let institutionId = text(body.institutionId) || undefined;
  if (!batchId) {
    return badRequest(c, "batchId dan institutionId wajib disertakan.");
  }

  const gate = await batchActor(c, institutionId, "ENDORSE_CONTRIBUTIONS");
  if ("response" in gate) return gate.response;
  institutionId = gate.session.institutionId;

  const existing = await gate.runtime.zkBatches!.getBatch(institutionId, batchId);
  if (!existing) {
    return c.json({ success: false, error: "Batch kontribusi tidak ditemukan." }, 404);
  }
  if (body.snapshotRoot !== existing.merkleRoot) return c.json({ success: false, error: "Tinjau dan sahkan snapshot root yang tepat." }, 409);
  if (!gate.runtime.zkPublications || !gate.runtime.zkBudget || !gate.runtime.zkRegistryAddress || !gate.runtime.zkWalletClient || !gate.runtime.zkPublicClient || !gate.runtime.zkProver) {
    return c.json({ success: false, error: "Layanan dan anggaran ZK belum dikonfigurasi." }, 503);
  }
  try {
    const actor = await operationalActor(gate.runtime, gate.session);
    const mandate = actor.require("ENDORSE_CONTRIBUTIONS", { nominalAmount: existing.currencyUnit === "IDR" ? BigInt(existing.totalAmountExact) : undefined });
    await gate.runtime.zkPublications.approve(existing, gate.identity.account, mandate.id, mandate.version, gate.runtime.now());
  } catch { return c.json({ success: false, error: "Snapshot berubah atau receipt sudah masuk antrean batch lain." }, 409); }
  // Root publication uses the same durable, budgeted path as receipts.
  await runZkPublication(gate.runtime, `root:${batchId}`);
  const endorsed = await gate.runtime.zkBatches!.getBatch(institutionId, batchId);
  return c.json({ success: true, batch: endorsed, operations: await inspectPublications(gate.runtime, institutionId, batchId) });
});

/**
 * 5. Generate real Groth16 proof and verify on EVM.
 */
contributionBatchRoutes.post("/contribution-batches/:id/proofs/:contributionId/process", async (c) => {
  const batchId = c.req.param("id")?.trim();
  const contributionId = c.req.param("contributionId")?.trim();
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  let institutionId = text(body.institutionId) || undefined;

  if (!batchId || !contributionId) {
    return badRequest(c, "batchId, contributionId, dan institutionId wajib disertakan.");
  }

  const gate = await batchActor(c, institutionId, "RECORD_CONTRIBUTIONS");
  if ("response" in gate) return gate.response;
  institutionId = gate.session.institutionId;

  const batch = await gate.runtime.zkBatches!.getBatch(institutionId, batchId);
  if (!batch) {
    return c.json({ success: false, error: "Batch kontribusi tidak ditemukan." }, 404);
  }
  if (batch.status !== "ENDORSED") {
    return c.json(
      { success: false, error: "Batch harus berstatus ENDORSED sebelum proof dapat diproses dan diverifikasi on-chain." },
      400
    );
  }

  if (!await gate.runtime.zkBatches!.batchIsCurrent(institutionId, batchId)) {
    return c.json({ success: false, error: "Snapshot batch sudah berubah; proof baru tidak dapat diproses." }, 409);
  }
  // Retrieve private witness
  const witness = await gate.runtime.zkBatches!.getBatchItemWitness(institutionId, batchId, contributionId);
  if (!witness) {
    return c.json({ success: false, error: "Data witness kontribusi tidak ditemukan dalam batch ini." }, 404);
  }

  const targetVersion = witness.version;
  const runtime = gate.runtime;
  if (!runtime.zkPublications || !runtime.zkBudget || !runtime.zkPublicClient || !runtime.zkWalletClient || !runtime.zkProver) {
    return c.json({ success: false, error: "Layanan dan anggaran ZK belum dikonfigurasi." }, 503);
  }
  const id = `receipt:${contributionId}:${targetVersion}`;
  const before = (await inspectPublications(runtime, institutionId, batchId)).find(
    p => p.id === id || (p.contributionId === contributionId && p.version === targetVersion)
  );
  if (!before) return c.json({ success: false, error: "Receipt belum masuk antrean yang disahkan." }, 409);
  if (before.status === "CONFIRMED") return c.json({ success: true, proofRecord: await runtime.zkBatches!.getReceiptProof(contributionId, targetVersion) });
  await runtime.zkPublications.retry(institutionId, batchId, runtime.now());
  await runZkPublication(runtime, before.id);
  const operation = (await inspectPublications(runtime, institutionId, batchId)).find(p => p.id === before.id)!;
  if (operation.status === "CONFIRMED") return c.json({ success: true, proofRecord: await runtime.zkBatches!.getReceiptProof(contributionId, targetVersion) }, 201);
  return c.json({ success: true, operation, proofRecord: { status: operation.status } }, 202);
});

/**
 * 6. Inspect proof status for a contribution in a batch.
 */
contributionBatchRoutes.get("/contribution-batches/:id/proofs/:contributionId", async (c) => {
  const batchId = c.req.param("id")?.trim();
  const contributionId = c.req.param("contributionId")?.trim();
  let institutionId = c.req.query("institutionId")?.trim();

  if (!batchId || !contributionId) {
    return badRequest(c, "batchId, contributionId, dan institutionId wajib disertakan.");
  }

  const gate = await batchActor(c, institutionId, "RECORD_CONTRIBUTIONS");
  if ("response" in gate) return gate.response;
  institutionId = gate.session.institutionId;

  const witness = await gate.runtime.zkBatches!.getBatchItemWitness(institutionId, batchId, contributionId);
  if (!witness) return c.json({ success: false, error: "Kontribusi tidak ditemukan dalam batch lembaga ini." }, 404);
  const proof = await gate.runtime.zkBatches!.getReceiptProof(contributionId, witness.version, batchId);
  if (!proof || proof.batchId !== batchId) {
    return c.json({ success: true, proofRecord: { status: "NOT_AVAILABLE" } });
  }

  const operation = gate.runtime.zkPublications ? (await inspectPublications(gate.runtime, institutionId, batchId)).find(p => p.contributionId === contributionId) : undefined;
  return c.json({ success: true, proofRecord: { ...proof, status: operation && operation.status !== "CONFIRMED" ? operation.status : proof.status } });
});

contributionBatchRoutes.post("/contribution-batches/:id/retry", async c => {
  const body = await c.req.json().catch(() => ({}));
  const gate = await batchActor(c, text(body.institutionId) || undefined, "RECORD_CONTRIBUTIONS");
  if ("response" in gate) return gate.response;
  const { runtime, session } = gate;
  const batchId = c.req.param("id");
  const batch = await runtime.zkBatches!.getBatch(session.institutionId, batchId);
  if (!batch) return c.json({ success: false, error: "Batch tidak ditemukan." }, 404);
  if (["SUPERSEDED", "ABANDONED"].includes(batch.status)) return c.json({ success: false, error: "Gunakan batch pengganti yang aktif." }, 409);
  if (!runtime.zkPublications) return c.json({ success: false, error: "Antrean belum tersedia." }, 503);
  await runtime.zkPublications.retry(session.institutionId, batchId, runtime.now());
  return c.json({ success: true, operations: await inspectPublications(runtime, session.institutionId, batchId) }, 202);
});

/**
 * 8. Create a replacement batch to correct an existing batch (Issue #110).
 */
contributionBatchRoutes.post("/contribution-batches/:id/correct", async (c) => {
  const batchId = c.req.param("id")?.trim();
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  let institutionId = text(body.institutionId) || undefined;

  const gate = await batchActor(c, institutionId, "RECORD_CONTRIBUTIONS");
  if ("response" in gate) return gate.response;
  institutionId = gate.session.institutionId;

  const expectedBatchVersion = typeof body.expectedBatchVersion === "number" ? body.expectedBatchVersion : undefined;
  const reason = text(body.reason);
  const sourceProofRef = text(body.sourceProofRef);

  if (expectedBatchVersion === undefined || !reason || !sourceProofRef) {
    return badRequest(c, "expectedBatchVersion, reason, dan sourceProofRef wajib disertakan.");
  }

  try {
    const replacement = await gate.runtime.zkBatches!.createReplacementBatch({
      institutionId,
      predecessorBatchId: batchId,
      expectedBatchVersion,
      reason,
      sourceProofRef,
      now: gate.runtime.now(),
    });
    return c.json({ success: true, batch: replacement }, 201);
  } catch (error: any) {
    const msg = error?.message || "Gagal membuat batch koreksi.";
    const status = msg.includes("stale version") || msg.includes("koreksi bersaing") || msg.includes("sudah ada") || msg.includes("telah memiliki batch koreksi") ? 409 : 400;
    return c.json({ success: false, error: msg }, status);
  }
});

/**
 * 9. Inspect batch version history / lineage (Issue #110).
 */
contributionBatchRoutes.get("/contribution-batches/:id/history", async (c) => {
  const batchId = c.req.param("id")?.trim();
  let institutionId = c.req.query("institutionId")?.trim();

  const gate = await batchActor(c, institutionId, BATCH_READERS);
  if ("response" in gate) return gate.response;
  institutionId = gate.session.institutionId;

  const history = await gate.runtime.zkBatches!.getBatchHistory(institutionId, batchId);
  return c.json({ success: true, history });
});

export default contributionBatchRoutes;

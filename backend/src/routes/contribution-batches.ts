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
import { CONTRIBUTION_PROOF_REGISTRY_ABI } from "../zk-proof-service";

export const contributionBatchRoutes = new Hono();

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

async function batchActor(
  c: Context,
  institutionId: string | undefined,
  requiredFunction: "RECORD_CONTRIBUTIONS" | "ENDORSE_CONTRIBUTIONS"
) {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, institutionId);
  if (!auth.ok) return { response: auth.response } as const;
  if (!authorize(auth.session.role, "prepareEvidence")) return { response: refuse(c, 403, "forbidden") } as const;

  const actor = await operationalActor(runtime, auth.session);
  const mandate = actor.require(requiredFunction);
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
  const institutionId = text(body.institutionId);
  if (!institutionId) {
    return badRequest(c, "institutionId wajib disertakan.");
  }

  const gate = await batchActor(c, institutionId, "RECORD_CONTRIBUTIONS");
  if ("response" in gate) return gate.response;

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
  const institutionId = c.req.query("institutionId")?.trim();
  if (!institutionId) {
    return badRequest(c, "institutionId wajib disertakan.");
  }

  const gate = await batchActor(c, institutionId, "RECORD_CONTRIBUTIONS");
  if ("response" in gate) return gate.response;

  const batches = await gate.runtime.zkBatches!.listBatches(institutionId);
  return c.json({ success: true, batches });
});

/**
 * 3. Get batch detail by ID.
 */
contributionBatchRoutes.get("/contribution-batches/:id", async (c) => {
  const batchId = c.req.param("id")?.trim();
  const institutionId = c.req.query("institutionId")?.trim();
  if (!batchId || !institutionId) {
    return badRequest(c, "batchId dan institutionId wajib disertakan.");
  }

  const gate = await batchActor(c, institutionId, "RECORD_CONTRIBUTIONS");
  if ("response" in gate) return gate.response;

  const batch = await gate.runtime.zkBatches!.getBatch(institutionId, batchId);
  if (!batch) {
    return c.json({ success: false, error: "Batch kontribusi tidak ditemukan." }, 404);
  }

  return c.json({ success: true, batch });
});

/**
 * 4. Endorse batch and register batch root onchain.
 * Requires ENDORSE_CONTRIBUTIONS mandate (AC08).
 */
contributionBatchRoutes.post("/contribution-batches/:id/endorse", async (c) => {
  const batchId = c.req.param("id")?.trim();
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const institutionId = text(body.institutionId);
  if (!batchId || !institutionId) {
    return badRequest(c, "batchId dan institutionId wajib disertakan.");
  }

  const gate = await batchActor(c, institutionId, "ENDORSE_CONTRIBUTIONS");
  if ("response" in gate) return gate.response;

  const existing = await gate.runtime.zkBatches!.getBatch(institutionId, batchId);
  if (!existing) {
    return c.json({ success: false, error: "Batch kontribusi tidak ditemukan." }, 404);
  }
  if (existing.status === "ENDORSED") {
    return c.json({ success: true, batch: existing }); // Idempotent
  }

  if (!gate.runtime.zkRegistryAddress || !gate.runtime.zkWalletClient || !gate.runtime.zkPublicClient || !gate.runtime.zkProver) {
    return c.json({ success: false, error: "Layanan EVM belum dikonfigurasi." }, 503);
  }
  if (!await gate.runtime.zkBatches!.batchIsCurrent(institutionId, batchId)) {
    return c.json({ success: false, error: "Snapshot batch sudah berubah; perlu pengesahan versi yang sesuai." }, 409);
  }
  let onChainTxHash: string | undefined = undefined;

  // If on-chain registry and wallet client are wired, register batch root
  if (gate.runtime.zkRegistryAddress && gate.runtime.zkWalletClient && gate.runtime.zkPublicClient) {
    try {
      await gate.runtime.zkProver.assertDeployment(gate.runtime.zkPublicClient, gate.runtime.zkRegistryAddress);
      const hash = await gate.runtime.zkWalletClient.writeContract({
        address: gate.runtime.zkRegistryAddress,
        abi: CONTRIBUTION_PROOF_REGISTRY_ABI,
        functionName: "endorseBatchRoot",
        args: [
          institutionId,
          BigInt(existing.batchNumber),
          BigInt(existing.version),
          existing.merkleRoot as `0x${string}`,
        ],
      });
      const receipt = await gate.runtime.zkPublicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== "success") {
        return c.json({ success: false, error: "Transaksi endorse batch root di EVM gagal/revert." }, 502);
      }
      onChainTxHash = hash;
    } catch (err: any) {
      return c.json({ success: false, error: "Gagal mendaftarkan batch root di EVM." }, 502);
    }
  }

  const endorsed = await gate.runtime.zkBatches!.endorseBatch({
    institutionId,
    batchId,
    endorsedBy: gate.identity.account,
    endorsementMandateId: gate.mandate.id,
    txHash: onChainTxHash,
    now: gate.runtime.now(),
  });

  return c.json({ success: true, batch: endorsed });
});

/**
 * 5. Generate real Groth16 proof and verify on EVM.
 */
contributionBatchRoutes.post("/contribution-batches/:id/proofs/:contributionId/process", async (c) => {
  const batchId = c.req.param("id")?.trim();
  const contributionId = c.req.param("contributionId")?.trim();
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const institutionId = text(body.institutionId);

  if (!batchId || !contributionId || !institutionId) {
    return badRequest(c, "batchId, contributionId, dan institutionId wajib disertakan.");
  }

  const gate = await batchActor(c, institutionId, "RECORD_CONTRIBUTIONS");
  if ("response" in gate) return gate.response;

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

  const targetVersion = witness.version ?? 1;

  // Idempotency: if already VERIFIED, return immediately (AC04, AC18)
  const existingProof = await gate.runtime.zkBatches!.getReceiptProof(contributionId, targetVersion);
  if (existingProof && existingProof.batchId === batchId && existingProof.status === "VERIFIED") {
    return c.json({ success: true, proofRecord: existingProof, message: "Proof sudah terverifikasi sebelumnya (idempoten)." });
  }

  if (!gate.runtime.zkProver || !gate.runtime.zkRegistryAddress || !gate.runtime.zkWalletClient || !gate.runtime.zkPublicClient) {
    return c.json({ success: false, error: "ZK Prover service belum dikonfigurasi." }, 503);
  }

  if (!await gate.runtime.zkBatches!.claimProof(contributionId, batchId, targetVersion, gate.runtime.now())) {
    return c.json({ success: false, error: "Proof sedang diproses atau sudah dicatat." }, 409);
  }

  try {
    await gate.runtime.zkProver.assertDeployment(gate.runtime.zkPublicClient, gate.runtime.zkRegistryAddress);
    // Generate real Groth16 proof
    const proofResult = await gate.runtime.zkProver.generateProof(witness);

    const onChainResult = await gate.runtime.zkProver.verifyAndRecordOnChain({
      institutionId, batchIdNumber: batch.batchNumber, version: targetVersion,
      contributionId, fundType: witness.fundType, proof: proofResult,
      registryAddress: gate.runtime.zkRegistryAddress,
      walletClient: gate.runtime.zkWalletClient, publicClient: gate.runtime.zkPublicClient,
    });

    if (!onChainResult.success) {
      const failedRecord = await gate.runtime.zkBatches!.saveReceiptProof({
        contributionId,
        batchId,
        version: targetVersion,
        status: "FAILED",
        publicSignals: proofResult.publicSignals,
        proof: proofResult.proof,
        failureReason: onChainResult.failureReason || "Verifikasi on-chain gagal.",
        now: gate.runtime.now(),
      });
      return c.json({ success: false, error: onChainResult.failureReason, proofRecord: failedRecord }, 422);
    }

    const verifiedRecord = await gate.runtime.zkBatches!.saveReceiptProof({
      contributionId,
      batchId,
      version: targetVersion,
      status: "VERIFIED",
      publicSignals: proofResult.publicSignals,
      proof: proofResult.proof,
      txHash: onChainResult.txHash,
      blockNumber: onChainResult.blockNumber,
      verifiedAt: onChainResult.verifiedAt ?? gate.runtime.now(),
      now: gate.runtime.now(),
    });

    return c.json({ success: true, proofRecord: verifiedRecord }, 201);
  } catch (err: any) {
    const failedRecord = await gate.runtime.zkBatches!.saveReceiptProof({
      contributionId,
      batchId,
      version: targetVersion,
      status: "FAILED",
      failureReason: "Pemrosesan proof gagal; belum ada hasil terkonfirmasi.",
      now: gate.runtime.now(),
    });
    return c.json({ success: false, error: "Pemrosesan proof gagal; belum ada hasil terkonfirmasi.", proofRecord: failedRecord }, 500);
  }
});

/**
 * 6. Inspect proof status for a contribution in a batch.
 */
contributionBatchRoutes.get("/contribution-batches/:id/proofs/:contributionId", async (c) => {
  const batchId = c.req.param("id")?.trim();
  const contributionId = c.req.param("contributionId")?.trim();
  const institutionId = c.req.query("institutionId")?.trim();

  if (!batchId || !contributionId || !institutionId) {
    return badRequest(c, "batchId, contributionId, dan institutionId wajib disertakan.");
  }

  const gate = await batchActor(c, institutionId, "RECORD_CONTRIBUTIONS");
  if ("response" in gate) return gate.response;

  const witness = await gate.runtime.zkBatches!.getBatchItemWitness(institutionId, batchId, contributionId);
  if (!witness) return c.json({ success: false, error: "Kontribusi tidak ditemukan dalam batch lembaga ini." }, 404);
  const proof = await gate.runtime.zkBatches!.getReceiptProof(contributionId, witness.version);
  if (!proof || proof.batchId !== batchId) {
    return c.json({ success: true, proofRecord: { status: "NOT_AVAILABLE" } });
  }

  return c.json({ success: true, proofRecord: proof });
});

export default contributionBatchRoutes;

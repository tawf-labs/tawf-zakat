import { Hono } from "hono";
import { workspaceRuntime } from "../workspace-runtime";
import { CONTRIBUTION_PROOF_REGISTRY_ABI } from "../zk-proof-service";

export const receiptVerificationRoutes = new Hono();
receiptVerificationRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});
receiptVerificationRoutes.onError((_error, c) => c.json({ success: false, error: "Pemeriksaan receipt belum tersedia." }, 503));

// Only the globally unique opaque contribution ID is a public proof reference.
// Bank references can collide across institutions and can contain personal data.
receiptVerificationRoutes.get("/receipt-verification/:reference", async (c) => {
  const runtime = workspaceRuntime();
  if (!runtime?.zkBatches) return c.json({ success: false, error: "Layanan verifikasi belum siap." }, 503);
  const reference = c.req.param("reference").trim();
  const record = await runtime.zkBatches.publicReceipt(reference);
  if (!record) return c.json({ success: false, error: "Receipt tidak ditemukan." }, 404);
  const operation = runtime.zkPublications ? (await runtime.zkPublications.list(record.institution_id))
    .filter(p => p.contributionId === record.id).sort((a, b) => b.version - a.version)[0] : undefined;
  let onChainConfirmed = false;
  let checkStatus = "NOT_CHECKED";
  if (record.status === "VERIFIED") {
    checkStatus = "UNAVAILABLE";
    if (runtime.zkPublicClient && runtime.zkRegistryAddress && runtime.zkProver) {
      try {
        await runtime.zkProver.assertDeployment(runtime.zkPublicClient, runtime.zkRegistryAddress);
        const data = await runtime.zkPublicClient.readContract({
          address: runtime.zkRegistryAddress, abi: CONTRIBUTION_PROOF_REGISTRY_ABI,
          functionName: "getReceiptVerification",
          args: [record.institution_id, record.id, BigInt(record.version)],
        });
        onChainConfirmed = data[0] && data[1] === BigInt(record.batch_number) &&
          data[2] === record.merkle_root && data[3] === record.receipt_commitment &&
          data[5] === BigInt(record.block_number);
        if (onChainConfirmed) {
          const receipt = await runtime.zkPublicClient.getTransactionReceipt({ hash: record.tx_hash });
          const block = await runtime.zkPublicClient.getBlock({ blockNumber: receipt.blockNumber });
          const head = await runtime.zkPublicClient.getBlockNumber({ cacheTime: 0 });
          onChainConfirmed = receipt.status === "success" && block.hash === receipt.blockHash &&
            receipt.blockNumber === BigInt(record.block_number) && BigInt(head) - BigInt(receipt.blockNumber) + 1n >= BigInt(runtime.zkBudget?.confirmations ?? 1);
        }
        checkStatus = onChainConfirmed ? "CONFIRMED" : "MISMATCH";
      } catch { onChainConfirmed = false; /* Historical SQL result is separate from this live check. */ }
    }
  }
  return c.json({ success: true, verification: {
    reference,
    status: record.version != null && Number(record.version) < Number(record.current_version) ? "SUPERSEDED" :
      record.status === "VERIFIED" && !onChainConfirmed ? "UNCONFIRMED" : record.status === "VERIFIED" ? "VERIFIED" : operation?.status ?? record.status ?? "NOT_AVAILABLE",
    recordedStatus: record.status ?? "NOT_AVAILABLE",
    claimType: "ZKT_MEMBERSHIP_PROOF_GROTH16_BN254",
    endorsementSource: "INSTITUTION_BATCH_ROOT",
    institutionId: record.institution_id,
    endorsedBy: record.endorsed_by ?? null,
    endorsedAt: record.endorsed_at ? Number(record.endorsed_at) : null,
    batchNumber: record.batch_number, version: record.version,
    batchRoot: record.merkle_root, receiptCommitment: record.receipt_commitment,
    txHash: record.tx_hash ?? null, blockNumber: record.block_number,
    verifiedAt: record.verified_at ? Number(record.verified_at) : null,
    registryAddress: runtime.zkRegistryAddress ?? null,
    onChainConfirmed, checkStatus,
  } });
});
export default receiptVerificationRoutes;

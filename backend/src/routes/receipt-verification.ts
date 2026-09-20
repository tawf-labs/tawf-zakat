import { Hono } from "hono";
import { workspaceRuntime } from "../workspace-runtime";
import { CONTRIBUTION_PROOF_REGISTRY_ABI } from "../zk-proof-service";
import { receiptIsFinal } from "../zk-finality";

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
  let isLatestRegisteredRoot = false;
  let chainBusinessValidity: "UNKNOWN" | "SUPERSEDED" = "UNKNOWN";
  let mathematicalValidity: "VALID" | "VALID_HISTORICAL" | "UNVERIFIED" = "UNVERIFIED";

  if (record.status === "VERIFIED") {
    checkStatus = "UNAVAILABLE";
    if (runtime.zkPublicClient && runtime.zkRegistryAddress && runtime.zkProver) {
      try {
        await runtime.zkProver.assertDeployment(runtime.zkPublicClient, runtime.zkRegistryAddress);
        const data = await runtime.zkPublicClient.readContract({
          address: runtime.zkRegistryAddress, abi: CONTRIBUTION_PROOF_REGISTRY_ABI,
          functionName: "getReceiptVerificationWithBatch",
          args: [record.institution_id, record.id, BigInt(record.version)],
        });
        isLatestRegisteredRoot = Boolean(data[7]);
        chainBusinessValidity = data[8] === 1 ? "SUPERSEDED" : "UNKNOWN";
        onChainConfirmed = Boolean(
          data[0] &&
          data[1] === BigInt(record.batch_number) &&
          data[3] === record.merkle_root &&
          data[4] === record.receipt_commitment &&
          data[6] === BigInt(record.block_number)
        );
        if (onChainConfirmed) {
          const receipt = await runtime.zkPublicClient.getTransactionReceipt({ hash: record.tx_hash });
          onChainConfirmed = receipt.status === "success" &&
            receipt.blockNumber === BigInt(record.block_number) && await receiptIsFinal(runtime, receipt);
        }
        checkStatus = onChainConfirmed ? "CONFIRMED" : "MISMATCH";
        if (onChainConfirmed) {
          mathematicalValidity = isLatestRegisteredRoot ? "VALID" : "VALID_HISTORICAL";
        }
      } catch { onChainConfirmed = false; /* Historical SQL result is separate from this live check. */ }
    }
  }

  const batchIsCurrent = Boolean(record.batchIsCurrent ?? record.batch_is_current);
  const memberSuperseded = record.version != null && Number(record.version) < Number(record.current_version);
  const batchSuperseded = Boolean(record.batch_id) && (!batchIsCurrent || (!isLatestRegisteredRoot && onChainConfirmed));

  let businessValidity: "CURRENT" | "PENDING_REPROOF" | "SUPERSEDED" | "PENDING" = "PENDING";
  let explanation = "";

  if (memberSuperseded) {
    businessValidity = "SUPERSEDED";
    explanation = "Data kontribusi telah diperbarui atau direfund; receipt versi ini telah digantikan.";
  } else if (batchSuperseded) {
    businessValidity = "PENDING_REPROOF";
    explanation = onChainConfirmed
      ? "Batch kontribusi telah mengalami koreksi. Receipt valid secara matematis pada root historis, namun menunggu reproof pada root batch resmi terkini."
      : "Batch kontribusi telah mengalami koreksi. Validitas proof belum dapat dikonfirmasi; menunggu reproof pada batch terbaru.";
  } else if (onChainConfirmed && mathematicalValidity === "VALID") {
    businessValidity = "CURRENT";
    explanation = "Receipt sah secara matematis dan berlaku aktif pada batch resmi terkini.";
  } else {
    businessValidity = "PENDING";
    explanation = "Receipt belum terkonfirmasi final pada EVM registry.";
  }

  const overallStatus = memberSuperseded ? "SUPERSEDED" :
    batchSuperseded && onChainConfirmed ? "PENDING_REPROOF" :
    record.status === "VERIFIED" && !onChainConfirmed ? "UNCONFIRMED" :
    record.status === "VERIFIED" ? "VERIFIED" :
    operation?.status ?? record.status ?? "NOT_AVAILABLE";

  return c.json({ success: true, verification: {
    reference,
    status: overallStatus,
    mathematicalValidity,
    chainBusinessValidity,
    isLatestRegisteredRoot,
    businessValidity,
    isCurrent: businessValidity === "CURRENT",
    explanation,
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
    batchIsCurrent: record.batch_is_current,
    history: record.history ?? [],
  } });
});
export default receiptVerificationRoutes;

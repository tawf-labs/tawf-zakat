/** Local examination boundary. Untrusted bundles never supply executable code or RPC URLs. */
import { createPublicClient, http, hashTypedData, verifyTypedData, keccak256, toHex, decodeEventLog, type Hex } from "viem";
import { evidenceTypedData } from "../../shared/report-registry";
import { reportRegistryAbi } from "../../shared/report-registry-abi";
import { canonicalJson, sha256Hex, verifyCommitment } from "./evidence-snapshot";
import { reviewSnapshot, assessReportDraft, wire, AmilRulesSchema } from "./report-package";

export type ExaminationConnection = { rpcUrl: string; chainId: number; registry: Hex };
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const normalizedAuthorization = (a: any) => wire({ ...a, signer: a.signer.toLowerCase() });
const same = (a: unknown, b: unknown) => canonicalJson(wire(a)) === canonicalJson(wire(b));
export async function verifyExamination(bundle: any, connection?: ExaminationConnection) {
  assert(bundle?.format === "tawf.report.examination" && bundle.version === 1, "Format paket pemeriksaan tidak didukung.");
  const saved = JSON.parse(bundle.packageCanonical), snapshot = JSON.parse(bundle.snapshotCanonical);
  assert(canonicalJson(saved) === bundle.packageCanonical && canonicalJson(snapshot) === bundle.snapshotCanonical, "Serialisasi kanonik berubah.");
  assert(verifyCommitment(new TextEncoder().encode(bundle.packageCanonical), bundle.commitmentSalt, bundle.packageDigest), "Commitment paket tidak cocok.");
  assert(verifyCommitment(new TextEncoder().encode(bundle.snapshotCanonical), bundle.commitmentSalt, bundle.snapshotCommitment), "Commitment snapshot tidak cocok.");
  assert(saved.snapshotCommitment === bundle.snapshotCommitment && same(saved.snapshot, snapshot), "Snapshot berbeda dari paket.");
  assert(saved.format === "tawf.report.package" && saved.serializationVersion === 1 && snapshot.format === "tawf.evidence.snapshot" && snapshot.version === 1, "Versi serialisasi tidak didukung.");
  assert(saved.institutionId === snapshot.institutionId && saved.preparationId === snapshot.preparationId, "Identitas snapshot berbeda.");
  const rules = AmilRulesSchema.parse(saved.policy.amilChecks.map((c: any) => c.rule));
  const review = reviewSnapshot({ canonicalSnapshot: bundle.snapshotCanonical, commitmentSalt: bundle.commitmentSalt, commitment: bundle.snapshotCommitment }, rules);
  assert(same(saved.policy, review.policy), "Versi atau perhitungan kebijakan tidak cocok.");
  assert(same(saved.figures, review.figures) && same(saved.reconciliation, review.reconciliation), "Angka atau rekonsiliasi berbeda dari perhitungan ulang.");
  const draft = saved.draft && { ...saved.draft, claims: saved.draft.claims.map((c: any) => ({ ...c, value: c.value ? { ...c.value, amount: BigInt(c.value.amount) } : null })) };
  const verdict = assessReportDraft(review, draft, saved.disclosure);
  assert(same(saved.verdict, verdict), "Vonis berbeda dari pemeriksaan ulang.");
  assert(Array.isArray(bundle.files) && bundle.files.length === snapshot.files.length && new Set(bundle.files.map((f: any) => f.id)).size === bundle.files.length, "Daftar berkas tidak cocok.");
  const missing: string[] = [];
  for (const original of snapshot.files) {
    const file = bundle.files.find((f: any) => f.id === original.id);
    assert(file, "Berkas snapshot tidak tercantum.");
    assert(["AVAILABLE", "MISSING", "UNAVAILABLE", "INTEGRITY_FAILED"].includes(file.state), "Keadaan berkas tidak dikenal.");
    assert(file.state !== "INTEGRITY_FAILED", "Integritas berkas sumber gagal.");
    if (file.state !== "AVAILABLE") { missing.push(original.id); continue; }
    assert(typeof file.contentBase64 === "string", "Byte berkas tidak tersedia.");
    const bytes = Buffer.from(file.contentBase64, "base64");
    assert(bytes.toString("base64") === file.contentBase64 && sha256Hex(bytes) === original.contentSha256 && bytes.length === original.sizeBytes, "Isi berkas tidak cocok dengan snapshot.");
  }
  const rpc = connection ? createPublicClient({ transport: http(connection.rpcUrl) }) : null;
  if (rpc) assert(await rpc.getChainId() === connection!.chainId, "Chain RPC berbeda dari konfigurasi pemeriksa.");
  let signatures = 0, acceptedPublications = 0, chainVerified = 0;
  let unresolvedContractSignatures = 0;
  assert(Array.isArray(bundle.proofs), "Bukti pengesahan harus berupa daftar.");
  for (const proof of bundle.proofs) {
    const { intent, signature, receipt } = proof;
    const a = intent.authorization;
    const publication = a.action === keccak256(toHex("PUBLISH_REPORT"));
    assert(publication || a.action === keccak256(toHex("RECORD_EVIDENCE")), "Tujuan pengesahan tidak dikenal.");
    assert(a.institutionId === saved.institutionId && a.reportId === saved.reportId && a.version === saved.version
      && a.packageId === saved.id && a.predecessor === (saved.predecessor ?? "") && a.digest === bundle.packageDigest
      && a.policy === saved.policy.id && a.outcome === verdict.outcome, "Pengesahan berbeda dari paket yang dihitung ulang.");
    const typed = evidenceTypedData(intent.domain, a);
    assert(intent.domain.name === "Tawf Report Evidence" && intent.domain.version === "1" && hashTypedData(typed) === intent.authorizationDigest, "Domain atau digest pengesahan berubah.");
    let contractAccount = false;
    if (signature) {
      let eoa = false;
      try { eoa = await verifyTypedData({ ...typed, address: a.signer, signature }); } catch { /* ERC-1271 can use non-ECDSA bytes. */ }
      if (!eoa) {
        assert(intent.accountKind === "ERC1271", "Signature lembaga tidak sah.");
        contractAccount = true; unresolvedContractSignatures++;
      } else signatures++;
    }
    if (publication) {
      const v = intent.validator;
      assert(v && a.outcome === "LOLOS" && v.authorization.action === keccak256(toHex("VALIDATE_REPORT")) && v.authorization.signer.toLowerCase() !== a.signer.toLowerCase(), "Dua kewenangan penerbitan tidak lengkap.");
      for (const field of ["institutionId", "reportId", "version", "packageId", "predecessor", "digest", "policy", "outcome", "deadline"]) assert(v.authorization[field] === a[field], "Paket validator berbeda dari lembaga.");
      const vt = evidenceTypedData(intent.domain, v.authorization);
      assert(hashTypedData(vt) === v.authorizationDigest && await verifyTypedData({ ...vt, address: v.authorization.signer, signature: v.signature }), "Signature validator tidak sah.");
      signatures++;
    }
    if (!receipt) continue;
    assert(signature && receipt.status === "success" && receipt.transactionHash === intent.transactionHash && receipt.to?.toLowerCase() === intent.domain.verifyingContract.toLowerCase(), "Receipt tidak cocok.");
    assert(receipt.blockHash === intent.observation.blockHash && receipt.blockNumber === intent.observation.blockNumber, "Checkpoint receipt berbeda.");
    const logs = receipt.logs.filter((log: any) => {
      if (log.address.toLowerCase() !== intent.domain.verifyingContract.toLowerCase() || log.removed || log.transactionHash !== receipt.transactionHash || log.blockHash !== receipt.blockHash || log.blockNumber !== receipt.blockNumber) return false;
      try {
        const event = decodeEventLog({ abi: reportRegistryAbi, eventName: publication ? "ReportPublished" : "EvidenceRecorded", data: log.data, topics: log.topics, strict: true });
        const args = event.args as any;
        return args.institutionKey === keccak256(toHex(a.institutionId)) && args.packageKey === keccak256(toHex(a.packageId))
          && args.authorization === intent.authorizationDigest && args.action === a.action && args.digest === a.digest && args.signer.toLowerCase() === a.signer.toLowerCase()
          && (!publication || (args.validatorAuthorization === intent.validator.authorizationDigest && args.validator.toLowerCase() === intent.validator.authorization.signer.toLowerCase()));
      } catch { return false; }
    });
    assert(logs.length === 1 && logs[0].logIndex === intent.observation.logIndex, "Event penerimaan tidak cocok.");
    if (publication) acceptedPublications++;
    if (rpc) {
      assert(connection!.chainId === intent.domain.chainId && connection!.registry.toLowerCase() === intent.domain.verifyingContract.toLowerCase(), "Registry berbeda dari konfigurasi pemeriksa.");
      const actual = await rpc.getTransactionReceipt({ hash: receipt.transactionHash });
      const block = await rpc.getBlock({ blockNumber: BigInt(receipt.blockNumber) });
      assert(actual.status === "success" && same(wire(actual), receipt) && block.hash === receipt.blockHash, "Receipt bukan bagian chain canonical terkini.");
      if (publication) {
        const accepted = await rpc.readContract({ address: connection!.registry, abi: reportRegistryAbi, functionName: "publishedVersion", args: [a.institutionId, a.reportId, a.version], blockNumber: actual.blockNumber });
        assert(same(normalizedAuthorization(accepted.institution), normalizedAuthorization(a)) && same(normalizedAuthorization(accepted.validator), normalizedAuthorization(intent.validator.authorization))
          && accepted.institutionSignature.toLowerCase() === signature.toLowerCase() && accepted.validatorSignature.toLowerCase() === intent.validator.signature.toLowerCase(), "Otorisasi tidak sama dengan versi yang diterima registry.");
        if (contractAccount) { unresolvedContractSignatures--; signatures++; }
      } else if (contractAccount) {
        // Recording ABI has no accepted-signature getter; confirm the exact input calldata instead.
        const tx = await rpc.getTransaction({ hash: receipt.transactionHash });
        const { encodeFunctionData } = await import("viem");
        const { contractAuthorization } = await import("../../shared/report-registry");
        assert(tx.input === encodeFunctionData({ abi: reportRegistryAbi, functionName: "recordEvidence", args: [contractAuthorization(a), signature] }), "Signature pencatatan berbeda dari transaksi yang diterima.");
        unresolvedContractSignatures--; signatures++;
      }
      chainVerified++;
    }
  }
  if (bundle.publication === "PUBLISHED") assert(acceptedPublications > 0, "Klaim terbit tanpa bukti penerimaan.");
  return { ok: missing.length === 0 && unresolvedContractSignatures === 0, commitments: "MATCH", files: { missing }, signatures,
    chain: connection ? (chainVerified ? "CANONICAL_RECEIPTS_CHECKED" : "NO_ACCEPTED_RECEIPT") : "NOT_CHECKED_OFFLINE",
    contractSignatures: unresolvedContractSignatures > 0 ? "REQUIRES_RPC" : "CHECKED_OR_NOT_PRESENT",
    publicationClaim: bundle.publication, recomputed: wire({ figures: review.figures, reconciliation: review.reconciliation, verdict }),
    limitations: "Pemeriksaan offline membuktikan konsistensi paket dan signature EOA, bukan canonical chain atau kewenangan historis. Gunakan RPC dan identitas deployment independen untuk pemeriksaan penerimaan registry; sumber bank tetap memerlukan pemeriksaan." };
}

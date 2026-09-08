/** Separate public projection and authenticated examination material for a fixed report package. */
import { keccak256, toHex } from "viem";
import { canonicalJson, sha256Hex } from "./evidence-snapshot";
import { createReportPackages, PackageError, wire } from "./report-package";
import { createRecording } from "./registry-recording";
import { attestationsForVersion, readOfficialLine, type VersionAttestation } from "./report-history";

/** What a public reader sees of an auditor's note: the on-chain facts, and nothing an auditor typed. */
const publicAttestations = (attestations: { state: string; basis: string; entries: VersionAttestation[] }) => ({
  state: attestations.state, count: attestations.entries.length, basis: attestations.basis,
  entries: attestations.entries.map(note => ({ id: note.id, auditor: note.auditor, scope: note.scope,
    conclusion: note.conclusion, evidenceCommitment: note.evidenceCommitment, predecessor: note.predecessor, mandate: note.mandate })),
});
import type { WorkspaceRuntime } from "./workspace-runtime";

export async function examinationFiles(runtime: WorkspaceRuntime, record: { files: { id: string; storageRef: string | null; contentSha256: string | null }[] }) {
  return Promise.all(record.files.map(async file => {
    if (!runtime.files || !file.storageRef) return { id: file.id, state: "UNAVAILABLE" as const };
    let bytes: Uint8Array | null;
    try { bytes = await runtime.files.get(file.storageRef); } catch { return { id: file.id, state: "UNAVAILABLE" as const }; }
    if (!bytes) return { id: file.id, state: "MISSING" as const };
    if (sha256Hex(bytes) !== file.contentSha256) return { id: file.id, state: "INTEGRITY_FAILED" as const };
    return { id: file.id, state: "AVAILABLE" as const, contentBase64: Buffer.from(bytes).toString("base64") };
  }));
}
export function createExamination(runtime: WorkspaceRuntime, institution: string, preparation: string, packageId: string) {
  const store = runtime.evidence!;
  const packages = createReportPackages(store, runtime.files, runtime.reportAmilRules);
  async function context() {
    const saved = await packages.read(institution, preparation, packageId);
    const record = await store.getPreparation(institution, preparation);
    if (!record) throw new PackageError("Snapshot tidak ditemukan.", 404);
    return { saved, record };
  }
  async function anchors() {
    if (!runtime.registry) return { publication: null, publicationIntents: [], recording: [] };
    return {
      publicationIntents: await createRecording(runtime, runtime.registry, institution, preparation, packageId, true).list(),
      publication: await createRecording(runtime, runtime.registry, institution, preparation, packageId, true).version(),
      recording: await createRecording(runtime, runtime.registry, institution, preparation, packageId).list(),
    };
  }
  /**
   * The report's official line as a public reader may see it.
   *
   * Version titles and correction reasons are institution-authored free text and
   * stay restricted; a public reader gets the version reference, who endorsed it,
   * when it was accepted, and the link to the version it succeeded.
   */
  async function publicHistory(reportId: string) {
    const line = await readOfficialLine(runtime, runtime.registry!, institution, reportId);
    return line.map(entry => ({
      packageId: entry.packageId, versionReference: keccak256(toHex(entry.version)), official: entry.official,
      predecessorPackageId: entry.predecessor, commitment: entry.digest, policy: entry.policy, outcome: entry.outcome,
      endorsements: entry.endorsements,
      correctionReason: entry.predecessor ? "TERBATAS_BAGI_PEMBACA_BERWENANG" : null,
      anchor: entry.anchor && { transactionHash: entry.anchor.transactionHash, state: entry.anchor.state,
        blockNumber: entry.anchor.blockNumber ?? null, blockHash: entry.anchor.blockHash ?? null,
        logIndex: entry.anchor.logIndex ?? null, blockTimestamp: entry.anchor.blockTimestamp ?? null,
        confirmations: entry.anchor.confirmations, requiredConfirmations: entry.anchor.requiredConfirmations },
      // Conclusions are a fixed vocabulary recorded on chain, so the public line may carry them verbatim.
      attestations: publicAttestations(entry.attestations),
    }));
  }
  return {
    async publicSummary() {
      const { saved, record } = await context();
      if (!runtime.registry) throw new Error("Registry unavailable");
      const observed = await anchors();
      let content = await store.getPublicReport(packageId);
      if (!content) {
        if (observed.publication?.publication !== "PUBLISHED") throw new PackageError("Ringkasan versi terbit tidak ditemukan.", 404);
        const owner = await runtime.store.getInstitution(institution);
        if (!owner) throw new Error("Institution unavailable");
        // Only explicit public vocabulary; caller-authored names, labels, narratives and file hashes stay private.
        const counts: Record<string, number> = {};
        for (const finding of saved.reconciliation?.discrepancies ?? []) counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;
        content = {
          format: "tawf.report.public", formatVersion: 1, packageId,
          institution: { id: institution, name: owner.legalName, synthetic: owner.isSynthetic },
          period: saved.snapshot.period, scope: { kind: "RECONCILIATION", balanceSheet: saved.snapshot.balanceSheetScope,
            currencyUnit: saved.snapshot.currencyUnit, levels: [...new Set(saved.snapshot.sides.map((s: any) => ["PUSAT", "PROVINSI", "KABUPATEN", "KOTA", "KECAMATAN", "DESA"].includes(s.manifest.scopeLevel) ? s.manifest.scopeLevel : "CAKUPAN_TERBATAS"))],
            fundTypes: [...new Set(saved.snapshot.sides.flatMap((s: any) => s.manifest.fundTypes))] },
          sources: saved.snapshot.sides.map((s: any) => ({ role: s.manifest.role, origin: s.manifest.origin,
            cutOff: s.manifest.cutOff, transactionDetail: s.manifest.transactionDetail, status: s.status })),
          reportReference: keccak256(toHex(saved.reportId)), versionReference: keccak256(toHex(saved.version)),
          publicationAuthorizationDigest: observed.publication.anchor!.authorizationDigest,
          commitment: saved.digest, commitmentScheme: "HMAC-SHA256", policy: saved.policy.id,
          findings: { counts, netDelta: saved.reconciliation?.netDelta ?? null, absoluteDelta: saved.reconciliation?.absoluteDelta ?? null },
          tolerance: saved.snapshot.tolerance,
          limitations: ["ASNAF_UNAVAILABLE", "DURATION_UNAVAILABLE", "NARRATIVE_SEMANTICS_UNEXAMINED", ...(saved.snapshot.sides.some((s: any) => s.manifest.transactionDetail === "NOT_AVAILABLE") ? ["TRANSACTION_DETAIL_UNAVAILABLE"] : []), ...(saved.policy.amilChecks.length ? [] : ["AMIL_UNEXAMINED"])],
        };
        await store.savePublicReport(packageId, content);
        content = await store.getPublicReport(packageId);
      }
      const files = await examinationFiles(runtime, record);
      const own = await attestationsForVersion(runtime.registry.chain, { institutionId: institution, reportId: saved.reportId, version: saved.version, packageId, digest: saved.digest });
      const history = await publicHistory(saved.reportId);
      const intent = observed.publicationIntents.find(i => i.authorizationDigest === content.publicationAuthorizationDigest);
      const domain = runtime.registry.chain.domain;
      return {
        content, summaryDigest: sha256Hex(new TextEncoder().encode(canonicalJson(content))),
        publication: { state: observed.publication?.publication ?? "NOT_PUBLISHED", observation: intent?.observation ?? null },
        // Which version identity this summary is, and whether a later correction has taken over.
        version: { state: observed.publication?.versionState ?? "BUKAN_VERSI_RESMI",
          predecessorPackageId: saved.predecessor ?? null,
          supersededByPackageId: history.find(entry => entry.predecessorPackageId === packageId)?.packageId ?? null,
          officialPackageId: observed.publication?.officialPackageId ?? null,
          officialVersionReference: history.find(entry => entry.official)?.versionReference ?? null },
        history,
        recording: { state: observed.recording.some(i => i.observation.state === "CONFIRMED") ? "RECORDED" : "NOT_CONFIRMED" },
        // Read by version identity only: a correction never inherits the audit state of the version it succeeds.
        validator: { outcome: saved.verdict.outcome }, auditor: own.state,
        attestations: publicAttestations(own),
        files: { total: files.length, available: files.filter(f => f.state === "AVAILABLE").length,
          missing: files.filter(f => f.state === "MISSING").length, unavailable: files.filter(f => f.state === "UNAVAILABLE").length,
          integrityFailed: files.filter(f => f.state === "INTEGRITY_FAILED").length },
        network: { chainId: domain.chainId, registry: domain.verifyingContract,
          name: domain.chainId === 31337 ? "EVM lokal" : domain.chainId === 421614 ? "Arbitrum Sepolia (testnet)" : `Chain ${domain.chainId} (konfigurasi khusus)`,
          confirmationPolicy: runtime.registry.chain.confirmationPolicy, requiredConfirmations: runtime.registry.chain.requiredConfirmations },
        anchor: intent ? { transactionHash: intent.transactionHash, authorizationDigest: intent.authorizationDigest,
          validatorAuthorizationDigest: intent.validator?.authorizationDigest, ...intent.observation } : null,
        trust: "Kontrak memverifikasi pernyataan layanan validator; perhitungan dan sumber bank tetap perlu dipercaya atau diperiksa. Konfirmasi blok bukan finalitas settlement L1. Commitment privat memerlukan paket pemeriksaan berwenang.",
      };
    },
    async export() {
      const { saved, record } = await context();
      const stored = await store.getReportPackage(institution, preparation, packageId);
      const observed = await anchors();
      const proofs = [];
      if (runtime.registry) {
        const publication = await createRecording(runtime, runtime.registry, institution, preparation, packageId, true).list();
        for (const intent of [...observed.recording, ...publication]) {
          const attempt = await runtime.registry.store.attempt(institution, intent.id);
          const receipt = intent.transactionHash && ["INCLUDED", "CONFIRMED"].includes(intent.observation.state)
            ? wire(await runtime.registry.chain.receipt(intent.transactionHash)) : null;
          proofs.push({ intent, signature: attempt?.signature ?? null, receipt });
        }
      }
      return {
        format: "tawf.report.examination", version: 1, packageCanonical: stored!.canonical, packageDigest: saved.digest,
        snapshotCanonical: record.canonicalSnapshot, snapshotCommitment: record.commitment, commitmentSalt: record.commitmentSalt,
        files: await examinationFiles(runtime, record), proofs,
        publication: observed.publication?.publication ?? "NOT_PUBLISHED",
        versionState: observed.publication?.versionState ?? "BUKAN_VERSI_RESMI",
        officialLine: runtime.registry ? await readOfficialLine(runtime, runtime.registry, institution, saved.reportId) : [],
        exportedAt: runtime.now(),
        instructions: "Simpan JSON ini sebagai examination.json. Dari checkout proyek: bun backend/src/scripts/verify-report.ts examination.json. Untuk memeriksa anchor canonical, tambahkan --rpc URL_RPC --chain-id ID --registry ALAMAT yang diperoleh secara independen. Verifier tidak memanggil AI. Jangan publikasikan paket ini: berisi sumber privat dan pembuka commitment.",
      };
    },
  };
}

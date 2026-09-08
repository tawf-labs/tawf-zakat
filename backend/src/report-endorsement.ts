/** Recompute from committed sources before signing; caller-supplied verdicts never enter here. */
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "node:crypto";
import { hashTypedData, keccak256, toHex, type Hex } from "viem";
import { evidenceTypedData, type EvidenceAuthorization, type RecordingIntent } from "../../shared/report-registry";
import { canonicalJson, sha256Hex } from "./evidence-snapshot";
import { createReportPackages, reviewSnapshot, assessReportDraft, wire, PackageError } from "./report-package";
import type { WorkspaceRuntime } from "./workspace-runtime";
import type { RegistryChain } from "./registry-chain";

export function createReportEndorsement(privateKey: Hex) {
  const signer = privateKeyToAccount(privateKey);
  return {
    async endorse(runtime: WorkspaceRuntime, chain: RegistryChain, institution: string, preparation: string, packageId: string, authorization: EvidenceAuthorization): Promise<NonNullable<RecordingIntent["validator"]>> {
      const saved = await verifyPublishablePackage(runtime, institution, preparation, packageId);
      if (authorization.digest !== saved.digest || authorization.action !== keccak256(toHex("PUBLISH_REPORT"))) throw new PackageError("Paket atau tujuan pengesahan tidak cocok.", 409);
      const role = await chain.validatorAuthority(signer.address);
      if (!role.active || signer.address.toLowerCase() === authorization.signer.toLowerCase()) throw new PackageError("Validator tidak berwenang atau sama dengan pengesah lembaga.", 409);
      const statement = { ...authorization, action: keccak256(toHex("VALIDATE_REPORT")), outcome: "LOLOS", signer: signer.address, authorityEpoch: role.epoch, nonce: toHex(randomBytes(32)) };
      const typed = evidenceTypedData(chain.domain, statement);
      return { authorization: statement, authorizationDigest: hashTypedData(typed), signature: await signer.signTypedData(typed) };
    },
  };
}
export type ReportEndorsement = ReturnType<typeof createReportEndorsement>;

export async function verifyPublishablePackage(runtime: WorkspaceRuntime, institution: string, preparation: string, packageId: string) {
  const saved = await createReportPackages(runtime.evidence!, runtime.files, runtime.reportAmilRules).read(institution, preparation, packageId);
  const record = await runtime.evidence!.getPreparation(institution, preparation);
  if (!record || saved.status !== "FROZEN") throw new PackageError("Paket beku dan snapshot wajib tersedia.", 409);
  const review = reviewSnapshot(record, runtime.reportAmilRules);
  for (const file of record.files) {
    if (!runtime.files || !file.storageRef || file.storageStatus !== "STORED") throw new PackageError("Berkas wajib tidak tersedia; pulihkan sumber sebelum meminta pengesahan.", 409);
    const bytes = await runtime.files.get(file.storageRef);
    if (!bytes || sha256Hex(bytes) !== file.contentSha256) throw new PackageError("Berkas wajib hilang atau berubah; pulihkan sumber.", 409);
  }
  const equal = (left: unknown, right: unknown) => canonicalJson(wire(left)) === canonicalJson(wire(right));
  if (saved.snapshotCommitment !== record.commitment || !equal(saved.snapshot, review.snapshot)
    || !equal(saved.figures, review.figures) || !equal(saved.reconciliation, review.reconciliation)
    || !equal(saved.policy, review.policy) || !equal(saved.disclosure, review.disclosure)) throw new PackageError("Snapshot, angka, cakupan, atau kebijakan berubah. Siapkan paket dan pengesahan baru.", 409);
  const draft = saved.draft && { ...saved.draft, claims: saved.draft.claims.map((c: any) => ({ ...c, value: c.value ? { ...c.value, amount: BigInt(c.value.amount) } : null })) };
  const verdict = assessReportDraft(review, draft, saved.disclosure);
  if (verdict.outcome !== "LOLOS") throw new PackageError(`Validator menolak: ${[...verdict.prerequisites, ...verdict.findings.map(f => f.message)].join("; ")}`, 409);
  if (!equal(saved.verdict, verdict)) throw new PackageError("Vonis tersimpan berbeda dari perhitungan ulang.", 409);
  return saved;
}

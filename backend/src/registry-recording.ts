import { verifyPublishablePackage } from "./report-endorsement";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { hashTypedData, keccak256, toHex, type Hex } from "viem";
import { evidenceTypedData, type RecordingIntent } from "../../shared/report-registry";
import type { RegistryChain } from "./registry-chain";
import type { RegistryStore } from "./registry-store";
import type { WorkspaceRuntime } from "./workspace-runtime";
import { createReportPackages } from "./report-package";
import { attestationsForVersion, publicationConflict, readOfficialLine, successionState } from "./report-history";
import { createRelay } from "./registry-relay";

export class RecordingError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 503) { super(message); }
}
const prepareInput = z.object({ retryId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), digest: z.string().regex(/^0x[0-9a-f]{64}$/) }).strict();
const submitInput = z.object({ signature: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/).max(20002) }).strict();
export type RegistryRuntime = { store: RegistryStore; chain: RegistryChain; endorsement?: import("./report-endorsement").ReportEndorsement };
export function createRecording(runtime: WorkspaceRuntime, registry: RegistryRuntime, institution: string, preparation: string, packageId: string, publication = false) {
  const { store, chain } = registry;
  const action = keccak256(toHex(publication ? "PUBLISH_REPORT" : "RECORD_EVIDENCE"));
  const packages = createReportPackages(runtime.evidence!, runtime.files, runtime.reportAmilRules);
  const relay = createRelay(store, chain, institution, (message, code) => new RecordingError(message, code));
  async function readIntent(id: string) {
    const intent = await store.get(institution, id);
    if (!intent || intent.authorization.packageId !== packageId || intent.authorization.action !== action) throw new RecordingError("Percobaan pencatatan tidak ditemukan.", 404);
    if (JSON.stringify(intent.domain) !== JSON.stringify(chain.domain)) throw new RecordingError("Deployment berbeda dari pengesahan yang ditinjau.", 409);
    return intent;
  }
  const status = async (id: string) => relay.status(await readIntent(id));
  /** Publication may only extend the report's official line; the registry, not the caller, says what that line is. */
  async function assertSuccession(saved: { id: string; reportId: string; version: string; predecessor: string | null }) {
    const conflict = publicationConflict(await successionState(chain, institution, saved), saved);
    if (conflict) throw new RecordingError(conflict, 409);
  }
  return {
    status,
    list: async () => Promise.all((await store.list(institution, packageId)).filter(intent => intent.authorization.action === action).map(intent => status(intent.id))),
    history: async () => readOfficialLine(runtime, registry, institution, (await packages.read(institution, preparation, packageId)).reportId),
    async version() {
      const saved = await packages.read(institution, preparation, packageId);
      const intents = await Promise.all((await store.list(institution, packageId)).filter(i => i.authorization.action === action).map(i => status(i.id)));
      const confirmed = intents.find(i => i.observation.state === "CONFIRMED");
      const accepted = await chain.publishedVersion(institution, saved.reportId, saved.version);
      const published = !!confirmed && accepted.institution.digest === saved.digest && accepted.institution.packageId === packageId;
      const official = await chain.officialLine(institution, saved.reportId);
      return { institutionId: institution, reportId: saved.reportId, version: saved.version, packageId, digest: saved.digest,
        predecessor: saved.predecessor ?? null, correctionReason: saved.correctionReason ?? null,
        publication: published ? "PUBLISHED" : "NOT_PUBLISHED",
        // A superseded version stays readable through its own identity; a losing package is never an official version.
        versionState: !published ? "BUKAN_VERSI_RESMI" : official.packageId === packageId ? "VERSI_RESMI_TERKINI" : "DIGANTIKAN_KOREKSI",
        officialVersion: official.version || null, officialPackageId: official.packageId || null,
        auditor: "NOT_EXAMINED",
        attestations: await attestationsForVersion(chain, { institutionId: institution, reportId: saved.reportId, version: saved.version, packageId, digest: saved.digest }),
        anchor: confirmed ?? null, trust: "Kontrak memverifikasi pernyataan layanan validator. Perhitungan bergantung pada layanan dan sumber bank; bukan komputasi trustless." };
    },
    async prepare(account: Hex, raw: unknown) {
      const parsed = prepareInput.safeParse(raw);
      if (!parsed.success) throw new RecordingError("Identitas retry atau digest tidak sah.", 400);
      const input = parsed.data;
      if (publication && ["version", "history"].includes(input.retryId)) throw new RecordingError("Identitas retry ini dicadangkan untuk pembacaan versi dan riwayat.", 400);
      const saved = await packages.read(institution, preparation, packageId);
      if (saved.status !== "FROZEN" || saved.digest !== input.digest) throw new RecordingError("Tinjau paket beku dengan digest yang sama sebelum mengesahkan.", 409);
      const existing = await store.get(institution, input.retryId);
      const sameReview = (intent: RecordingIntent) => {
        if (intent.authorization.packageId !== packageId || intent.authorization.digest !== input.digest || intent.authorization.signer.toLowerCase() !== account.toLowerCase()) throw new RecordingError("Identitas retry telah terikat pada pengesahan berbeda.", 409);
        return intent;
      };
      if (existing) return sameReview(await readIntent(input.retryId));
      if (publication) {
        await assertSuccession(saved);
        if (await chain.publishedPackageVersion(institution, packageId)) throw new RecordingError("Paket ini sudah menjadi versi resmi. Koreksi memerlukan paket dan pengesahan baru.", 409);
      }
      const authority = await chain.authority(institution, account);
      if (!authority.active) throw new RecordingError("Akun tidak memiliki kewenangan pengesah lembaga pada registry.", 403);
      const authorization = {
        action, institutionId: institution, reportId: saved.reportId, version: saved.version,
        packageId, predecessor: saved.predecessor ?? "", digest: saved.digest as Hex, policy: saved.policy.id, outcome: saved.verdict.outcome,
        signer: account, authorityEpoch: authority.epoch, nonce: toHex(randomBytes(32)), deadline: String(runtime.now() + 600),
      };
      const intent: RecordingIntent = {
        id: input.retryId, domain: chain.domain, authorization, authorizationDigest: hashTypedData(evidenceTypedData(chain.domain, authorization)),
        accountKind: authority.accountKind, observation: relay.prepared(),
      };
      if (publication) {
        if (!registry.endorsement) throw new RecordingError("Layanan validator belum tersedia. Paket dan temuan tetap tersimpan.", 503);
        intent.validator = await registry.endorsement.endorse(runtime, chain, institution, preparation, packageId, authorization);
      }
      return sameReview(await store.create(intent));
    },
    submit,
    async retry(account: Hex, id: string, raw: unknown) {
      if (!z.object({}).strict().safeParse(raw).success) throw new RecordingError("Retry tidak menerima parameter baru.", 400);
      const intent = await readIntent(id);
      const attempt = await store.attempt(institution, id);
      if (!attempt) throw new RecordingError("Belum ada transaksi tersimpan. Tandatangani pengesahan yang telah ditinjau.", 409);
      if (intent.authorization.signer.toLowerCase() !== account.toLowerCase()) throw new RecordingError("Pengesah berbeda dari akun sesi.", 403);
      return submit(account, id, { signature: attempt.signature });
    },
  };
  async function submit(account: Hex, id: string, raw: unknown) {
    const input = submitInput.safeParse(raw);
    if (!input.success) throw new RecordingError("Hanya tanda tangan pengesahan yang dapat dikirim.", 400);
    const signature = input.data.signature.toLowerCase() as Hex;
    const intent = await readIntent(id);
    if (intent.authorization.signer.toLowerCase() !== account.toLowerCase()) throw new RecordingError("Pengesah berbeda dari akun sesi.", 403);
    const done = await relay.settled(intent, signature);
    if (done) return done;
    if (publication) await assertSuccession(await verifyPublishablePackage(runtime, institution, preparation, packageId));
    try { await chain.validate(intent, signature); }
    catch { throw new RecordingError("Pengesahan ditolak atau kewenangan registry tidak dapat diperiksa. Periksa akun, masa berlaku, dan paket.", 409); }
    return relay.send(intent, signature);
  }
}

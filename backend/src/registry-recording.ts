import { randomBytes } from "node:crypto";
import { z } from "zod";
import { hashTypedData, keccak256, toHex, type Hex } from "viem";
import { evidenceTypedData, type RecordingIntent } from "../../shared/report-registry";
import type { RegistryChain } from "./registry-chain";
import type { RegistryStore } from "./registry-store";
import type { WorkspaceRuntime } from "./workspace-runtime";
import { createReportPackages } from "./report-package";

export class RecordingError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 503) { super(message); }
}
const prepareInput = z.object({ retryId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), digest: z.string().regex(/^0x[0-9a-f]{64}$/) }).strict();
const submitInput = z.object({ signature: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/).max(20002) }).strict();
export type RegistryRuntime = { store: RegistryStore; chain: RegistryChain };
export function createRecording(runtime: WorkspaceRuntime, registry: RegistryRuntime, institution: string, preparation: string, packageId: string) {
  const { store, chain } = registry;
  const packages = createReportPackages(runtime.evidence!, runtime.files, runtime.reportAmilRules);
  async function readIntent(id: string) {
    const intent = await store.get(institution, id);
    if (!intent || intent.authorization.packageId !== packageId) throw new RecordingError("Percobaan pencatatan tidak ditemukan.", 404);
    if (JSON.stringify(intent.domain) !== JSON.stringify(chain.domain)) throw new RecordingError("Deployment berbeda dari pengesahan yang ditinjau.", 409);
    return intent;
  }
  async function status(id: string) {
    const intent = await readIntent(id);
    const attempt = await store.attempt(institution, id);
    if (!attempt) return intent;
    return store.observe(intent, await chain.observe(intent, attempt.hash), attempt.hash);
  }
  return {
    status,
    list: async () => Promise.all((await store.list(institution, packageId)).map(intent => status(intent.id))),
    async prepare(account: Hex, raw: unknown) {
      const parsed = prepareInput.safeParse(raw);
      if (!parsed.success) throw new RecordingError("Identitas retry atau digest tidak sah.", 400);
      const input = parsed.data;
      const saved = await packages.read(institution, preparation, packageId);
      if (saved.status !== "FROZEN" || saved.digest !== input.digest) throw new RecordingError("Tinjau paket beku dengan digest yang sama sebelum mengesahkan.", 409);
      const existing = await store.get(institution, input.retryId);
      const sameReview = (intent: RecordingIntent) => {
        if (intent.authorization.packageId !== packageId || intent.authorization.digest !== input.digest || intent.authorization.signer.toLowerCase() !== account.toLowerCase()) throw new RecordingError("Identitas retry telah terikat pada pengesahan berbeda.", 409);
        return intent;
      };
      if (existing) return sameReview(await readIntent(input.retryId));
      const authority = await chain.authority(institution, account);
      if (!authority.active) throw new RecordingError("Akun tidak memiliki kewenangan pengesah lembaga pada registry.", 403);
      const authorization = {
        action: keccak256(toHex("RECORD_EVIDENCE")), institutionId: institution, reportId: saved.reportId, version: saved.version,
        packageId, predecessor: saved.predecessor ?? "", digest: saved.digest as Hex, policy: saved.policy.id, outcome: saved.verdict.outcome,
        signer: account, authorityEpoch: authority.epoch, nonce: toHex(randomBytes(32)), deadline: String(runtime.now() + 600),
      };
      const intent: RecordingIntent = {
        id: input.retryId, domain: chain.domain, authorization, authorizationDigest: hashTypedData(evidenceTypedData(chain.domain, authorization)),
        accountKind: authority.accountKind, observation: { state: "PREPARED", confirmations: 0, requiredConfirmations: chain.requiredConfirmations, confirmationPolicy: chain.confirmationPolicy },
      };
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
    let attempt = await store.attempt(institution, id);
    if (attempt) {
      if (attempt.signature !== signature) throw new RecordingError("Retry harus membawa tanda tangan yang sama.", 409);
      const current = await status(id);
      if (current.observation.state !== "SUBMITTED" && current.observation.state !== "NONCANONICAL") return current;
    }
    try { await chain.validate(intent, signature); }
    catch { throw new RecordingError("Pengesahan ditolak atau kewenangan registry tidak dapat diperiksa. Periksa akun, masa berlaku, dan paket.", 409); }
    if (!attempt) attempt = await store.reserve(institution, id, chain.deployment, await chain.pendingNonce(), nonce => chain.build(intent, signature, nonce));
    if (attempt.signature !== signature) throw new RecordingError("Retry berbeda dari percobaan tersimpan.", 409);
    // Broadcast ambiguity is recoverable: exact signed bytes and hash are already durable.
    await chain.broadcast(attempt);
    return store.observe(intent, { state: "SUBMITTED", confirmations: 0, requiredConfirmations: chain.requiredConfirmations, confirmationPolicy: chain.confirmationPolicy }, attempt.hash);
  }
}

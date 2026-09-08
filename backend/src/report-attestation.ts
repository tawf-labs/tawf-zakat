/**
 * Auditor examination notes over one published version (Spec #68, ticket #76).
 *
 * An attestation is an opinion about a version, recorded beside it - never a
 * change to it. Nothing here touches the package figures, the institution's
 * endorsement or the validator's verdict, and a technical auditor role is an
 * engagement scope recorded by the institution being examined, not evidence of
 * independence or of a compliance certification.
 *
 * Two rules shape the flow. The conclusion is drawn from a fixed vocabulary
 * that includes the unfavourable ones, so a caller cannot invent a reassuring
 * label. And the examination evidence is stored and committed to before
 * anything is signed, so an upload that fails leaves the version unattested
 * rather than attested with nothing behind it.
 */
import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import { toHex, keccak256, type Hex } from "viem";
import { ATTESTATION_CONCLUSIONS, ATTESTATION_SCOPES, NO_ATTESTATION, type AttestationEvidenceFile, type AttestationIntent, type AttestationStatement } from "../../shared/report-registry";
import { canonicalJson, commitmentFor, newCommitmentSalt, sha256Hex } from "./evidence-snapshot";
import { MAX_EVIDENCE_FILE_BYTES } from "./evidence-files";
import { createReportPackages } from "./report-package";
import { createRelay } from "./registry-relay";
import type { RegistryRuntime } from "./registry-recording";
import type { WorkspaceRuntime } from "./workspace-runtime";

export class AttestationError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 503) { super(message); }
}

const prepareInput = z.object({
  retryId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  packageDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  scope: z.enum(ATTESTATION_SCOPES),
  conclusion: z.enum(ATTESTATION_CONCLUSIONS),
  predecessor: z.string().regex(/^0x[0-9a-f]{64}$/).nullable().default(null),
  evidence: z.array(z.object({
    fileName: z.string().trim().min(1).max(200),
    mimeType: z.string().trim().min(1).max(120),
    contentBase64: z.string().min(1),
  }).strict()).min(1).max(20),
}).strict();
const submitInput = z.object({ signature: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/).max(20002) }).strict();

export function createAttestation(runtime: WorkspaceRuntime, registry: RegistryRuntime, institution: string, preparation: string, packageId: string) {
  const { store, chain } = registry;
  const action = keccak256(toHex("ATTEST_REPORT"));
  const packages = createReportPackages(runtime.evidence!, runtime.files, runtime.reportAmilRules);
  const relay = createRelay(store, chain, institution, (message, code) => new AttestationError(message, code));

  /**
   * One prepared attestation, readable only by the auditor whose statement it is.
   *
   * Until it is signed and accepted, a draft conclusion is that auditor's own
   * working position. Workspace membership opens this page; it does not open
   * other people's unsigned opinions or the names of their working papers. What
   * everyone may read is the accepted record, and that comes from the registry.
   */
  async function readIntent(account: Hex, id: string) {
    const intent = await store.get(institution, id, "ATTESTATION");
    if (!intent || intent.statement.packageId !== packageId
      || intent.statement.auditor.toLowerCase() !== account.toLowerCase()) throw new AttestationError("Percobaan atestasi tidak ditemukan.", 404);
    if (JSON.stringify(intent.domain) !== JSON.stringify(chain.domain)) throw new AttestationError("Deployment berbeda dari atestasi yang ditinjau.", 409);
    return intent;
  }
  const status = async (account: Hex, id: string) => relay.status(await readIntent(account, id));

  /** The version identity this package was published under; an unpublished package has none. */
  async function publishedVersion() {
    const saved = await packages.read(institution, preparation, packageId);
    const version = await chain.publishedPackageVersion(institution, packageId);
    if (!version) throw new AttestationError("Paket ini belum menjadi versi terbit. Atestasi selalu mengacu pada identitas versi.", 409);
    return { saved, version };
  }

  return {
    status,
    async download(account: Hex, id: string, fileId: string) {
      const intent = await readIntent(account, id);
      const file = intent.evidence.files.find(file => file.id === fileId);
      const storageRef = intent.evidence.storageRefs?.[fileId];
      if (!file || !storageRef) throw new AttestationError("Berkas pemeriksaan tidak ditemukan.", 404);
      if (!runtime.files) throw new AttestationError("Penyimpanan bukti pemeriksaan belum tersedia.", 503);
      let bytes: Uint8Array | null;
      try { bytes = await runtime.files.get(storageRef); }
      catch { throw new AttestationError("Berkas pemeriksaan tidak dapat dibaca.", 503); }
      if (!bytes) throw new AttestationError("Berkas pemeriksaan tidak ditemukan.", 404);
      if (bytes.byteLength !== file.sizeBytes || sha256Hex(bytes) !== file.contentSha256) {
        throw new AttestationError("Isi berkas tidak cocok dengan commitment bukti pemeriksaan.", 409);
      }
      return { bytes, fileName: file.fileName };
    },
    list: async (account: Hex) => Promise.all((await store.list(institution, packageId, "ATTESTATION"))
      .filter(intent => intent.statement.auditor.toLowerCase() === account.toLowerCase())
      .map(intent => status(account, intent.id))),
    async prepare(account: Hex, raw: unknown) {
      const sameReview = (intent: AttestationIntent) => {
        if (intent.statement.packageId !== packageId || intent.statement.auditor.toLowerCase() !== account.toLowerCase()) {
          throw new AttestationError("Identitas retry telah terikat pada atestasi berbeda.", 409);
        }
        return intent;
      };
      const parsed = prepareInput.safeParse(raw);
      if (!parsed.success) throw new AttestationError("Lingkup, kesimpulan, bukti pemeriksaan atau identitas retry tidak sah.", 400);
      const input = parsed.data;
      const existing = await store.get(institution, input.retryId, "ATTESTATION");
      if (existing) {
        const reviewed = sameReview(await status(account, input.retryId));
        if (reviewed.signingAuthority === "STALE" || reviewed.signingAuthority === "UNAVAILABLE") throw new AttestationError("Kewenangan berubah atau tidak dapat diperiksa. Mulai tinjauan atestasi baru.", 409);
        return reviewed;
      }
      if (await store.takenByOtherKind(institution, input.retryId, "ATTESTATION")) throw new AttestationError("Identitas retry ini sudah dipakai tindakan registry lain.", 409);

      const { saved, version } = await publishedVersion();
      if (saved.digest !== input.packageDigest) throw new AttestationError("Tinjau identitas dan digest versi yang sama sebelum menandatangani atestasi.", 409);
      const authority = await chain.auditorAuthority(institution, account);
      if (!authority.active) throw new AttestationError("Akun tidak memiliki kewenangan auditor pada lembaga ini. Keanggotaan pembaca tidak memberi hak atestasi.", 403);
      if (input.predecessor) {
        const previous = await chain.attestationRecord(input.predecessor as Hex);
        if (previous.statement.auditor.toLowerCase() !== account.toLowerCase()
          || previous.statement.packageId !== packageId || previous.statement.version !== version) {
          throw new AttestationError("Tindak lanjut hanya dapat menyusul catatan auditor ini sendiri pada versi yang sama.", 409);
        }
      }

      // Evidence is validated in full, then stored, then committed to - all before anything is signed.
      if (!runtime.files) throw new AttestationError("Penyimpanan bukti pemeriksaan belum tersedia; atestasi tidak disiapkan.", 503);
      const salt = newCommitmentSalt() as Hex;
      const accepted = input.evidence.map(file => {
        const bytes = decode(file.contentBase64);
        if (bytes.byteLength > MAX_EVIDENCE_FILE_BYTES) throw new AttestationError(`Berkas ${file.fileName} melebihi batas ukuran bukti pemeriksaan.`, 400);
        return { ...file, bytes, id: `attestation-${randomUUID()}` };
      });
      const files: AttestationEvidenceFile[] = [];
      const storageRefs: Record<string, string> = {};
      for (const file of accepted) {
        try {
          const stored = await runtime.files.put({ institutionId: institution, preparationId: preparation, fileId: file.id, bytes: file.bytes });
          storageRefs[file.id] = stored.storageRef;
        }
        catch { throw new AttestationError(`Bukti pemeriksaan ${file.fileName} gagal disimpan; atestasi tidak disiapkan.`, 409); }
        files.push({ id: file.id, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.bytes.byteLength, contentSha256: sha256Hex(file.bytes) });
      }
      const evidenceCommitment = commitmentFor(new TextEncoder().encode(canonicalJson(files)), salt) as Hex;

      const statement: AttestationStatement = {
        action, institutionId: institution, reportId: saved.reportId, version, packageId,
        packageDigest: saved.digest as Hex, scope: input.scope, conclusion: input.conclusion,
        evidenceCommitment, predecessor: (input.predecessor ?? NO_ATTESTATION) as Hex,
        auditor: account, authorityEpoch: authority.epoch, nonce: toHex(randomBytes(32)),
        deadline: String(runtime.now() + 600),
      };
      const intent: AttestationIntent = {
        id: input.retryId, domain: chain.domain, statement,
        statementDigest: await chain.attestationDigest(statement),
        accountKind: authority.accountKind, observation: relay.prepared(),
        evidence: { commitmentScheme: "HMAC-SHA256", salt, files, storageRefs },
      };
      return sameReview(await store.create(intent));
    },
    submit,
    async retry(account: Hex, id: string, raw: unknown) {
      if (!z.object({}).strict().safeParse(raw).success) throw new AttestationError("Retry tidak menerima parameter baru.", 400);
      await readIntent(account, id);
      const attempt = await store.attempt(institution, id);
      if (!attempt) throw new AttestationError("Belum ada transaksi tersimpan. Tandatangani atestasi yang telah ditinjau.", 409);
      return submit(account, id, { signature: attempt.signature });
    },
  };

  async function submit(account: Hex, id: string, raw: unknown) {
    const input = submitInput.safeParse(raw);
    if (!input.success) throw new AttestationError("Hanya tanda tangan atestasi yang dapat dikirim.", 400);
    const signature = input.data.signature.toLowerCase() as Hex;
    const intent = await readIntent(account, id);
    const done = await relay.settled(intent, signature);
    if (done) return done;
    // The version identity is rechecked at execution; a relayer cannot substitute one.
    const { saved } = await publishedVersion();
    if (saved.digest !== intent.statement.packageDigest) throw new AttestationError("Digest versi berubah sejak atestasi disiapkan. Tinjau ulang.", 409);
    try { await chain.validate(intent, signature); }
    catch { throw new AttestationError("Atestasi ditolak atau kewenangan auditor tidak dapat diperiksa. Periksa akun, masa berlaku, dan versi.", 409); }
    return relay.send(intent, signature);
  }
}
export type ReportAttestation = ReturnType<typeof createAttestation>;

/** Keep deployment locators out of every reader-facing representation. */
export function attestationResponse(intent: AttestationIntent) {
  const { storageRefs: _storageRefs, ...evidence } = intent.evidence;
  return { ...intent, evidence };
}

const decode = (value: string): Uint8Array => {
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value.replace(/\s/g, "")) throw new AttestationError("Bukti pemeriksaan bukan base64 yang sah.", 400);
  return new Uint8Array(bytes);
};

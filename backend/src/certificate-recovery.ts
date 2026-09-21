/**
 * Custody recovery of distribution certificates (#113), by replacement issuance.
 *
 * Tokens are locked and nothing can move them, so "recovery" never transfers a token. When the
 * institution's resolved custodian is no longer the holder of the official head (its administrator
 * designated a new custodian, or the registry administrator was rotated), an authorized signatory
 * endorses a replacement token to that custodian. Issuer, content commitment, version and the old
 * token are untouched. The target is never chosen here: it is read from the chain, so this service
 * and its operators cannot redirect a certificate to an arbitrary address.
 */
import { randomBytes } from "node:crypto";
import { hashTypedData, keccak256, toHex, type Hex } from "viem";
import { recoveryTypedData, RECOVER_CUSTODY, type CustodyRecovery, type CustodyRecoveryIntent } from "../../shared/certificate-nft";
import type { CertificateChain } from "./certificate-chain";
import type { CertificateStore } from "./certificate-store";
import { CertificateError } from "./certificate-issuance";

const REF_MIN = 3;
const REF_MAX = 200;
const ZERO = "0x0000000000000000000000000000000000000000";

export function createCertificateRecovery(runtime: { now(): number }, registry: { store: CertificateStore; chain: CertificateChain }, institution: string) {
  const { store, chain } = registry;
  const action = keccak256(toHex(RECOVER_CUSTODY));
  const observation = (state: CustodyRecoveryIntent["observation"]["state"]) =>
    ({ state, confirmations: 0, requiredConfirmations: chain.requiredConfirmations, confirmationPolicy: chain.confirmationPolicy });

  async function read(id: string) {
    const intent = await store.getRecovery(institution, id);
    if (!intent) throw new CertificateError("Pemulihan pemegang tidak ditemukan.", 404);
    if (intent.domain.name !== chain.domain.name || intent.domain.version !== chain.domain.version
      || intent.domain.chainId !== chain.domain.chainId
      || intent.domain.verifyingContract.toLowerCase() !== chain.domain.verifyingContract.toLowerCase()) {
      throw new CertificateError("Deployment berbeda dari yang ditinjau.", 409);
    }
    if (hashTypedData(recoveryTypedData(intent.domain, intent.recovery)) !== intent.recoveryDigest
      || intent.recovery.institutionId !== institution || intent.recovery.certificateId !== intent.certificateId
      || intent.recovery.version !== intent.version || keccak256(toHex(intent.decisionRef)) !== intent.recovery.basisDigest) {
      throw new CertificateError("Catatan pemulihan tidak cocok dengan pengesahan. Tindakan ditahan.", 503);
    }
    // previousCustodian is display metadata, not a signed field. Verify it against the immutable
    // holder of the signed source token, including when reading a historical receipt.
    const source = (await chain.custodyTokens(BigInt(intent.recovery.previousTokenId)))
      .find((token) => String(token.tokenId) === intent.recovery.previousTokenId);
    if (!source || source.holder.toLowerCase() !== intent.previousCustodian.toLowerCase()) {
      throw new CertificateError("Pemegang asal tidak cocok dengan token yang disahkan. Tindakan ditahan.", 503);
    }
    return intent;
  }

  /** A live endorsement binds the deadline, all authority/designation epochs, official version,
   * exact source token and holder. Matching addresses after rotation cannot revive it. */
  async function stillValid(intent: CustodyRecoveryIntent): Promise<"CURRENT" | "STALE" | "UNAVAILABLE"> {
    try {
      const r = intent.recovery;
      if (BigInt(r.deadline) < BigInt(runtime.now())) return "STALE";
      const epochs = await chain.recoveryEpochs(institution);
      if (String(epochs.custodyEpoch) !== r.custodyEpoch || String(epochs.administratorEpoch) !== r.administratorEpoch) return "STALE";
      const authority = await chain.authority(institution, r.signer);
      if (!authority.active || String(authority.epoch) !== r.authorityEpoch) return "STALE";
      if ((await chain.resolvedCustodian(institution)).toLowerCase() !== r.newCustodian.toLowerCase()) return "STALE";
      if ((await chain.latestVersion(institution, r.certificateId)) !== r.version) return "STALE";
      const token = await chain.tokenOf(institution, r.certificateId, r.version);
      if (token === 0n || String(token) !== r.previousTokenId) return "STALE";
      const active = (await chain.custodyTokens(token)).find((t) => t.status === "ACTIVE");
      if (!active || String(active.tokenId) !== r.previousTokenId || active.holder.toLowerCase() !== intent.previousCustodian.toLowerCase()) return "STALE";
      return active.holder.toLowerCase() === r.newCustodian.toLowerCase() ? "STALE" : "CURRENT";
    } catch { return "UNAVAILABLE"; }
  }

  async function status(id: string): Promise<CustodyRecoveryIntent> {
    const intent = await read(id);
    const attempt = await store.attempt(institution, id);
    const current = attempt ? await store.observeRecovery(intent, institution, await chain.observeRecovery(intent, attempt.hash), attempt.hash) : intent;
    if (["CONFIRMED", "INCLUDED"].includes(current.observation.state)) return { ...current, signingAuthority: "HISTORICAL" };
    if (current.voided) return { ...current, signingAuthority: "STALE" };
    const validity = await stillValid(current);
    if (validity === "STALE") {
      // Remember it: matching the chain again later does not make an old endorsement live again.
      const voided = { ...current, voided: true as const };
      await store.saveRecovery(institution, voided);
      return { ...voided, signingAuthority: "STALE" };
    }
    return { ...current, signingAuthority: validity };
  }

  async function send(intent: CustodyRecoveryIntent, signature: Hex) {
    let attempt = await store.attempt(institution, intent.id);
    if (!attempt) {
      attempt = await store.reserve(institution, intent.id, chain.deployment, await chain.pendingNonce(), chain.budget, (nonce) => chain.buildRecovery(intent, signature, nonce));
    }
    if (attempt.signature !== signature) throw new CertificateError("Retry berbeda dari percobaan tersimpan.", 409);
    // Broadcast ambiguity is recoverable: the exact signed bytes are already durable.
    await chain.broadcast(attempt);
    return store.observeRecovery(intent, institution, observation("SUBMITTED"), attempt.hash);
  }

  return {
    status,
    async list(certificateId: string) {
      return Promise.all((await store.recoveries(institution, certificateId)).map((r) => status(r.id)));
    },

    async prepare(account: Hex, certificateId: string, decisionRefInput: unknown) {
      const decisionRef = typeof decisionRefInput === "string" ? decisionRefInput.trim() : "";
      if (decisionRef.length < REF_MIN || decisionRef.length > REF_MAX || /\p{Cc}/u.test(decisionRef)) {
        throw new CertificateError(`Dasar keputusan lembaga wajib dicantumkan (${REF_MIN}-${REF_MAX} karakter, mis. nomor surat keputusan).`, 400);
      }
      if (!(await store.line(institution, certificateId)).length) throw new CertificateError("Sertifikat tidak ditemukan.", 404);
      const authority = await chain.authority(institution, account);
      if (!authority.active) throw new CertificateError("Akun tidak memiliki kewenangan pengesah lembaga pada registry.", 403);

      const version = await chain.latestVersion(institution, certificateId);
      const tokenId = version ? await chain.tokenOf(institution, certificateId, version) : 0n;
      if (!version || tokenId === 0n) throw new CertificateError("Sertifikat belum memiliki versi resmi yang terbit di chain.", 409);
      const resolved = await chain.resolvedCustodian(institution);
      if (resolved === ZERO) throw new CertificateError("Pengendali institusi belum ditetapkan pada kontrak.", 409);
      const active = (await chain.custodyTokens(tokenId)).find((t) => t.status === "ACTIVE")!;
      if (active.holder.toLowerCase() === resolved.toLowerCase()) {
        throw new CertificateError("Pemegang sertifikat sudah sama dengan pengendali institusi saat ini. Tidak ada yang perlu dipulihkan.", 409);
      }

      const existing = await store.recoveries(institution, certificateId);
      for (const candidate of existing.filter((r) => r.version === version && r.recovery.newCustodian.toLowerCase() === resolved.toLowerCase())) {
        const reviewed = await status(candidate.id);
        const usable = reviewed.signingAuthority === "CURRENT" && !["REVERTED", "INVALID_EVENT"].includes(reviewed.observation.state);
        if (!usable) continue;
        if (reviewed.recovery.signer.toLowerCase() !== account.toLowerCase() || reviewed.decisionRef !== decisionRef) {
          throw new CertificateError("Sudah ada pemulihan yang disiapkan untuk pengendali ini dengan dasar atau pengesah berbeda.", 409);
        }
        return reviewed;
      }

      const epochs = await chain.recoveryEpochs(institution);
      const recovery: CustodyRecovery = {
        action, institutionId: institution, certificateId, version, newCustodian: resolved,
        previousTokenId: String(tokenId), custodyEpoch: String(epochs.custodyEpoch), administratorEpoch: String(epochs.administratorEpoch),
        basisDigest: keccak256(toHex(decisionRef)), signer: account, authorityEpoch: String(authority.epoch),
        nonce: toHex(randomBytes(32)), deadline: String(runtime.now() + 600),
      };
      const id = `rcv-${certificateId}-v${version}-${existing.length + 1}`;
      const intent: CustodyRecoveryIntent = {
        id, certificateId, version, domain: chain.domain, recovery,
        recoveryDigest: hashTypedData(recoveryTypedData(chain.domain, recovery)), decisionRef,
        previousCustodian: active.holder, accountKind: authority.accountKind, observation: observation("PREPARED"),
      };
      const stored = await store.createRecovery(intent, institution, runtime.now());
      if (stored.recoveryDigest !== intent.recoveryDigest) {
        throw new CertificateError("Pemulihan telah disiapkan oleh permintaan lain. Muat ulang riwayat sebelum meninjau kembali.", 409);
      }
      return status(id);
    },

    async submit(account: Hex, id: string, signature: Hex) {
      const intent = await read(id);
      if (intent.recovery.signer.toLowerCase() !== account.toLowerCase()) throw new CertificateError("Pengesah berbeda dari akun sesi.", 403);
      const attempt = await store.attempt(institution, id);
      if (attempt && attempt.signature !== signature) throw new CertificateError("Retry harus membawa tanda tangan yang sama.", 409);
      const current = await status(id);
      if (attempt && !["SUBMITTED", "NONCANONICAL", "PREPARED"].includes(current.observation.state)) return current;
      // The mandate, designated custodian or official version may have changed since it was signed;
      // a late wallet response or a retry must not revive that context.
      if (current.signingAuthority === "UNAVAILABLE") {
        throw new CertificateError("Keabsahan pemulihan belum dapat diperiksa. Periksa status sebelum mengulang.", 503);
      }
      if (current.signingAuthority !== "CURRENT") {
        throw new CertificateError("Pemulihan tidak lagi sah: masa berlaku habis atau kewenangan, pengendali institusi, token asal, atau versi resmi berubah. Mulai persiapan baru.", 409);
      }
      try { await chain.validateRecovery(intent, signature); }
      catch { throw new CertificateError("Pengesahan pemulihan ditolak oleh kontrak. Periksa akun, masa berlaku dan pengendali institusi.", 409); }
      return send(intent, signature);
    },

    async retry(account: Hex, id: string) {
      const intent = await read(id);
      const attempt = await store.attempt(institution, id);
      if (!attempt) throw new CertificateError("Belum ada transaksi tersimpan. Tandatangani pengesahan pemulihan yang telah ditinjau.", 409);
      if (intent.recovery.signer.toLowerCase() !== account.toLowerCase()) throw new CertificateError("Pengesah berbeda dari akun sesi.", 403);
      return this.submit(account, id, attempt.signature);
    },
  };
}
export type CertificateRecovery = ReturnType<typeof createCertificateRecovery>;

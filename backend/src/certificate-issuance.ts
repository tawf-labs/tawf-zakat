/**
 * Distribution-stage certificate issuance (#111). Mirrors `registry-recording.ts`'s
 * prepare/submit/retry shape against the separate certificate contract and store, so an
 * officer's certificate-issuance signature is never checked against, or reusable as, a
 * report-registry signature.
 */
import { randomBytes } from "node:crypto";
import { hashTypedData, keccak256, toHex, type Hex } from "viem";
import {
  certificationTypedData, ISSUE_CERTIFICATE,
  type CertificateIssuanceIntent, type Certification, type PublicCertificateSummary,
} from "../../shared/certificate-nft";
import type { CertificateChain } from "./certificate-chain";
import type { CertificateStore } from "./certificate-store";
import { createCertificateRelay } from "./certificate-relay";
import { freezeCertificateContent, parseCertificateContent, certificateCommitment, newCommitmentSalt, totalsOf, CERTIFICATE_CONTENT_FORMAT, CERTIFICATE_CONTENT_VERSION } from "./certificate-content";
import { canonicalJson } from "../../shared/canonical-json";
import type { ActivityStore } from "./activity-store";
import type { DisbursementStore } from "./disbursement-store";

export class CertificateError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 503) { super(message); }
}

export type CertificateRuntime = { store: CertificateStore; chain: CertificateChain };

export function createCertificateIssuance(
  runtime: { now(): number },
  registry: CertificateRuntime,
  activities: ActivityStore,
  disbursement: DisbursementStore,
  institution: string,
) {
  const { store, chain } = registry;
  const action = keccak256(toHex(ISSUE_CERTIFICATE));
  const relay = createCertificateRelay(store, chain, institution, (message, code) => new CertificateError(message, code));

  async function readIntent(id: string) {
    const intent = await store.get(institution, id);
    if (!intent) throw new CertificateError("Percobaan penerbitan sertifikat tidak ditemukan.", 404);
    if (JSON.stringify(intent.domain) !== JSON.stringify(chain.domain)) throw new CertificateError("Deployment berbeda dari yang ditinjau.", 409);
    await verifiedContent(intent);
    return intent;
  }
  // Verify the exact stored bytes before projecting totals or accepting an endorsement.
  // A real receipt is not evidence that the SQL snapshot has remained intact.
  async function verifiedContent(intent: CertificateIssuanceIntent) {
    const stored = await store.content(institution, intent.id);
    try {
      if (!stored) throw new Error("Missing content");
      const c = intent.certification;
      const digest = certificateCommitment(new TextEncoder().encode(stored.canonical), stored.salt);
      const content = parseCertificateContent(stored.canonical);
      if (digest !== c.digest || hashTypedData(certificationTypedData(intent.domain, c)) !== intent.certificationDigest
        || content.format !== CERTIFICATE_CONTENT_FORMAT || content.version !== CERTIFICATE_CONTENT_VERSION
        || content.institutionId !== institution || content.institutionId !== c.institutionId
        || content.activityId !== c.activityId || content.certificateId !== intent.id || content.certificateId !== c.certificateId
        || content.certificateVersion !== c.version || canonicalJson(content.totals) !== canonicalJson(totalsOf(content.realizations))) {
        throw new Error("Content binding mismatch");
      }
      return content;
    } catch {
      throw new CertificateError("Isi beku sertifikat tidak tersedia atau tidak cocok dengan commitment pengesahan. Verifikasi ditahan.", 503);
    }
  }
  const status = async (id: string) => relay.status(await readIntent(id));

  return {
    status,
    list: async (activityId?: string) => Promise.all((await store.list(institution, activityId)).map((intent) => status(intent.id))),

    async prepare(account: Hex, activityId: string, certificateId: string) {
      const activity = await activities.getActivity(institution, activityId, false);
      if (!activity) throw new CertificateError("Kegiatan penyaluran tidak ditemukan.", 404);
      const existing = await store.get(institution, certificateId);
      if (existing) {
        if (existing.certification.activityId !== activityId || existing.certification.signer.toLowerCase() !== account.toLowerCase()) {
          throw new CertificateError("Identitas sertifikat telah terikat pada persiapan berbeda.", 409);
        }
        const reviewed = await status(certificateId);
        if (reviewed.signingAuthority === "STALE" || reviewed.signingAuthority === "UNAVAILABLE") {
          throw new CertificateError("Kewenangan berubah atau tidak dapat diperiksa. Mulai persiapan baru dengan identitas sertifikat baru.", 409);
        }
        return reviewed;
      }
      const realizations = await disbursement.getProposalRealizations(institution, activity.proposalId);
      const frozenAt = runtime.now();
      const { content, canonical, bytes } = freezeCertificateContent({
        activity, activityId, certificateId, certificateVersion: "1", realizations, frozenAt,
      });
      if (content.realizations.length === 0) throw new CertificateError("Belum ada realisasi berbukti atau berkonfirmasi pada kegiatan ini.", 409);
      const salt = newCommitmentSalt();
      const digest = certificateCommitment(bytes, salt) as Hex;

      const authority = await chain.authority(institution, account);
      if (!authority.active) throw new CertificateError("Akun tidak memiliki kewenangan pengesah lembaga pada registry.", 403);

      const certification: Certification = {
        action, institutionId: institution, activityId, certificateId, version: "1", predecessor: "",
        digest, signer: account, authorityEpoch: authority.epoch, nonce: toHex(randomBytes(32)), deadline: String(runtime.now() + 600),
      };
      const intent: CertificateIssuanceIntent = {
        id: certificateId, domain: chain.domain, certification,
        certificationDigest: hashTypedData(certificationTypedData(chain.domain, certification)),
        accountKind: authority.accountKind, observation: relay.prepared(),
      };
      return store.create(intent, activityId, canonical, salt, frozenAt);
    },

    async submit(account: Hex, id: string, signature: Hex) {
      const intent = await readIntent(id);
      if (intent.certification.signer.toLowerCase() !== account.toLowerCase()) throw new CertificateError("Pengesah berbeda dari akun sesi.", 403);
      const done = await relay.settled(intent, signature);
      if (done) return done;
      try { await chain.validate(intent, signature); }
      catch { throw new CertificateError("Pengesahan ditolak atau kewenangan registry tidak dapat diperiksa. Periksa akun, masa berlaku dan mandat.", 409); }
      return relay.send(intent, signature);
    },

    async retry(account: Hex, id: string) {
      const intent = await readIntent(id);
      const attempt = await store.attempt(institution, id);
      if (!attempt) throw new CertificateError("Belum ada transaksi tersimpan. Tandatangani pengesahan yang telah ditinjau.", 409);
      if (intent.certification.signer.toLowerCase() !== account.toLowerCase()) throw new CertificateError("Pengesah berbeda dari akun sesi.", 403);
      return this.submit(account, id, attempt.signature);
    },

    /** So the officer's own preparation screen can show confirmed vs. disputed/unconfirmed before
     * signing (AC: an unconfirmed part must never read as final) without exposing the salt. */
    async contentTotals(certificateId: string) {
      return publicTotals((await verifiedContent(await readIntent(certificateId))).totals);
    },

    /** Allowlisted aggregate only: totals and chain proof, never a realization or beneficiary reference. */
    async publicSummary(certificateId: string): Promise<PublicCertificateSummary | null> {
      const intent = await store.get(institution, certificateId);
      if (!intent) return null;
      const tokenId = await chain.tokenOf(institution, certificateId, intent.certification.version);
      if (!tokenId) return null;
      const [{ issuer, contentDigest, custodian }, content] = await Promise.all([
        chain.publicView(tokenId),
        verifiedContent(intent),
      ]);
      if (contentDigest !== intent.certification.digest || issuer.toLowerCase() !== intent.certification.signer.toLowerCase()) {
        throw new CertificateError("Isi atau penerbit sertifikat tidak cocok dengan bukti chain. Verifikasi ditahan.", 503);
      }
      const observed = await status(certificateId);
      if (["CONFIRMED", "INCLUDED"].includes(observed.observation.state) && observed.observation.tokenId !== tokenId.toString()) {
        throw new CertificateError("Token sertifikat tidak cocok dengan receipt penerbitan.", 503);
      }
      const totals = publicTotals(content.totals);
      return {
        tokenId: tokenId.toString(), institutionId: institution, activityId: intent.certification.activityId,
        certificateId, version: intent.certification.version, issuer, contentDigest, custodian,
        observation: observed.observation, totals,
      };
    },
  };
}

function publicTotals(totals: PublicCertificateSummary["totals"]) {
  return { confirmedCount: totals.confirmedCount, disputedCount: totals.disputedCount,
    unconfirmedCount: totals.unconfirmedCount, totalRealizedIdr: totals.totalRealizedIdr };
}

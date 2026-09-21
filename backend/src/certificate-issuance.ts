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
import { freezeCertificateContent, parseCertificateContent, certificateCommitment, newCommitmentSalt } from "./certificate-content";
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
    return intent;
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
      const stored = await store.content(institution, certificateId);
      return stored ? totalsOfCanonical(stored.canonical) : null;
    },

    /** Allowlisted aggregate only: totals and chain proof, never a realization or beneficiary reference. */
    async publicSummary(certificateId: string): Promise<PublicCertificateSummary | null> {
      const intent = await store.get(institution, certificateId);
      if (!intent) return null;
      const tokenId = await chain.tokenOf(institution, certificateId, intent.certification.version);
      if (!tokenId) return null;
      const [{ issuer, contentDigest, custodian }, stored] = await Promise.all([
        chain.publicView(tokenId),
        store.content(institution, certificateId),
      ]);
      const observed = await status(certificateId);
      const totals = stored ? totalsOfCanonical(stored.canonical) : { confirmedCount: 0, disputedCount: 0, unconfirmedCount: 0, totalRealizedIdr: "0" };
      return {
        tokenId: tokenId.toString(), institutionId: institution, activityId: intent.certification.activityId,
        certificateId, version: intent.certification.version, issuer, contentDigest, custodian,
        observation: observed.observation, totals,
      };
    },
  };
}

function totalsOfCanonical(canonical: string) {
  const content = parseCertificateContent(canonical);
  return { confirmedCount: content.totals.confirmedCount, disputedCount: content.totals.disputedCount,
    unconfirmedCount: content.totals.unconfirmedCount, totalRealizedIdr: content.totals.totalRealizedIdr };
}

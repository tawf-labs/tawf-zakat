/**
 * Distribution-stage certificate issuance (#111). Mirrors `registry-recording.ts`'s
 * prepare/submit/retry shape against the separate certificate contract and store, so an
 * officer's certificate-issuance signature is never checked against, or reusable as, a
 * report-registry signature.
 */
import { randomBytes } from "node:crypto";
import { hashTypedData, keccak256, toHex, type Hex } from "viem";
import {
  certificationTypedData, isCorrectionReason, ISSUE_CERTIFICATE,
  type CertificateIssuanceIntent, type CertificateLineStatus, type CertificateLineVersion, type Certification,
  type CertificateMintState, type CorrectionReason, type PublicCertificateSummary, type PublicCertificateVersion, type ReplacementState,
} from "../../shared/certificate-nft";
import { assessScope, correctionJustified, replacementStateOf, validityOf, type ScopeAssessment } from "./certificate-lifecycle";
import type { CertificateContent } from "./certificate-content";
import type { RealizationRecord } from "./disbursement";
import { CertificatePreparationConflictError, SuccessorClaimedError } from "./certificate-store";
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

/** Version 1 keeps the bare certificate id; a successor is `<id>@<version>`. */
export const intentIdOf = (certificateId: string, version: string) => (version === "1" ? certificateId : `${certificateId}@${version}`);
const NOTE_MAX = 500;

type Entry = {
  intent: CertificateIssuanceIntent; observed: CertificateIssuanceIntent; endorsed: boolean;
  tokenId: bigint; content: CertificateContent;
  chain?: { issuer: Hex; contentDigest: Hex; custodian: Hex; successorTokenId: bigint; predecessorTokenId: bigint; originalTokenId: bigint };
};

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
        || content.activityId !== c.activityId || intent.id !== intentIdOf(c.certificateId, c.version) || content.certificateId !== c.certificateId
        || content.certificateVersion !== c.version || (content.correction?.predecessorVersion ?? "") !== c.predecessor || canonicalJson(content.totals) !== canonicalJson(totalsOf(content.realizations))) {
        throw new Error("Content binding mismatch");
      }
      return content;
    } catch {
      throw new CertificateError("Isi beku sertifikat tidak tersedia atau tidak cocok dengan commitment pengesahan. Verifikasi ditahan.", 503);
    }
  }
  const status = async (id: string) => relay.status(await readIntent(id));

  async function reviewedExisting(id: string) {
    const reviewed = await status(id);
    if (reviewed.signingAuthority === "STALE" || reviewed.signingAuthority === "UNAVAILABLE") {
      throw new CertificateError("Kewenangan berubah atau tidak dapat diperiksa. Mulai persiapan baru dengan identitas sertifikat baru.", 409);
    }
    return reviewed;
  }

  async function endorsementIntent(account: Hex, activityId: string, certificateId: string, version: string, predecessor: string,
    canonical: string, bytes: Uint8Array, frozenAt: number) {
    const salt = newCommitmentSalt();
    const digest = certificateCommitment(bytes, salt) as Hex;
    const authority = await chain.authority(institution, account);
    if (!authority.active) throw new CertificateError("Akun tidak memiliki kewenangan pengesah lembaga pada registry.", 403);
    const certification: Certification = {
      action, institutionId: institution, activityId, certificateId, version, predecessor,
      digest, signer: account, authorityEpoch: authority.epoch, nonce: toHex(randomBytes(32)), deadline: String(runtime.now() + 600),
    };
    const id = intentIdOf(certificateId, version);
    const intent: CertificateIssuanceIntent = {
      id, domain: chain.domain, certification,
      certificationDigest: hashTypedData(certificationTypedData(chain.domain, certification)),
      accountKind: authority.accountKind, observation: relay.prepared(),
    };
    try { return await store.create(intent, activityId, canonical, salt, frozenAt); }
    catch (error) {
      if (error instanceof CertificatePreparationConflictError) {
        throw new CertificateError("Versi sertifikat telah disiapkan oleh permintaan lain. Muat ulang riwayat dan ulangi persiapan.", 409);
      }
      throw error;
    }
  }

  /** Read every version of one line together with what the chain and the source say about each. */
  async function inspectLine(certificateId: string): Promise<{ entries: Entry[]; realizations: RealizationRecord[] }> {
    const intents = await store.line(institution, certificateId);
    const entries: Entry[] = [];
    for (const listed of intents) {
      const intent = await readIntent(listed.id);
      const observed = await relay.status(intent);
      const endorsed = !!(await store.attempt(institution, intent.id));
      const tokenId = await chain.tokenOf(institution, certificateId, intent.certification.version);
      const content = await verifiedContent(intent);
      let view: Entry["chain"];
      if (tokenId !== 0n) {
        view = await chain.publicView(tokenId);
        if (view.contentDigest !== intent.certification.digest || view.issuer.toLowerCase() !== intent.certification.signer.toLowerCase()) {
          throw new CertificateError("Isi atau penerbit sertifikat tidak cocok dengan bukti chain. Verifikasi ditahan.", 503);
        }
        if (["CONFIRMED", "INCLUDED"].includes(observed.observation.state) && observed.observation.tokenId !== view.originalTokenId.toString()) {
          // The receipt is for the token first minted; a custody replacement keeps that link on chain.
          throw new CertificateError("Token sertifikat tidak cocok dengan receipt penerbitan.", 503);
        }
      }
      entries.push({ intent, observed, endorsed, tokenId, content, chain: view });
    }
    const proposals = [...new Set(entries.map((e) => e.content.proposalId))];
    const realizations = (await Promise.all(proposals.map((p) => disbursement.getProposalRealizations(institution, p)))).flat();
    return { entries, realizations };
  }

  /** Which successor speaks for a version. Confirmed wins, then anything still in flight, then a
   * failure; an unendorsed draft only counts as a preparation. */
  function successorOf(entry: Entry, entries: Entry[]): { state: ReplacementState; entry?: Entry } {
    const candidates = entries.filter((e) => e.intent.certification.predecessor === entry.intent.certification.version);
    const rank = (e: Entry) => {
      const state = replacementStateOf({ hasAttempt: e.endorsed, state: e.observed.observation.state });
      return { state, order: state === "CONFIRMED" ? 0 : state === "FAILED" ? 3 : state === "PREPARED" ? 4 : 1 };
    };
    const best = [...candidates].sort((a, b) => rank(a).order - rank(b).order
      || Number(b.intent.certification.version) - Number(a.intent.certification.version))[0];
    const chainSuccessor = entry.chain?.successorTokenId ?? 0n;
    // The chain has a successor that the institution's own records cannot vouch for, or that differs
    // from the one this service published: withhold "current" and say why.
    if (chainSuccessor !== 0n && (!best || (best.chain?.originalTokenId ?? best.tokenId) !== chainSuccessor)) return { state: "UNVERIFIED_CHAIN_SUCCESSOR" };
    return best ? { state: rank(best).state, entry: best } : { state: "NONE" };
  }

  /** Who holds the token now, which tokens have represented this version, and whether the holder is
   * still the institution's resolved custodian. Stale holders are visible, never hidden. */
  async function custodyOf(activeTokenId: bigint): Promise<NonNullable<PublicCertificateSummary["custody"]>> {
    const tokens = await chain.custodyTokens(activeTokenId);
    const active = tokens.find((t) => t.status === "ACTIVE")!;
    const resolved = await chain.resolvedCustodian(institution);
    return {
      current: active.holder.toLowerCase() === resolved.toLowerCase(),
      tokens: tokens.map((t) => ({ tokenId: t.tokenId.toString(), holder: t.holder, status: t.status })),
      ...(tokens.length > 1 ? { recoveryReason: "CUSTODY_RECOVERY" as const } : {}),
    };
  }

  function describe(entry: Entry, entries: Entry[], scope: ScopeAssessment, publicView: boolean): CertificateLineVersion {
    const successor = successorOf(entry, entries);
    const replacement: ReplacementState = publicView && successor.state === "PREPARED" ? "NONE" : successor.state;
    const c = entry.intent.certification;
    return {
      version: c.version, predecessor: c.predecessor, tokenId: entry.tokenId === 0n ? null : entry.tokenId.toString(),
      validity: validityOf({ ownState: entry.observed.observation.state, replacement: successor.state, scope: scope.sourceStatus }),
      replacement, observationState: entry.observed.observation.state,
      intentId: entry.intent.id, endorsed: entry.endorsed,
      ...(entry.content.correction ? { correction: { reason: entry.content.correction.reason, note: entry.content.correction.note } } : {}),
    };
  }
  const publicVersion = (version: CertificateLineVersion): PublicCertificateVersion => ({
    version: version.version, predecessor: version.predecessor, tokenId: version.tokenId,
    validity: version.validity, replacement: version.replacement, observationState: version.observationState,
  });

  return {
    status,
    list: async (activityId?: string) => Promise.all((await store.list(institution, activityId)).map((intent) => status(intent.id))),

    async prepare(account: Hex, activityId: string, certificateId: string) {
      if (!certificateId || certificateId.includes("@")) throw new CertificateError("Identitas sertifikat tidak sah.", 400);
      const activity = await activities.getActivity(institution, activityId, false);
      if (!activity) throw new CertificateError("Kegiatan penyaluran tidak ditemukan.", 404);
      const existing = await store.get(institution, certificateId);
      if (existing) {
        if (existing.certification.activityId !== activityId || existing.certification.signer.toLowerCase() !== account.toLowerCase()) {
          throw new CertificateError("Identitas sertifikat telah terikat pada persiapan berbeda.", 409);
        }
        return reviewedExisting(certificateId);
      }
      const realizations = await disbursement.getProposalRealizations(institution, activity.proposalId);
      const frozenAt = runtime.now();
      const { content, canonical, bytes } = freezeCertificateContent({
        activity, activityId, certificateId, certificateVersion: "1", realizations, frozenAt,
      });
      if (content.realizations.length === 0) throw new CertificateError("Belum ada realisasi berbukti atau berkonfirmasi pada kegiatan ini.", 409);
      return endorsementIntent(account, activityId, certificateId, "1", "", canonical, bytes, frozenAt);
    },

    /**
     * Prepare the next version of an official certificate (#112). The successor re-reads exactly
     * the predecessor's realizations, names the official head it replaces, and is refused unless
     * the source really differs for the stated reason. Nothing is published until the endorsement
     * is signed and submitted, and the predecessor is untouched until a successor confirms.
     */
    async prepareCorrection(account: Hex, activityId: string, certificateId: string, reasonInput: unknown, noteInput: unknown, expectedPredecessorVersion: unknown) {
      if (typeof expectedPredecessorVersion !== "string" || !/^[1-9][0-9]*$/.test(expectedPredecessorVersion)) {
        throw new CertificateError("Versi pendahulu yang ditinjau wajib disertakan dan harus sah.", 400);
      }
      if (!isCorrectionReason(reasonInput)) throw new CertificateError("Alasan koreksi tidak dikenal.", 400);
      const reason: CorrectionReason = reasonInput;
      const note = typeof noteInput === "string" ? noteInput.trim() : "";
      if (!note || note.length > NOTE_MAX) throw new CertificateError(`Catatan koreksi wajib diisi (maksimal ${NOTE_MAX} karakter).`, 400);
      const line = await store.line(institution, certificateId);
      if (!line.length) throw new CertificateError("Sertifikat tidak ditemukan.", 404);
      const activity = await activities.getActivity(institution, activityId, false);
      if (!activity) throw new CertificateError("Kegiatan penyaluran tidak ditemukan.", 404);

      const authority = await chain.authority(institution, account);
      if (!authority.active) throw new CertificateError("Akun tidak memiliki kewenangan pengesah lembaga pada registry.", 403);

      const headVersion = await chain.latestVersion(institution, certificateId);
      if (expectedPredecessorVersion !== headVersion) {
        throw new CertificateError("Versi resmi terkini berubah. Muat ulang dan tinjau versi pendahulu sebelum mengoreksi.", 409);
      }
      const { entries, realizations } = await inspectLine(certificateId);
      const head = entries.find((e) => e.intent.certification.version === headVersion && e.tokenId !== 0n);
      if (!headVersion || !head) {
        throw new CertificateError("Versi resmi terkini tidak dapat dipastikan dari chain dan riwayat lembaga. Koreksi ditahan.", 409);
      }
      if (head.intent.certification.activityId !== activityId) throw new CertificateError("Kegiatan berbeda dari sertifikat yang dikoreksi.", 409);
      if (head.observed.observation.state !== "CONFIRMED") {
        throw new CertificateError("Versi resmi terkini belum terkonfirmasi cukup. Tunggu konfirmasi sebelum mengoreksi.", 409);
      }
      const successors = entries.filter((e) => e.intent.certification.predecessor === headVersion);
      const live = successors.find((e) => e.endorsed && replacementStateOf({ hasAttempt: true, state: e.observed.observation.state }) !== "FAILED");
      if (live) throw new CertificateError("Sudah ada koreksi yang disahkan untuk versi resmi ini. Tunggu hasilnya atau periksa statusnya.", 409);

      const assessment = assessScope(head.content, realizations);
      if (!correctionJustified(reason, assessment)) {
        throw new CertificateError(reason === "DISPUTE_DISCLOSURE"
          ? "Tidak ada sengketa baru pada cakupan sertifikat ini yang perlu dicantumkan."
          : "Sumber realisasi tidak berbeda dari isi sertifikat resmi. Koreksi tanpa perubahan ditolak.", 409);
      }

      // An unsigned draft by the same signer for the same reason is reused while it is still fresh;
      // otherwise a new version number is taken, leaving the older draft as unpublished history.
      for (const draft of successors.filter((e) => !e.endorsed && e.intent.certification.signer.toLowerCase() === account.toLowerCase())) {
        if (draft.observed.observation.state === "PREPARED" && draft.observed.signingAuthority === "CURRENT"
          && draft.intent.certification.authorityEpoch === authority.epoch
          && BigInt(draft.intent.certification.deadline) > BigInt(runtime.now())
          && draft.content.correction?.reason === reason && draft.content.correction.note === note
          && assessScope(draft.content, realizations).changedIds.length === 0) return draft.observed;
      }
      const version = String(Math.max(...entries.map((e) => Number(e.intent.certification.version) || 0)) + 1);
      const frozenAt = runtime.now();
      const { canonical, bytes } = freezeCertificateContent({
        activity, activityId, certificateId, certificateVersion: version, realizations, frozenAt,
        correction: {
          reason, note, predecessorVersion: headVersion, predecessorDigest: head.intent.certification.digest,
          scopeRealizationIds: head.content.realizations.map((r) => r.realizationId),
        },
      });
      return endorsementIntent(account, activityId, certificateId, version, headVersion, canonical, bytes, frozenAt);
    },

    async submit(account: Hex, id: string, signature: Hex) {
      const intent = await readIntent(id);
      if (intent.certification.signer.toLowerCase() !== account.toLowerCase()) throw new CertificateError("Pengesah berbeda dari akun sesi.", 403);
      const done = await relay.settled(intent, signature);
      if (done) return done;
      try { await chain.validate(intent, signature); }
      catch { throw new CertificateError("Pengesahan ditolak atau kewenangan registry tidak dapat diperiksa. Periksa akun, masa berlaku dan mandat.", 409); }
      try { return await relay.send(intent, signature); }
      catch (error) {
        if (error instanceof SuccessorClaimedError) {
          throw new CertificateError("Koreksi lain sudah disahkan untuk versi resmi yang sama; hanya satu penerus yang dapat menjadi versi resmi.", 409);
        }
        throw error;
      }
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

    /** Allowlisted aggregate only: totals and chain proof, never a realization or beneficiary reference.
     * Without `version` this is the line's official head; with one, that historical version. */
    async publicSummary(certificateId: string, version?: string): Promise<PublicCertificateSummary | null> {
      if (!(await store.line(institution, certificateId)).length) return null;
      const target = version ?? await chain.latestVersion(institution, certificateId);
      if (!target) return null;
      const { entries, realizations } = await inspectLine(certificateId);
      const entry = entries.find((e) => e.intent.certification.version === target);
      if (!entry) {
        if (version) return null;
        throw new CertificateError("Versi resmi terkini di chain tidak ada pada riwayat lembaga. Verifikasi ditahan.", 503);
      }
      if (entry.tokenId === 0n || !entry.chain) return null;
      const scope = assessScope(entry.content, realizations);
      const described = describe(entry, entries, scope, true);
      const predecessorEntry = entries.find((e) => e.intent.certification.version === entry.intent.certification.predecessor);
      const successor = successorOf(entry, entries).entry;
      return {
        tokenId: entry.tokenId.toString(), institutionId: institution, activityId: entry.intent.certification.activityId,
        certificateId, version: entry.intent.certification.version, issuer: entry.chain.issuer, contentDigest: entry.chain.contentDigest,
        custodian: entry.chain.custodian, observation: entry.observed.observation, totals: publicTotals(entry.content.totals),
        validity: described.validity,
        scope: { sourceStatus: scope.sourceStatus, disputedCount: scope.disputedIds.length, changedCount: scope.changedIds.length },
        replacement: { state: described.replacement, ...(successor?.endorsed ? { version: successor.intent.certification.version,
          ...(successor.tokenId !== 0n ? { tokenId: successor.tokenId.toString() } : {}) } : {}) },
        ...(entry.intent.certification.predecessor ? { predecessor: { version: entry.intent.certification.predecessor,
          ...(predecessorEntry && predecessorEntry.tokenId !== 0n ? { tokenId: predecessorEntry.tokenId.toString() } : {}) } } : {}),
        ...(entry.content.correction ? { correction: { reason: entry.content.correction.reason } } : {}),
        custody: await custodyOf(entry.tokenId),
        history: entries.filter((e) => e.endorsed || e.tokenId !== 0n)
          .map((e) => publicVersion(describe(e, entries, assessScope(e.content, realizations), true))),
      };
    },

    /** Workspace/auditor view of one certificate line: every version including unsigned drafts, the
     * private correction notes, and whether a correction can be prepared right now. Read-only. */
    async line(certificateId: string): Promise<CertificateLineStatus> {
      if (!(await store.line(institution, certificateId)).length) throw new CertificateError("Sertifikat tidak ditemukan.", 404);
      const { entries, realizations } = await inspectLine(certificateId);
      const headVersion = (await chain.latestVersion(institution, certificateId)) || null;
      const head = entries.find((e) => e.intent.certification.version === headVersion && e.tokenId !== 0n);
      const scope = head ? assessScope(head.content, realizations) : null;
      const versions = entries.map((e) => describe(e, entries, assessScope(e.content, realizations), false));
      const headView = head ? versions.find((v) => v.intentId === head.intent.id)! : null;
      const custody = head ? await custodyOf(head.tokenId) : null;
      const resolved = custody ? await chain.resolvedCustodian(institution) : null;
      return {
        certificateId, headVersion, ...(head ? { headTokenId: head.tokenId.toString() } : {}), versions,
        ...(custody && resolved ? { custody: { holder: custody.tokens.find((t) => t.status === "ACTIVE")!.holder, resolvedCustodian: resolved, recoveryNeeded: !custody.current } } : {}),
        scope: scope ? { sourceStatus: scope.sourceStatus, disputedCount: scope.disputedIds.length, changedCount: scope.changedIds.length } : null,
        correctionAllowed: !!head && head.observed.observation.state === "CONFIRMED" && scope!.changedIds.length > 0
          && !!headView && !["REPLACEMENT_PENDING", "SUPERSEDED"].includes(headView.validity),
      };
    },
  };
}

function publicTotals(totals: PublicCertificateSummary["totals"]) {
  return { confirmedCount: totals.confirmedCount, disputedCount: totals.disputedCount,
    unconfirmedCount: totals.unconfirmedCount, totalRealizedIdr: totals.totalRealizedIdr };
}

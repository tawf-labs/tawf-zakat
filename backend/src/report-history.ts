/** Version identity and succession read from the registry, never from display numbering or local ordering. */
import { hashTypedData, keccak256, toHex, type Hex } from "viem";
import { evidenceTypedData, NO_ATTESTATION } from "../../shared/report-registry";
import type { RegistryChain } from "./registry-chain";
import type { RegistryRuntime } from "./registry-recording";
import type { WorkspaceRuntime } from "./workspace-runtime";

/** A corrected report is a short line, not a log. Reading stops rather than following an unbounded chain. */
export const OFFICIAL_LINE_LIMIT = 100;
export const PUBLISH_ACTION = keccak256(toHex("PUBLISH_REPORT"));

export type VersionSubject = { institutionId: string; reportId: string; version: string; packageId: string; digest: string };
export type VersionAttestation = {
  id: Hex; auditor: Hex; scope: string; conclusion: string; evidenceCommitment: Hex;
  predecessor: Hex | null; authorityEpoch: string; mandate: string;
};
/**
 * Attestations belong to the version identity that was examined.
 *
 * They are read from the registry by that identity - never by report id - so a
 * correction starts with its own empty list even when the version it succeeded
 * carries several conclusions. Audit state is never inherited. A record whose
 * package or digest does not match this version is dropped rather than shown,
 * because an opinion about other bytes is not an opinion about these.
 */
export async function attestationsForVersion(chain: RegistryChain, subject: VersionSubject) {
  const records = (await chain.versionAttestations(subject.institutionId, subject.reportId, subject.version))
    .filter(record => record.statement.packageId === subject.packageId && record.statement.packageDigest === subject.digest);
  const entries: VersionAttestation[] = records.map(record => ({
    id: record.id, auditor: record.statement.auditor, scope: record.statement.scope,
    conclusion: record.statement.conclusion, evidenceCommitment: record.statement.evidenceCommitment,
    predecessor: record.statement.predecessor === NO_ATTESTATION ? null : record.statement.predecessor,
    authorityEpoch: record.statement.authorityEpoch.toString(),
    // The engagement the institution recorded when it granted this scope, so a reader can weigh it.
    mandate: record.mandate,
  }));
  return {
    subject, entries,
    state: entries.length === 0 ? "NOT_EXAMINED" as const : "ATTESTED" as const,
    // A recorded mandate is an engagement, not proof of independence or of a compliance certification.
    basis: "Kewenangan auditor dicatat lembaga yang diperiksa; peran teknis ini bukan bukti independensi atau sertifikasi kepatuhan menyeluruh.",
  };
}


export type PublicationSubject = { id: string; reportId: string; version: string; predecessor: string | null };
export type SuccessionState = { officialPackage: string; versionPackage: string };

/** What the registry currently says about this report's official line and this version label. */
export async function successionState(chain: RegistryChain, institution: string, subject: PublicationSubject): Promise<SuccessionState> {
  const [official, accepted] = await Promise.all([
    chain.officialLine(institution, subject.reportId),
    chain.publishedVersion(institution, subject.reportId, subject.version),
  ]);
  return { officialPackage: official.packageId, versionPackage: accepted.institution.packageId };
}

/**
 * Why this package may not be published as the report's next official version.
 *
 * A first version requires that no official version exists; a correction
 * requires that its predecessor is the one the registry currently treats as
 * official, and its version label must not already belong to another version.
 * Returns null when the package is already the official version, so that
 * recovering a lost broadcast is not mistaken for a conflict. The registry
 * enforces all of this too; saying it here turns a bare revert into an
 * instruction the amil can act on.
 */
export function publicationConflict(state: SuccessionState, subject: PublicationSubject): string | null {
  if (state.versionPackage && state.versionPackage !== subject.id) {
    return `Label versi "${subject.version}" sudah dipakai versi resmi lain (paket ${state.versionPackage}). Pilih label versi yang belum terpakai untuk koreksi ini.`;
  }
  const previous = subject.predecessor ?? "";
  if (state.officialPackage === subject.id || state.officialPackage === previous) return null;
  if (previous === "") return `Laporan ini sudah memiliki versi resmi (paket ${state.officialPackage}). Siapkan koreksi dari versi tersebut, bukan versi pertama kedua.`;
  if (state.officialPackage === "") return "Pendahulu koreksi belum menjadi versi resmi. Terbitkan versi pertama sebelum menyiapkan koreksi.";
  return `Pendahulu bukan versi resmi terkini (paket ${state.officialPackage}). Siapkan paket dan pengesahan baru terhadap versi terkini; pengesahan lama tidak berlaku.`;
}

async function anchorOf(registry: RegistryRuntime, institution: string, packageId: string, authorizationDigest: Hex) {
  const intents = (await registry.store.list(institution, packageId)).filter(i => i.authorization.action === PUBLISH_ACTION
    && i.authorizationDigest === authorizationDigest);
  for (const intent of intents) {
    const attempt = await registry.store.attempt(institution, intent.id);
    if (!attempt) continue;
    const observation = await registry.chain.observe(intent, attempt.hash);
    if (observation.state !== "CONFIRMED" && observation.state !== "INCLUDED") continue;
    return { transactionHash: attempt.hash, authorizationDigest, validatorAuthorizationDigest: intent.validator?.authorizationDigest ?? null, ...observation };
  }
  return null;
}

export type VersionHistoryEntry = Awaited<ReturnType<typeof readOfficialLine>>[number];

/**
 * The report's official line, newest first, as the registry itself resolves it.
 *
 * Each entry is read through the version identity the registry accepted, so a
 * losing correction never appears here even when its package and findings are
 * still stored and readable as a submission. The correction reason and the
 * receipt come from the institution's own records: a version published by a
 * direct contract call is still listed, with an absent anchor rather than a
 * borrowed one.
 */
export async function readOfficialLine(runtime: WorkspaceRuntime, registry: RegistryRuntime, institution: string, reportId: string) {
  const { chain } = registry;
  const official = await chain.officialLine(institution, reportId);
  const entries = [];
  const seen = new Set<string>();
  let cursor: string = official.packageId;
  while (cursor && !seen.has(cursor) && entries.length < OFFICIAL_LINE_LIMIT) {
    seen.add(cursor);
    const version = await chain.publishedPackageVersion(institution, cursor);
    if (!version) break;
    const accepted = await chain.publishedVersion(institution, reportId, version);
    // Both directions of the identity must agree before anything is reported as a version.
    if (accepted.institution.packageId !== cursor) break;
    const stored = await runtime.evidence!.findReportPackage(institution, cursor);
    // Only a stored body whose digest is the accepted one may supply the reason for this version.
    const body = stored && stored.digest === accepted.institution.digest ? JSON.parse(stored.canonical) : null;
    const authorizationDigest = hashTypedData(evidenceTypedData(chain.domain, {
      ...accepted.institution, authorityEpoch: accepted.institution.authorityEpoch.toString(), deadline: accepted.institution.deadline.toString(),
    }));
    entries.push({
      packageId: cursor, version, official: entries.length === 0,
      predecessor: accepted.institution.predecessor || null,
      correctionReason: body?.correctionReason ?? null,
      preparationId: body?.preparationId ?? null,
      digest: accepted.institution.digest, policy: accepted.institution.policy, outcome: accepted.institution.outcome,
      endorsements: { institution: accepted.institution.signer, validator: accepted.validator.signer },
      anchor: await anchorOf(registry, institution, cursor, authorizationDigest),
      attestations: await attestationsForVersion(chain, { institutionId: institution, reportId, version, packageId: cursor, digest: accepted.institution.digest }),
    });
    cursor = accepted.institution.predecessor;
  }
  return entries;
}

/**
 * Freezing a preparation, and committing to it (Spec #68, ticket #70).
 *
 * A snapshot is the set of bytes a report's figures were actually computed
 * from. Everything downstream - recomputing the result, checking that the
 * source did not change afterwards, an endorsement that means anything - rests
 * on those bytes being reproducible, so the serialization here is canonical:
 * keys ordered, arrays in the order they were read, amounts as decimal integer
 * strings, and no floating point anywhere near money.
 *
 * Two commitments, for two audiences:
 *
 * - **The package commitment** is an HMAC over the frozen bytes, keyed by 32
 *   bytes of per-snapshot salt. A plain hash would not do: a source can be one
 *   row with a round number for a known institution, and a digest of something
 *   that guessable is not a commitment, it is an invitation to enumerate. The
 *   salt is part of the *restricted* package, so only an authorized reader can
 *   verify the commitment - which is the intended trade, since only they can
 *   see the thing being committed to in the first place.
 * - **The summary digest** is a plain SHA-256 over the public summary. That
 *   part is public by construction, so there is nothing to hide behind a salt,
 *   and a plain digest is checkable by anyone.
 *
 * The public summary is built by naming what goes in, never by deleting fields
 * from the private one. A summary assembled by subtraction leaks the first time
 * somebody adds a field upstream and forgets this file exists.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import type { CurrencyUnit, DiscrepancyKind, ReportingPeriod } from "./reconciliation";
import type {
  ManifestPosition,
  NormalizedRow,
  SourceManifest,
  SubmittedSide,
  UnverifiedRecord,
} from "./evidence-source";

export const SNAPSHOT_FORMAT = "tawf.evidence.snapshot" as const;
export const SNAPSHOT_VERSION = 1 as const;
export const COMMITMENT_SCHEME = "HMAC-SHA256" as const;

export type Quantity = { amount: string; unit: CurrencyUnit };

/** How a file that was offered alongside the sources actually fared. */
export type FileReference = {
  id: string;
  role: "CLAIM" | "SOURCE";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** SHA-256 of the plaintext. `null` when the file never reached storage. */
  contentSha256: string | null;
  storageStatus: "STORED" | "FAILED";
  failureReason: string | null;
};

export type SnapshotSide = {
  manifest: SourceManifest;
  status: "READ" | "MISSING" | "FAILED";
  /** Why an unread source was not read. `null` when it was. */
  detail: string | null;
  rows: NormalizedRow[];
  /**
   * Records this side holds that could not be proved (ticket #79). Present only
   * where a mapper produced some; a side with none omits the field entirely, so
   * the bytes of every package frozen before this existed stay reproducible.
   */
  unverified?: UnverifiedRecord[];
};

export type EvidenceSnapshot = {
  format: typeof SNAPSHOT_FORMAT;
  version: typeof SNAPSHOT_VERSION;
  preparationId: string;
  institutionId: string;
  label: string;
  period: ReportingPeriod;
  currencyUnit: CurrencyUnit;
  balanceSheetScope: ManifestPosition;
  tolerance: Quantity;
  allowedBuckets: string[];
  preparedBy: string;
  preparedAt: number;
  sides: SnapshotSide[];
  files: FileReference[];
  coverageNotes: string[];
};

export type SnapshotInput = {
  preparationId: string;
  institutionId: string;
  label: string;
  period: ReportingPeriod;
  currencyUnit: CurrencyUnit;
  balanceSheetScope: ManifestPosition;
  tolerance: Quantity;
  allowedBuckets: string[];
  preparedBy: string;
  preparedAt: number;
  sides: SubmittedSide[];
  files: FileReference[];
  coverageNotes: string[];
};

/**
 * Deterministic JSON. Object keys sorted, array order preserved, and anything
 * that cannot survive a round trip refused rather than coerced.
 */
export { canonicalJson } from "../../shared/canonical-json";
import { canonicalJson } from "../../shared/canonical-json";

const sideOf = (side: SubmittedSide): SnapshotSide => ({
  manifest: side.manifest,
  status: side.status,
  detail: side.status === "READ" ? null : side.detail,
  rows: side.status === "READ" ? side.rows : [],
  // An unread side keeps its unverified records: they are the population that
  // was not examined, and dropping them here would turn a named gap into
  // silence exactly where the package is at its weakest.
  ...(side.unverified && side.unverified.length > 0 ? { unverified: side.unverified } : {}),
});

/**
 * The frozen preparation and its bytes.
 *
 * The bytes are what everything else commits to and recomputes from, so they
 * are produced here once rather than re-serialized at each use site.
 */
export function freezeSnapshot(input: SnapshotInput): {
  snapshot: EvidenceSnapshot;
  bytes: Uint8Array;
  canonical: string;
} {
  const snapshot: EvidenceSnapshot = {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    preparationId: input.preparationId,
    institutionId: input.institutionId,
    label: input.label,
    period: input.period,
    currencyUnit: input.currencyUnit,
    balanceSheetScope: input.balanceSheetScope,
    tolerance: input.tolerance,
    allowedBuckets: input.allowedBuckets,
    preparedBy: input.preparedBy,
    preparedAt: input.preparedAt,
    sides: input.sides.map(sideOf),
    files: input.files,
    coverageNotes: input.coverageNotes,
  };

  const canonical = canonicalJson(snapshot);
  return { snapshot, canonical, bytes: new TextEncoder().encode(canonical) };
}

/** Reads a stored snapshot back. The bytes are the record; this is the view of them. */
export const parseSnapshot = (canonical: string): EvidenceSnapshot =>
  JSON.parse(canonical) as EvidenceSnapshot;

/** 32 bytes. Anything shorter is a salt an attacker can enumerate alongside the data. */
export const newCommitmentSalt = (): string => `0x${randomBytes(32).toString("hex")}`;

export function commitmentFor(bytes: Uint8Array, salt: string): string {
  if (!/^0x[0-9a-f]{64}$/i.test(salt)) {
    throw new Error("Salt commitment harus 32 byte heksadesimal.");
  }
  const key = Buffer.from(salt.slice(2), "hex");
  return `0x${createHmac("sha256", key).update(Buffer.from(bytes)).digest("hex")}`;
}

/**
 * Constant-time comparison. Commitment checking is a place where an attacker
 * gets to supply one side, so an early-exit compare leaks how much of a guess
 * was right.
 */
export function verifyCommitment(bytes: Uint8Array, salt: string, commitment: string): boolean {
  let expected: string;
  try {
    expected = commitmentFor(bytes, salt);
  } catch {
    return false;
  }
  if (expected.length !== commitment.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ commitment.charCodeAt(index);
  }
  return difference === 0;
}

export const sha256Hex = (bytes: Uint8Array): string =>
  `0x${createHash("sha256").update(Buffer.from(bytes)).digest("hex")}`;

export type ExaminationOutcome = "RECONCILED" | "INCOMPLETE";

export type PublicSourceSummary = {
  role: "CLAIM" | "SOURCE";
  origin: string;
  fundTypes: string[];
  balanceSheet: ManifestPosition;
  currencyUnit: CurrencyUnit;
  cutOff: string;
  transactionDetail: string;
  status: "READ" | "MISSING" | "FAILED";
  /** How many rows the source held. `null` when it was never read. */
  rowCount: number | null;
  /**
   * How many records the source held but could not prove. A count, never the
   * references themselves - those name transactions and internal ids. Omitted
   * where there are none, so a summary from before this existed still hashes to
   * the digest it was published under.
   */
  unverifiedCount?: number;
};

export type PublicSummary = {
  format: typeof SNAPSHOT_FORMAT;
  version: typeof SNAPSHOT_VERSION;
  preparationId: string;
  institutionId: string;
  period: ReportingPeriod;
  currencyUnit: CurrencyUnit;
  balanceSheetScope: ManifestPosition;
  preparedAt: number;
  sides: PublicSourceSummary[];
  files: { total: number; stored: number; failed: number };
  outcome: ExaminationOutcome;
  netDelta: Quantity | null;
  absoluteDelta: Quantity | null;
  findingCounts: Partial<Record<DiscrepancyKind, number>>;
  coverageNotes: string[];
  commitment: string;
  commitmentScheme: typeof COMMITMENT_SCHEME;
  summaryDigest: string;
};

/**
 * The part of a package a public reader may see.
 *
 * Built by naming every field, never by removing fields from the snapshot. The
 * `salt` is accepted only so this function can assert it never appears in what
 * it returns; nothing here reads it.
 */
export function publicSummaryOf(
  snapshot: EvidenceSnapshot,
  result: {
    commitment: string;
    outcome: ExaminationOutcome;
    netDelta: Quantity | null;
    absoluteDelta: Quantity | null;
    findingCounts: Partial<Record<DiscrepancyKind, number>>;
    /** Present so the assertion below can be made; deliberately never copied out. */
    salt: string;
  }
): PublicSummary {
  const body = {
    format: snapshot.format,
    version: snapshot.version,
    preparationId: snapshot.preparationId,
    institutionId: snapshot.institutionId,
    period: snapshot.period,
    currencyUnit: snapshot.currencyUnit,
    balanceSheetScope: snapshot.balanceSheetScope,
    preparedAt: snapshot.preparedAt,
    sides: snapshot.sides.map(
      (side): PublicSourceSummary => ({
        role: side.manifest.role,
        origin: side.manifest.origin,
        fundTypes: side.manifest.fundTypes,
        balanceSheet: side.manifest.balanceSheet,
        currencyUnit: side.manifest.currencyUnit,
        cutOff: side.manifest.cutOff,
        transactionDetail: side.manifest.transactionDetail,
        status: side.status,
        rowCount: side.status === "READ" ? side.rows.length : null,
        ...(side.unverified && side.unverified.length > 0
          ? { unverifiedCount: side.unverified.length }
          : {}),
      })
    ),
    files: {
      total: snapshot.files.length,
      stored: snapshot.files.filter((file) => file.storageStatus === "STORED").length,
      failed: snapshot.files.filter((file) => file.storageStatus === "FAILED").length,
    },
    outcome: result.outcome,
    netDelta: result.netDelta,
    absoluteDelta: result.absoluteDelta,
    findingCounts: result.findingCounts,
    // Public wording uses validated enums only. Free text can contain identities,
    // bank details, filenames or adapter errors and stays in the restricted snapshot.
    coverageNotes: [
      ...snapshot.sides.flatMap((side) => {
        const name = side.manifest.role === "CLAIM" ? "klaim" : "sumber";
        if (side.status !== "READ") {
          return [`Sisi ${name} ${side.status === "MISSING" ? "belum tersedia" : "gagal dibaca"}; cakupannya belum terperiksa.`];
        }
        return side.manifest.transactionDetail === "NOT_AVAILABLE"
          ? [`Sisi ${name} berupa rekap tanpa rincian transaksi.`]
          : [];
      }),
      ...snapshot.sides.flatMap((side) =>
        side.unverified && side.unverified.length > 0
          ? [
              `Sisi ${side.manifest.role === "CLAIM" ? "klaim" : "sumber"} memuat ` +
                `${side.unverified.length} catatan berstatus belum terverifikasi yang tidak masuk perbandingan.`,
            ]
          : []
      ),
      ...(snapshot.files.some((file) => file.storageStatus === "FAILED")
        ? ["Sebagian berkas tidak tersimpan; rincian tersedia bagi pembaca berwenang."]
        : []),
    ],
    commitment: result.commitment,
    commitmentScheme: COMMITMENT_SCHEME,
  };

  const canonical = canonicalJson(body);
  if (canonical.includes(result.salt.slice(2))) {
    throw new Error("Ringkasan publik tidak boleh memuat salt commitment.");
  }

  return { ...body, summaryDigest: sha256Hex(new TextEncoder().encode(canonical)) };
}

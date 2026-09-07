/**
 * Freezing a preparation into bytes that can be committed to (Spec #68, #70).
 *
 * A snapshot is only worth keeping if two people can serialize it and get the
 * same bytes, and if changing anything at all inside it changes the commitment.
 * These tests hold both, plus the two separations the package depends on: the
 * salt that stops a low-entropy source being guessed from its commitment, and
 * the public summary that must not carry rows, file locations or that salt.
 */

import { describe, expect, it } from "bun:test";
import {
  canonicalJson,
  commitmentFor,
  freezeSnapshot,
  newCommitmentSalt,
  publicSummaryOf,
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
  verifyCommitment,
  type SnapshotInput,
} from "../src/evidence-snapshot";
import { normalizeSide, type SubmittedSide } from "../src/evidence-source";

const manifest = (role: "CLAIM" | "SOURCE", overrides: Record<string, unknown> = {}) => ({
  label: role === "CLAIM" ? "Rekap wilayah" : "Laporan kinerja",
  origin: "UPLOAD",
  scopeUnit: "Pusat",
  scopeLevel: "PUSAT",
  fundTypes: ["ZAKAT"],
  balanceSheet: "ON",
  currencyUnit: "IDR",
  period: { kind: "AKHIR_TAHUN", year: 2024 },
  cutOff: "2025-02-11T00:00:00.000Z",
  format: "baris-ledger",
  mappingVersion: "1",
  transactionDetail: "PRESENT",
  ...overrides,
});

const sideOf = (role: "CLAIM" | "SOURCE", amount: string, extra: Record<string, unknown> = {}): SubmittedSide =>
  normalizeSide(
    {
      manifest: manifest(role),
      rows: [
        {
          key: "PZ-1401",
          bucket: "ZAKAT",
          balanceSheet: "ON",
          value: { amount, unit: "IDR" },
          label: "Ibu Sartika binti Rahmat",
        },
      ],
      ...extra,
    },
    role,
    "lpz-sinar-amanah"
  ).side!;

const input = (overrides: Partial<SnapshotInput> = {}): SnapshotInput => ({
  preparationId: "prep-0001",
  institutionId: "lpz-sinar-amanah",
  label: "Rekonsiliasi akhir tahun 2024",
  period: { kind: "AKHIR_TAHUN", year: 2024 },
  currencyUnit: "IDR",
  balanceSheetScope: "ON",
  tolerance: { amount: "0", unit: "IDR" },
  allowedBuckets: ["ZAKAT"],
  preparedBy: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  preparedAt: 1_800_000_000,
  sides: [sideOf("CLAIM", "1500000000"), sideOf("SOURCE", "1200000000")],
  files: [],
  coverageNotes: [],
  ...overrides,
});

describe("canonical serialization", () => {
  it("orders keys, so two objects written differently produce identical bytes", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("keeps array order, because a ledger's row order is part of what was read", () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it("refuses a floating point number rather than rounding money into one", () => {
    expect(() => canonicalJson({ amount: 1.5 })).toThrow(/bulat/i);
    expect(() => canonicalJson({ amount: Number.NaN })).toThrow();
  });

  it("refuses undefined rather than silently dropping the field it was on", () => {
    expect(() => canonicalJson({ cutOff: undefined })).toThrow(/undefined/i);
  });
});

describe("freezing a snapshot", () => {
  it("stamps its own format and version so a later reader knows how to read it", () => {
    const { snapshot } = freezeSnapshot(input());
    expect(snapshot.format).toBe(SNAPSHOT_FORMAT);
    expect(snapshot.version).toBe(SNAPSHOT_VERSION);
  });

  it("produces the same bytes for the same preparation, every time", () => {
    expect(freezeSnapshot(input()).bytes).toEqual(freezeSnapshot(input()).bytes);
  });

  it("keeps every row, with its fund type, balance-sheet position and exact amount", () => {
    const { snapshot } = freezeSnapshot(input());
    const claim = snapshot.sides.find((side) => side.manifest.role === "CLAIM")!;
    expect(claim.rows).toEqual([
      {
        key: "PZ-1401",
        bucket: "ZAKAT",
        balanceSheet: "ON",
        amount: "1500000000",
        unit: "IDR",
        amilAmount: null,
        label: "Ibu Sartika binti Rahmat",
        isDeclaredTotal: false,
      },
    ]);
  });
});

describe("the commitment", () => {
  const salt = newCommitmentSalt();

  it("mints 32 bytes of salt, so a low-entropy source cannot be guessed from the digest", () => {
    expect(salt).toMatch(/^0x[0-9a-f]{64}$/);
    expect(newCommitmentSalt()).not.toBe(newCommitmentSalt());
  });

  it("gives the same bytes and salt the same commitment", () => {
    const { bytes } = freezeSnapshot(input());
    expect(commitmentFor(bytes, salt)).toBe(commitmentFor(bytes, salt));
    expect(verifyCommitment(bytes, salt, commitmentFor(bytes, salt))).toBe(true);
  });

  /**
   * A source can be tiny and predictable - one row, a round number, a known
   * institution. An unsalted digest of that is guessable by anyone who can
   * enumerate the candidates, which is not privacy. The salt is the whole
   * defence, and it lives only in the restricted package.
   */
  it("gives the same bytes different commitments under different salts", () => {
    const { bytes } = freezeSnapshot(input());
    expect(commitmentFor(bytes, salt)).not.toBe(commitmentFor(bytes, newCommitmentSalt()));
  });

  it("cannot be verified without the salt that produced it", () => {
    const { bytes } = freezeSnapshot(input());
    expect(verifyCommitment(bytes, newCommitmentSalt(), commitmentFor(bytes, salt))).toBe(false);
  });

  it.each([
    ["a changed amount", () => input({ sides: [sideOf("CLAIM", "1500000001"), sideOf("SOURCE", "1200000000")] })],
    ["a changed scope", () => input({ balanceSheetScope: "BOTH" as const })],
    ["a changed tolerance", () => input({ tolerance: { amount: "1", unit: "IDR" as const } })],
    ["a changed label", () => input({ label: "Rekonsiliasi lain" })],
    [
      "a changed file reference",
      () =>
        input({
          files: [
            {
              id: "file-1",
              role: "CLAIM" as const,
              fileName: "kinerja.csv",
              mimeType: "text/csv",
              sizeBytes: 12,
              contentSha256: `0x${"ab".repeat(32)}`,
              storageStatus: "STORED" as const,
              failureReason: null,
            },
          ],
        }),
    ],
  ])("changes when %s changes", (_name, mutate) => {
    const original = commitmentFor(freezeSnapshot(input()).bytes, salt);
    expect(commitmentFor(freezeSnapshot(mutate()).bytes, salt)).not.toBe(original);
  });
});

describe("the public summary", () => {
  const built = () => {
    const salt = newCommitmentSalt();
    const source = input();
    source.sides[1]!.manifest.transactionDetail = "NOT_AVAILABLE";
    const { snapshot, bytes } = freezeSnapshot(source);
    return publicSummaryOf(snapshot, {
      commitment: commitmentFor(bytes, salt),
      outcome: "RECONCILED",
      netDelta: { amount: "300000000", unit: "IDR" },
      absoluteDelta: { amount: "300000000", unit: "IDR" },
      findingCounts: { AMOUNT_MISMATCH: 1 },
      salt,
    });
  };

  it("says which institution, period and version a reader is looking at", () => {
    const summary = built();
    expect(summary.institutionId).toBe("lpz-sinar-amanah");
    expect(summary.period).toEqual({ kind: "AKHIR_TAHUN", year: 2024 });
    expect(summary.format).toBe(SNAPSHOT_FORMAT);
    expect(summary.version).toBe(SNAPSHOT_VERSION);
  });

  it("shows the unresolved discrepancies and the limits of the examination", () => {
    const summary = built();
    expect(summary.findingCounts).toEqual({ AMOUNT_MISMATCH: 1 });
    expect(summary.netDelta).toEqual({ amount: "300000000", unit: "IDR" });
    expect(summary.coverageNotes).toEqual(["Sisi sumber berupa rekap tanpa rincian transaksi."]);
  });

  it("describes each source's provenance without carrying a single row of it", () => {
    const summary = built();
    const claim = summary.sides.find((side) => side.role === "CLAIM")!;
    expect(claim.cutOff).toBe("2025-02-11T00:00:00.000Z");
    expect(claim.rowCount).toBe(1);
    expect(JSON.stringify(summary)).not.toContain("Sartika");
    expect(JSON.stringify(summary)).not.toContain("1500000000");
  });

  it("never carries the salt, the storage location, or anything that unlocks the private package", () => {
    const salt = newCommitmentSalt();
    const { snapshot, bytes } = freezeSnapshot(input());
    const summary = publicSummaryOf(snapshot, {
      commitment: commitmentFor(bytes, salt),
      outcome: "RECONCILED",
      netDelta: { amount: "0", unit: "IDR" },
      absoluteDelta: { amount: "0", unit: "IDR" },
      findingCounts: {},
      salt,
    });

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(salt.slice(2));
    expect(serialized).not.toContain("storageRef");
    expect((summary as Record<string, unknown>).salt).toBeUndefined();
    expect(summary.commitmentScheme).toBe("HMAC-SHA256");
  });

  it("carries a digest of its own, so the public part can be checked on its own terms", () => {
    const summary = built();
    expect(summary.summaryDigest).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

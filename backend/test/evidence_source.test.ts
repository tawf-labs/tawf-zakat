/**
 * Normalising a submitted ledger side into a source that can be frozen
 * (Spec #68, ticket #70).
 *
 * Two things are being pinned here. First, that a manifest travels with every
 * source - where it came from, whose it is, what it covers, as of when, in
 * which format - because a row of numbers with no provenance is not evidence.
 * Second, that malformed input is refused by row, with something the person who
 * pasted it can actually act on, rather than dropped silently or collapsed into
 * one first-error message.
 */

import { describe, expect, it } from "bun:test";
import {
  coverageNotesFor,
  entriesFrom,
  normalizeSide,
  rowsFrom,
  type SubmittedSide,
} from "../src/evidence-source";

const MANIFEST = {
  label: "Laporan Kinerja LPZ Sinar Amanah",
  origin: "UPLOAD",
  scopeUnit: "Pusat",
  scopeLevel: "PUSAT",
  fundTypes: ["ZAKAT", "INFAK_SEDEKAH"],
  balanceSheet: "ON",
  currencyUnit: "IDR",
  period: { kind: "AKHIR_TAHUN", year: 2024 },
  cutOff: "2025-02-11T00:00:00.000Z",
  format: "baris-ledger",
  mappingVersion: "1",
  transactionDetail: "PRESENT",
};

const row = (key: string, bucket: string, amount: string, extra: Record<string, unknown> = {}) => ({
  key,
  bucket,
  balanceSheet: "ON",
  value: { amount, unit: "IDR" },
  ...extra,
});

const submit = (overrides: Record<string, unknown> = {}) =>
  normalizeSide(
    {
      manifest: { ...MANIFEST, ...((overrides.manifest as object) ?? {}) },
      ...("rows" in overrides
        ? (overrides.rows === undefined ? {} : { rows: overrides.rows })
        : { rows: [row("PZ-1401", "ZAKAT", "1500000000")] }),
      ...(overrides.declaredTotals !== undefined ? { declaredTotals: overrides.declaredTotals } : {}),
      ...(overrides.status !== undefined ? { status: overrides.status } : {}),
      ...(overrides.detail !== undefined ? { detail: overrides.detail } : {}),
    },
    "CLAIM",
    "lpz-sinar-amanah"
  );

const ok = (result: ReturnType<typeof normalizeSide>): SubmittedSide => {
  expect(result.issues).toEqual([]);
  expect(result.side).not.toBeNull();
  return result.side!;
};

describe("normalizing a submitted ledger side", () => {
  it("keeps the manifest that says where the source came from and what it covers", () => {
    const side = ok(submit());
    expect(side.manifest).toEqual({
      role: "CLAIM",
      label: "Laporan Kinerja LPZ Sinar Amanah",
      origin: "UPLOAD",
      institutionId: "lpz-sinar-amanah",
      scopeUnit: "Pusat",
      scopeLevel: "PUSAT",
      fundTypes: ["ZAKAT", "INFAK_SEDEKAH"],
      balanceSheet: "ON",
      currencyUnit: "IDR",
      period: { kind: "AKHIR_TAHUN", year: 2024 },
      cutOff: "2025-02-11T00:00:00.000Z",
      format: "baris-ledger",
      mappingVersion: "1",
      transactionDetail: "PRESENT",
      note: null,
    });
  });

  it("owns the source to the session's institution, not to whatever the payload names", () => {
    const side = ok(submit({ manifest: { institutionId: "lpz-baitul-maal" } }));
    expect(side.manifest.institutionId).toBe("lpz-sinar-amanah");
  });

  it("keeps fund type and balance-sheet position on every normalized row", () => {
    const side = ok(
      submit({
        rows: [
          row("PZ-1401", "ZAKAT", "1500000000"),
          { ...row("PZ-1401", "INFAK_SEDEKAH", "40000000"), balanceSheet: "OFF" },
        ],
        manifest: { balanceSheet: "BOTH" },
      })
    );

    expect(rowsFrom(side)).toEqual([
      {
        key: "PZ-1401",
        bucket: "ZAKAT",
        balanceSheet: "ON",
        amount: "1500000000",
        unit: "IDR",
        amilAmount: null,
        label: null,
        isDeclaredTotal: false,
      },
      {
        key: "PZ-1401",
        bucket: "INFAK_SEDEKAH",
        balanceSheet: "OFF",
        amount: "40000000",
        unit: "IDR",
        amilAmount: null,
        label: null,
        isDeclaredTotal: false,
      },
    ]);
  });

  it("keeps trillion-scale rupiah exact, as an integer and never as a float", () => {
    const side = ok(submit({ rows: [row("PZ-NAS", "ZAKAT", "11622127523247")] }));
    expect(rowsFrom(side)[0]!.amount).toBe("11622127523247");
    expect(entriesFrom(side).entries[0]!.value.amount).toBe(11_622_127_523_247n);
  });

  it("reads native USDC amounts literally, with no magnitude heuristic", () => {
    const usdc = (amount: string) => ({
      key: `DEP-${amount}`,
      bucket: "ZAKAT",
      balanceSheet: "ON",
      value: { amount, unit: "USDC_6DP" },
    });

    const side = ok(
      submit({
        manifest: { currencyUnit: "USDC_6DP" },
        rows: [usdc("500000"), usdc("1000000"), usdc("1500000")],
      })
    );

    expect(entriesFrom(side).entries.map((entry) => entry.value.amount)).toEqual([
      500_000n,
      1_000_000n,
      1_500_000n,
    ]);
  });

  it("refuses a row whose unit is not the one its manifest declares", () => {
    const { issues } = submit({
      rows: [{ ...row("PZ-1401", "ZAKAT", "1000"), value: { amount: "1000", unit: "USDC_6DP" } }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ scope: "row", rowIndex: 0, field: "value.unit" });
    expect(issues[0]!.message).toMatch(/IDR/);
  });

  it("reports every malformed row, not only the first, with its index and field", () => {
    const { side, issues } = submit({
      rows: [
        row("", "ZAKAT", "1000"),
        row("PZ-2", "TIDAK_DIKENAL", "1000"),
        row("PZ-3", "ZAKAT", "1.500,00"),
      ],
    });

    expect(side).toBeNull();
    expect(issues.map((issue) => [issue.rowIndex, issue.field])).toEqual([
      [0, "key"],
      [1, "bucket"],
      [2, "value.amount"],
    ]);
    for (const issue of issues) expect(issue.message.length).toBeGreaterThan(10);
  });

  it("refuses a negative amount rather than reading it as a correction", () => {
    const { issues } = submit({ rows: [row("PZ-1", "ZAKAT", "-1000")] });
    expect(issues[0]).toMatchObject({ rowIndex: 0, field: "value.amount" });
  });

  it("refuses a row whose fund type the manifest did not declare it covers", () => {
    const { issues } = submit({ rows: [row("PZ-1", "KURBAN", "1000")] });
    expect(issues[0]).toMatchObject({ rowIndex: 0, field: "bucket" });
    expect(issues[0]!.message).toMatch(/cakupan/i);
  });

  it("refuses a row on a balance-sheet position outside the declared coverage", () => {
    const { issues } = submit({
      rows: [{ ...row("PZ-1", "ZAKAT", "1000"), balanceSheet: "OFF" }],
    });
    expect(issues[0]).toMatchObject({ rowIndex: 0, field: "balanceSheet" });
  });

  it("names each missing manifest field rather than failing on the first", () => {
    const { issues } = submit({
      manifest: { cutOff: undefined, format: "", mappingVersion: undefined, origin: "SIMBA" },
    });
    const fields = issues.map((issue) => issue.field);
    expect(fields).toContain("manifest.cutOff");
    expect(fields).toContain("manifest.format");
    expect(fields).toContain("manifest.mappingVersion");
    expect(fields).toContain("manifest.origin");
    expect(issues.every((issue) => issue.scope === "manifest")).toBe(true);
  });

  it("refuses a cut-off that is not an instant, so coverage cannot be read two ways", () => {
    const { issues } = submit({ manifest: { cutOff: "11 Februari 2025" } });
    expect(issues[0]).toMatchObject({ field: "manifest.cutOff" });
  });

  it("carries declared totals through as totals, kept apart from the entries", () => {
    const side = ok(
      submit({
        declaredTotals: [row("TOTAL", "GRAND_TOTAL", "1500000000")],
      })
    );

    const totals = rowsFrom(side).filter((r) => r.isDeclaredTotal);
    expect(totals).toHaveLength(1);
    expect(totals[0]!.bucket).toBe("GRAND_TOTAL");
    expect(entriesFrom(side).declaredTotals).toHaveLength(1);
    expect(entriesFrom(side).entries).toHaveLength(1);
  });
});

describe("a side that could not be read", () => {
  it("is accepted as a declared absence, with its manifest and reason kept", () => {
    const side = ok(submit({ status: "MISSING", detail: "Laporan kabupaten belum dikirim.", rows: undefined }));
    expect(side.status).toBe("MISSING");
    if (side.status !== "READ") expect(side.detail).toBe("Laporan kabupaten belum dikirim.");
  });

  it("refuses an absence with no reason, because the reason is the evidence", () => {
    const { issues } = submit({ status: "FAILED", detail: "  ", rows: undefined });
    expect(issues[0]).toMatchObject({ field: "detail" });
  });

  it("never carries rows, so an unread source cannot arrive holding data", () => {
    const side = ok(submit({ status: "FAILED", detail: "Basis data mitra menolak koneksi.", rows: undefined }));
    expect(rowsFrom(side)).toEqual([]);
  });
});

describe("coverage notes", () => {
  const readSide = (role: "CLAIM" | "SOURCE", overrides: Record<string, unknown> = {}) =>
    normalizeSide(
      { manifest: { ...MANIFEST, ...((overrides.manifest as object) ?? {}) }, rows: [row("PZ-1", "ZAKAT", "1000")] },
      role,
      "lpz-sinar-amanah"
    ).side!;

  it("says plainly when an aggregate source cannot evidence individual payments", () => {
    const notes = coverageNotesFor([
      readSide("CLAIM", { manifest: { transactionDetail: "NOT_AVAILABLE" } }),
      readSide("SOURCE"),
    ]);
    expect(notes.some((note) => /rincian transaksi/i.test(note))).toBe(true);
  });

  it("names the scope left unexamined when a side was not read", () => {
    const unread = normalizeSide(
      { manifest: MANIFEST, status: "FAILED", detail: "koneksi mitra gagal" },
      "SOURCE",
      "lpz-sinar-amanah"
    ).side!;

    const notes = coverageNotesFor([readSide("CLAIM"), unread]);
    expect(notes.some((note) => /gagal/i.test(note) && /koneksi mitra gagal/.test(note))).toBe(true);
  });

  it("says nothing alarming when both sides were read in full", () => {
    expect(coverageNotesFor([readSide("CLAIM"), readSide("SOURCE")])).toEqual([]);
  });
});

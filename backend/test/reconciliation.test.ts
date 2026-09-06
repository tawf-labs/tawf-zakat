import { describe, expect, it } from "bun:test";
import {
  reconcile,
  GRAND_TOTAL_BUCKET,
  type LedgerEntry,
  type LedgerSide,
  type Money,
  type ReconciliationOptions,
} from "../src/reconciliation";

const idr = (amount: bigint): Money => ({ amount, unit: "IDR" });

const entry = (
  key: string,
  bucket: string,
  amount: bigint,
  overrides: Partial<LedgerEntry> = {}
): LedgerEntry => ({
  key,
  bucket,
  balanceSheet: "ON",
  value: idr(amount),
  ...overrides,
});

const side = (label: string, entries: LedgerEntry[], declaredTotals?: LedgerEntry[]): LedgerSide => ({
  label,
  entries,
  ...(declaredTotals ? { declaredTotals } : {}),
});

const AKHIR_TAHUN_2024: ReconciliationOptions = {
  period: { kind: "AKHIR_TAHUN", year: 2024 },
};

describe("Reconciliation Engine — pure core", () => {
  it("reports two identical sides as balanced with no discrepancies", () => {
    const entries = [
      entry("PZ-1401", "ZAKAT", 1_500_000_000n),
      entry("PZ-1402", "INFAK_SEDEKAH", 240_000_000n),
    ];

    const report = reconcile(
      side("Rekap Wilayah Riau", entries),
      side("12 Laporan Kab/Kota", entries.map((e) => ({ ...e }))),
      AKHIR_TAHUN_2024
    );

    expect(report.balanced).toBe(true);
    expect(report.discrepancies).toEqual([]);
    expect(report.netDelta).toEqual(idr(0n));
    expect(report.absoluteDelta).toEqual(idr(0n));
    expect(report.entryCounts).toEqual({ claim: 2, source: 2, matched: 2 });
    expect(report.claimLabel).toBe("Rekap Wilayah Riau");
    expect(report.sourceLabel).toBe("12 Laporan Kab/Kota");
    expect(report.period).toEqual({ kind: "AKHIR_TAHUN", year: 2024 });
  });

  it("detects AMOUNT_MISMATCH with delta signed as claim minus source", () => {
    const report = reconcile(
      side("Rekap", [entry("PZ-1401", "ZAKAT", 1_500_000_000n, { label: "BAZNAS Kab. Kampar" })]),
      side("Laporan", [entry("PZ-1401", "ZAKAT", 1_200_000_000n, { label: "BAZNAS Kab. Kampar" })]),
      AKHIR_TAHUN_2024
    );

    expect(report.balanced).toBe(false);
    expect(report.discrepancies).toHaveLength(1);
    const [d] = report.discrepancies;
    expect(d.kind).toBe("AMOUNT_MISMATCH");
    expect(d.key).toBe("PZ-1401");
    expect(d.bucket).toBe("ZAKAT");
    expect(d.delta).toEqual(idr(300_000_000n));
    expect(d.claimValue).toEqual(idr(1_500_000_000n));
    expect(d.sourceValue).toEqual(idr(1_200_000_000n));
    expect(d.label).toBe("BAZNAS Kab. Kampar");
    expect(report.netDelta).toEqual(idr(300_000_000n));
    expect(report.absoluteDelta).toEqual(idr(300_000_000n));
  });

  it("detects a claim smaller than its source with a negative delta", () => {
    const report = reconcile(
      side("Rekap", [entry("PZ-1401", "ZAKAT", 900_000_000n)]),
      side("Laporan", [entry("PZ-1401", "ZAKAT", 1_000_000_000n)]),
      AKHIR_TAHUN_2024
    );

    expect(report.discrepancies[0].delta).toEqual(idr(-100_000_000n));
    expect(report.netDelta).toEqual(idr(-100_000_000n));
    expect(report.absoluteDelta).toEqual(idr(100_000_000n));
  });

  it("detects MISSING_IN_CLAIM when a reporting institution is absent from the recap", () => {
    const report = reconcile(
      side("Rekap", [entry("PZ-1401", "ZAKAT", 1_000_000_000n)]),
      side("Laporan", [
        entry("PZ-1401", "ZAKAT", 1_000_000_000n),
        entry("PZ-1471", "ZAKAT", 750_000_000n, { label: "BAZNAS Kota Pekanbaru" }),
      ]),
      AKHIR_TAHUN_2024
    );

    expect(report.discrepancies).toHaveLength(1);
    const [d] = report.discrepancies;
    expect(d.kind).toBe("MISSING_IN_CLAIM");
    expect(d.key).toBe("PZ-1471");
    expect(d.delta).toEqual(idr(-750_000_000n));
    expect(d.sourceValue).toEqual(idr(750_000_000n));
    expect(d.claimValue).toBeUndefined();
    expect(d.label).toBe("BAZNAS Kota Pekanbaru");
    expect(report.entryCounts).toEqual({ claim: 1, source: 2, matched: 1 });
  });

  it("detects MISSING_IN_SOURCE when the recap carries an institution that never reported", () => {
    const report = reconcile(
      side("Rekap", [
        entry("PZ-1401", "ZAKAT", 1_000_000_000n),
        entry("PZ-1403", "ZAKAT", 300_000_000n),
      ]),
      side("Laporan", [entry("PZ-1401", "ZAKAT", 1_000_000_000n)]),
      AKHIR_TAHUN_2024
    );

    expect(report.discrepancies).toHaveLength(1);
    const [d] = report.discrepancies;
    expect(d.kind).toBe("MISSING_IN_SOURCE");
    expect(d.key).toBe("PZ-1403");
    expect(d.delta).toEqual(idr(300_000_000n));
    expect(d.claimValue).toEqual(idr(300_000_000n));
    expect(d.sourceValue).toBeUndefined();
  });

  it("matches on key, bucket and balance sheet together — not on key alone", () => {
    const claim = side("Rekap", [
      entry("PZ-1401", "ZAKAT", 1_000_000_000n),
      entry("PZ-1401", "INFAK_SEDEKAH", 200_000_000n),
      entry("PZ-1401", "INFAK_SEDEKAH", 50_000_000n, { balanceSheet: "OFF" }),
    ]);
    const source = side("Laporan", [
      entry("PZ-1401", "ZAKAT", 1_000_000_000n),
      entry("PZ-1401", "INFAK_SEDEKAH", 200_000_000n),
      entry("PZ-1401", "INFAK_SEDEKAH", 70_000_000n, { balanceSheet: "OFF" }),
    ]);

    const report = reconcile(claim, source, AKHIR_TAHUN_2024);

    expect(report.entryCounts.matched).toBe(3);
    expect(report.discrepancies).toHaveLength(1);
    expect(report.discrepancies[0].delta).toEqual(idr(-20_000_000n));
  });

  it("keeps on and off balance sheet funds apart instead of matching across them", () => {
    const report = reconcile(
      side("Rekap", [entry("PZ-1401", "ZAKAT", 500_000_000n, { balanceSheet: "ON" })]),
      side("Laporan", [entry("PZ-1401", "ZAKAT", 500_000_000n, { balanceSheet: "OFF" })]),
      AKHIR_TAHUN_2024
    );

    expect(report.discrepancies.map((d) => d.kind).sort()).toEqual([
      "MISSING_IN_CLAIM",
      "MISSING_IN_SOURCE",
    ]);
  });

  it("hides differences below the tolerance but never one sitting exactly on it", () => {
    const options: ReconciliationOptions = { ...AKHIR_TAHUN_2024, tolerance: idr(1_000n) };

    const report = reconcile(
      side("Rekap", [
        entry("PZ-BELOW", "ZAKAT", 10_000_999n),
        entry("PZ-EXACT", "ZAKAT", 10_001_000n),
      ]),
      side("Laporan", [
        entry("PZ-BELOW", "ZAKAT", 10_000_000n),
        entry("PZ-EXACT", "ZAKAT", 10_000_000n),
      ]),
      options
    );

    expect(report.discrepancies).toHaveLength(1);
    expect(report.discrepancies[0].key).toBe("PZ-EXACT");
    expect(report.discrepancies[0].delta).toEqual(idr(1_000n));
  });

  it("reports many small opposing differences one by one instead of cancelling them out", () => {
    const claim = side("Rekap", [
      entry("PZ-A", "ZAKAT", 1_000_000n),
      entry("PZ-B", "ZAKAT", 2_000_000n),
      entry("PZ-C", "ZAKAT", 3_000_000n),
    ]);
    const source = side("Laporan", [
      entry("PZ-A", "ZAKAT", 1_500_000n),
      entry("PZ-B", "ZAKAT", 1_500_000n),
      entry("PZ-C", "ZAKAT", 3_000_000n),
    ]);

    const report = reconcile(claim, source, AKHIR_TAHUN_2024);

    expect(report.discrepancies).toHaveLength(2);
    expect(report.netDelta).toEqual(idr(0n));
    expect(report.absoluteDelta).toEqual(idr(1_000_000n));
    expect(report.balanced).toBe(false);
  });

  it("reconciles national-scale figures without losing precision", () => {
    const report = reconcile(
      side("Tabel 2.2", [entry("NASIONAL", "ZAKAT", 11_622_127_523_247n)]),
      side("Tabel 2.3", [entry("NASIONAL", "ZAKAT", 10_954_107_312_973n)]),
      AKHIR_TAHUN_2024
    );

    expect(report.discrepancies[0].delta).toEqual(idr(668_020_210_274n));
    expect(report.netDelta).toEqual(idr(668_020_210_274n));
  });

  it("orders discrepancies by absolute delta descending, then key ascending", () => {
    const claim = side("Rekap", [
      entry("PZ-Z", "ZAKAT", 500_000n),
      entry("PZ-A", "ZAKAT", 9_000_000n),
      entry("PZ-M", "ZAKAT", 500_000n),
      entry("PZ-B", "ZAKAT", 4_000_000n),
    ]);
    const source = side("Laporan", [
      entry("PZ-Z", "ZAKAT", 0n),
      entry("PZ-A", "ZAKAT", 0n),
      entry("PZ-M", "ZAKAT", 0n),
      entry("PZ-B", "ZAKAT", 0n),
    ]);

    const report = reconcile(claim, source, AKHIR_TAHUN_2024);

    expect(report.discrepancies.map((d) => d.key)).toEqual(["PZ-A", "PZ-B", "PZ-M", "PZ-Z"]);
  });

  it("produces an identical report when the input entries are shuffled", () => {
    const claimEntries = [
      entry("PZ-1401", "ZAKAT", 1_000_000_000n),
      entry("PZ-1402", "INFAK_SEDEKAH", 250_000_000n),
      entry("PZ-1403", "FITRAH", 75_000_000n),
      entry("PZ-1404", "DSKL", 12_500_000n),
    ];
    const sourceEntries = [
      entry("PZ-1401", "ZAKAT", 900_000_000n),
      entry("PZ-1402", "INFAK_SEDEKAH", 250_000_000n),
      entry("PZ-1403", "FITRAH", 80_000_000n),
      entry("PZ-1405", "KURBAN", 30_000_000n),
    ];

    const straight = reconcile(side("C", claimEntries), side("S", sourceEntries), AKHIR_TAHUN_2024);
    const shuffled = reconcile(
      side("C", [...claimEntries].reverse()),
      side("S", [sourceEntries[2], sourceEntries[0], sourceEntries[3], sourceEntries[1]]),
      AKHIR_TAHUN_2024
    );

    expect(shuffled).toEqual(straight);
  });

  it("refuses to add money of different units instead of converting silently", () => {
    expect(() =>
      reconcile(
        side("Rekap", [
          entry("PZ-1401", "ZAKAT", 1_000_000_000n),
          entry("PZ-1402", "ZAKAT", 5_000_000n, { value: { amount: 5_000_000n, unit: "USDC_6DP" } }),
        ]),
        side("Laporan", [entry("PZ-1401", "ZAKAT", 1_000_000_000n)]),
        AKHIR_TAHUN_2024
      )
    ).toThrow(/unit/i);
  });

  it("rejects a tolerance denominated in another unit", () => {
    expect(() =>
      reconcile(
        side("Rekap", [entry("PZ-1401", "ZAKAT", 1_000n)]),
        side("Laporan", [entry("PZ-1401", "ZAKAT", 1_000n)]),
        { ...AKHIR_TAHUN_2024, tolerance: { amount: 1n, unit: "USDC_6DP" } }
      )
    ).toThrow(/unit/i);
  });

  it("rejects an unknown jenis dana, naming the row index and key", () => {
    expect(() =>
      reconcile(
        side("Rekap", [entry("PZ-1401", "ZAKAT", 1_000n), entry("PZ-1402", "SAHAM", 2_000n)]),
        side("Laporan", []),
        AKHIR_TAHUN_2024
      )
    ).toThrow(/index 1.*PZ-1402|PZ-1402.*index 1/s);
  });

  it("rejects a negative amount, naming the row index and key", () => {
    expect(() =>
      reconcile(
        side("Rekap", [entry("PZ-1401", "ZAKAT", -5n)]),
        side("Laporan", []),
        AKHIR_TAHUN_2024
      )
    ).toThrow(/index 0.*PZ-1401|PZ-1401.*index 0/s);
  });

  it("accepts bucket dimensions declared by the caller, such as jenis Pengelola Zakat", () => {
    const options: ReconciliationOptions = {
      ...AKHIR_TAHUN_2024,
      allowedBuckets: ["BAZNAS_PUSAT", "BAZNAS_PROVINSI"],
    };

    const report = reconcile(
      side("Tabel 2.3", [entry("NASIONAL", "BAZNAS_PUSAT", 1_000n)]),
      side("Tabel 2.2", [entry("NASIONAL", "BAZNAS_PUSAT", 1_000n)]),
      options
    );

    expect(report.balanced).toBe(true);
  });

  it("treats GRAND_TOTAL as a reserved bucket usable in declared totals", () => {
    const report = reconcile(
      side("Rekap", [entry("PZ-1401", "ZAKAT", 1_000n)], [
        entry("TOTAL", GRAND_TOTAL_BUCKET, 1_000n),
      ]),
      side("Laporan", [entry("PZ-1401", "ZAKAT", 1_000n)]),
      AKHIR_TAHUN_2024
    );

    expect(report.balanced).toBe(true);
  });
});

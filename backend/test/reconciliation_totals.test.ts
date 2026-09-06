import { describe, expect, it } from "bun:test";
import {
  reconcile,
  GRAND_TOTAL_BUCKET,
  type LedgerEntry,
  type LedgerSide,
  type Money,
  type ReconciliationOptions,
} from "../src/reconciliation";
import {
  LPZN_2024_BUCKETS,
  LPZN_2024_PERIOD,
  TABEL_2_2_PER_JENIS_DANA,
  TABEL_2_3_PER_JENIS_PENGELOLA_ZAKAT,
  SELISIH_ON_BALANCE_SHEET_2024,
  SELISIH_OFF_BALANCE_SHEET_2024,
} from "../src/fixtures/lpzn-2024";

const idr = (amount: bigint): Money => ({ amount, unit: "IDR" });

const entry = (
  key: string,
  bucket: string,
  amount: bigint,
  overrides: Partial<LedgerEntry> = {}
): LedgerEntry => ({ key, bucket, balanceSheet: "ON", value: idr(amount), ...overrides });

const side = (label: string, entries: LedgerEntry[], declaredTotals?: LedgerEntry[]): LedgerSide => ({
  label,
  entries,
  ...(declaredTotals ? { declaredTotals } : {}),
});

const AKHIR_TAHUN_2024: ReconciliationOptions = { period: { kind: "AKHIR_TAHUN", year: 2024 } };

const kindsOf = (report: { discrepancies: Array<{ kind: string }> }) =>
  report.discrepancies.map((d) => d.kind);

describe("Reconciliation Engine - total integrity", () => {
  it("detects a bucket total that does not equal the sum of its own entries", () => {
    const claim = side(
      "Rekap Wilayah Riau",
      [entry("PZ-1401", "ZAKAT", 600_000_000n), entry("PZ-1471", "ZAKAT", 400_000_000n)],
      [entry("TOTAL-ZAKAT", "ZAKAT", 1_050_000_000n)]
    );
    const source = side("Laporan", [
      entry("PZ-1401", "ZAKAT", 600_000_000n),
      entry("PZ-1471", "ZAKAT", 400_000_000n),
    ]);

    const report = reconcile(claim, source, AKHIR_TAHUN_2024);

    expect(kindsOf(report)).toEqual(["BUCKET_TOTAL_MISMATCH"]);
    const [d] = report.discrepancies;
    expect(d.bucket).toBe("ZAKAT");
    expect(d.delta).toEqual(idr(50_000_000n));
    expect(d.claimValue).toEqual(idr(1_050_000_000n));
    expect(d.sourceValue).toEqual(idr(1_000_000_000n));
    expect(d.label).toBe("Rekap Wilayah Riau");
  });

  it("detects a grand total that does not equal the sum of all buckets", () => {
    const claim = side(
      "Rekap Wilayah Riau",
      [
        entry("PZ-1401", "ZAKAT", 600_000_000n),
        entry("PZ-1401", "INFAK_SEDEKAH", 150_000_000n),
      ],
      [entry("GRAND-TOTAL", GRAND_TOTAL_BUCKET, 800_000_000n)]
    );

    const report = reconcile(claim, side("Laporan", claim.entries.map((e) => ({ ...e }))), AKHIR_TAHUN_2024);

    expect(kindsOf(report)).toEqual(["GRAND_TOTAL_MISMATCH"]);
    expect(report.discrepancies[0].delta).toEqual(idr(50_000_000n));
  });

  it("checks grand totals separately for each balance sheet position", () => {
    const claim = side(
      "Rekap",
      [
        entry("PZ-1401", "ZAKAT", 600_000_000n),
        entry("PZ-1401", "INFAK_SEDEKAH", 200_000_000n, { balanceSheet: "OFF" }),
      ],
      [
        entry("TOTAL-ON", GRAND_TOTAL_BUCKET, 600_000_000n),
        entry("TOTAL-OFF", GRAND_TOTAL_BUCKET, 250_000_000n, { balanceSheet: "OFF" }),
      ]
    );

    const report = reconcile(claim, side("Laporan", claim.entries.map((e) => ({ ...e }))), AKHIR_TAHUN_2024);

    // The ON total is right; only the OFF total is wrong, and a surplus off the
    // balance sheet must not be cancelled by the balance sheet side.
    expect(report.discrepancies).toHaveLength(1);
    expect(report.discrepancies[0].key).toBe("TOTAL-OFF");
    expect(report.discrepancies[0].delta).toEqual(idr(50_000_000n));
  });

  it("reports a repeated key without silently doubling its value", () => {
    const claim = side(
      "Rekap",
      [
        entry("PZ-1401", "ZAKAT", 600_000_000n, { label: "BAZNAS Kab. Kampar" }),
        entry("PZ-1401", "ZAKAT", 600_000_000n, { label: "BAZNAS Kab. Kampar" }),
      ],
      [entry("TOTAL-ZAKAT", "ZAKAT", 600_000_000n)]
    );
    const source = side("Laporan", [entry("PZ-1401", "ZAKAT", 600_000_000n)]);

    const report = reconcile(claim, source, AKHIR_TAHUN_2024);

    expect(kindsOf(report)).toEqual(["DUPLICATE_KEY"]);
    const [d] = report.discrepancies;
    expect(d.key).toBe("PZ-1401");
    expect(d.delta).toEqual(idr(600_000_000n));
    // The entry itself still matched at its stated value, and the declared total
    // still agrees with the deduplicated sum.
    expect(report.entryCounts.matched).toBe(1);
    expect(report.netDelta).toEqual(idr(0n));
  });

  it("keeps total findings out of the entry-level net and absolute deltas", () => {
    const claim = side(
      "Rekap",
      [entry("PZ-1401", "ZAKAT", 600_000_000n)],
      [entry("TOTAL-ZAKAT", "ZAKAT", 900_000_000n)]
    );
    const source = side("Laporan", [entry("PZ-1401", "ZAKAT", 500_000_000n)]);

    const report = reconcile(claim, source, AKHIR_TAHUN_2024);

    expect(kindsOf(report).sort()).toEqual(["AMOUNT_MISMATCH", "BUCKET_TOTAL_MISMATCH"]);
    expect(report.netDelta).toEqual(idr(100_000_000n));
    expect(report.absoluteDelta).toEqual(idr(100_000_000n));
  });

  it("orders total findings alongside entry findings by the same deterministic rule", () => {
    const claim = side(
      "Rekap",
      [entry("PZ-1401", "ZAKAT", 600_000_000n), entry("PZ-1471", "ZAKAT", 100_000_000n)],
      [entry("TOTAL-ZAKAT", "ZAKAT", 1_400_000_000n)]
    );
    const source = side("Laporan", [
      entry("PZ-1401", "ZAKAT", 500_000_000n),
      entry("PZ-1471", "ZAKAT", 100_000_000n),
    ]);

    const report = reconcile(claim, source, AKHIR_TAHUN_2024);

    // Rp700.000.000 total gap outranks the Rp100.000.000 entry gap.
    expect(report.discrepancies.map((d) => [d.kind, d.delta.amount.toString()])).toEqual([
      ["BUCKET_TOTAL_MISMATCH", "700000000"],
      ["AMOUNT_MISMATCH", "100000000"],
    ]);
  });

  it("compares the grand total each side prints for itself", () => {
    const claim = side("Rekap", [entry("PZ-1401", "ZAKAT", 600_000_000n)], [
      entry("TOTAL-ON", GRAND_TOTAL_BUCKET, 600_000_000n),
    ]);
    const source = side("Laporan", [entry("PZ-1401", "ZAKAT", 500_000_000n)], [
      entry("TOTAL-ON", GRAND_TOTAL_BUCKET, 500_000_000n),
    ]);

    const report = reconcile(claim, source, AKHIR_TAHUN_2024);
    const crossSide = report.discrepancies.find((d) => d.key === "GRAND_TOTAL:ON");

    expect(crossSide).toBeDefined();
    expect(crossSide!.kind).toBe("GRAND_TOTAL_MISMATCH");
    expect(crossSide!.delta).toEqual(idr(100_000_000n));
    expect(crossSide!.claimValue).toEqual(idr(600_000_000n));
    expect(crossSide!.sourceValue).toEqual(idr(500_000_000n));
    expect(crossSide!.label).toBe("Rekap vs Laporan");
    // The entries underneath are already counted, so this stays out of the net.
    expect(report.netDelta).toEqual(idr(100_000_000n));
  });

  it("compares grand totals per balance sheet position, never across them", () => {
    const declare = (on: bigint, off: bigint) => [
      entry("TOTAL-ON", GRAND_TOTAL_BUCKET, on),
      entry("TOTAL-OFF", GRAND_TOTAL_BUCKET, off, { balanceSheet: "OFF" }),
    ];

    const report = reconcile(
      side("Rekap", [], declare(1_000n, 5_000n)),
      side("Laporan", [], declare(1_400n, 4_600n)),
      AKHIR_TAHUN_2024
    );

    const crossSide = Object.fromEntries(
      report.discrepancies
        .filter((d) => d.key.startsWith("GRAND_TOTAL:"))
        .map((d) => [d.key, d.delta.amount])
    );
    // Claim is Rp400 short on balance sheet and Rp400 over off it. Netted
    // together they would vanish; per position both stay visible.
    expect(crossSide["GRAND_TOTAL:ON"]).toBe(-400n);
    expect(crossSide["GRAND_TOTAL:OFF"]).toBe(400n);
  });

  it("says nothing about grand totals when only one side declares one", () => {
    const report = reconcile(
      side("Rekap", [entry("PZ-1401", "ZAKAT", 1_000n)], [
        entry("TOTAL-ON", GRAND_TOTAL_BUCKET, 1_000n),
      ]),
      side("Laporan", [entry("PZ-1401", "ZAKAT", 1_000n)]),
      AKHIR_TAHUN_2024
    );

    expect(report.discrepancies).toEqual([]);
  });

  it("can be restricted to a single balance sheet position", () => {
    const claim = side("Rekap", [
      entry("PZ-1401", "ZAKAT", 600_000_000n),
      entry("PZ-1401", "INFAK_SEDEKAH", 200_000_000n, { balanceSheet: "OFF" }),
    ]);
    const source = side("Laporan", [
      entry("PZ-1401", "ZAKAT", 500_000_000n),
      entry("PZ-1401", "INFAK_SEDEKAH", 900_000_000n, { balanceSheet: "OFF" }),
    ]);

    const onlyOn = reconcile(claim, source, { ...AKHIR_TAHUN_2024, balanceSheet: "ON" });
    const onlyOff = reconcile(claim, source, { ...AKHIR_TAHUN_2024, balanceSheet: "OFF" });

    expect(onlyOn.netDelta).toEqual(idr(100_000_000n));
    expect(onlyOn.entryCounts).toEqual({ claim: 1, source: 1, matched: 1 });
    expect(onlyOff.netDelta).toEqual(idr(-700_000_000n));
  });
});

describe("Golden fixture - LPZN Akhir Tahun 2024", () => {
  const lpznOptions = (balanceSheet: "ON" | "OFF"): ReconciliationOptions => ({
    period: LPZN_2024_PERIOD,
    allowedBuckets: LPZN_2024_BUCKETS,
    balanceSheet,
  });

  it("finds exactly Rp668.020.210.274 between Tabel 2.2 and Tabel 2.3 on balance sheet", () => {
    const report = reconcile(
      TABEL_2_2_PER_JENIS_DANA,
      TABEL_2_3_PER_JENIS_PENGELOLA_ZAKAT,
      lpznOptions("ON")
    );

    expect(report.netDelta.amount).toBe(668_020_210_274n);
    expect(report.netDelta.amount).toBe(SELISIH_ON_BALANCE_SHEET_2024);
    expect(report.balanced).toBe(false);
  });

  it("finds the off balance sheet gap without it cancelling the on balance sheet gap", () => {
    const report = reconcile(
      TABEL_2_2_PER_JENIS_DANA,
      TABEL_2_3_PER_JENIS_PENGELOLA_ZAKAT,
      lpznOptions("OFF")
    );

    expect(report.netDelta.amount).toBe(-605_523_322_541n);
    expect(report.netDelta.amount).toBe(SELISIH_OFF_BALANCE_SHEET_2024);
  });

  it("shows both tables are internally consistent - each sums to its own printed total", () => {
    const selfCheck = (table: LedgerSide) =>
      reconcile(table, { label: `${table.label} (entri)`, entries: table.entries }, {
        period: LPZN_2024_PERIOD,
        allowedBuckets: LPZN_2024_BUCKETS,
      });

    for (const table of [TABEL_2_2_PER_JENIS_DANA, TABEL_2_3_PER_JENIS_PENGELOLA_ZAKAT]) {
      const report = selfCheck(table);
      expect(kindsOf(report)).toEqual([]);
      expect(report.balanced).toBe(true);
    }
  });

  it("compares grand totals even though the two tables use incomparable bucket dimensions", () => {
    const report = reconcile(
      TABEL_2_2_PER_JENIS_DANA,
      TABEL_2_3_PER_JENIS_PENGELOLA_ZAKAT,
      lpznOptions("ON")
    );

    // Not one jenis dana row can be matched against a jenis Pengelola Zakat row.
    expect(report.entryCounts.matched).toBe(0);

    // The two printed grand totals are still compared head to head, and that
    // comparison does not depend on the entries lining up at all.
    const crossSide = report.discrepancies.find((d) => d.key === "GRAND_TOTAL:ON");
    expect(crossSide).toBeDefined();
    expect(crossSide!.delta.amount).toBe(668_020_210_274n);
    expect(crossSide!.claimValue!.amount).toBe(11_622_127_523_247n);
    expect(crossSide!.sourceValue!.amount).toBe(10_954_107_312_973n);

    // And the entry-level net says the same, because both tables happen to be
    // internally consistent.
    expect(report.netDelta.amount).toBe(668_020_210_274n);
  });

  it("still compares the printed totals when a side's own arithmetic is broken", () => {
    // Tabel 2.2 with one row understated: its entries no longer sum to the
    // printed total, so the entry-level net alone would be misleading.
    const brokenClaim = {
      ...TABEL_2_2_PER_JENIS_DANA,
      entries: TABEL_2_2_PER_JENIS_DANA.entries.map((entry, index) =>
        index === 0 ? { ...entry, value: { ...entry.value, amount: 0n } } : entry
      ),
    };

    const report = reconcile(brokenClaim, TABEL_2_3_PER_JENIS_PENGELOLA_ZAKAT, lpznOptions("ON"));

    const crossSide = report.discrepancies.find((d) => d.key === "GRAND_TOTAL:ON");
    expect(crossSide!.delta.amount).toBe(668_020_210_274n);

    const ownArithmetic = report.discrepancies.find(
      (d) => d.kind === "GRAND_TOTAL_MISMATCH" && d.key === "TOTAL-ON-2.2"
    );
    expect(ownArithmetic!.delta.amount).toBe(4_350_099_606_318n);
  });

  it("records where every fixture figure came from", () => {
    for (const table of [TABEL_2_2_PER_JENIS_DANA, TABEL_2_3_PER_JENIS_PENGELOLA_ZAKAT]) {
      for (const row of [...table.entries, ...(table.declaredTotals ?? [])]) {
        expect(row.label && row.label.length).toBeGreaterThan(0);
      }
    }
  });
});

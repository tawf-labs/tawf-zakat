import { describe, expect, it } from "bun:test";
import { reconcile, type LedgerEntry, type LedgerSide, type Money } from "../src/reconciliation";

const idr = (amount: bigint): Money => ({ amount, unit: "IDR" });
const period = { kind: "AKHIR_TAHUN", year: 2026 } as const;
const row = (key: string, amount: bigint, amil?: bigint, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
  key, bucket: "ZAKAT", balanceSheet: "ON", value: idr(amount),
  ...(amil === undefined ? {} : { amilAmount: idr(amil) }), ...extra,
});
const side = (entries: LedgerEntry[]): LedgerSide => ({ label: "Laporan", entries });

describe("Plafon hak amil dalam rekonsiliasi", () => {
  it("menangkap kelebihan Rp1 meski kedua sisi cocok dan toleransi besar", () => {
    const ledger = side([row("PZ-1", 100_000_000n, 12_500_001n)]);
    const report = reconcile(ledger, ledger, { period, tolerance: idr(1_000_000n) });
    expect(report.balanced).toBe(true);
    expect(report.netDelta).toEqual(idr(0n));
    expect(report.amilAssessment.status).toBe("EXCEEDED");
    expect(report.amilAssessment.checks).toHaveLength(2);
    expect(report.amilAssessment.checks[0]).toMatchObject({
      side: "claim", key: "PZ-1", balanceSheet: "ON", status: "EXCEEDED",
      collected: idr(100_000_000n), actual: idr(12_500_001n), ceiling: idr(12_500_000n),
    });
  });

  it("tidak memberi vonis lolos ketika sebuah baris ganda atau hak amil tidak lengkap", () => {
    const ledger = side([row("PZ-1", 1_000n, 100n), row("PZ-1", 1_000n, 0n)]);
    const report = reconcile(ledger, side([row("PZ-1", 1_000n)]), { period });
    expect(report.amilAssessment.status).toBe("NOT_CHECKED");
    expect(report.amilAssessment.checks.every((check) => check.status === "NOT_CHECKED")).toBe(true);
    expect(report.amilAssessment.checks[0].reason).toContain("ganda");
  });

  it("tidak menerbitkan basis yang bergantung pada urutan entri ganda", () => {
    const rows = [row("PZ-1", 800n, 100n), row("PZ-1", 1_600n, 100n), row("PZ-1", 400n, 0n, { bucket: "FITRAH" })];
    const first = reconcile(side(rows), side(rows), { period }).amilAssessment;
    const reversed = reconcile(side([...rows].reverse()), side([...rows].reverse()), { period }).amilAssessment;
    expect(first).toEqual(reversed);
    expect(first.checks[0].collected).toBeNull();
    expect(first.checks[0].ceiling).toBeNull();
  });

  it("menolak nilai hak amil negatif, bukan bigint, atau berbeda unit dengan lokasi baris", () => {
    for (const amilAmount of [idr(-1n), { amount: 1, unit: "IDR" }, { amount: 1n, unit: "USDC_6DP" }]) {
      const ledger = side([row("PZ-1", 1_000n, undefined, { amilAmount: amilAmount as Money })]);
      expect(() => reconcile(ledger, side([]), { period })).toThrow(/index 0.*PZ-1/);
    }
    const ledger: LedgerSide = { ...side([]), declaredTotals: [row("TOTAL", 1_000n, 10n)] };
    expect(() => reconcile(ledger, side([]), { period })).toThrow(/hak amil.*total/i);
  });

  it("membatasi basis internal menurut posisi neraca tanpa mengubah masukan", () => {
    const ledger: LedgerSide = { ...side([]), amilBasis: [
      { key: "PROTOKOL", balanceSheet: "OFF", collected: idr(800n), actual: idr(101n) },
    ] };
    const before = structuredClone(ledger);
    const report = reconcile(ledger, ledger, { period, balanceSheet: "OFF" });
    expect(report.amilAssessment.status).toBe("EXCEEDED");
    expect(report.amilAssessment.checks.every((c) => c.balanceSheet === "OFF")).toBe(true);
    expect(ledger).toEqual(before);
    const on = reconcile(ledger, ledger, { period, balanceSheet: "ON" });
    expect(on.amilAssessment.status).toBe("NOT_CHECKED");
    expect(ledger).toEqual(before);
  });

  it("menolak basis internal yang negatif atau campur unit", () => {
    for (const actual of [idr(-1n), { amount: 1n, unit: "USDC_6DP" } as Money]) {
      const ledger: LedgerSide = { ...side([]), amilBasis: [{
        key: "PROTOKOL", balanceSheet: "ON", collected: idr(800n), actual,
      }] };
      expect(() => reconcile(ledger, ledger, { period })).toThrow(/hak amil/);
    }
  });

  it("menjumlahkan jenis dana satu PZ tanpa menutup pelanggaran PZ lain atau posisi lain", () => {
    const ledger = side([
      row("PZ-1", 400n, 100n), row("PZ-1", 400n, 0n, { bucket: "FITRAH" }),
      row("PZ-2", 800n, 101n), row("PZ-3", 1_000_000n, 0n),
      row("PZ-1", 800n, 101n, { balanceSheet: "OFF" }),
    ]);
    const result = reconcile(ledger, ledger, { period });
    const claimChecks = result.amilAssessment.checks.filter((c) => c.side === "claim");
    expect(claimChecks.find((c) => c.key === "PZ-1" && c.balanceSheet === "ON")?.status).toBe("WITHIN_CEILING");
    expect(claimChecks.find((c) => c.key === "PZ-2")?.status).toBe("EXCEEDED");
    expect(claimChecks.find((c) => c.balanceSheet === "OFF")?.status).toBe("EXCEEDED");
    const shuffled = side([...ledger.entries].reverse());
    expect(reconcile(shuffled, shuffled, { period }).amilAssessment).toEqual(result.amilAssessment);
  });

  it("membedakan nol, tepat plafon, pecahan plafon, dan angka USDC di luar presisi Number", () => {
    for (const [collected, actual, expected] of [
      [0n, 0n, "WITHIN_CEILING"], [0n, 1n, "EXCEEDED"],
      [800n, 100n, "WITHIN_CEILING"], [7n, 1n, "EXCEEDED"],
      [9_007_199_254_741_000n, 1_125_899_906_842_626n, "EXCEEDED"],
    ] as const) {
      const ledger = side([row("PZ-1", 0n, undefined, {
        value: { amount: collected, unit: "USDC_6DP" }, amilAmount: { amount: actual, unit: "USDC_6DP" },
      })]);
      const result = reconcile(ledger, ledger, { period });
      expect(result.amilAssessment.status).toBe(expected);
      expect(result.amilAssessment.checks[0].ceiling?.unit).toBe("USDC_6DP");
    }
  });

  it("tidak menghitung data yang hilang sebagai nol walau baris lain pada PZ yang sama lengkap", () => {
    const ledger = side([row("PZ-1", 800n, 0n), row("PZ-1", 800n, undefined, { bucket: "FITRAH" })]);
    const result = reconcile(ledger, ledger, { period });
    expect(result.amilAssessment.status).toBe("NOT_CHECKED");
    expect(result.amilAssessment.checks[0].actual).toBeNull();
    expect(reconcile(side([]), side([]), { period }).amilAssessment.status).toBe("NOT_CHECKED");
  });
});

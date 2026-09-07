import { describe, expect, it } from "bun:test";
import { countOf, coverageCounts, findFigure, formatAuditDate } from "./figures";
import type { WirePeriodFigures } from "./types";

const count = (amount: string) => ({ amount, unit: "COUNT" as const });

const FIGURES: WirePeriodFigures = {
  period: { kind: "AKHIR_TAHUN", year: 2026 },
  figures: [
    { name: "pengumpulan.total", label: "Total", value: { amount: "10", unit: "IDR" } },
    { name: "atestasi.jumlah", label: "Atestasi", value: count("2") },
    { name: "atestasi.penyaluran_belum_diatestasi", label: "Belum", value: count("5") },
    { name: "baris.tanpa_tanggal", label: "Tanpa tanggal", value: count("1") },
  ],
  collection: [],
  distribution: [],
  amilShare: {
    withinCeiling: true,
    collected: { amount: "0", unit: "IDR" },
    ceiling: { amount: "0", unit: "IDR" },
    actual: { amount: "0", unit: "IDR" },
    ceilingRatio: { amount: "1250", unit: "BPS" },
    actualRatio: { amount: "0", unit: "BPS" },
  },
  attestations: [],
  durations: {
    intervals: [],
    slowest: null,
    trails: [],
    notes: [],
  },
  notes: [],
};

describe("Membaca angka periode menurut namanya", () => {
  it("menemukan angka yang ada", () => {
    expect(findFigure(FIGURES, "pengumpulan.total")?.value.amount).toBe("10");
  });

  it("mengembalikan null untuk angka yang tidak ada, bukan menebak", () => {
    expect(findFigure(FIGURES, "tidak.ada")).toBeNull();
  });

  it("menolak membaca angka bukan-hitungan sebagai hitungan", () => {
    expect(countOf(FIGURES, "pengumpulan.total")).toBeNull();
    expect(countOf(FIGURES, "atestasi.jumlah")).toBe(2);
  });

  it("melaporkan cakupan atestasi beserta yang belum tersentuh", () => {
    expect(coverageCounts(FIGURES)).toEqual({ attested: 2, unattested: 5, undatedRows: 1 });
  });

  it("melaporkan cakupan sebagai tidak diketahui ketika laporannya tidak membawanya", () => {
    const older = { ...FIGURES, figures: [] };
    expect(coverageCounts(older)).toEqual({
      attested: null,
      unattested: null,
      undatedRows: null,
    });
  });
});

describe("Tanggal atestasi", () => {
  it("ditulis dengan kaidah Indonesia", () => {
    expect(formatAuditDate("2026-04-01T00:00:00.000Z")).toBe("1 April 2026");
  });

  it("tidak mengarang tanggal ketika tidak ada atau tidak terbaca", () => {
    expect(formatAuditDate(null)).toBeNull();
    expect(formatAuditDate("bukan tanggal")).toBeNull();
  });
});

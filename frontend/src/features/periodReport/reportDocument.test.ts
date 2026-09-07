import { describe, expect, it } from "bun:test";
import { buildReportDocument, reportFileName } from "./reportDocument";
import type { WireDraft, WirePeriodFigures, WireVerdict } from "./types";

const idr = (amount: string) => ({ amount, unit: "IDR" as const });

const FIGURES: WirePeriodFigures = {
  period: { kind: "AKHIR_TAHUN", year: 2026 },
  figures: [
    { name: "pengumpulan.total", label: "Total pengumpulan", value: idr("11622127523247") },
    { name: "penyaluran.total.idr", label: "Total penyaluran (rupiah)", value: idr("40000000") },
    { name: "atestasi.jumlah", label: "Jumlah atestasi", value: { amount: "1", unit: "COUNT" } },
    {
      name: "atestasi.penyaluran_belum_diatestasi",
      label: "Penyaluran yang belum diatestasi",
      value: { amount: "3", unit: "COUNT" },
    },
  ],
  collection: [
    { name: "pengumpulan.zakat", label: "Pengumpulan Zakat", value: idr("11622127523247") },
    { name: "pengumpulan.total", label: "Total pengumpulan", value: idr("11622127523247") },
  ],
  distribution: [
    { name: "penyaluran.fakir.idr", label: "Penyaluran Fakir (rupiah)", value: idr("40000000") },
  ],
  amilShare: {
    withinCeiling: true,
    collected: idr("11622127523247"),
    ceiling: idr("1452765940405"),
    actual: idr("0"),
    ceilingRatio: { amount: "1250", unit: "BPS" },
    actualRatio: { amount: "0", unit: "BPS" },
  },
  attestations: [
    {
      proposalId: 1,
      auditorName: "KAP Amanah",
      auditorAddress: "0xabc",
      opinion: "WTP",
      reportCID: "bafy...",
      txHash: "0xdef",
      auditedAt: "2026-04-01T00:00:00.000Z",
    },
  ],
  notes: ["Catatan batas laporan."],
};

const DRAFT: WireDraft = {
  claims: [{ name: "pengumpulan.total", value: idr("11622127523247") }],
  narrative: "Pengumpulan periode ini Rp11.622.127.523.247.",
};

const passed: WireVerdict = { outcome: "LOLOS", findings: [] };
const rejected: WireVerdict = {
  outcome: "DITOLAK",
  findings: [
    {
      kind: "KLAIM_TIDAK_COCOK",
      figureName: "pengumpulan.total",
      message: "menyimpang",
      claimed: idr("1"),
      expected: idr("11622127523247"),
    },
  ],
};

describe("Berkas laporan yang bisa diunduh", () => {
  it("hanya tersedia untuk laporan yang lolos", () => {
    expect(buildReportDocument(FIGURES, DRAFT, rejected)).toBeNull();
  });

  it("tidak tersedia ketika belum ada vonis", () => {
    expect(buildReportDocument(FIGURES, DRAFT, null)).toBeNull();
    expect(buildReportDocument(FIGURES, null, passed)).toBeNull();
  });

  it("memuat periode, narasi, dan pernyataan bahwa angkanya diverifikasi", () => {
    const document = buildReportDocument(FIGURES, DRAFT, passed)!;

    expect(document).toContain("Akhir Tahun 2026");
    expect(document).toContain("Pengumpulan periode ini Rp11.622.127.523.247.");
    expect(document).toMatch(/diverifikasi|validator/i);
  });

  it("memformat rupiah menurut kaidah Indonesia tanpa kehilangan presisi triliunan", () => {
    const document = buildReportDocument(FIGURES, DRAFT, passed)!;

    expect(document).toContain("Rp11.622.127.523.247");
    expect(document).not.toContain("1.1622127523247e");
  });

  it("memuat porsi hak amil beserta plafonnya", () => {
    const document = buildReportDocument(FIGURES, DRAFT, passed)!;

    expect(document).toContain("Rp1.452.765.940.405");
    expect(document).toContain("12,5%");
  });

  it("memuat daftar atestasi auditor", () => {
    const document = buildReportDocument(FIGURES, DRAFT, passed)!;

    expect(document).toContain("KAP Amanah");
    expect(document).toContain("WTP");
  });

  it("memuat catatan batas laporan, sehingga tidak hilang dari berkas yang dibagikan", () => {
    expect(buildReportDocument(FIGURES, DRAFT, passed)!).toContain("Catatan batas laporan.");
  });

  it("memuat cakupan atestasi, termasuk yang belum diatestasi", () => {
    // Story 19 of the spec: what the auditor has not reached must be as visible
    // as what they have, in the file as well as on screen.
    const document = buildReportDocument(FIGURES, DRAFT, passed)!;

    expect(document).toMatch(/Penyaluran yang belum diatestasi: 3/);
    expect(document).toMatch(/Atestasi terbit pada periode ini: 1/);
  });

  it("menulis tanggal atestasi dengan kaidah Indonesia, sama seperti di layar", () => {
    expect(buildReportDocument(FIGURES, DRAFT, passed)!).toContain("1 April 2026");
  });

  it("menamai berkasnya menurut periodenya", () => {
    expect(reportFileName(FIGURES.period)).toBe("laporan-periode-akhir-tahun-2026.txt");
    expect(reportFileName({ kind: "SEMESTER", year: 2025 })).toBe(
      "laporan-periode-semester-2025.txt"
    );
  });
});

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
  durations: {
    intervals: [
      {
        name: "pengajuan_ke_persetujuan",
        label: "Pengajuan sampai persetujuan DPS",
        from: "PENGAJUAN",
        to: "PERSETUJUAN_DPS",
        averageHours: null,
        sampleCount: 0,
        unmeasured: { belumSelesai: 0, tidakTercatat: 1, urutanTerbalik: 0 },
      },
      {
        name: "persetujuan_ke_eksekusi",
        label: "Persetujuan DPS sampai eksekusi penyaluran",
        from: "PERSETUJUAN_DPS",
        to: "EKSEKUSI",
        averageHours: null,
        sampleCount: 0,
        unmeasured: { belumSelesai: 0, tidakTercatat: 1, urutanTerbalik: 0 },
      },
      {
        name: "eksekusi_ke_atestasi",
        label: "Eksekusi penyaluran sampai atestasi auditor",
        from: "EKSEKUSI",
        to: "ATESTASI",
        averageHours: "50",
        sampleCount: 1,
        unmeasured: { belumSelesai: 0, tidakTercatat: 0, urutanTerbalik: 0 },
      },
      {
        name: "pengajuan_ke_atestasi",
        label: "Pengajuan sampai atestasi auditor",
        from: "PENGAJUAN",
        to: "ATESTASI",
        averageHours: "192",
        sampleCount: 1,
        unmeasured: { belumSelesai: 0, tidakTercatat: 0, urutanTerbalik: 0 },
      },
    ],
    slowest: {
      name: "eksekusi_ke_atestasi",
      label: "Eksekusi penyaluran sampai atestasi auditor",
      averageHours: "50",
      sampleCount: 1,
    },
    trails: [
      {
        proposalId: 1,
        marks: [
          {
            stage: "PENGAJUAN",
            label: "Pengajuan Amil",
            reached: true,
            at: "2026-03-01T00:00:00.000Z",
            blockNumber: 501,
          },
          {
            stage: "PERSETUJUAN_DPS",
            label: "Persetujuan Dewan Pengawas Syariah",
            reached: true,
            at: null,
            blockNumber: 540,
          },
          {
            stage: "EKSEKUSI",
            label: "Eksekusi penyaluran",
            reached: true,
            at: "2026-03-05T00:00:00.000Z",
            blockNumber: 555,
          },
          {
            stage: "ATESTASI",
            label: "Atestasi Auditor Independen",
            reached: true,
            at: "2026-03-07T02:00:00.000Z",
            blockNumber: null,
          },
        ],
        intervals: [
          {
            name: "pengajuan_ke_persetujuan",
            label: "Pengajuan sampai persetujuan DPS",
            from: "PENGAJUAN",
            to: "PERSETUJUAN_DPS",
            state: "TIDAK_TERCATAT",
            hours: null,
            reason: "Sistem ini tidak menyimpan stempel waktu persetujuan DPS.",
          },
          {
            name: "persetujuan_ke_eksekusi",
            label: "Persetujuan DPS sampai eksekusi penyaluran",
            from: "PERSETUJUAN_DPS",
            to: "EKSEKUSI",
            state: "TIDAK_TERCATAT",
            hours: null,
            reason: "Sistem ini tidak menyimpan stempel waktu persetujuan DPS.",
          },
          {
            name: "eksekusi_ke_atestasi",
            label: "Eksekusi penyaluran sampai atestasi auditor",
            from: "EKSEKUSI",
            to: "ATESTASI",
            state: "SELESAI",
            hours: "50",
            reason: null,
          },
          {
            name: "pengajuan_ke_atestasi",
            label: "Pengajuan sampai atestasi auditor",
            from: "PENGAJUAN",
            to: "ATESTASI",
            state: "SELESAI",
            hours: "194",
            reason: null,
          },
        ],
      },
    ],
    notes: ["Durasi yang diukur adalah lamanya proses di dalam sistem ini."],
  },
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

describe("Durasi penyaluran di dalam berkas unduhan", () => {
  const text = () => buildReportDocument(FIGURES, DRAFT, passed)!;

  it("menyebut rata-rata tiap tahap beserta jumlah penyalurannya", () => {
    expect(text()).toContain("DURASI PENYALURAN");
    expect(text()).toContain("Eksekusi penyaluran sampai atestasi auditor: 2 hari 2 jam");
    expect(text()).toContain("bukan tren");
  });

  it("menuliskan tahap tanpa stempel waktu sebagai alasannya, bukan sebagai nol jam", () => {
    const line = text()
      .split("\n")
      .find((row) => row.includes("Pengajuan sampai persetujuan DPS"))!;

    expect(line).toContain("tidak terukur");
    expect(line).not.toContain("0 jam");
  });

  it("menamai tahap tempat waktu paling banyak hilang", () => {
    expect(text()).toContain("Waktu paling banyak hilang di tahap");
  });

  it("membuka jejak tiap penyaluran beserta nomor bloknya", () => {
    const document = text();

    expect(document).toContain("JEJAK WAKTU PENYALURAN");
    expect(document).toContain("Penyaluran #1 - pengajuan sampai atestasi: 8 hari 2 jam");
    expect(document).toContain("Pengajuan Amil:");
    expect(document).toContain("blok #501");
    expect(document).toContain("blok #540");
    // Atestasi direlay gasless dan tidak punya event terindeks, sehingga tidak
    // ada nomor blok yang boleh dikarang untuknya.
    expect(document).toContain("Atestasi Auditor Independen:");
    expect(document).not.toContain("blok #null");
  });

  it("menyebut tahap yang terlewati tanpa stempel waktu apa adanya", () => {
    expect(text()).toContain("Terlewati, tanpa stempel waktu tersimpan");
  });
});

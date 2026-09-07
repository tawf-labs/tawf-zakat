import { describe, expect, it } from "bun:test";
import {
  averageDuration,
  blockExplorerUrl,
  bottleneckReading,
  intervalDuration,
  intervalReading,
  markReading,
  sampleReading,
  trailTotal,
} from "./durations";
import { formatHours, formatQuantity } from "../../lib/reporting";
import type {
  WireDisbursementTrail,
  WireIntervalAggregate,
  WirePeriodDurations,
  WireStageInterval,
  WireStageMark,
} from "./types";

const interval = (overrides: Partial<WireStageInterval> = {}): WireStageInterval => ({
  name: "eksekusi_ke_atestasi",
  label: "Eksekusi penyaluran sampai atestasi auditor",
  from: "EKSEKUSI",
  to: "ATESTASI",
  state: "SELESAI",
  hours: "50",
  reason: null,
  ...overrides,
});

const aggregate = (overrides: Partial<WireIntervalAggregate> = {}): WireIntervalAggregate => ({
  name: "eksekusi_ke_atestasi",
  label: "Eksekusi penyaluran sampai atestasi auditor",
  from: "EKSEKUSI",
  to: "ATESTASI",
  averageHours: "50",
  sampleCount: 4,
  unmeasured: { belumSelesai: 0, tidakTercatat: 0, urutanTerbalik: 0 },
  ...overrides,
});

const mark = (overrides: Partial<WireStageMark> = {}): WireStageMark => ({
  stage: "EKSEKUSI",
  label: "Eksekusi penyaluran",
  reached: true,
  at: "2026-03-05T04:00:00.000Z",
  blockNumber: 501,
  ...overrides,
});

describe("Menyebut lamanya sebuah tahap", () => {
  it("membaca jam sebagai hari dan jam, tanpa desimal", () => {
    expect(formatHours("50")).toBe("2 hari 2 jam");
    expect(formatHours("48")).toBe("2 hari");
    expect(formatHours("5")).toBe("5 jam");
    expect(formatHours("0")).toBe("0 jam");
  });

  it("mengelompokkan hari sampai orde ribuan tanpa melewati bilangan pecahan", () => {
    expect(formatHours("240000")).toBe("10.000 hari");
  });

  it("menyajikan satuan JAM lewat pintu yang sama dengan satuan lain", () => {
    expect(formatQuantity({ amount: "50", unit: "JAM" })).toBe("2 hari 2 jam");
  });
});

describe("Rentang yang tidak terukur tidak pernah tampil sebagai angka", () => {
  it("menyebut durasi ketika rentangnya selesai", () => {
    expect(intervalDuration(interval())).toBe("2 hari 2 jam");
    expect(intervalReading(interval())).toBe("2 hari 2 jam");
  });

  it("tidak menyebut durasi apa pun untuk tahap yang belum selesai", () => {
    const belum = interval({ state: "BELUM_SELESAI", hours: null, reason: "Belum diatestasi." });

    expect(intervalDuration(belum)).toBeNull();
    expect(intervalReading(belum)).toBe("Belum diatestasi.");
    expect(intervalReading(belum)).not.toContain("0");
  });

  it("memakai kata bawaan ketika server tidak menyertakan alasan", () => {
    expect(intervalReading(interval({ state: "BELUM_SELESAI", hours: null, reason: null }))).toBe(
      "Belum selesai"
    );
    expect(intervalReading(interval({ state: "TIDAK_TERCATAT", hours: null, reason: null }))).toBe(
      "Tidak tercatat"
    );
  });

  it("mengabaikan jam yang datang bersama keadaan bukan selesai", () => {
    // Pertahanan terhadap badan balasan yang tidak konsisten: keadaan yang
    // memutuskan, bukan angkanya.
    expect(intervalDuration(interval({ state: "TIDAK_TERCATAT", hours: "50" }))).toBeNull();
  });
});

describe("Rata-rata selalu disertai jumlah penyalurannya", () => {
  it("menyebut rata-rata beserta jumlah sampelnya", () => {
    expect(averageDuration(aggregate())).toBe("2 hari 2 jam");
    expect(sampleReading(aggregate())).toBe("dari 4 penyaluran");
  });

  it("memperingatkan bahwa satu kejadian bukan tren", () => {
    expect(sampleReading(aggregate({ sampleCount: 1 }))).toContain("bukan tren");
  });

  it("tetap menyebut penyaluran yang dikeluarkan ketika sebagian durasi terukur", () => {
    expect(sampleReading(aggregate({
      sampleCount: 1,
      unmeasured: { belumSelesai: 3, tidakTercatat: 2, urutanTerbalik: 1 },
    }))).toContain("3 belum selesai, 2 tidak tercatat, 1 urutan waktu terbalik");
  });

  it("membedakan yang belum selesai dari yang tidak tercatat ketika tidak ada sampel", () => {
    const kosong = aggregate({
      averageHours: null,
      sampleCount: 0,
      unmeasured: { belumSelesai: 3, tidakTercatat: 2, urutanTerbalik: 0 },
    });

    expect(averageDuration(kosong)).toBeNull();
    expect(sampleReading(kosong)).toContain("3 belum selesai");
    expect(sampleReading(kosong)).toContain("2 tidak tercatat");
  });

  it("menyatakan periode tanpa penyaluran sebagai kosong, bukan sebagai nol", () => {
    const kosong = aggregate({
      averageHours: null,
      sampleCount: 0,
      unmeasured: { belumSelesai: 0, tidakTercatat: 0, urutanTerbalik: 0 },
    });

    expect(sampleReading(kosong)).toBe("belum ada penyaluran pada periode ini");
  });

  it("menampilkan catatan waktu terbalik sebagai masalah data, bukan periode kosong", () => {
    const terbalik = aggregate({
      averageHours: null,
      sampleCount: 0,
      unmeasured: { belumSelesai: 0, tidakTercatat: 0, urutanTerbalik: 2 },
    });

    expect(sampleReading(terbalik)).toContain("2 urutan waktu terbalik");
    expect(intervalReading(interval({ state: "URUTAN_TERBALIK", hours: null }))).toBe(
      "Urutan waktu terbalik"
    );
  });
});

describe("Tahap tempat waktu paling banyak hilang", () => {
  const durations = (overrides: Partial<WirePeriodDurations> = {}): WirePeriodDurations => ({
    intervals: [aggregate()],
    slowest: {
      name: "eksekusi_ke_atestasi",
      label: "Eksekusi penyaluran sampai atestasi auditor",
      averageHours: "50",
      sampleCount: 4,
    },
    trails: [],
    notes: [],
    ...overrides,
  });

  it("menamai tahapnya beserta rata-rata dan jumlah sampelnya", () => {
    const reading = bottleneckReading(durations())!;

    expect(reading).toContain("Eksekusi penyaluran sampai atestasi auditor");
    expect(reading).toContain("2 hari 2 jam");
    expect(reading).toContain("4 penyaluran");
  });

  it("tidak menyebut apa pun ketika tidak ada tahap yang terukur", () => {
    expect(bottleneckReading(durations({ slowest: null }))).toBeNull();
  });
});

describe("Jejak waktu satu penyaluran", () => {
  it("menyebut waktu tahap sampai ke menitnya", () => {
    expect(markReading(mark())).toMatch(/2026/);
    expect(markReading(mark())).toMatch(/\d{2}[.:]\d{2}/);
  });

  it("membedakan tahap yang belum terlewati dari tahap tanpa stempel waktu", () => {
    expect(markReading(mark({ reached: false, at: null }))).toBe("Belum terlewati");
    expect(markReading(mark({ reached: true, at: null }))).toBe(
      "Terlewati, tanpa stempel waktu tersimpan"
    );
  });

  it("menautkan nomor blok ke explorer, dan tidak mengarang tautan ketika tidak ada", () => {
    expect(blockExplorerUrl(501)).toBe("https://sepolia.arbiscan.io/block/501");
    expect(blockExplorerUrl(null)).toBeNull();
  });

  it("menemukan rentang ujung-ke-ujung sebuah jejak", () => {
    const trail: WireDisbursementTrail = {
      proposalId: 1,
      marks: [mark()],
      intervals: [interval(), interval({ name: "pengajuan_ke_atestasi", hours: "192" })],
    };

    expect(trailTotal(trail)?.hours).toBe("192");
    expect(trailTotal({ ...trail, intervals: [] })).toBeNull();
  });
});

import { describe, expect, it } from "bun:test";
import {
  DISBURSEMENT_STAGES,
  INTERVAL_NAMES,
  disbursementTrail,
  periodDurations,
  stageBlocksByProposal,
  type StageEventRow,
  type TrailRow,
} from "../src/disbursement-duration";

const HOUR = 3_600_000;

const at = (isoDay: string) => `2026-03-${isoDay}T00:00:00.000Z`;

const row = (overrides: Partial<TrailRow> & { proposalIdOnChain: number }): TrailRow => ({
  status: "Executed",
  createdAt: at("01"),
  executedAt: at("05"),
  auditStatus: "AUDITED_WTP",
  auditedAt: at("09"),
  ...overrides,
});

const intervalOf = (trail: ReturnType<typeof disbursementTrail>, name: string) => {
  const found = trail.intervals.find((interval) => interval.name === name);
  if (!found) throw new Error(`Rentang "${name}" tidak ada di dalam jejak.`);
  return found;
};

const markOf = (trail: ReturnType<typeof disbursementTrail>, stage: string) => {
  const found = trail.marks.find((mark) => mark.stage === stage);
  if (!found) throw new Error(`Tahap "${stage}" tidak ada di dalam jejak.`);
  return found;
};

describe("Jejak waktu satu penyaluran", () => {
  it("mengikuti empat tahap pemisahan kewenangan ADR-0006, dalam urutannya", () => {
    const trail = disbursementTrail(row({ proposalIdOnChain: 1 }));

    expect(trail.marks.map((mark) => mark.stage)).toEqual([...DISBURSEMENT_STAGES]);
    expect(trail.marks.map((mark) => mark.stage)).toEqual([
      "PENGAJUAN",
      "PERSETUJUAN_DPS",
      "EKSEKUSI",
      "ATESTASI",
    ]);
  });

  it("menghitung durasi tahap yang kedua ujungnya bertanggal", () => {
    const trail = disbursementTrail(row({ proposalIdOnChain: 1 }));
    const eksekusiKeAtestasi = intervalOf(trail, "eksekusi_ke_atestasi");

    expect(eksekusiKeAtestasi.state).toBe("SELESAI");
    expect(eksekusiKeAtestasi.hours).toBe(96n); // 5 Maret -> 9 Maret
    expect(eksekusiKeAtestasi.reason).toBeNull();

    const total = intervalOf(trail, "pengajuan_ke_atestasi");
    expect(total.state).toBe("SELESAI");
    expect(total.hours).toBe(192n); // 1 Maret -> 9 Maret
  });

  it("membulatkan durasi ke bawah ke jam penuh, bukan membulatkan ke jam terdekat", () => {
    const trail = disbursementTrail(
      row({
        proposalIdOnChain: 1,
        executedAt: "2026-03-05T00:00:00.000Z",
        auditedAt: "2026-03-05T02:59:59.000Z",
      })
    );

    expect(intervalOf(trail, "eksekusi_ke_atestasi").hours).toBe(2n);
  });

  it("melaporkan tahap yang belum terlewati sebagai belum selesai, bukan durasi nol", () => {
    const trail = disbursementTrail(
      row({ proposalIdOnChain: 1, auditStatus: "PENDING", auditedAt: null })
    );
    const eksekusiKeAtestasi = intervalOf(trail, "eksekusi_ke_atestasi");

    expect(markOf(trail, "ATESTASI").reached).toBe(false);
    expect(eksekusiKeAtestasi.state).toBe("BELUM_SELESAI");
    expect(eksekusiKeAtestasi.hours).toBeNull();
    expect(eksekusiKeAtestasi.reason).toBeTruthy();
    expect(intervalOf(trail, "pengajuan_ke_atestasi").state).toBe("BELUM_SELESAI");
  });

  it("melaporkan tahap yang terlewati tanpa stempel waktu sebagai tidak tercatat", () => {
    // Persetujuan DPS terjadi on-chain, tetapi sistem ini tidak menyimpan
    // stempel waktunya - dan durasi yang dikarang lebih buruk daripada durasi
    // yang tidak ada.
    const trail = disbursementTrail(row({ proposalIdOnChain: 1 }));

    expect(markOf(trail, "PERSETUJUAN_DPS").reached).toBe(true);
    expect(markOf(trail, "PERSETUJUAN_DPS").at).toBeNull();

    for (const name of ["pengajuan_ke_persetujuan", "persetujuan_ke_eksekusi"]) {
      const interval = intervalOf(trail, name);
      expect(interval.state).toBe("TIDAK_TERCATAT");
      expect(interval.hours).toBeNull();
      expect(interval.reason).toBeTruthy();
    }
  });

  it("menolak melaporkan durasi ketika urutan stempel waktunya terbalik", () => {
    const trail = disbursementTrail(
      row({
        proposalIdOnChain: 1,
        executedAt: "2026-03-09T00:00:00.000Z",
        auditedAt: "2026-03-05T00:00:00.000Z",
      })
    );
    const interval = intervalOf(trail, "eksekusi_ke_atestasi");

    expect(interval.state).toBe("URUTAN_TERBALIK");
    expect(interval.hours).toBeNull();
    expect(interval.reason).toContain("mendahului");
  });

  it("memperlakukan stempel waktu yang tidak terbaca sebagai tidak tercatat", () => {
    const trail = disbursementTrail(
      row({ proposalIdOnChain: 1, auditedAt: "bukan tanggal" })
    );

    expect(markOf(trail, "ATESTASI").reached).toBe(true);
    expect(markOf(trail, "ATESTASI").at).toBeNull();
    expect(intervalOf(trail, "eksekusi_ke_atestasi").state).toBe("TIDAK_TERCATAT");
  });

  it("menempelkan nomor blok pada tahap yang punya jejak on-chain", () => {
    const trail = disbursementTrail(row({ proposalIdOnChain: 7 }), {
      PENGAJUAN: 900,
      PERSETUJUAN_DPS: 940,
      EKSEKUSI: 980,
    });

    expect(markOf(trail, "PENGAJUAN").blockNumber).toBe(900);
    expect(markOf(trail, "PERSETUJUAN_DPS").blockNumber).toBe(940);
    expect(markOf(trail, "EKSEKUSI").blockNumber).toBe(980);
    // Atestasi direlay secara gasless dan tidak termasuk event terindeks.
    expect(markOf(trail, "ATESTASI").blockNumber).toBeNull();
  });
});

describe("Nomor blok dari event terindeks", () => {
  const event = (
    eventName: string,
    proposalId: number,
    blockNumber: number
  ): StageEventRow => ({
    eventName,
    blockNumber,
    argsJson: JSON.stringify({ proposalId: String(proposalId), currentApprovals: "2" }),
  });

  it("memetakan event penyaluran ke tahapnya, per proposal", () => {
    const blocks = stageBlocksByProposal([
      event("DisbursementProposed", 1, 100),
      event("DisbursementApproved", 1, 110),
      event("DisbursementExecuted", 1, 120),
      event("DisbursementProposed", 2, 200),
    ]);

    expect(blocks.get(1)).toEqual({ PENGAJUAN: 100, PERSETUJUAN_DPS: 110, EKSEKUSI: 120 });
    expect(blocks.get(2)).toEqual({ PENGAJUAN: 200 });
  });

  it("tidak menganggap persetujuan awal Amil sebagai persetujuan DPS", () => {
    const blocks = stageBlocksByProposal([{
      eventName: "DisbursementApproved",
      blockNumber: 100,
      argsJson: JSON.stringify({ proposalId: "1", currentApprovals: "1" }),
    }]);
    const trail = disbursementTrail(row({
      proposalIdOnChain: 1, status: "Pending", executedAt: null,
      auditStatus: "PENDING", auditedAt: null,
    }), blocks.get(1));

    expect(markOf(trail, "PERSETUJUAN_DPS").blockNumber).toBeNull();
    expect(markOf(trail, "PERSETUJUAN_DPS").reached).toBe(false);
    expect(intervalOf(trail, "pengajuan_ke_persetujuan").state).toBe("BELUM_SELESAI");
  });

  it("memakai persetujuan terakhir sebagai penanda tahap DPS, karena kuorum tercapai di sana", () => {
    const blocks = stageBlocksByProposal([
      event("DisbursementApproved", 1, 110),
      event("DisbursementApproved", 1, 118),
    ]);

    expect(blocks.get(1)?.PERSETUJUAN_DPS).toBe(118);
  });

  it("memakai pengajuan paling awal, sehingga event yang terindeks ulang tidak menggeser tahapnya", () => {
    const blocks = stageBlocksByProposal([
      event("DisbursementProposed", 1, 140),
      event("DisbursementProposed", 1, 100),
    ]);

    expect(blocks.get(1)?.PENGAJUAN).toBe(100);
  });

  it("melewati event di luar siklus penyaluran dan args yang tidak terbaca", () => {
    const blocks = stageBlocksByProposal([
      event("RoleGranted", 1, 100),
      { eventName: "DisbursementProposed", blockNumber: 100, argsJson: "{" },
      { eventName: "DisbursementProposed", blockNumber: 100, argsJson: "{}" },
    ]);

    expect(blocks.size).toBe(0);
  });
});

describe("Agregat durasi periode", () => {
  const trailWithSpan = (proposalId: number, hours: number) =>
    disbursementTrail(
      row({
        proposalIdOnChain: proposalId,
        executedAt: new Date(Date.UTC(2026, 2, 5)).toISOString(),
        auditedAt: new Date(Date.UTC(2026, 2, 5) + hours * HOUR).toISOString(),
      })
    );

  it("merata-ratakan hanya dari rentang yang terukur, dan menyebut jumlah sampelnya", () => {
    const durations = periodDurations([trailWithSpan(1, 24), trailWithSpan(2, 48)]);
    const interval = durations.intervals.find((i) => i.name === "eksekusi_ke_atestasi")!;

    expect(interval.sampleCount).toBe(2);
    expect(interval.averageHours).toBe(36n);
  });

  it("membedakan yang belum selesai dari yang tidak tercatat, alih-alih menganggap keduanya nol", () => {
    const durations = periodDurations([
      trailWithSpan(1, 24),
      disbursementTrail(row({ proposalIdOnChain: 2, auditStatus: "PENDING", auditedAt: null })),
      disbursementTrail(row({ proposalIdOnChain: 3, auditedAt: "bukan tanggal" })),
    ]);
    const interval = durations.intervals.find((i) => i.name === "eksekusi_ke_atestasi")!;

    expect(interval.sampleCount).toBe(1);
    expect(interval.unmeasured).toEqual({ belumSelesai: 1, tidakTercatat: 1, urutanTerbalik: 0 });
  });

  it("tidak melaporkan rata-rata sama sekali ketika tidak ada satu pun sampel", () => {
    const durations = periodDurations([
      disbursementTrail(row({ proposalIdOnChain: 1, createdAt: null, auditStatus: "PENDING", auditedAt: null })),
    ]);

    for (const interval of durations.intervals) {
      expect(interval.averageHours).toBeNull();
      expect(interval.sampleCount).toBe(0);
    }
    expect(durations.slowest).toBeNull();
  });

  it("melaporkan seluruh rentang yang dikenal meski tidak ada penyaluran sama sekali", () => {
    const durations = periodDurations([]);

    expect(durations.intervals.map((i) => i.name)).toEqual([...INTERVAL_NAMES]);
    expect(durations.trails).toEqual([]);
    expect(durations.slowest).toBeNull();
    expect(durations.notes.length).toBeGreaterThan(0);
  });

  it("menyatakan bahwa atestasi susulan dapat mengubah durasi laporan yang disusun ulang", () => {
    const durations = periodDurations([]);

    expect(
      durations.notes.some((note) => note.includes("setelah periode berakhir"))
    ).toBe(true);
  });

  it("menghitung atestasi yang terbit setelah periode berakhir sebagai ujung durasinya", () => {
    // Penyaluran periode ini, atestasinya menyusul di periode berikutnya:
    // durasinya nyata dan tetap dilaporkan, bukan dipotong di batas periode.
    const trail = disbursementTrail(
      row({
        proposalIdOnChain: 1,
        executedAt: "2026-12-30T00:00:00.000Z",
        auditedAt: "2027-01-01T00:00:00.000Z",
      })
    );

    expect(intervalOf(trail, "eksekusi_ke_atestasi").state).toBe("SELESAI");
    expect(intervalOf(trail, "eksekusi_ke_atestasi").hours).toBe(48n);
  });

  it("menunjuk tahap tempat waktu paling banyak hilang", () => {
    const durations = periodDurations([trailWithSpan(1, 100)]);

    expect(durations.slowest?.name).toBe("eksekusi_ke_atestasi");
    expect(durations.slowest?.averageHours).toBe(100n);
    expect(durations.slowest?.sampleCount).toBe(1);
  });

  it("tidak membandingkan rata-rata dari penyaluran yang berbeda", () => {
    const durations = periodDurations([
      disbursementTrail(row({ proposalIdOnChain: 1, createdAt: null })),
      disbursementTrail(row({ proposalIdOnChain: 2, auditStatus: "PENDING", auditedAt: null })),
    ]);

    expect(durations.intervals.find((i) => i.name === "pengajuan_ke_eksekusi")?.sampleCount).toBe(1);
    expect(durations.intervals.find((i) => i.name === "eksekusi_ke_atestasi")?.sampleCount).toBe(1);
    expect(durations.slowest).toBeNull();
  });

  it("memilih tahap paling lambat sebelum membulatkan jam, dan tidak menebak saat seri", () => {
    const durations = periodDurations([disbursementTrail(row({
      proposalIdOnChain: 1,
      createdAt: "2026-03-05T00:00:00.000Z",
      executedAt: "2026-03-05T01:10:00.000Z",
      auditedAt: "2026-03-05T03:00:00.000Z",
    }))]);
    expect(durations.slowest?.name).toBe("eksekusi_ke_atestasi");
    expect(durations.slowest?.averageHours).toBe(1n);

    expect(periodDurations([disbursementTrail(row({ proposalIdOnChain: 1 }))]).slowest).toBeNull();
  });

  it("menyimpan jejak tiap penyaluran, dalam urutan nomor proposal", () => {
    const durations = periodDurations([trailWithSpan(9, 24), trailWithSpan(2, 24)]);

    expect(durations.trails.map((trail) => trail.proposalId)).toEqual([2, 9]);
  });

  it("deterministik: masukan yang sama menghasilkan keluaran yang sama", () => {
    const build = () => periodDurations([trailWithSpan(1, 24), trailWithSpan(2, 49)]);

    expect(JSON.stringify(build(), (_, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(
      JSON.stringify(build(), (_, v) => (typeof v === "bigint" ? v.toString() : v))
    );
  });
});

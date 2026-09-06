import { describe, expect, it } from "bun:test";
import {
  computePeriodFigures,
  figureByName,
  AMIL_CEILING_BPS,
  type DonationRow,
  type PeriodRows,
  type ProposalRow,
} from "../src/period-report";
import type { ReportingPeriod } from "../src/reconciliation";

const AKHIR_TAHUN_2026: ReportingPeriod = { kind: "AKHIR_TAHUN", year: 2026 };
const SEMESTER_2026: ReportingPeriod = { kind: "SEMESTER", year: 2026 };

const donation = (overrides: Partial<DonationRow> & { amountIDR: number | string }): DonationRow => ({
  trxId: "TRX-1",
  status: "PAID",
  paymentMethod: "QRIS",
  paidAt: "2026-03-01T00:00:00.000Z",
  ...overrides,
});

const proposal = (overrides: Partial<ProposalRow> & { proposalIdOnChain: number }): ProposalRow => ({
  currencyType: 0,
  amount: 0,
  asnafCategory: "Fakir",
  status: "Executed",
  executedAt: "2026-03-02T00:00:00.000Z",
  ...overrides,
});

const rows = (donations: DonationRow[] = [], proposals: ProposalRow[] = []): PeriodRows => ({
  donations,
  proposals,
});

const amountOf = (figures: ReturnType<typeof computePeriodFigures>, name: string): bigint => {
  const figure = figureByName(figures, name);
  if (!figure) throw new Error(`Angka periode "${name}" tidak ada.`);
  return figure.value.amount;
};

describe("Angka periode - dihitung dari baris, bukan dari koneksi", () => {
  it("menghasilkan laporan sah bernilai nol untuk periode tanpa aktivitas", () => {
    const figures = computePeriodFigures(rows(), AKHIR_TAHUN_2026);

    expect(figures.period).toEqual(AKHIR_TAHUN_2026);
    expect(figures.figures.length).toBeGreaterThan(0);
    expect(figures.figures.every((f) => f.value.amount === 0n || f.value.unit === "BPS")).toBe(true);
    expect(amountOf(figures, "pengumpulan.total")).toBe(0n);
    expect(amountOf(figures, "penyaluran.total.idr")).toBe(0n);
    expect(figures.attestations).toEqual([]);
    expect(figures.amilShare.withinCeiling).toBe(true);
  });

  it("menjumlahkan pengumpulan fiat yang sudah dibayar per jenis dana", () => {
    const figures = computePeriodFigures(
      rows([
        donation({ trxId: "TRX-1", amountIDR: 2_500_000 }),
        donation({ trxId: "TRX-2", amountIDR: 1_500_000, status: "BATCHED" }),
        donation({ trxId: "TRX-3", amountIDR: 9_000_000, status: "PENDING" }),
      ]),
      AKHIR_TAHUN_2026
    );

    expect(amountOf(figures, "pengumpulan.zakat")).toBe(4_000_000n);
    expect(amountOf(figures, "pengumpulan.total")).toBe(4_000_000n);
    expect(amountOf(figures, "pengumpulan.fitrah")).toBe(0n);
    expect(figures.collection.map((f) => f.value.unit)).toEqual(
      figures.collection.map(() => "IDR")
    );
  });

  it("menahan donasi USDC di luar pengumpulan rupiah karena nilainya sebuah estimasi", () => {
    const figures = computePeriodFigures(
      rows([
        donation({ trxId: "TRX-1", amountIDR: 2_000_000 }),
        donation({ trxId: "USDC-1", amountIDR: 16_200_000, paymentMethod: "USDC" }),
      ]),
      AKHIR_TAHUN_2026
    );

    expect(amountOf(figures, "pengumpulan.total")).toBe(2_000_000n);
    expect(amountOf(figures, "pengumpulan.usdc_estimasi_idr")).toBe(16_200_000n);
    expect(figures.notes.join(" ")).toMatch(/estimasi/i);
  });

  it("memecah penyaluran per asnaf dan menjaga IDR dan USDC tetap terpisah", () => {
    const figures = computePeriodFigures(
      rows(
        [],
        [
          proposal({ proposalIdOnChain: 1, amount: 3_000_000, asnafCategory: "Fakir" }),
          proposal({ proposalIdOnChain: 2, amount: 1_000_000, asnafCategory: "Ibnu Sabil" }),
          proposal({ proposalIdOnChain: 3, amount: 250, currencyType: 1, asnafCategory: "Miskin" }),
        ]
      ),
      AKHIR_TAHUN_2026
    );

    expect(amountOf(figures, "penyaluran.fakir.idr")).toBe(3_000_000n);
    expect(amountOf(figures, "penyaluran.ibnu_sabil.idr")).toBe(1_000_000n);
    expect(amountOf(figures, "penyaluran.total.idr")).toBe(4_000_000n);

    // 250 whole USDC, carried in 6-decimal minor units - never added to rupiah.
    expect(amountOf(figures, "penyaluran.miskin.usdc")).toBe(250_000_000n);
    expect(amountOf(figures, "penyaluran.total.usdc")).toBe(250_000_000n);
    expect(figureByName(figures, "penyaluran.total.usdc")!.value.unit).toBe("USDC_6DP");
  });

  it("hanya menghitung penyaluran yang sudah tereksekusi", () => {
    const figures = computePeriodFigures(
      rows(
        [],
        [
          proposal({ proposalIdOnChain: 1, amount: 3_000_000, status: "Executed" }),
          proposal({ proposalIdOnChain: 2, amount: 9_000_000, status: "Approved" }),
          proposal({ proposalIdOnChain: 3, amount: 9_000_000, status: "Cancelled" }),
        ]
      ),
      AKHIR_TAHUN_2026
    );

    expect(amountOf(figures, "penyaluran.total.idr")).toBe(3_000_000n);
  });

  it("membatasi baris pada periode pelaporannya", () => {
    const donations = [
      donation({ trxId: "TRX-1", amountIDR: 1_000_000, paidAt: "2026-02-01T00:00:00.000Z" }),
      donation({ trxId: "TRX-2", amountIDR: 5_000_000, paidAt: "2026-09-01T00:00:00.000Z" }),
    ];

    expect(amountOf(computePeriodFigures(rows(donations), SEMESTER_2026), "pengumpulan.total")).toBe(
      1_000_000n
    );
    expect(
      amountOf(computePeriodFigures(rows(donations), AKHIR_TAHUN_2026), "pengumpulan.total")
    ).toBe(6_000_000n);
  });

  it("melaporkan porsi hak amil terhadap plafon 12,5%", () => {
    const figures = computePeriodFigures(
      rows(
        [donation({ amountIDR: 100_000_000 })],
        [proposal({ proposalIdOnChain: 1, amount: 10_000_000, asnafCategory: "Amil" })]
      ),
      AKHIR_TAHUN_2026
    );

    expect(figures.amilShare.ceilingRatio).toEqual({ amount: AMIL_CEILING_BPS, unit: "BPS" });
    expect(figures.amilShare.ceiling.amount).toBe(12_500_000n);
    expect(figures.amilShare.actual.amount).toBe(10_000_000n);
    expect(figures.amilShare.actualRatio).toEqual({ amount: 1000n, unit: "BPS" });
    expect(figures.amilShare.withinCeiling).toBe(true);
    expect(amountOf(figures, "hak_amil.porsi_idr")).toBe(10_000_000n);
    expect(amountOf(figures, "hak_amil.plafon_idr")).toBe(12_500_000n);
  });

  it("menandai plafon hak amil terlampaui saat selisihnya satu rupiah", () => {
    const figures = computePeriodFigures(
      rows(
        [donation({ amountIDR: 100_000_000 })],
        [proposal({ proposalIdOnChain: 1, amount: 12_500_001, asnafCategory: "Amil" })]
      ),
      AKHIR_TAHUN_2026
    );

    expect(figures.amilShare.withinCeiling).toBe(false);
  });

  it("menghitung porsi hak amil tanpa pengumpulan sebagai pelanggaran plafon", () => {
    const figures = computePeriodFigures(
      rows([], [proposal({ proposalIdOnChain: 1, amount: 1, asnafCategory: "Amil" })]),
      AKHIR_TAHUN_2026
    );

    expect(figures.amilShare.withinCeiling).toBe(false);
  });

  it("mempertahankan presisi pada orde triliunan", () => {
    const figures = computePeriodFigures(
      rows([donation({ amountIDR: "11622127523247" })]),
      AKHIR_TAHUN_2026
    );

    expect(amountOf(figures, "pengumpulan.total")).toBe(11_622_127_523_247n);
  });

  it("mendaftar atestasi auditor pada periode itu dan menghitung yang belum diatestasi", () => {
    const figures = computePeriodFigures(
      rows(
        [],
        [
          proposal({
            proposalIdOnChain: 1,
            amount: 3_000_000,
            auditStatus: "AUDITED_WTP",
            auditOpinion: "WTP",
            auditorName: "KAP Amanah",
            auditedAt: "2026-04-01T00:00:00.000Z",
          }),
          proposal({ proposalIdOnChain: 2, amount: 1_000_000 }),
        ]
      ),
      AKHIR_TAHUN_2026
    );

    expect(figures.attestations).toHaveLength(1);
    expect(figures.attestations[0]).toMatchObject({
      proposalId: 1,
      opinion: "WTP",
      auditorName: "KAP Amanah",
    });
    expect(amountOf(figures, "atestasi.jumlah")).toBe(1n);
    expect(amountOf(figures, "atestasi.penyaluran_belum_diatestasi")).toBe(1n);
  });

  it("mengelompokkan asnaf yang tidak dikenali sebagai LAINNYA alih-alih menebak", () => {
    const figures = computePeriodFigures(
      rows([], [proposal({ proposalIdOnChain: 1, amount: 500_000, asnafCategory: "Program Sosial" })]),
      AKHIR_TAHUN_2026
    );

    expect(amountOf(figures, "penyaluran.lainnya.idr")).toBe(500_000n);
    expect(amountOf(figures, "penyaluran.total.idr")).toBe(500_000n);
  });

  it("membaca label asnaf berupa angka maupun teks", () => {
    const figures = computePeriodFigures(
      rows(
        [],
        [
          proposal({ proposalIdOnChain: 1, amount: 100_000, asnafCategory: "3" }),
          proposal({ proposalIdOnChain: 2, amount: 200_000, asnafCategory: "fi sabilillah" }),
        ]
      ),
      AKHIR_TAHUN_2026
    );

    expect(amountOf(figures, "penyaluran.amil.idr")).toBe(100_000n);
    expect(amountOf(figures, "penyaluran.fisabilillah.idr")).toBe(200_000n);
  });

  it("mengeluarkan baris tanpa tanggal dari periode dan melaporkan jumlahnya", () => {
    const figures = computePeriodFigures(
      rows(
        [
          donation({ trxId: "TRX-1", amountIDR: 1_000_000 }),
          donation({ trxId: "TRX-2", amountIDR: 9_000_000, paidAt: null, createdAt: null }),
        ],
        [proposal({ proposalIdOnChain: 1, amount: 500_000, executedAt: null, createdAt: null })]
      ),
      AKHIR_TAHUN_2026
    );

    // Counted in no period at all, rather than counted in every one of them.
    expect(amountOf(figures, "pengumpulan.total")).toBe(1_000_000n);
    expect(amountOf(figures, "penyaluran.total.idr")).toBe(0n);
    expect(amountOf(figures, "baris.tanpa_tanggal")).toBe(2n);
  });

  it("menghasilkan daftar angka yang sama untuk masukan yang sama", () => {
    const input = rows(
      [donation({ amountIDR: 7_000_000 })],
      [proposal({ proposalIdOnChain: 1, amount: 500_000 })]
    );

    const first = computePeriodFigures(input, AKHIR_TAHUN_2026);
    const second = computePeriodFigures(input, AKHIR_TAHUN_2026);

    expect(first.figures.map((f) => `${f.name}=${f.value.amount}${f.value.unit}`)).toEqual(
      second.figures.map((f) => `${f.name}=${f.value.amount}${f.value.unit}`)
    );
  });
});

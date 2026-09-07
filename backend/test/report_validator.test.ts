import { describe, expect, it } from "bun:test";
import {
  computePeriodFigures,
  type FigureUnit,
  type PeriodFigures,
  type PeriodRows,
} from "../src/period-report";
import {
  rupiahMentions,
  validateDraft,
  type DraftClaim,
  type ReportDraft,
} from "../src/report-validator";
import type { ReportingPeriod } from "../src/reconciliation";

const PERIOD: ReportingPeriod = { kind: "AKHIR_TAHUN", year: 2026 };

/**
 * One ledger, reused by nearly every case: Rp100.000.000 collected, Rp40.000.000
 * disbursed to Fakir and Rp10.000.000 taken as hak amil - comfortably inside the
 * 12,5% ceiling, so a case that wants a violation has to build one on purpose.
 */
const LEDGER: PeriodRows = {
  donations: [
    { trxId: "TRX-1", amountIDR: 100_000_000, status: "PAID", paidAt: "2026-03-01T00:00:00.000Z" },
  ],
  proposals: [
    {
      proposalIdOnChain: 1,
      currencyType: 0,
      amount: 40_000_000,
      asnafCategory: "Fakir",
      status: "Executed",
      executedAt: "2026-03-02T00:00:00.000Z",
    },
    {
      proposalIdOnChain: 2,
      currencyType: 0,
      amount: 10_000_000,
      asnafCategory: "Amil",
      status: "Executed",
      executedAt: "2026-03-03T00:00:00.000Z",
    },
  ],
};

const figuresOf = (rows: PeriodRows = LEDGER): PeriodFigures => computePeriodFigures(rows, PERIOD);

const claim = (name: string, amount: bigint, unit: FigureUnit = "IDR"): DraftClaim => ({
  name,
  value: { amount, unit },
});

/** A claim whose amount the draft wrote in a form that is not a whole number. */
const unreadableClaim = (name: string, statedAmount: string): DraftClaim => ({
  name,
  value: null,
  statedAmount,
});

const draft = (claims: DraftClaim[], narrative = ""): ReportDraft => ({ claims, narrative });

const TRUE_CLAIMS: DraftClaim[] = [
  claim("pengumpulan.total", 100_000_000n),
  claim("penyaluran.fakir.idr", 40_000_000n),
  claim("hak_amil.porsi_idr", 10_000_000n),
];

describe("Validator draf - vonis deterministik atas angka, bukan atas kata sifat", () => {
  it("meloloskan draf yang seluruh klaimnya cocok", () => {
    const verdict = validateDraft(
      figuresOf(),
      draft(TRUE_CLAIMS, "Pengumpulan periode ini Rp100.000.000.")
    );

    expect(verdict.outcome).toBe("LOLOS");
    expect(verdict.findings).toEqual([]);
  });

  it("menolak klaim yang menyimpang dan menyebut nama angka, nilai klaim, dan nilai seharusnya", () => {
    const verdict = validateDraft(
      figuresOf(),
      draft([claim("pengumpulan.total", 120_000_000n)])
    );

    expect(verdict.outcome).toBe("DITOLAK");
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]).toMatchObject({
      kind: "KLAIM_TIDAK_COCOK",
      figureName: "pengumpulan.total",
      claimed: { amount: 120_000_000n, unit: "IDR" },
      expected: { amount: 100_000_000n, unit: "IDR" },
    });
    expect(verdict.findings[0]!.message).toContain("120.000.000");
    expect(verdict.findings[0]!.message).toContain("100.000.000");
  });

  it("menolak selisih satu rupiah tanpa toleransi pembulatan", () => {
    const verdict = validateDraft(
      figuresOf(),
      draft([claim("pengumpulan.total", 99_999_999n)])
    );

    expect(verdict.outcome).toBe("DITOLAK");
    expect(verdict.findings[0]!.kind).toBe("KLAIM_TIDAK_COCOK");
  });

  it("menolak angka rupiah di narasi yang tidak ada di daftar klaim", () => {
    const verdict = validateDraft(
      figuresOf(),
      draft(TRUE_CLAIMS, "Penyaluran tumbuh pesat hingga Rp88.000.000 pada periode ini.")
    );

    expect(verdict.outcome).toBe("DITOLAK");
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]).toMatchObject({
      kind: "ANGKA_NARASI_TIDAK_DIKLAIM",
      excerpt: "Rp88.000.000",
    });
  });

  it("membiarkan angka rupiah di narasi yang ada di daftar klaim yang lolos", () => {
    const verdict = validateDraft(
      figuresOf(),
      draft(
        TRUE_CLAIMS,
        "Pengumpulan Rp100.000.000, penyaluran kepada fakir Rp40.000.000, hak amil Rp 10.000.000."
      )
    );

    expect(verdict.outcome).toBe("LOLOS");
  });

  it("tidak memakai klaim yang gagal sebagai izin bagi angka di narasi", () => {
    const verdict = validateDraft(
      figuresOf(),
      draft([claim("pengumpulan.total", 120_000_000n)], "Pengumpulan periode ini Rp120.000.000.")
    );

    expect(verdict.outcome).toBe("DITOLAK");
    expect(verdict.findings.map((f) => f.kind).sort()).toEqual([
      "ANGKA_NARASI_TIDAK_DIKLAIM",
      "KLAIM_TIDAK_COCOK",
    ]);
  });

  it("menolak klaim atas angka yang tidak ada dalam laporan periode", () => {
    const verdict = validateDraft(figuresOf(), draft([claim("pertumbuhan.tahunan", 12n)]));

    expect(verdict.outcome).toBe("DITOLAK");
    expect(verdict.findings[0]).toMatchObject({
      kind: "KLAIM_TIDAK_DIKENAL",
      figureName: "pertumbuhan.tahunan",
    });
  });

  it("menolak satu angka yang diklaim dua kali", () => {
    const verdict = validateDraft(
      figuresOf(),
      draft([claim("pengumpulan.total", 100_000_000n), claim("pengumpulan.total", 100_000_000n)])
    );

    expect(verdict.outcome).toBe("DITOLAK");
    expect(verdict.findings[0]!.kind).toBe("KLAIM_GANDA");
  });

  it("menolak klaim yang jumlahnya bukan bilangan bulat, alih-alih menafsirkan digitnya", () => {
    const verdict = validateDraft(
      figuresOf(),
      draft([unreadableClaim("pengumpulan.total", "100.000.000")])
    );

    expect(verdict.outcome).toBe("DITOLAK");
    expect(verdict.findings[0]).toMatchObject({
      kind: "KLAIM_TIDAK_TERBACA",
      figureName: "pengumpulan.total",
      excerpt: "100.000.000",
      expected: { amount: 100_000_000n, unit: "IDR" },
    });
  });

  it("tidak memakai klaim yang tidak terbaca sebagai izin bagi angka di narasi", () => {
    const verdict = validateDraft(
      figuresOf(),
      draft([unreadableClaim("pengumpulan.total", "100.000.000")], "Pengumpulan Rp100.000.000.")
    );

    expect(verdict.findings.map((f) => f.kind).sort()).toEqual([
      "ANGKA_NARASI_TIDAK_DIKLAIM",
      "KLAIM_TIDAK_TERBACA",
    ]);
  });

  it("menolak nilai USDC yang diklaim sebagai rupiah alih-alih mengonversinya", () => {
    const verdict = validateDraft(
      figuresOf(),
      draft([claim("penyaluran.total.usdc", 0n, "IDR")])
    );

    expect(verdict.outcome).toBe("DITOLAK");
    expect(verdict.findings[0]).toMatchObject({
      kind: "KLAIM_TIDAK_COCOK",
      figureName: "penyaluran.total.usdc",
    });
  });

  it("menolak penjumlahan rupiah dan USDC menjadi satu angka", () => {
    const mixed: PeriodRows = {
      donations: LEDGER.donations,
      proposals: [
        ...LEDGER.proposals,
        {
          proposalIdOnChain: 3,
          currencyType: 1,
          amount: 250,
          asnafCategory: "Miskin",
          status: "Executed",
          executedAt: "2026-03-04T00:00:00.000Z",
        },
      ],
    };

    // 50.000.000 rupiah plus 250.000.000 USDC minor units, added as if one unit.
    const verdict = validateDraft(
      figuresOf(mixed),
      draft([claim("penyaluran.total.idr", 300_000_000n)])
    );

    expect(verdict.outcome).toBe("DITOLAK");
    expect(verdict.findings[0]).toMatchObject({
      kind: "KLAIM_TIDAK_COCOK",
      expected: { amount: 50_000_000n, unit: "IDR" },
    });
  });

  it("menolak draf ketika porsi hak amil melampaui plafon meski seluruh klaim cocok", () => {
    const overspent: PeriodRows = {
      donations: LEDGER.donations,
      proposals: [
        {
          proposalIdOnChain: 2,
          currencyType: 0,
          amount: 12_500_001,
          asnafCategory: "Amil",
          status: "Executed",
          executedAt: "2026-03-03T00:00:00.000Z",
        },
      ],
    };
    const figures = figuresOf(overspent);

    const verdict = validateDraft(
      figures,
      draft([claim("hak_amil.porsi_idr", 12_500_001n), claim("pengumpulan.total", 100_000_000n)])
    );

    expect(verdict.outcome).toBe("DITOLAK");
    expect(verdict.findings.map((f) => f.kind)).toContain("PLAFON_HAK_AMIL_TERLAMPAUI");
    expect(verdict.findings.find((f) => f.kind === "PLAFON_HAK_AMIL_TERLAMPAUI")!.message).toContain(
      "12.500.000"
    );
  });

  it("memverifikasi angka orde triliunan tanpa kehilangan presisi", () => {
    const national: PeriodRows = {
      donations: [
        {
          trxId: "TRX-1",
          amountIDR: "11622127523247",
          status: "PAID",
          paidAt: "2026-03-01T00:00:00.000Z",
        },
      ],
      proposals: [],
    };

    const passing = validateDraft(
      figuresOf(national),
      draft(
        [claim("pengumpulan.total", 11_622_127_523_247n)],
        "Total pengumpulan Rp11.622.127.523.247."
      )
    );
    expect(passing.outcome).toBe("LOLOS");

    const offByOne = validateDraft(
      figuresOf(national),
      draft([claim("pengumpulan.total", 11_622_127_523_246n)])
    );
    expect(offByOne.outcome).toBe("DITOLAK");
  });

  it("meloloskan laporan periode tanpa aktivitas yang diklaim bernilai nol", () => {
    const verdict = validateDraft(
      computePeriodFigures({ donations: [], proposals: [] }, PERIOD),
      draft([claim("pengumpulan.total", 0n)], "Tidak ada pengumpulan: Rp0.")
    );

    expect(verdict.outcome).toBe("LOLOS");
  });

  it("mengeluarkan vonis identik meski urutan klaim diacak", () => {
    // Includes one figure claimed twice with different values: the finding must
    // describe the name, not whichever copy happened to be written first.
    const wrong = [
      claim("pengumpulan.total", 1n),
      claim("penyaluran.fakir.idr", 2n),
      claim("pengumpulan.total", 2n),
      claim("hak_amil.porsi_idr", 3n),
    ];
    const asWritten = validateDraft(figuresOf(), draft(wrong));
    const reversed = validateDraft(figuresOf(), draft([...wrong].reverse()));

    expect(reversed).toEqual(asWritten);
    expect(asWritten.findings.map((f) => f.kind)).toContain("KLAIM_GANDA");
  });

  it("tidak mengenal tingkat peringatan: sebuah draf lolos atau ditolak", () => {
    const outcomes = new Set(
      [draft(TRUE_CLAIMS), draft([claim("pengumpulan.total", 1n)])].map(
        (d) => validateDraft(figuresOf(), d).outcome
      )
    );

    expect([...outcomes].sort()).toEqual(["DITOLAK", "LOLOS"]);
  });
});

describe("Pemindai angka rupiah di dalam narasi", () => {
  it("menangkap bentuk rupiah yang lazim ditulis", () => {
    expect(rupiahMentions("Rp100.000.000 dan Rp 2.500 serta Rp. 7.000").map((m) => m.amount)).toEqual([
      100_000_000n,
      2_500n,
      7_000n,
    ]);
  });

  it("menangkap angka bergolongan ribuan tanpa awalan Rp", () => {
    expect(rupiahMentions("selisihnya 668.020.210.274 rupiah").map((m) => m.amount)).toEqual([
      668_020_210_274n,
    ]);
  });

  it("menangkap angka tanpa titik yang kalimatnya sendiri sebut rupiah", () => {
    expect(rupiahMentions("dana sebesar 888000000 rupiah").map((m) => m.amount)).toEqual([
      888_000_000n,
    ]);
  });

  it("tidak memperlakukan tahun dan persentase sebagai rupiah", () => {
    expect(rupiahMentions("Sepanjang 2026 porsi amil 12,5% dari plafon.")).toEqual([]);
  });
});

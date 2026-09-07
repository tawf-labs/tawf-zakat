import { describe, expect, it } from "bun:test";
import { canSign, describeFinding, findingLabel, verdictHeadline } from "./verdictText";
import type { WireFinding, WireVerdict } from "./types";

const idr = (amount: string) => ({ amount, unit: "IDR" as const });

const finding = (overrides: Partial<WireFinding> = {}): WireFinding => ({
  kind: "KLAIM_TIDAK_COCOK",
  figureName: "pengumpulan.total",
  message: "pesan dari server",
  claimed: idr("120000000"),
  expected: idr("100000000"),
  ...overrides,
});

const verdict = (outcome: WireVerdict["outcome"], findings: WireFinding[] = []): WireVerdict => ({
  outcome,
  findings,
});

describe("Penyajian vonis - menonjol, dan tidak bisa dilewati", () => {
  it("menyatakan draf yang lolos sebagai lolos", () => {
    expect(verdictHeadline(verdict("LOLOS"))).toMatch(/lolos/i);
  });

  it("menyatakan draf yang ditolak sebagai ditolak, bukan sebagai peringatan", () => {
    const rejected = verdict("DITOLAK", [finding()]);

    expect(verdictHeadline(rejected)).toMatch(/ditolak/i);
    expect(verdictHeadline(rejected)).not.toMatch(/peringatan|perhatian/i);
  });

  it("menghitung temuan, bukan angka - sebuah temuan belum tentu sebuah klaim", () => {
    // A narrative leak and a breached ceiling are findings but not claimed
    // figures, so calling the count "angka" would misstate what was wrong.
    const headline = verdictHeadline(
      verdict("DITOLAK", [finding(), finding({ kind: "PLAFON_HAK_AMIL_TERLAMPAUI" })])
    );

    expect(headline).toContain("2");
    expect(headline).toMatch(/temuan/i);
    expect(headline).not.toMatch(/2 angka/);
  });
});

describe("Jalan menuju tanda tangan", () => {
  it("hanya terbuka untuk draf yang lolos", () => {
    expect(canSign(verdict("LOLOS"))).toBe(true);
  });

  it("tertutup untuk draf yang ditolak", () => {
    expect(canSign(verdict("DITOLAK", [finding()]))).toBe(false);
  });

  it("tertutup ketika belum ada vonis sama sekali", () => {
    // No draft, no verdict - and therefore nothing anybody may sign.
    expect(canSign(null)).toBe(false);
  });

  it("tertutup untuk vonis lolos yang entah bagaimana membawa temuan", () => {
    // Belt and braces: the outcome and the findings must agree before a
    // signature is offered, so a malformed response cannot open the door.
    expect(canSign(verdict("LOLOS", [finding()]))).toBe(false);
  });
});

describe("Penjelasan temuan - menyebut angkanya, bukan pesan generik", () => {
  it("menyebut nama angka, nilai yang diklaim, dan nilai yang seharusnya", () => {
    const described = describeFinding(finding());

    expect(described.figureName).toBe("pengumpulan.total");
    expect(described.claimed).toBe("Rp120.000.000");
    expect(described.expected).toBe("Rp100.000.000");
  });

  it("mempertahankan presisi pada orde triliunan", () => {
    const described = describeFinding(
      finding({ claimed: idr("11622127523247"), expected: idr("10954107312973") })
    );

    expect(described.claimed).toBe("Rp11.622.127.523.247");
    expect(described.expected).toBe("Rp10.954.107.312.973");
  });

  it("meneruskan kalimat server apa adanya, karena di situlah angkanya disebut", () => {
    expect(describeFinding(finding({ message: "kalimat asli" })).message).toBe("kalimat asli");
  });

  it("menampilkan kutipan narasi untuk angka yang tidak diklaim", () => {
    const described = describeFinding(
      finding({
        kind: "ANGKA_NARASI_TIDAK_DIKLAIM",
        figureName: null,
        claimed: undefined,
        expected: undefined,
        excerpt: "Rp88.000.000",
      })
    );

    expect(described.excerpt).toBe("Rp88.000.000");
    expect(described.claimed).toBeNull();
    expect(described.expected).toBeNull();
  });

  it("menamai setiap kelas temuan dalam bahasa manusia", () => {
    for (const kind of [
      "KLAIM_TIDAK_COCOK",
      "KLAIM_TIDAK_TERBACA",
      "KLAIM_TIDAK_DIKENAL",
      "KLAIM_GANDA",
      "ANGKA_NARASI_TIDAK_DIKLAIM",
      "PLAFON_HAK_AMIL_TERLAMPAUI",
    ] as const) {
      const label = findingLabel(kind);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(kind);
    }
  });

  it("menyajikan satuan bukan-rupiah dengan kata satuannya sendiri", () => {
    const described = describeFinding(
      finding({
        figureName: "hak_amil.porsi_bps",
        claimed: { amount: "1300", unit: "BPS" },
        expected: { amount: "1250", unit: "BPS" },
      })
    );

    expect(described.claimed).toBe("13%");
    expect(described.expected).toBe("12,5%");
  });
});

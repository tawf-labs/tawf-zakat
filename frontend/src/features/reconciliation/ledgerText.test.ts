import { describe, expect, it } from "bun:test";
import { parseLedgerText, parseRupiah, bucketsUsed } from "./ledgerText";
import { formatMoney, formatSignedMoney, formatUsdc, groupDigits } from "./format";
import {
  LPZN_2024_CLAIM_LABEL,
  LPZN_2024_CLAIM_TEXT,
  LPZN_2024_EXPECTED_GAP,
  LPZN_2024_SOURCE_LABEL,
  LPZN_2024_SOURCE_TEXT,
} from "./lpznDemo";

describe("parseRupiah", () => {
  it("reads rupiah written with dots as thousand separators", () => {
    expect(parseRupiah("1.500.000.000")).toBe("1500000000");
    expect(parseRupiah("Rp 11.622.127.523.247")).toBe("11622127523247");
    expect(parseRupiah("750000000")).toBe("750000000");
  });

  it("keeps national-scale figures exact", () => {
    expect(parseRupiah("11.622.127.523.247")).toBe("11622127523247");
  });

  it("refuses text that is not a whole rupiah figure", () => {
    expect(parseRupiah("dua juta")).toBeNull();
    expect(parseRupiah("1.5jt")).toBeNull();
    expect(parseRupiah("")).toBeNull();
  });
});

describe("parseLedgerText", () => {
  it("reads a semicolon separated recap into ledger entries", () => {
    const { side, issues } = parseLedgerText(
      [
        "PZ-1401;BAZNAS Kab. Kampar;Zakat;on;1.500.000.000",
        "PZ-1471;BAZNAS Kota Pekanbaru;Infak/Sedekah;on;240.000.000",
      ].join("\n"),
      "Rekap Wilayah Riau"
    );

    expect(issues).toEqual([]);
    expect(side.label).toBe("Rekap Wilayah Riau");
    expect(side.entries).toHaveLength(2);
    expect(side.entries[0]).toEqual({
      key: "PZ-1401",
      bucket: "ZAKAT",
      balanceSheet: "ON",
      value: { amount: "1500000000", unit: "IDR" },
      label: "BAZNAS Kab. Kampar",
    });
    expect(side.entries[1].bucket).toBe("INFAK_SEDEKAH");
  });

  it("accepts tab separated text pasted straight out of a spreadsheet", () => {
    const { side, issues } = parseLedgerText(
      "PZ-1401\tBAZNAS Kab. Kampar\tZakat Mal\ton\t1.500.000.000",
      "Rekap"
    );
    expect(issues).toEqual([]);
    expect(side.entries[0].value.amount).toBe("1500000000");
  });

  it("defaults a row without a balance sheet column to on balance sheet", () => {
    const { side } = parseLedgerText("PZ-1401;BAZNAS Kab. Kampar;Zakat;1.000.000", "Rekap");
    expect(side.entries[0].balanceSheet).toBe("ON");
  });

  it("reads off balance sheet rows", () => {
    const { side } = parseLedgerText("PZ-1401;Kampar;Kurban;off;2.000.000", "Rekap");
    expect(side.entries[0].balanceSheet).toBe("OFF");
  });

  it("turns a TOTAL row into a declared total rather than an entry", () => {
    const { side } = parseLedgerText(
      ["PZ-1401;Kampar;Zakat;on;600.000.000", "TOTAL;Total Zakat;Zakat;on;600.000.000"].join("\n"),
      "Rekap"
    );

    expect(side.entries).toHaveLength(1);
    expect(side.declaredTotals).toHaveLength(1);
    expect(side.declaredTotals![0].bucket).toBe("ZAKAT");
    expect(side.declaredTotals![0].value.amount).toBe("600000000");
  });

  it("turns a GRAND TOTAL row into a declared grand total", () => {
    const { side } = parseLedgerText(
      ["PZ-1401;Kampar;Zakat;on;600.000.000", "GRAND TOTAL;Total;-;on;600.000.000"].join("\n"),
      "Rekap"
    );

    expect(side.declaredTotals![0].bucket).toBe("GRAND_TOTAL");
  });

  it("skips blank lines, comments and a header row", () => {
    const { side, issues } = parseLedgerText(
      [
        "Kode PZ;Nama;Jenis Dana;Posisi;Jumlah (Rp)",
        "# catatan dari staf",
        "",
        "PZ-1401;Kampar;Zakat;on;1.000",
      ].join("\n"),
      "Rekap"
    );

    expect(issues).toEqual([]);
    expect(side.entries).toHaveLength(1);
  });

  it("names the line of a row it cannot read instead of dropping the whole paste", () => {
    const { side, issues } = parseLedgerText(
      ["PZ-1401;Kampar;Zakat;on;1.000.000", "PZ-1402;Rokan;Zakat;on;dua juta"].join("\n"),
      "Rekap"
    );

    expect(side.entries).toHaveLength(1);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(2);
    expect(issues[0].message).toContain("PZ-1402");
    expect(issues[0].message).toContain("Baris 2");
  });

  it("rejects a negative amount by line", () => {
    const { issues } = parseLedgerText("PZ-1401;Kampar;Zakat;on;-5.000", "Rekap");
    expect(issues[0].message).toContain("negatif");
  });

  it("rejects an unreadable balance sheet position by line", () => {
    const { issues } = parseLedgerText("PZ-1401;Kampar;Zakat;menggantung;1.000", "Rekap");
    expect(issues[0].message).toContain("posisi neraca");
  });

  it("reports a row with too few columns", () => {
    const { issues } = parseLedgerText("PZ-1401;1.000", "Rekap");
    expect(issues[0].message).toContain("kolom");
  });

  it("refuses an unknown jenis dana by default, naming the line and what is expected", () => {
    const { side, issues } = parseLedgerText(
      ["PZ-1401;Kampar;Zakat;on;1.000", "PZ-1402;Rokan;Zakat Profesi;on;2.000"].join("\n"),
      "Rekap"
    );

    expect(side.entries).toHaveLength(1);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(2);
    expect(issues[0].message).toContain("Zakat Profesi");
    expect(issues[0].message).toContain("Zakat Fitrah");
  });

  it("accepts another bucket dimension only when the caller asks for it", () => {
    const strict = parseLedgerText(
      "NASIONAL;BAZNAS Provinsi;BAZNAS Provinsi;on;925.076.124.372",
      "Tabel 2.3"
    );
    expect(strict.side.entries).toHaveLength(0);
    expect(strict.issues).toHaveLength(1);

    const loose = parseLedgerText(
      "NASIONAL;BAZNAS Provinsi;BAZNAS Provinsi;on;925.076.124.372",
      "Tabel 2.3",
      "BEBAS"
    );
    expect(loose.issues).toEqual([]);
    expect(loose.side.entries[0].bucket).toBe("BAZNAS_PROVINSI");
  });
});

describe("bucketsUsed", () => {
  it("collects every bucket both sides use, without the grand total marker", () => {
    const claim = parseLedgerText(
      ["PZ-1;A;Zakat;on;1.000", "GRAND TOTAL;T;-;on;1.000"].join("\n"),
      "Rekap"
    ).side;
    const source = parseLedgerText("PZ-1;A;Kurban;on;1.000", "Laporan").side;

    expect(bucketsUsed(claim, source)).toEqual(["KURBAN", "ZAKAT"]);
  });
});

describe("LPZN 2024 demo text", () => {
  it("parses into the figures printed in the official report", () => {
    const claim = parseLedgerText(LPZN_2024_CLAIM_TEXT, LPZN_2024_CLAIM_LABEL);
    const source = parseLedgerText(LPZN_2024_SOURCE_TEXT, LPZN_2024_SOURCE_LABEL, "BEBAS");

    expect(claim.issues).toEqual([]);
    expect(source.issues).toEqual([]);
    expect(claim.side.entries).toHaveLength(5);
    expect(source.side.entries).toHaveLength(6);

    const sum = (entries: { value: { amount: string } }[]) =>
      entries.reduce((total, e) => total + BigInt(e.value.amount), 0n);

    // Each table adds up to its own printed grand total.
    expect(sum(claim.side.entries)).toBe(11_622_127_523_247n);
    expect(BigInt(claim.side.declaredTotals![0].value.amount)).toBe(11_622_127_523_247n);
    expect(sum(source.side.entries)).toBe(10_954_107_312_973n);
    expect(BigInt(source.side.declaredTotals![0].value.amount)).toBe(10_954_107_312_973n);

    // Yet they differ by Rp668.020.210.274.
    expect(sum(claim.side.entries) - sum(source.side.entries)).toBe(BigInt(LPZN_2024_EXPECTED_GAP));
  });
});

describe("the LPZN demo files an Amil can upload", () => {
  const read = (path: string) => Bun.file(path).text();

  it("parse from disk into the same figures as the pasted text", async () => {
    const claim = parseLedgerText(
      await read("public/contoh/lpzn-2024-tabel-2-2-per-jenis-dana.csv"),
      "Tabel 2.2"
    );
    const source = parseLedgerText(
      await read("public/contoh/lpzn-2024-tabel-2-3-per-jenis-pengelola-zakat.csv"),
      "Tabel 2.3",
      "BEBAS"
    );

    expect(claim.issues).toEqual([]);
    expect(source.issues).toEqual([]);

    const sum = (entries: { value: { amount: string } }[]) =>
      entries.reduce((total, e) => total + BigInt(e.value.amount), 0n);

    expect(sum(claim.side.entries) - sum(source.side.entries)).toBe(BigInt(LPZN_2024_EXPECTED_GAP));
  });
});

describe("formatting figures", () => {
  it("groups rupiah the Indonesian way at trillion scale", () => {
    expect(groupDigits("11622127523247")).toBe("11.622.127.523.247");
    expect(formatMoney({ amount: "668020210274", unit: "IDR" })).toBe("Rp668.020.210.274");
  });

  it("keeps the sign visible so the direction of a gap is unambiguous", () => {
    expect(formatSignedMoney({ amount: "668020210274", unit: "IDR" })).toBe("+Rp668.020.210.274");
    expect(formatSignedMoney({ amount: "-605523322541", unit: "IDR" })).toBe("-Rp605.523.322.541");
    expect(formatSignedMoney({ amount: "0", unit: "IDR" })).toBe("Rp0");
  });

  it("renders USDC minor units without floating point", () => {
    expect(formatUsdc("50000000")).toBe("50");
    expect(formatUsdc("1500000")).toBe("1,5");
    expect(formatUsdc("500000")).toBe("0,5");
    expect(formatMoney({ amount: "50000000", unit: "USDC_6DP" })).toBe("50 USDC");
  });
});

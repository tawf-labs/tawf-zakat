import { describe, expect, it } from "bun:test";
import { newBeneficiary, type Beneficiary } from "./disbursementClient";
import {
  beneficiaryLabel,
  matchBeneficiary,
  normalizeChoice,
  normalizeNik,
  normalizeQuantity,
  normalizeRupiah,
  parseAidKind,
  parseIdentityKind,
  parseTsv,
  toTsv,
} from "./spreadsheet";

const person = (name: string, nik: string): Beneficiary => ({ ...newBeneficiary(), name, identityBasis: { kind: "NIK", value: nik } });

describe("clipboard TSV", () => {
  it("splits a copied Excel block and ignores its trailing newline", () => {
    expect(parseTsv("Ani\tFakir\nBudi\tMiskin\n")).toEqual([["Ani", "Fakir"], ["Budi", "Miskin"]]);
  });

  it("keeps empty cells and CRLF line endings", () => {
    expect(parseTsv("a\t\tc\r\n\tb\t")).toEqual([["a", "", "c"], ["", "b", ""]]);
  });

  it("reads quoted cells containing tabs, newlines and escaped quotes", () => {
    expect(parseTsv('"Jl. Mawar\nRT 01"\t"kata ""kutip"""')).toEqual([["Jl. Mawar\nRT 01", 'kata "kutip"']]);
  });

  it("round-trips through toTsv", () => {
    const rows = [["a\tb", 'c"d'], ["e\nf", ""]];
    expect(parseTsv(toTsv(rows))).toEqual(rows);
  });
});

describe("normalisation", () => {
  it("strips rupiah formatting only when it is unambiguous", () => {
    expect(normalizeRupiah("Rp 1.500.000")).toBe("1500000");
    expect(normalizeRupiah("1,500,000")).toBe("1500000");
    expect(normalizeRupiah("1.500.000,00")).toBe("1500000");
    expect(normalizeRupiah("250000,00")).toBe("250000");
    expect(normalizeRupiah("1.5")).toBe("1.5");
    expect(normalizeRupiah("sejuta")).toBe("sejuta");
  });

  it("turns a decimal comma into the exact-decimal dot", () => {
    expect(normalizeQuantity("2,5")).toBe("2.5");
    expect(normalizeQuantity("10")).toBe("10");
  });

  it("cleans a pasted NIK without inventing digits", () => {
    expect(normalizeNik("'3201 0101-0180 0001")).toBe("3201010101800001");
    expect(normalizeNik("3.20101E+15")).toBe("320101E+15");
  });

  it("matches option spellings case- and underscore-insensitively", () => {
    expect(normalizeChoice("fakir", ["Fakir", "Ibnu Sabil"])).toBe("Fakir");
    expect(normalizeChoice("IBNU_SABIL", ["Fakir", "Ibnu Sabil"])).toBe("Ibnu Sabil");
    expect(normalizeChoice(" duafa ", ["Fakir"])).toBe("duafa");
  });

  it("recognises identity and aid kinds in template wording", () => {
    expect(parseIdentityKind("alternatif")).toBe("ALTERNATIVE");
    expect(parseIdentityKind("NIK")).toBe("NIK");
    expect(parseIdentityKind("KTP")).toBeNull();
    expect(parseAidKind("Barang")).toBe("GOODS");
    expect(parseAidKind("uang")).toBe("MONEY");
    expect(parseAidKind("jasa")).toBeNull();
  });
});

describe("recipient matching", () => {
  const ani = person("Ani", "3201010101800001");
  const ani2 = person("Ani", "3201010101800002");
  const budi = person("Budi", "3201010101800003");
  const roster = [ani, ani2, budi];

  it("labels recipients with their NIK tail", () => {
    expect(beneficiaryLabel(ani, 0)).toBe("Ani · ••0001");
    expect(beneficiaryLabel(newBeneficiary(), 4)).toBe("Penerima 5");
  });

  it("matches the displayed label, a full NIK, or a unique name", () => {
    expect(matchBeneficiary("Ani · ••0002", roster)).toBe(ani2.id);
    expect(matchBeneficiary("3201010101800001", roster)).toBe(ani.id);
    expect(matchBeneficiary("budi", roster)).toBe(budi.id);
  });

  it("refuses an ambiguous or unknown name", () => {
    expect(matchBeneficiary("Ani", roster)).toBeNull();
    expect(matchBeneficiary("Citra", roster)).toBeNull();
  });
});

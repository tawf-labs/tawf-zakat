import { describe, expect, test } from "bun:test";
import {
  exactLineTotal,
  operationalCostTotals,
  receiptFileTypeOf,
  summarizeHolders,
  validateCostItemInput,
  validatePanjarInput,
  validateReceiptInput,
  type CostItemRecord,
  type PanjarRecord,
} from "../src/operational-cost";

// ADR-0042: one row per cost item, free-text purpose, a fund source per row.

const row = (overrides: Record<string, unknown> = {}) => ({
  spentOn: "2026-09-28",
  purpose: "Bensin",
  quantity: "10",
  unit: "liter",
  unitPriceIdr: "10000",
  amountIdr: "100000",
  payee: "SPBU 34.153",
  fundingSource: { kind: "TALANGAN", holderOfficerId: "off-ahmad" },
  ...overrides,
});

const fields = (input: unknown) => {
  const result = validateCostItemInput(input);
  return result.ok ? [] : result.issues.map((issue) => issue.field);
};

describe("validateCostItemInput", () => {
  test("accepts a fully itemised row and trims text", () => {
    const result = validateCostItemInput(row({ purpose: "  Bensin  ", payee: " SPBU 34.153 " }));
    expect(result).toEqual({
      ok: true,
      value: {
        spentOn: "2026-09-28", purpose: "Bensin", quantity: "10", unit: "liter", unitPriceIdr: "10000",
        amountIdr: "100000", payee: "SPBU 34.153", fundingSource: { kind: "TALANGAN", holderOfficerId: "off-ahmad" },
        receiptId: null,
      },
    });
  });

  test("quantity, unit and price are optional; the total alone is enough", () => {
    const result = validateCostItemInput(row({ quantity: "", unit: null, unitPriceIdr: undefined, amountIdr: "25000",
      fundingSource: { kind: "KAS_LEMBAGA" } }));
    expect(result.ok && result.value).toMatchObject({ quantity: null, unit: null, unitPriceIdr: null, amountIdr: "25000" });
  });

  test("the total must equal quantity times price exactly, with decimal quantities", () => {
    expect(fields(row({ quantity: "2.5", unitPriceIdr: "10000", amountIdr: "25000" }))).toEqual([]);
    expect(fields(row({ amountIdr: "110000" }))).toEqual(["amountIdr"]);
    // 1.5 × 3 = 4.5 rupiah cannot be a whole-rupiah total.
    expect(fields(row({ quantity: "1.5", unitPriceIdr: "3", amountIdr: "4" }))).toEqual(["amountIdr"]);
  });

  test("requires a date, a purpose, a payee and a positive whole-rupiah total", () => {
    expect(fields(row({ spentOn: "28/09/2026", purpose: " ", payee: "", amountIdr: "0" })).sort())
      .toEqual(["amountIdr", "payee", "purpose", "spentOn"]);
    expect(fields(row({ spentOn: "2026-02-30" }))).toEqual(["spentOn"]);
    expect(fields(row({ quantity: null, unit: null, unitPriceIdr: null, amountIdr: "1000.5" }))).toEqual(["amountIdr"]);
  });

  test("a unit needs a quantity, and quantity/price must be positive", () => {
    expect(fields(row({ quantity: null, unitPriceIdr: null }))).toEqual(["unit"]);
    expect(fields(row({ quantity: "0" }))).toContain("quantity");
    expect(fields(row({ unitPriceIdr: "-1" }))).toContain("unitPriceIdr");
  });

  test("names the holder for a talangan and the panjar for a panjar row", () => {
    expect(fields(row({ fundingSource: { kind: "TALANGAN" } }))).toEqual(["fundingSource"]);
    expect(fields(row({ fundingSource: { kind: "PANJAR", panjarId: "" } }))).toEqual(["fundingSource"]);
    expect(fields(row({ fundingSource: { kind: "HAK_AMIL" } }))).toEqual(["fundingSource"]);
    expect(fields(row({ fundingSource: { kind: "PANJAR", panjarId: "pj-1" } }))).toEqual([]);
  });
});

describe("exactLineTotal", () => {
  test("multiplies exactly or says the product is not whole rupiah", () => {
    expect(exactLineTotal("10", "10000")).toBe("100000");
    expect(exactLineTotal("2.25", "4000")).toBe("9000");
    expect(exactLineTotal("1.5", "3")).toBeNull();
  });
});

describe("validatePanjarInput", () => {
  test("requires a holder, an amount, a purpose, a cash-out reference and a date", () => {
    const ok = validatePanjarInput({ holderOfficerId: "off-siti", amountIdr: "300000", purpose: "Jumat Berkah",
      cashOutRef: "BKK-001", issuedOn: "2026-09-28" });
    expect(ok.ok).toBe(true);
    const bad = validatePanjarInput({ holderOfficerId: "", amountIdr: "0", purpose: "", cashOutRef: "", issuedOn: "x" });
    expect(bad.ok ? [] : bad.issues.map((i) => i.field).sort())
      .toEqual(["amountIdr", "cashOutRef", "holderOfficerId", "issuedOn", "purpose"]);
  });
});

describe("validateReceiptInput", () => {
  test("a nota needs a number, a date and a kind; the issuer may be unknown", () => {
    expect(validateReceiptInput({ kind: "NOTA", reference: " KW-012 ", issuedOn: "2026-09-28", issuer: "" })).toEqual({
      ok: true, value: { kind: "NOTA", reference: "KW-012", issuedOn: "2026-09-28", issuer: null },
    });
    expect(validateReceiptInput({ kind: "SURAT_PERNYATAAN", reference: "Struk bensin hilang", issuedOn: "2026-09-29" }).ok).toBe(true);
    const bad = validateReceiptInput({ kind: "FAKTUR", reference: "", issuedOn: "28/09/2026" });
    expect(bad.ok ? [] : bad.issues.map((i) => i.field).sort()).toEqual(["issuedOn", "kind", "reference"]);
  });
});

describe("receiptFileTypeOf", () => {
  test("tells JPG, PNG and PDF by their leading bytes, and nothing else", () => {
    expect(receiptFileTypeOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("image/jpeg");
    expect(receiptFileTypeOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(receiptFileTypeOf(new TextEncoder().encode("%PDF-1.7\n"))).toBe("application/pdf");
    expect(receiptFileTypeOf(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(receiptFileTypeOf(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

const item = (id: string, amountIdr: string, fundingSource: CostItemRecord["fundingSource"], extra: Partial<CostItemRecord> = {}): CostItemRecord => ({
  id, proposalId: "prop-1", version: 1, status: "ACTIVE", spentOn: "2026-09-28", purpose: id, quantity: null, unit: null,
  unitPriceIdr: null, amountIdr, payee: "Toko", fundingSource, receiptId: null, reimbursementId: null, recordedByOfficerId: "off-admin",
  recordedAt: 1, updatedAt: 1, ...extra,
});
const panjar = (id: string, holderOfficerId: string, amountIdr: string): PanjarRecord => ({
  id, proposalId: "prop-1", holderOfficerId, amountIdr, purpose: "Kegiatan", cashOutRef: `BKK-${id}`, issuedOn: "2026-09-28",
  recordedByOfficerId: "off-admin", recordedAt: 1, returns: [],
});

describe("operational cost totals and holder summary", () => {
  const items = [
    item("mobil", "300000", { kind: "TALANGAN", holderOfficerId: "off-ahmad" }),
    item("bensin", "100000", { kind: "TALANGAN", holderOfficerId: "off-ahmad" }, { reimbursementId: "rb-1" }),
    item("plastik", "40000", { kind: "PANJAR", panjarId: "pj-1" }),
    item("tali", "10000", { kind: "PANJAR", panjarId: "pj-1" }),
    item("dobel", "40000", { kind: "PANJAR", panjarId: "pj-1" }, { status: "VOIDED" }),
    item("transfer", "6500", { kind: "KAS_LEMBAGA" }),
  ];
  const panjars = [{ ...panjar("pj-1", "off-siti", "300000"), returns: [{ id: "ret-1", amountIdr: "50000", returnedOn: "2026-09-29", reference: "Setor kas", recordedAt: 2 }] }];

  test("voided rows drop out; panjar spend is accounted, the rest is direct", () => {
    expect(operationalCostTotals(items, panjars)).toEqual({
      directExpensesIdr: "406500",
      panjarAccountedIdr: "50000",
      panjarNetIdr: "250000",
      totalItemsIdr: "456500",
    });
  });

  test("each holder shows talangan owed and paid back, and every panjar's use and remainder", () => {
    const names = new Map([["off-ahmad", "Ahmad"], ["off-siti", "Siti"]]);
    expect(summarizeHolders(items, panjars, names)).toEqual([
      { officerId: "off-ahmad", name: "Ahmad", talanganOutstandingIdr: "300000", talanganReimbursedIdr: "100000", panjar: [] },
      { officerId: "off-siti", name: "Siti", talanganOutstandingIdr: "0", talanganReimbursedIdr: "0", panjar: [
        { panjarId: "pj-1", cashOutRef: "BKK-pj-1", amountIdr: "300000", usedIdr: "50000", returnedIdr: "50000", remainingIdr: "200000" },
      ] },
    ]);
  });
});

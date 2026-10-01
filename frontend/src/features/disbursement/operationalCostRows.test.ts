import { describe, expect, it } from "bun:test";
import { parseTsv } from "./spreadsheet";
import {
  costColumns,
  costInputOf,
  costRowIssues,
  displayDate,
  fundingLabel,
  fundingOptions,
  matchReceiptFiles,
  newCostDraft,
  normalizeDate,
  parseFunding,
  type CostContext,
  type CostRow,
} from "./operationalCostRows";
import type { Panjar, Receipt } from "./operationalCostClient";

const panjar = (id: string, holderOfficerId: string, cashOutRef: string): Panjar => ({
  id, proposalId: "prop-1", holderOfficerId, amountIdr: "300000", purpose: "Jumat Berkah", cashOutRef, issuedOn: "2026-09-28",
  recordedByOfficerId: "off-admin", recordedAt: 1, returns: [],
});
const receipt = (id: string, reference: string, files = 0): Receipt => ({
  id, proposalId: "prop-1", kind: "NOTA", reference, issuedOn: "2026-09-28", issuer: null, recordedByOfficerId: "off-admin",
  recordedAt: 1, evidencedAt: null,
  files: Array.from({ length: files }, (_, i) => ({
    id: `f-${i}`, receiptId: id, fileName: `${reference}.jpg`, mimeType: "image/jpeg" as const, sizeBytes: 1, contentSha256: "0x",
    uploadedByOfficerId: "off-admin", uploadedAt: 1,
  })),
});

const ctx: CostContext = {
  officers: [
    { id: "off-ahmad", displayName: "Ahmad", isActive: true },
    { id: "off-siti", displayName: "Siti Aminah", isActive: true },
    { id: "off-lama", displayName: "Budi", isActive: false },
  ],
  panjar: [panjar("pjr-1", "off-siti", "BKK-001")],
  receipts: [receipt("nta-1", "KW-012", 2), receipt("nta-2", "STR-0457")],
};

/** Pastes one TSV line across the grid's columns from the first, as the grid does. */
function paste(line: string, row: CostRow = newCostDraft()): CostRow {
  const columns = costColumns(ctx, [], 2026);
  return parseTsv(line)[0].reduce((current, text, c) => {
    const column = columns[c];
    return column.apply!(current, column.normalize ? column.normalize(text) : text) ?? current;
  }, row);
}

describe("normalizeDate", () => {
  it("reads Indonesian day-first dates, two-digit years and a bare day/month", () => {
    expect(normalizeDate("28/09/2026")).toBe("2026-09-28");
    expect(normalizeDate("28-9-26")).toBe("2026-09-28");
    expect(normalizeDate("1.10.2026")).toBe("2026-10-01");
    expect(normalizeDate("28/09", 2026)).toBe("2026-09-28");
    expect(normalizeDate("2026-9-8")).toBe("2026-09-08");
  });
  it("keeps what is not a real date so validation can flag it", () => {
    expect(normalizeDate("31/02/2026")).toBe("31/02/2026");
    expect(normalizeDate("kemarin")).toBe("kemarin");
    expect(displayDate("2026-09-28")).toBe("28/09/2026");
  });
});

describe("pasting a row from Excel", () => {
  it("normalises dates, rupiah and decimal commas, and fills the total from Jml × Harga", () => {
    const row = paste("28/09/2026\tBensin\t10,5\tliter\tRp 10.000\t\tSPBU 34.153\tSTR-0457\ttalangan ahmad");
    expect(row.fields).toEqual({
      spentOn: "2026-09-28", purpose: "Bensin", quantity: "10.5", unit: "liter", unitPriceIdr: "10000", amountIdr: "105000",
      payee: "SPBU 34.153", receiptRef: "STR-0457", funding: "talangan ahmad",
    });
    expect(costRowIssues(row.fields, ctx)).toEqual({});
    expect(costInputOf(row.fields, ctx, "nta-2")).toEqual({
      spentOn: "2026-09-28", purpose: "Bensin", quantity: "10.5", unit: "liter", unitPriceIdr: "10000", amountIdr: "105000",
      payee: "SPBU 34.153", fundingSource: { kind: "TALANGAN", holderOfficerId: "off-ahmad" }, receiptId: "nta-2",
    });
  });

  it("accepts a total alone, with Jml, Satuan and Harga left empty", () => {
    const row = paste("28/09\tCetak foto\t\t\t\t25.000\tFotocopy Jaya\t\tKas lembaga");
    expect(costRowIssues(row.fields, ctx)).toEqual({});
    expect(costInputOf(row.fields, ctx, null)).toMatchObject({ quantity: null, unit: null, unitPriceIdr: null, amountIdr: "25000" });
  });

  it("flags each problem on its own cell, mirroring the server's row rules", () => {
    const row = paste("kemarin\t\t2\tliter\t10000\t30000\t\t\tTalangan Joko");
    expect(Object.keys(costRowIssues(row.fields, ctx)).sort()).toEqual(["amountIdr", "funding", "payee", "purpose", "spentOn"]);
    expect(costRowIssues({ ...row.fields, quantity: "" }, ctx).unit).toBe("Satuan hanya diisi bersama Jml.");
    expect(costRowIssues({ ...row.fields, quantity: "0.5", unitPriceIdr: "3", amountIdr: "2" }, ctx).amountIdr)
      .toContain("pecahan rupiah");
  });
});

describe("parseFunding", () => {
  it("reads the dropdown labels back, regardless of case and spacing", () => {
    expect(fundingOptions(ctx)).toEqual(["Kas lembaga", "Talangan Ahmad", "Talangan Siti Aminah", "Panjar Siti Aminah · BKK-001"]);
    for (const label of fundingOptions(ctx)) {
      const parsed = parseFunding(label, ctx);
      expect(parsed.ok && fundingLabel(parsed.source, ctx)).toBe(label);
    }
    expect(parseFunding("kas", ctx)).toEqual({ ok: true, source: { kind: "KAS_LEMBAGA" } });
    expect(parseFunding("TALANGAN  siti aminah", ctx)).toEqual({ ok: true, source: { kind: "TALANGAN", holderOfficerId: "off-siti" } });
    expect(parseFunding("Panjar BKK-001", ctx)).toEqual({ ok: true, source: { kind: "PANJAR", panjarId: "pjr-1" } });
    expect(parseFunding("Panjar Siti Aminah", ctx)).toEqual({ ok: true, source: { kind: "PANJAR", panjarId: "pjr-1" } });
  });

  it("refuses inactive, unknown and ambiguous officers and panjar", () => {
    expect(parseFunding("Talangan Budi", ctx).ok).toBe(false);
    expect(parseFunding("Transfer", ctx).ok).toBe(false);
    expect(parseFunding("", ctx).ok).toBe(false);
    const twice = { ...ctx, panjar: [...ctx.panjar, panjar("pjr-2", "off-siti", "BKK-002")] };
    const ambiguous = parseFunding("Panjar Siti Aminah", twice);
    expect(ambiguous.ok ? null : ambiguous.message).toContain("lebih dari satu panjar");
    const namesakes = { ...ctx, officers: [...ctx.officers, { id: "off-ahmad-2", displayName: "ahmad", isActive: true }] };
    expect(parseFunding("Talangan Ahmad", namesakes).ok).toBe(false);
  });
});

describe("matchReceiptFiles", () => {
  it("pairs files with the nota their names carry, longest number first", () => {
    const receipts = [receipt("nta-1", "KW-012"), receipt("nta-3", "KW-0123"), receipt("nta-2", "STR-0457")];
    expect(matchReceiptFiles(
      ["KW-012.jpg", "kw012.PDF", "KW-012 (belakang).jpg", "KW-0123_depan.png", "str 0457.jpg", "IMG_2041.jpg", "KW-0124.jpg"],
      receipts,
    ).map((m) => m.receiptId)).toEqual(["nta-1", "nta-1", "nta-1", "nta-3", "nta-2", null, null]);
  });
});

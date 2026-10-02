import { describe, expect, it } from "bun:test";
import { reconcile, GRAND_TOTAL_BUCKET, type LedgerEntry, type LedgerSide } from "../src/reconciliation";
import { normalizeSide, entriesFrom, type SourceManifest } from "../src/evidence-source";
import { mapSourceTabular } from "../src/source-tabular-schema";
import { decodeTabular } from "../src/tabular-reader";
import { generateSourceCsvTemplate, generateSourceXlsxTemplate } from "../src/source-template-generator";
import { readTabularSource } from "../src/source-import";
import { computeSnapshotFigures } from "../src/period-report";
import { freezeSnapshot } from "../src/evidence-snapshot";

const period = { kind: "AKHIR_TAHUN" as const, year: 2026 };
const manifest: SourceManifest = { role: "SOURCE", label: "Pembukuan", origin: "UPLOAD", institutionId: "institution",
  scopeUnit: "Wilayah", scopeLevel: "KOTA", fundTypes: ["ZAKAT", "INFAK_SEDEKAH"], balanceSheet: "BOTH", currencyUnit: "IDR",
  period, cutOff: "2026-12-31T23:59:59.000Z", format: "CSV", mappingVersion: "v2", transactionDetail: "PRESENT", note: null,
  flows: ["COLLECTION", "DISTRIBUTION"] };
const entry = (flow: "COLLECTION" | "DISTRIBUTION", amount: bigint, bucket = "ZAKAT"): LedgerEntry => ({
  key: "SAME-KEY", bucket, flow, balanceSheet: "ON", value: { amount, unit: "IDR" },
});
const side = (collection: bigint, distribution: bigint): LedgerSide => ({ label: "Books", entries: [entry("COLLECTION", collection), entry("DISTRIBUTION", distribution)],
  declaredTotals: [entry("COLLECTION", collection, GRAND_TOTAL_BUCKET), entry("DISTRIBUTION", distribution, GRAND_TOTAL_BUCKET)] });

describe("Flow-aware collection and distribution (#134)", () => {
  it("never matches across flows, even when key, bucket, position and amount coincide", () => {
    const result = reconcile({ label: "Books", entries: [entry("COLLECTION", 100n)] },
      { label: "App", entries: [entry("DISTRIBUTION", 100n)] }, { period });
    expect(result.balanced).toBe(false);
    expect(result.entryCounts.matched).toBe(0);
    expect(result.absoluteDelta.amount).toBe(200n);
    expect(result.discrepancies.map(d => d.key).sort()).toEqual(["COLLECTION:SAME-KEY", "DISTRIBUTION:SAME-KEY"]);
  });

  it("checks duplicates, bucket totals and grand totals within each flow, never sums both", () => {
    const balanced = reconcile(side(100n, 200n), side(100n, 200n), { period });
    expect(balanced.balanced).toBe(true);
    expect(balanced.entryCounts.matched).toBe(2);
    const broken = side(100n, 200n);
    broken.declaredTotals![0].value.amount = 300n; // false combined collection+distribution total
    const result = reconcile(broken, side(100n, 200n), { period });
    expect(result.balanced).toBe(false);
    expect(result.discrepancies.filter(d => d.key.startsWith("COLLECTION:")).length).toBe(2);
    expect(result.discrepancies.some(d => d.key.startsWith("DISTRIBUTION:"))).toBe(false);
    const duplicate = side(100n, 200n);
    duplicate.entries.push(entry("COLLECTION", 100n));
    expect(reconcile(duplicate, side(100n, 200n), { period }).discrepancies.some(d => d.kind === "DUPLICATE_KEY")).toBe(true);
  });

  it("retains uploaded collection amil ceiling findings beside realization-specific distribution basis", () => {
    const books = side(800n, 200n);
    books.entries[0].amilAmount = { amount: 101n, unit: "IDR" };
    books.amilBasis = [{ key: "distribution-basis", balanceSheet: "ON", collected: { amount: 200n, unit: "IDR" }, actual: { amount: 20n, unit: "IDR" } }];
    const result = reconcile(books, books, { period });
    expect(result.amilAssessment.status).toBe("EXCEEDED");
    expect(result.amilAssessment.checks.find(check => check.key === "COLLECTION:SAME-KEY")!.status).toBe("EXCEEDED");
    expect(result.amilAssessment.checks.find(check => check.key === "DISTRIBUTION:distribution-basis")!.status).toBe("WITHIN_CEILING");
  });

  it("does not allow different currencies to hide in different flows", () => {
    const source = side(100n, 200n);
    source.entries[0].value.unit = "USDC_6DP";
    expect(() => reconcile(source, side(100n, 200n), { period })).toThrow();
  });

  it("validates normalized bookkeeping flows and preserves them when converting to ledger entries", () => {
    const payload = { manifest, status: "READ", rows: [{ key: "1", bucket: "ZAKAT", balanceSheet: "ON", flow: "COLLECTION", value: { amount: "100", unit: "IDR" } }] };
    const read = normalizeSide(payload, "SOURCE", "institution");
    expect(read.issues).toEqual([]);
    expect(entriesFrom(read.side!).entries[0].flow).toBe("COLLECTION");
    expect(normalizeSide({ ...payload, rows: [{ ...payload.rows[0], flow: undefined }] }, "SOURCE", "institution").issues.some(i => i.field === "flow")).toBe(true);
    expect(normalizeSide({ ...payload, rows: [{ ...payload.rows[0], flow: "BAD" }] }, "SOURCE", "institution").issues.some(i => i.field === "flow")).toBe(true);
    expect(normalizeSide({ ...payload, manifest: { ...manifest, flows: ["BAD"] } }, "SOURCE", "institution").issues.some(i => i.field === "manifest.flows")).toBe(true);
  });

  it("templates and imported workbooks carry both flows, including separate calculable totals", () => {
    for (const [bytes, fileName] of [[generateSourceCsvTemplate(), "books.csv"], [generateSourceXlsxTemplate(), "books.xlsx"]] as const) {
      const decoded = decodeTabular(bytes, fileName);
      expect(decoded.success).toBe(true);
      const mapped = mapSourceTabular(decoded.table!, manifest);
      expect(mapped.issues).toEqual([]);
      expect(new Set(mapped.validRows.map(row => row.flow))).toEqual(new Set(["COLLECTION", "DISTRIBUTION"]));
      expect(mapped.totalsByFlow).toEqual([{ flow: "COLLECTION", amount: "2500000000" }, { flow: "DISTRIBUTION", amount: "3000000000" }]);
      expect(mapped.calculableTotal).toBe("3000000000");
      const issues: any[] = [];
      const read = readTabularSource({ fileName, contentBase64: Buffer.from(bytes).toString("base64") }, "institution", { flows: manifest.flows }, period, "IDR", "BOTH", manifest.cutOff, issues);
      expect(issues).toEqual([]);
      expect(read!.side.manifest.flows).toEqual(manifest.flows);
    }
    const csv = "identitas_entri,jenis_dana,posisi_neraca,nilai,arus\n1,ZAKAT,ON,100,BOGUS\n2,ZAKAT,ON,200,";
    const mapped = mapSourceTabular(decodeTabular(csv, "books.csv").table!, manifest);
    expect(mapped.invalidRowCount).toBe(2);
  });

  it("preserves legacy frozen figure names and totals while adding separate collection figures", () => {
    const { flows: _, ...legacyManifest } = manifest;
    const legacy = { manifest: legacyManifest, status: "READ" as const, rows: [
      { key: "1", bucket: "ZAKAT", balanceSheet: "ON" as const, amount: "200", unit: "IDR" as const, amilAmount: null, label: null, isDeclaredTotal: false },
    ] };
    const input = { preparationId: "prep", institutionId: "institution", label: "report", period, currencyUnit: "IDR" as const,
      balanceSheetScope: "ON" as const, allowedBuckets: manifest.fundTypes, tolerance: { amount: "0", unit: "IDR" as const },
      preparedBy: "officer", preparedAt: 1, files: [], coverageNotes: [] };
    const old = freezeSnapshot({ ...input, sides: [legacy] });
    const original = computeSnapshotFigures(old.snapshot, null);
    const mixed = freezeSnapshot({ ...input, sides: [{ ...legacy, manifest, rows: [...legacy.rows, { ...legacy.rows[0], amount: "100", flow: "COLLECTION" as const }] }] });
    const figures = computeSnapshotFigures(mixed.snapshot, null);
    expect(figures.find(f => f.name === "SOURCE.total")!.value.amount).toBe(200n);
    expect(figures.find(f => f.name === "SOURCE.COLLECTION.total")!.value.amount).toBe(100n);
    expect(figures.filter(f => !f.name.includes(".COLLECTION."))).toEqual(original);
  });
});

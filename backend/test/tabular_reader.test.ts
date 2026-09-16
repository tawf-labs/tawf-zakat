import { describe, expect, it } from "bun:test";
import * as XLSX from "xlsx";
import {
  decodeTabular,
  parseCsv,
  sanitizeForExport,
  MAX_TABULAR_FILE_BYTES,
} from "../src/tabular-reader";
import {
  mapSourceTabular,
  parseIntegerAmount,
} from "../src/source-tabular-schema";
import {
  generateSourceXlsxTemplate,
  generateSourceCsvTemplate,
} from "../src/source-template-generator";
import type { SourceManifest } from "../src/evidence-source";

const mockManifest: SourceManifest = {
  role: "CLAIM",
  label: "Uji Sisi Klaim",
  origin: "UPLOAD",
  institutionId: "inst-test",
  scopeUnit: "BAZNAS",
  scopeLevel: "KABUPATEN",
  fundTypes: ["ZAKAT", "INFAK_SEDEKAH"],
  balanceSheet: "BOTH",
  currencyUnit: "IDR",
  period: { kind: "AKHIR_TAHUN", year: 2024 },
  cutOff: "2025-02-11T00:00:00.000Z",
  format: "xlsx",
  mappingVersion: "1",
  transactionDetail: "PRESENT",
  note: null,
};

describe("Tabular Reader & Schema Mapper (Spec #86, Ticket #88)", () => {
  describe("Skenario 4: XLSX dan CSV berisi data yang setara", () => {
    it("menghasilkan baris normalisasi dan total yang identik tanpa kehilangan nol awal atau presisi", () => {
      // Create equivalent XLSX and CSV
      const rows = [
        ["identitas_entri", "jenis_dana", "posisi_neraca", "nilai", "satuan", "hak_amil", "uraian"],
        ["00123", "ZAKAT", "ON", "11622127523247", "IDR", "1452765940405", "Zakat Perorangan"],
        ["00456", "INFAK_SEDEKAH", "OFF", "500000000", "IDR", "", "Infaq Bangun Jembatan"],
      ];

      // Build XLSX
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, "Sumber_Laporan");
      const xlsxBytes = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

      // Build CSV
      const csvString = rows.map((r) => r.join(",")).join("\n");

      // Decode both
      const xlsxResult = decodeTabular(xlsxBytes, "test.xlsx");
      const csvResult = decodeTabular(csvString, "test.csv");

      expect(xlsxResult.success).toBe(true);
      expect(csvResult.success).toBe(true);

      const xlsxMapped = mapSourceTabular(xlsxResult.table!, mockManifest);
      const csvMapped = mapSourceTabular(csvResult.table!, mockManifest);

      expect(xlsxMapped.issues.length).toBe(0);
      expect(csvMapped.issues.length).toBe(0);

      // Verify row counts and values match exactly
      expect(xlsxMapped.validRows.length).toBe(2);
      expect(csvMapped.validRows.length).toBe(2);

      // Check leading zeros preserved as string
      expect(xlsxMapped.validRows[0].key).toBe("00123");
      expect(csvMapped.validRows[0].key).toBe("00123");

      // Check large rupiah precision (trillion scale)
      expect(xlsxMapped.validRows[0].amount).toBe("11622127523247");
      expect(csvMapped.validRows[0].amount).toBe("11622127523247");
      expect(xlsxMapped.validRows[0].amilAmount).toBe("1452765940405");
      expect(csvMapped.validRows[0].amilAmount).toBe("1452765940405");

      // Check total sum matches exactly
      expect(xlsxMapped.calculableTotal).toBe((11622127523247n + 500000000n).toString());
      expect(csvMapped.calculableTotal).toBe(xlsxMapped.calculableTotal);
      expect(xlsxMapped.isPartial).toBe(false);
      expect(csvMapped.isPartial).toBe(false);
    });
  });

  describe("Skenario 6: Penolakan formula, makro, enkripsi, dan batas ukuran", () => {
    it("menolak formula spreadsheet dan referensi eksternal tanpa mengeksekusinya", () => {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([
        ["key", "bucket", "amount"],
        ["001", "ZAKAT", 100],
        ["002", "ZAKAT", 200],
        ["003", "ZAKAT", null],
      ]);
      ws["C4"] = { t: "n", f: "SUM(C2:C3)", v: 300 };
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const xlsxBytes = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

      const result = decodeTabular(xlsxBytes, "formula.xlsx");
      expect(result.success).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0].code).toBe("FORMULA_FORBIDDEN");
      expect(result.issues[0].message).toContain("Formula atau referensi eksternal tidak dieksekusi");
    });

    it("menolak berkas makro .xlsm", () => {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([["key", "bucket", "amount"]]);
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const bytes = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

      const result = decodeTabular(bytes, "malicious.xlsm");
      expect(result.success).toBe(false);
      expect(result.issues.some((i) => i.code === "MACRO_DETECTED")).toBe(true);
    });

    it("menolak berkas melebihi batas 5 MiB", () => {
      const hugeBytes = new Uint8Array(MAX_TABULAR_FILE_BYTES + 10);
      const result = decodeTabular(hugeBytes, "huge.xlsx");
      expect(result.success).toBe(false);
      expect(result.issues[0].code).toBe("FILE_TOO_LARGE");
    });

    it("menolak kolom yang tidak didukung", () => {
      const csv = "key,bucket,amount,kolom_rahasia_ilegal\n001,ZAKAT,1000,rahasia";
      const decoded = decodeTabular(csv, "test.csv");
      expect(decoded.success).toBe(true);

      const mapped = mapSourceTabular(decoded.table!, mockManifest);
      expect(mapped.issues.some((i) => i.message.includes("kolom_rahasia_ilegal"))).toBe(true);
    });

    it("menolak bilangan desimal pecahan pada nominal rupiah", () => {
      const parsed = parseIntegerAmount("1500000.50");
      expect("error" in parsed).toBe(true);
    });
  });

  describe("Skenario 5: 100 baris dengan 7 baris salah", () => {
    it("mempertahankan seluruh baris, menandai kesalahan dan memberi label total parsial", () => {
      const rows: string[][] = [
        ["identitas_entri", "jenis_dana", "posisi_neraca", "nilai"],
      ];

      // 93 valid rows (each 100_000)
      for (let i = 1; i <= 93; i++) {
        rows.push([`PZ-${i.toString().padStart(4, "0")}`, "ZAKAT", "ON", "100000"]);
      }

      // 7 invalid rows with different errors
      rows.push(["", "ZAKAT", "ON", "100000"]); // 1. Missing key
      rows.push(["PZ-ERR2", "DANA_PALSU", "ON", "100000"]); // 2. Invalid bucket
      rows.push(["PZ-ERR3", "ZAKAT", "INVALID_POS", "100000"]); // 3. Invalid position
      rows.push(["PZ-ERR4", "ZAKAT", "ON", "bukan-angka"]); // 4. Invalid amount text
      rows.push(["PZ-ERR5", "ZAKAT", "ON", "150000.75"]); // 5. Decimal fraction
      rows.push(["PZ-ERR6", "ZAKAT", "ON", ""]); // 6. Empty amount
      rows.push(["PZ-ERR7", "ZAKAT", "ON", "-50000"]); // 7. Negative amount

      const csvString = rows.map((r) => r.join(",")).join("\n");
      const decoded = decodeTabular(csvString, "100_rows.csv");
      expect(decoded.success).toBe(true);

      const mapped = mapSourceTabular(decoded.table!, mockManifest);

      // Total rows must be 100
      expect(mapped.totalRows).toBe(100);
      expect(mapped.validRows.length).toBe(93);
      expect(mapped.invalidRows.length).toBe(7);

      // All 100 rows must be present in preview
      expect(mapped.allRowsPreview.length).toBe(100);

      // Total must be calculated only from the 93 valid rows
      expect(mapped.calculableTotal).toBe((93n * 100000n).toString());

      // Total MUST be flagged as partial
      expect(mapped.isPartial).toBe(true);
      expect(mapped.issues.length).toBeGreaterThanOrEqual(7);
    });
  });

  describe("Sanitasi ekspor teks mencegah formula injection", () => {
    it("menambahkan kutip depan bila sel diawali =, +, -, @, atau tab", () => {
      expect(sanitizeForExport("=SUM(A1:A5)")).toBe("'=SUM(A1:A5)");
      expect(sanitizeForExport("+12345")).toBe("'+12345");
      expect(sanitizeForExport("-12345")).toBe("'-12345");
      expect(sanitizeForExport("@command")).toBe("'@command");
      expect(sanitizeForExport("Normal text")).toBe("Normal text");
    });
  });

  describe("Generator Template XLSX dan CSV", () => {
    it("menghasilkan template XLSX dengan lembar Petunjuk dan Sumber_Laporan", () => {
      const xlsxBytes = generateSourceXlsxTemplate();
      expect(xlsxBytes.byteLength).toBeGreaterThan(0);

      const wb = XLSX.read(xlsxBytes, { type: "buffer" });
      expect(wb.SheetNames).toContain("Petunjuk");
      expect(wb.SheetNames).toContain("Sumber_Laporan");

      // Verify decoded template passes validation
      const decoded = decodeTabular(xlsxBytes, "template.xlsx");
      expect(decoded.success).toBe(true);

      const mapped = mapSourceTabular(decoded.table!, mockManifest);
      expect(mapped.validRows.length).toBeGreaterThan(0);
      expect(mapped.issues.length).toBe(0);
    });

    it("menghasilkan template CSV yang sah", () => {
      const csvString = generateSourceCsvTemplate();
      expect(csvString).toContain("identitas_entri");
      expect(csvString).toContain("ZAKAT");

      const decoded = decodeTabular(csvString, "template.csv");
      expect(decoded.success).toBe(true);

      const mapped = mapSourceTabular(decoded.table!, mockManifest);
      expect(mapped.validRows.length).toBeGreaterThan(0);
      expect(mapped.issues.length).toBe(0);
    });
  });

  describe("XLSX and CSV describe the same table", () => {
    const sheetOf = (rows: (string | number)[][]): Uint8Array => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sumber_Laporan");
      return new Uint8Array(XLSX.write(wb, { bookType: "xlsx", type: "buffer" }));
    };

    it("refuses a fractional amount in XLSX exactly as it refuses one in CSV", () => {
      // The workbook displays 1.500.000,5; reading the display and stripping its
      // separators would turn it into 15000005 - a tenfold claim nobody typed.
      const xlsx = decodeTabular(sheetOf([["key", "nilai"], ["TX01", 1500000.5]]), "angka.xlsx");
      expect(xlsx.success).toBe(true);
      expect(xlsx.table!.rows[0].cells.nilai).toBe("1500000.5");

      const csv = decodeTabular("key,nilai\nTX01,1500000.5", "angka.csv");
      expect(csv.table!.rows[0].cells.nilai).toBe("1500000.5");

      // Both sides then fail the same way at the schema layer.
      expect(parseIntegerAmount(xlsx.table!.rows[0].cells.nilai)).toHaveProperty("error");
      expect(parseIntegerAmount(csv.table!.rows[0].cells.nilai)).toHaveProperty("error");
    });

    it("refuses a numeric cell beyond exact integer precision, naming row and column", () => {
      const decoded = decodeTabular(
        sheetOf([["key", "nilai"], ["TX01", 12345678901234567]]),
        "besar.xlsx"
      );
      expect(decoded.success).toBe(false);
      expect(decoded.format).toBe("xlsx");
      const [found] = decoded.issues;
      expect(found.code).toBe("AMBIGUOUS_VALUE");
      expect(found.rowNumber).toBe(2);
      expect(found.column).toBe("nilai");
      expect(found.message).toContain("teks");
    });

    it("keeps a large rupiah figure exact when it is written as text", () => {
      const decoded = decodeTabular(
        sheetOf([["key", "nilai"], ["TX01", "12345678901234567"]]),
        "besar_teks.xlsx"
      );
      expect(decoded.table!.rows[0].cells.nilai).toBe("12345678901234567");
      expect(parseIntegerAmount("12345678901234567")).toEqual({ amount: "12345678901234567" });
    });

    it("refuses a date-typed cell rather than reading it one way and meaning another", () => {
      const wb = XLSX.utils.book_new();
      const ws: XLSX.WorkSheet = {
        "!ref": "A1:B2",
        A1: { t: "s", v: "key" },
        B1: { t: "s", v: "tanggal" },
        A2: { t: "s", v: "TX01" },
        B2: { t: "d", v: new Date("2024-03-04T00:00:00.000Z") },
      };
      XLSX.utils.book_append_sheet(wb, ws, "Sumber_Laporan");
      const decoded = decodeTabular(
        new Uint8Array(XLSX.write(wb, { bookType: "xlsx", type: "buffer" })),
        "tanggal.xlsx"
      );
      expect(decoded.success).toBe(false);
      expect(decoded.issues[0].code).toBe("AMBIGUOUS_VALUE");
      expect(decoded.issues[0].column).toBe("tanggal");
    });

    it("names the format it was reading even when it refuses the file", () => {
      const tooLarge = new Uint8Array(MAX_TABULAR_FILE_BYTES + 1);
      expect(decodeTabular(tooLarge, "besar.csv").format).toBe("csv");
    });
  });

  describe("Formula injection in CSV", () => {
    it("catches every active prefix, not only the equals sign", () => {
      for (const payload of ["=cmd()", "+cmd()", "-1+cmd()", "@SUM(A1)"]) {
        const decoded = decodeTabular(`key,uraian\nTX01,${payload}`, "injeksi.csv");
        expect(decoded.success).toBe(false);
        expect(decoded.issues[0].code).toBe("FORMULA_FORBIDDEN");
        expect(decoded.issues[0].column).toBe("uraian");
      }
    });

    it("leaves a plain negative number alone", () => {
      const decoded = decodeTabular("key,nilai\nTX01,-500", "negatif.csv");
      expect(decoded.success).toBe(true);
      expect(decoded.table!.rows[0].cells.nilai).toBe("-500");
    });

    it("sanitizes the CSV template it hands out", () => {
      // Rule 6 is enforced by the export path itself, not by remembering to call it.
      for (const cell of generateSourceCsvTemplate().split(/[\n,]/)) {
        expect(/^[=+\-@\t\r]/.test(cell)).toBe(false);
      }
    });
  });

});

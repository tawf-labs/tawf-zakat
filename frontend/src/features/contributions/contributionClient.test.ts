import { describe, expect, it } from "bun:test";
import {
  formatNominal,
  channelLabel,
  fundTypeLabel,
  type TabularRow,
  type TabularIssue,
  type TabularPreview,
} from "./contributionClient";

describe("Contribution Client & UI Formatting", () => {
  it("formats IDR accurately with Indonesian locale without losing precision", () => {
    expect(formatNominal("5000000", "IDR")).toBe("Rp 5.000.000");
    expect(formatNominal("1234567890123456", "IDR")).toBe("Rp 1.234.567.890.123.456");
  });

  it("formats USDC 6DP accurately with decimals without loss", () => {
    expect(formatNominal("1500000", "USDC_6DP")).toBe("1.500000 USDC");
    expect(formatNominal("1250000000", "USDC_6DP")).toBe("1,250.000000 USDC");
    expect(formatNominal("1", "USDC_6DP")).toBe("0.000001 USDC");
  });

  it("maps channel labels properly", () => {
    expect(channelLabel("BANK_TRANSFER")).toBe("Transfer Bank");
    expect(channelLabel("QRIS")).toBe("QRIS");
    expect(channelLabel("CASH")).toBe("Tunai");
  });

  it("maps fund type labels properly", () => {
    expect(fundTypeLabel("ZAKAT")).toBe("Zakat Maal");
    expect(fundTypeLabel("FITRAH")).toBe("Zakat Fitrah");
    expect(fundTypeLabel("INFAK_SEDEKAH")).toBe("Infak / Sedekah");
    expect(fundTypeLabel("DSKL")).toBe("Dana Sosial Keagamaan Lainnya (DSKL)");
  });

  it("preserves broken rows and partial totals in tabular preview structures", () => {
    const brokenIssue: TabularIssue = {
      rowNumber: 2,
      column: "nominal",
      code: "INVALID_AMOUNT",
      message: "Nominal tidak valid",
    };

    const row1: TabularRow = {
      rowNumber: 1,
      isValid: true,
      issues: [],
      raw: { nominal: "100000" },
      contribution: {
        sourceChannel: "BANK_TRANSFER",
        sourceReference: "REF-1",
        amountExact: "100000",
        currencyUnit: "IDR",
        fundType: "ZAKAT",
        purpose: "Zakat",
        receivedAt: 1700000000,
        donorName: null,
        donorContact: null,
      },
    };

    const row2: TabularRow = {
      rowNumber: 2,
      isValid: false,
      issues: [brokenIssue],
      raw: { nominal: "abc" },
    };

    const preview: TabularPreview = {
      fileName: "test.xlsx",
      sheetName: "Sheet1",
      currencyUnit: "IDR",
      totalRows: 2,
      validRowsCount: 1,
      invalidRowsCount: 1,
      totalValidAmount: "100000",
      rows: [row1, row2],
      issues: [brokenIssue],
    };

    expect(preview.totalRows).toBe(2);
    expect(preview.validRowsCount).toBe(1);
    expect(preview.invalidRowsCount).toBe(1);
    expect(preview.totalValidAmount).toBe("100000");
    expect(preview.rows[1].isValid).toBe(false);
    expect(preview.rows[1].issues[0].column).toBe("nominal");
  });
});

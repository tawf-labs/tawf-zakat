import { describe, expect, it } from "bun:test";
import {
  formatBps,
  formatQuantity,
  formatUsdc,
  groupDigits,
  periodLabel,
  periodShortLabel,
} from "./reporting";

describe("Penyajian angka - dari teks desimal, tidak pernah lewat bilangan pecahan", () => {
  it("mengelompokkan ribuan menurut kaidah Indonesia", () => {
    expect(groupDigits("0")).toBe("0");
    expect(groupDigits("1000")).toBe("1.000");
    expect(groupDigits("11622127523247")).toBe("11.622.127.523.247");
    expect(groupDigits("-668020210274")).toBe("-668.020.210.274");
  });

  it("mempertahankan presisi di atas Number.MAX_SAFE_INTEGER", () => {
    const beyondSafe = "9007199254740993"; // MAX_SAFE_INTEGER + 2
    expect(groupDigits(beyondSafe).replace(/\./g, "")).toBe(beyondSafe);
  });

  it("menyajikan USDC dari satuan minor enam desimal", () => {
    expect(formatUsdc("50000000")).toBe("50");
    expect(formatUsdc("1500000")).toBe("1,5");
    expect(formatUsdc("500000")).toBe("0,5");
    expect(formatUsdc("1")).toBe("0,000001");
  });

  it("menyajikan basis poin sebagai persentase", () => {
    expect(formatBps("1250")).toBe("12,5%");
    expect(formatBps("1300")).toBe("13%");
    expect(formatBps("0")).toBe("0%");
    expect(formatBps("5")).toBe("0,05%");
  });

  it("memakai kata satuan yang benar untuk tiap satuan", () => {
    expect(formatQuantity({ amount: "1500000", unit: "IDR" })).toBe("Rp1.500.000");
    expect(formatQuantity({ amount: "250000000", unit: "USDC_6DP" })).toBe("250 USDC");
    expect(formatQuantity({ amount: "1250", unit: "BPS" })).toBe("12,5%");
    expect(formatQuantity({ amount: "14", unit: "COUNT" })).toBe("14");
  });

  it("tidak pernah menjumlahkan rupiah dengan USDC, karena tiap nilai membawa satuannya", () => {
    const rupiah = formatQuantity({ amount: "1000000", unit: "IDR" });
    const usdc = formatQuantity({ amount: "1000000", unit: "USDC_6DP" });

    expect(rupiah).not.toBe(usdc);
    expect(rupiah).toBe("Rp1.000.000");
    expect(usdc).toBe("1 USDC");
  });

  it("menamai periode pelaporan dengan rentang tanggalnya", () => {
    expect(periodLabel({ kind: "SEMESTER", year: 2026 })).toContain("1 Januari-30 Juni");
    expect(periodLabel({ kind: "AKHIR_TAHUN", year: 2026 })).toContain("1 Januari-31 Desember");
    expect(periodShortLabel({ kind: "AKHIR_TAHUN", year: 2026 })).toBe("Akhir Tahun 2026");
  });
});

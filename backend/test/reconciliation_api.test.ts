import { describe, expect, it } from "bun:test";
import app from "../src/index";

const ENDPOINT = "http://localhost:3001/api/reconciliation/antar-lembaga";

const post = (body: unknown) =>
  app.fetch(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

const entry = (key: string, bucket: string, amount: string, extra: Record<string, unknown> = {}) => ({
  key,
  bucket,
  balanceSheet: "ON",
  value: { amount, unit: "IDR" },
  ...extra,
});

const validPayload = {
  claim: {
    label: "Rekap Laporan Zakat Wilayah Riau",
    entries: [
      entry("PZ-1401", "ZAKAT", "1500000000", { label: "BAZNAS Kab. Kampar" }),
      entry("PZ-1471", "ZAKAT", "750000000", { label: "BAZNAS Kota Pekanbaru" }),
    ],
  },
  source: {
    label: "12 Laporan Kinerja Kab/Kota",
    entries: [
      entry("PZ-1401", "ZAKAT", "1200000000", { label: "BAZNAS Kab. Kampar" }),
      entry("PZ-1471", "ZAKAT", "750000000", { label: "BAZNAS Kota Pekanbaru" }),
    ],
  },
  options: { period: { kind: "AKHIR_TAHUN", year: 2024 } },
};

describe("POST /api/reconciliation/antar-lembaga", () => {
  it("returns a reconciliation report for two ledger sides", async () => {
    const res = await post(validPayload);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.report.balanced).toBe(false);
    expect(body.report.claimLabel).toBe("Rekap Laporan Zakat Wilayah Riau");
    expect(body.report.sourceLabel).toBe("12 Laporan Kinerja Kab/Kota");
    expect(body.report.period).toEqual({ kind: "AKHIR_TAHUN", year: 2024 });
    expect(body.report.discrepancies).toHaveLength(1);
    expect(body.report.discrepancies[0]).toMatchObject({
      kind: "AMOUNT_MISMATCH",
      key: "PZ-1401",
      bucket: "ZAKAT",
      delta: { amount: "300000000", unit: "IDR" },
    });
    expect(body.report.netDelta).toEqual({ amount: "300000000", unit: "IDR" });
    expect(body.report.entryCounts).toEqual({ claim: 2, source: 2, matched: 2 });
  });

  it("serialises trillion-scale amounts as exact strings", async () => {
    const res = await post({
      claim: { label: "Tabel 2.2", entries: [entry("NASIONAL", "ZAKAT", "11622127523247")] },
      source: { label: "Tabel 2.3", entries: [entry("NASIONAL", "ZAKAT", "10954107312973")] },
      options: { period: { kind: "AKHIR_TAHUN", year: 2024 } },
    });

    const body = await res.json();
    expect(body.report.netDelta.amount).toBe("668020210274");
  });

  it("reports a balanced pair of sides as balanced", async () => {
    const res = await post({
      claim: { label: "Rekap", entries: [entry("PZ-1401", "ZAKAT", "1000")] },
      source: { label: "Laporan", entries: [entry("PZ-1401", "ZAKAT", "1000")] },
      options: { period: { kind: "SEMESTER", year: 2025 } },
    });

    const body = await res.json();
    expect(body.report.balanced).toBe(true);
    expect(body.report.discrepancies).toEqual([]);
    expect(body.report.netDelta).toEqual({ amount: "0", unit: "IDR" });
  });

  it("honours a tolerance passed by the caller", async () => {
    const res = await post({
      ...validPayload,
      options: { period: { kind: "AKHIR_TAHUN", year: 2024 }, tolerance: { amount: "500000000", unit: "IDR" } },
    });

    const body = await res.json();
    expect(body.report.balanced).toBe(true);
  });

  it("rejects reports drawn from different reporting periods", async () => {
    const res = await post({
      claim: { ...validPayload.claim, period: { kind: "AKHIR_TAHUN", year: 2024 } },
      source: { ...validPayload.source, period: { kind: "AKHIR_TAHUN", year: 2023 } },
      options: { period: { kind: "AKHIR_TAHUN", year: 2024 } },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/periode/i);
    expect(body.error).toContain("2023");
  });

  it("rejects a malformed row naming its index and key", async () => {
    const res = await post({
      claim: {
        label: "Rekap",
        entries: [entry("PZ-1401", "ZAKAT", "1000"), entry("PZ-1402", "SAHAM", "2000")],
      },
      source: { label: "Laporan", entries: [] },
      options: { period: { kind: "AKHIR_TAHUN", year: 2024 } },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("index 1");
    expect(body.error).toContain("PZ-1402");
  });

  it("rejects a non-integer amount naming the offending row", async () => {
    const res = await post({
      claim: { label: "Rekap", entries: [entry("PZ-1401", "ZAKAT", "1.5")] },
      source: { label: "Laporan", entries: [] },
      options: { period: { kind: "AKHIR_TAHUN", year: 2024 } },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("PZ-1401");
  });

  it("rejects a missing ledger side", async () => {
    const res = await post({ options: { period: { kind: "AKHIR_TAHUN", year: 2024 } } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/claim|klaim/i);
  });

  it("rejects an unknown reporting period kind", async () => {
    const res = await post({ ...validPayload, options: { period: { kind: "TRIWULAN", year: 2024 } } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/periode/i);
  });

  it("surfaces declared-total findings through the same response contract", async () => {
    const res = await post({
      claim: {
        label: "Rekap",
        entries: [entry("PZ-1401", "ZAKAT", "600000000")],
        declaredTotals: [
          { key: "TOTAL-ON", bucket: "GRAND_TOTAL", balanceSheet: "ON", value: { amount: "900000000", unit: "IDR" } },
        ],
      },
      source: { label: "Laporan", entries: [entry("PZ-1401", "ZAKAT", "600000000")] },
      options: { period: { kind: "AKHIR_TAHUN", year: 2024 } },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report.discrepancies).toHaveLength(1);
    expect(body.report.discrepancies[0]).toMatchObject({
      kind: "GRAND_TOTAL_MISMATCH",
      delta: { amount: "300000000", unit: "IDR" },
      claimValue: { amount: "900000000", unit: "IDR" },
      sourceValue: { amount: "600000000", unit: "IDR" },
    });
    // A total finding is not an entry-level gap, so it stays out of the headline number.
    expect(body.report.netDelta).toEqual({ amount: "0", unit: "IDR" });
  });

  it("reconciles a single balance sheet position when asked to", async () => {
    const payload = {
      claim: {
        label: "Rekap",
        entries: [
          entry("PZ-1401", "ZAKAT", "600000000"),
          entry("PZ-1401", "INFAK_SEDEKAH", "200000000", { balanceSheet: "OFF" }),
        ],
      },
      source: {
        label: "Laporan",
        entries: [
          entry("PZ-1401", "ZAKAT", "500000000"),
          entry("PZ-1401", "INFAK_SEDEKAH", "300000000", { balanceSheet: "OFF" }),
        ],
      },
      options: { period: { kind: "AKHIR_TAHUN", year: 2024 }, balanceSheet: "ON" },
    };

    const body = await (await post(payload)).json();
    expect(body.report.netDelta).toEqual({ amount: "100000000", unit: "IDR" });
    expect(body.report.entryCounts).toEqual({ claim: 1, source: 1, matched: 1 });
  });

  it("rejects an unknown balance sheet position", async () => {
    const res = await post({
      ...validPayload,
      options: { period: { kind: "AKHIR_TAHUN", year: 2024 }, balanceSheet: "NERACA" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/posisi neraca/i);
  });

  it("accepts a caller-declared bucket dimension", async () => {
    const res = await post({
      claim: { label: "Tabel 2.3", entries: [entry("NASIONAL", "BAZNAS_PROVINSI", "925076124372")] },
      source: { label: "Rekap", entries: [entry("NASIONAL", "BAZNAS_PROVINSI", "925076124372")] },
      options: {
        period: { kind: "AKHIR_TAHUN", year: 2024 },
        allowedBuckets: ["BAZNAS_PROVINSI"],
      },
    });

    const body = await res.json();
    expect(body.report.balanced).toBe(true);
  });

  it("rejects a body that is not valid JSON", async () => {
    const res = await post("{ not json");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});

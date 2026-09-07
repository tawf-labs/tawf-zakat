import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import app from "../src/index";
import { periodReportBody } from "../src/routes/period-report";
import { computePeriodFigures, type PeriodRows } from "../src/period-report";
import type { ReportDraft } from "../src/report-validator";
import type { ReportingPeriod } from "../src/reconciliation";

const ENDPOINT = "http://localhost:3001/api/period-report/draft";
const PERIOD = { kind: "AKHIR_TAHUN", year: 2026 };

const post = (body: unknown) =>
  app.fetch(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

/**
 * The whole suite runs with no network and no API key, so these take the
 * credentials away rather than pretending to hold them. That is also the path
 * that matters most: the endpoint has to stay useful when the model cannot be
 * reached at all.
 */
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("POST /api/period-report/draft", () => {
  it("still returns the period figures when the AI service cannot be reached", async () => {
    const res = await post({ period: PERIOD });

    // A drafting failure is not a request failure.
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.period).toEqual(PERIOD);
    expect(body.figures.figures.length).toBeGreaterThan(0);
  });

  it("states the absence of a narrative openly rather than returning an empty report", async () => {
    const body = await (await post({ period: PERIOD })).json();

    expect(body.draft).toBeNull();
    expect(body.verdict).toBeNull();
    expect(typeof body.draftUnavailable).toBe("string");
    expect(body.draftUnavailable.length).toBeGreaterThan(0);
  });

  it("never lets the API key reach the browser", async () => {
    // A credential is present and the service is a dead loopback address, so the
    // whole failure path runs without a packet leaving the machine.
    process.env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key-for-tests";
    process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:1";
    try {
      const res = await post({ period: PERIOD });
      const raw = await res.text();

      expect(res.status).toBe(200);
      expect(raw).not.toContain("sk-ant-not-a-real-key-for-tests");
      expect(raw).not.toContain("ANTHROPIC_AUTH_TOKEN");
      expect(JSON.parse(raw).draftUnavailable).toBeTruthy();
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_BASE_URL;
    }
  });

  it("carries every amount as a decimal string, as the verify route does", async () => {
    const body = await (await post({ period: PERIOD })).json();

    for (const figure of body.figures.figures) {
      expect(typeof figure.value.amount).toBe("string");
      expect(figure.value.amount).toMatch(/^-?\d+$/);
    }
  });

  it("refuses an unknown reporting period", async () => {
    const res = await post({ period: { kind: "TRIWULAN", year: 2026 } });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/periode/i);
  });

  it("refuses a body that is not JSON", async () => {
    const res = await post("{bukan json");

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/JSON/i);
  });
});

describe("POST /api/period-report/verify still judges a draft the caller wrote", () => {
  it("returns a verdict without ever consulting the model", async () => {
    const figuresRes = await app.fetch(
      new Request("http://localhost:3001/api/period-report/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: PERIOD }),
      })
    );
    const total = (await figuresRes.json()).figures.figures.find(
      (f: any) => f.name === "pengumpulan.total"
    );

    const res = await app.fetch(
      new Request("http://localhost:3001/api/period-report/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period: PERIOD,
          draft: {
            claims: [{ name: total.name, value: { amount: "999999999999", unit: "IDR" } }],
            narrative: "",
          },
        }),
      })
    );

    const body = await res.json();
    expect(body.verdict.outcome).toBe("DITOLAK");
    expect(body.verdict.findings[0].kind).toBe("KLAIM_TIDAK_COCOK");
  });
});


/**
 * The model is never reachable in this suite, so the branch where a draft comes
 * back is exercised here instead - on the same function both routes build their
 * response with, given a draft written by the test rather than by a model.
 */
describe("Bentuk respons ketika sebuah draf memang ada", () => {
  const REPORTING_PERIOD: ReportingPeriod = { kind: "AKHIR_TAHUN", year: 2026 };

  const LEDGER: PeriodRows = {
    donations: [
      { trxId: "TRX-1", amountIDR: 100_000_000, status: "PAID", paidAt: "2026-03-01T00:00:00.000Z" },
    ],
    proposals: [],
  };

  const figures = () => computePeriodFigures(LEDGER, REPORTING_PERIOD);

  const draftOf = (claims: ReportDraft["claims"], narrative = ""): ReportDraft => ({
    claims,
    narrative,
  });

  it("memuat angka periode, draf, dan vonisnya sekaligus", () => {
    const body = periodReportBody(
      figures(),
      draftOf([{ name: "pengumpulan.total", value: { amount: 100_000_000n, unit: "IDR" } }],
        "Pengumpulan Rp100.000.000."),
      null
    );

    expect(body.figures.figures.length).toBeGreaterThan(0);
    expect(body.draft!.claims[0]).toEqual({
      name: "pengumpulan.total",
      value: { amount: "100000000", unit: "IDR" },
    });
    expect(body.verdict!.outcome).toBe("LOLOS");
    expect(body).not.toHaveProperty("draftUnavailable");
  });

  it("tetap mengembalikan draf yang ditolak beserta alasan penolakannya", () => {
    const body = periodReportBody(
      figures(),
      draftOf([{ name: "pengumpulan.total", value: { amount: 120_000_000n, unit: "IDR" } }],
        "Pengumpulan Rp120.000.000."),
      null
    );

    // Returned, not hidden - with the reasons attached.
    expect(body.draft!.narrative).toBe("Pengumpulan Rp120.000.000.");
    expect(body.verdict!.outcome).toBe("DITOLAK");
    expect(body.verdict!.findings.map((f) => f.kind)).toContain("KLAIM_TIDAK_COCOK");
    expect(body.verdict!.findings[0]!.message).toContain("100.000.000");
  });

  it("menolak, bukan membuang, draf yang jumlah klaimnya tidak terbaca", () => {
    const body = periodReportBody(
      figures(),
      draftOf([{ name: "pengumpulan.total", value: null, statedAmount: "100.000.000" }], "Narasi."),
      null
    );

    expect(body.draft!.claims[0]).toEqual({
      name: "pengumpulan.total",
      value: null,
      statedAmount: "100.000.000",
    });
    expect(body.verdict!.outcome).toBe("DITOLAK");
    expect(body.verdict!.findings[0]!.kind).toBe("KLAIM_TIDAK_TERBACA");
  });
});

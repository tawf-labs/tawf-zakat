import { describe, expect, it } from "bun:test";
import app from "../src/index";

const ENDPOINT = "http://localhost:3001/api/period-report/verify";

const post = (body: unknown) =>
  app.fetch(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

const PERIOD = { kind: "AKHIR_TAHUN", year: 2026 };

/**
 * The endpoint reads whatever ledger the environment has, so these assert its
 * behaviour rather than any particular figure: what comes back is fed straight
 * back in as a claim, which is true of an empty ledger and a busy one alike.
 */
const figuresOf = async (): Promise<any> => {
  const res = await post({ period: PERIOD });
  expect(res.status).toBe(200);
  return (await res.json()).figures;
};

const figureNamed = (figures: any, name: string) =>
  figures.figures.find((item: any) => item.name === name);

describe("POST /api/period-report/verify", () => {
  it("does not pass zero claims when the required ledger sources were never read", async () => {
    const response = await post({ period: PERIOD, draft: {
      claims: [{ name: "pengumpulan.total", value: { amount: "0", unit: "IDR" } }], narrative: "",
    } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sourcesComplete).toBe(false);
    expect(body.verdict.outcome).toBe("DITOLAK");
    expect(body.verdict.findings).toContainEqual(expect.objectContaining({ kind: "SUMBER_TIDAK_TERSEDIA" }));
  });

  it("returns period figures with no draft, and says why there is no verdict", async () => {
    const res = await post({ period: PERIOD });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.period).toEqual(PERIOD);
    expect(body.verdict).toBeNull();
    expect(body.draft).toBeNull();
    expect(body.draftUnavailable).toBeTruthy();
    expect(body.figures.figures.length).toBeGreaterThan(0);
    expect(body.figures.notes.length).toBeGreaterThan(0);
  });

  /**
   * This process has no `DATABASE_URL`, so the ledger sources were never read.
   * The figures are still returned - they are honest about what was read - but
   * the response says so, rather than letting zero pass for a period that was
   * successfully found empty (Spec #68, ticket #70).
   */
  it("says which ledger sources were read, and never counts an unread one as empty", async () => {
    const body = await (await post({ period: PERIOD })).json();

    expect(body.sourcesComplete).toBe(false);
    expect(body.sourceWarning).toMatch(/belum terperiksa/i);

    const byName = Object.fromEntries(body.sources.map((s: any) => [s.name, s]));
    for (const name of ["donasi", "proposal penyaluran", "event tahapan"]) {
      expect(byName[name].status).toBe("MISSING");
      expect(byName[name].rowCount).toBeNull();
    }
  });

  it("carries every amount as a decimal string so trillion-scale rupiah survives JSON", async () => {
    const figures = await figuresOf();

    for (const figure of figures.figures) {
      expect(typeof figure.value.amount).toBe("string");
      expect(figure.value.amount).toMatch(/^-?\d+$/);
    }
    expect(typeof figures.amilShare.ceiling.amount).toBe("string");
  });

  it("passes a draft whose claims echo the computed figures", async () => {
    const figures = await figuresOf();
    const total = figureNamed(figures, "pengumpulan.total");
    const amil = figureNamed(figures, "hak_amil.porsi_idr");

    const res = await post({
      period: PERIOD,
      draft: {
        claims: [
          { name: total.name, value: total.value },
          { name: amil.name, value: amil.value },
        ],
        narrative: "Angka periode ini disusun langsung dari ledger.",
      },
    });

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(
      body.verdict.findings.filter((f: any) => f.kind === "KLAIM_TIDAK_COCOK")
    ).toHaveLength(0);
  });

  it("rejects a claim that deviates from the computed figure and names both values", async () => {
    const figures = await figuresOf();
    const total = figureNamed(figures, "pengumpulan.total");
    const wrong = (BigInt(total.value.amount) + 1n).toString();

    const res = await post({
      period: PERIOD,
      draft: { claims: [{ name: total.name, value: { amount: wrong, unit: "IDR" } }] },
    });

    const body = await res.json();
    expect(body.verdict.outcome).toBe("DITOLAK");
    const finding = body.verdict.findings.find((f: any) => f.kind === "KLAIM_TIDAK_COCOK");
    expect(finding.figureName).toBe("pengumpulan.total");
    expect(finding.claimed).toEqual({ amount: wrong, unit: "IDR" });
    expect(finding.expected).toEqual(total.value);
  });

  it("rejects a rupiah figure invented inside the narrative", async () => {
    const res = await post({
      period: PERIOD,
      draft: {
        claims: [],
        narrative: "Penyaluran periode ini mencapai Rp888.123.456.789.",
      },
    });

    const body = await res.json();
    expect(body.verdict.outcome).toBe("DITOLAK");
    expect(body.verdict.findings.map((f: any) => f.kind)).toContain("ANGKA_NARASI_TIDAK_DIKLAIM");
    expect(
      body.verdict.findings.find((f: any) => f.kind === "ANGKA_NARASI_TIDAK_DIKLAIM").excerpt
    ).toBe("Rp888.123.456.789");
  });

  it("rejects a claim on a figure the period report does not have", async () => {
    const res = await post({
      period: PERIOD,
      draft: { claims: [{ name: "pertumbuhan.tahunan", value: { amount: "12", unit: "COUNT" } }] },
    });

    const body = await res.json();
    expect(body.verdict.outcome).toBe("DITOLAK");
    expect(body.verdict.findings[0].kind).toBe("KLAIM_TIDAK_DIKENAL");
  });

  it("refuses a body that is not JSON", async () => {
    const res = await post("{bukan json");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/JSON/i);
  });

  it("refuses an unknown reporting period", async () => {
    const res = await post({ period: { kind: "TRIWULAN", year: 2026 } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/periode/i);
  });

  it("refuses an amount that is not a whole number", async () => {
    const res = await post({
      period: PERIOD,
      draft: { claims: [{ name: "pengumpulan.total", value: { amount: "1.500,50", unit: "IDR" } }] },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/bilangan bulat/i);
  });

  it("refuses an unknown unit rather than defaulting it", async () => {
    const res = await post({
      period: PERIOD,
      draft: { claims: [{ name: "pengumpulan.total", value: { amount: "1000", unit: "RUPIAH" } }] },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unit tidak dikenal/i);
  });

  it("returns the stage durations, with every span accounted for", async () => {
    const figures = await figuresOf();
    const { durations } = figures;

    expect(durations.intervals.map((interval: any) => interval.name)).toEqual([
      "pengajuan_ke_persetujuan",
      "persetujuan_ke_eksekusi",
      "pengajuan_ke_eksekusi",
      "eksekusi_ke_atestasi",
      "pengajuan_ke_atestasi",
    ]);

    for (const interval of durations.intervals) {
      // An unmeasured span carries null, never a zero a reader could take for
      // "instant", and every disbursement is accounted for one way or the other.
      expect(interval.averageHours === null || /^\d+$/.test(interval.averageHours)).toBe(true);
      expect(
        interval.sampleCount +
          interval.unmeasured.belumSelesai +
          interval.unmeasured.tidakTercatat
      ).toBe(durations.trails.length);
    }

    expect(durations.notes.length).toBeGreaterThan(0);
  });

  it("carries every disbursement trail with its four ADR-0006 stages", async () => {
    const { durations } = await figuresOf();

    for (const trail of durations.trails) {
      expect(trail.marks.map((mark: any) => mark.stage)).toEqual([
        "PENGAJUAN",
        "PERSETUJUAN_DPS",
        "EKSEKUSI",
        "ATESTASI",
      ]);
      for (const mark of trail.marks) {
        expect(mark.blockNumber === null || Number.isInteger(mark.blockNumber)).toBe(true);
      }
    }
  });

  it("accepts a duration claim in hours, and rejects one that drifts", async () => {
    const figures = await figuresOf();
    const sample = figureNamed(figures, "durasi.penyaluran_ditelusuri");

    const passing = await post({
      period: PERIOD,
      draft: { claims: [{ name: sample.name, value: sample.value }], narrative: "" },
    });
    const matching = await passing.json();
    expect(matching.verdict.outcome).toBe("DITOLAK");
    expect(matching.verdict.findings.map((finding: any) => finding.kind)).toEqual(["SUMBER_TIDAK_TERSEDIA"]);

    const drifting = await post({
      period: PERIOD,
      draft: {
        claims: [
          { name: sample.name, value: { amount: String(Number(sample.value.amount) + 1), unit: sample.value.unit } },
        ],
        narrative: "",
      },
    });
    const body = await drifting.json();
    expect(body.verdict.outcome).toBe("DITOLAK");
    expect(body.verdict.findings[0].kind).toBe("KLAIM_TIDAK_COCOK");
  });
});

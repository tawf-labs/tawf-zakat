import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { computePeriodFigures, type PeriodRows } from "../src/period-report";
import { validateDraft } from "../src/report-validator";
import {
  describeFailure,
  draftReport,
  figuresForPrompt,
  toReportDraft,
  type RawDraft,
} from "../src/report-drafter";
import type { ReportingPeriod } from "../src/reconciliation";

const PERIOD: ReportingPeriod = { kind: "AKHIR_TAHUN", year: 2026 };

const LEDGER: PeriodRows = {
  donations: [
    { trxId: "TRX-1", amountIDR: 100_000_000, status: "PAID", paidAt: "2026-03-01T00:00:00.000Z" },
  ],
  proposals: [
    {
      proposalIdOnChain: 1,
      currencyType: 0,
      amount: 40_000_000,
      asnafCategory: "Fakir",
      status: "Executed",
      executedAt: "2026-03-02T00:00:00.000Z",
    },
  ],
};

const figures = () => computePeriodFigures(LEDGER, PERIOD);

/**
 * The drafting step reads credentials from the environment and nothing else -
 * there is no provider abstraction and nothing is injected. These tests take the
 * credentials away instead, which is also what keeps them from ever spending
 * money or reaching the network.
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

describe("Perintah penyusunan draf - angka diserahkan, bukan diminta dihitung", () => {
  it("menyerahkan setiap angka periode beserta nama dan satuannya", () => {
    const prompt = figuresForPrompt(figures());

    expect(prompt).toContain("pengumpulan.total");
    expect(prompt).toContain("100000000");
    expect(prompt).toContain("penyaluran.fakir.idr");
    expect(prompt).toContain("40000000");
    expect(prompt).toContain("IDR");
  });

  it("menyerahkan angka orde triliunan sebagai digit penuh, tanpa pembulatan", () => {
    const national = computePeriodFigures(
      {
        donations: [
          {
            trxId: "TRX-1",
            amountIDR: "11622127523247",
            status: "PAID",
            paidAt: "2026-03-01T00:00:00.000Z",
          },
        ],
        proposals: [],
      },
      PERIOD
    );

    expect(figuresForPrompt(national)).toContain("11622127523247");
  });

});

describe("Pembacaan draf yang dikembalikan model", () => {
  it("mengubah klaim berupa teks desimal menjadi bilangan bulat", () => {
    const raw: RawDraft = {
      claims: [
        { name: "pengumpulan.total", amount: "100000000", unit: "IDR" },
        { name: "atestasi.jumlah", amount: "0", unit: "COUNT" },
      ],
      narrative: "Narasi.",
    };

    expect(toReportDraft(raw)).toEqual({
      claims: [
        { name: "pengumpulan.total", value: { amount: 100_000_000n, unit: "IDR" } },
        { name: "atestasi.jumlah", value: { amount: 0n, unit: "COUNT" } },
      ],
      narrative: "Narasi.",
    });
  });

  it("mempertahankan presisi triliunan melewati JSON", () => {
    const draft = toReportDraft({
      claims: [{ name: "pengumpulan.total", amount: "11622127523247", unit: "IDR" }],
      narrative: "",
    });

    expect(draft.claims[0]!.value).toEqual({ amount: 11_622_127_523_247n, unit: "IDR" });
  });

  it("meneruskan jumlah yang bukan bilangan bulat untuk divonis, bukan membuang drafnya", () => {
    // The model is told to write rupiah as Rp1.500.000, so a claim amount arriving
    // with separators is its likeliest slip. The narrative survives; the validator
    // rejects it.
    const draft = toReportDraft({
      claims: [{ name: "pengumpulan.total", amount: "100.000.000", unit: "IDR" }],
      narrative: "Pengumpulan Rp100.000.000.",
    });

    expect(draft.claims[0]).toEqual({
      name: "pengumpulan.total",
      value: null,
      statedAmount: "100.000.000",
    });
    expect(draft.narrative).toBe("Pengumpulan Rp100.000.000.");
    expect(validateDraft(figures(), draft).outcome).toBe("DITOLAK");
  });
});

describe("Draf yang benar-benar memakai angka yang diserahkan", () => {
  it("lolos validator, sehingga perintah dan pemeriksa sepakat soal kontraknya", () => {
    const computed = figures();

    // The draft a perfectly obedient model would return: it claims the figures it
    // was handed, unchanged, and writes only those numbers into the narrative.
    const obedient = toReportDraft({
      claims: [
        { name: "pengumpulan.total", amount: "100000000", unit: "IDR" },
        { name: "penyaluran.fakir.idr", amount: "40000000", unit: "IDR" },
      ],
      narrative: "Pengumpulan Rp100.000.000 dan penyaluran kepada fakir Rp40.000.000.",
    });

    expect(validateDraft(computed, obedient).outcome).toBe("LOLOS");
  });
});

describe("Ketiadaan layanan AI", () => {
  it("mengembalikan ketiadaan narasi secara terbuka ketika kredensial tidak ada", async () => {
    const attempt = await draftReport(figures());

    expect(attempt.draft).toBeNull();
    expect(attempt.unavailable).toMatch(/kredensial|ANTHROPIC_API_KEY/i);
  });

  it("menyerap kegagalan layanan dan tetap menunjuk ke angka periode", async () => {
    // Credentials present, but the service is a dead address on loopback - the
    // failure path without leaving the machine.
    process.env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key-for-tests";
    process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:1";
    try {
      const attempt = await draftReport(figures());

      expect(attempt.draft).toBeNull();
      expect(attempt.unavailable).toMatch(/Angka periode tetap dihitung dari ledger/);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_BASE_URL;
    }
  });

  it("menyebut batas waktu sebagai batas waktu, bukan sebagai galat umum", () => {
    const message = describeFailure(
      new Anthropic.APIConnectionTimeoutError({ message: "Request timed out." })
    );

    expect(message).toMatch(/batas waktu/i);
    expect(message).toMatch(/Angka periode tetap dihitung dari ledger/);
  });

  it("menjelaskan setiap kegagalan dengan kalimat yang menunjuk ke angka periode", () => {
    const failures: unknown[] = [
      new Anthropic.AuthenticationError(401, undefined, "unauthorized", new Headers()),
      new Anthropic.APIConnectionError({ message: "connection refused" }),
      new Error("koneksi putus"),
      "bukan sebuah Error",
      null,
    ];

    for (const error of failures) {
      const message = describeFailure(error);
      expect(message).toMatch(/Angka periode tetap dihitung dari ledger/);
      expect(message).not.toMatch(/sk-ant/);
    }
  });
});

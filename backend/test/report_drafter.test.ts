import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { computePeriodFigures, type PeriodRows } from "../src/period-report";
import { validateDraft } from "../src/report-validator";
import {
  describeFailure,
  draftReport,
  DRAFTING_SYSTEM,
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
 * Fake credentials and a stubbed HTTP boundary keep these tests off the network.
 * The real prompt, response parsing and deterministic validator still run.
 */
const savedEnv: Record<string, string | undefined> = {};
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

beforeEach(() => {
  for (const key of [
    "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL",
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
  ]) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Network disabled in tests"));
});

afterEach(() => {
  fetchSpy.mockRestore();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("DeepSeek report drafting", () => {
  it("uses Flash JSON output without thinking and returns a verifiable draft", async () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
    fetchSpy.mockResolvedValue(Response.json({
      choices: [{
        finish_reason: "stop",
        message: { content: JSON.stringify({
          claims: [{ name: "pengumpulan.total", amount: "100000000", unit: "IDR" }],
          narrative: "Pengumpulan Rp100.000.000.",
        }) },
      }],
    }));

    const computed = figures();
    const attempt = await draftReport(computed);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer deepseek-test-key");
    const request = JSON.parse(init?.body as string);
    expect(request.model).toBe("deepseek-v4-flash");
    expect(request.thinking).toEqual({ type: "disabled" });
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(request.max_tokens).toBe(4096);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(request.messages).toEqual([
      { role: "system", content: DRAFTING_SYSTEM },
      { role: "user", content: figuresForPrompt(computed) },
    ]);
    expect(DRAFTING_SYSTEM).toContain("JSON");
    expect(attempt.unavailable).toBeNull();
    expect(attempt.draft?.narrative).toBe("Pengumpulan Rp100.000.000.");
    expect(validateDraft(computed, attempt.draft!).outcome).toBe("LOLOS");
  });

  it("uses only DeepSeek configuration even when legacy credentials are present", async () => {
    process.env.ANTHROPIC_API_KEY = "legacy-key";
    process.env.ANTHROPIC_AUTH_TOKEN = "legacy-token";
    process.env.ANTHROPIC_BASE_URL = "https://legacy.invalid";
    process.env.DEEPSEEK_API_KEY = "   ";

    expect((await draftReport(figures())).unavailable).toContain("DEEPSEEK_API_KEY");
    expect(fetchSpy).not.toHaveBeenCalled();

    process.env.DEEPSEEK_API_KEY = " deepseek-test-key ";
    process.env.DEEPSEEK_BASE_URL = " http://127.0.0.1:9999/v1/ ";
    process.env.DEEPSEEK_MODEL = "deepseek-v4-pro";
    await draftReport(figures());

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:9999/v1/chat/completions");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer deepseek-test-key");
    expect(JSON.parse(init?.body as string).model).toBe("deepseek-v4-pro");
  });

  it.each([
    [401, /kredensial/i],
    [403, /kredensial/i],
    [402, /saldo/i],
    [429, /membatasi permintaan/i],
    [500, /500/],
    [503, /503/],
  ] as const)("handles HTTP %s without exposing upstream errors or retrying", async (status, reason) => {
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
    fetchSpy.mockResolvedValue(new Response("upstream echoed deepseek-test-key", { status }));

    const attempt = await draftReport(figures());

    expect(attempt.draft).toBeNull();
    expect(attempt.unavailable).toMatch(reason);
    expect(attempt.unavailable).toContain("Angka periode tetap dihitung dari ledger");
    expect(attempt.unavailable).not.toContain("deepseek-test-key");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["invalid JSON", "{not JSON"],
    ["empty content", ""],
    ["null content", null],
    ["missing claims", JSON.stringify({ narrative: "Narasi." })],
    ["numeric amount", JSON.stringify({ claims: [{ name: "pengumpulan.total", amount: 100000000, unit: "IDR" }], narrative: "Narasi." })],
    ["unknown unit", JSON.stringify({ claims: [{ name: "pengumpulan.total", amount: "100000000", unit: "USD" }], narrative: "Narasi." })],
    ["blank narrative", JSON.stringify({ claims: [], narrative: "  " })],
  ])("discards %s without losing period figures", async (_name, content) => {
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
    fetchSpy.mockResolvedValue(Response.json({
      choices: [{ finish_reason: "stop", message: { content } }],
    }));

    const attempt = await draftReport(figures());

    expect(attempt.draft).toBeNull();
    expect(attempt.unavailable).toContain("tidak sesuai bentuk");
    expect(attempt.unavailable).toContain("Angka periode tetap dihitung dari ledger");
  });

  it.each(["length", "content_filter", "insufficient_system_resource", "tool_calls"])(
    "never accepts a partial or refused completion (%s), even with valid JSON",
    async (finish_reason) => {
      process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
      fetchSpy.mockResolvedValue(Response.json({ choices: [{
        finish_reason,
        message: { content: JSON.stringify({ claims: [], narrative: "Narasi." }) },
      }] }));

      const attempt = await draftReport(figures());

      expect(attempt.draft).toBeNull();
      expect(attempt.unavailable).toContain(finish_reason === "content_filter" ? "menolak" : "berhenti sebelum draf selesai");
    }
  );

  it.each([{}, { choices: [] }, { choices: [{ message: { content: "{}" } }] }])(
    "handles a malformed completion envelope: %j",
    async (envelope) => {
      process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
      fetchSpy.mockResolvedValue(Response.json(envelope));

      const attempt = await draftReport(figures());

      expect(attempt.draft).toBeNull();
      expect(attempt.unavailable).toContain("tidak sesuai bentuk");
    }
  );

  it("rejects a non-JSON HTTP body without reflecting it to the browser", async () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
    fetchSpy.mockResolvedValue(new Response("<html>deepseek-test-key</html>"));

    const attempt = await draftReport(figures());

    expect(attempt.draft).toBeNull();
    expect(attempt.unavailable).toContain("tidak sesuai bentuk");
    expect(attempt.unavailable).not.toContain("deepseek-test-key");
  });

  it("bounds the request at 30 seconds and reports cancellation as timeout", async () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
    const timeoutSpy = spyOn(AbortSignal, "timeout").mockReturnValue(
      AbortSignal.abort(new DOMException("deepseek-test-key", "TimeoutError"))
    );
    fetchSpy.mockImplementation(Object.assign(async (_url: URL | RequestInfo, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      throw new Error("Expected an aborted signal");
    }, { preconnect: fetch.preconnect }));
    try {
      const attempt = await draftReport(figures());

      expect(timeoutSpy).toHaveBeenCalledWith(30_000);
      expect(attempt.draft).toBeNull();
      expect(attempt.unavailable).toMatch(/batas waktu/);
      expect(attempt.unavailable).not.toContain("deepseek-test-key");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("preserves unreadable model amounts for the validator to reject", async () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
    fetchSpy.mockResolvedValue(Response.json({ choices: [{
      finish_reason: "stop",
      message: { content: JSON.stringify({
        claims: [{ name: "pengumpulan.total", amount: "100.000.000", unit: "IDR" }],
        narrative: "Pengumpulan Rp100.000.000.",
      }) },
    }] }));

    const attempt = await draftReport(figures());

    expect(attempt.unavailable).toBeNull();
    expect(attempt.draft?.claims[0]?.value).toBeNull();
    expect(validateDraft(figures(), attempt.draft!).findings[0]?.kind).toBe("KLAIM_TIDAK_TERBACA");
  });
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

  it("menamai sendiri tahap paling lambat, alih-alih menyuruh model membandingkannya", () => {
    const withDuration = computePeriodFigures(
      {
        donations: LEDGER.donations,
        proposals: [
          {
            ...LEDGER.proposals[0]!,
            createdAt: "2026-03-01T00:00:00.000Z",
            executedAt: "2026-03-02T00:00:00.000Z",
            auditStatus: "AUDITED_WTP",
            auditedAt: "2026-03-04T00:00:00.000Z",
          },
        ],
      },
      PERIOD
    );

    const prompt = figuresForPrompt(withDuration);

    expect(prompt).toContain("durasi.eksekusi_ke_atestasi.rata_rata_jam");
    expect(prompt).toContain("JAM");
    expect(prompt).toContain("Tahap yang paling banyak memakan waktu");
  });

  it("menyatakan tidak ada tahap terukur ketika periode belum punya durasi", () => {
    expect(figuresForPrompt(figures())).toContain("belum ada perbandingan tahap");
  });

  it("melarang model mengubah satuan jam menjadi hari", () => {
    expect(DRAFTING_SYSTEM).toContain("jangan mengubahnya menjadi hari");
    expect(DRAFTING_SYSTEM).toContain("bukan jam kerja penyusunan laporan");
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
    expect(attempt.unavailable).toContain("DEEPSEEK_API_KEY");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("menyerap kegagalan layanan dan tetap menunjuk ke angka periode", async () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
    fetchSpy.mockRejectedValue(new Error("connection failed for deepseek-test-key"));
    const attempt = await draftReport(figures());

    expect(attempt.draft).toBeNull();
    expect(attempt.unavailable).toMatch(/Angka periode tetap dihitung dari ledger/);
    expect(attempt.unavailable).not.toContain("deepseek-test-key");
  });

  it("menyebut batas waktu sebagai batas waktu, bukan sebagai galat umum", () => {
    const message = describeFailure(
      new DOMException("Request timed out.", "TimeoutError")
    );

    expect(message).toMatch(/batas waktu/i);
    expect(message).toMatch(/Angka periode tetap dihitung dari ledger/);
  });

  it("menjelaskan setiap kegagalan dengan kalimat yang menunjuk ke angka periode", () => {
    const failures: unknown[] = [
      new TypeError("connection refused"),
      new Error("deepseek-test-key"),
      new Error("koneksi putus"),
      "bukan sebuah Error",
      null,
    ];

    for (const error of failures) {
      const message = describeFailure(error);
      expect(message).toMatch(/Angka periode tetap dihitung dari ledger/);
      expect(message).not.toContain("deepseek-test-key");
    }
  });
});

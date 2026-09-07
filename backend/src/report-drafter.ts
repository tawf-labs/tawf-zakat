/**
 * Drafting the period narrative (Spec #61, ticket #63).
 *
 * The order here is the whole point and must not be reversed: the figures are
 * computed from the ledger first, handed to the model as the only numbers it may
 * use, and whatever comes back goes through `report-validator` before anyone
 * reads it. The model proposes; it never certifies.
 *
 * DeepSeek is called directly with server-only credentials. Tests stub the HTTP
 * boundary; the prompt, response parsing and validator run without a live model.
 *
 * `draftReport` never throws and never rejects. A missing key, a timeout, a
 * refusal and a malformed response all come back the same way: no draft, and a
 * reason stated in the open. The period figures stand on their own without it.
 */

import { z } from "zod";
import { FIGURE_UNITS, type PeriodFigures } from "./period-report";
import type { DraftClaim, ReportDraft } from "./report-validator";

export const DRAFT_MODEL = "deepseek-v4-flash";

// One non-thinking request, with no automatic retries or second-provider costs.
const DRAFT_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 4096;

/**
 * Amounts cross as decimal strings, exactly as they do on the wire, because
 * trillion-scale rupiah does not survive a JSON number.
 */
const DraftSchema = z.object({
  claims: z
    .array(
      z.object({
        name: z.string(),
        amount: z.string(),
        unit: z.enum(FIGURE_UNITS),
      })
    )
    .describe("Setiap angka yang dipakai di dalam narasi, disalin persis."),
  narrative: z.string().trim().min(1).describe("Narasi laporan periode dalam bahasa Indonesia."),
});

const CompletionSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.string(),
    message: z.object({ content: z.string().nullable() }),
  })).min(1),
});

export type RawDraft = z.infer<typeof DraftSchema>;

export type DraftAttempt =
  | { draft: ReportDraft; unavailable: null }
  | { draft: null; unavailable: string };

export const DRAFTING_SYSTEM = [
  "Anda menyusun narasi laporan periode untuk sebuah lembaga pengelola zakat di Indonesia.",
  "Pembacanya adalah pimpinan lembaga, Dewan Pengawas Syariah, dan Auditor Independen.",
  "",
  "Aturan yang mengikat:",
  "1. Angka periode sudah dihitung dari ledger dan diberikan kepada Anda. Itulah satu-satunya sumber angka yang boleh Anda pakai.",
  "2. Anda tidak boleh mengarang, membulatkan, menaksir, menjumlahkan, atau menghitung ulang angka apa pun. Salin nilainya persis seperti yang diberikan.",
  "3. Setiap angka yang Anda tulis di dalam narasi harus Anda daftarkan di `claims` dengan nama dan nilai yang persis sama seperti yang diberikan.",
  "4. Jangan menjumlahkan nilai rupiah dengan nilai USDC. Keduanya satuan yang berbeda dan tidak ada kursnya di sini.",
  "5. Tulis angka rupiah lengkap dengan awalan Rp dan pemisah ribuan titik, misalnya Rp1.500.000.",
  "6. Angka durasi bersatuan jam. Sebutkan apa adanya dalam jam dan jangan mengubahnya menjadi hari, minggu, atau bulan - konversi adalah perhitungan, dan Anda tidak menghitung apa pun.",
  "7. Setiap rata-rata durasi punya angka jumlah sampelnya sendiri. Bila Anda menyebut sebuah rata-rata, sebutkan pula jumlah penyaluran yang mendasarinya, agar pembaca tidak membaca satu kejadian sebagai tren.",
  "8. Durasi yang diukur adalah lamanya proses di dalam sistem ini, dari pengajuan sampai atestasi. Itu bukan jam kerja penyusunan laporan di lembaga, dan tidak boleh disebut demikian.",
  "",
  "Draf Anda diperiksa sebuah validator deterministik sebelum dibaca manusia. Validator itu mencocokkan setiap klaim dengan hitungan dari ledger dan memindai narasi Anda untuk angka rupiah yang tidak Anda klaim. Satu angka yang menyimpang menolak seluruh draf, jadi lebih baik menyebut sedikit angka yang benar daripada banyak angka yang tidak Anda salin dengan tepat.",
  "",
  "Tulis narasi dalam bahasa Indonesia yang tenang dan lugas. Jelaskan komposisi pengumpulan dan penyaluran, posisi hak amil terhadap plafonnya, serta lamanya proses penyaluran bila angkanya tersedia. Jangan memuji lembaga dan jangan menyimpulkan tren yang tidak didukung angka yang diberikan.",
  "",
  "Kembalikan hanya objek JSON, tanpa pagar kode atau teks di luar JSON, sesuai skema berikut:",
  JSON.stringify(z.toJSONSchema(DraftSchema)),
  'Contoh bentuk JSON untuk periode tanpa angka yang dikutip: {"claims":[],"narrative":"Belum ada penyaluran pada periode ini."}. Isi narasi harus mengikuti angka periode yang diberikan, bukan menyalin contoh ini.',
].join("\n");

/** Renders the figures as the model receives them: names, labels, exact digits. */
export type DraftFigures = Pick<PeriodFigures, "period" | "figures" | "notes"> & Partial<Pick<PeriodFigures, "amilShare" | "attestations" | "durations">>;

export function figuresForPrompt(figures: DraftFigures): string {
  const lines = figures.figures.map(
    (figure) => `- ${figure.name} | ${figure.label} | ${figure.value.amount} | ${figure.value.unit}`
  );

  return [
    `Periode pelaporan: ${figures.period.kind} ${figures.period.year}`,
    "",
    "Angka periode (nama | keterangan | nilai | satuan):",
    ...lines,
    "",
    `Plafon hak amil terlampaui: ${figures.amilShare ? (figures.amilShare.withinCeiling ? "tidak" : "ya") : "belum diperiksa"}`,
    `Jumlah atestasi auditor pada periode ini: ${figures.attestations?.length ?? "belum diperiksa"}`,
    // Named rather than left for the model to work out: picking the slowest
    // stage would be a comparison, and a comparison is a calculation.
    `Tahap yang paling banyak memakan waktu: ${
      figures.durations?.slowest
        ? `${figures.durations?.slowest.label} (durasi.${figures.durations?.slowest.name}.rata_rata_jam)`
        : "belum ada perbandingan tahap dari penyaluran yang sama pada periode ini"
    }`,
    "",
    "Catatan batas laporan ini, sampaikan bila relevan:",
    ...figures.notes.map((note) => `- ${note}`),
  ].join("\n");
}

/**
 * Turns the model's decimal-string claims into the draft the validator eats.
 *
 * An amount that is not a whole number is carried through as an unreadable
 * claim rather than thrown away. The model is told to write rupiah as
 * `Rp1.500.000` in the narrative, so a claim amount arriving as `"100.000.000"`
 * is the likeliest mistake it will make - and discarding the whole draft over it
 * would report a bad draft as an outage and hide from the reader exactly what
 * the validator is for.
 */
export function toReportDraft(raw: RawDraft): ReportDraft {
  const claims: DraftClaim[] = raw.claims.map((claim) =>
    /^-?\d+$/.test(claim.amount.trim())
      ? { name: claim.name, value: { amount: BigInt(claim.amount.trim()), unit: claim.unit } }
      : { name: claim.name, value: null, statedAmount: claim.amount }
  );

  return { claims, narrative: raw.narrative };
}

const unavailable = (reason: string): { draft: null; unavailable: string } => ({
  draft: null,
  unavailable: `${reason} Angka periode tetap dihitung dari ledger.`,
});

/**
 * Asks the model for a draft over the given figures. Never throws: every
 * failure becomes an absent draft with a stated reason.
 */
export async function draftReport(figures: DraftFigures): Promise<DraftAttempt> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    return unavailable(
      "Kredensial layanan AI tidak tersedia di server (DEEPSEEK_API_KEY belum disetel), sehingga narasi tidak disusun."
    );
  }

  try {
    const baseUrl = process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com";
    const endpoint = new URL("chat/completions", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    const response = await fetch(endpoint.href, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(DRAFT_TIMEOUT_MS),
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL?.trim() || DRAFT_MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: DRAFTING_SYSTEM },
          { role: "user", content: figuresForPrompt(figures) },
        ],
      }),
    });

    if (!response.ok) {
      // Do not expose upstream bodies: they can echo credentials or request data.
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) {
        return unavailable("Kredensial layanan AI ditolak, sehingga narasi tidak disusun.");
      }
      if (response.status === 402) {
        return unavailable("Saldo layanan AI tidak mencukupi, sehingga narasi tidak disusun.");
      }
      if (response.status === 429) {
        return unavailable("Layanan AI sedang membatasi permintaan, sehingga narasi belum bisa disusun.");
      }
      return unavailable(`Layanan AI mengembalikan galat (${response.status}), sehingga narasi tidak disusun.`);
    }

    const completion = CompletionSchema.parse(await response.json());
    const choice = completion.choices[0]!;
    if (choice.finish_reason === "content_filter") {
      return unavailable("Layanan AI menolak menyusun narasi, sehingga draf tidak dipakai.");
    }
    if (choice.finish_reason !== "stop") {
      return unavailable("Layanan AI berhenti sebelum draf selesai, sehingga draf tidak dipakai.");
    }

    const raw = DraftSchema.parse(JSON.parse(choice.message.content ?? ""));
    return { draft: toReportDraft(raw), unavailable: null };
  } catch (error: unknown) {
    return { draft: null, unavailable: describeFailure(error) };
  }
}

export function describeFailure(error: unknown): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return unavailable("Layanan AI melewati batas waktu, sehingga narasi tidak disusun.").unavailable;
  }
  if (error instanceof SyntaxError || error instanceof z.ZodError) {
    return unavailable("Layanan AI mengembalikan draf yang tidak sesuai bentuk yang diminta, sehingga tidak dipakai.").unavailable;
  }
  return unavailable("Layanan AI tidak dapat dihubungi atau penyusunan narasi gagal.").unavailable;
}

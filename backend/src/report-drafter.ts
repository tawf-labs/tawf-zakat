/**
 * Drafting the period narrative (Spec #61, ticket #63).
 *
 * The order here is the whole point and must not be reversed: the figures are
 * computed from the ledger first, handed to the model as the only numbers it may
 * use, and whatever comes back goes through `report-validator` before anyone
 * reads it. The model proposes; it never certifies.
 *
 * There is no provider abstraction, no dependency injection and nothing to mock.
 * Credentials are read from the environment and the call is made directly, which
 * is why this module has no unit tests around the network: from the test
 * suite's point of view there is no AI, only a draft. What *is* tested is
 * everything either side of the call - the prompt the figures become, and the
 * draft the response becomes.
 *
 * `draftReport` never throws and never rejects. A missing key, a timeout, a
 * refusal and a malformed response all come back the same way: no draft, and a
 * reason stated in the open. The period figures stand on their own without it.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { FIGURE_UNITS, type PeriodFigures } from "./period-report";
import type { DraftClaim, ReportDraft } from "./report-validator";

/** Anthropic's most capable widely available model; 1M context. */
export const DRAFT_MODEL = "claude-opus-5";

/**
 * Generous enough for an adaptive-thinking turn, bounded enough that a browser
 * is not left hanging: the SDK retries, so the worst case is roughly
 * `timeout x (retries + 1)`.
 */
const DRAFT_TIMEOUT_MS = 90_000;
const DRAFT_MAX_RETRIES = 1;

const MAX_TOKENS = 16_000;

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
  narrative: z.string().describe("Narasi laporan periode dalam bahasa Indonesia."),
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
].join("\n");

/** Renders the figures as the model receives them: names, labels, exact digits. */
export function figuresForPrompt(figures: PeriodFigures): string {
  const lines = figures.figures.map(
    (figure) => `- ${figure.name} | ${figure.label} | ${figure.value.amount} | ${figure.value.unit}`
  );

  return [
    `Periode pelaporan: ${figures.period.kind} ${figures.period.year}`,
    "",
    "Angka periode (nama | keterangan | nilai | satuan):",
    ...lines,
    "",
    `Plafon hak amil terlampaui: ${figures.amilShare.withinCeiling ? "tidak" : "ya"}`,
    `Jumlah atestasi auditor pada periode ini: ${figures.attestations.length}`,
    // Named rather than left for the model to work out: picking the slowest
    // stage would be a comparison, and a comparison is a calculation.
    `Tahap yang paling banyak memakan waktu: ${
      figures.durations.slowest
        ? `${figures.durations.slowest.label} (durasi.${figures.durations.slowest.name}.rata_rata_jam)`
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

const hasCredentials = (): boolean =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/**
 * Asks the model for a draft over the given figures. Never throws: every
 * failure becomes an absent draft with a stated reason.
 */
export async function draftReport(figures: PeriodFigures): Promise<DraftAttempt> {
  if (!hasCredentials()) {
    return {
      draft: null,
      unavailable:
        "Kredensial layanan AI tidak tersedia di server (ANTHROPIC_API_KEY belum disetel), " +
        "sehingga narasi tidak disusun. Angka periode di bawah tetap dihitung dari ledger.",
    };
  }

  try {
    const client = new Anthropic({ timeout: DRAFT_TIMEOUT_MS, maxRetries: DRAFT_MAX_RETRIES });

    const response = await client.messages.parse({
      model: DRAFT_MODEL,
      max_tokens: MAX_TOKENS,
      system: DRAFTING_SYSTEM,
      messages: [{ role: "user", content: figuresForPrompt(figures) }],
      output_config: { format: zodOutputFormat(DraftSchema) },
    });

    if (response.stop_reason === "refusal") {
      return {
        draft: null,
        unavailable: `Layanan AI menolak menyusun narasi (${
          response.stop_details?.category ?? "tanpa kategori"
        }). Angka periode tetap dihitung dari ledger.`,
      };
    }

    if (!response.parsed_output) {
      return {
        draft: null,
        unavailable:
          "Layanan AI mengembalikan draf yang tidak sesuai bentuk yang diminta, sehingga tidak dipakai. " +
          "Angka periode tetap dihitung dari ledger.",
      };
    }

    return { draft: toReportDraft(response.parsed_output), unavailable: null };
  } catch (error: unknown) {
    return { draft: null, unavailable: describeFailure(error) };
  }
}

export function describeFailure(error: unknown): string {
  const tail = " Angka periode tetap dihitung dari ledger.";

  if (error instanceof Anthropic.AuthenticationError) {
    return "Kredensial layanan AI ditolak, sehingga narasi tidak disusun." + tail;
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Layanan AI sedang membatasi permintaan, sehingga narasi belum bisa disusun." + tail;
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return "Layanan AI melewati batas waktu, sehingga narasi tidak disusun." + tail;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Layanan AI tidak dapat dihubungi, sehingga narasi tidak disusun." + tail;
  }
  if (error instanceof Anthropic.APIError) {
    return `Layanan AI mengembalikan galat (${error.status ?? "tanpa status"}), sehingga narasi tidak disusun.${tail}`;
  }
  return (
    (error instanceof Error ? `Penyusunan narasi gagal: ${error.message}` : "Penyusunan narasi gagal.") +
    tail
  );
}

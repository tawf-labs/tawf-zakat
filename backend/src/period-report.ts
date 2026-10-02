/**
 * Period figures (Spec #61) - the numbers a period report is allowed to contain.
 *
 * This module is the *only* source of truth a draft may claim from. It takes
 * rows and a reporting period and returns every figure, each under a stable
 * machine name; `report-validator` then checks a draft against exactly this set.
 * Nothing here reads a database, a store, `viem`, or the network - it takes
 * rows, not a connection - so the whole of its behaviour is testable offline.
 *
 * Limits are stated out loud in `notes` rather than papered over:
 *
 * 1. `donations` carries no jenis dana column and this work adds no migration,
 *    so every fiat donation counts as ZAKAT and the other four jenis dana of
 *    PerBAZNAS 1/2023 report zero. The structure is real; the split is not yet.
 * 2. A USDC donation row stores an *estimated* rupiah value at a fixed rate, so
 *    it is reported on its own line and never added into collection per jenis
 *    dana. An invented rate must not leak into a figure somebody signs.
 * 3. A row with no usable timestamp is left out of every period rather than
 *    counted in all of them, and the number left out is reported as a figure of
 *    its own - so nothing disappears quietly on the way to a signature.
 * 4. A stage duration is published only where both its ends carry a readable
 *    timestamp. What is left unmeasured is counted and named instead - see
 *    `disbursement-duration` for why a block number is not a clock.
 */

import {
  disbursementTrail,
  periodDurations,
  stageBlocksByProposal,
  type PeriodDurations,
  type StageEventRow,
} from "./disbursement-duration";
import { isAttested, placeInPeriod, proposalAmount, readableIso, toWholeAmount } from "./ledger-rows";
import { JENIS_DANA, type CurrencyUnit, type ReportingPeriod } from "./reconciliation";
import { AMIL_CEILING_BPS, assessAmilAmounts } from "./amil-policy";
export { AMIL_CEILING_BPS } from "./amil-policy";

/**
 * Units a period figure can carry. Money is one vocabulary; a ratio in basis
 * points and a plain count are the other two. Figures are never added across
 * units, so a comparison is always `(amount, unit)` against `(amount, unit)`.
 */
export const FIGURE_UNITS = ["IDR", "USDC_6DP", "BPS", "COUNT", "JAM"] as const satisfies readonly (
  | CurrencyUnit
  | "BPS"
  | "COUNT"
  | "JAM"
)[];

export type FigureUnit = (typeof FIGURE_UNITS)[number];

export type FigureValue = { amount: bigint; unit: FigureUnit };

export type Figure = { name: string; label: string; value: FigureValue };

/** The eight asnaf, plus the bucket for a label this system cannot place. */
export const ASNAF = [
  "FAKIR",
  "MISKIN",
  "AMIL",
  "MUALLAF",
  "RIQAB",
  "GHARIMIN",
  "FISABILILLAH",
  "IBNU_SABIL",
  "LAINNYA",
] as const;

export type Asnaf = (typeof ASNAF)[number];

export type DonationRow = {
  trxId?: string;
  amountIDR: number | string;
  status?: string | null;
  paymentMethod?: string | null;
  createdAt?: Date | string | null;
  paidAt?: Date | string | null;
  /**
   * Native USDC minor units, where the row carries them (ticket #67). Absent on
   * a fiat row and on a USDC row recorded before that ticket; absence keeps the
   * row out of the USDC figure rather than converting its rupiah estimate.
   */
  amountUsdc6dp?: string | number | null;
};

export type ProposalRow = {
  proposalIdOnChain: number;
  currencyType: number; // 0: IDR, 1: USDC
  amount: number | string;
  /** The amount as stored exactly (ticket #80). Absent before that migration. */
  amountExact?: string | number | null;
  asnafCategory?: string | number | null;
  status: string; // 'Pending' | 'Approved' | 'Executed' | 'Cancelled'
  createdAt?: Date | string | null;
  executedAt?: Date | string | null;
  auditStatus?: string | null;
  auditorName?: string | null;
  auditorAddress?: string | null;
  auditOpinion?: string | null;
  auditReportCID?: string | null;
  auditTxHash?: string | null;
  auditedAt?: Date | string | null;
};

export type PeriodRows = {
  donations: DonationRow[];
  proposals: ProposalRow[];
  /**
   * Indexed on-chain events, read only for the block number that fixed each
   * stage. Optional: without them the durations still stand and the trails
   * simply carry no block markers, rather than carrying invented ones.
   */
  events?: StageEventRow[];
};

export type Attestation = {
  proposalId: number;
  auditorName: string | null;
  auditorAddress: string | null;
  opinion: string | null;
  reportCID: string | null;
  txHash: string | null;
  auditedAt: string | null;
};

export type AmilShare = {
  collected: FigureValue;
  ceiling: FigureValue;
  actual: FigureValue;
  ceilingRatio: FigureValue;
  /**
   * The realised share in basis points, floored - so it reads at the ceiling
   * when it is a hair over it. Meaningless on its own when nothing was
   * collected, which is why `withinCeiling` is decided by cross-multiplication
   * rather than by comparing this figure against the ceiling.
   */
  actualRatio: FigureValue;
  withinCeiling: boolean;
};

export type PeriodFigures = {
  period: ReportingPeriod;
  /** Every figure a draft may claim, in a stable order. */
  figures: Figure[];
  collection: Figure[];
  distribution: Figure[];
  amilShare: AmilShare;
  attestations: Attestation[];
  /** How long each stage of this period's disbursements actually took. */
  durations: PeriodDurations;
  /** Limits of this period's figures, said plainly rather than left implied. */
  notes: string[];
};

const idr = (amount: bigint): FigureValue => ({ amount, unit: "IDR" });
const usdc = (amount: bigint): FigureValue => ({ amount, unit: "USDC_6DP" });
const bps = (amount: bigint): FigureValue => ({ amount, unit: "BPS" });
const count = (amount: bigint): FigureValue => ({ amount, unit: "COUNT" });
const jam = (amount: bigint): FigureValue => ({ amount, unit: "JAM" });

const figure = (name: string, label: string, value: FigureValue): Figure => ({ name, label, value });

const JENIS_DANA_LABELS: Record<string, string> = {
  ZAKAT: "Zakat",
  FITRAH: "Zakat Fitrah",
  INFAK_SEDEKAH: "Infak/Sedekah",
  KURBAN: "Kurban",
  DSKL: "Dana Sosial Keagamaan Lainnya",
};

const ASNAF_LABELS: Record<Asnaf, string> = {
  FAKIR: "Fakir",
  MISKIN: "Miskin",
  AMIL: "Amil",
  MUALLAF: "Muallaf",
  RIQAB: "Riqab",
  GHARIMIN: "Gharimin",
  FISABILILLAH: "Fisabilillah",
  IBNU_SABIL: "Ibnu Sabil",
  LAINNYA: "Lainnya (label di luar delapan asnaf)",
};

/** The numeric asnaf codes the contract and the intake route already speak. */
const ASNAF_BY_CODE: Record<number, Asnaf> = {
  1: "FAKIR",
  2: "MISKIN",
  3: "AMIL",
  4: "MUALLAF",
  5: "RIQAB",
  6: "GHARIMIN",
  7: "FISABILILLAH",
  8: "IBNU_SABIL",
};

/**
 * Labels this system has actually written into `asnaf_category` over time.
 * Anything outside this table lands in LAINNYA: a report that guesses which
 * asnaf a stranger label meant would be inventing the very number it reports.
 */
const ASNAF_BY_LABEL: Record<string, Asnaf> = {
  FAKIR: "FAKIR",
  "FAKIR MISKIN": "FAKIR", // legacy combined label, this repo's historic default
  MISKIN: "MISKIN",
  AMIL: "AMIL",
  MUALLAF: "MUALLAF",
  MUALAF: "MUALLAF",
  RIQAB: "RIQAB",
  GHARIMIN: "GHARIMIN",
  GHARIM: "GHARIMIN",
  FISABILILLAH: "FISABILILLAH",
  "FI SABILILLAH": "FISABILILLAH",
  "IBNU SABIL": "IBNU_SABIL",
  IBNUSABIL: "IBNU_SABIL",
};

export function asnafOf(raw: string | number | null | undefined): Asnaf {
  if (raw === null || raw === undefined) return "LAINNYA";
  const text = String(raw).trim().replace(/\s+/g, " ");
  if (text === "") return "LAINNYA";
  if (/^\d+$/.test(text)) return ASNAF_BY_CODE[Number(text)] ?? "LAINNYA";
  return ASNAF_BY_LABEL[text.toUpperCase()] ?? "LAINNYA";
}

/** A donation counts as collected once it is paid; PENDING is not money yet. */
const isCollected = (row: DonationRow): boolean =>
  row.status === undefined || row.status === null || ["PAID", "BATCHED"].includes(String(row.status).toUpperCase());

const isUsdcDonation = (row: DonationRow): boolean =>
  String(row.paymentMethod ?? "").toUpperCase() === "USDC";

/**
 * The row's native USDC amount, or `null` when it has none this figure is
 * willing to state. Decimal text only: a value that has already been through a
 * float cannot be shown as an exact figure, so it is treated as absent.
 */
function readNativeUsdc(value: string | number | null | undefined): bigint | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d+$/.test(text) ? BigInt(text) : null;
}

export function computePeriodFigures(rows: PeriodRows, period: ReportingPeriod): PeriodFigures {
  let undatedRows = 0;

  /** Keeps the rows dated inside the period, and tallies the ones with no date. */
  const inPeriod = <T>(candidates: T[], dateOf: (row: T) => Date | string | null | undefined): T[] =>
    candidates.filter((row) => {
      const placement = placeInPeriod(dateOf(row), period);
      if (placement === "UNDATED") undatedRows += 1;
      return placement === "INSIDE";
    });

  const donations = inPeriod(
    rows.donations.filter(isCollected),
    (row) => row.paidAt ?? row.createdAt
  );
  const executed = inPeriod(
    rows.proposals.filter((row) => row.status === "Executed"),
    (row) => row.executedAt ?? row.createdAt
  );

  // --- Pengumpulan -----------------------------------------------------------
  const collectedByJenisDana = new Map<string, bigint>(JENIS_DANA.map((jenis) => [jenis, 0n]));
  let usdcEstimatedIDR = 0n;

  let usdcCollected = 0n;
  let usdcRowsWithoutNativeAmount = 0;

  for (const row of donations) {
    const amount = toWholeAmount(row.amountIDR, `Donasi ${row.trxId ?? "(tanpa trxId)"}`);
    if (isUsdcDonation(row)) {
      // Two figures, never one. A row that carries its native amount is counted
      // in USDC; a legacy row carries only a rupiah estimate at a hardcoded rate
      // and is counted as exactly that, because converting it back would invent
      // the deposit it was never able to prove.
      const native = readNativeUsdc(row.amountUsdc6dp);
      if (native === null) {
        usdcEstimatedIDR += amount;
        usdcRowsWithoutNativeAmount += 1;
      } else {
        usdcCollected += native;
      }
      continue;
    }
    collectedByJenisDana.set("ZAKAT", collectedByJenisDana.get("ZAKAT")! + amount);
  }

  const collectedTotal = [...collectedByJenisDana.values()].reduce((sum, value) => sum + value, 0n);

  const collection: Figure[] = [
    ...JENIS_DANA.map((jenis) =>
      figure(
        `pengumpulan.${jenis.toLowerCase()}`,
        `Pengumpulan ${JENIS_DANA_LABELS[jenis]}`,
        idr(collectedByJenisDana.get(jenis)!)
      )
    ),
    figure("pengumpulan.total", "Total pengumpulan", idr(collectedTotal)),
    figure(
      "pengumpulan.usdc",
      "Donasi USDC (jumlah asli, di luar total pengumpulan rupiah)",
      usdc(usdcCollected)
    ),
    figure(
      "pengumpulan.usdc_estimasi_idr",
      "Donasi USDC tanpa jumlah asli (estimasi rupiah warisan, di luar total pengumpulan)",
      idr(usdcEstimatedIDR)
    ),
  ];

  // --- Penyaluran ------------------------------------------------------------
  const distributedIDR = new Map<Asnaf, bigint>(ASNAF.map((asnaf) => [asnaf, 0n]));
  const distributedUSDC = new Map<Asnaf, bigint>(ASNAF.map((asnaf) => [asnaf, 0n]));

  for (const row of executed) {
    const asnaf = asnafOf(row.asnafCategory);
    const value = proposalAmount(row);
    const target = value.unit === "USDC_6DP" ? distributedUSDC : distributedIDR;
    target.set(asnaf, target.get(asnaf)! + value.amount);
  }

  const sumOf = (byAsnaf: Map<Asnaf, bigint>): bigint =>
    [...byAsnaf.values()].reduce((sum, value) => sum + value, 0n);

  const distribution: Figure[] = [
    ...ASNAF.flatMap((asnaf) => [
      figure(
        `penyaluran.${asnaf.toLowerCase()}.idr`,
        `Penyaluran ${ASNAF_LABELS[asnaf]} (rupiah)`,
        idr(distributedIDR.get(asnaf)!)
      ),
      figure(
        `penyaluran.${asnaf.toLowerCase()}.usdc`,
        `Penyaluran ${ASNAF_LABELS[asnaf]} (USDC)`,
        usdc(distributedUSDC.get(asnaf)!)
      ),
    ]),
    figure("penyaluran.total.idr", "Total penyaluran (rupiah)", idr(sumOf(distributedIDR))),
    figure("penyaluran.total.usdc", "Total penyaluran (USDC)", usdc(sumOf(distributedUSDC))),
  ];

  // --- Hak amil --------------------------------------------------------------
  const amilActual = distributedIDR.get("AMIL")!;
  const amilAmounts = assessAmilAmounts(collectedTotal, amilActual);
  const amilShare: AmilShare = {
    collected: idr(collectedTotal),
    ceiling: idr(amilAmounts.ceiling),
    actual: idr(amilActual),
    ceilingRatio: bps(AMIL_CEILING_BPS),
    actualRatio: bps(collectedTotal > 0n ? (amilActual * 10_000n) / collectedTotal : 0n),
    // Cross-multiplied, so a share taken with nothing collected is a violation
    // rather than a division nobody can perform.
    withinCeiling: amilAmounts.withinCeiling,
  };

  const amilFigures: Figure[] = [
    figure("hak_amil.porsi_idr", "Porsi hak amil (rupiah)", amilShare.actual),
    figure("hak_amil.plafon_idr", "Plafon hak amil 12,5% (rupiah)", amilShare.ceiling),
    figure("hak_amil.porsi_bps", "Porsi hak amil (basis poin)", amilShare.actualRatio),
    figure("hak_amil.plafon_bps", "Plafon hak amil (basis poin)", amilShare.ceilingRatio),
  ];

  // --- Atestasi auditor ------------------------------------------------------
  const attestations: Attestation[] = rows.proposals
    .filter((row) => isAttested(row) && placeInPeriod(row.auditedAt, period) === "INSIDE")
    .map((row) => ({
      proposalId: row.proposalIdOnChain,
      auditorName: row.auditorName ?? null,
      auditorAddress: row.auditorAddress ?? null,
      opinion: row.auditOpinion ?? null,
      reportCID: row.auditReportCID ?? null,
      txHash: row.auditTxHash ?? null,
      auditedAt: readableIso(row.auditedAt),
    }))
    .sort((a, b) => a.proposalId - b.proposalId);

  const unattested = executed.filter((row) => !isAttested(row)).length;

  const attestationFigures: Figure[] = [
    figure("atestasi.jumlah", "Jumlah atestasi auditor", count(BigInt(attestations.length))),
    figure(
      "atestasi.penyaluran_belum_diatestasi",
      "Penyaluran yang belum diatestasi",
      count(BigInt(unattested))
    ),
    figure(
      "baris.tanpa_tanggal",
      "Baris tanpa tanggal, dikeluarkan dari periode ini",
      count(BigInt(undatedRows))
    ),
  ];

  // --- Durasi penyaluran -----------------------------------------------------
  //
  // The population is exactly the disbursements the penyaluran figures above
  // describe: executed, inside this period. A duration drawn from a different
  // population than the amounts beside it would be two reports in one document.
  const stageBlocks = stageBlocksByProposal(rows.events ?? []);
  const durations = periodDurations(
    executed.map((row) => disbursementTrail(row, stageBlocks.get(row.proposalIdOnChain) ?? {}))
  );

  const durationFigures: Figure[] = [
    figure(
      "durasi.penyaluran_ditelusuri",
      "Penyaluran yang jejak waktunya ditelusuri",
      count(BigInt(durations.trails.length))
    ),
    ...durations.intervals.flatMap((interval) => [
      // The sample count is published for every interval, including the ones
      // with no average at all - a zero there is what tells a reader the
      // absence is measured rather than overlooked.
      figure(
        `durasi.${interval.name}.jumlah_sampel`,
        `${interval.label}: jumlah penyaluran yang terukur`,
        count(BigInt(interval.sampleCount))
      ),
      // An average is published only where one exists. A stage nobody has
      // passed yet has no duration, and publishing zero hours for it would read
      // as instant - the opposite of the truth.
      ...(interval.averageHours === null
        ? []
        : [
            figure(
              `durasi.${interval.name}.rata_rata_jam`,
              `${interval.label}: rata-rata (jam)`,
              jam(interval.averageHours)
            ),
          ]),
    ]),
  ];

  return {
    period,
    figures: [
      ...collection,
      ...distribution,
      ...amilFigures,
      ...attestationFigures,
      ...durationFigures,
    ],
    collection,
    distribution,
    amilShare,
    attestations,
    durations,
    notes: [
      "Basis data tidak menyimpan jenis dana per donasi, sehingga seluruh donasi fiat dihitung sebagai Zakat dan jenis dana lainnya bernilai nol.",
      "Donasi USDC dilaporkan dalam satuan aslinya dan tidak dijumlahkan ke pengumpulan rupiah per jenis dana.",
      ...(usdcRowsWithoutNativeAmount > 0
        ? [
            `${usdcRowsWithoutNativeAmount} baris donasi USDC tidak menyimpan jumlah aslinya dan hanya ` +
              `memiliki estimasi rupiah pada kurs tetap. Baris tersebut dilaporkan terpisah sebagai ` +
              `estimasi warisan, tidak dikonversi kembali ke USDC, dan tidak masuk angka pengumpulan USDC.`,
          ]
        : []),
      "Penyaluran dihitung dari proposal berstatus Executed pada periode ini; rupiah dan USDC dilaporkan sebagai satuan yang berbeda.",
      "Baris tanpa tanggal yang dapat dibaca dikeluarkan dari periode ini - bukan dihitung di setiap periode - dan jumlahnya dilaporkan sebagai angka tersendiri.",
      ...durations.notes,
    ],
  };
}

export const figureByName = (figures: PeriodFigures, name: string): Figure | undefined =>
  figures.figures.find((item) => item.name === name);

/** Reconciliation scope has ledger totals, never invented donations or asnaf. */
const FIGURE_BUCKET_LABELS: Record<string, string> = {
  ZAKAT: "Zakat mal", FITRAH: "Zakat fitrah", INFAK_SEDEKAH: "Infak/sedekah", KURBAN: "Kurban",
  DSKL: "Dana sosial keagamaan lainnya", DEPOSIT_USDC: "Deposit USDC",
};

/**
 * How a snapshot figure is named to people (ADR-0043, #131): the staff glossary's
 * words, never the machine name. A side read from the realization stream speaks of
 * what was distributed; a claim side that is that same stream says it stands in for
 * a bookkeeping recap rather than being one.
 */
function sideWording(manifest: import("./evidence-source").SourceManifest) {
  const fromApp = manifest.origin === "INTERNAL_LEDGER" && ["internal-disbursement-realization", "internal-contribution-collection"].includes(manifest.format);
  const verb = fromApp ? "disalurkan" : "";
  if (manifest.role === "SOURCE") return { verb, where: fromApp ? "menurut data aplikasi" : "menurut sumber", noun: fromApp ? "data aplikasi" : "sumber" };
  return fromApp
    ? { verb, where: "pada sisi pembanding (data aplikasi, tanpa rekap pembukuan)", noun: "sisi pembanding" }
    : { verb, where: "menurut rekap pembukuan", noun: "rekap pembukuan" };
}

export function computeSnapshotFigures(
  snapshot: import("./evidence-snapshot").EvidenceSnapshot,
  result: import("./reconciliation").ReconciliationReport | null,
): Figure[] {
  const figures: Figure[] = [];
  for (const side of snapshot.sides) {
    if (side.status !== "READ") continue;
    const scopedRows = side.rows.filter(r => !r.isDeclaredTotal && (snapshot.balanceSheetScope === "BOTH" || r.balanceSheet === snapshot.balanceSheetScope));
    const rows = scopedRows.filter(r => r.flow !== "COLLECTION");
    if (side.manifest.flows?.includes("COLLECTION") || scopedRows.some(r => r.flow === "COLLECTION")) {
      const collection = scopedRows.filter(r => r.flow === "COLLECTION");
      const where = sideWording(side.manifest).where;
      const addCollection = (name: string, label: string, selected: typeof collection) => figures.push({ name, label,
        value: { amount: selected.reduce((sum, row) => sum + BigInt(row.amount), 0n), unit: snapshot.currencyUnit } });
      addCollection(`${side.manifest.role}.COLLECTION.total`, `Total dihimpun ${where}`, collection);
      for (const bucket of [...side.manifest.fundTypes].sort()) {
        for (const position of snapshot.balanceSheetScope === "BOTH" ? ["ON", "OFF"] : [snapshot.balanceSheetScope]) {
          addCollection(`${side.manifest.role}.COLLECTION.${bucket}.${position}`, `${FIGURE_BUCKET_LABELS[bucket] ?? bucket} dihimpun ${where}${position === "OFF" ? " (di luar neraca)" : ""}`,
            collection.filter(r => r.bucket === bucket && r.balanceSheet === position));
        }
      }
    }
    const { verb, where } = sideWording(side.manifest);
    const add = (name: string, label: string, selected: typeof rows) => figures.push({ name, label,
      value: { amount: selected.reduce((sum, row) => sum + BigInt(row.amount), 0n), unit: snapshot.currencyUnit } });
    add(`${side.manifest.role}.total`, ["Total", verb, where].filter(Boolean).join(" "), rows);
    for (const bucket of [...side.manifest.fundTypes].sort()) {
      for (const position of snapshot.balanceSheetScope === "BOTH" ? ["ON", "OFF"] : [snapshot.balanceSheetScope]) {
        const place = position === "OFF" ? " (di luar neraca)" : snapshot.balanceSheetScope === "BOTH" ? " (dalam neraca)" : "";
        const label = [FIGURE_BUCKET_LABELS[bucket] ?? bucket.replace(/_/g, " "), verb, where].filter(Boolean).join(" ") + place;
        add(`${side.manifest.role}.${bucket}.${position}`, label, rows.filter(r => r.bucket === bucket && r.balanceSheet === position));
      }
    }
  }
  if (result) {
    const noun = (role: "CLAIM" | "SOURCE") => {
      const side = snapshot.sides.find(s => s.manifest.role === role);
      return side ? sideWording(side.manifest).noun : role === "CLAIM" ? "rekap pembukuan" : "sumber";
    };
    figures.push({ name: "rekonsiliasi.selisih", label: `Selisih ${noun("CLAIM")} dikurangi ${noun("SOURCE")}`, value: result.netDelta });
    figures.push({ name: "rekonsiliasi.selisih_absolut", label: `Jumlah seluruh perbedaan ${noun("CLAIM")} dan ${noun("SOURCE")}`, value: result.absoluteDelta });
  }
  return figures.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

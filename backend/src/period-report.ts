/**
 * Period figures (Spec #61) - the numbers a period report is allowed to contain.
 *
 * This module is the *only* source of truth a draft may claim from. It takes
 * rows and a reporting period and returns every figure, each under a stable
 * machine name; `report-validator` then checks a draft against exactly this set.
 * Nothing here reads a database, a store, `viem`, or the network - it takes
 * rows, not a connection - so the whole of its behaviour is testable offline.
 *
 * Two limits are stated out loud in `notes` rather than papered over:
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
 */

import { placeInPeriod, proposalAmount, toWholeAmount } from "./ledger-rows";
import { JENIS_DANA, type CurrencyUnit, type ReportingPeriod } from "./reconciliation";

/**
 * Units a period figure can carry. Money is one vocabulary; a ratio in basis
 * points and a plain count are the other two. Figures are never added across
 * units, so a comparison is always `(amount, unit)` against `(amount, unit)`.
 */
export type FigureUnit = CurrencyUnit | "BPS" | "COUNT";

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

/** The hak amil ceiling, in basis points - the same 12,5% the contract locks. */
export const AMIL_CEILING_BPS = 1250n;

export type DonationRow = {
  trxId?: string;
  amountIDR: number | string;
  status?: string | null;
  paymentMethod?: string | null;
  createdAt?: Date | string | null;
  paidAt?: Date | string | null;
};

export type ProposalRow = {
  proposalIdOnChain: number;
  currencyType: number; // 0: IDR, 1: USDC
  amount: number | string;
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

export type PeriodRows = { donations: DonationRow[]; proposals: ProposalRow[] };

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
  /** Limits of this period's figures, said plainly rather than left implied. */
  notes: string[];
};

const idr = (amount: bigint): FigureValue => ({ amount, unit: "IDR" });
const usdc = (amount: bigint): FigureValue => ({ amount, unit: "USDC_6DP" });
const bps = (amount: bigint): FigureValue => ({ amount, unit: "BPS" });
const count = (amount: bigint): FigureValue => ({ amount, unit: "COUNT" });

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

const isAttested = (row: ProposalRow): boolean =>
  Boolean(row.auditStatus) && String(row.auditStatus).toUpperCase() !== "PENDING";

const asIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
};

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

  for (const row of donations) {
    const amount = toWholeAmount(row.amountIDR, `Donasi ${row.trxId ?? "(tanpa trxId)"}`);
    if (isUsdcDonation(row)) {
      usdcEstimatedIDR += amount;
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
      "pengumpulan.usdc_estimasi_idr",
      "Donasi USDC (estimasi rupiah, di luar total pengumpulan)",
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
  const amilCeiling = (collectedTotal * AMIL_CEILING_BPS) / 10_000n;
  const amilShare: AmilShare = {
    collected: idr(collectedTotal),
    ceiling: idr(amilCeiling),
    actual: idr(amilActual),
    ceilingRatio: bps(AMIL_CEILING_BPS),
    actualRatio: bps(collectedTotal > 0n ? (amilActual * 10_000n) / collectedTotal : 0n),
    // Cross-multiplied, so a share taken with nothing collected is a violation
    // rather than a division nobody can perform.
    withinCeiling: amilActual * 10_000n <= collectedTotal * AMIL_CEILING_BPS,
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
      auditedAt: asIso(row.auditedAt),
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

  return {
    period,
    figures: [...collection, ...distribution, ...amilFigures, ...attestationFigures],
    collection,
    distribution,
    amilShare,
    attestations,
    notes: [
      "Basis data tidak menyimpan jenis dana per donasi, sehingga seluruh donasi fiat dihitung sebagai Zakat dan jenis dana lainnya bernilai nol.",
      "Donasi USDC dicatat sebagai estimasi rupiah pada kurs tetap, sehingga dilaporkan terpisah dan tidak dijumlahkan ke pengumpulan per jenis dana.",
      "Penyaluran dihitung dari proposal berstatus Executed pada periode ini; rupiah dan USDC dilaporkan sebagai satuan yang berbeda.",
      "Baris tanpa tanggal yang dapat dibaca dikeluarkan dari periode ini - bukan dihitung di setiap periode - dan jumlahnya dilaporkan sebagai angka tersendiri.",
    ],
  };
}

export const figureByName = (figures: PeriodFigures, name: string): Figure | undefined =>
  figures.figures.find((item) => item.name === name);

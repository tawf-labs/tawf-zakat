/**
 * Laporan periode dari data aplikasi (ADR-0043, #130).
 *
 * The staff flow freezes a period report from the institution's own recorded
 * realizations, with no pasted side and no bookkeeping recap. This module holds
 * what that flow decides and nothing that reads a database:
 *
 * - **The frozen shape without bookkeeping.** Both sides come from one read of
 *   the internal realization stream. The claim side is labelled as the app's own
 *   data standing in for a bookkeeping recap, and the snapshot carries
 *   `NOT_COMPARED_NOTE` among its coverage notes, so a balanced reconciliation is
 *   never read as "checked against the treasurer's books". The validator examines
 *   the package exactly as it examines any other.
 * - **The step-2 preview**, in the figures staff recognise: amounts per fund type,
 *   goods per unit, recipients, operational costs and handovers whose evidence is
 *   still incomplete.
 * - **The list of period reports**, one card per period, from local rows only:
 *   preparations, report packages and the confirmed-publication locks of #129.
 */

import type { SubmittedSide } from "./evidence-source";
import type { ReportingPeriod } from "./reconciliation";
import type { RealizationProvenance } from "./realization-source";
import type { PeriodLock } from "./period-lock";
import { DISBURSEMENT_REALIZATION_FORMAT } from "./realization-source";

const PERIOD_NAMES: Record<ReportingPeriod["kind"], string> = { SEMESTER: "Semester I", AKHIR_TAHUN: "Akhir tahun" };

export const periodName = (period: ReportingPeriod) => `${PERIOD_NAMES[period.kind]} ${period.year}`;

/** The preparation label the flow fills in; staff never type one. */
export const periodReportLabel = (period: ReportingPeriod) => `Laporan penyaluran ${periodName(period)}`;

/**
 * Stated in every snapshot frozen without a bookkeeping recap. Shown under the
 * report's examination limits, so a reconciliation of the app's data against
 * itself cannot pass for a comparison with the books.
 */
export const NOT_COMPARED_NOTE =
  "Angka laporan ini disusun dari data aplikasi dan tidak dibandingkan dengan pembukuan bendahara: " +
  "sisi klaim memuat data aplikasi yang sama dengan sisi sumber, bukan rekap pembukuan.";

const MIRRORED_CLAIM_LABEL = "Data aplikasi (tanpa rekap pembukuan)";

/**
 * The claim side when no bookkeeping recap was given: the realization stream,
 * read once with the source, under a label and note that say what it is.
 */
export function withoutBookkeeping(claim: SubmittedSide): SubmittedSide {
  return {
    ...claim,
    manifest: {
      ...claim.manifest,
      label: MIRRORED_CLAIM_LABEL,
      note: `${NOT_COMPARED_NOTE} ${claim.manifest.note ?? ""}`.trim(),
    },
  };
}

export type PeriodReportPreview = {
  period: ReportingPeriod;
  cutOff: string;
  /** Rupiah realized per fund type, only the fund types that hold a handover. */
  byFundType: { fundType: string; amountIdr: string }[];
  totalIdr: string;
  goods: { unit: string; quantity: string; handovers: number }[];
  recipients: number;
  handovers: number;
  costs: { directIdr: string; fromAdvanceIdr: string; totalIdr: string; advancesIdr: string; unaccountedAdvancesIdr: string };
  /** Handovers in the report whose evidence is not complete yet. */
  incompleteEvidence: { realizationId: string; recipient: string; program: string | null; amountIdr: string | null; quantity: string | null; unit: string | null }[];
  /** Recorded in the period after the cut-off: not in this report, and not absent either. */
  afterCutOff: number;
  /** Records the app could not state an amount for; each with its reason. */
  unverified: { reference: string; reason: string }[];
};

/** What step 2 shows, from the side and provenance the freeze itself would produce. */
export function previewOf(side: SubmittedSide, provenance: RealizationProvenance): PeriodReportPreview {
  const byFund = new Map<string, bigint>();
  if (side.status === "READ") {
    for (const row of side.rows) {
      if (row.isDeclaredTotal || row.unit !== "IDR") continue;
      byFund.set(row.bucket, (byFund.get(row.bucket) ?? 0n) + BigInt(row.amount));
    }
  }
  const direct = provenance.expenses.filter((e) => e.advanceId === null);
  const fromAdvance = provenance.expenses.filter((e) => e.advanceId !== null);
  const sum = (items: { amountIdr: string }[]) =>
    items.reduce((total, item) => total + (/^\d+$/.test(item.amountIdr) ? BigInt(item.amountIdr) : 0n), 0n);

  return {
    period: provenance.period as ReportingPeriod,
    cutOff: provenance.cutOff,
    byFundType: [...byFund.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fundType, amount]) => ({ fundType, amountIdr: amount.toString() })),
    totalIdr: provenance.totals.totalRealizedIdr,
    goods: provenance.totals.goods.map((g) => ({ unit: g.unit, quantity: g.totalQuantity, handovers: g.count })),
    recipients: provenance.totals.beneficiaryCount,
    handovers: provenance.totals.handoverEventCount,
    costs: {
      directIdr: sum(direct).toString(),
      fromAdvanceIdr: sum(fromAdvance).toString(),
      totalIdr: provenance.totals.expensesIdr,
      advancesIdr: provenance.totals.advancesIdr,
      unaccountedAdvancesIdr: provenance.totals.unaccountedAdvancesIdr,
    },
    incompleteEvidence: provenance.realizations
      .filter((r) => r.evidenceStatus !== "EVIDENCE_COMPLETE")
      .map((r) => ({
        realizationId: r.realizationId, recipient: r.beneficiary.name, program: r.programName,
        amountIdr: r.amountIdr, quantity: r.quantity, unit: r.unit,
      })),
    afterCutOff: provenance.excludedAfterCutOff.length,
    unverified: (side.status === "READ" ? side.unverified ?? [] : []).map(({ reference, reason }) => ({ reference, reason })),
  };
}

// ---------------------------------------------------------------------------
// Daftar laporan periode
// ---------------------------------------------------------------------------

export type PeriodReportStatus = "DRAF" | "SIAP_TERBIT" | "TERBIT" | "DIKOREKSI";

export type PreparationRow = {
  id: string;
  periodKind: string;
  periodYear: number;
  createdAt: number;
  /** The frozen manifests of each side, as far as the list needs them. */
  source: { origin: string; format: string; cutOff: string } | null;
  claim: { origin: string; format: string } | null;
};

export type PackageRow = {
  id: string;
  preparationId: string;
  status: "DRAFT" | "FROZEN";
  reportId: string;
  version: string;
  outcome: "LOLOS" | "DITOLAK";
};

export type PeriodReportSummary = {
  period: ReportingPeriod;
  name: string;
  status: PeriodReportStatus;
  /** The cut-off of the newest locked data. */
  cutOff: string | null;
  /** The newest preparation; the one the next steps continue from. */
  preparationId: string;
  fromApp: boolean;
  comparedWithBookkeeping: boolean;
  published: { packageId: string; reportId: string; version: string; publishedAt: number } | null;
  /** Every locked data set of this period, newest first, for the technical details. */
  preparations: { id: string; createdAt: number; cutOff: string | null; fromApp: boolean }[];
};

const fromStream = (manifest: { origin: string; format: string } | null) =>
  manifest?.origin === "INTERNAL_LEDGER" && manifest.format === DISBURSEMENT_REALIZATION_FORMAT;
const isFromApp = (row: PreparationRow) => fromStream(row.source);

/**
 * One summary per period, newest period first.
 *
 * - *Terbit* — a publication of one of the period's packages is confirmed (a #129 lock).
 * - *Dikoreksi* — published, and data was locked again after the published version's
 *   own data: a correction is under way.
 * - *Siap diterbitkan* — no publication yet, and the newest data has a frozen package
 *   the validator passed.
 * - *Draf* — anything else.
 */
export function summarizePeriodReports(input: {
  preparations: PreparationRow[];
  packages: PackageRow[];
  locks: PeriodLock[];
}): PeriodReportSummary[] {
  const groups = new Map<string, PreparationRow[]>();
  for (const row of input.preparations) {
    const key = `${row.periodYear}:${row.periodKind}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const packagesOf = (preparationId: string) => input.packages.filter((p) => p.preparationId === preparationId);

  const summaries: PeriodReportSummary[] = [];
  for (const rows of groups.values()) {
    rows.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    const latest = rows[0]!;
    const ids = new Set(rows.map((r) => r.id));
    const owner = new Map(input.packages.filter((p) => ids.has(p.preparationId)).map((p) => [p.id, p.preparationId]));
    const lock = input.locks.filter((l) => owner.has(l.packageId)).sort((a, b) => b.lockedAt - a.lockedAt)[0];
    const publishedPreparation = lock ? rows.find((r) => r.id === owner.get(lock.packageId)) : undefined;

    let status: PeriodReportStatus;
    if (lock) status = publishedPreparation && latest.createdAt > publishedPreparation.createdAt ? "DIKOREKSI" : "TERBIT";
    else status = packagesOf(latest.id).some((p) => p.status === "FROZEN" && p.outcome === "LOLOS") ? "SIAP_TERBIT" : "DRAF";

    const period = { kind: latest.periodKind, year: latest.periodYear } as ReportingPeriod;
    summaries.push({
      period,
      name: PERIOD_NAMES[period.kind] ? periodName(period) : `${period.kind} ${period.year}`,
      status,
      cutOff: latest.source?.cutOff ?? null,
      preparationId: latest.id,
      fromApp: isFromApp(latest),
      // Without a recap the claim side is the stream itself (`withoutBookkeeping`).
      comparedWithBookkeeping: !fromStream(latest.claim),
      published: lock ? { packageId: lock.packageId, reportId: lock.reportId, version: lock.version, publishedAt: lock.lockedAt } : null,
      preparations: rows.map((r) => ({ id: r.id, createdAt: r.createdAt, cutOff: r.source?.cutOff ?? null, fromApp: isFromApp(r) })),
    });
  }
  // Newest year first; within a year the full-year report before the half-year one.
  return summaries.sort((a, b) => b.period.year - a.period.year || (a.period.kind === "AKHIR_TAHUN" ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Tinjau, tulis, periksa (#131)
// ---------------------------------------------------------------------------

/** The report identity the flow gives a period; staff never type one. */
export const periodReportId = (period: ReportingPeriod) =>
  `laporan-penyaluran-${period.kind === "SEMESTER" ? "semester-i" : "akhir-tahun"}-${period.year}`;

/**
 * The version a new package of this report takes, from the registry's official line:
 * the first version when nothing is published, otherwise the next one, succeeding the
 * official package. A label the flow did not write is not guessed at.
 */
export function nextVersion(official: { packageId: string; version: string }): { version: string; predecessor: string | null } {
  if (!official.packageId) return { version: "1", predecessor: null };
  const current = /^\d+$/.test(official.version) ? Number(official.version) : null;
  return { version: current === null ? `${official.version}-koreksi` : String(current + 1), predecessor: official.packageId };
}

type Verdict = {
  outcome: "LOLOS" | "DITOLAK";
  prerequisites: string[];
  findings: { kind: string; message: string; excerpt?: string }[];
};

/** Why an automatic check did not pass, in words staff act on. Nothing when it passed. */
export function staffReasons(verdict: Verdict): string[] {
  if (verdict.outcome === "LOLOS") return [];
  const reasons = verdict.prerequisites.map((note) =>
    note.startsWith("Pernyataan cakupan")
      ? "Centang pernyataan bahwa seluruh sumber dan batas pemeriksaan disertakan dalam laporan."
      : note.startsWith("Klaim wajib") || note === "Angka bersumber belum tersedia."
      ? "Angka laporan belum lengkap. Muat ulang langkah ini; bila tetap terjadi, hubungi operator."
      : note === "Draf belum tersedia."
      ? "Narasi laporan belum ditulis."
      : note
  );
  for (const finding of verdict.findings) {
    reasons.push(
      finding.kind === "ANGKA_NARASI_TIDAK_DIKLAIM"
        ? `Narasi menyebut angka "${finding.excerpt ?? ""}" yang tidak ada di daftar angka laporan. Hapus angka itu atau samakan dengan angka di atas.`
        : finding.message
    );
  }
  return [...new Set(reasons)];
}

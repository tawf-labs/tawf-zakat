/**
 * Realization Reporting Source Adapter (Spec #86, Ticket #98).
 *
 * Maps an institution's recorded disbursement realizations into a normalized
 * ledger side (and canonical frozen provenance document) for evidence packages
 * and period reports.
 *
 * Core principles:
 * 1. Scope & Cut-off: Realizations reported inside the reporting period and
 *    recorded at or before cut-off are normalized into rows. Records in the
 *    period but recorded after cut-off are named as not yet examined - neither
 *    dropped silently nor called unverified. Documents and disputes created
 *    after cut-off are left out of the frozen relations.
 * 2. Stable Provenance: Binds the exact proposal version, beneficiary details,
 *    handover method, confirmation status, and evidence documents at the
 *    moment of freezing. A realization whose proposal version cannot be found
 *    is not frozen against the live draft; it is a record that cannot be proved.
 * 3. Exact Money & Separate Goods: IDR is exact integer decimal strings. Goods
 *    quantities remain separated by unit and are never converted to Rp0.
 * 4. No Double Counting (AC07): Officer advances and procurement expenses are
 *    tracked alongside the activity but NEVER summed into recipient aid.
 * 5. Honest Statements: Payments recorded by the institution are stated as
 *    such, not mislabelled as independent bank feeds or onchain settlement. A
 *    fund type this application does not recognise is not guessed.
 *
 * Pure mapper: takes database records, scope and cut-off, and returns a
 * SubmittedSide, coverage notes, and the canonical provenance document.
 */

import { canonicalJson } from "../../shared/canonical-json";
import { addDecimalStrings } from "../../shared/exact-decimal";
import {
  PROVENANCE_FILE_NAMES,
  type ProvenanceActivity,
  type ProvenanceActivityTrace,
  type ProvenanceGoodsValuation,
  type RealizationCurrentStatus,
  type ProvenanceDispute,
  type ProvenanceDocument,
  type RealizationProvenance,
} from "../../shared/realization-provenance";
import type {
  ManifestPosition,
  NormalizedRow,
  SourceManifest,
  SourceRole,
  SubmittedSide,
  UnverifiedRecord,
} from "./evidence-source";
import { JENIS_DANA, type ReportingPeriod } from "./reconciliation";
import { periodBounds } from "./ledger-rows";
import type { SubmittedFile } from "./routes/evidence-preparation";

export type { RealizationProvenance } from "../../shared/realization-provenance";

export const DISBURSEMENT_REALIZATION_STREAM = "DISBURSEMENT_REALIZATIONS" as const;
export const DISBURSEMENT_REALIZATION_MAPPING_VERSION = "internal-disbursement-realization-2" as const;
export const DISBURSEMENT_REALIZATION_FORMAT = "internal-disbursement-realization" as const;

export type RealizationDocumentRef = ProvenanceDocument & { storageRef: string };

export type RealizationDisputeRef = ProvenanceDispute & {
  disputedAmountIdr?: string | null;
  disputedQuantity?: string | null;
  disputedUnit?: string | null;
};

export type RealizationItemData = {
  id: string;
  institutionId: string;
  proposalId: string;
  proposalVersion: number;
  /** False when the approved version the realization names is missing. */
  proposalVersionFound: boolean;
  programId: string | null;
  programName: string | null;
  programFundType: string | null;
  proposalPurpose: string;
  aidLineId: string;
  beneficiaryId: string;
  beneficiaryName: string;
  beneficiaryNikMasked?: string | null;
  beneficiaryAsnaf?: string | null;
  method: string;
  amountIdr: string | null;
  quantity: string | null;
  unit: string | null;
  reportedAt: number; // epoch seconds
  recordedAt: number; // epoch seconds
  operatorAccount: string;
  operatorOfficerId: string;
  notes: string | null;
  evidenceStatus: string;
  confirmationStatus: string;
  confirmationMethod: string | null;
  documents: RealizationDocumentRef[];
  disputes: RealizationDisputeRef[];
  /** Goods lines only, from the proposal version the realization was recorded against. */
  aidLineValuation: ProvenanceGoodsValuation | null;
};

export type RealizationAdvanceItem = {
  id: string;
  proposalId: string;
  amountIdr: string;
  purpose: string;
  reference: string;
  issuedAt: number;
};

export type RealizationExpenseItem = {
  id: string;
  proposalId: string;
  advanceId: string | null;
  amountIdr: string;
  purpose: string;
  payee: string;
  recordedAt: number;
};

export type RealizationSourceData = {
  realizations: RealizationItemData[];
  advances: RealizationAdvanceItem[];
  expenses: RealizationExpenseItem[];
};

/**
 * Activities and their active contribution allocations as the activity store
 * reads them (ticket #103). Donor detail is reduced to whether one was recorded.
 */
export type ActivityTraceData = {
  coverage: string;
  disclaimer: string;
  activities: Array<{
    id: string;
    proposalId: string;
    proposalVersion: number;
    name: string;
    programFundType: string;
    targetAmount: string;
    targetIsPartial: boolean;
    createdAt: number;
    allocations: Array<{
      id: string;
      contributionId: string;
      contributionVersion: number;
      amountExact: string;
      currencyUnit: string;
      fundType: string;
      allocatedAt: number;
      contributionStatus: string;
      donorRecorded: boolean;
    }>;
  }>;
};

export type RealizationScope = {
  institution: {
    id: string;
    legalName: string;
    scopeUnit: string;
    scopeLevel: string;
  };
  period: ReportingPeriod;
  cutOff: string; // ISO 8601 string
  role?: SourceRole;
  balanceSheetScope?: ManifestPosition;
};

export type RealizationSourceInput = RealizationScope &
  RealizationSourceData & {
    /** The activity trace, or why it could not be read. Omitted: no activity store on this deployment. */
    activityTrace?: ActivityTraceData | { unavailable: string };
  };

const PROGRAM_FUND_TO_JENIS_DANA: Record<string, (typeof JENIS_DANA)[number]> = {
  ZAKAT: "ZAKAT",
  FITRAH: "FITRAH",
  INFAK: "INFAK_SEDEKAH",
  SEDEKAH: "INFAK_SEDEKAH",
  INFAK_SEDEKAH: "INFAK_SEDEKAH",
  KURBAN: "KURBAN",
  DSKL: "DSKL",
  LAINNYA: "DSKL",
};

/** The JENIS_DANA bucket a program's fund type belongs to, or `null` when it is not recognised. */
export function toJenisDana(fundType: string | null | undefined): string | null {
  if (!fundType) return null;
  return PROGRAM_FUND_TO_JENIS_DANA[fundType.toUpperCase().trim()] ?? null;
}

/**
 * The only form of a NIK that may enter a provenance file: the first four and last
 * two digits, enough for an examiner to tell two recipients apart and no more.
 */
export const maskNik = (nik: string): string =>
  nik.length > 6 ? `${nik.slice(0, 4)}********${nik.slice(-2)}` : "******";

const isExactIdr = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^\d+$/.test(value);

const rupiah = (amount: bigint) => `Rp ${amount.toLocaleString("id-ID")}`;

function manifestFor(scope: RealizationScope, fundTypes: string[], note: string): SourceManifest {
  return {
    role: scope.role ?? "SOURCE",
    label: `Realisasi Penyaluran ${scope.institution.legalName} (${scope.period.kind} ${scope.period.year})`,
    origin: "INTERNAL_LEDGER",
    institutionId: scope.institution.id,
    scopeUnit: scope.institution.scopeUnit,
    scopeLevel: scope.institution.scopeLevel,
    fundTypes,
    balanceSheet: scope.balanceSheetScope ?? "ON",
    currencyUnit: "IDR",
    period: scope.period,
    cutOff: scope.cutOff,
    format: DISBURSEMENT_REALIZATION_FORMAT,
    mappingVersion: DISBURSEMENT_REALIZATION_MAPPING_VERSION,
    transactionDetail: "PRESENT",
    note,
  };
}

/**
 * The side stated when the realization records could not be read at all.
 *
 * A failed read is never an empty source: it carries no rows, and the coverage
 * notes built from it say the scope was not examined.
 */
export function failedRealizationSide(scope: RealizationScope, detail: string): SubmittedSide {
  return {
    manifest: manifestFor(
      scope,
      [...JENIS_DANA],
      `Sumber realisasi penyaluran gagal dibaca pada ${scope.cutOff}.`
    ),
    status: "FAILED",
    detail,
  };
}

/**
 * Build the normalized side and provenance for disbursement realizations.
 */
export function buildDisbursementRealizationSide(input: RealizationSourceInput): {
  side: SubmittedSide;
  provenance: RealizationProvenance;
  provenanceFile: SubmittedFile;
  coverageNotes: string[];
} {
  const role: SourceRole = input.role ?? "SOURCE";
  const bounds = periodBounds(input.period);
  const fromSeconds = Math.floor(bounds.from.getTime() / 1000);
  const toSeconds = Math.floor(bounds.to.getTime() / 1000);
  const inPeriod = (at: number) => at >= fromSeconds && at < toSeconds;

  const cutOffMs = Date.parse(input.cutOff);
  const cutOffSeconds = Number.isFinite(cutOffMs) ? Math.floor(cutOffMs / 1000) : toSeconds;
  const byCutOff = (at: number) => at <= cutOffSeconds;

  const rows: NormalizedRow[] = [];
  const unverified: UnverifiedRecord[] = [];
  const includedRealizations: RealizationItemData[] = [];
  const excludedAfterCutOff: RealizationProvenance["excludedAfterCutOff"] = [];
  const cannotProve = (reference: string, reason: string) => unverified.push({ side: role, reference, reason });

  let totalRealizedIdr = 0n;
  const uniqueBeneficiaries = new Set<string>();
  const goodsByUnit = new Map<string, { totalQuantity: string; count: number }>();
  const methods = new Set<string>();
  const fundTypes = new Set<string>();

  for (const item of input.realizations) {
    // 1. Period bounds on the event's reported time: other periods are simply out of scope.
    if (!inPeriod(item.reportedAt)) continue;

    // 2. In the period, but recorded (or reported) after cut-off: not yet examined.
    if (!byCutOff(item.recordedAt) || !byCutOff(item.reportedAt)) {
      excludedAfterCutOff.push({
        realizationId: item.id,
        reportedAt: item.reportedAt,
        recordedAt: item.recordedAt,
      });
      continue;
    }

    // 3. Records this application cannot bind or state an amount for.
    if (!item.proposalVersionFound) {
      cannotProve(
        item.id,
        `Versi pengajuan ${item.proposalId} v${item.proposalVersion} yang dirujuk realisasi ini tidak ditemukan; ` +
          `rincian penerima tidak dibekukan dari draf aktif.`
      );
      continue;
    }
    const bucket = toJenisDana(item.programFundType);
    if (bucket === null) {
      cannotProve(
        item.id,
        `Jenis dana program ${JSON.stringify(item.programFundType)} tidak dikenali; ` +
          `realisasi tidak dimasukkan ke jenis dana mana pun.`
      );
      continue;
    }
    const hasAmount = item.amountIdr !== null && item.amountIdr !== undefined;
    if (hasAmount && !isExactIdr(item.amountIdr)) {
      cannotProve(item.id, `Nilai rupiah ${JSON.stringify(item.amountIdr)} bukan bilangan bulat rupiah yang sah.`);
      continue;
    }

    includedRealizations.push(item);
    uniqueBeneficiaries.add(item.beneficiaryId);
    methods.add(item.method);
    fundTypes.add(bucket);

    // 4. IDR realization
    if (isExactIdr(item.amountIdr)) {
      totalRealizedIdr += BigInt(item.amountIdr);
      rows.push({
        key: item.id,
        bucket,
        balanceSheet: "ON",
        amount: item.amountIdr,
        unit: "IDR",
        amilAmount: null,
        label: `Realisasi #${item.id} - ${item.beneficiaryName}`,
        isDeclaredTotal: false,
      });
    }

    // 5. Goods realization (quantities kept separated, never zero rupiah)
    if (item.quantity !== null && item.quantity !== undefined && item.unit) {
      const existing = goodsByUnit.get(item.unit) ?? { totalQuantity: "0", count: 0 };
      goodsByUnit.set(item.unit, {
        totalQuantity: addDecimalStrings(existing.totalQuantity, item.quantity),
        count: existing.count + 1,
      });

      if (!hasAmount) {
        cannotProve(
          item.id,
          `Bantuan barang (${item.quantity} ${item.unit}) tidak memiliki dasar valuasi rupiah; ` +
            `kuantitas dicatat terpisah dan tidak dijadikan nol rupiah.`
        );
      }
    }
  }

  // 6. Operational advances and expenses (AC07 - separated, non-double-counting),
  //    bounded by the same period and cut-off as the realizations.
  const advances = input.advances.filter((a) => inPeriod(a.issuedAt) && byCutOff(a.issuedAt));
  const expenses = input.expenses.filter((e) => inPeriod(e.recordedAt) && byCutOff(e.recordedAt));
  const sumIdr = (items: ReadonlyArray<{ id: string; amountIdr: string }>) => {
    let total = 0n;
    for (const item of items) {
      if (isExactIdr(item.amountIdr)) total += BigInt(item.amountIdr);
      else cannotProve(item.id, `Nilai rupiah ${JSON.stringify(item.amountIdr)} bukan bilangan bulat rupiah yang sah.`);
    }
    return total;
  };
  const totalAdvances = sumIdr(advances);
  const totalExpenses = sumIdr(expenses);
  const accountedFor = (advanceId: string) =>
    expenses
      .filter((e) => e.advanceId === advanceId && isExactIdr(e.amountIdr))
      .reduce((total, e) => total + BigInt(e.amountIdr), 0n);
  const advanceAccounts = advances.map((a) => {
    const accounted = accountedFor(a.id);
    const amount = isExactIdr(a.amountIdr) ? BigInt(a.amountIdr) : 0n;
    return { advance: a, accounted, unaccounted: amount - accounted };
  });
  const totalUnaccounted = advanceAccounts.reduce(
    (total, { unaccounted }) => total + (unaccounted > 0n ? unaccounted : 0n),
    0n
  );

  // An empty read covered every fund type and found nothing in any of them.
  const manifestFundTypes = fundTypes.size > 0 ? [...fundTypes].sort() : [...JENIS_DANA];

  const activityTrace = traceActivities(input.activityTrace, includedRealizations, byCutOff);
  const activityOf = new Map<string, string>();
  if (activityTrace.available) {
    for (const activity of activityTrace.activities) {
      for (const realizationId of activity.realizationIds) activityOf.set(realizationId, activity.activityId);
    }
  }

  const coverageNotes: string[] = [];

  if (includedRealizations.length === 0) {
    coverageNotes.push(
      `Sumber realisasi penyaluran internal terbaca penuh dan tidak memuat realisasi yang dilaporkan dalam ` +
        `periode ${input.period.kind} ${input.period.year} hingga cut-off ${input.cutOff}.`
    );
  } else {
    coverageNotes.push(
      `Sumber realisasi penyaluran internal mencatat ${rupiah(totalRealizedIdr)} untuk ${uniqueBeneficiaries.size} ` +
        `penerima (${includedRealizations.length} kejadian penyerahan).`
    );
  }

  if (goodsByUnit.size > 0) {
    const goodsDetails = Array.from(goodsByUnit.entries())
      .map(([unit, info]) => `${info.totalQuantity} ${unit} (${info.count} penyerahan)`)
      .join(", ");
    coverageNotes.push(
      `Bantuan barang dicatat terpisah per satuan: ${goodsDetails}. Bantuan barang tanpa valuasi dasar tidak dikonversi ke rupiah.`
    );
  }

  if (methods.size > 0) {
    coverageNotes.push(
      `Pembayaran/penyerahan dicatat oleh lembaga (${[...methods].join(", ")}); ` +
        `bukan bukti transaksi onchain atau pembanding bank independen.`
    );
    coverageNotes.push(
      `Status bukti, konfirmasi penerima dan sengketa dibekukan sebagaimana terbaca saat snapshot dibuat, ` +
        `bukan direkonstruksi pada saat cut-off. Dokumen dan sengketa yang dibuat setelah cut-off tidak disertakan.`
    );
  }

  if (totalAdvances > 0n || totalExpenses > 0n) {
    coverageNotes.push(
      `Uang muka operasional (${rupiah(totalAdvances)}) dan beban pengadaan/pelaksanaan (${rupiah(totalExpenses)}) ` +
        `dicatat terpisah dan tidak dijumlahkan sebagai penyaluran ganda kepada penerima. ` +
        `Uang muka yang belum dipertanggungjawabkan pada cut-off: ${rupiah(totalUnaccounted)}.`
    );
  }
  const overspent = advanceAccounts.filter(({ unaccounted }) => unaccounted < 0n).length;
  if (overspent > 0) {
    coverageNotes.push(`${overspent} uang muka memiliki beban tertaut melebihi nominalnya; selisih ditampilkan, bukan dinolkan.`);
  }
  const valuedGoods = includedRealizations.filter((r) => r.aidLineValuation?.valuedAmountIdr != null).length;
  if (valuedGoods > 0) {
    coverageNotes.push(
      `${valuedGoods} penyerahan barang berasal dari rincian bantuan yang memiliki estimasi nilai dengan dasar valuasi ` +
        `pada versi pengajuan; estimasi itu ditampilkan sebagai konteks dan tidak dijumlahkan ke realisasi rupiah.`
    );
  }

  coverageNotes.push(...activityCoverageNotes(activityTrace, input.cutOff));

  if (excludedAfterCutOff.length > 0) {
    coverageNotes.push(
      `${excludedAfterCutOff.length} realisasi dalam periode ini dicatat setelah cut-off ${input.cutOff}; ` +
        `realisasi itu belum terperiksa pada snapshot ini, bukan tidak ada.`
    );
  }

  // 7. Build canonical provenance data
  const provenance: RealizationProvenance = {
    format: "tawf.realization.provenance",
    version: 2,
    role,
    institutionId: input.institution.id,
    period: input.period,
    cutOff: input.cutOff,
    frozenAt: Math.floor(Date.now() / 1000),
    totals: {
      totalRealizedIdr: totalRealizedIdr.toString(),
      beneficiaryCount: uniqueBeneficiaries.size,
      handoverEventCount: includedRealizations.length,
      goods: Array.from(goodsByUnit.entries()).map(([unit, info]) => ({
        unit,
        totalQuantity: info.totalQuantity,
        count: info.count,
      })),
      advancesIdr: totalAdvances.toString(),
      expensesIdr: totalExpenses.toString(),
      unaccountedAdvancesIdr: totalUnaccounted.toString(),
    },
    realizations: includedRealizations.map((item) => ({
      realizationId: item.id,
      activityId: activityOf.get(item.id) ?? null,
      proposalId: item.proposalId,
      proposalVersion: item.proposalVersion,
      programId: item.programId,
      programName: item.programName,
      purpose: item.proposalPurpose,
      aidLineId: item.aidLineId,
      beneficiary: {
        id: item.beneficiaryId,
        name: item.beneficiaryName,
        asnaf: item.beneficiaryAsnaf ?? null,
        nikMasked: item.beneficiaryNikMasked ?? null,
      },
      method: item.method,
      amountIdr: item.amountIdr,
      quantity: item.quantity,
      unit: item.unit,
      reportedAt: item.reportedAt,
      recordedAt: item.recordedAt,
      evidenceStatus: item.evidenceStatus,
      confirmationStatus: item.confirmationStatus,
      confirmationMethod: item.confirmationMethod,
      documents: item.documents
        .filter((d) => byCutOff(d.createdAt))
        .map((d) => ({
          id: d.id,
          documentType: d.documentType,
          fileName: d.fileName,
          mimeType: d.mimeType,
          sizeBytes: d.sizeBytes,
          contentSha256: d.contentSha256,
          createdAt: d.createdAt,
        })),
      disputes: item.disputes
        .filter((dsp) => byCutOff(dsp.createdAt))
        .map((dsp) => ({
          id: dsp.id,
          subject: dsp.subject,
          status: dsp.status,
          reason: dsp.reason,
          createdAt: dsp.createdAt,
        })),
      aidLineValuation: item.aidLineValuation,
    })),
    activityTrace,
    excludedAfterCutOff,
    advances: advanceAccounts.map(({ advance: a, accounted, unaccounted }) => ({
      id: a.id,
      amountIdr: a.amountIdr,
      purpose: a.purpose,
      reference: a.reference,
      issuedAt: a.issuedAt,
      accountedIdr: accounted.toString(),
      unaccountedIdr: unaccounted.toString(),
    })),
    expenses: expenses.map((e) => ({
      id: e.id,
      advanceId: e.advanceId,
      amountIdr: e.amountIdr,
      purpose: e.purpose,
      payee: e.payee,
      recordedAt: e.recordedAt,
    })),
  };

  const provenanceFile: SubmittedFile = {
    role,
    fileName: PROVENANCE_FILE_NAMES[role],
    mimeType: "application/json",
    bytes: new TextEncoder().encode(canonicalJson(provenance)),
  };

  const side: SubmittedSide = {
    manifest: manifestFor(
      input,
      manifestFundTypes,
      `Sumber realisasi penyaluran dibekukan pada ${input.cutOff}. Rincian per penerima dan bukti tersedia.`
    ),
    status: "READ",
    rows,
    ...(unverified.length > 0 ? { unverified } : {}),
  };

  return { side, provenance, provenanceFile, coverageNotes };
}

/**
 * The live operational state of the realizations a snapshot froze, in the order
 * asked. Read only for display beside the snapshot; nothing here is written back.
 */
export function currentStatusOf(
  realizationIds: readonly string[],
  data: Pick<RealizationSourceData, "realizations">
): RealizationCurrentStatus[] {
  const live = new Map(data.realizations.map((item) => [item.id, item]));
  return realizationIds.map((realizationId) => {
    const item = live.get(realizationId);
    if (!item) {
      return {
        realizationId,
        found: false,
        evidenceStatus: null,
        confirmationStatus: null,
        confirmationMethod: null,
        documentCount: 0,
        disputes: [],
      };
    }
    return {
      realizationId,
      found: true,
      evidenceStatus: item.evidenceStatus,
      confirmationStatus: item.confirmationStatus,
      confirmationMethod: item.confirmationMethod,
      documentCount: item.documents.length,
      disputes: item.disputes.map((d) => ({ id: d.id, subject: d.subject, status: d.status, createdAt: d.createdAt })),
    };
  });
}

/**
 * The activities the included realizations belong to, as they stood at the cut-off.
 *
 * A realization belongs to the activity created for its own proposal version; an
 * activity created after the cut-off, or an allocation made after it, is not part
 * of the frozen relations. Allocations are never added to the realization rows.
 */
function traceActivities(
  trace: RealizationSourceInput["activityTrace"],
  included: readonly RealizationItemData[],
  byCutOff: (at: number) => boolean
): ProvenanceActivityTrace {
  if (trace === undefined) {
    return { available: false, reason: "Kegiatan penyaluran belum dikonfigurasi pada deployment ini." };
  }
  if ("unavailable" in trace) return { available: false, reason: trace.unavailable };

  const key = (proposalId: string, version: number) => `${proposalId}#${version}`;
  const activityFor = new Map(
    trace.activities.filter((a) => byCutOff(a.createdAt)).map((a) => [key(a.proposalId, a.proposalVersion), a])
  );
  const realizationsOf = new Map<string, string[]>();
  const withoutActivity: string[] = [];
  for (const item of included) {
    const activity = activityFor.get(key(item.proposalId, item.proposalVersion));
    if (!activity) {
      withoutActivity.push(item.id);
      continue;
    }
    realizationsOf.set(activity.id, [...(realizationsOf.get(activity.id) ?? []), item.id]);
  }

  const withoutDonor = new Set<string>();
  const activities: ProvenanceActivity[] = [];
  for (const activity of trace.activities) {
    const realizationIds = realizationsOf.get(activity.id);
    if (!realizationIds) continue;
    const allocations = activity.allocations.filter((a) => byCutOff(a.allocatedAt));
    const allocatedByUnit: Record<string, string> = {};
    for (const allocation of allocations) {
      allocatedByUnit[allocation.currencyUnit] = addDecimalStrings(
        allocatedByUnit[allocation.currencyUnit] ?? "0",
        allocation.amountExact
      );
      if (!allocation.donorRecorded) withoutDonor.add(allocation.contributionId);
    }
    activities.push({
      activityId: activity.id,
      proposalId: activity.proposalId,
      proposalVersion: activity.proposalVersion,
      name: activity.name,
      programFundType: activity.programFundType,
      targetAmount: activity.targetAmount,
      targetIsPartial: activity.targetIsPartial,
      createdAt: activity.createdAt,
      realizationIds,
      allocatedByUnit,
      allocations: allocations.map((a) => ({
        allocationId: a.id,
        contributionId: a.contributionId,
        contributionVersion: a.contributionVersion,
        amountExact: a.amountExact,
        currencyUnit: a.currencyUnit,
        fundType: a.fundType,
        allocatedAt: a.allocatedAt,
        contributionStatus: a.contributionStatus,
        donorRecorded: a.donorRecorded,
      })),
    });
  }

  return {
    available: true,
    coverage: trace.coverage,
    disclaimer: trace.disclaimer,
    activities,
    realizationsWithoutActivity: withoutActivity,
    contributionsWithoutDonor: withoutDonor.size,
  };
}

function activityCoverageNotes(trace: ProvenanceActivityTrace, cutOff: string): string[] {
  if (!trace.available) {
    return [`Penelusuran kegiatan dan kontribusi tidak dibekukan: ${trace.reason}`];
  }
  const notes: string[] = [];
  if (trace.activities.length > 0) {
    const allocations = trace.activities.reduce((n, a) => n + a.allocations.length, 0);
    notes.push(
      `Realisasi terhubung ke ${trace.activities.length} kegiatan penyaluran dengan ${allocations} alokasi kontribusi ` +
        `hingga cut-off ${cutOff}. Alokasi adalah komitmen pendanaan gabungan, tidak dijumlahkan ke realisasi dan ` +
        `tidak menyatakan donatur tertentu membiayai penerima tertentu.`
    );
  }
  if (trace.realizationsWithoutActivity.length > 0) {
    notes.push(
      `${trace.realizationsWithoutActivity.length} realisasi belum terhubung ke kegiatan penyaluran pada cut-off ${cutOff}; ` +
        `penelusuran kontribusinya tidak tersedia.`
    );
  }
  if (trace.contributionsWithoutDonor > 0) {
    notes.push(
      `${trace.contributionsWithoutDonor} kontribusi teralokasi tidak memuat detail donatur; sumber donor dinyatakan tidak lengkap, bukan ditebak.`
    );
  }
  return notes;
}

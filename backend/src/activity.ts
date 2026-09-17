/**
 * Pure domain logic for Kegiatan penyaluran and Alokasi kontribusi (Spec #100, Ticket #103).
 *
 * ADR-0032: Penelusuran menghubungkan kontribusi ke kegiatan yang didanai bersama
 * (pooled funding), dengan jenis dana dan peruntukan tetap dibedakan.
 *
 * ADR-0033: Alokasi eksplisit memuat nominal/unit, kontribusi, kegiatan, jenis dana
 * dan peruntukan. Sisa belum dialokasikan terlihat dan tidak berpindah otomatis;
 * selisih akibat koreksi kontribusi terlihat, tidak disembunyikan sebagai nol.
 *
 * A pure module: no database, no network, no clock.
 */

import { normalizeFundType, type JenisDana } from "./contribution";
import { goodsValuationOf, type AidLine, type FundType } from "./disbursement";
import type { CurrencyUnit } from "./reconciliation";

/**
 * Reallocation and cancellation belong to #107; this slice only records the first
 * allocation, so each record has exactly one state until that ticket adds more.
 */
export type ActivityStatus = "ACTIVE";
export type AllocationStatus = "ACTIVE";
export type AllocationHistoryAction = "ALLOCATE";

/** A refusal the caller can fix by changing the request: maps to HTTP 400. */
export class ActivityRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivityRuleError";
  }
}

/**
 * Pendanaan tercatat adalah komitmen internal lembaga, bukan saldo bank atau
 * penyerahan fisik (AC09, AC15, ADR-0033).
 */
export const FUNDING_RECORD_DISCLAIMER =
  "Catatan pendanaan teralokasi merupakan komitmen pencatatan internal lembaga, bukan saldo bank terverifikasi atau bukti serah terima bantuan fisik.";

/**
 * Cakupan penelusuran: only contributions recorded here and explicitly allocated are
 * traced. Other funding and contributions without donor detail are not given an
 * invented donor.
 */
export const TRACING_COVERAGE =
  "Penelusuran hanya mencakup kontribusi yang tercatat di ruang kerja ini dan dialokasikan secara eksplisit. Pendanaan dari sumber lain tidak ditampilkan sebagai kontribusi donatur, dan kontribusi tanpa detail donatur tetap ditandai tidak tercatat. Alokasi gabungan tidak menyatakan donatur tertentu membiayai penerima atau paket tertentu.";

export type DistributionActivityRecord = {
  id: string;
  institutionId: string;
  proposalId: string;
  proposalVersion: number;
  programId: string;
  /** The program's fund type, fixed when the activity is created. */
  programFundType: FundType;
  name: string;
  description: string | null;
  /** Rupiah requested by the proposal's money lines and valued goods lines. */
  targetAmount: string;
  /** True when a goods line has no rupiah valuation, so the target understates the need. */
  targetIsPartial: boolean;
  currencyUnit: CurrencyUnit;
  status: ActivityStatus;
  version: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
};

export type ContributionAllocationRecord = {
  id: string;
  institutionId: string;
  contributionId: string;
  activityId: string;
  currencyUnit: CurrencyUnit;
  amountExact: string;
  fundType: JenisDana;
  purpose: string;
  reason: string;
  status: AllocationStatus;
  allocatedAt: number;
  allocatedBy: string;
  allocatedByOfficerId: string | null;
  /** The contribution version the officer allocated against. */
  contributionVersion: number;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type AllocationHistoryRecord = {
  id: number;
  allocationId: string;
  institutionId: string;
  contributionId: string;
  activityId: string;
  version: number;
  contributionVersion: number;
  action: AllocationHistoryAction;
  actorAccount: string;
  actorOfficerId: string | null;
  fromStatus: AllocationStatus | null;
  toStatus: AllocationStatus;
  amountExact: string;
  reason: string;
  occurredAt: number;
};

export type ActivityFunding = {
  totalAllocatedAmount: string;
  unallocatedNeed: string;
  contributionCount: number;
  /** Never true for a partial or zero target: an unknown need cannot be met. */
  isFullyAllocated: boolean;
};

export type ActivitySummary = DistributionActivityRecord &
  ActivityFunding & {
    disclaimer: string;
    tracingCoverage: string;
  };

export type ContributionBalance = {
  allocatedAmount: string;
  /** What may still be allocated; zero while there is a shortfall. */
  unallocatedAmount: string;
  /** Allocations above the recorded amount after a correction; must stay visible. */
  shortfallAmount: string;
};

export type ContributionAllocationSummary = ContributionBalance & {
  contributionId: string;
  currencyUnit: CurrencyUnit;
  totalAmount: string;
};

/** Parse a positive integer amount in minor units. */
export function parseExactAmount(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    throw new ActivityRuleError("Nominal wajib berupa angka bulat tanpa desimal atau karakter pemisah.");
  }
  const parsed = BigInt(value.trim());
  if (parsed <= 0n) {
    throw new ActivityRuleError("Nominal alokasi wajib lebih dari 0.");
  }
  return parsed;
}

/** The one reading of a contribution's balance, shared by the limit check and every summary. */
export function contributionBalance(totalExact: string, allocatedExact: string): ContributionBalance {
  const total = BigInt(totalExact);
  const allocated = BigInt(allocatedExact);
  return {
    allocatedAmount: allocated.toString(),
    unallocatedAmount: (total > allocated ? total - allocated : 0n).toString(),
    shortfallAmount: (allocated > total ? allocated - total : 0n).toString(),
  };
}

/**
 * The activity's target from its proposal's aid lines. Aid lines were validated when
 * the proposal was submitted, so an unreadable amount here is corrupt data and throws.
 */
export function activityTarget(aidLines: AidLine[]): { targetAmount: string; targetIsPartial: boolean } {
  let total = 0n;
  let partial = false;
  for (const line of aidLines) {
    const idr = line.value.kind === "MONEY" ? line.value.amountRequestedIdr : goodsValuationOf(line.value);
    if (idr === null) {
      partial = true;
      continue;
    }
    if (!/^\d+$/.test(idr)) {
      throw new Error(`Rincian bantuan "${line.id}" memuat nominal yang tidak terbaca: "${idr}".`);
    }
    total += BigInt(idr);
  }
  return { targetAmount: total.toString(), targetIsPartial: partial || total === 0n };
}

export function activityFunding(
  activity: Pick<DistributionActivityRecord, "targetAmount" | "targetIsPartial">,
  allocatedExact: string,
  contributionCount: number
): ActivityFunding {
  const target = BigInt(activity.targetAmount);
  const allocated = BigInt(allocatedExact);
  return {
    totalAllocatedAmount: allocated.toString(),
    unallocatedNeed: (target > allocated ? target - allocated : 0n).toString(),
    contributionCount,
    isFullyAllocated: !activity.targetIsPartial && allocated >= target,
  };
}

/** Which contribution fund types a program of each fund type may spend. */
const SPENDABLE_BY_PROGRAM: Record<FundType, readonly JenisDana[]> = {
  ZAKAT: ["ZAKAT", "FITRAH"],
  INFAK: ["INFAK_SEDEKAH"],
  SEDEKAH: ["INFAK_SEDEKAH"],
  LAINNYA: ["KURBAN", "DSKL"],
};

/**
 * Fund type and purpose are kept from the contribution (AC09): an allocation may
 * restate them but not change them, and the activity's program must be allowed to
 * spend that fund type.
 */
export function allocationTerms(input: {
  contributionFundType: string;
  contributionPurpose: string;
  programFundType: FundType;
  requestedFundType: string | null;
  requestedPurpose: string | null;
}): { fundType: JenisDana; purpose: string } {
  const fundType = normalizeFundType(input.contributionFundType);
  if (!fundType) {
    throw new ActivityRuleError(`Jenis dana kontribusi "${input.contributionFundType}" tidak sah.`);
  }
  if (input.requestedFundType && normalizeFundType(input.requestedFundType) !== fundType) {
    throw new ActivityRuleError(
      `Jenis dana alokasi "${input.requestedFundType}" tidak selaras dengan jenis dana kontribusi "${fundType}".`
    );
  }
  if (!SPENDABLE_BY_PROGRAM[input.programFundType].includes(fundType)) {
    throw new ActivityRuleError(
      `Jenis dana kontribusi "${fundType}" tidak dapat mendanai kegiatan dari program berjenis dana "${input.programFundType}".`
    );
  }

  const contributionPurpose = input.contributionPurpose.trim();
  const requestedPurpose = (input.requestedPurpose ?? "").trim();
  if (requestedPurpose && contributionPurpose && requestedPurpose.toLowerCase() !== contributionPurpose.toLowerCase()) {
    throw new ActivityRuleError(
      `Peruntukan alokasi "${requestedPurpose}" tidak selaras dengan batasan peruntukan kontribusi "${contributionPurpose}".`
    );
  }
  return { fundType, purpose: contributionPurpose || requestedPurpose };
}

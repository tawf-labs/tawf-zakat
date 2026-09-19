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
import {
  addDecimalStrings,
  compareDecimalStrings,
  goodsValuationOf,
  subtractDecimalStrings,
  type AidLine,
  type FundType,
  type ProposalStatus,
} from "./disbursement";
import type { CurrencyUnit } from "./reconciliation";

/**
 * An activity has one state; an allocation gains `REALLOCATED` once #107 moves part or
 * all of it to another activity, and the move is recorded as a reallocation decision.
 */
export type ActivityStatus = "ACTIVE";
export type AllocationStatus = "ACTIVE" | "REALLOCATED";
export type AllocationHistoryAction = "ALLOCATE" | "REALLOCATE_OUT" | "REALLOCATE_IN";

export type ReallocationDecisionRecord = {
  id: string;
  institutionId: string;
  sourceActivityId: string;
  targetActivityId: string;
  sourceAllocationId: string;
  targetAllocationId: string;
  contributionId: string;
  amountExact: string;
  fundType: JenisDana;
  purpose: string;
  reason: string;
  decidedByAccount: string;
  decidedByOfficerId: string | null;
  sourceActivityVersion: number;
  targetActivityVersion: number;
  sourceAllocationVersion: number;
  targetAllocationVersion: number;
  occurredAt: number;
  createdAt: number;
};

export type ActivityAvailabilityStatus = "AVAILABLE" | "INDETERMINATE" | "NONE";

/** Approved, realized and remaining quantity of one aid type in one unit; never summed across units. */
export type AidUnitSummary = {
  aidType: string;
  unit: string;
  approved: string;
  realized: string;
  remaining: string;
};

export type ActivityAccountabilitySummary = {
  activityId: string;
  proposalId: string;
  proposalVersion: number;
  proposalStatus: ProposalStatus;
  /** The activity's unit; obligations are only comparable to allocations when it is IDR. */
  currencyUnit: CurrencyUnit;
  isRemainderClosed: boolean;
  totalAllocatedAmount: string;
  totalRealizedMoneyIdr: string;
  totalExpensesIdr: string;
  totalDirectExpensesIdr: string;
  totalAccountedExpensesIdr: string;
  totalAdvancesIdr: string;
  unaccountedAdvancesIdr: string;
  hasOutstandingAccountability: boolean;
  /** Approved money not yet realized: still owed to mustahik, so not available. */
  totalCommittedMoneyIdr: string;
  /** Valuation of approved goods not yet handed over: a commitment, not spare cash. */
  totalCommittedGoodsIdr: string;
  /** `totalCommittedMoneyIdr` + `totalCommittedGoodsIdr`, the whole outstanding aid commitment. */
  totalCommittedAidIdr: string;
  /** Allocations standing above what their contributions still record, after a correction (AC10). */
  totalContributionShortfall: string;
  /** What spending and commitments exceed this activity's allocation by; zero when they balance. */
  totalOverCommitmentIdr: string;
  hasUnvaluedGoods: boolean;
  unitSummaries: AidUnitSummary[];
  availabilityStatus: ActivityAvailabilityStatus;
  availableForReallocation: string;
  availabilityReason: string;
  disclaimer: string;
};

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
  sourceAllocationId?: string | null;
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
    const idr = line.value.kind === "MONEY"
      ? (line.value.amountApprovedIdr ?? line.value.amountRequestedIdr)
      : goodsValuationOf(line.value);
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
      `Jenis dana kontribusi "${fundType}" tidak kompatibel dan tidak dapat mendanai kegiatan dari program berjenis dana "${input.programFundType}".`
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

/** One realization row, reduced to what the aid-line arithmetic below actually reads. */
export type AidRealizationEntry = {
  aidLineId: string;
  amountIdr: string | null;
  quantity: string | null;
};

export type AidLineSummary = {
  totalApprovedMoneyIdr: string;
  totalRealizedMoneyIdr: string;
  /** Valuation of approved goods not yet handed over. Unvalued goods add nothing here. */
  totalCommittedGoodsIdr: string;
  /** True when a goods line carries no rupiah valuation, so the commitment is understated. */
  hasUnvaluedGoods: boolean;
  unitSummaries: AidUnitSummary[];
};

/** A decimal string as its digits and how many of them are fractional. */
function decimalParts(value: string): { digits: bigint; scale: number } {
  const [whole, fraction = ""] = value.split(".");
  return { digits: BigInt(`${whole || "0"}${fraction}`), scale: fraction.length };
}

/** `total * part / whole`, rounded down. Zero when `whole` is zero: no ratio to take. */
function prorate(total: bigint, part: string, whole: string): bigint {
  const p = decimalParts(part);
  const w = decimalParts(whole);
  const scale = Math.max(p.scale, w.scale);
  const wholeDigits = w.digits * 10n ** BigInt(scale - w.scale);
  if (wholeDigits === 0n) return 0n;
  return (total * (p.digits * 10n ** BigInt(scale - p.scale))) / wholeDigits;
}

/**
 * What a proposal's aid lines approve, what its realizations have delivered, and what
 * therefore remains committed (AC07). Money and goods are summed in rupiah only where a
 * line carries a rupiah valuation; physical quantities stay in their own units and are
 * never added to a rupiah total.
 */
export function summarizeAidLines(aidLines: AidLine[], realizations: AidRealizationEntry[]): AidLineSummary {
  const moneyLineIds = new Set<string>();
  let approvedMoney = 0n;
  let hasUnvaluedGoods = false;

  for (const line of aidLines) {
    if (line.value.kind === "MONEY") {
      moneyLineIds.add(line.id);
      const approved = line.value.amountApprovedIdr ?? line.value.amountRequestedIdr;
      if (approved && /^\d+$/.test(approved)) approvedMoney += BigInt(approved);
    } else if (goodsValuationOf(line.value) === null) {
      hasUnvaluedGoods = true;
    }
  }

  let realizedMoney = 0n;
  const realizedQuantityByLine = new Map<string, string>();
  for (const entry of realizations) {
    if (entry.amountIdr && moneyLineIds.has(entry.aidLineId)) {
      realizedMoney += BigInt(entry.amountIdr);
    }
    if (entry.quantity) {
      realizedQuantityByLine.set(
        entry.aidLineId,
        addDecimalStrings(realizedQuantityByLine.get(entry.aidLineId) ?? "0", entry.quantity)
      );
    }
  }

  let committedGoods = 0n;
  const byUnit = new Map<string, AidUnitSummary>();
  for (const line of aidLines) {
    if (line.value.kind !== "GOODS") continue;
    const approvedQty = line.value.quantityApproved ?? line.value.quantityRequested ?? "0";
    const realizedQty = realizedQuantityByLine.get(line.id) ?? "0";
    // Over-delivery leaves nothing outstanding; it never becomes a negative commitment.
    const remainingQty =
      compareDecimalStrings(approvedQty, realizedQty) > 0 ? subtractDecimalStrings(approvedQty, realizedQty) : "0";

    const valuation = goodsValuationOf(line.value);
    if (valuation !== null) {
      committedGoods += prorate(BigInt(valuation), remainingQty, approvedQty);
    }

    const unit = line.value.unit;
    const key = `${line.aidType} ${unit}`;
    const running = byUnit.get(key) ?? { aidType: line.aidType, unit, approved: "0", realized: "0", remaining: "0" };
    byUnit.set(key, {
      aidType: line.aidType,
      unit,
      approved: addDecimalStrings(running.approved, approvedQty),
      realized: addDecimalStrings(running.realized, realizedQty),
      remaining: addDecimalStrings(running.remaining, remainingQty),
    });
  }

  return {
    totalApprovedMoneyIdr: approvedMoney.toString(),
    totalRealizedMoneyIdr: realizedMoney.toString(),
    totalCommittedGoodsIdr: committedGoods.toString(),
    hasUnvaluedGoods,
    unitSummaries: [...byUnit.values()],
  };
}

/** The activity's own unit, written the way the workspace reads it. */
function formatAmount(amount: bigint, unit: CurrencyUnit): string {
  return unit === "IDR" ? `Rp${amount.toString()}` : `${amount.toString()} ${unit}`;
}

export function calculateActivityAccountability(input: {
  activityId: string;
  proposalId: string;
  proposalVersion: number;
  proposalStatus: ProposalStatus;
  currencyUnit: CurrencyUnit;
  isRemainderClosed: boolean;
  totalAllocatedAmount: string;
  totalDirectExpensesIdr: string;
  totalAccountedExpensesIdr: string;
  totalAdvancesIdr: string;
  totalContributionShortfall: string;
  aidLines: AidLineSummary;
}): ActivityAccountabilitySummary {
  const totalAllocated = BigInt(input.totalAllocatedAmount);
  const realizedMoney = BigInt(input.aidLines.totalRealizedMoneyIdr);
  const directExpenses = BigInt(input.totalDirectExpensesIdr);
  const accountedExpenses = BigInt(input.totalAccountedExpensesIdr);
  const totalExpenses = directExpenses + accountedExpenses;
  const totalAdvances = BigInt(input.totalAdvancesIdr);
  const unaccountedAdvances = totalAdvances > accountedExpenses ? totalAdvances - accountedExpenses : 0n;
  const hasOutstandingAccountability = unaccountedAdvances > 0n;
  const shortfall = BigInt(input.totalContributionShortfall);

  // Closing the remainder, or cancelling the proposal, ends the entitlement: what was
  // never handed over stops being owed. It is not itself a reallocation (AC11).
  const entitlementStillOwed = !input.isRemainderClosed && input.proposalStatus !== "CANCELLED";
  const approvedMoney = BigInt(input.aidLines.totalApprovedMoneyIdr);
  const committedMoney = entitlementStillOwed && approvedMoney > realizedMoney ? approvedMoney - realizedMoney : 0n;
  // Goods approved but not yet handed over are an obligation at their recorded valuation:
  // the rupiah behind them is spoken for even though no money has left yet (AC02, AC07).
  const committedGoods = entitlementStillOwed ? BigInt(input.aidLines.totalCommittedGoodsIdr) : 0n;
  const committedAid = committedMoney + committedGoods;
  const totalObligated = realizedMoney + totalExpenses + committedAid;
  // What this activity owes above what it holds. Non-zero means the books do not
  // balance and the gap must stay on the screen (AC05).
  const overCommitment = totalObligated > totalAllocated ? totalObligated - totalAllocated : 0n;

  let availabilityStatus: ActivityAvailabilityStatus = "NONE";
  let availableForReallocation = 0n;
  let availabilityReason = "";

  if (input.currencyUnit !== "IDR") {
    // Obligations are recorded in rupiah; an allocation in another unit cannot be
    // netted against them without inventing a rate.
    availabilityStatus = "INDETERMINATE";
    availabilityReason = `Alokasi kegiatan tercatat dalam satuan ${input.currencyUnit}, sedangkan biaya dan kewajiban bantuan tercatat dalam rupiah; ketersediaan belum dapat ditetapkan tanpa dasar konversi yang sah.`;
  } else if (hasOutstandingAccountability) {
    availabilityStatus = "INDETERMINATE";
    availabilityReason = `Terdapat sisa uang muka petugas sebesar ${formatAmount(unaccountedAdvances, input.currencyUnit)} yang belum dipertanggungjawabkan; ketersediaan dana belum dapat ditetapkan sebelum pertanggungjawaban selesai.`;
  } else if (input.aidLines.hasUnvaluedGoods && entitlementStillOwed) {
    availabilityStatus = "INDETERMINATE";
    availabilityReason =
      "Pengajuan memiliki rincian barang tanpa valuasi rupiah yang belum ditutup sisanya; estimasi kewajiban belum lengkap sehingga ketersediaan belum dapat ditetapkan.";
  } else if (shortfall > 0n) {
    // Allocations already stand above their contributions; there is no spare rupiah to
    // move, and moving any would spend the same shortfall twice (AC10).
    availabilityStatus = "INDETERMINATE";
    availabilityReason = `Terdapat selisih ${formatAmount(shortfall, input.currencyUnit)} antara alokasi kegiatan dan nilai kontribusi yang masih tercatat setelah koreksi; selisih wajib diselesaikan sebelum ketersediaan dapat ditetapkan.`;
  } else if (overCommitment > 0n) {
    // Spending and commitments stand above what this activity holds. That is a real
    // condition, not a rounding artefact: an expense may legitimately be recorded after
    // a remainder was reallocated away. It stays visible rather than being read as a
    // tidy zero, and nothing further may leave until the institution settles it.
    availabilityStatus = "INDETERMINATE";
    availabilityReason = `Pengeluaran dan kewajiban kegiatan melampaui dana teralokasi sebesar ${formatAmount(overCommitment, input.currencyUnit)}; kelebihan ini wajib ditelaah lembaga sebelum ketersediaan dapat ditetapkan.`;
  } else {
    if (totalAllocated > totalObligated) {
      availableForReallocation = totalAllocated - totalObligated;
      availabilityStatus = "AVAILABLE";
      availabilityReason = input.isRemainderClosed
        ? `Sisa dana ${formatAmount(availableForReallocation, input.currencyUnit)} tersedia setelah penutupan sisa pengajuan dan seluruh beban biaya/realisasi dihitung.`
        : `Dana berlebih ${formatAmount(availableForReallocation, input.currencyUnit)} tersedia di atas seluruh alokasi hak dan pengeluaran kegiatan.`;
    } else {
      availabilityStatus = "NONE";
      availabilityReason =
        "Seluruh dana teralokasi telah terserap untuk realisasi, biaya operasional, atau terikat hak bantuan mustahik yang belum diserahkan.";
    }
  }

  return {
    activityId: input.activityId,
    proposalId: input.proposalId,
    proposalVersion: input.proposalVersion,
    proposalStatus: input.proposalStatus,
    currencyUnit: input.currencyUnit,
    isRemainderClosed: input.isRemainderClosed,
    totalAllocatedAmount: totalAllocated.toString(),
    totalRealizedMoneyIdr: realizedMoney.toString(),
    totalExpensesIdr: totalExpenses.toString(),
    totalDirectExpensesIdr: directExpenses.toString(),
    totalAccountedExpensesIdr: accountedExpenses.toString(),
    totalAdvancesIdr: totalAdvances.toString(),
    unaccountedAdvancesIdr: unaccountedAdvances.toString(),
    hasOutstandingAccountability,
    totalCommittedMoneyIdr: committedMoney.toString(),
    totalCommittedGoodsIdr: committedGoods.toString(),
    totalCommittedAidIdr: committedAid.toString(),
    totalContributionShortfall: shortfall.toString(),
    totalOverCommitmentIdr: overCommitment.toString(),
    hasUnvaluedGoods: input.aidLines.hasUnvaluedGoods,
    unitSummaries: input.aidLines.unitSummaries,
    availabilityStatus,
    availableForReallocation: availableForReallocation.toString(),
    availabilityReason,
    disclaimer: FUNDING_RECORD_DISCLAIMER,
  };
}


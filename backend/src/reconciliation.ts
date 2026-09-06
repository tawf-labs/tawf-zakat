/**
 * Reconciliation Engine v0 - pure core (Spec #55).
 *
 * Takes two sides of a ledger - a *claim* (the figures somebody reported) and a
 * *source* (the records underneath them) - and returns every point where they
 * disagree, together with the entry that caused it.
 *
 * This module is deliberately free of database, store, viem and network imports:
 * both reconciliation modes (antar-lembaga and internal) share this one core.
 */

export type CurrencyUnit = "IDR" | "USDC_6DP";

export type Money = { amount: bigint; unit: CurrencyUnit };

export type BalanceSheetPosition = "ON" | "OFF";

export type LedgerEntry = {
  key: string; // identitas entri: kode PZ, txHash+logIndex, atau trxId
  bucket: string; // jenis dana / kategori
  balanceSheet: BalanceSheetPosition;
  value: Money;
  label?: string; // nama Pengelola Zakat / deskripsi, untuk ditampilkan
};

export type LedgerSide = {
  label: string;
  entries: LedgerEntry[];
  declaredTotals?: LedgerEntry[]; // total yang diklaim, untuk diuji terhadap jumlah entri
};

export type ReportingPeriod = { kind: "SEMESTER" | "AKHIR_TAHUN"; year: number };

export type ReconciliationOptions = {
  period: ReportingPeriod;
  tolerance?: Money; // default: nol, cocok persis
  /**
   * Bucket dimension the two sides are expressed in. Defaults to the five jenis
   * dana of PerBAZNAS 1/2023; callers reconciling another dimension (jenis
   * Pengelola Zakat, internal ledger streams) declare it explicitly.
   */
  allowedBuckets?: readonly string[];
  /**
   * Restricts the reconciliation to one balance sheet position. Funds on and off
   * the balance sheet are reconciled separately so that a gap on one side can
   * never be cancelled out by a gap on the other.
   */
  balanceSheet?: BalanceSheetPosition;
};

export type DiscrepancyKind =
  | "MISSING_IN_CLAIM"
  | "MISSING_IN_SOURCE"
  | "AMOUNT_MISMATCH"
  | "BUCKET_TOTAL_MISMATCH"
  | "GRAND_TOTAL_MISMATCH"
  | "DUPLICATE_KEY";

export type Discrepancy = {
  kind: DiscrepancyKind;
  key: string;
  bucket: string;
  /**
   * Always signed. For the entry-level kinds it reads claim minus source. For
   * the total-integrity kinds, which live inside one side, it reads the total a
   * side declared minus the sum of that side's own entries - so `claimValue` is
   * the declared total and `sourceValue` is what its detail actually adds up to.
   */
  delta: Money;
  claimValue?: Money;
  sourceValue?: Money;
  label?: string;
};

export type ReconciliationReport = {
  balanced: boolean;
  period: ReportingPeriod;
  claimLabel: string;
  sourceLabel: string;
  netDelta: Money;
  absoluteDelta: Money;
  discrepancies: Discrepancy[]; // urut: |delta| menurun, lalu key menaik
  entryCounts: { claim: number; source: number; matched: number };
};

/** Jenis dana per PerBAZNAS 1/2023 - the default bucket dimension. */
export const JENIS_DANA = ["ZAKAT", "FITRAH", "INFAK_SEDEKAH", "KURBAN", "DSKL"] as const;

/** Reserved bucket naming a side's declared grand total. */
export const GRAND_TOTAL_BUCKET = "GRAND_TOTAL";

/**
 * Kinds that describe a single entry differing between the two sides. Their
 * deltas add up to `netDelta`; the remaining kinds are integrity findings about
 * one side's own arithmetic and are reported without entering the totals.
 */
export const ENTRY_LEVEL_KINDS: readonly DiscrepancyKind[] = [
  "AMOUNT_MISMATCH",
  "MISSING_IN_CLAIM",
  "MISSING_IN_SOURCE",
];

export function isEntryLevelKind(kind: DiscrepancyKind): boolean {
  return ENTRY_LEVEL_KINDS.includes(kind);
}

/** Thrown when a caller hands the engine data it refuses to reconcile. */
export class ReconciliationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconciliationInputError";
  }
}

type SideRole = "claim" | "source";

type MatchKey = string;

const matchKeyOf = (entry: LedgerEntry): MatchKey =>
  [entry.key, entry.bucket, entry.balanceSheet].join("|");

const abs = (value: bigint): bigint => (value < 0n ? -value : value);

export const money = (amount: bigint, unit: CurrencyUnit): Money => ({ amount, unit });

function rowLocation(
  side: LedgerSide,
  role: SideRole,
  index: number,
  key: string,
  isTotal: boolean
): string {
  const what = isTotal ? "total yang dideklarasikan" : "entri";
  const sideName = role === "claim" ? "klaim" : "sumber";
  return `${side.label} (sisi ${sideName}): ${what} pada index ${index}, key "${key}"`;
}

function validateSide(
  side: LedgerSide,
  role: SideRole,
  allowedBuckets: readonly string[],
  unitSoFar: CurrencyUnit | null
): CurrencyUnit | null {
  let unit = unitSoFar;

  const rows: Array<{ entry: LedgerEntry; index: number; isTotal: boolean }> = [
    ...side.entries.map((entry, index) => ({ entry, index, isTotal: false })),
    ...(side.declaredTotals ?? []).map((entry, index) => ({ entry, index, isTotal: true })),
  ];

  for (const { entry, index, isTotal } of rows) {
    const where = rowLocation(side, role, index, entry.key ?? "", isTotal);

    if (typeof entry.key !== "string" || entry.key.trim() === "") {
      throw new ReconciliationInputError(`${where} tidak memiliki key.`);
    }
    if (entry.balanceSheet !== "ON" && entry.balanceSheet !== "OFF") {
      throw new ReconciliationInputError(
        `${where} memakai posisi neraca tidak dikenal: "${String(entry.balanceSheet)}". Gunakan "ON" atau "OFF".`
      );
    }

    const bucketAllowed =
      allowedBuckets.includes(entry.bucket) || (isTotal && entry.bucket === GRAND_TOTAL_BUCKET);
    if (!bucketAllowed) {
      throw new ReconciliationInputError(
        `${where} memakai jenis dana tidak dikenal: "${String(entry.bucket)}". ` +
          `Yang dikenal: ${allowedBuckets.join(", ")}.`
      );
    }

    if (!entry.value || typeof entry.value.amount !== "bigint") {
      throw new ReconciliationInputError(`${where} tidak memiliki jumlah berupa bilangan bulat.`);
    }
    if (entry.value.amount < 0n) {
      throw new ReconciliationInputError(
        `${where} memiliki jumlah negatif: ${entry.value.amount.toString()}.`
      );
    }
    if (entry.value.unit !== "IDR" && entry.value.unit !== "USDC_6DP") {
      throw new ReconciliationInputError(
        `${where} memakai unit tidak dikenal: "${String(entry.value.unit)}".`
      );
    }

    if (unit === null) {
      unit = entry.value.unit;
    } else if (entry.value.unit !== unit) {
      throw new ReconciliationInputError(
        `${where} memakai unit "${entry.value.unit}" sedangkan rekonsiliasi ini memakai unit "${unit}". ` +
          `Satuan mata uang tidak pernah dikonversi diam-diam - rekonsiliasikan tiap unit secara terpisah.`
      );
    }
  }

  return unit;
}

type SideIndex = {
  firstByMatchKey: Map<MatchKey, LedgerEntry>;
  duplicates: Discrepancy[];
};

function indexSide(side: LedgerSide, role: SideRole, unit: CurrencyUnit): SideIndex {
  const first = new Map<MatchKey, LedgerEntry>();
  const extras = new Map<MatchKey, { entry: LedgerEntry; extra: bigint }>();

  for (const entry of side.entries) {
    const id = matchKeyOf(entry);
    if (!first.has(id)) {
      first.set(id, entry);
      continue;
    }
    // A repeated key is never silently summed into the matched value; the surplus
    // is reported on its own so double counting stays visible.
    const seen = extras.get(id);
    extras.set(id, {
      entry: seen?.entry ?? entry,
      extra: (seen?.extra ?? 0n) + entry.value.amount,
    });
  }

  const duplicates: Discrepancy[] = [];
  for (const [id, { entry, extra }] of extras) {
    const kept = first.get(id)!;
    const signedExtra = role === "claim" ? extra : -extra;
    duplicates.push({
      kind: "DUPLICATE_KEY",
      key: entry.key,
      bucket: entry.bucket,
      delta: money(signedExtra, unit),
      ...(role === "claim" ? { claimValue: kept.value } : { sourceValue: kept.value }),
      label: entry.label ?? side.label,
    });
  }

  return { firstByMatchKey: first, duplicates };
}

function scopeToBalanceSheet(
  side: LedgerSide,
  position: BalanceSheetPosition | undefined
): LedgerSide {
  if (!position) return side;
  return {
    label: side.label,
    entries: side.entries.filter((entry) => entry.balanceSheet === position),
    ...(side.declaredTotals
      ? { declaredTotals: side.declaredTotals.filter((total) => total.balanceSheet === position) }
      : {}),
  };
}

/**
 * Checks a side's own arithmetic: does each declared total equal the sum of the
 * entries underneath it? Sums use the deduplicated entries, so a key repeated on
 * one side cannot quietly make a declared total look right.
 */
function totalIntegrityDiscrepancies(
  side: LedgerSide,
  index: SideIndex,
  unit: CurrencyUnit,
  isMaterial: (delta: bigint) => boolean
): Discrepancy[] {
  if (!side.declaredTotals || side.declaredTotals.length === 0) return [];

  const byBucket = new Map<string, bigint>();
  const byPosition = new Map<BalanceSheetPosition, bigint>();

  for (const entry of index.firstByMatchKey.values()) {
    const bucketId = `${entry.bucket}|${entry.balanceSheet}`;
    byBucket.set(bucketId, (byBucket.get(bucketId) ?? 0n) + entry.value.amount);
    byPosition.set(
      entry.balanceSheet,
      (byPosition.get(entry.balanceSheet) ?? 0n) + entry.value.amount
    );
  }

  const findings: Discrepancy[] = [];

  for (const declared of side.declaredTotals) {
    const isGrandTotal = declared.bucket === GRAND_TOTAL_BUCKET;
    const computed = isGrandTotal
      ? byPosition.get(declared.balanceSheet) ?? 0n
      : byBucket.get(`${declared.bucket}|${declared.balanceSheet}`) ?? 0n;

    const delta = declared.value.amount - computed;
    if (!isMaterial(delta)) continue;

    findings.push({
      kind: isGrandTotal ? "GRAND_TOTAL_MISMATCH" : "BUCKET_TOTAL_MISMATCH",
      key: declared.key,
      bucket: declared.bucket,
      delta: money(delta, unit),
      claimValue: declared.value,
      sourceValue: money(computed, unit),
      label: declared.label ?? side.label,
    });
  }

  return findings;
}

/** Key of the finding that compares the two sides' own printed grand totals. */
export const crossSideGrandTotalKey = (position: BalanceSheetPosition): string =>
  `GRAND_TOTAL:${position}`;

const declaredGrandTotals = (side: LedgerSide): Map<BalanceSheetPosition, LedgerEntry> => {
  const totals = new Map<BalanceSheetPosition, LedgerEntry>();
  for (const declared of side.declaredTotals ?? []) {
    if (declared.bucket !== GRAND_TOTAL_BUCKET) continue;
    if (!totals.has(declared.balanceSheet)) totals.set(declared.balanceSheet, declared);
  }
  return totals;
};

/**
 * Compares the grand total each side prints for itself.
 *
 * This is the only comparison that survives when the two sides are cut along
 * different dimensions - one per jenis dana, the other per jenis Pengelola
 * Zakat - and so no single entry can be matched against another. It is reported
 * per balance sheet position, and kept out of `netDelta` because the entries
 * underneath those totals are already counted there.
 */
function crossSideGrandTotalDiscrepancies(
  claim: LedgerSide,
  source: LedgerSide,
  unit: CurrencyUnit,
  isMaterial: (delta: bigint) => boolean
): Discrepancy[] {
  const claimTotals = declaredGrandTotals(claim);
  const sourceTotals = declaredGrandTotals(source);
  const findings: Discrepancy[] = [];

  for (const position of ["ON", "OFF"] as const) {
    const claimTotal = claimTotals.get(position);
    const sourceTotal = sourceTotals.get(position);
    if (!claimTotal || !sourceTotal) continue;

    const delta = claimTotal.value.amount - sourceTotal.value.amount;
    if (!isMaterial(delta)) continue;

    findings.push({
      kind: "GRAND_TOTAL_MISMATCH",
      key: crossSideGrandTotalKey(position),
      bucket: GRAND_TOTAL_BUCKET,
      delta: money(delta, unit),
      claimValue: claimTotal.value,
      sourceValue: sourceTotal.value,
      label: `${claim.label} vs ${source.label}`,
    });
  }

  return findings;
}

function compareDiscrepancies(a: Discrepancy, b: Discrepancy): number {
  const magnitudeA = abs(a.delta.amount);
  const magnitudeB = abs(b.delta.amount);
  if (magnitudeA !== magnitudeB) return magnitudeA > magnitudeB ? -1 : 1;
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  if (a.bucket !== b.bucket) return a.bucket < b.bucket ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return 0;
}

export function reconcile(
  claim: LedgerSide,
  source: LedgerSide,
  options: ReconciliationOptions
): ReconciliationReport {
  const allowedBuckets = options.allowedBuckets ?? JENIS_DANA;

  let unit = validateSide(claim, "claim", allowedBuckets, null);
  unit = validateSide(source, "source", allowedBuckets, unit);
  const reportUnit: CurrencyUnit = unit ?? "IDR";

  if (options.tolerance && options.tolerance.unit !== reportUnit) {
    throw new ReconciliationInputError(
      `Toleransi memakai unit "${options.tolerance.unit}" sedangkan data memakai unit "${reportUnit}".`
    );
  }
  if (options.tolerance && options.tolerance.amount < 0n) {
    throw new ReconciliationInputError("Toleransi tidak boleh negatif.");
  }
  const tolerance = options.tolerance?.amount ?? 0n;
  const isMaterial = (delta: bigint): boolean => delta !== 0n && abs(delta) >= tolerance;

  const scopedClaim = scopeToBalanceSheet(claim, options.balanceSheet);
  const scopedSource = scopeToBalanceSheet(source, options.balanceSheet);

  const claimIndex = indexSide(scopedClaim, "claim", reportUnit);
  const sourceIndex = indexSide(scopedSource, "source", reportUnit);

  const discrepancies: Discrepancy[] = [
    ...claimIndex.duplicates,
    ...sourceIndex.duplicates,
    ...totalIntegrityDiscrepancies(scopedClaim, claimIndex, reportUnit, isMaterial),
    ...totalIntegrityDiscrepancies(scopedSource, sourceIndex, reportUnit, isMaterial),
    ...crossSideGrandTotalDiscrepancies(scopedClaim, scopedSource, reportUnit, isMaterial),
  ];
  let matched = 0;

  for (const [id, claimEntry] of claimIndex.firstByMatchKey) {
    const sourceEntry = sourceIndex.firstByMatchKey.get(id);

    if (!sourceEntry) {
      const delta = claimEntry.value.amount;
      if (isMaterial(delta)) {
        discrepancies.push({
          kind: "MISSING_IN_SOURCE",
          key: claimEntry.key,
          bucket: claimEntry.bucket,
          delta: money(delta, reportUnit),
          claimValue: claimEntry.value,
          ...(claimEntry.label ? { label: claimEntry.label } : {}),
        });
      }
      continue;
    }

    matched++;
    const delta = claimEntry.value.amount - sourceEntry.value.amount;
    if (isMaterial(delta)) {
      const label = claimEntry.label ?? sourceEntry.label;
      discrepancies.push({
        kind: "AMOUNT_MISMATCH",
        key: claimEntry.key,
        bucket: claimEntry.bucket,
        delta: money(delta, reportUnit),
        claimValue: claimEntry.value,
        sourceValue: sourceEntry.value,
        ...(label ? { label } : {}),
      });
    }
  }

  for (const [id, sourceEntry] of sourceIndex.firstByMatchKey) {
    if (claimIndex.firstByMatchKey.has(id)) continue;
    const delta = -sourceEntry.value.amount;
    if (isMaterial(delta)) {
      discrepancies.push({
        kind: "MISSING_IN_CLAIM",
        key: sourceEntry.key,
        bucket: sourceEntry.bucket,
        delta: money(delta, reportUnit),
        sourceValue: sourceEntry.value,
        ...(sourceEntry.label ? { label: sourceEntry.label } : {}),
      });
    }
  }

  discrepancies.sort(compareDiscrepancies);

  let netDelta = 0n;
  let absoluteDelta = 0n;
  for (const discrepancy of discrepancies) {
    if (!isEntryLevelKind(discrepancy.kind)) continue;
    netDelta += discrepancy.delta.amount;
    absoluteDelta += abs(discrepancy.delta.amount);
  }

  return {
    balanced: discrepancies.length === 0,
    period: options.period,
    claimLabel: claim.label,
    sourceLabel: source.label,
    netDelta: money(netDelta, reportUnit),
    absoluteDelta: money(absoluteDelta, reportUnit),
    discrepancies,
    entryCounts: {
      claim: scopedClaim.entries.length,
      source: scopedSource.entries.length,
      matched,
    },
  };
}

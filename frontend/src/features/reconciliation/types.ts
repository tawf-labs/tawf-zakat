/**
 * Wire shapes of the Reconciliation Engine (backend spec #55).
 *
 * Money crosses the wire as a decimal string so that trillion-scale rupiah
 * survives JSON without ever touching a float.
 */

export type CurrencyUnit = "IDR" | "USDC_6DP";

export type WireMoney = { amount: string; unit: CurrencyUnit };

export type BalanceSheetPosition = "ON" | "OFF";

export type WireLedgerEntry = {
  key: string;
  bucket: string;
  balanceSheet: BalanceSheetPosition;
  value: WireMoney;
  label?: string;
};

export type WireLedgerSide = {
  label: string;
  entries: WireLedgerEntry[];
  declaredTotals?: WireLedgerEntry[];
};

export type ReportingPeriod = { kind: "SEMESTER" | "AKHIR_TAHUN"; year: number };

export type DiscrepancyKind =
  | "MISSING_IN_CLAIM"
  | "MISSING_IN_SOURCE"
  | "AMOUNT_MISMATCH"
  | "BUCKET_TOTAL_MISMATCH"
  | "GRAND_TOTAL_MISMATCH"
  | "DUPLICATE_KEY";

export type WireDiscrepancy = {
  kind: DiscrepancyKind;
  key: string;
  bucket: string;
  delta: WireMoney;
  claimValue?: WireMoney;
  sourceValue?: WireMoney;
  label?: string;
};

export type ReconciliationReport = {
  balanced: boolean;
  period: ReportingPeriod;
  claimLabel: string;
  sourceLabel: string;
  netDelta: WireMoney;
  absoluteDelta: WireMoney;
  discrepancies: WireDiscrepancy[];
  entryCounts: { claim: number; source: number; matched: number };
};

export type InternalReconciliationResponse = {
  success: boolean;
  lastIndexedBlock: number;
  blockRange: { fromBlock: number; toBlock: number };
  indexerStatus?: string;
  reports: Record<CurrencyUnit, ReconciliationReport>;
};

export const GRAND_TOTAL_BUCKET = "GRAND_TOTAL";

/** Kinds that compare one entry across the two sides. */
export const ENTRY_LEVEL_KINDS: DiscrepancyKind[] = [
  "AMOUNT_MISMATCH",
  "MISSING_IN_CLAIM",
  "MISSING_IN_SOURCE",
];

export const isEntryLevelKind = (kind: DiscrepancyKind): boolean =>
  ENTRY_LEVEL_KINDS.includes(kind);

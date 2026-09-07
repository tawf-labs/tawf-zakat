/**
 * Presentation helpers for reconciliation figures.
 *
 * The digit-level rendering lives in `lib/reporting`, shared with the period
 * report slice; what stays here is the reconciliation vocabulary built on top.
 */

import { formatQuantity } from "../../lib/reporting";
import type { DiscrepancyKind, WireMoney } from "./types";

export const formatMoney = (money: WireMoney): string => formatQuantity(money);

/** Signed rendering, so the direction of a gap is never ambiguous. */
export function formatSignedMoney(money: WireMoney): string {
  const sign = money.amount.startsWith("-") ? "-" : "+";
  const magnitude = money.amount.replace(/^-/, "");
  if (magnitude === "0") return formatMoney({ ...money, amount: "0" });
  return `${sign}${formatMoney({ ...money, amount: magnitude })}`;
}

export const absoluteAmount = (amount: string): string => amount.replace(/^-/, "");

export const DISCREPANCY_LABELS: Record<DiscrepancyKind, string> = {
  AMOUNT_MISMATCH: "Nilai berbeda",
  MISSING_IN_CLAIM: "Tidak ada di rekap",
  MISSING_IN_SOURCE: "Tidak ada laporannya",
  BUCKET_TOTAL_MISMATCH: "Total jenis dana tidak cocok",
  GRAND_TOTAL_MISMATCH: "Grand total tidak cocok",
  DUPLICATE_KEY: "Tercatat dua kali",
};

export const DISCREPANCY_EXPLANATIONS: Record<DiscrepancyKind, string> = {
  AMOUNT_MISMATCH: "Entri ada di kedua sisi, tetapi nilainya berbeda.",
  MISSING_IN_CLAIM: "Pengelola Zakat ini melapor, tetapi tidak ada di rekap Anda.",
  MISSING_IN_SOURCE: "Ada di rekap Anda, tetapi tidak ada laporan yang mendasarinya.",
  BUCKET_TOTAL_MISMATCH: "Total satu jenis dana tidak sama dengan jumlah entrinya.",
  GRAND_TOTAL_MISMATCH: "Grand total tidak sama dengan jumlah seluruh entri.",
  DUPLICATE_KEY: "Satu Pengelola Zakat muncul lebih dari sekali di sisi yang sama.",
};

export const BUCKET_LABELS: Record<string, string> = {
  ZAKAT: "Zakat Mal",
  FITRAH: "Zakat Fitrah",
  INFAK_SEDEKAH: "Infak/Sedekah",
  KURBAN: "Kurban",
  DSKL: "Dana Sosial Keagamaan Lainnya",
  GRAND_TOTAL: "Grand Total",
  MERKLE_BATCH: "Batch Merkle",
  DONASI_FIAT: "Donasi fiat dalam batch",
  PROPOSAL: "Proposal penyaluran",
  DISBURSEMENT: "Penyaluran tereksekusi",
};

export const bucketLabel = (bucket: string): string =>
  BUCKET_LABELS[bucket] ?? bucket.replace(/_/g, " ");

export const BALANCE_SHEET_LABELS: Record<string, string> = {
  ON: "On balance sheet",
  OFF: "Off balance sheet",
};

/** Which side a gap leans towards, in the Amil's own words. */
export function deltaDirection(kind: DiscrepancyKind, amount: string): string {
  if (amount === "0") return "Seimbang";
  const claimIsBigger = !amount.startsWith("-");
  if (kind === "BUCKET_TOTAL_MISMATCH" || kind === "GRAND_TOTAL_MISMATCH") {
    return claimIsBigger ? "Total lebih besar dari rinciannya" : "Total lebih kecil dari rinciannya";
  }
  return claimIsBigger ? "Rekap lebih besar" : "Laporan lebih besar";
}

/**
 * Turning a verdict into what the Amil reads.
 *
 * Pure and free of React, so the two things that matter most about this screen
 * can be tested without rendering anything: that a rejection names the figure,
 * the value claimed and the value it should have been - never a generic
 * message - and that a draft which did not pass offers no way to sign it.
 */

import { formatQuantity } from "../../lib/reporting";
import type { FindingKind, WireFinding, WireQuantity, WireVerdict } from "./types";

const FINDING_LABELS: Record<FindingKind, string> = {
  KLAIM_TIDAK_COCOK: "Angka tidak cocok dengan ledger",
  KLAIM_TIDAK_TERBACA: "Angka ditulis dalam bentuk yang tidak bisa dibaca",
  KLAIM_TIDAK_DIKENAL: "Angka tidak ada dalam laporan periode ini",
  KLAIM_GANDA: "Satu angka diklaim lebih dari sekali",
  ANGKA_NARASI_TIDAK_DIKLAIM: "Narasi menyebut angka yang tidak diklaim",
  PLAFON_HAK_AMIL_TERLAMPAUI: "Porsi hak amil melampaui plafon 12,5%",
};

/** The fallback is not dead code: the wire is untrusted and may name a kind this build has never heard of. */
export const findingLabel = (kind: FindingKind): string => FINDING_LABELS[kind] ?? kind;

export function verdictHeadline(verdict: WireVerdict): string {
  if (verdict.outcome === "LOLOS") {
    return "Lolos. Setiap angka di dalam draf ini cocok dengan ledger.";
  }
  // Deliberately "temuan", not "angka": a finding can be an unclaimed figure in
  // the narrative or the hak amil ceiling, neither of which is a claimed number.
  const count = verdict.findings.length;
  return `Ditolak. ${count} temuan yang harus diperbaiki sebelum laporan ini bisa ditandatangani.`;
}

/**
 * Whether a signature may be offered at all.
 *
 * A rejected draft has no path to a signature - no override, no dismissible
 * warning, no "lanjutkan saja". The outcome and the findings must also agree,
 * so a malformed response cannot open a door the validator meant to keep shut.
 */
export const canSign = (verdict: WireVerdict | null): boolean =>
  verdict !== null && verdict.outcome === "LOLOS" && verdict.findings.length === 0;

export type DescribedFinding = {
  kind: FindingKind;
  label: string;
  figureName: string | null;
  message: string;
  claimed: string | null;
  expected: string | null;
  excerpt: string | null;
};

const render = (quantity: WireQuantity | undefined): string | null =>
  quantity ? formatQuantity(quantity) : null;

export function describeFinding(finding: WireFinding): DescribedFinding {
  return {
    kind: finding.kind,
    label: findingLabel(finding.kind),
    figureName: finding.figureName,
    // The server's sentence already names the figure and both values; repeating
    // it here in different words would only invite the two to drift apart.
    message: finding.message,
    claimed: render(finding.claimed),
    expected: render(finding.expected),
    excerpt: finding.excerpt ?? null,
  };
}

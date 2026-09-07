/**
 * Draft validator (Spec #61) - the rule that cannot be talked round.
 *
 * It takes the period figures and a draft, and returns a verdict. It is a pure
 * function: no model, no network, no clock, no randomness. Whoever wrote the
 * draft - a person, a model, a script - is not part of its input, because who
 * wrote it has never been what makes a number true.
 *
 * Three checks, all deterministic:
 *
 * 1. **Claim match.** Every claimed figure must exist and must equal the
 *    computed figure exactly, unit included. There is no rounding tolerance; a
 *    zakat report does not do "about".
 * 2. **Narrative leak.** Every rupiah-shaped number written into the narrative
 *    must appear among the claims that passed check 1. This is what catches an
 *    invented figure smuggled into the middle of a sentence.
 * 3. **Invariant.** The hak amil share must not exceed the 12,5% ceiling the
 *    contract locks - checked against the ledger, so a draft cannot pass by
 *    reporting a violation accurately.
 *
 * The verdict is pass or reject. There is no warning level: a draft is either
 * signable or it is not, and a warning is only a reject somebody talks past.
 */

import type { FigureUnit, FigureValue, PeriodFigures } from "./period-report";

/**
 * A claim as the draft stated it. `value: null` carries a draft that stated an
 * amount which is not a whole number at all - "100.000.000" rather than
 * "100000000". That is a rejection, not a lost draft: silently reinterpreting
 * the digits would be the system inventing the very figure it exists to check.
 */
export type DraftClaim =
  | { name: string; value: FigureValue; statedAmount?: undefined }
  | { name: string; value: null; statedAmount: string };

export type ReportDraft = {
  /** Named figures the draft asserts. Checked one by one. */
  claims: DraftClaim[];
  /** Indonesian prose a human will read. Scanned for unclaimed rupiah. */
  narrative: string;
};

/** Ordered by how the findings are presented, which also fixes their sort. */
export const FINDING_KINDS = [
  "KLAIM_TIDAK_COCOK",
  "KLAIM_TIDAK_TERBACA",
  "KLAIM_TIDAK_DIKENAL",
  "KLAIM_GANDA",
  "ANGKA_NARASI_TIDAK_DIKLAIM",
  "PLAFON_HAK_AMIL_TERLAMPAUI",
  "SUMBER_TIDAK_TERSEDIA",
] as const;

export type FindingKind = (typeof FINDING_KINDS)[number];

export type Finding = {
  kind: FindingKind;
  /** The figure at fault, or null when the narrative named no figure at all. */
  figureName: string | null;
  message: string;
  claimed?: FigureValue;
  expected?: FigureValue;
  excerpt?: string;
};

export type Verdict = { outcome: "LOLOS" | "DITOLAK"; findings: Finding[] };

export type RupiahMention = { excerpt: string; amount: bigint };

/**
 * Rupiah as this report writes it: an `Rp` prefix, digits grouped in thousands,
 * or a run of digits the sentence itself calls rupiah. A bare `2026` is a year
 * and a `12,5%` is a ratio, so neither is treated as money.
 *
 * The grouped-digits branch stops short of a duration word. Period figures now
 * include stage durations in hours, so `1.200 jam` is a number the report is
 * entitled to state and rejecting it as unclaimed rupiah would be the validator
 * refusing a true figure. An `Rp` prefix still wins over the exception, because
 * a sentence that says rupiah means rupiah whatever follows it.
 */
const RUPIAH_PATTERN =
  /Rp\.?\s*\d[\d.]*|\b\d{1,3}(?:\.\d{3})+\b|\b\d+(?=\s*(?:rupiah|IDR)\b)/gi;

export function rupiahMentions(narrative: string): RupiahMention[] {
  const mentions: RupiahMention[] = [];
  for (const match of narrative.matchAll(RUPIAH_PATTERN)) {
    // Inspect the suffix after matching the full number, so the regex cannot
    // backtrack into a shorter thousands group and mistake it for rupiah.
    const suffix = narrative.slice(match.index! + match[0].length);
    if (!/^Rp/i.test(match[0]) && /^\s*(?:jam|hari)\b/i.test(suffix)) continue;
    const excerpt = match[0].replace(/\.$/, "");
    const digits = excerpt.replace(/[^\d]/g, "");
    if (digits === "") continue;
    mentions.push({ excerpt, amount: BigInt(digits) });
  }
  return mentions;
}

const UNIT_LABELS: Record<FigureUnit, string> = {
  IDR: "rupiah",
  USDC_6DP: "USDC (satuan minor 6 desimal)",
  BPS: "basis poin",
  COUNT: "transaksi",
  JAM: "jam",
};

/** Groups digits the Indonesian way, straight from the integer. */
export function formatAmount(amount: bigint): string {
  const sign = amount < 0n ? "-" : "";
  const digits = (amount < 0n ? -amount : amount).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

const describe = (value: FigureValue): string =>
  `${formatAmount(value.amount)} ${UNIT_LABELS[value.unit]}`;

const sameValue = (a: FigureValue, b: FigureValue): boolean =>
  a.unit === b.unit && a.amount === b.amount;

export function validateDraft(figures: Pick<PeriodFigures, "figures"> & { amilShare: PeriodFigures["amilShare"] | null }, draft: ReportDraft): Verdict {
  const findings: Finding[] = [];
  const known = new Map(figures.figures.map((item) => [item.name, item]));

  // 1. Claim match. Only claims that survive this may license a narrative number.
  //
  // Claims are grouped by name before anything is judged, so a figure claimed
  // twice yields one finding about the name rather than a finding about
  // whichever copy happened to arrive first: the verdict must not depend on the
  // order the claims were written in.
  const byName = new Map<string, DraftClaim[]>();
  for (const claim of draft.claims) {
    byName.set(claim.name, [...(byName.get(claim.name) ?? []), claim]);
  }

  const passedRupiah = new Set<bigint>();

  for (const [name, claims] of byName) {
    const expected = known.get(name);

    if (!expected) {
      findings.push({
        kind: "KLAIM_TIDAK_DIKENAL",
        figureName: name,
        message:
          `Draf mengklaim angka "${name}" yang tidak ada di dalam laporan periode ini. ` +
          `Hanya angka yang dihitung sistem yang boleh diklaim.`,
      });
      continue;
    }

    if (claims.length > 1) {
      findings.push({
        kind: "KLAIM_GANDA",
        figureName: name,
        message:
          `Angka "${expected.label}" diklaim ${claims.length} kali di dalam draf yang sama, ` +
          `sehingga tidak ada satu nilai yang bisa diperiksa.`,
        expected: expected.value,
      });
      continue;
    }

    const claim = claims[0]!;

    if (claim.value === null) {
      findings.push({
        kind: "KLAIM_TIDAK_TERBACA",
        figureName: name,
        message:
          `Angka "${expected.label}" diklaim sebagai "${claim.statedAmount}", yang bukan bilangan ` +
          `bulat sehingga tidak bisa dicocokkan. Tulis nilainya sebagai digit penuh tanpa titik.`,
        expected: expected.value,
        excerpt: claim.statedAmount,
      });
      continue;
    }

    if (!sameValue(claim.value, expected.value)) {
      findings.push({
        kind: "KLAIM_TIDAK_COCOK",
        figureName: name,
        message:
          `Angka "${expected.label}" diklaim ${describe(claim.value)}, ` +
          `sedangkan hitungan dari ledger adalah ${describe(expected.value)}.`,
        claimed: claim.value,
        expected: expected.value,
      });
      continue;
    }

    if (claim.value.unit === "IDR") passedRupiah.add(claim.value.amount);
  }

  // 2. Narrative leak.
  for (const mention of rupiahMentions(draft.narrative)) {
    if (passedRupiah.has(mention.amount)) continue;
    findings.push({
      kind: "ANGKA_NARASI_TIDAK_DIKLAIM",
      figureName: null,
      message:
        `Narasi menyebut ${formatAmount(mention.amount)} rupiah, tetapi angka itu tidak ada ` +
        `di dalam daftar klaim yang lolos pemeriksaan.`,
      excerpt: mention.excerpt,
    });
  }

  // 3. Invariant, read off the ledger rather than off the draft.
  const { amilShare } = figures;
  if (amilShare && !amilShare.withinCeiling) {
    findings.push({
      kind: "PLAFON_HAK_AMIL_TERLAMPAUI",
      figureName: "hak_amil.porsi_idr",
      message:
        `Porsi hak amil ${describe(amilShare.actual)} melampaui plafon 12,5% sebesar ` +
        `${describe(amilShare.ceiling)} atas pengumpulan ${describe(amilShare.collected)}.`,
      claimed: amilShare.actual,
      expected: amilShare.ceiling,
    });
  }

  return { outcome: findings.length === 0 ? "LOLOS" : "DITOLAK", findings: sortFindings(findings) };
}

/** A fixed order, so the same inputs read back the same however they arrived. */
function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const byKind = FINDING_KINDS.indexOf(a.kind) - FINDING_KINDS.indexOf(b.kind);
    if (byKind !== 0) return byKind;
    const byName = (a.figureName ?? "").localeCompare(b.figureName ?? "");
    if (byName !== 0) return byName;
    return (a.excerpt ?? "").localeCompare(b.excerpt ?? "");
  });
}

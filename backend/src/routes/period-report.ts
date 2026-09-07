/**
 * Period report routes (Spec #61) - mounted as its own module under
 * /api/period-report, deliberately outside the monolithic route file.
 *
 * Stateless: nothing is written, no table is added, no migration is run. The
 * ledger rows are read, the figures are computed, a draft is put through the
 * validator, and the verdict goes back.
 *
 * Two ways in, one rule. `/verify` judges a draft the caller wrote; `/draft`
 * asks the model to write one first. Either way the figures are computed before
 * the draft exists and the validator has the last word - the difference between
 * the two routes is only who holds the pen, which is precisely what the verdict
 * does not depend on.
 *
 * Decoding and encoding live in `../wire`, shared with the reconciliation route.
 */

import { Hono } from "hono";
import {
  computePeriodFigures,
  FIGURE_UNITS,
  type Figure,
  type FigureValue,
  type PeriodFigures,
} from "../period-report";
import { draftReport } from "../report-drafter";
import {
  validateDraft,
  type DraftClaim,
  type Finding,
  type ReportDraft,
  type Verdict,
} from "../report-validator";
import {
  asRecord,
  fail,
  parseQuantity,
  parseReportingPeriod,
  serializeQuantity,
  WireInputError,
} from "../wire";
import { dbService } from "../db/index";
import type { ReportingPeriod } from "../reconciliation";

const parseFigureValue = (raw: unknown, where: string): FigureValue =>
  parseQuantity(raw, where, FIGURE_UNITS, "IDR");

function parseClaim(raw: unknown, index: number): DraftClaim {
  const record = asRecord(raw, `Klaim pada index ${index}`);
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (name === "") fail(`Klaim pada index ${index} tidak menyebut nama angka.`);
  return { name, value: parseFigureValue(record.value, `Klaim "${name}"`) };
}

function parseDraft(raw: unknown): ReportDraft {
  const record = asRecord(raw, "Draf laporan");
  if (!Array.isArray(record.claims)) {
    fail("Draf laporan tidak memiliki daftar klaim. Kirim `claims` sebagai daftar.");
  }
  if (record.narrative !== undefined && typeof record.narrative !== "string") {
    fail("Narasi draf harus berupa teks.");
  }
  return {
    claims: record.claims.map(parseClaim),
    narrative: (record.narrative as string | undefined) ?? "",
  };
}

const serializeFigure = (figure: Figure) => ({
  name: figure.name,
  label: figure.label,
  value: serializeQuantity(figure.value),
});

export function serializeFigures(figures: PeriodFigures) {
  return {
    period: figures.period,
    figures: figures.figures.map(serializeFigure),
    collection: figures.collection.map(serializeFigure),
    distribution: figures.distribution.map(serializeFigure),
    amilShare: {
      withinCeiling: figures.amilShare.withinCeiling,
      collected: serializeQuantity(figures.amilShare.collected),
      ceiling: serializeQuantity(figures.amilShare.ceiling),
      actual: serializeQuantity(figures.amilShare.actual),
      ceilingRatio: serializeQuantity(figures.amilShare.ceilingRatio),
      actualRatio: serializeQuantity(figures.amilShare.actualRatio),
    },
    attestations: figures.attestations,
    notes: figures.notes,
  };
}

const serializeFinding = (finding: Finding) => ({
  kind: finding.kind,
  figureName: finding.figureName,
  message: finding.message,
  ...(finding.claimed ? { claimed: serializeQuantity(finding.claimed) } : {}),
  ...(finding.expected ? { expected: serializeQuantity(finding.expected) } : {}),
  ...(finding.excerpt !== undefined ? { excerpt: finding.excerpt } : {}),
});

export const serializeVerdict = (verdict: Verdict) => ({
  outcome: verdict.outcome,
  findings: verdict.findings.map(serializeFinding),
});

export const serializeDraft = (draft: ReportDraft) => ({
  claims: draft.claims.map((claim) =>
    claim.value === null
      ? { name: claim.name, value: null, statedAmount: claim.statedAmount }
      : { name: claim.name, value: serializeQuantity(claim.value) }
  ),
  narrative: draft.narrative,
});

/** Reads the ledger and computes the period's figures. Shared by both routes. */
async function periodFiguresFor(period: ReportingPeriod): Promise<PeriodFigures> {
  const [donationRows, proposalRows] = await Promise.all([
    dbService.getDonationRows(),
    dbService.getProposalRows(),
  ]);
  return computePeriodFigures({ donations: donationRows, proposals: proposalRows }, period);
}

/**
 * The one response shape both routes return. Figures always stand; a draft and
 * its verdict appear together or not at all, and when there is no draft the
 * reason is stated rather than left as a silent null.
 */
export function periodReportBody(
  figures: PeriodFigures,
  draft: ReportDraft | null,
  unavailable: string | null
) {
  return {
    success: true,
    period: figures.period,
    figures: serializeFigures(figures),
    // A rejected draft is returned with its reasons rather than hidden: the
    // reader is entitled to see what was refused and why.
    draft: draft ? serializeDraft(draft) : null,
    verdict: draft ? serializeVerdict(validateDraft(figures, draft)) : null,
    ...(unavailable ? { draftUnavailable: unavailable } : {}),
  };
}

/** Decodes a request body down to its reporting period. */
async function readPeriod(c: any): Promise<ReportingPeriod> {
  const body = asRecord(await c.req.json(), "Badan permintaan");
  return parseReportingPeriod(body.period, "Periode pelaporan");
}

const badRequest = (c: any, message: string) => c.json({ success: false, error: message }, 400);
const serverError = (c: any, error: any) =>
  c.json({ success: false, error: error?.message || "Laporan periode gagal dihitung." }, 500);

const periodReportRoutes = new Hono();

periodReportRoutes.post("/verify", async (c) => {
  let period: ReportingPeriod;
  let draft: ReportDraft | null;
  try {
    const payload = asRecord(await c.req.json(), "Badan permintaan");
    period = parseReportingPeriod(payload.period, "Periode pelaporan");
    draft = payload.draft === undefined || payload.draft === null ? null : parseDraft(payload.draft);
  } catch (error: unknown) {
    if (error instanceof WireInputError) return badRequest(c, error.message);
    return badRequest(c, "Badan permintaan bukan JSON yang sah.");
  }

  try {
    const figures = await periodFiguresFor(period);
    return c.json(
      periodReportBody(
        figures,
        draft,
        draft ? null : "Tidak ada draf yang dikirim, sehingga tidak ada vonis."
      )
    );
  } catch (error: any) {
    return serverError(c, error);
  }
});

// The model writes the draft, the validator judges it, and the caller sees both.
// A drafting failure never fails this request: the figures were computed from the
// ledger before the model was asked, and they stand whether or not it answered.
periodReportRoutes.post("/draft", async (c) => {
  let period: ReportingPeriod;
  try {
    period = await readPeriod(c);
  } catch (error: unknown) {
    if (error instanceof WireInputError) return badRequest(c, error.message);
    return badRequest(c, "Badan permintaan bukan JSON yang sah.");
  }

  try {
    const figures = await periodFiguresFor(period);
    const attempt = await draftReport(figures);
    return c.json(periodReportBody(figures, attempt.draft, attempt.unavailable));
  } catch (error: any) {
    return serverError(c, error);
  }
});

export default periodReportRoutes;

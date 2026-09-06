/**
 * Period report routes (Spec #61) - mounted as its own module under
 * /api/period-report, deliberately outside the monolithic route file.
 *
 * Stateless: nothing is written, no table is added, no migration is run. The
 * ledger rows are read, the figures are computed, the draft the caller sent is
 * put through the validator, and the verdict goes back. A draft is optional -
 * without one the figures still stand on their own, which is what keeps the
 * report useful when the drafting step (ticket #63) has nothing to offer.
 *
 * Decoding and encoding live in `../wire`, shared with the reconciliation route.
 */

import { Hono } from "hono";
import {
  computePeriodFigures,
  type Figure,
  type FigureUnit,
  type FigureValue,
  type PeriodFigures,
} from "../period-report";
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

const FIGURE_UNITS: readonly FigureUnit[] = ["IDR", "USDC_6DP", "BPS", "COUNT"];

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
  claims: draft.claims.map((claim) => ({ name: claim.name, value: serializeQuantity(claim.value) })),
  narrative: draft.narrative,
});

const periodReportRoutes = new Hono();

periodReportRoutes.post("/verify", async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Badan permintaan bukan JSON yang sah." }, 400);
  }

  let period: ReturnType<typeof parseReportingPeriod>;
  let draft: ReportDraft | null;
  try {
    const body = asRecord(payload, "Badan permintaan");
    period = parseReportingPeriod(body.period, "Periode pelaporan");
    draft = body.draft === undefined || body.draft === null ? null : parseDraft(body.draft);
  } catch (error: any) {
    if (error instanceof WireInputError) {
      return c.json({ success: false, error: error.message }, 400);
    }
    throw error;
  }

  try {
    const [donationRows, proposalRows] = await Promise.all([
      dbService.getDonationRows(),
      dbService.getProposalRows(),
    ]);

    const figures = computePeriodFigures(
      { donations: donationRows, proposals: proposalRows },
      period
    );

    return c.json({
      success: true,
      period,
      figures: serializeFigures(figures),
      draft: draft ? serializeDraft(draft) : null,
      verdict: draft ? serializeVerdict(validateDraft(figures, draft)) : null,
      ...(draft ? {} : { draftUnavailable: "Tidak ada draf yang dikirim, sehingga tidak ada vonis." }),
    });
  } catch (error: any) {
    return c.json(
      { success: false, error: error?.message || "Laporan periode gagal dihitung." },
      500
    );
  }
});

export default periodReportRoutes;

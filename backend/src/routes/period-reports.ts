/**
 * Laporan periode dari data aplikasi (ADR-0043, #130).
 *
 *   GET  /api/evidence/period-reports           one summary per period, for the list
 *   GET  /api/evidence/period-reports/preview   step 2: what the app holds for a period
 *   POST /api/evidence/period-reports           step 2: lock that data as a snapshot
 *
 * The staff flow asks only for a period and a cut-off. The label, currency, balance
 * sheet scope and tolerance are the flow's own; both sides come from one read of the
 * realization stream (`withoutBookkeeping`), and the freeze goes through the same
 * pipeline as every other preparation. The pasted and uploaded sources stay on
 * `POST /api/evidence`, outside this flow.
 */

import { Hono, type Context } from "hono";
import { authenticateWorkspace, badRequest, refuse } from "../workspace-session";
import { authorize } from "../tenancy";
import { PERIOD_KINDS } from "../wire";
import type { ReportingPeriod } from "../reconciliation";
import { buildDisbursementRealizationSide, type RealizationScope } from "../realization-source";
import { readRealizationRecords } from "../realization-read";
import {
  NOT_COMPARED_NOTE,
  periodReportLabel,
  previewOf,
  summarizePeriodReports,
  withoutBookkeeping,
} from "../period-report-flow";
import {
  executeFreezeAndStorePreparation,
  readJson,
  runtimeWithStore,
  unconfigured,
  type EvidenceRuntime,
} from "./evidence-preparation";

const routes = new Hono();

const READ_FAILED =
  "Data penyaluran tidak dapat dibaca dari penyimpanan, sehingga data laporan belum dikunci. Coba lagi atau hubungi operator.";

/** The period and cut-off a request names, or the reason it cannot be used. */
function readScope(raw: { kind: unknown; year: unknown; cutOff: unknown }, now: number): { period: ReportingPeriod; cutOff: string } | string {
  if (!PERIOD_KINDS.includes(raw.kind as ReportingPeriod["kind"])) return "Pilih periode: Semester I atau Akhir tahun.";
  const year = Number(raw.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return "Tahun laporan harus antara 2000 dan 2100.";
  let cutOff = new Date(now * 1000).toISOString();
  if (raw.cutOff !== undefined && raw.cutOff !== null && raw.cutOff !== "") {
    const at = typeof raw.cutOff === "string" ? Date.parse(raw.cutOff) : NaN;
    if (!Number.isFinite(at)) return "Batas data harus berupa tanggal dan jam yang sah.";
    // A cut-off still ahead would name data the snapshot cannot have seen.
    if (Math.floor(at / 1000) > now) return "Batas data tidak boleh sesudah saat ini.";
    cutOff = new Date(at).toISOString();
  }
  return { period: { kind: raw.kind as ReportingPeriod["kind"], year }, cutOff };
}

async function scopeOf(runtime: EvidenceRuntime, institutionId: string, period: ReportingPeriod, cutOff: string): Promise<RealizationScope | null> {
  const institution = await runtime.store.getInstitution(institutionId);
  if (!institution) return null;
  return {
    institution: { id: institutionId, legalName: institution.legalName, scopeUnit: institution.scopeUnit, scopeLevel: institution.scopeLevel },
    period,
    cutOff,
    balanceSheetScope: "ON",
  };
}

async function signedIn(c: Context) {
  const runtime = runtimeWithStore(c);
  if (runtime instanceof Response) return runtime;
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;
  return { runtime, auth };
}

routes.get("/", async (c) => {
  const session = await signedIn(c);
  if (session instanceof Response) return session;
  const { runtime, auth } = session;
  const institutionId = auth.session.institutionId;

  const rows = await runtime.evidence.listPeriodReportRows(institutionId);
  // Publication is read from the locks a confirmed publication leaves (#129); with no
  // disbursement store there are no such reports, and so nothing is published.
  const locks = runtime.disbursement ? await runtime.disbursement.listPeriodLocks(institutionId) : [];
  return c.json({ success: true, reports: summarizePeriodReports({ ...rows, locks }) });
});

routes.get("/preview", async (c) => {
  const session = await signedIn(c);
  if (session instanceof Response) return session;
  const { runtime, auth } = session;
  if (!runtime.disbursement) return unconfigured(c, "Penyimpanan realisasi penyaluran");

  const asked = readScope({ kind: c.req.query("periodKind"), year: c.req.query("year"), cutOff: c.req.query("cutOff") }, runtime.now());
  if (typeof asked === "string") return badRequest(c, asked);
  const scope = await scopeOf(runtime, auth.session.institutionId, asked.period, asked.cutOff);
  if (!scope) return refuse(c, 404, "not-found");

  const read = await readRealizationRecords(runtime.disbursement, runtime.activities, auth.session.institutionId);
  if (!read.ok) return c.json({ success: false, error: READ_FAILED }, 503);
  const built = buildDisbursementRealizationSide({ ...scope, role: "SOURCE", ...read.data, activityTrace: read.activityTrace });
  return c.json({ success: true, preview: previewOf(built.side, built.provenance) });
});

routes.post("/", async (c) => {
  const runtime = runtimeWithStore(c);
  if (runtime instanceof Response) return runtime;
  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");
  const auth = await authenticateWorkspace(c, runtime, typeof body.institutionId === "string" ? body.institutionId : undefined);
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "prepareEvidence")) return refuse(c, 403, "forbidden");
  if (!runtime.disbursement) return unconfigured(c, "Penyimpanan realisasi penyaluran");

  const period = typeof body.period === "object" && body.period !== null ? (body.period as Record<string, unknown>) : {};
  const asked = readScope({ kind: period.kind, year: period.year, cutOff: body.cutOff }, runtime.now());
  if (typeof asked === "string") return badRequest(c, asked);
  const scope = await scopeOf(runtime, auth.session.institutionId, asked.period, asked.cutOff);
  if (!scope) return refuse(c, 404, "not-found");

  // One read for both sides: two reads could see different records and report the
  // gap between two moments as a difference between two ledgers.
  const read = await readRealizationRecords(runtime.disbursement, runtime.activities, auth.session.institutionId);
  if (!read.ok) return c.json({ success: false, error: READ_FAILED }, 503);
  const records = { ...read.data, activityTrace: read.activityTrace };
  const source = buildDisbursementRealizationSide({ ...scope, role: "SOURCE", ...records });
  const claim = buildDisbursementRealizationSide({ ...scope, role: "CLAIM", ...records });

  return executeFreezeAndStorePreparation(
    c,
    runtime,
    auth,
    {
      label: periodReportLabel(asked.period),
      period: asked.period,
      currencyUnit: "IDR",
      balanceSheetScope: "ON",
      tolerance: { amount: "0", unit: "IDR" },
    },
    withoutBookkeeping(claim.side),
    source.side,
    [claim.provenanceFile, source.provenanceFile],
    null,
    [NOT_COMPARED_NOTE, ...source.coverageNotes]
  );
});

export default routes;

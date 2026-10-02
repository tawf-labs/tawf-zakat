/**
 * Laporan periode dari data aplikasi (ADR-0043, #130).
 *
 *   GET  /api/evidence/period-reports           one summary per period, for the list
 *   GET  /api/evidence/period-reports/preview   step 2: what the app holds for a period
 *   POST /api/evidence/period-reports           step 2: lock that data as a snapshot
 *   GET  /api/evidence/period-reports/:id/report            step 4: figures, limits, identity
 *   POST /api/evidence/period-reports/:id/report            step 4: write and check; freeze when it passes
 *   POST /api/evidence/period-reports/:id/report/narrative  step 4: a narrative suggestion from AI
 *
 * Step 5 publishes the frozen package through the existing publication relay
 * (`/api/evidence/:id/reports/:packageId/publication`); nothing about signing is new.
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
  nextVersion,
  periodReportId,
  periodReportLabel,
  previewOf,
  staffReasons,
  summarizePeriodReports,
  withoutBookkeeping,
} from "../period-report-flow";
import { createReportPackages, PackageError } from "../report-package";
import { withRegistryRead } from "../registry-read";
import { PUBLISH_ACTION } from "../report-history";
import { draftReport } from "../report-drafter";
import { DISBURSEMENT_REALIZATION_FORMAT } from "../realization-source";
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

// ---------------------------------------------------------------------------
// Langkah 4–5: tinjau, tulis, periksa (#131)
// ---------------------------------------------------------------------------

class RegistryUnreadable extends Error {
  constructor() { super("Riwayat terbit laporan belum dapat dibaca dari registry. Coba lagi sebentar lagi."); }
}

/**
 * What step 4 works from: the preparation's own review, and the identity the report
 * takes - its id from the period, its version and predecessor from the registry's
 * official line. Without a registry the first version is assumed and publication is
 * said to be unavailable, rather than a version being invented from local rows.
 */
async function reportMaterial(runtime: EvidenceRuntime, institutionId: string, preparationId: string) {
  const record = await runtime.evidence.getPreparation(institutionId, preparationId);
  if (!record) throw new PackageError("Data laporan tidak ditemukan.", 404);
  const period = { kind: record.periodKind, year: record.periodYear } as ReportingPeriod;
  const reportId = periodReportId(period);
  let identity: { version: string; predecessor: string | null };
  if (runtime.registry) {
    let official;
    try {
      official = await withRegistryRead(runtime.registry.chain, (chain) => chain.officialLine(institutionId, reportId));
    } catch (error) {
      console.error("[period-reports] official line read failed", error);
      throw new RegistryUnreadable();
    }
    identity = nextVersion(official);
  } else {
    identity = { version: "1", predecessor: null };
  }
  const packages = createReportPackages(runtime.evidence, runtime.files, runtime.reportAmilRules);
  const review = await packages.review(institutionId, preparationId);
  const claim = record.sides.find((side) => side.role === "CLAIM")?.manifest;
  return {
    record, period, packages, review,
    identity: { reportId, ...identity },
    comparedWithBookkeeping: !(claim?.origin === "INTERNAL_LEDGER" && claim.format === DISBURSEMENT_REALIZATION_FORMAT),
  };
}

/** A frozen package of this preparation that passed and carries this identity, preferring one already being published. */
async function readyPackage(runtime: EvidenceRuntime, material: Awaited<ReturnType<typeof reportMaterial>>, institutionId: string) {
  const { packages, record, identity } = material;
  const ready = [];
  for (const { id } of await packages.list(institutionId, record.id)) {
    const body = await packages.read(institutionId, record.id, id);
    if (body.status === "FROZEN" && body.verdict.outcome === "LOLOS" && body.reportId === identity.reportId
      && body.version === identity.version && (body.predecessor ?? null) === identity.predecessor) ready.push(body);
  }
  if (runtime.registry) {
    for (const body of ready) {
      const intents = await runtime.registry.store.list(institutionId, body.id);
      if (intents.some((intent) => intent.authorization.action === PUBLISH_ACTION)) return body;
    }
  }
  return ready[0] ?? null;
}

async function officer(c: Context) {
  const runtime = runtimeWithStore(c);
  if (runtime instanceof Response) return runtime;
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;
  // The same rule as the report package routes: packages are written by officers.
  if (auth.session.role !== "OFFICER") return refuse(c, 403, "forbidden");
  return { runtime, auth };
}

const failed = (c: Context, error: unknown) => {
  if (error instanceof PackageError) return c.json({ success: false, error: error.message }, error.status);
  if (error instanceof RegistryUnreadable) return c.json({ success: false, error: error.message }, 503);
  console.error("[period-reports] report step failed", error);
  return c.json({ success: false, error: "Laporan tidak dapat diproses. Coba lagi; bila tetap gagal, hubungi operator." }, 500);
};

routes.get("/:preparationId/report", async (c) => {
  const session = await signedIn(c);
  if (session instanceof Response) return session;
  const { runtime, auth } = session;
  try {
    const material = await reportMaterial(runtime, auth.session.institutionId, c.req.param("preparationId"));
    const ready = await readyPackage(runtime, material, auth.session.institutionId);
    return c.json({
      success: true,
      period: material.period,
      identity: material.identity,
      correctionRequired: material.identity.predecessor !== null,
      comparedWithBookkeeping: material.comparedWithBookkeeping,
      figures: material.review.figures,
      limitations: material.review.limitations,
      blockers: material.review.blockers,
      publicationAvailable: Boolean(runtime.registry),
      ready,
    });
  } catch (error) {
    return failed(c, error);
  }
});

routes.post("/:preparationId/report", async (c) => {
  const session = await officer(c);
  if (session instanceof Response) return session;
  const { runtime, auth } = session;
  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");
  const narrative = typeof body.narrative === "string" ? body.narrative.trim() : "";
  if (!narrative) return badRequest(c, "Tulis narasi laporan terlebih dahulu.");
  if (body.disclosed !== true) return badRequest(c, "Centang pernyataan bahwa seluruh sumber dan batas pemeriksaan disertakan dalam laporan.");
  const institutionId = auth.session.institutionId;
  try {
    const material = await reportMaterial(runtime, institutionId, c.req.param("preparationId"));
    const reason = typeof body.correctionReason === "string" ? body.correctionReason.trim() : "";
    if (material.identity.predecessor && !reason) return badRequest(c, "Laporan ini sudah pernah terbit. Tulis alasan koreksi.");
    // Every figure is claimed exactly as computed: staff write words, never numbers.
    const saved = await material.packages.prepare(institutionId, material.record.id, {
      reportId: material.identity.reportId,
      version: material.identity.version,
      predecessor: material.identity.predecessor,
      correctionReason: material.identity.predecessor ? reason : null,
      mode: "HUMAN",
      draft: {
        narrative,
        claims: material.review.figures.map((figure: { name: string; value: { amount: string; unit: string } }) => ({
          name: figure.name, amount: figure.value.amount, unit: figure.value.unit,
        })),
      },
      disclosure: material.review.disclosure,
    });
    const result = saved.verdict.outcome === "LOLOS" ? await material.packages.freeze(institutionId, material.record.id, saved.id) : saved;
    return c.json({ success: true, package: result, reasons: staffReasons(result.verdict) }, 201);
  } catch (error) {
    return failed(c, error);
  }
});

routes.post("/:preparationId/report/narrative", async (c) => {
  const session = await officer(c);
  if (session instanceof Response) return session;
  const { runtime, auth } = session;
  try {
    const material = await reportMaterial(runtime, auth.session.institutionId, c.req.param("preparationId"));
    const attempt = await draftReport({
      period: material.period,
      figures: material.review.figures,
      notes: [...material.review.limitations, "Semua angka wajib tercantum dalam claims. Laporkan selisih tanpa menyatakan sumber seimbang."],
    });
    return attempt.draft
      ? c.json({ success: true, narrative: attempt.draft.narrative })
      : c.json({ success: false, error: "Bantuan AI sedang tidak tersedia. Tulis narasi sendiri; angka laporan tidak terpengaruh." }, 503);
  } catch (error) {
    return failed(c, error);
  }
});

export default routes;

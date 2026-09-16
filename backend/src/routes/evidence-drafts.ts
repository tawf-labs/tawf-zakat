/**
 * Bringing a report source in, before anything is frozen (Spec #86, ticket #88).
 *
 *   GET    /api/evidence/template            the versioned XLSX / CSV template
 *   POST   /api/evidence/preview             read an uploaded workbook, keep nothing
 *   GET    /api/evidence/drafts              what this institution is still working on
 *   POST   /api/evidence/drafts              keep a draft, including what is wrong with it
 *   GET    /api/evidence/drafts/:id          reopen one, with its rows read back
 *   DELETE /api/evidence/drafts/:id          discard one
 *   POST   /api/evidence/drafts/:id/freeze   turn a clean draft into a preparation
 *
 * A draft is working material, and this router exists because working material has
 * different rules from a frozen package - but not looser ones:
 *
 * - **Errors block freezing, never saving.** An officer keeps a draft together with
 *   its broken rows; what they may not do is call it a snapshot ready to examine.
 * - **A draft's documents are restricted documents.** The workbook and every
 *   attachment go into the encrypted store, and this router hands back a name, a
 *   size and a hash - never the bytes, never the locator.
 * - **Freezing goes through the one pipeline.** `evidence-preparation` freezes both
 *   sides here exactly as it does for a preparation posted directly, so the two
 *   paths cannot drift into disagreeing about what a snapshot is.
 *
 * Reading the workbook itself is `source-import`'s job, not this file's.
 */

import { Hono } from "hono";
import {
  DraftDocumentError,
  draftView,
  keepDraftDocument,
  previewOf,
  readDraftDocument,
  readTabularSource,
  readUpload,
} from "../source-import";
import {
  generateSourceCsvTemplate,
  generateSourceXlsxTemplate,
  sourceTemplateFileName,
} from "../source-template-generator";
import {
  checkAgreement,
  executeFreezeAndStorePreparation,
  issue,
  newId,
  readFiles,
  readHeader,
  readJson,
  runtimeWithStore,
  text,
  unconfigured,
  type SubmittedFile,
} from "./evidence-preparation";
import { normalizeSide, type ManifestPosition, type SourceIssue, type SubmittedSide } from "../evidence-source";
import type { CurrencyUnit, ReportingPeriod } from "../reconciliation";
import { authenticateWorkspace, badRequest, refuse } from "../workspace-session";
import { authorize } from "../tenancy";
import { DraftConflictError, type DraftDocument, type DraftSourceData, type StoredDraft } from "../evidence-store";

const draftRoutes = new Hono();


/**
 * The versioned template, to the officers of one institution.
 *
 * Authenticated like every other route here. The template is not a secret, but a
 * download that needs no session is a download the workspace cannot account for,
 * and this router has no unauthenticated path on purpose.
 */
draftRoutes.get("/template", async (c) => {
  const runtime = runtimeWithStore(c);
  if (runtime instanceof Response) return runtime;

  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  const format = (c.req.query("format") || "xlsx").toLowerCase() === "csv" ? "csv" : "xlsx";
  const disposition = `attachment; filename="${sourceTemplateFileName(format)}"`;

  if (format === "csv") {
    return c.body(generateSourceCsvTemplate(), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": disposition,
      "Cache-Control": "no-cache",
    });
  }

  return c.body(generateSourceXlsxTemplate() as unknown as ArrayBuffer, 200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": disposition,
    "Cache-Control": "no-cache",
  });
});

/**
 * Reading an uploaded workbook without keeping anything.
 *
 * Preparing evidence is a write in every sense that matters - it reads the
 * institution's own figures and it processes an uploaded file - so it takes the
 * same authority as preparing one. A reader may look at what has been prepared;
 * they do not feed files into the pipeline.
 */
draftRoutes.post("/preview", async (c) => {
  const runtime = runtimeWithStore(c);
  if (runtime instanceof Response) return runtime;

  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const auth = await authenticateWorkspace(
    c,
    runtime,
    typeof body.institutionId === "string" ? body.institutionId : undefined
  );
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "prepareEvidence")) return refuse(c, 403, "forbidden");

  const upload = readUpload(body);
  if (!upload) {
    return badRequest(c, 'Badan permintaan harus memuat "fileName" dan "contentBase64".');
  }

  const headerIssues: SourceIssue[] = [];
  const header = readHeader(
    {
      label: text(body.label) || "Pratinjau Sumber Laporan",
      period: body.period,
      currencyUnit: body.currencyUnit,
      balanceSheetScope: body.balanceSheetScope,
    },
    headerIssues
  );
  // The preview validates rows against a period, a unit and a balance-sheet scope.
  // Inventing those would make the preview answer about a preparation nobody asked
  // for, so the caller states them, exactly as they will when freezing.
  if (!header) {
    return c.json(
      {
        success: false,
        error:
          "Pratinjau memerlukan periode, unit mata uang, dan cakupan posisi neraca yang sama " +
          "dengan persiapannya. Cakupan sumber tidak ditebak dari berkas.",
        issues: headerIssues,
      },
      400
    );
  }

  const issues: SourceIssue[] = [];
  const read = readTabularSource(
    upload,
    auth.session.institutionId,
    typeof body.manifest === "object" && body.manifest !== null
      ? (body.manifest as Record<string, unknown>)
      : null,
    header.period,
    header.currencyUnit,
    header.balanceSheetScope,
    new Date(runtime.now() * 1000).toISOString(),
    issues
  );

  if (!read) {
    return c.json(
      {
        success: false,
        error: issues.map((found) => found.message).join("; ") || "Berkas tabular tidak dapat dibaca.",
        issues,
      },
      400
    );
  }

  // Broken rows are an answer, not an error: the preview reports every row it read,
  // the count that is calculable and the count that is not.
  return c.json({ success: true, ...previewOf(read), manifest: read.side.manifest });
});

draftRoutes.get("/drafts", async (c) => {
  const runtime = runtimeWithStore(c);
  if (runtime instanceof Response) return runtime;

  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  const drafts = await runtime.evidence.listDrafts(auth.session.institutionId);
  return c.json({ success: true, drafts });
});

/**
 * Keeping a draft, including everything wrong with it.
 *
 * Two refusals hold this route together:
 *
 * - **A document is kept where documents are kept.** The workbook and any
 *   attachment go into the encrypted store (`evidence-files.ts`) and this row keeps
 *   their locators. Without a configured key there is nowhere private to put them,
 *   so the draft is refused rather than written to a text column in the clear.
 * - **A save that did not land is not a save.** A colliding id belonging to another
 *   institution writes nothing, and the caller is told so instead of being handed
 *   back the draft it sent.
 */
draftRoutes.post("/drafts", async (c) => {
  const runtime = runtimeWithStore(c);
  if (runtime instanceof Response) return runtime;

  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const auth = await authenticateWorkspace(
    c,
    runtime,
    typeof body.institutionId === "string" ? body.institutionId : undefined
  );
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "prepareEvidence")) return refuse(c, 403, "forbidden");

  const id = text(body.id) || newId("draft");
  const label = text(body.label) || "Draf Sumber Laporan";
  const periodRecord =
    typeof body.period === "object" && body.period !== null ? (body.period as Record<string, unknown>) : {};
  const periodKind = text(periodRecord.kind) || "SEMESTER";
  const periodYear = Number(periodRecord.year) || new Date(runtime.now() * 1000).getUTCFullYear();
  const currencyUnit = text(body.currencyUnit) || "IDR";
  const balanceSheetScope = text(body.balanceSheetScope) || "BOTH";
  const tolerance =
    typeof body.tolerance === "object" && body.tolerance !== null
      ? text((body.tolerance as Record<string, unknown>).amount)
      : text(body.tolerance) || "0";

  const issues: SourceIssue[] = Array.isArray(body.issues) ? (body.issues as SourceIssue[]) : [];

  const existing = await runtime.evidence.getDraft(auth.session.institutionId, id);
  const upload = readUpload(body.sourceTable);
  const attachments = readFiles(body.files, issues);

  if ((upload || attachments.length > 0) && !runtime.files) {
    return unconfigured(c, "Penyimpanan dokumen terbatas (EVIDENCE_FILE_KEY)");
  }

  let sourceData: DraftSourceData | null = null;
  const documents: DraftDocument[] = [];
  try {
    sourceData =
      typeof body.source === "object" && body.source !== null
        ? { side: body.source as Record<string, unknown> }
        : null;

    if (upload) {
      const readIssues: SourceIssue[] = [];
      const read = readTabularSource(
        upload,
        auth.session.institutionId,
        typeof body.manifest === "object" && body.manifest !== null
          ? (body.manifest as Record<string, unknown>)
          : null,
        { kind: periodKind as ReportingPeriod["kind"], year: periodYear },
        currencyUnit as CurrencyUnit,
        balanceSheetScope as ManifestPosition,
        new Date(runtime.now() * 1000).toISOString(),
        readIssues
      );
      issues.push(...readIssues);

      // A workbook that could not be read is still worth keeping the reasons for, but
      // there is nothing to store and nothing to preview.
      if (read) {
        const kept = await keepDraftDocument(runtime.files, auth.session.institutionId, id, {
          role: "SOURCE",
          fileName: read.fileName,
          mimeType:
            read.format === "csv"
              ? "text/csv"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          bytes: read.bytes,
        }, () => newId("doc"));

        sourceData = {
          ...(sourceData ?? {}),
          tabular: kept,
          manifest: read.side.manifest as unknown as Record<string, unknown>,
          previewSummary: {
            totalRows: read.mapping.totalRows,
            validCount: read.mapping.validRowCount,
            invalidCount: read.mapping.invalidRowCount,
            isPartial: read.mapping.isPartial,
            calculableTotal: read.mapping.calculableTotal,
          },
        };
      }
    } else if (existing?.sourceData?.tabular) {
      // Saving again without re-uploading keeps the workbook already held.
      sourceData = { ...(sourceData ?? {}), ...existing.sourceData };
    }

    for (const file of attachments) {
      documents.push(await keepDraftDocument(runtime.files, auth.session.institutionId, id, file, () => newId("doc")));
    }
  } catch (error) {
    // A document that did not land leaves no locator behind, so the draft is refused
    // rather than saved pointing at a file nobody can read back.
    if (error instanceof DraftDocumentError) {
      return c.json({ success: false, error: error.message }, 503);
    }
    throw error;
  }

  const now = runtime.now();
  const draft: StoredDraft = {
    id,
    institutionId: auth.session.institutionId,
    createdBy: auth.session.account,
    label,
    periodKind,
    periodYear,
    currencyUnit,
    balanceSheetScope,
    tolerance,
    claimData:
      typeof body.claim === "object" && body.claim !== null
        ? (body.claim as Record<string, unknown>)
        : null,
    sourceData,
    files: documents.length > 0 ? documents : (existing?.files ?? []),
    issues,
    version: existing ? existing.version : 1,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };

  let stored: StoredDraft;
  try {
    stored = await runtime.evidence.saveDraft(draft);
  } catch (error) {
    if (error instanceof DraftConflictError) {
      return c.json({ success: false, error: error.message }, 409);
    }
    return c.json(
      { success: false, error: "Draf gagal disimpan. Hubungi operator basis data." },
      500
    );
  }

  return c.json({ success: true, draft: draftView(stored) }, 201);
});

draftRoutes.get("/drafts/:draftId", async (c) => {
  const runtime = runtimeWithStore(c);
  if (runtime instanceof Response) return runtime;

  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  const draft = await runtime.evidence.getDraft(auth.session.institutionId, c.req.param("draftId"));
  if (!draft) return refuse(c, 404, "not-found");

  // The preview is recomputed from the stored workbook rather than sent with it: the
  // officer needs to see the rows again, and the bytes have no business leaving the
  // restricted store to make that happen.
  let preview: ReturnType<typeof previewOf> | null = null;
  let previewUnavailable: string | null = null;
  if (draft.sourceData?.tabular) {
    const document = draft.sourceData.tabular;
    const bytes = await readDraftDocument(runtime.files, document);
    if (!bytes) {
      previewUnavailable =
        `Berkas sumber "${document.fileName}" tidak dapat dibaca kembali dari penyimpanan ` +
        `dokumen terbatas. Unggah ulang berkasnya sebelum membekukan draf ini.`;
    } else {
      const readIssues: SourceIssue[] = [];
      const read = readTabularSource(
        { fileName: document.fileName, contentBase64: Buffer.from(bytes).toString("base64") },
        auth.session.institutionId,
        (draft.sourceData.manifest as Record<string, unknown> | undefined) ?? null,
        { kind: draft.periodKind as ReportingPeriod["kind"], year: draft.periodYear },
        draft.currencyUnit as CurrencyUnit,
        draft.balanceSheetScope as ManifestPosition,
        new Date(draft.updatedAt * 1000).toISOString(),
        readIssues
      );
      preview = read ? previewOf(read) : null;
      if (!read) previewUnavailable = readIssues.map((found) => found.message).join("; ");
    }
  }

  return c.json({ success: true, draft: draftView(draft), sourcePreview: preview, previewUnavailable });
});

draftRoutes.delete("/drafts/:draftId", async (c) => {
  const runtime = runtimeWithStore(c);
  if (runtime instanceof Response) return runtime;

  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "prepareEvidence")) return refuse(c, 403, "forbidden");

  const deleted = await runtime.evidence.deleteDraft(auth.session.institutionId, c.req.param("draftId"));
  if (!deleted) return refuse(c, 404, "not-found");

  return c.json({ success: true });
});

/**
 * Freezing a draft into a preparation.
 *
 * The workbook the rows were read from is frozen with them. A snapshot that kept
 * the normalized rows but not the file they came from would leave nobody able to
 * check the mapping afterwards, which is the whole reason the source was uploaded.
 */
draftRoutes.post("/drafts/:draftId/freeze", async (c) => {
  const runtime = runtimeWithStore(c);
  if (runtime instanceof Response) return runtime;

  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "prepareEvidence")) return refuse(c, 403, "forbidden");

  const draft = await runtime.evidence.getDraft(auth.session.institutionId, c.req.param("draftId"));
  if (!draft) return refuse(c, 404, "not-found");

  const issues: SourceIssue[] = [];
  const header = readHeader(
    {
      label: draft.label,
      period: { kind: draft.periodKind, year: draft.periodYear },
      currencyUnit: draft.currencyUnit,
      balanceSheetScope: draft.balanceSheetScope,
      tolerance: draft.tolerance ? { amount: draft.tolerance, unit: draft.currencyUnit } : undefined,
    },
    issues
  );

  const claim = normalizeSide(draft.claimData, "CLAIM", auth.session.institutionId);
  issues.push(...claim.issues.map((found) => ({ ...found, side: "CLAIM" as const })));

  const files: SubmittedFile[] = [];
  for (const document of draft.files) {
    const bytes = await readDraftDocument(runtime.files, document);
    if (!bytes) {
      issues.push(
        issue(
          "files",
          `Berkas "${document.fileName}" tidak dapat dibaca kembali dari penyimpanan dokumen ` +
            `terbatas, sehingga draf ini tidak dibekukan dengan berkas yang hilang.`
        )
      );
      continue;
    }
    files.push({ role: document.role, fileName: document.fileName, mimeType: document.mimeType, bytes });
  }

  let sourceSide: SubmittedSide | null = null;
  if (draft.sourceData?.tabular) {
    const document = draft.sourceData.tabular;
    const bytes = await readDraftDocument(runtime.files, document);
    if (!bytes) {
      issues.push(
        issue(
          "source.tabular",
          `Berkas sumber "${document.fileName}" tidak dapat dibaca kembali dari penyimpanan ` +
            `dokumen terbatas. Unggah ulang berkasnya sebelum membekukan draf ini.`
        )
      );
    } else {
      const tabularIssues: SourceIssue[] = [];
      const read = readTabularSource(
        { fileName: document.fileName, contentBase64: Buffer.from(bytes).toString("base64") },
        auth.session.institutionId,
        (draft.sourceData.manifest as Record<string, unknown> | undefined) ?? null,
        { kind: draft.periodKind as ReportingPeriod["kind"], year: draft.periodYear },
        draft.currencyUnit as CurrencyUnit,
        draft.balanceSheetScope as ManifestPosition,
        new Date(draft.updatedAt * 1000).toISOString(),
        tabularIssues
      );
      issues.push(...tabularIssues.map((found) => ({ ...found, side: "SOURCE" as const })));
      if (read && read.mapping.invalidRowCount === 0 && tabularIssues.length === 0) {
        sourceSide = read.side;
        // The workbook is frozen alongside the rows it produced.
        files.push({
          role: "SOURCE",
          fileName: document.fileName,
          mimeType: document.mimeType,
          bytes,
        });
      }
    }
  } else {
    const source = normalizeSide(draft.sourceData?.side ?? null, "SOURCE", auth.session.institutionId);
    sourceSide = source.side;
    issues.push(...source.issues.map((found) => ({ ...found, side: "SOURCE" as const })));
  }

  for (const kept of draft.issues) {
    if (!issues.some((found) => found.message === kept.message && found.rowIndex === kept.rowIndex)) {
      issues.push(kept);
    }
  }

  if (header && claim.side) checkAgreement(claim.side, header, issues);
  if (header && sourceSide) checkAgreement(sourceSide, header, issues);

  if (issues.length > 0 || !header || !claim.side || !sourceSide) {
    return c.json(
      {
        success: false,
        error:
          `Draf belum dapat dibekukan: terdapat ${issues.length} hal yang perlu diperbaiki. ` +
          `Draf hanya dapat dibekukan jika tidak ada baris bermasalah.`,
        issues,
      },
      400
    );
  }

  return executeFreezeAndStorePreparation(c, runtime, auth, header, claim.side, sourceSide, files, null);
});

export default draftRoutes;

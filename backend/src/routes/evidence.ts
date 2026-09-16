/**
 * Preparing, keeping and reopening a source snapshot (Spec #68, ticket #70).
 *
 *   POST /api/evidence                  freeze two sides, reconcile, keep both
 *   GET  /api/evidence                  what this institution has prepared
 *   GET  /api/evidence/:id              reopen one, exactly as it was examined
 *   GET  /api/evidence/:id/public       the summary a public reader may see
 *   GET  /api/evidence/:id/files/:file  a restricted document, if you may have it
 *
 * Bringing a source in - the template, the preview, the private drafts - is
 * `evidence-drafts`, mounted below. The freeze pipeline both routers share is
 * `evidence-preparation`; reading an uploaded workbook is `source-import`. What
 * stays here is a preparation once it exists: posting one, listing them, and
 * reopening one.
 *
 * Four refusals worth naming, because each is a way this could quietly lie:
 *
 * - **A source that was not read is not an empty source.** A side declared
 *   MISSING or FAILED produces no reconciliation at all. The preparation is
 *   still kept - the reason is evidence too - but its outcome is `INCOMPLETE`,
 *   never a balanced report over a population nobody looked at.
 * - **A file that did not store has no identifier.** Its row says FAILED and
 *   carries the real reason. There is no synthetic CID, no optimistic
 *   "available", and the preparation says how many files are missing.
 * - **A discrepancy is not a failure to be discarded.** Findings are stored,
 *   listed and reopened; the whole point of reconciling is to keep them.
 * - **Reopening reads the snapshot, never the live ledger.** The id is a
 *   primary key. Whatever the institution's working data does afterwards, the
 *   package answers with what it was examined against.
 */

import { Hono } from "hono";
import { createRestrictedDocuments, DocumentError } from "../restricted-documents";
import { normalizeSide, type SourceIssue, type SubmittedSide } from "../evidence-source";
import { verifyCommitment } from "../evidence-snapshot";
import {
  depositCoverageNotes,
  usdcDepositClaimSide,
  usdcDepositSourceSide,
  USDC_DEPOSIT_BUCKET,
  USDC_DEPOSIT_STREAM,
  type ChainScope,
  type InternalLedgerReader,
  type InternalManifestBase,
} from "../internal-usdc-source";
import { readTabularSource, readUpload } from "../source-import";
import draftRoutes from "./evidence-drafts";
import {
  checkAgreement,
  executeFreezeAndStorePreparation,
  issue,
  readFiles,
  readHeader,
  readJson,
  restrictedView,
  runtimeWithStore,
  text,
  unconfigured,
  type Header,
  type SubmittedFile,
} from "./evidence-preparation";
import { authenticateWorkspace, badRequest, refuse } from "../workspace-session";
import { authorize } from "../tenancy";

const evidenceRoutes = new Hono();


/** What a reader is told about a file. Never where it is kept. */
async function readInternalUsdc(
  reader: InternalLedgerReader,
  base: InternalManifestBase,
  window: { fromBlock: number | null; toBlock: number | null }
): Promise<{ chainScope: ChainScope; claim: SubmittedSide; source: SubmittedSide }> {
  const scope = reader.scope();
  const checkpoint = await reader.checkpoint();

  // The chain is only examinable as far as the indexer has actually read. A
  // caller asking beyond the checkpoint is answered within it, and the scope
  // frozen into the manifest says where the examination really stopped.
  const fromBlock = Math.max(0, window.fromBlock ?? 0);
  const toBlock = Math.min(window.toBlock ?? checkpoint.lastIndexedBlock, checkpoint.lastIndexedBlock);

  const chainScope: ChainScope = {
    chainId: scope.chainId,
    contract: scope.contract,
    indexerKey: scope.indexerKey,
    fromBlock,
    toBlock,
    checkpoint,
    observed: null,
    blockHashes: "NOT_RETAINED",
  };

  const [events, ledger] = await Promise.all([
    reader.depositEvents(fromBlock, toBlock),
    reader.ledgerDeposits(),
  ]);

  return {
    chainScope,
    claim: usdcDepositClaimSide(base, chainScope, ledger),
    source: usdcDepositSourceSide(base, chainScope, events),
  };
}

/** The internal source a side asked for, or `null` when it asked for none. */
function readInternalRequest(
  raw: unknown,
  role: "CLAIM" | "SOURCE",
  issues: SourceIssue[]
): { fromBlock: number | null; toBlock: number | null } | null {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
  const internal = record?.internal;
  if (internal === undefined || internal === null) return null;

  const where = role === "CLAIM" ? "claim.internal" : "source.internal";
  const asked = typeof internal === "object" && !Array.isArray(internal)
    ? (internal as Record<string, unknown>)
    : null;
  if (!asked) {
    issues.push(issue(where, "Pilihan sumber internal harus berupa objek."));
    return null;
  }

  if (text(asked.stream) !== USDC_DEPOSIT_STREAM) {
    issues.push(
      issue(
        `${where}.stream`,
        `Sumber internal yang tersedia hanya "${USDC_DEPOSIT_STREAM}". ` +
          `Diterima: ${JSON.stringify(asked.stream)}.`
      )
    );
    return null;
  }

  const bound = (field: "fromBlock" | "toBlock"): number | null => {
    const value = asked[field];
    if (value === undefined || value === null) return null;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      issues.push(issue(`${where}.${field}`, "Batas blok harus bilangan bulat tidak negatif."));
      return null;
    }
    return value;
  };

  return { fromBlock: bound("fromBlock"), toBlock: bound("toBlock") };
}

/** The header a deposit source can be examined under, checked before any read. */
function checkInternalHeader(header: Header, issues: SourceIssue[]): void {
  if (header.currencyUnit !== "USDC_6DP") {
    issues.push(
      issue(
        "currencyUnit",
        `Sumber internal deposit USDC hanya dapat diperiksa dalam unit USDC_6DP; persiapan ini ` +
          `memakai ${header.currencyUnit}. Rupiah dan USDC tidak pernah dikonversi.`
      )
    );
  }
  if (header.balanceSheetScope !== "ON") {
    issues.push(
      issue(
        "balanceSheetScope",
        "Deposit USDC tercatat on balance sheet, sehingga cakupan pemeriksaannya harus \"ON\"."
      )
    );
  }
}

// Bringing a source in and keeping a draft is its own router, mounted here rather
// than further down: Hono matches in registration order, and "/:id" below would
// otherwise answer for "/template", "/preview" and "/drafts".
evidenceRoutes.route("/", draftRoutes);

// --------------------------------------------------------------------------
// Standard Preparation Pipeline (POST /api/evidence)
// --------------------------------------------------------------------------

evidenceRoutes.post("/", async (c) => {
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

  const issues: SourceIssue[] = [];
  const header = readHeader(body, issues);

  const internalAsked = {
    CLAIM: readInternalRequest(body.claim, "CLAIM", issues),
    SOURCE: readInternalRequest(body.source, "SOURCE", issues),
  };
  const wantsInternal = internalAsked.CLAIM !== null || internalAsked.SOURCE !== null;
  if (wantsInternal && header) checkInternalHeader(header, issues);
  if (wantsInternal && !runtime.internalLedger) {
    return unconfigured(c, "Ledger internal dan event terindeks deployment ini");
  }

  let internal: Awaited<ReturnType<typeof readInternalUsdc>> | null = null;
  if (wantsInternal && header && issues.length === 0) {
    const institution = await runtime.store.getInstitution(auth.session.institutionId);
    if (!institution) return refuse(c, 404, "not-found");
    const window = {
      fromBlock: internalAsked.CLAIM?.fromBlock ?? internalAsked.SOURCE?.fromBlock ?? null,
      toBlock: internalAsked.CLAIM?.toBlock ?? internalAsked.SOURCE?.toBlock ?? null,
    };
    const base: InternalManifestBase = {
      institutionId: auth.session.institutionId,
      scopeUnit: institution.scopeUnit,
      scopeLevel: institution.scopeLevel,
      period: header.period,
      cutOff: new Date(runtime.now() * 1000).toISOString(),
    };
    internal = await readInternalUsdc(runtime.internalLedger!, base, window);
  }

  const claim = internalAsked.CLAIM
    ? { side: internal?.claim ?? null, issues: [] as SourceIssue[] }
    : normalizeSide(body.claim, "CLAIM", auth.session.institutionId);

  const declaredSource =
    typeof body.source === "object" && body.source !== null
      ? (body.source as Record<string, unknown>)
      : null;

  let source: { side: SubmittedSide | null; issues: SourceIssue[] };
  /** The workbook to freeze beside the rows it produced, when there is one. */
  let sourceWorkbook: SubmittedFile | null = null;

  const upload = readUpload(body.sourceTable) ?? readUpload(declaredSource?.tabular);
  if (internalAsked.SOURCE) {
    source = { side: internal?.source ?? null, issues: [] };
  } else if (upload) {
    const tabularIssues: SourceIssue[] = [];
    const read = header
      ? readTabularSource(
          upload,
          auth.session.institutionId,
          (declaredSource?.manifest as Record<string, unknown> | undefined) ?? null,
          header.period,
          header.currencyUnit,
          header.balanceSheetScope,
          new Date(runtime.now() * 1000).toISOString(),
          tabularIssues
        )
      : null;
    // A file with broken rows is not frozen: the rows that did read are not the
    // source, and a snapshot over the readable half would be a smaller lie.
    const usable = read !== null && read.mapping.invalidRowCount === 0 && tabularIssues.length === 0;
    source = { side: usable ? read!.side : null, issues: tabularIssues };
    if (usable) {
      sourceWorkbook = {
        role: "SOURCE",
        fileName: read!.fileName,
        mimeType:
          read!.format === "csv"
            ? "text/csv"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes: read!.bytes,
      };
    }
  } else {
    source = normalizeSide(body.source, "SOURCE", auth.session.institutionId);
  }

  issues.push(
    ...claim.issues.map((item) => ({ ...item, side: "CLAIM" as const })),
    ...source.issues.map((item) => ({ ...item, side: "SOURCE" as const }))
  );

  if (header && claim.side) checkAgreement(claim.side, header, issues);
  if (header && source.side) checkAgreement(source.side, header, issues);

  const files = readFiles(body.files, issues);
  if (sourceWorkbook) files.push(sourceWorkbook);

  if (issues.length > 0 || !header || !claim.side || !source.side) {
    // Every issue at once. A person fixing a pasted table wants the whole list,
    // not one line per round trip.
    return c.json(
      {
        success: false,
        error: `Masukan ditolak: ${issues.length} hal perlu diperbaiki sebelum sumber dapat dibekukan.`,
        issues,
      },
      400
    );
  }

  return executeFreezeAndStorePreparation(c, runtime, auth, header, claim.side, source.side, files, internal);
});

evidenceRoutes.get("/", async (c) => {
  const runtime = runtimeWithStore(c);
  if (runtime instanceof Response) return runtime;

  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  return c.json({
    success: true,
    institutionId: auth.session.institutionId,
    preparations: await runtime.evidence.listPreparations(auth.session.institutionId),
  });
});

/**
 * What internal sources this deployment can offer, and how far they reach
 * (ticket #79).
 *
 * A selection surface, not a package: it reads the ledger and the indexed events
 * the same way `POST /` would and reports what each side would look like -
 * status, row count, records that cannot be proved, the block range, and the
 * indexer checkpoint the range stops at. Nothing here is frozen and nothing is
 * committed to, so choosing a source is a decision made with the limits already
 * on screen rather than discovered afterwards inside a package.
 *
 * The proposed manifest travels with it so a pasted counterpart can be given the
 * same cut-off and scope; a mismatch there is refused later, and refusing it
 * without first saying what to match would be a puzzle rather than a check.
 */
evidenceRoutes.get("/internal-sources", async (c) => {
  const runtime = runtimeWithStore(c);
  if (runtime instanceof Response) return runtime;

  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  if (!runtime.internalLedger) {
    return c.json({
      success: true,
      streams: [
        {
          stream: USDC_DEPOSIT_STREAM,
          bucket: USDC_DEPOSIT_BUCKET,
          currencyUnit: "USDC_6DP",
          balanceSheetScope: "ON",
          available: false,
          reason:
            "Deployment ini tidak memiliki ledger internal dan event terindeks yang dapat dibaca, " +
            "sehingga sumber internal USDC belum didukung. Sumber terstruktur lain tetap dapat dipakai.",
          chainScope: null,
          sides: [],
        },
      ],
    });
  }

  const institution = await runtime.store.getInstitution(auth.session.institutionId);
  if (!institution) return refuse(c, 404, "not-found");

  const year = Number(c.req.query("year") ?? new Date(runtime.now() * 1000).getUTCFullYear());
  const kind = c.req.query("periodKind") === "SEMESTER" ? "SEMESTER" : "AKHIR_TAHUN";
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return badRequest(c, "Tahun periode harus bilangan bulat antara 2000 dan 2100.");
  }

  const base: InternalManifestBase = {
    institutionId: auth.session.institutionId,
    scopeUnit: institution.scopeUnit,
    scopeLevel: institution.scopeLevel,
    period: { kind, year },
    cutOff: new Date(runtime.now() * 1000).toISOString(),
  };

  const internal = await readInternalUsdc(runtime.internalLedger, base, {
    fromBlock: null,
    toBlock: null,
  });

  const describe = (side: SubmittedSide) => ({
    role: side.manifest.role,
    label: side.manifest.label,
    status: side.status,
    detail: side.status === "READ" ? null : side.detail,
    rowCount: side.status === "READ" ? side.rows.length : null,
    unverified: side.unverified ?? [],
    manifest: side.manifest,
  });

  const sides = [internal.claim, internal.source];
  return c.json({
    success: true,
    streams: [
      {
        stream: USDC_DEPOSIT_STREAM,
        bucket: USDC_DEPOSIT_BUCKET,
        currencyUnit: "USDC_6DP",
        balanceSheetScope: "ON",
        // A stream is offered while any side of it can be read. A side that
        // cannot says so on its own row, rather than hiding the whole stream.
        available: sides.some((side) => side.status === "READ"),
        reason: null,
        chainScope: internal.source.manifest.chainScope ?? internal.chainScope,
        sides: sides.map(describe),
        coverageNotes: depositCoverageNotes(internal.chainScope, sides),
      },
    ],
  });
});

/**
 * The public summary. No session, and nothing restricted on this path: no rows,
 * no salt, no file locator, and no way to reach one.
 */
evidenceRoutes.get("/:id/public", async (c) => {
  const runtime = runtimeWithStore(c);
  if (runtime instanceof Response) return runtime;

  const summary = await runtime.evidence.getPublicSummary(c.req.param("id"));
  if (!summary) return refuse(c, 404, "not-found");
  return c.json({ success: true, summary });
});

evidenceRoutes.get("/:id/files/:fileId", async (c) => {
  const runtime = runtimeWithStore(c);
  if (runtime instanceof Response) return runtime;

  const auth = await authenticateWorkspace(c, runtime, undefined);
  if (!auth.ok) return auth.response;

  let document;
  try {
    document = await createRestrictedDocuments(runtime.evidence, runtime.files).read({
      institutionId: auth.session.institutionId, preparationId: c.req.param("id"),
    }, c.req.param("fileId"));
  } catch (error) {
    if (error instanceof DocumentError) {
      if (error.reason === "NOT_FOUND" || error.missingLocatorRow) return refuse(c, 404, "not-found");
      return c.json({ success: false, status: error.storageStatus === "FAILED" ? "FAILED" : "UNAVAILABLE", error: error.message }, 409);
    }
    return c.json({ success: false, status: "UNAVAILABLE", error: "Berkas belum dapat diperiksa." }, 503);
  }
  const { bytes, file } = document;

  return c.body(bytes as unknown as ArrayBuffer, 200, {
    "Content-Type": /^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType) ? file.mimeType : "application/octet-stream",
    "Content-Disposition": `attachment; filename="${file.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
});

evidenceRoutes.get("/:id", async (c) => {
  const runtime = runtimeWithStore(c);
  if (runtime instanceof Response) return runtime;

  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  const stored = await runtime.evidence.getPreparation(auth.session.institutionId, c.req.param("id"));
  if (!stored) return refuse(c, 404, "not-found");

  const bytes = new TextEncoder().encode(stored.canonicalSnapshot);
  return c.json({
    success: true,
    preparation: restrictedView(stored),
    // Checked on the way out, so a reader is told when a stored package no
    // longer matches what was committed to rather than discovering it later.
    commitmentVerified: verifyCommitment(bytes, stored.commitmentSalt, stored.commitment),
  });
});

export default evidenceRoutes;

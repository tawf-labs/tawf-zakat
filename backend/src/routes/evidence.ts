/**
 * Preparing, keeping and reopening a source snapshot (Spec #68, ticket #70).
 *
 *   POST /api/evidence                  freeze two sides, reconcile, keep both
 *   GET  /api/evidence                  what this institution has prepared
 *   GET  /api/evidence/:id              reopen one, exactly as it was examined
 *   GET  /api/evidence/:id/public       the summary a public reader may see
 *   GET  /api/evidence/:id/drill-down   the frozen realization provenance, per side
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
import {
  DISBURSEMENT_REALIZATION_FORMAT,
  DISBURSEMENT_REALIZATION_STREAM,
  buildDisbursementRealizationSide,
  currentStatusOf,
  failedRealizationSide,
  type RealizationProvenance,
  type RealizationScope,
} from "../realization-source";
import type { ActivityStore } from "../activity-store";
import {
  PROVENANCE_FILE_NAMES,
  type RealizationCurrentView,
  type RealizationDrillDown,
} from "../../../shared/realization-provenance";
import type { DisbursementStore } from "../disbursement-store";
import { readTabularSource, readUpload } from "../source-import";
import draftRoutes from "./evidence-drafts";
import periodReportRoutes from "./period-reports";
import { readRealizationRecords } from "../realization-read";
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

import { CONTRIBUTION_COLLECTION_STREAM, buildCollectionSide, readCollectionRecords } from "../collection-source";
import type { ContributionStore } from "../contribution-store";

async function readCollectionSide(store: ContributionStore, scope: RealizationScope): Promise<{ side: SubmittedSide; provenanceFile: SubmittedFile | null; coverageNotes: string[] }> {
  try { return buildCollectionSide(scope, await readCollectionRecords(store, scope.institution.id)); }
  catch {
    const manifest = buildCollectionSide(scope, []).side.manifest;
    return { side: { manifest, status: "FAILED", detail: "Catatan penghimpunan tidak dapat dibaca dari penyimpanan", unverified: [] },
      provenanceFile: null, coverageNotes: [] };
  }
}

type InternalRequest =
  | {
      stream: typeof USDC_DEPOSIT_STREAM;
      fromBlock: number | null;
      toBlock: number | null;
    }
  | {
      stream: typeof DISBURSEMENT_REALIZATION_STREAM | typeof CONTRIBUTION_COLLECTION_STREAM;
      cutOff: string | null;
    };

/** The internal source a side asked for, or `null` when it asked for none. */
function readInternalRequest(
  raw: unknown,
  role: "CLAIM" | "SOURCE",
  issues: SourceIssue[]
): InternalRequest | null {
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

  const stream = text(asked.stream);
  if (stream === USDC_DEPOSIT_STREAM) {
    const bound = (field: "fromBlock" | "toBlock"): number | null => {
      const value = asked[field];
      if (value === undefined || value === null) return null;
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        issues.push(issue(`${where}.${field}`, "Batas blok harus bilangan bulat tidak negatif."));
        return null;
      }
      return value;
    };
    return { stream: USDC_DEPOSIT_STREAM, fromBlock: bound("fromBlock"), toBlock: bound("toBlock") };
  }

  if (stream === DISBURSEMENT_REALIZATION_STREAM || stream === CONTRIBUTION_COLLECTION_STREAM) {
    const cutOff = typeof asked.cutOff === "string" ? asked.cutOff : null;
    if (cutOff !== null && isNaN(Date.parse(cutOff))) {
      issues.push(issue(`${where}.cutOff`, "Batas cut-off harus berupa string ISO 8601 yang sah."));
      return null;
    }
    return { stream, cutOff };
  }

  issues.push(
    issue(
      `${where}.stream`,
      `Sumber internal yang tersedia adalah "${USDC_DEPOSIT_STREAM}", "${DISBURSEMENT_REALIZATION_STREAM}", dan "${CONTRIBUTION_COLLECTION_STREAM}". ` +
        `Diterima: ${JSON.stringify(asked.stream)}.`
    )
  );
  return null;
}

/** The header an internal source can be examined under, checked before any read. */
function checkInternalHeader(
  header: Header,
  stream: typeof USDC_DEPOSIT_STREAM | typeof DISBURSEMENT_REALIZATION_STREAM | typeof CONTRIBUTION_COLLECTION_STREAM,
  issues: SourceIssue[]
): void {
  if (stream === USDC_DEPOSIT_STREAM) {
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
  } else if (stream === DISBURSEMENT_REALIZATION_STREAM || stream === CONTRIBUTION_COLLECTION_STREAM) {
    if (stream === CONTRIBUTION_COLLECTION_STREAM && header.balanceSheetScope !== "ON") {
      issues.push(issue("balanceSheetScope", "Penghimpunan kontribusi dicatat on balance sheet; gunakan ON."));
    }
    if (header.currencyUnit !== "IDR") {
      issues.push(
        issue(
          "currencyUnit",
          `Sumber internal realisasi penyaluran dicatat dalam satuan IDR (rupiah); persiapan ini ` +
            `memakai ${header.currencyUnit}.`
        )
      );
    }
  }
}

// Bringing a source in and keeping a draft is its own router, mounted here rather
// than further down: Hono matches in registration order, and "/:id" below would
// otherwise answer for "/template", "/preview" and "/drafts".
/** How one side of an internal stream is offered on `/internal-sources`. */
const describeSide = (side: SubmittedSide) => ({
  role: side.manifest.role,
  label: side.manifest.label,
  status: side.status,
  detail: side.status === "READ" ? null : side.detail,
  rowCount: side.status === "READ" ? side.rows.length : null,
  unverified: side.unverified ?? [],
  manifest: side.manifest,
});

/**
 * One side read from the institution's recorded realizations.
 *
 * A read that throws becomes a FAILED side with no provenance file, so the
 * package says the scope was not examined instead of reporting an empty source.
 */
async function readRealizationSide(
  disbursement: DisbursementStore,
  activities: ActivityStore | undefined,
  scope: RealizationScope
): Promise<{ side: SubmittedSide; provenanceFile: SubmittedFile | null; coverageNotes: string[] }> {
  const read = await readRealizationRecords(disbursement, activities, scope.institution.id);
  if (!read.ok) {
    return {
      side: failedRealizationSide(scope, "Catatan realisasi penyaluran tidak dapat dibaca dari penyimpanan"),
      provenanceFile: null,
      coverageNotes: [],
    };
  }
  return buildDisbursementRealizationSide({ ...scope, ...read.data, activityTrace: read.activityTrace });
}

/**
 * What the working data says now about the realizations a package froze.
 *
 * Read beside the snapshot with the instant it was read at, and never written
 * into it. A failed read is stated as such; the frozen drill-down still answers.
 */
async function currentRealizationView(
  disbursement: DisbursementStore | undefined,
  institutionId: string,
  now: number,
  provenances: readonly RealizationProvenance[]
): Promise<RealizationCurrentView> {
  if (!disbursement) {
    return { available: false, observedAt: now, reason: "Penyimpanan realisasi penyaluran belum dikonfigurasi pada deployment ini." };
  }
  const ids = [...new Set(provenances.flatMap((p) => p.realizations.map((r) => r.realizationId)))];
  try {
    const data = await disbursement.readRealizationSourceData(institutionId);
    return { available: true, observedAt: now, realizations: currentStatusOf(ids, data) };
  } catch (error) {
    console.error("[evidence] current realization status read failed", error);
    return {
      available: false,
      observedAt: now,
      reason: "Status operasional terkini tidak dapat dibaca; rincian beku di bawah tetap berlaku.",
    };
  }
}

evidenceRoutes.route("/", draftRoutes);
evidenceRoutes.route("/period-reports", periodReportRoutes);

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
  const wantsInternalUsdc =
    internalAsked.CLAIM?.stream === USDC_DEPOSIT_STREAM ||
    internalAsked.SOURCE?.stream === USDC_DEPOSIT_STREAM;
  const wantsInternalRealization =
    internalAsked.CLAIM?.stream === DISBURSEMENT_REALIZATION_STREAM ||
    internalAsked.SOURCE?.stream === DISBURSEMENT_REALIZATION_STREAM;

  const wantsInternalCollection = Object.values(internalAsked).some(asked => asked?.stream === CONTRIBUTION_COLLECTION_STREAM);
  if (wantsInternalCollection && header) checkInternalHeader(header, CONTRIBUTION_COLLECTION_STREAM, issues);
  if (wantsInternalCollection && !runtime.contributions) return unconfigured(c, "Penyimpanan kontribusi Rupiah");

  if (wantsInternalUsdc && header) checkInternalHeader(header, USDC_DEPOSIT_STREAM, issues);
  if (wantsInternalRealization && header) checkInternalHeader(header, DISBURSEMENT_REALIZATION_STREAM, issues);

  if (wantsInternalUsdc && !runtime.internalLedger) {
    return unconfigured(c, "Ledger internal dan event terindeks deployment ini");
  }
  if (wantsInternalRealization && !runtime.disbursement) {
    return unconfigured(c, "Penyimpanan realisasi penyaluran deployment ini");
  }

  let internalUsdc: Awaited<ReturnType<typeof readInternalUsdc>> | null = null;
  if (wantsInternalUsdc && header && issues.length === 0) {
    const institution = await runtime.store.getInstitution(auth.session.institutionId);
    if (!institution) return refuse(c, 404, "not-found");
    const claimReq = internalAsked.CLAIM?.stream === USDC_DEPOSIT_STREAM ? internalAsked.CLAIM : null;
    const sourceReq = internalAsked.SOURCE?.stream === USDC_DEPOSIT_STREAM ? internalAsked.SOURCE : null;
    const window = {
      fromBlock: claimReq?.fromBlock ?? sourceReq?.fromBlock ?? null,
      toBlock: claimReq?.toBlock ?? sourceReq?.toBlock ?? null,
    };
    const base: InternalManifestBase = {
      institutionId: auth.session.institutionId,
      scopeUnit: institution.scopeUnit,
      scopeLevel: institution.scopeLevel,
      period: header.period,
      cutOff: new Date(runtime.now() * 1000).toISOString(),
    };
    internalUsdc = await readInternalUsdc(runtime.internalLedger!, base, window);
  }

  const realization: Partial<Record<"CLAIM" | "SOURCE", Awaited<ReturnType<typeof readRealizationSide>>>> = {};

  if ((wantsInternalRealization || wantsInternalCollection) && header && issues.length === 0) {
    const institution = await runtime.store.getInstitution(auth.session.institutionId);
    if (!institution) return refuse(c, 404, "not-found");

    for (const role of ["CLAIM", "SOURCE"] as const) {
      const asked = internalAsked[role];
      if (asked?.stream !== DISBURSEMENT_REALIZATION_STREAM && asked?.stream !== CONTRIBUTION_COLLECTION_STREAM) continue;
      const scope: RealizationScope = {
        institution: {
          id: auth.session.institutionId,
          legalName: institution.legalName,
          scopeUnit: institution.scopeUnit,
          scopeLevel: institution.scopeLevel,
        },
        period: header.period,
        cutOff: asked.cutOff ?? new Date(runtime.now() * 1000).toISOString(),
        role,
        balanceSheetScope: header.balanceSheetScope,
      };
      realization[role] = asked.stream === CONTRIBUTION_COLLECTION_STREAM
        ? await readCollectionSide(runtime.contributions!, scope)
        : await readRealizationSide(runtime.disbursement!, runtime.activities, scope);
    }
  }

  const claim =
    internalAsked.CLAIM?.stream === USDC_DEPOSIT_STREAM
      ? { side: internalUsdc?.claim ?? null, issues: [] as SourceIssue[] }
      : internalAsked.CLAIM?.stream === DISBURSEMENT_REALIZATION_STREAM || internalAsked.CLAIM?.stream === CONTRIBUTION_COLLECTION_STREAM
      ? { side: realization.CLAIM?.side ?? null, issues: [] as SourceIssue[] }
      : normalizeSide(body.claim, "CLAIM", auth.session.institutionId);

  const declaredSource =
    typeof body.source === "object" && body.source !== null
      ? (body.source as Record<string, unknown>)
      : null;

  let source: { side: SubmittedSide | null; issues: SourceIssue[] };
  /** The workbook to freeze beside the rows it produced, when there is one. */
  let sourceWorkbook: SubmittedFile | null = null;

  const upload = readUpload(body.sourceTable) ?? readUpload(declaredSource?.tabular);
  if (internalAsked.SOURCE?.stream === USDC_DEPOSIT_STREAM) {
    source = { side: internalUsdc?.source ?? null, issues: [] };
  } else if (internalAsked.SOURCE?.stream === DISBURSEMENT_REALIZATION_STREAM || internalAsked.SOURCE?.stream === CONTRIBUTION_COLLECTION_STREAM) {
    source = { side: realization.SOURCE?.side ?? null, issues: [] };
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
  for (const read of [realization.CLAIM, realization.SOURCE]) {
    if (read?.provenanceFile) files.push(read.provenanceFile);
  }

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

  return executeFreezeAndStorePreparation(
    c,
    runtime,
    auth,
    header,
    claim.side,
    source.side,
    files,
    internalUsdc,
    [...(realization.CLAIM?.coverageNotes ?? []), ...(realization.SOURCE?.coverageNotes ?? [])]
  );
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

  const institution = await runtime.store.getInstitution(auth.session.institutionId);
  if (!institution) return refuse(c, 404, "not-found");

  const year = Number(c.req.query("year") ?? new Date(runtime.now() * 1000).getUTCFullYear());
  const kind = c.req.query("periodKind") === "SEMESTER" ? "SEMESTER" : "AKHIR_TAHUN";
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return badRequest(c, "Tahun periode harus bilangan bulat antara 2000 dan 2100.");
  }

  const streams: Array<Record<string, unknown>> = [];

  // Stream 1: USDC Deposits
  if (!runtime.internalLedger) {
    streams.push({
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
      coverageNotes: [],
    });
  } else {
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

    const sides = [internal.claim, internal.source];
    streams.push({
      stream: USDC_DEPOSIT_STREAM,
      bucket: USDC_DEPOSIT_BUCKET,
      currencyUnit: "USDC_6DP",
      balanceSheetScope: "ON",
      available: sides.some((side) => side.status === "READ"),
      reason: null,
      chainScope: internal.source.manifest.chainScope ?? internal.chainScope,
      sides: sides.map(describeSide),
      coverageNotes: depositCoverageNotes(internal.chainScope, sides),
    });
  }

  // Stream 2: Disbursement Realizations
  if (!runtime.disbursement) {
    streams.push({
      stream: DISBURSEMENT_REALIZATION_STREAM,
      bucket: "PENYALURAN",
      currencyUnit: "IDR",
      balanceSheetScope: "ON",
      available: false,
      reason: "Penyimpanan realisasi penyaluran belum dikonfigurasi pada deployment ini.",
      chainScope: null,
      sides: [],
      coverageNotes: [],
    });
  } else {
    const cutOff = new Date(runtime.now() * 1000).toISOString();
    const built = await readRealizationSide(runtime.disbursement, runtime.activities, {
      institution: {
        id: auth.session.institutionId,
        legalName: institution.legalName,
        scopeUnit: institution.scopeUnit,
        scopeLevel: institution.scopeLevel,
      },
      period: { kind, year },
      cutOff,
      role: "SOURCE",
      balanceSheetScope: "ON",
    });

    streams.push({
      stream: DISBURSEMENT_REALIZATION_STREAM,
      bucket: "PENYALURAN",
      currencyUnit: "IDR",
      balanceSheetScope: "ON",
      available: built.side.status === "READ",
      reason: built.side.status === "READ" ? null : built.side.detail,
      chainScope: null,
      cutOff,
      sides: [describeSide(built.side)],
      coverageNotes: built.coverageNotes,
    });
  }

  const collectionScope: RealizationScope = {
    institution: { id: auth.session.institutionId, legalName: institution.legalName, scopeUnit: institution.scopeUnit, scopeLevel: institution.scopeLevel },
    period: { kind, year }, cutOff: new Date(runtime.now() * 1000).toISOString(), role: "SOURCE", balanceSheetScope: "ON",
  };
  const collection = runtime.contributions ? await readCollectionSide(runtime.contributions, collectionScope) : null;
  streams.push({ stream: CONTRIBUTION_COLLECTION_STREAM, bucket: "PENGHIMPUNAN", currencyUnit: "IDR", balanceSheetScope: "ON",
    available: collection?.side.status === "READ", reason: !collection ? "Penyimpanan kontribusi Rupiah belum dikonfigurasi pada deployment ini."
      : collection.side.status === "READ" ? null : collection.side.detail,
    chainScope: null, cutOff: collectionScope.cutOff, sides: collection ? [describeSide(collection.side)] : [], coverageNotes: collection?.coverageNotes ?? [] });

  return c.json({
    success: true,
    streams,
  });
});

/**
 * Realization drill-down (Spec #86, Ticket #98).
 *
 * Answers, for each side prepared from the internal realization stream, the
 * provenance frozen with the package: proposal version, recipients, handovers,
 * documents and the separated advances and expenses. A provenance file is only
 * trusted when its side was built by the server from that stream and it sits
 * under the reserved name for that side; attachments cannot take those names.
 *
 * A side whose file cannot be read is named in `unreadable` with the reason,
 * never answered as an empty breakdown.
 */
evidenceRoutes.get("/:id/drill-down", async (c) => {
  const runtime = runtimeWithStore(c);
  if (runtime instanceof Response) return runtime;

  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  const preparationId = c.req.param("id");
  const stored = await runtime.evidence.getPreparation(auth.session.institutionId, preparationId);
  if (!stored) return refuse(c, 404, "not-found");

  const realizationSides = stored.sides.filter(
    (side) => side.manifest.origin === "INTERNAL_LEDGER" && side.manifest.format === DISBURSEMENT_REALIZATION_FORMAT
  );

  const provenances: RealizationProvenance[] = [];
  const unreadable: RealizationDrillDown["unreadable"] = [];
  const documents = createRestrictedDocuments(runtime.evidence, runtime.files);

  for (const side of realizationSides) {
    const role = side.manifest.role;
    const file = stored.files.find((f) => f.role === role && f.fileName === PROVENANCE_FILE_NAMES[role]);
    if (!file) {
      // A side that was never read has no provenance to lose; that is not a failure of the file.
      if (side.status === "READ") {
        unreadable.push({ role, status: "FAILED", reason: "Berkas penelusuran realisasi tidak ada dalam paket ini." });
      }
      continue;
    }
    try {
      const document = await documents.read({ institutionId: auth.session.institutionId, preparationId }, file.id);
      provenances.push(JSON.parse(new TextDecoder().decode(document.bytes)) as RealizationProvenance);
    } catch (error) {
      if (error instanceof DocumentError) {
        // Missing or altered bytes are a failed file, not one that is merely not reachable yet.
        const failed = error.storageStatus === "FAILED" || error.reason === "MISSING" || error.reason === "CORRUPT";
        unreadable.push({ role, status: failed ? "FAILED" : "UNAVAILABLE", reason: error.message });
      } else {
        unreadable.push({ role, status: "UNAVAILABLE", reason: "Berkas penelusuran realisasi belum dapat diperiksa." });
      }
    }
  }

  let drillDown: RealizationDrillDown;
  if (provenances.length > 0) {
    drillDown = {
      available: true,
      transactionDetail: "PRESENT",
      provenances,
      current: await currentRealizationView(runtime.disbursement, auth.session.institutionId, runtime.now(), provenances),
      unreadable,
    };
  } else if (realizationSides.length > 0) {
    drillDown = {
      available: false,
      transactionDetail: "NO_REALIZATION_SOURCE",
      reason:
        unreadable.length > 0
          ? "Berkas penelusuran realisasi paket ini tidak dapat dibaca; rincian tidak ditampilkan sebagai kosong."
          : "Sumber realisasi penyaluran paket ini tidak terbaca saat dibekukan, sehingga tidak ada rincian yang dapat ditelusuri.",
      unreadable,
    };
  } else {
    const isRecap = stored.sides.some((side) => side.manifest.transactionDetail === "NOT_AVAILABLE");
    drillDown = {
      available: false,
      transactionDetail: isRecap ? "NOT_AVAILABLE" : "NO_REALIZATION_SOURCE",
      reason: isRecap
        ? "Paket bukti ini dibuat dari rekapitulasi tanpa rincian transaksi, sehingga penelusuran ke versi " +
          "pengajuan, rincian penerima, dan dokumen serah terima tidak tersedia."
        : "Paket bukti ini tidak dibuat dari sumber realisasi penyaluran internal, sehingga penelusuran ke versi " +
          "pengajuan, rincian penerima, dan dokumen serah terima tidak tersedia.",
      unreadable,
    };
  }

  return c.json({ success: true, ...drillDown });
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

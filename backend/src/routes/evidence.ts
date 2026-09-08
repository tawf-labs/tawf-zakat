import { createRestrictedDocuments, DocumentError } from "../restricted-documents";
/**
 * Preparing, keeping and reopening a source snapshot (Spec #68, ticket #70).
 *
 *   POST /api/evidence                  freeze two sides, reconcile, keep both
 *   GET  /api/evidence                  what this institution has prepared
 *   GET  /api/evidence/:id              reopen one, exactly as it was examined
 *   GET  /api/evidence/:id/public       the summary a public reader may see
 *   GET  /api/evidence/:id/files/:file  a restricted document, if you may have it
 *
 * The order inside `POST` is the whole point of the ticket. The sides are
 * normalized, then **frozen into canonical bytes**, then reconciled *from those
 * bytes*, and only then written - snapshot, result and findings together, in
 * one transaction. Computing first and storing afterwards would leave a package
 * whose result was produced from something slightly different from what it
 * kept, and nobody could tell afterwards which one the report meant.
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
import type { Context } from "hono";
import { toHex } from "viem";
import {
  reconcile,
  ReconciliationInputError,
  type CurrencyUnit,
  type Discrepancy,
  type DiscrepancyKind,
  type LedgerSide,
  type ReconciliationOptions,
  type ReportingPeriod,
} from "../reconciliation";
import { CURRENCY_UNITS, PERIOD_KINDS } from "../wire";
import {
  coverageNotesFor,
  entriesFrom,
  normalizeSide,
  rowsFrom,
  type ManifestPosition,
  type SourceIssue,
  type SubmittedSide,
} from "../evidence-source";
import {
  commitmentFor,
  COMMITMENT_SCHEME,
  freezeSnapshot,
  newCommitmentSalt,
  parseSnapshot,
  publicSummaryOf,
  verifyCommitment,
  type FileReference,
  type Quantity,
} from "../evidence-snapshot";
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
import { EvidenceFileError, MAX_EVIDENCE_FILE_BYTES } from "../evidence-files";
import type { StoredFile, StoredFinding, StoredPreparation } from "../evidence-store";
import { serializeReport } from "./reconciliation";
import { authenticateWorkspace, badRequest, refuse } from "../workspace-session";
import { authorize } from "../tenancy";
import { workspaceRuntime, type WorkspaceRuntime } from "../workspace-runtime";

const evidenceRoutes = new Hono();

/** A runtime that actually has somewhere to keep a preparation. */
type EvidenceRuntime = WorkspaceRuntime & {
  evidence: NonNullable<WorkspaceRuntime["evidence"]>;
};

const unconfigured = (c: Context, missing: string) =>
  c.json(
    {
      success: false,
      error:
        `${missing} belum dikonfigurasi pada deployment ini. Paket bukti tidak disimpan ke tempat ` +
        `yang tidak bertahan setelah restart, dan dokumen terbatas tidak disimpan tanpa enkripsi.`,
    },
    503
  );

const runtimeWithStore = (c: Context): EvidenceRuntime | Response => {
  const runtime = workspaceRuntime();
  if (!runtime) return unconfigured(c, "Ruang kerja lembaga");
  if (!runtime.evidence) return unconfigured(c, "Penyimpanan paket bukti");
  return runtime as EvidenceRuntime;
};

const readJson = async (c: Context): Promise<Record<string, unknown> | null> => {
  try {
    const body = await c.req.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const issue = (field: string, message: string): SourceIssue => ({
  scope: "manifest",
  rowIndex: null,
  field,
  message,
});

const newId = (prefix: string): string =>
  `${prefix}-${toHex(crypto.getRandomValues(new Uint8Array(16))).slice(2)}`;

type Header = {
  label: string;
  period: ReportingPeriod;
  currencyUnit: CurrencyUnit;
  balanceSheetScope: ManifestPosition;
  tolerance: Quantity;
};

/** Everything about the preparation itself, before either side is looked at. */
function readHeader(body: Record<string, unknown>, issues: SourceIssue[]): Header | null {
  const label = text(body.label);
  if (label === "") issues.push(issue("label", "Persiapan harus diberi nama agar dapat dikenali kembali."));

  const periodRecord =
    typeof body.period === "object" && body.period !== null && !Array.isArray(body.period)
      ? (body.period as Record<string, unknown>)
      : null;
  let period: ReportingPeriod | null = null;
  if (
    periodRecord &&
    PERIOD_KINDS.includes(periodRecord.kind as (typeof PERIOD_KINDS)[number]) &&
    typeof periodRecord.year === "number" &&
    Number.isInteger(periodRecord.year)
  ) {
    period = { kind: periodRecord.kind as ReportingPeriod["kind"], year: periodRecord.year };
  } else {
    issues.push(issue("period", "Persiapan harus menyebut periode pelaporan (SEMESTER atau AKHIR_TAHUN)."));
  }

  const currencyUnit = text(body.currencyUnit) as CurrencyUnit;
  if (!CURRENCY_UNITS.includes(currencyUnit)) {
    issues.push(
      issue(
        "currencyUnit",
        `Unit mata uang persiapan tidak dikenal: ${JSON.stringify(body.currencyUnit)}. ` +
          `Gunakan "IDR" atau "USDC_6DP"; keduanya direkonsiliasi terpisah dan tidak pernah dikonversi.`
      )
    );
  }

  const scopeRaw = text(body.balanceSheetScope) === "" ? "BOTH" : text(body.balanceSheetScope);
  if (!["ON", "OFF", "BOTH"].includes(scopeRaw)) {
    issues.push(issue("balanceSheetScope", 'Cakupan posisi neraca harus "ON", "OFF", atau "BOTH".'));
  }

  let tolerance: Quantity = { amount: "0", unit: currencyUnit };
  if (body.tolerance !== undefined && body.tolerance !== null) {
    const record = body.tolerance as Record<string, unknown>;
    const amount = text(record?.amount);
    if (!/^\d+$/.test(amount)) {
      issues.push(
        issue(
          "tolerance",
          "Toleransi harus bilangan bulat tidak negatif sebagai teks angka. Toleransi terikat pada " +
            "paket dan ditampilkan; ia tidak mengizinkan pembulatan klaim."
        )
      );
    } else if (text(record?.unit) !== currencyUnit) {
      issues.push(issue("tolerance", `Unit toleransi harus sama dengan unit persiapan (${currencyUnit}).`));
    } else {
      tolerance = { amount, unit: currencyUnit };
    }
  }

  if (issues.length > 0) return null;
  return {
    label,
    period: period!,
    currencyUnit,
    balanceSheetScope: scopeRaw as ManifestPosition,
    tolerance,
  };
}

/** A side's manifest has to agree with the preparation it is part of. */
function checkAgreement(side: SubmittedSide, header: Header, issues: SourceIssue[]): void {
  const where = side.manifest.role === "CLAIM" ? "claim.manifest" : "source.manifest";

  if (side.manifest.balanceSheet !== "BOTH" && side.manifest.balanceSheet !== header.balanceSheetScope) {
    issues.push(issue(`${where}.balanceSheet`,
      `Sumber hanya mencakup posisi ${side.manifest.balanceSheet}, sedangkan pemeriksaan meminta ${header.balanceSheetScope}. Pilih cakupan yang tersedia pada kedua sumber.`));
  }

  if (side.manifest.currencyUnit !== header.currencyUnit) {
    issues.push(
      issue(
        `${where}.currencyUnit`,
        `Sisi ini memakai unit ${side.manifest.currencyUnit} sedangkan persiapan memakai ` +
          `${header.currencyUnit}. Rekonsiliasikan tiap unit dalam persiapannya sendiri.`
      )
    );
  }

  if (
    side.manifest.period.kind !== header.period.kind ||
    side.manifest.period.year !== header.period.year
  ) {
    issues.push(
      issue(
        `${where}.period`,
        `Sisi ini berasal dari periode ${side.manifest.period.kind} ${side.manifest.period.year} ` +
          `sedangkan persiapan menyatakan ${header.period.kind} ${header.period.year}.`
      )
    );
  }
}

type SubmittedFile = { role: "CLAIM" | "SOURCE"; fileName: string; mimeType: string; bytes: Uint8Array };

function readFiles(raw: unknown, issues: SourceIssue[]): SubmittedFile[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    issues.push(issue("files", "Daftar berkas harus berupa array."));
    return [];
  }

  const files: SubmittedFile[] = [];
  for (const [index, item] of raw.entries()) {
    const record = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : null;
    const where = `files[${index}]`;
    if (!record) {
      issues.push(issue(where, "Setiap berkas harus berupa objek."));
      continue;
    }

    const role = text(record.role);
    if (role !== "CLAIM" && role !== "SOURCE") {
      issues.push(issue(`${where}.role`, 'Berkas harus menyebut sisi yang didukungnya: "CLAIM" atau "SOURCE".'));
      continue;
    }
    const fileName = text(record.fileName);
    if (fileName === "") {
      issues.push(issue(`${where}.fileName`, "Berkas harus menyebut nama aslinya."));
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(Buffer.from(text(record.contentBase64), "base64"));
    } catch {
      issues.push(issue(`${where}.contentBase64`, "Isi berkas harus base64 yang sah."));
      continue;
    }
    if (bytes.byteLength === 0) {
      issues.push(issue(`${where}.contentBase64`, "Berkas kosong tidak disimpan sebagai bukti."));
      continue;
    }
    if (bytes.byteLength > MAX_EVIDENCE_FILE_BYTES) {
      issues.push(
        issue(`${where}.contentBase64`, `Berkas melebihi batas ${MAX_EVIDENCE_FILE_BYTES} byte.`)
      );
      continue;
    }

    files.push({
      role,
      fileName,
      mimeType: text(record.mimeType) === "" ? "application/octet-stream" : text(record.mimeType),
      bytes,
    });
  }
  return files;
}

const findingsFrom = (discrepancies: readonly Discrepancy[]): StoredFinding[] =>
  discrepancies.map((discrepancy, ordinal) => ({
    ordinal,
    kind: discrepancy.kind,
    key: discrepancy.key,
    bucket: discrepancy.bucket,
    deltaAmount: discrepancy.delta.amount.toString(),
    deltaUnit: discrepancy.delta.unit,
    claimAmount: discrepancy.claimValue ? discrepancy.claimValue.amount.toString() : null,
    sourceAmount: discrepancy.sourceValue ? discrepancy.sourceValue.amount.toString() : null,
    label: discrepancy.label ?? null,
  }));

const countByKind = (discrepancies: readonly Discrepancy[]): Partial<Record<DiscrepancyKind, number>> => {
  const counts: Partial<Record<DiscrepancyKind, number>> = {};
  for (const discrepancy of discrepancies) {
    counts[discrepancy.kind] = (counts[discrepancy.kind] ?? 0) + 1;
  }
  return counts;
};

/** The restricted view of a stored preparation. The storage locator never appears. */
const restrictedView = (preparation: StoredPreparation) => {
  // Unverified records live in the frozen bytes, which are the record; the side
  // rows beside them are a projection. Reading them from the snapshot keeps the
  // two from drifting.
  const frozen = parseSnapshot(preparation.canonicalSnapshot);
  const unverifiedOf = (role: "CLAIM" | "SOURCE") =>
    frozen.sides.find((side) => side.manifest.role === role)?.unverified ?? [];
  return {
    id: preparation.id,
    institutionId: preparation.institutionId,
    label: preparation.label,
    period: { kind: preparation.periodKind, year: preparation.periodYear },
    currencyUnit: preparation.currencyUnit,
    outcome: preparation.outcome,
    preparedBy: preparation.preparedBy,
    createdAt: preparation.createdAt,
    commitment: preparation.commitment,
    commitmentScheme: preparation.commitmentScheme,
    // Restricted on purpose: the salt is what lets an authorized reader verify the
    // commitment, and what stops anyone else guessing a low-entropy source from it.
    commitmentSalt: preparation.commitmentSalt,
    snapshot: frozen,
    result: preparation.resultJson ? JSON.parse(preparation.resultJson) : null,
    findings: preparation.findings,
    sources: preparation.sides.map((side) => ({
      role: side.role,
      status: side.status,
      detail: side.detail,
      manifest: side.manifest,
      rowCount: side.rowCount,
      rows: side.rows,
      unverified: unverifiedOf(side.role),
    })),
    files: frozen.files.map((file) => publicFileView(file)),
    publicSummary: preparation.publicSummary,
  };
};

/** What a reader is told about a file. Never where it is kept. */
const publicFileView = (file: FileReference) => ({
  id: file.id,
  role: file.role,
  fileName: file.fileName,
  mimeType: file.mimeType,
  sizeBytes: file.sizeBytes,
  contentSha256: file.contentSha256,
  storageStatus: file.storageStatus,
  failureReason: file.failureReason,
});


/**
 * Reading an internal source, once, for whichever sides asked for it
 * (ticket #79).
 *
 * Both sides are built from one checkpoint, one block range and one cut-off. Two
 * reads would let the indexer advance between them, and a package whose two
 * sides were examined against different amounts of chain reports the gap between
 * two moments as a discrepancy between two ledgers.
 */
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

  // A side may name an internal source instead of carrying one. The server then
  // builds it from this deployment's own ledger and indexed events; nothing a
  // client sends can stand in for what the chain actually recorded.
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
      // One window for both sides, widest of what either asked for, so the two
      // sides are never examined against different amounts of chain.
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
  const source = internalAsked.SOURCE
    ? { side: internal?.source ?? null, issues: [] as SourceIssue[] }
    : normalizeSide(body.source, "SOURCE", auth.session.institutionId);
  issues.push(
    ...claim.issues.map((item) => ({ ...item, side: "CLAIM" as const })),
    ...source.issues.map((item) => ({ ...item, side: "SOURCE" as const }))
  );

  if (header && claim.side) checkAgreement(claim.side, header, issues);
  if (header && source.side) checkAgreement(source.side, header, issues);

  const files = readFiles(body.files, issues);

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

  const sides = [claim.side, source.side];
  const preparationId = newId("prep");

  // Files are stored before the snapshot is frozen, so the snapshot can record
  // what actually happened to each one. A failure here is recorded as a failure
  // and never as an identifier for a file that is not there.
  const fileReferences: FileReference[] = [];
  const fileRows: StoredFile[] = [];
  for (const file of files) {
    const id = newId("file");
    let storedFile: StoredFile = {
      id, role: file.role, fileName: file.fileName, mimeType: file.mimeType,
      sizeBytes: file.bytes.byteLength, contentSha256: null,
      storageStatus: "FAILED", storageRef: null,
      failureReason: "Penyimpanan dokumen terbatas belum dikonfigurasi (EVIDENCE_FILE_KEY), sehingga berkas tidak disimpan.",
    };
    if (runtime.files) {
      try {
        const stored = await runtime.files.put({
          institutionId: auth.session.institutionId, preparationId, fileId: id, bytes: file.bytes,
        });
        storedFile = { ...storedFile, ...stored, storageStatus: "STORED", failureReason: null };
      } catch (error: any) {
        storedFile.failureReason = error instanceof EvidenceFileError ? error.message
          : error?.code === "ENOSPC"
            ? "Penyimpanan berkas gagal: disk penuh. Hubungi operator penyimpanan."
            : "Penyimpanan berkas gagal. Hubungi operator untuk memeriksa kapasitas dan izin penyimpanan.";
      }
    }
    fileRows.push(storedFile);
    // Explicit projection keeps the private storage locator out of the snapshot.
    fileReferences.push(publicFileView(storedFile));
  }

  const coverageNotes = coverageNotesFor(sides);
  if (internal) {
    coverageNotes.push(
      ...depositCoverageNotes(
        internal.chainScope,
        sides.filter((side) => side.manifest.origin === "INTERNAL_LEDGER")
      )
    );
  }
  for (const reference of fileReferences) {
    if (reference.storageStatus === "FAILED") {
      coverageNotes.push(
        `Berkas "${reference.fileName}" tidak tersimpan: ${reference.failureReason} ` +
          `Paket ini tidak memuat berkas tersebut, dan tidak ada pengenal pengganti yang dibuat untuknya.`
      );
    }
  }

  const createdAt = runtime.now();
  const { snapshot, canonical, bytes } = freezeSnapshot({
    preparationId,
    institutionId: auth.session.institutionId,
    label: header.label,
    period: header.period,
    currencyUnit: header.currencyUnit,
    balanceSheetScope: header.balanceSheetScope,
    tolerance: header.tolerance,
    // Derived from the manifests rather than accepted from the caller, so a
    // request cannot widen the vocabulary its own rows were checked against.
    allowedBuckets: [
      ...new Set(sides.flatMap((side) => side.manifest.fundTypes)),
    ].sort(),
    preparedBy: auth.session.account,
    preparedAt: createdAt,
    sides,
    files: fileReferences,
    coverageNotes,
  });

  const salt = newCommitmentSalt();
  const commitment = commitmentFor(bytes, salt);

  // Reconcile from the *frozen* snapshot, not from the request body. Recomputing
  // later from the stored bytes then cannot disagree with the result kept here.
  const frozen = parseSnapshot(canonical);
  const frozenClaim = frozen.sides.find((side) => side.manifest.role === "CLAIM")!;
  const frozenSource = frozen.sides.find((side) => side.manifest.role === "SOURCE")!;

  const everySideRead = frozen.sides.every((side) => side.status === "READ");

  let report: ReturnType<typeof reconcile> | null = null;
  if (everySideRead) {
    const asLedgerSide = (side: typeof frozenClaim): LedgerSide => {
      const { entries, declaredTotals } = entriesFrom({
        manifest: side.manifest,
        status: "READ",
        rows: side.rows,
      });
      return {
        label: side.manifest.label,
        entries,
        ...(declaredTotals.length > 0 ? { declaredTotals } : {}),
      };
    };

    const options: ReconciliationOptions = {
      period: frozen.period,
      allowedBuckets: frozen.allowedBuckets,
      tolerance: { amount: BigInt(frozen.tolerance.amount), unit: frozen.tolerance.unit },
      ...(frozen.balanceSheetScope !== "BOTH" ? { balanceSheet: frozen.balanceSheetScope } : {}),
    };

    try {
      report = reconcile(asLedgerSide(frozenClaim), asLedgerSide(frozenSource), options);
    } catch (error: any) {
      if (error instanceof ReconciliationInputError) {
        return c.json(
          { success: false, error: error.message, issues: [issue("rows", error.message)] },
          400
        );
      }
      throw error;
    }
  }

  const outcome = report ? "RECONCILED" : "INCOMPLETE";
  const serialized = report ? serializeReport(report) : null;

  const publicSummary = publicSummaryOf(snapshot, {
    commitment,
    outcome,
    netDelta: report
      ? { amount: report.netDelta.amount.toString(), unit: report.netDelta.unit }
      : null,
    absoluteDelta: report
      ? { amount: report.absoluteDelta.amount.toString(), unit: report.absoluteDelta.unit }
      : null,
    findingCounts: report ? countByKind(report.discrepancies) : {},
    salt,
  });

  try {
    await runtime.evidence.savePreparation({
      id: preparationId,
      institutionId: auth.session.institutionId,
      preparedBy: auth.session.account,
      label: header.label,
      periodKind: header.period.kind,
      periodYear: header.period.year,
      currencyUnit: header.currencyUnit,
      outcome,
      commitment,
      commitmentScheme: COMMITMENT_SCHEME,
      commitmentSalt: salt,
      canonicalSnapshot: canonical,
      resultJson: serialized ? JSON.stringify(serialized) : null,
      publicSummary,
      createdAt,
      sides: sides.map((side) => ({
        role: side.manifest.role,
        status: side.status,
        detail: side.status === "READ" ? null : side.detail,
        manifest: side.manifest,
        rows: rowsFrom(side),
        rowCount: rowsFrom(side).length,
      })),
      findings: report ? findingsFrom(report.discrepancies) : [],
      files: fileRows,
    });
  } catch (error: any) {
    // The write is one transaction, so no half-written package survives. What
    // can survive is ciphertext already written for files that now belong to no
    // preparation: unreferenced, unreadable without the deployment key, and
    // costing only disk. Left in place deliberately rather than deleted on an
    // error path, where a second failure would be the one nobody sees.
    return c.json(
      {
        success: false,
        error:
          `Paket bukti gagal disimpan. Hubungi operator basis data. ` +
          `Snapshot, hasil, dan temuan disimpan bersama atau tidak sama sekali.`,
      },
      500
    );
  }

  const stored = await runtime.evidence.getPreparation(auth.session.institutionId, preparationId);
  if (!stored) {
    return c.json(
      { success: false, error: "Paket bukti tidak dapat dibaca kembali setelah disimpan." },
      500
    );
  }

  return c.json({ success: true, preparation: restrictedView(stored) }, 201);
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

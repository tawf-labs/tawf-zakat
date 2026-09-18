/**
 * What every evidence route shares, and the one order that matters (ticket #70).
 *
 * Two kinds of thing live here, because the routers above them should hold
 * neither: the plumbing every route repeats - which runtime is configured, how a
 * body is read, what a header has to agree with - and `executeFreezeAndStorePreparation`,
 * the single pipeline that turns two agreed sides into one stored preparation.
 *
 * That pipeline's order is the whole point, and it is the same whether the caller
 * arrived through the draft route or posted a preparation directly: files are
 * stored, the snapshot is frozen into canonical bytes, the reconciliation is
 * computed *from those bytes*, and only then is everything written together.
 * Computing first and storing afterwards would leave a package whose result was
 * produced from something slightly different from what it kept, and nobody could
 * tell afterwards which one the report meant.
 *
 * Having one copy of it is not tidiness. Two freeze paths that drifted apart is a
 * report whose figures depend on which button the officer pressed.
 */

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
  manifestIssue as issue,
  rowsFrom,
  text,
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
  type FileReference,
  type Quantity,
} from "../evidence-snapshot";
import { depositCoverageNotes, type ChainScope } from "../internal-usdc-source";
import { EvidenceFileError, MAX_EVIDENCE_FILE_BYTES } from "../evidence-files";
import { serializeReport } from "./reconciliation";
import { workspaceRuntime, type WorkspaceRuntime } from "../workspace-runtime";
import type { StoredFile, StoredFinding, StoredPreparation } from "../evidence-store";
import { isReservedProvenanceFileName } from "../../../shared/realization-provenance";

export { issue, text };

/** A runtime that actually has somewhere to keep a preparation. */
export type EvidenceRuntime = WorkspaceRuntime & {
  evidence: NonNullable<WorkspaceRuntime["evidence"]>;
};

export const unconfigured = (c: Context, missing: string) =>
  c.json(
    {
      success: false,
      error:
        `${missing} belum dikonfigurasi pada deployment ini. Paket bukti tidak disimpan ke tempat ` +
        `yang tidak bertahan setelah restart, dan dokumen terbatas tidak disimpan tanpa enkripsi.`,
    },
    503
  );

export const runtimeWithStore = (c: Context): EvidenceRuntime | Response => {
  const runtime = workspaceRuntime();
  if (!runtime) return unconfigured(c, "Ruang kerja lembaga");
  if (!runtime.evidence) return unconfigured(c, "Penyimpanan paket bukti");
  return runtime as EvidenceRuntime;
};

export const readJson = async (c: Context): Promise<Record<string, unknown> | null> => {
  try {
    const body = await c.req.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};


export const newId = (prefix: string): string =>
  `${prefix}-${toHex(crypto.getRandomValues(new Uint8Array(16))).slice(2)}`;

export type Header = {
  label: string;
  period: ReportingPeriod;
  currencyUnit: CurrencyUnit;
  balanceSheetScope: ManifestPosition;
  tolerance: Quantity;
};

/** Everything about the preparation itself, before either side is looked at. */
export function readHeader(body: Record<string, unknown>, issues: SourceIssue[]): Header | null {
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
export function checkAgreement(side: SubmittedSide, header: Header, issues: SourceIssue[]): void {
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

export type SubmittedFile = { role: "CLAIM" | "SOURCE"; fileName: string; mimeType: string; bytes: Uint8Array };

export function readFiles(raw: unknown, issues: SourceIssue[]): SubmittedFile[] {
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
    if (isReservedProvenanceFileName(fileName)) {
      issues.push(
        issue(
          `${where}.fileName`,
          `Nama berkas "${fileName}" dicadangkan untuk penelusuran realisasi yang dibekukan server; ganti nama lampiran.`
        )
      );
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

export const findingsFrom = (discrepancies: readonly Discrepancy[]): StoredFinding[] =>
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

export const countByKind = (discrepancies: readonly Discrepancy[]): Partial<Record<DiscrepancyKind, number>> => {
  const counts: Partial<Record<DiscrepancyKind, number>> = {};
  for (const discrepancy of discrepancies) {
    counts[discrepancy.kind] = (counts[discrepancy.kind] ?? 0) + 1;
  }
  return counts;
};

/** The restricted view of a stored preparation. The storage locator never appears. */

export const restrictedView = (preparation: StoredPreparation) => {
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

export const publicFileView = (file: FileReference) => ({
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

/**
 * Freezes both sides into one preparation and writes it whole.
 *
 * The order is the point, and it is the same whether the caller came through the
 * draft route or posted a preparation directly: files are stored, the snapshot is
 * frozen into canonical bytes, the reconciliation is computed *from those bytes*,
 * and only then is everything written together. Computing first and storing
 * afterwards would leave a package whose result was produced from something
 * slightly different from what it kept.
 */
export async function executeFreezeAndStorePreparation(
  c: Context,
  runtime: EvidenceRuntime,
  auth: { session: { institutionId: string; account: string; role: string } },
  header: Header,
  claimSide: SubmittedSide,
  sourceSide: SubmittedSide,
  files: SubmittedFile[],
  internal: { chainScope: ChainScope } | null,
  extraCoverageNotes?: string[]
): Promise<Response> {
  const sides = [claimSide, sourceSide];
  const preparationId = newId("prep");

  // Files are stored before the snapshot is frozen, so the snapshot can record
  // what actually happened to each one. A failure here is recorded as a failure
  // and never as an identifier for a file that is not there.
  const fileReferences: FileReference[] = [];
  const fileRows: StoredFile[] = [];
  for (const file of files) {
    const id = newId("file");
    let storedFile: StoredFile = {
      id,
      role: file.role,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.bytes.byteLength,
      contentSha256: null,
      storageStatus: "FAILED",
      storageRef: null,
      failureReason:
        "Penyimpanan dokumen terbatas belum dikonfigurasi (EVIDENCE_FILE_KEY), sehingga berkas tidak disimpan.",
    };
    if (runtime.files) {
      try {
        const stored = await runtime.files.put({
          institutionId: auth.session.institutionId,
          preparationId,
          fileId: id,
          bytes: file.bytes,
        });
        storedFile = { ...storedFile, ...stored, storageStatus: "STORED", failureReason: null };
      } catch (error: any) {
        storedFile.failureReason =
          error instanceof EvidenceFileError
            ? error.message
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
  if (extraCoverageNotes && extraCoverageNotes.length > 0) {
    coverageNotes.push(...extraCoverageNotes);
  }
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
}


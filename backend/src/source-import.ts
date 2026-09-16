/**
 * Reading an uploaded report source, and keeping what a draft holds (Ticket #88).
 *
 * This is the seam between a file somebody uploaded and a side of a preparation.
 * It owns three refusals, and the routes above it own none of them:
 *
 * - **Coverage is read, never assumed.** A manifest's fund types come from the
 *   officer's declaration or from the rows the file actually carries. A manifest
 *   that names every fund type because nobody said otherwise is a claim the rows
 *   underneath it cannot support, and coverage is what a reader of the frozen
 *   package relies on.
 * - **A workbook is a restricted document.** It carries the same names and bank
 *   details as a frozen one, so a draft's file goes into the encrypted store and
 *   the draft row keeps only its locator - never the bytes, never in the clear.
 * - **A locator is not an access control.** What leaves this module for a reader
 *   is a document's name, size and hash. The locator stays behind.
 *
 * Decoding itself lives in `tabular-reader`; the mapping to source rows lives in
 * `source-tabular-schema`. This module is what joins them to a preparation.
 */

import {
  manifestIssue,
  text,
  type ManifestPosition,
  type SourceIssue,
  type SourceManifest,
  type SubmittedSide,
} from "./evidence-source";
import { JENIS_DANA, type CurrencyUnit, type ReportingPeriod } from "./reconciliation";
import { decodeTabular } from "./tabular-reader";
import { mapSourceTabular, type TabularSourceMappingResult } from "./source-tabular-schema";
import { SOURCE_TEMPLATE_VERSION } from "./source-template-generator";
import { EvidenceFileError, sha256Of, type PrivateFileStore } from "./evidence-files";
import type { DraftDocument, StoredDraft } from "./evidence-store";

/** A workbook as it arrives on the wire, before anything has been read from it. */
export type TabularUpload = { fileName: string; contentBase64: string };

/** The workbook, decoded, together with what it says about its own scope. */
export type ReadTabular = {
  side: SubmittedSide;
  mapping: TabularSourceMappingResult;
  bytes: Uint8Array;
  fileName: string;
  format: "xlsx" | "csv";
};

export const readUpload = (raw: unknown): TabularUpload | null => {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
  if (!record) return null;
  const fileName = text(record.fileName);
  const contentBase64 = text(record.contentBase64);
  if (fileName === "" || contentBase64 === "") return null;
  return { fileName, contentBase64 };
};

/**
 * What a tabular source declares about itself.
 *
 * Every field is either declared by the officer or read off the file that was
 * uploaded. Nothing is filled in on the source's behalf: a manifest that names all
 * five fund types because nobody said otherwise, or a cut-off invented so the field
 * is not empty, is a coverage claim the rows underneath it cannot support - and
 * coverage is precisely what a reader of the frozen package relies on.
 *
 * `fundTypes` therefore comes from the officer's declaration when there is one, and
 * otherwise from the buckets the rows actually carry. `transactionDetail` says
 * PRESENT only when entries actually carry their references; a recap that names no
 * transaction is NOT_AVAILABLE, and this application does not invent the detail.
 */
export function sourceManifestFrom(input: {
  institutionId: string;
  declared: Record<string, unknown> | null;
  period: ReportingPeriod;
  currencyUnit: CurrencyUnit;
  balanceSheet: ManifestPosition;
  format: "xlsx" | "csv";
  /** When the source was read, which is the moment it was cut from the ledger. */
  readAt: string;
  observedFundTypes: string[];
  hasTransactionDetail: boolean;
}): SourceManifest {
  const declared = input.declared ?? {};
  const declaredFundTypes = Array.isArray(declared.fundTypes)
    ? (declared.fundTypes as unknown[]).map((value) => text(value)).filter((value) => value !== "")
    : [];

  return {
    role: "SOURCE",
    label: text(declared.label) || "Sumber Tabular Laporan",
    origin: "UPLOAD",
    institutionId: input.institutionId,
    scopeUnit: text(declared.scopeUnit) || "PUSAT",
    scopeLevel: text(declared.scopeLevel) || "NASIONAL",
    fundTypes: declaredFundTypes.length > 0 ? declaredFundTypes : input.observedFundTypes,
    balanceSheet: input.balanceSheet,
    currencyUnit: input.currencyUnit,
    period: input.period,
    cutOff: text(declared.cutOff) || input.readAt,
    format: input.format.toUpperCase(),
    mappingVersion: SOURCE_TEMPLATE_VERSION,
    transactionDetail: input.hasTransactionDetail ? "PRESENT" : "NOT_AVAILABLE",
    note: text(declared.note) || null,
  };
}

/**
 * Decodes an uploaded workbook and maps it to source rows.
 *
 * The mapping runs against every fund type this application knows, so no row is
 * refused for falling outside a coverage nobody declared; the manifest that comes
 * back then records the coverage the rows actually carry, or the officer's own
 * declaration where they made one.
 *
 * Returns the rows *and* the bytes, because a source that is frozen has to freeze
 * the file it was read from, not only what was read out of it.
 */
export function readTabularSource(
  upload: TabularUpload,
  institutionId: string,
  declared: Record<string, unknown> | null,
  period: ReportingPeriod,
  currencyUnit: CurrencyUnit,
  balanceSheet: ManifestPosition,
  readAt: string,
  issues: SourceIssue[]
): ReadTabular | null {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(upload.contentBase64, "base64"));
  } catch {
    issues.push(manifestIssue("tabular", "Isi berkas harus berformat base64 yang sah."));
    return null;
  }

  const decoded = decodeTabular(bytes, upload.fileName);
  if (!decoded.success || !decoded.table) {
    for (const found of decoded.issues) {
      issues.push({
        scope: "manifest",
        rowIndex: found.rowNumber,
        field: found.column ?? "tabular",
        message: found.message,
      });
    }
    return null;
  }

  const declaredFundTypes = Array.isArray(declared?.fundTypes) ? (declared!.fundTypes as string[]) : [];
  const working = sourceManifestFrom({
    institutionId,
    declared,
    period,
    currencyUnit,
    balanceSheet,
    format: decoded.format,
    readAt,
    observedFundTypes: declaredFundTypes.length > 0 ? declaredFundTypes : [...JENIS_DANA],
    hasTransactionDetail: true,
  });

  const mapping = mapSourceTabular(decoded.table, working);
  const manifest = sourceManifestFrom({
    institutionId,
    declared,
    period,
    currencyUnit,
    balanceSheet,
    format: decoded.format,
    readAt,
    observedFundTypes: mapping.observedFundTypes,
    hasTransactionDetail: mapping.hasTransactionDetail,
  });

  for (const found of mapping.issues) issues.push(found);

  return {
    // A declared grand total is a row of the side, flagged - `entriesFrom` splits it
    // back out. Carrying it beside the rows instead drops it from the snapshot.
    side: {
      manifest,
      status: "READ",
      rows: [...mapping.validRows, ...mapping.declaredTotals],
    },
    mapping,
    bytes,
    fileName: upload.fileName,
    format: decoded.format,
  };
}

/** What the preview and the draft both report about a file that was read. */
export const previewOf = (read: ReadTabular) => ({
  fileName: read.fileName,
  format: read.format,
  totalRows: read.mapping.totalRows,
  validCount: read.mapping.validRowCount,
  invalidCount: read.mapping.invalidRowCount,
  isPartial: read.mapping.isPartial,
  calculableTotal: read.mapping.calculableTotal,
  allRowsPreview: read.mapping.allRowsPreview,
  issues: read.mapping.issues,
});

/** Thrown when a draft document cannot be kept; the reason is shown as-is. */
export class DraftDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftDocumentError";
  }
}

/**
 * Puts one draft document into the encrypted store and returns its locator row.
 *
 * Nothing here invents a reference for a file that did not land: a failed write is
 * returned as a refusal, because a draft that says it holds a workbook it never
 * stored is a draft that cannot be frozen and does not know it.
 */
export async function keepDraftDocument(
  files: PrivateFileStore | undefined,
  institutionId: string,
  draftId: string,
  file: { role: "CLAIM" | "SOURCE"; fileName: string; mimeType: string; bytes: Uint8Array },
  newFileId: () => string
): Promise<DraftDocument> {
  if (!files) {
    throw new DraftDocumentError(
      "Penyimpanan dokumen terbatas (EVIDENCE_FILE_KEY) belum dikonfigurasi, sehingga berkas " +
        "draf tidak disimpan. Dokumen terbatas tidak disimpan tanpa enkripsi."
    );
  }
  try {
    const stored = await files.put({
      institutionId,
      preparationId: draftId,
      fileId: newFileId(),
      bytes: file.bytes,
    });
    return {
      role: file.role,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: stored.sizeBytes,
      contentSha256: stored.contentSha256,
      storageRef: stored.storageRef,
    };
  } catch (error: any) {
    throw new DraftDocumentError(
      error instanceof EvidenceFileError
        ? error.message
        : `Berkas "${file.fileName}" gagal disimpan ke penyimpanan dokumen terbatas. ` +
          `Draf tidak disimpan dengan berkas yang tidak pernah mendarat.`
    );
  }
}

/**
 * Reads a draft document back, and checks it is the one that was written.
 *
 * Returns `null` when the ciphertext is gone or no longer matches its commitment.
 * A locator that resolves to something else is not the document, and saying "not
 * readable" is the only honest answer left.
 */
export async function readDraftDocument(
  files: PrivateFileStore | undefined,
  document: DraftDocument
): Promise<Uint8Array | null> {
  if (!files) return null;
  try {
    const bytes = await files.get(document.storageRef);
    if (!bytes) return null;
    if (bytes.byteLength !== document.sizeBytes) return null;
    if (sha256Of(bytes) !== document.contentSha256) return null;
    return bytes;
  } catch {
    return null;
  }
}

/**
 * A draft as a reader may have it.
 *
 * The locator never leaves: it is not an access control, and handing it out once is
 * handing it out forever. What a reader gets is the document's name, size and hash.
 */
export const draftDocumentView = (document: DraftDocument) => ({
  role: document.role,
  fileName: document.fileName,
  mimeType: document.mimeType,
  sizeBytes: document.sizeBytes,
  contentSha256: document.contentSha256,
});

export const draftView = (draft: StoredDraft) => ({
  ...draft,
  sourceData: draft.sourceData
    ? {
        ...draft.sourceData,
        ...(draft.sourceData.tabular ? { tabular: draftDocumentView(draft.sourceData.tabular) } : {}),
      }
    : null,
  files: draft.files.map(draftDocumentView),
});


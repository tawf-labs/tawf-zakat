/**
 * Storage for biaya operasional penyaluran (ADR-0042): the tables, their row mappers and
 * the readers every consumer shares — the disbursement store, activity accountability and
 * the period realization source — so all three count the same rows the same way.
 *
 * An item row holds the current version; `operational_cost_item_versions` keeps every
 * version, so a correction or a void never erases what was recorded before.
 */

import { sql } from "drizzle-orm";
import { PERIOD_LOCK_SCHEMA_STATEMENTS } from "./period-lock";
import type {
  CostItemChange,
  CostItemInput,
  CostItemRecord,
  CostItemStatus,
  CostItemVersionRecord,
  FundingSource,
  PanjarRecord,
  PanjarReturnRecord,
  ReceiptFileRecord,
  ReceiptKind,
  ReceiptRecord,
  ReceiptFileType,
  ReimbursementRecord,
} from "./operational-cost";

type Executor = { execute: (query: any) => Promise<any> };

export const OPERATIONAL_COST_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS operational_cost_panjar (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     proposal_id TEXT NOT NULL REFERENCES proposal_drafts (id),
     holder_officer_id TEXT NOT NULL REFERENCES officer_profiles (id),
     amount_idr TEXT NOT NULL,
     purpose TEXT NOT NULL,
     cash_out_ref TEXT NOT NULL,
     issued_on TEXT NOT NULL,
     recorded_by_officer_id TEXT NOT NULL REFERENCES officer_profiles (id),
     recorded_by_account TEXT NOT NULL,
     recorded_at BIGINT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS operational_cost_panjar_by_proposal ON operational_cost_panjar (institution_id, proposal_id);`,
  `CREATE TABLE IF NOT EXISTS operational_cost_panjar_returns (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     panjar_id TEXT NOT NULL REFERENCES operational_cost_panjar (id),
     amount_idr TEXT NOT NULL,
     returned_on TEXT NOT NULL,
     reference TEXT NOT NULL,
     recorded_by_officer_id TEXT NOT NULL REFERENCES officer_profiles (id),
     recorded_by_account TEXT NOT NULL,
     recorded_at BIGINT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS operational_cost_reimbursements (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     proposal_id TEXT NOT NULL REFERENCES proposal_drafts (id),
     holder_officer_id TEXT NOT NULL REFERENCES officer_profiles (id),
     total_idr TEXT NOT NULL,
     paid_on TEXT NOT NULL,
     reference TEXT NOT NULL,
     recorded_by_officer_id TEXT NOT NULL REFERENCES officer_profiles (id),
     recorded_by_account TEXT NOT NULL,
     recorded_at BIGINT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS operational_cost_items (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     proposal_id TEXT NOT NULL REFERENCES proposal_drafts (id),
     version INTEGER NOT NULL,
     status TEXT NOT NULL,
     spent_on TEXT NOT NULL,
     purpose TEXT NOT NULL,
     quantity TEXT,
     unit TEXT,
     unit_price_idr TEXT,
     amount_idr TEXT NOT NULL,
     payee TEXT NOT NULL,
     funding_kind TEXT NOT NULL,
     holder_officer_id TEXT REFERENCES officer_profiles (id),
     panjar_id TEXT REFERENCES operational_cost_panjar (id),
     reimbursement_id TEXT REFERENCES operational_cost_reimbursements (id),
     recorded_by_officer_id TEXT NOT NULL REFERENCES officer_profiles (id),
     recorded_by_account TEXT NOT NULL,
     recorded_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL,
     CONSTRAINT operational_cost_items_status CHECK (status IN ('ACTIVE', 'VOIDED')),
     CONSTRAINT operational_cost_items_funding CHECK (
       (funding_kind = 'KAS_LEMBAGA' AND holder_officer_id IS NULL AND panjar_id IS NULL) OR
       (funding_kind = 'TALANGAN' AND holder_officer_id IS NOT NULL AND panjar_id IS NULL) OR
       (funding_kind = 'PANJAR' AND holder_officer_id IS NULL AND panjar_id IS NOT NULL)
     ),
     CONSTRAINT operational_cost_items_reimbursed_talangan CHECK (reimbursement_id IS NULL OR funding_kind = 'TALANGAN')
   );`,
  `CREATE INDEX IF NOT EXISTS operational_cost_items_by_proposal ON operational_cost_items (institution_id, proposal_id);`,
  // Rows of one batch share a timestamp; the sequence keeps them in the order they were typed.
  `ALTER TABLE operational_cost_items ADD COLUMN IF NOT EXISTS seq BIGSERIAL;`,
  `ALTER TABLE operational_cost_panjar ADD COLUMN IF NOT EXISTS seq BIGSERIAL;`,
  `ALTER TABLE operational_cost_panjar_returns ADD COLUMN IF NOT EXISTS seq BIGSERIAL;`,
  `ALTER TABLE operational_cost_reimbursements ADD COLUMN IF NOT EXISTS seq BIGSERIAL;`,
  `CREATE TABLE IF NOT EXISTS operational_cost_item_versions (
     item_id TEXT NOT NULL REFERENCES operational_cost_items (id),
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     version INTEGER NOT NULL,
     change TEXT NOT NULL,
     item_json TEXT NOT NULL,
     reason TEXT,
     actor_officer_id TEXT NOT NULL REFERENCES officer_profiles (id),
     actor_account TEXT NOT NULL,
     at BIGINT NOT NULL,
     PRIMARY KEY (item_id, version)
   );`,
  // Nota/kuitansi and their files (#126). A receipt belongs to one proposal; its files are
  // ciphertext in the private file store, and only their SHA-256 and locator are kept here.
  `CREATE TABLE IF NOT EXISTS operational_cost_receipts (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     proposal_id TEXT NOT NULL REFERENCES proposal_drafts (id),
     kind TEXT NOT NULL,
     reference TEXT NOT NULL,
     issued_on TEXT NOT NULL,
     issuer TEXT,
     evidenced_at BIGINT,
     recorded_by_officer_id TEXT NOT NULL REFERENCES officer_profiles (id),
     recorded_by_account TEXT NOT NULL,
     recorded_at BIGINT NOT NULL,
     seq BIGSERIAL,
     CONSTRAINT operational_cost_receipts_kind CHECK (kind IN ('NOTA', 'SURAT_PERNYATAAN'))
   );`,
  `CREATE INDEX IF NOT EXISTS operational_cost_receipts_by_proposal ON operational_cost_receipts (institution_id, proposal_id);`,
  `CREATE TABLE IF NOT EXISTS operational_cost_receipt_files (
     id TEXT PRIMARY KEY,
     institution_id TEXT NOT NULL REFERENCES institutions (id),
     receipt_id TEXT NOT NULL REFERENCES operational_cost_receipts (id),
     file_name TEXT NOT NULL,
     mime_type TEXT NOT NULL,
     size_bytes BIGINT NOT NULL,
     content_sha256 TEXT NOT NULL,
     storage_ref TEXT NOT NULL,
     uploaded_by_officer_id TEXT NOT NULL REFERENCES officer_profiles (id),
     uploaded_by_account TEXT NOT NULL,
     uploaded_at BIGINT NOT NULL,
     seq BIGSERIAL
   );`,
  `ALTER TABLE operational_cost_items ADD COLUMN IF NOT EXISTS receipt_id TEXT REFERENCES operational_cost_receipts (id);`,
  // A nota carried over from the old free-text "Dokumen rujukan" (#128): text only, no file.
  `ALTER TABLE operational_cost_receipts ADD COLUMN IF NOT EXISTS legacy BOOLEAN NOT NULL DEFAULT FALSE;`,
  // A change to a row a published report covered names that report (#129).
  `ALTER TABLE operational_cost_item_versions ADD COLUMN IF NOT EXISTS report_correction_package_id TEXT;`,
  ...PERIOD_LOCK_SCHEMA_STATEMENTS,
] as const;

// The old rows kept only a timestamp; a cost row and a panjar need a calendar date. WIB has no
// daylight saving, so a fixed +7 hours gives the institution's date without timezone data.
const wibDate = (column: string) => `to_char(to_timestamp(${column} + 25200) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

// The old expense kept the recorder's officer id but not the account they signed in with: take
// the membership that officer held when the row was recorded.
const recorderAccount = (expense: string) => `COALESCE((
  SELECT lower(m.account_address) FROM institution_memberships m
  WHERE m.institution_id = ${expense}.institution_id AND m.officer_id = ${expense}.recorded_by_officer_id
  ORDER BY (m.created_at <= to_timestamp(${expense}.recorded_at)) DESC, m.created_at DESC
  LIMIT 1
), '')`;

// One nota per distinct "Dokumen rujukan" within a proposal, so its id is derived from that text.
const legacyReceiptId = (expense: string) =>
  `'nta-legacy-' || md5(${expense}.institution_id || chr(31) || ${expense}.proposal_id || chr(31) || btrim(${expense}.document_ref))`;

/**
 * Carries the old uang muka and biaya rows (`disbursement_realization_advances`/`_expenses`,
 * ticket #95) into the ADR-0042 model (#128). Each old row keeps its id, so every statement
 * skips what an earlier start already carried over and running it again adds nothing. The old
 * tables stay as they were; nothing reads them any more.
 *
 * - an uang muka becomes a panjar held by the officer who recorded it, with its amount,
 *   purpose, reference and time;
 * - a biaya becomes a cost row funded by that panjar when it named one, otherwise by kas
 *   lembaga; its "Dokumen rujukan" becomes a nota with no file, marked as old data.
 */
export const LEGACY_COST_MIGRATION_STATEMENTS = [
  `INSERT INTO operational_cost_panjar (
     id, institution_id, proposal_id, holder_officer_id, amount_idr, purpose, cash_out_ref, issued_on,
     recorded_by_officer_id, recorded_by_account, recorded_at
   )
   SELECT a.id, a.institution_id, a.proposal_id, a.officer_id, a.amount_idr, a.purpose, a.reference, ${wibDate("a.issued_at")},
     a.officer_id, a.officer_account, a.issued_at
   FROM disbursement_realization_advances a
   ORDER BY a.issued_at ASC, a.id ASC
   ON CONFLICT (id) DO NOTHING;`,
  `INSERT INTO operational_cost_receipts (
     id, institution_id, proposal_id, kind, reference, issued_on, issuer, evidenced_at,
     recorded_by_officer_id, recorded_by_account, recorded_at, legacy
   )
   SELECT id, institution_id, proposal_id, 'NOTA', reference, ${wibDate("recorded_at")}, NULL,
     recorded_at, recorded_by_officer_id, account, recorded_at, TRUE
   FROM (
     -- Each nota takes the date, recorder and time of the first biaya that cited it.
     SELECT DISTINCT ON (e.institution_id, e.proposal_id, btrim(e.document_ref))
       ${legacyReceiptId("e")} AS id, e.institution_id, e.proposal_id, btrim(e.document_ref) AS reference,
       e.recorded_at, e.recorded_by_officer_id, ${recorderAccount("e")} AS account, e.id AS expense_id
     FROM disbursement_realization_expenses e
     WHERE btrim(e.document_ref) <> ''
     ORDER BY e.institution_id, e.proposal_id, btrim(e.document_ref), e.recorded_at ASC, e.id ASC
   ) first_cited
   ORDER BY recorded_at ASC, expense_id ASC
   ON CONFLICT (id) DO NOTHING;`,
  `INSERT INTO operational_cost_items (
     id, institution_id, proposal_id, version, status, spent_on, purpose, quantity, unit, unit_price_idr,
     amount_idr, payee, funding_kind, holder_officer_id, panjar_id, reimbursement_id, receipt_id,
     recorded_by_officer_id, recorded_by_account, recorded_at, updated_at
   )
   SELECT e.id, e.institution_id, e.proposal_id, 1, 'ACTIVE', ${wibDate("e.recorded_at")}, e.purpose, NULL, NULL, NULL,
     e.amount_idr, e.payee,
     CASE WHEN e.advance_id IS NULL THEN 'KAS_LEMBAGA' ELSE 'PANJAR' END, NULL, e.advance_id, NULL,
     CASE WHEN btrim(e.document_ref) <> '' THEN ${legacyReceiptId("e")} END,
     e.recorded_by_officer_id, ${recorderAccount("e")}, e.recorded_at, e.recorded_at
   FROM disbursement_realization_expenses e
   ORDER BY e.recorded_at ASC, e.id ASC
   ON CONFLICT (id) DO NOTHING;`,
  // The first version is frozen from the carried row itself, in the shape `itemSnapshot` writes.
  `INSERT INTO operational_cost_item_versions (
     item_id, institution_id, version, change, item_json, reason, actor_officer_id, actor_account, at
   )
   SELECT i.id, i.institution_id, 1, 'RECORD',
     json_build_object(
       'spentOn', i.spent_on, 'purpose', i.purpose, 'quantity', NULL, 'unit', NULL, 'unitPriceIdr', NULL,
       'amountIdr', i.amount_idr, 'payee', i.payee,
       'fundingSource', CASE WHEN i.panjar_id IS NULL THEN json_build_object('kind', 'KAS_LEMBAGA')
                             ELSE json_build_object('kind', 'PANJAR', 'panjarId', i.panjar_id) END,
       'receiptId', i.receipt_id, 'status', 'ACTIVE'
     )::text,
     'Dipindahkan dari catatan biaya lama.', i.recorded_by_officer_id, i.recorded_by_account, i.recorded_at
   FROM operational_cost_items i
   JOIN disbursement_realization_expenses e ON e.id = i.id
   ON CONFLICT (item_id, version) DO NOTHING;`,
] as const;

const rowsOf = (result: any): any[] => (Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : []);
const seconds = (value: unknown): number => Number(value);

export function fundingSourceFrom(row: any): FundingSource {
  if (row.funding_kind === "TALANGAN") return { kind: "TALANGAN", holderOfficerId: row.holder_officer_id };
  if (row.funding_kind === "PANJAR") return { kind: "PANJAR", panjarId: row.panjar_id };
  return { kind: "KAS_LEMBAGA" };
}

/** The columns a funding source occupies, for writing. */
export function fundingColumns(source: FundingSource) {
  return {
    kind: source.kind,
    holderOfficerId: source.kind === "TALANGAN" ? source.holderOfficerId : null,
    panjarId: source.kind === "PANJAR" ? source.panjarId : null,
  };
}

export const costItemFrom = (row: any): CostItemRecord => ({
  id: row.id,
  proposalId: row.proposal_id,
  version: Number(row.version),
  status: row.status as CostItemStatus,
  spentOn: row.spent_on,
  purpose: row.purpose,
  quantity: row.quantity ?? null,
  unit: row.unit ?? null,
  unitPriceIdr: row.unit_price_idr ?? null,
  amountIdr: row.amount_idr,
  payee: row.payee,
  fundingSource: fundingSourceFrom(row),
  receiptId: row.receipt_id ?? null,
  reimbursementId: row.reimbursement_id ?? null,
  recordedByOfficerId: row.recorded_by_officer_id,
  recordedAt: seconds(row.recorded_at),
  updatedAt: seconds(row.updated_at),
});

/** The part of an item a version freezes: everything the officer typed, plus whether it counts. */
export const itemSnapshot = (item: CostItemInput, status: CostItemStatus) => ({
  spentOn: item.spentOn, purpose: item.purpose, quantity: item.quantity, unit: item.unit,
  unitPriceIdr: item.unitPriceIdr, amountIdr: item.amountIdr, payee: item.payee,
  fundingSource: item.fundingSource, receiptId: item.receiptId, status,
});

export const itemVersionFrom = (row: any): CostItemVersionRecord => ({
  itemId: row.item_id,
  version: Number(row.version),
  change: row.change as CostItemChange,
  // Versions frozen before receipts existed (#125) carry no receiptId.
  item: { receiptId: null, ...JSON.parse(row.item_json) },
  reason: row.reason ?? null,
  reportCorrectionFor: row.report_correction_package_id ?? null,
  actorOfficerId: row.actor_officer_id,
  actorAccount: row.actor_account,
  at: seconds(row.at),
});

const panjarReturnFrom = (row: any): PanjarReturnRecord => ({
  id: row.id,
  amountIdr: row.amount_idr,
  returnedOn: row.returned_on,
  reference: row.reference,
  recordedAt: seconds(row.recorded_at),
});

const panjarFrom = (row: any, returns: PanjarReturnRecord[]): PanjarRecord => ({
  id: row.id,
  proposalId: row.proposal_id,
  holderOfficerId: row.holder_officer_id,
  amountIdr: row.amount_idr,
  purpose: row.purpose,
  cashOutRef: row.cash_out_ref,
  issuedOn: row.issued_on,
  recordedByOfficerId: row.recorded_by_officer_id,
  recordedAt: seconds(row.recorded_at),
  returns,
});

export const reimbursementFrom = (row: any, itemIds: string[]): ReimbursementRecord => ({
  id: row.id,
  proposalId: row.proposal_id,
  holderOfficerId: row.holder_officer_id,
  itemIds,
  totalIdr: row.total_idr,
  paidOn: row.paid_on,
  reference: row.reference,
  recordedByOfficerId: row.recorded_by_officer_id,
  recordedAt: seconds(row.recorded_at),
});

export type OperationalCostState = {
  items: CostItemRecord[];
  panjar: PanjarRecord[];
  reimbursements: ReimbursementRecord[];
};

/**
 * Every cost row of one proposal, or of the whole institution when `proposalId` is null.
 * Ordered by recording, so a list reads in the order it was typed.
 */
export async function loadOperationalCosts(
  executor: Executor,
  institutionId: string,
  proposalId: string | null
): Promise<OperationalCostState> {
  const scope = (column: string) =>
    proposalId === null ? sql`` : sql` AND ${sql.identifier(column)} = ${proposalId}`;

  const itemRows = rowsOf(await executor.execute(sql`
    SELECT * FROM operational_cost_items
    WHERE institution_id = ${institutionId}${scope("proposal_id")}
    ORDER BY seq ASC
  `));
  const panjarRows = rowsOf(await executor.execute(sql`
    SELECT * FROM operational_cost_panjar
    WHERE institution_id = ${institutionId}${scope("proposal_id")}
    ORDER BY seq ASC
  `));
  const returnRows = panjarRows.length === 0 ? [] : rowsOf(await executor.execute(sql`
    SELECT * FROM operational_cost_panjar_returns
    WHERE institution_id = ${institutionId}
      AND panjar_id IN (${sql.join(panjarRows.map((row) => sql`${row.id}`), sql`, `)})
    ORDER BY seq ASC
  `));
  const reimbursementRows = rowsOf(await executor.execute(sql`
    SELECT * FROM operational_cost_reimbursements
    WHERE institution_id = ${institutionId}${scope("proposal_id")}
    ORDER BY seq ASC
  `));

  const items = itemRows.map(costItemFrom);
  return {
    items,
    panjar: panjarRows.map((row) =>
      panjarFrom(row, returnRows.filter((ret) => ret.panjar_id === row.id).map(panjarReturnFrom))
    ),
    reimbursements: reimbursementRows.map((row) =>
      reimbursementFrom(row, items.filter((item) => item.reimbursementId === row.id).map((item) => item.id))
    ),
  };
}

/** The private locator stays on the server; readers get everything else. */
export type StoredReceiptFile = ReceiptFileRecord & { storageRef: string };

export const receiptFileFrom = (row: any): StoredReceiptFile => ({
  id: row.id,
  receiptId: row.receipt_id,
  fileName: row.file_name,
  mimeType: row.mime_type as ReceiptFileType,
  sizeBytes: Number(row.size_bytes),
  contentSha256: row.content_sha256,
  uploadedByOfficerId: row.uploaded_by_officer_id,
  uploadedAt: seconds(row.uploaded_at),
  storageRef: row.storage_ref,
});

export const receiptFileView = ({ storageRef: _storageRef, ...file }: StoredReceiptFile): ReceiptFileRecord => file;

const receiptFrom = (row: any, files: ReceiptFileRecord[]): ReceiptRecord => ({
  id: row.id,
  proposalId: row.proposal_id,
  kind: row.kind as ReceiptKind,
  reference: row.reference,
  issuedOn: row.issued_on,
  issuer: row.issuer ?? null,
  recordedByOfficerId: row.recorded_by_officer_id,
  recordedAt: seconds(row.recorded_at),
  evidencedAt: row.evidenced_at === null || row.evidenced_at === undefined ? null : seconds(row.evidenced_at),
  legacy: row.legacy === true,
  files,
});

/** Every receipt of one proposal with its files, in the order they were recorded. */
export async function loadReceipts(executor: Executor, institutionId: string, proposalId: string): Promise<ReceiptRecord[]> {
  const receiptRows = rowsOf(await executor.execute(sql`
    SELECT * FROM operational_cost_receipts
    WHERE institution_id = ${institutionId} AND proposal_id = ${proposalId}
    ORDER BY seq ASC
  `));
  if (receiptRows.length === 0) return [];
  const fileRows = rowsOf(await executor.execute(sql`
    SELECT * FROM operational_cost_receipt_files
    WHERE institution_id = ${institutionId}
      AND receipt_id IN (${sql.join(receiptRows.map((row) => sql`${row.id}`), sql`, `)})
    ORDER BY seq ASC
  `));
  return receiptRows.map((row) =>
    receiptFrom(row, fileRows.filter((file) => file.receipt_id === row.id).map((file) => receiptFileView(receiptFileFrom(file))))
  );
}

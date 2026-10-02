/**
 * Biaya operasional penyaluran (ADR-0042): cost rows with a fund source, panjar,
 * talangan reimbursement, versioned correction, and nota/kuitansi with encrypted files.
 * Every write carries an `operationId` so a resend replays instead of recording twice.
 */
import type { PrivateRequests } from "../workspace/privateRequests";

export type FundingSource =
  | { kind: "KAS_LEMBAGA" }
  | { kind: "TALANGAN"; holderOfficerId: string }
  | { kind: "PANJAR"; panjarId: string };

export type CostItemInput = {
  spentOn: string;
  purpose: string;
  quantity: string | null;
  unit: string | null;
  unitPriceIdr: string | null;
  amountIdr: string;
  payee: string;
  fundingSource: FundingSource;
  receiptId: string | null;
};

export type CostItem = CostItemInput & {
  id: string;
  proposalId: string;
  version: number;
  status: "ACTIVE" | "VOIDED";
  reimbursementId: string | null;
  recordedByOfficerId: string;
  recordedAt: number;
  updatedAt: number;
};

export type CostItemVersion = {
  itemId: string;
  version: number;
  change: "RECORD" | "CORRECT" | "VOID";
  item: CostItemInput & { status: "ACTIVE" | "VOIDED" };
  reason: string | null;
  actorOfficerId: string;
  actorAccount: string;
  at: number;
};

export type Panjar = {
  id: string;
  proposalId: string;
  holderOfficerId: string;
  amountIdr: string;
  purpose: string;
  cashOutRef: string;
  issuedOn: string;
  recordedByOfficerId: string;
  recordedAt: number;
  returns: { id: string; amountIdr: string; returnedOn: string; reference: string; recordedAt: number }[];
};

export type Reimbursement = {
  id: string;
  holderOfficerId: string;
  itemIds: string[];
  totalIdr: string;
  paidOn: string;
  reference: string;
  recordedAt: number;
};

export type HolderSummary = {
  officerId: string;
  name: string;
  talanganOutstandingIdr: string;
  talanganReimbursedIdr: string;
  panjar: { panjarId: string; cashOutRef: string; amountIdr: string; usedIdr: string; returnedIdr: string; remainingIdr: string }[];
};

export type ReceiptKind = "NOTA" | "SURAT_PERNYATAAN";

export type ReceiptFile = {
  id: string;
  receiptId: string;
  fileName: string;
  mimeType: "image/jpeg" | "image/png" | "application/pdf";
  sizeBytes: number;
  contentSha256: string;
  uploadedByOfficerId: string;
  uploadedAt: number;
};

export type Receipt = {
  id: string;
  proposalId: string;
  kind: ReceiptKind;
  reference: string;
  issuedOn: string;
  issuer: string | null;
  recordedByOfficerId: string;
  recordedAt: number;
  /** Set once a recorded row cites it; its files can then no longer be deleted. */
  evidencedAt: number | null;
  /** Carried over from the old "Dokumen rujukan" text: the number only, no file. */
  legacy: boolean;
  files: ReceiptFile[];
};

export type OperationalCosts = {
  items: CostItem[];
  panjar: Panjar[];
  reimbursements: Reimbursement[];
  receipts: Receipt[];
  holders: HolderSummary[];
  totals: { directExpensesIdr: string; panjarAccountedIdr: string; panjarNetIdr: string; totalItemsIdr: string };
};

export type CostIssue = { field: string; message: string };
export type CostRecordingResult = { index: number; item: CostItem } | { index: number; issues: CostIssue[] };

export const RECEIPT_KIND_LABELS: Record<ReceiptKind, string> = {
  NOTA: "Nota/kuitansi",
  SURAT_PERNYATAAN: "Surat pernyataan",
};

const costs = (proposalId: string) => `/api/workspace/proposals/${proposalId}/operational-costs`;
const postJson = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const getOperationalCosts = (requests: PrivateRequests, proposalId: string) =>
  requests.json<OperationalCosts>(costs(proposalId));

export const listCostPurposes = (requests: PrivateRequests) =>
  requests.json<{ purposes: string[] }>("/api/workspace/operational-cost-purposes").then((r) => r.purposes);

export const recordCostItems = (requests: PrivateRequests, proposalId: string, input: { operationId: string; items: CostItemInput[] }) =>
  requests.json<{ results: CostRecordingResult[] }>(`${costs(proposalId)}/items`, postJson(input)).then((r) => r.results);

export const correctCostItem = (
  requests: PrivateRequests,
  proposalId: string,
  itemId: string,
  input: { operationId: string; expectedVersion: number; reason: string; item: CostItemInput },
) => requests.json<{ item: CostItem }>(`${costs(proposalId)}/items/${itemId}/correct`, postJson(input)).then((r) => r.item);

export const voidCostItem = (
  requests: PrivateRequests,
  proposalId: string,
  itemId: string,
  input: { operationId: string; expectedVersion: number; reason: string },
) => requests.json<{ item: CostItem }>(`${costs(proposalId)}/items/${itemId}/void`, postJson(input)).then((r) => r.item);

export const getCostItemHistory = (requests: PrivateRequests, proposalId: string, itemId: string) =>
  requests.json<{ history: CostItemVersion[] }>(`${costs(proposalId)}/items/${itemId}/history`).then((r) => r.history);

export const issuePanjar = (
  requests: PrivateRequests,
  proposalId: string,
  input: { operationId: string; holderOfficerId: string; amountIdr: string; purpose: string; cashOutRef: string; issuedOn: string },
) => requests.json<{ panjar: Panjar }>(`${costs(proposalId)}/panjar`, postJson(input)).then((r) => r.panjar);

export const returnPanjar = (
  requests: PrivateRequests,
  proposalId: string,
  panjarId: string,
  input: { operationId: string; amountIdr: string; returnedOn: string; reference: string },
) => requests.json<{ panjar: Panjar }>(`${costs(proposalId)}/panjar/${panjarId}/returns`, postJson(input)).then((r) => r.panjar);

export const reimburseTalangan = (
  requests: PrivateRequests,
  proposalId: string,
  input: { operationId: string; holderOfficerId: string; itemIds: string[]; paidOn: string; reference: string },
) => requests.json<{ reimbursement: Reimbursement }>(`${costs(proposalId)}/reimbursements`, postJson(input)).then((r) => r.reimbursement);

export const createReceipt = (
  requests: PrivateRequests,
  proposalId: string,
  input: { operationId: string; kind: ReceiptKind; reference: string; issuedOn: string; issuer: string | null },
) => requests.json<{ receipt: Receipt }>(`${costs(proposalId)}/receipts`, postJson(input)).then((r) => r.receipt);

export const uploadReceiptFile = (
  requests: PrivateRequests,
  proposalId: string,
  receiptId: string,
  input: { operationId: string; fileName: string; mimeType: string; contentBase64: string },
) => requests.json<{ file: ReceiptFile }>(`${costs(proposalId)}/receipts/${receiptId}/files`, postJson(input)).then((r) => r.file);

/** The server checks the file against its SHA-256 and refuses a mismatch instead of serving it. */
export const downloadReceiptFile = (requests: PrivateRequests, proposalId: string, receiptId: string, fileId: string) =>
  requests.blob(`${costs(proposalId)}/receipts/${receiptId}/files/${fileId}`);

export const deleteReceiptFile = (requests: PrivateRequests, proposalId: string, receiptId: string, fileId: string) =>
  requests.json<null>(`${costs(proposalId)}/receipts/${receiptId}/files/${fileId}`, { method: "DELETE" });

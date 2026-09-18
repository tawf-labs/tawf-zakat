/**
 * The frozen provenance of a disbursement realization source (Spec #86, ticket #98).
 *
 * Shared by the server that writes it into an evidence package and the workspace
 * that reads it back for drill-down, so the two cannot drift apart. Every field
 * is copied at freeze time: nothing here is a pointer to live data.
 */

export type ProvenanceRole = "CLAIM" | "SOURCE";

/**
 * The file each side's provenance is frozen into. The names are reserved: an
 * uploaded attachment may not use them, so a file found under one of these names
 * was written by the server and not supplied by whoever prepared the package.
 */
export const PROVENANCE_FILE_NAMES: Record<ProvenanceRole, string> = {
  CLAIM: "realization-provenance-claim.json",
  SOURCE: "realization-provenance-source.json",
};

export const isReservedProvenanceFileName = (fileName: string): boolean =>
  Object.values(PROVENANCE_FILE_NAMES).includes(fileName);

export type ProvenanceDocument = {
  id: string;
  documentType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  createdAt: number;
};

export type ProvenanceDispute = {
  id: string;
  subject: string;
  status: string;
  reason: string;
  createdAt: number;
};

export type ProvenanceRealization = {
  realizationId: string;
  proposalId: string;
  proposalVersion: number;
  programId: string | null;
  programName: string | null;
  purpose: string;
  aidLineId: string;
  beneficiary: {
    id: string;
    name: string;
    asnaf?: string | null;
    nikMasked?: string | null;
  };
  method: string;
  amountIdr: string | null;
  quantity: string | null;
  unit: string | null;
  reportedAt: number;
  recordedAt: number;
  /** Status as observed at `frozenAt`, not reconstructed as of the cut-off. */
  evidenceStatus: string;
  confirmationStatus: string;
  confirmationMethod: string | null;
  /** Only documents attached at or before the cut-off. */
  documents: ProvenanceDocument[];
  /** Only disputes raised at or before the cut-off. */
  disputes: ProvenanceDispute[];
};

export type RealizationProvenance = {
  format: "tawf.realization.provenance";
  version: 2;
  role: ProvenanceRole;
  institutionId: string;
  period: { kind: string; year: number };
  cutOff: string;
  frozenAt: number;
  totals: {
    totalRealizedIdr: string;
    beneficiaryCount: number;
    /** Money and goods handovers alike. */
    handoverEventCount: number;
    goods: Array<{ unit: string; totalQuantity: string; count: number }>;
    advancesIdr: string;
    expensesIdr: string;
  };
  realizations: ProvenanceRealization[];
  /** In the period but recorded after the cut-off: not yet examined, not absent. */
  excludedAfterCutOff: Array<{ realizationId: string; reportedAt: number; recordedAt: number }>;
  advances: Array<{ id: string; amountIdr: string; purpose: string; reference: string; issuedAt: number }>;
  expenses: Array<{
    id: string;
    advanceId: string | null;
    amountIdr: string;
    purpose: string;
    payee: string;
    recordedAt: number;
  }>;
};

/**
 * The live operational state of a frozen realization, read at `observedAt`.
 *
 * Shown beside the snapshot, never merged into it: the snapshot answers what the
 * package was examined against, this answers what the working data says now.
 */
export type RealizationCurrentStatus = {
  realizationId: string;
  /** False when the realization no longer exists in the working data. */
  found: boolean;
  evidenceStatus: string | null;
  confirmationStatus: string | null;
  confirmationMethod: string | null;
  documentCount: number;
  disputes: Array<{ id: string; subject: string; status: string; createdAt: number }>;
};

export type RealizationCurrentView =
  | { available: true; observedAt: number; realizations: RealizationCurrentStatus[] }
  | { available: false; observedAt: number; reason: string };

/** What `GET /api/evidence/:id/drill-down` answers. */
export type RealizationDrillDown =
  | {
      available: true;
      transactionDetail: "PRESENT";
      provenances: RealizationProvenance[];
      current: RealizationCurrentView;
      /** Sides whose provenance file exists but could not be read. */
      unreadable: Array<{ role: ProvenanceRole; status: "FAILED" | "UNAVAILABLE"; reason: string }>;
    }
  | {
      available: false;
      transactionDetail: "NOT_AVAILABLE" | "NO_REALIZATION_SOURCE";
      reason: string;
      unreadable: Array<{ role: ProvenanceRole; status: "FAILED" | "UNAVAILABLE"; reason: string }>;
    };

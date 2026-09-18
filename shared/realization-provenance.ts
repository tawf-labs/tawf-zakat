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

/** One contribution allocation to an activity, as recorded at or before the cut-off. */
export type ProvenanceAllocation = {
  allocationId: string;
  contributionId: string;
  /** The contribution version the officer allocated against. */
  contributionVersion: number;
  amountExact: string;
  currencyUnit: string;
  fundType: string;
  allocatedAt: number;
  /** Contribution status as observed at freeze time. */
  contributionStatus: string;
  /** False when the contribution carries no donor detail; the donor is never invented. */
  donorRecorded: boolean;
};

/**
 * A distribution activity the frozen realizations belong to, with the contribution
 * allocations recorded for it by the cut-off. Allocations are pooled funding
 * commitments: they do not say a given donor financed a given recipient.
 */
export type ProvenanceActivity = {
  activityId: string;
  proposalId: string;
  proposalVersion: number;
  name: string;
  programFundType: string;
  targetAmount: string;
  targetIsPartial: boolean;
  createdAt: number;
  realizationIds: string[];
  /** Allocated totals per currency unit, from the allocations below. */
  allocatedByUnit: Record<string, string>;
  allocations: ProvenanceAllocation[];
};

export type ProvenanceActivityTrace =
  | {
      available: true;
      /** What the tracing covers and what it does not claim. */
      coverage: string;
      disclaimer: string;
      activities: ProvenanceActivity[];
      /** Frozen realizations with no activity for their proposal version at the cut-off. */
      realizationsWithoutActivity: string[];
      /** Distinct allocated contributions without donor detail. */
      contributionsWithoutDonor: number;
    }
  | { available: false; reason: string };

/**
 * The goods aid line a handover belongs to, as valued in the proposal version.
 * A rupiah value is present only with the institution's stated basis; it is an
 * estimate for the whole line and is never added to realized rupiah.
 */
export type ProvenanceGoodsValuation = {
  unit: string;
  /** Null when the version snapshot does not carry it; never read from the live draft. */
  quantityApproved: string | null;
  valuedAmountIdr: string | null;
  valuationBasis: string | null;
};

export type ProvenanceRealization = {
  realizationId: string;
  /** The activity for this realization's proposal version at the cut-off, if one existed. */
  activityId: string | null;
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
  /** Goods lines only: the line's valuation in the proposal version, or null for money. */
  aidLineValuation: ProvenanceGoodsValuation | null;
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
    /** Advances not yet accounted for by linked expenses at the cut-off. */
    unaccountedAdvancesIdr: string;
  };
  realizations: ProvenanceRealization[];
  /** Activities and contribution allocations the realizations trace to at the cut-off. */
  activityTrace: ProvenanceActivityTrace;
  /** In the period but recorded after the cut-off: not yet examined, not absent. */
  excludedAfterCutOff: Array<{ realizationId: string; reportedAt: number; recordedAt: number }>;
  advances: Array<{
    id: string;
    amountIdr: string;
    purpose: string;
    reference: string;
    issuedAt: number;
    /** Linked expenses recorded by the cut-off. */
    accountedIdr: string;
    /** What remains to be accounted for; negative when expenses exceed the advance. */
    unaccountedIdr: string;
  }>;
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

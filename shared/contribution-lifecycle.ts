/** Contribution correction/refund wire contracts shared by the API and UI. */
export const CORRECTION_TYPES = ["AMOUNT", "DUPLICATE"] as const;
export type CorrectionType = (typeof CORRECTION_TYPES)[number];

export const isCorrectionType = (value: unknown): value is CorrectionType =>
  typeof value === "string" && (CORRECTION_TYPES as readonly string[]).includes(value as CorrectionType);

export type ContributionCorrection = {
  id: string;
  institutionId: string;
  contributionId: string;
  fromVersion: number;
  toVersion: number;
  correctionType: CorrectionType;
  fromAmountExact: string;
  toAmountExact: string;
  reason: string;
  sourceProofRef: string;
  actorAccount: string;
  actorOfficerId: string | null;
  createdAt: number;
};

export const REFUND_STATUSES = ["DECIDED", "PAID", "CANCELLED"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const isRefundStatus = (value: unknown): value is RefundStatus =>
  typeof value === "string" && (REFUND_STATUSES as readonly string[]).includes(value as RefundStatus);

export type ContributionRefund = {
  id: string;
  institutionId: string;
  contributionId: string;
  amountExact: string;
  currencyUnit: "IDR" | "USDC_6DP";
  fundType: "ZAKAT" | "FITRAH" | "INFAK_SEDEKAH" | "KURBAN" | "DSKL";
  reason: string;
  policyBasis: string;
  status: RefundStatus;
  contributionVersion: number;
  decidedAt: number;
  decidedBy: string;
  decidedByOfficerId: string | null;
  paidAt: number | null;
  paidBy: string | null;
  paidByOfficerId: string | null;
  paymentProofRef: string | null;
  paymentNotes: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type ContributionEvent = {
  id: number;
  institutionId: string;
  contributionId: string;
  version: number;
  previousVersion: number;
  eventType: "CORRECTION" | "REFUND_DECISION" | "REFUND_PAYMENT" | "ENDORSEMENT" | "RECONCILIATION";
  amountExact: string;
  reason: string;
  sourceProofRef: string | null;
  actorAccount: string;
  actorOfficerId: string | null;
  occurredAt: number;
  proofSuperseded: boolean;
};

export type ContributionProofValidity = {
  status: "CURRENT" | "SUPERSEDED" | "NOT_AVAILABLE";
  isCurrent: boolean;
  label: string;
};

/** Donor projection excludes internal source locators and operator identities. */
export type DonorContributionCorrection = Pick<ContributionCorrection,
  "fromVersion" | "toVersion" | "correctionType" | "fromAmountExact" | "toAmountExact" | "reason" | "createdAt"
>;

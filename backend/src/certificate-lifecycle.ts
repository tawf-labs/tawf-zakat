/**
 * Pure currentness rules for distribution certificates (Spec #100, ticket #112).
 *
 * A token proves that an authorized signer endorsed fixed content at a moment; it never proves
 * that the content is still true. This module derives the three things a reader needs apart:
 * what the source says now about the frozen scope, how publication of a successor is going,
 * and the resulting business validity. No database, no chain, no clock.
 */
import type {
  CertificateMintState, CertificateValidity, ReplacementState, ScopeSourceStatus,
} from "../../shared/certificate-nft";
import type { CertificateContent } from "./certificate-content";
import type { RealizationRecord } from "./disbursement";

export type ScopeAssessment = {
  sourceStatus: ScopeSourceStatus;
  disputedIds: string[];
  changedIds: string[];
};

/**
 * Compare the frozen lines with the realizations as they stand now. Only fields the certificate
 * actually states are compared (amount, quantity, unit, confirmation). Evidence completeness is
 * deliberately not one of them: a missing document is not a dispute and does not by itself change
 * what the certificate claims. Realizations added after the freeze belong to a later stage.
 */
export function assessScope(content: CertificateContent, current: RealizationRecord[]): ScopeAssessment {
  const byId = new Map(current.map((r) => [r.id, r]));
  const disputedIds: string[] = [];
  const changedIds: string[] = [];
  for (const line of content.realizations) {
    const now = byId.get(line.realizationId);
    if (!now) { changedIds.push(line.realizationId); continue; }
    if (now.confirmationStatus === "DISPUTED") disputedIds.push(line.realizationId);
    if (now.amountIdr !== line.amountIdr || now.quantity !== line.quantity || now.unit !== line.unit
      || now.confirmationStatus !== line.confirmationStatus) changedIds.push(line.realizationId);
  }
  const sourceStatus: ScopeSourceStatus = disputedIds.length ? "DISPUTED" : changedIds.length ? "CHANGED" : "MATCHES";
  return { sourceStatus, disputedIds, changedIds };
}

export type SuccessorObservation = {
  /** A signed transaction has been stored for the successor (the endorsement was submitted). */
  hasAttempt: boolean;
  state: CertificateMintState;
};

/** Publication of a successor as an officer or verifier should read it. */
export function replacementStateOf(successor: SuccessorObservation | null, chainSuccessorUnverified = false): ReplacementState {
  if (!successor) return chainSuccessorUnverified ? "UNVERIFIED_CHAIN_SUCCESSOR" : "NONE";
  if (!successor.hasAttempt) return "PREPARED";
  switch (successor.state) {
    case "CONFIRMED": return "CONFIRMED";
    case "INCLUDED": return "INCLUDED_PENDING_CONFIRMATION";
    case "NONCANONICAL": return "NONCANONICAL_PENDING";
    case "REVERTED": case "INVALID_EVENT": return "FAILED";
    default: return "ENDORSED_PENDING_MINT";
  }
}

/**
 * Business currentness of one version. Precedence puts the most specific reason a version is not
 * current first; DISPUTED / SOURCE_CHANGED still surface through `scope` when a replacement is
 * pending. A failed or reorged successor never restores the predecessor: the source that made the
 * correction necessary has not stopped being different.
 */
export function validityOf(input: {
  ownState: CertificateMintState; replacement: ReplacementState; scope: ScopeSourceStatus;
}): CertificateValidity {
  if (input.replacement === "CONFIRMED") return "SUPERSEDED";
  if (input.replacement === "FAILED") return "REPLACEMENT_FAILED";
  if (input.replacement !== "NONE" && input.replacement !== "PREPARED") return "REPLACEMENT_PENDING";
  if (input.scope === "DISPUTED") return "DISPUTED";
  if (input.scope === "CHANGED") return "SOURCE_CHANGED";
  return input.ownState === "CONFIRMED" ? "CURRENT" : "PENDING_CONFIRMATION";
}

/** A correction must state something new (a no-op successor is refused) and give a reason the source supports. */
export function correctionJustified(reason: "SOURCE_CORRECTION" | "DISPUTE_DISCLOSURE", scope: ScopeAssessment): boolean {
  if (scope.changedIds.length === 0) return false;
  return reason === "DISPUTE_DISCLOSURE" ? scope.disputedIds.length > 0 : true;
}

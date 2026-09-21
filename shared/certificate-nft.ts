/** EIP-712 wire protocol for distribution-stage certificate issuance (#111). A distinct domain
 * and action from `report-registry.ts` so no report-registry signature is ever replayable here,
 * and vice versa. */
export type Hex = `0x${string}`;
export type CertificateDomain = { name: "Tawf Distribution Certificate"; version: "1"; chainId: number; verifyingContract: Hex };
export const ISSUE_CERTIFICATE = "ISSUE_CERTIFICATE" as const;
export const certificationTypes = { Certification: [
  { name: "action", type: "bytes32" },
  { name: "institutionId", type: "string" },
  { name: "activityId", type: "string" },
  { name: "certificateId", type: "string" },
  { name: "version", type: "string" },
  { name: "predecessor", type: "string" },
  { name: "digest", type: "bytes32" },
  { name: "signer", type: "address" },
  { name: "authorityEpoch", type: "uint256" },
  { name: "nonce", type: "bytes32" },
  { name: "deadline", type: "uint256" },
] } as const;
export type Certification = {
  action: Hex; institutionId: string; activityId: string; certificateId: string; version: string;
  predecessor: string; digest: Hex; signer: Hex; authorityEpoch: string; nonce: Hex; deadline: string;
};
export const contractCertification = (c: Certification) => ({ ...c, authorityEpoch: BigInt(c.authorityEpoch), deadline: BigInt(c.deadline) });
export const certificationTypedData = (domain: CertificateDomain, c: Certification) => ({
  domain, primaryType: "Certification" as const, types: certificationTypes, message: contractCertification(c),
});

/** Same vocabulary as report-registry's `RecordingObservation`: re-derived from the chain on every
 * read, never trusted from the last write. A separate type so the two domains cannot drift by
 * sharing one that happens to look the same today. */
export type CertificateMintState =
  | "PREPARED" | "SUBMITTED" | "INCLUDED" | "CONFIRMED" | "REVERTED" | "INVALID_EVENT" | "NONCANONICAL";
export type CertificateMintObservation = {
  state: CertificateMintState; confirmations: number; requiredConfirmations: number; confirmationPolicy: string;
  blockNumber?: string; blockHash?: Hex; logIndex?: number; blockTimestamp?: string; tokenId?: string;
};
export type CertificateIssuanceIntent = {
  id: string; domain: CertificateDomain; certification: Certification; certificationDigest: Hex;
  signingAuthority?: "CURRENT" | "STALE" | "UNAVAILABLE" | "HISTORICAL";
  accountKind: "EOA" | "ERC1271"; observation: CertificateMintObservation; transactionHash?: Hex;
};

/** EIP-712 wire protocol for custody recovery (#113): a signatory endorses minting a replacement
 * token to the institution's resolved custodian. A distinct action and type from issuance, so an
 * issuance endorsement can never be replayed as a recovery. */
export const RECOVER_CUSTODY = "RECOVER_CUSTODY" as const;
export const recoveryTypes = { CustodyRecovery: [
  { name: "action", type: "bytes32" },
  { name: "institutionId", type: "string" },
  { name: "certificateId", type: "string" },
  { name: "version", type: "string" },
  { name: "newCustodian", type: "address" },
  { name: "basisDigest", type: "bytes32" },
  { name: "signer", type: "address" },
  { name: "authorityEpoch", type: "uint256" },
  { name: "nonce", type: "bytes32" },
  { name: "deadline", type: "uint256" },
] } as const;
export type CustodyRecovery = {
  action: Hex; institutionId: string; certificateId: string; version: string; newCustodian: Hex;
  basisDigest: Hex; signer: Hex; authorityEpoch: string; nonce: Hex; deadline: string;
};
export const contractRecovery = (r: CustodyRecovery) => ({ ...r, authorityEpoch: BigInt(r.authorityEpoch), deadline: BigInt(r.deadline) });
export const recoveryTypedData = (domain: CertificateDomain, r: CustodyRecovery) => ({
  domain, primaryType: "CustodyRecovery" as const, types: recoveryTypes, message: contractRecovery(r),
});
export type CustodyRecoveryIntent = {
  id: string; certificateId: string; version: string; domain: CertificateDomain;
  recovery: CustodyRecovery; recoveryDigest: Hex;
  /** Reference to the institution's decision (for example a letter number). The chain only sees its hash. */
  decisionRef: string; previousCustodian: Hex;
  /** Set once the endorsement was seen to be stale; it is never reactivated, even if the chain later matches again. */
  voided?: true;
  /** STALE once mandate, designated custodian or official version no longer match what was signed. */
  signingAuthority?: "CURRENT" | "STALE" | "UNAVAILABLE" | "HISTORICAL";
  accountKind: "EOA" | "ERC1271"; observation: CertificateMintObservation; transactionHash?: Hex;
};
/** Chain-only custody facts of one token, oldest replaced token first. */
export type PublicCustodyToken = { tokenId: string; holder: Hex; status: "ACTIVE" | "REPLACED" };

/** Why a successor version exists. Validated server-side against what the source actually shows:
 * a reason that the current source does not support is refused, not stored. */
export const CORRECTION_REASONS = ["SOURCE_CORRECTION", "DISPUTE_DISCLOSURE"] as const;
export type CorrectionReason = (typeof CORRECTION_REASONS)[number];
export const isCorrectionReason = (v: unknown): v is CorrectionReason =>
  typeof v === "string" && (CORRECTION_REASONS as readonly string[]).includes(v);

/** Latest realization/dispute state of the frozen scope, compared field by field with what the
 * certificate froze. Missing documents alone never appear here: evidence completeness is not a
 * dispute, and a realization added later is a different stage, not a change to this one. */
export type ScopeSourceStatus = "MATCHES" | "CHANGED" | "DISPUTED";

/** Publication of the successor version, kept apart from whether the predecessor still stands. */
export type ReplacementState =
  | "NONE" | "PREPARED" | "ENDORSED_PENDING_MINT" | "INCLUDED_PENDING_CONFIRMATION"
  | "NONCANONICAL_PENDING" | "CONFIRMED" | "FAILED" | "UNVERIFIED_CHAIN_SUCCESSOR";

/** Business currentness of one version. CURRENT needs all of: own mint confirmed, no
 * successor in any state, and the frozen scope unchanged and undisputed. */
export type CertificateValidity =
  | "CURRENT" | "PENDING_CONFIRMATION" | "DISPUTED" | "SOURCE_CHANGED"
  | "REPLACEMENT_PENDING" | "REPLACEMENT_FAILED" | "SUPERSEDED";

export type PublicCertificateVersion = {
  version: string; predecessor: string; tokenId: string | null; validity: CertificateValidity;
  replacement: ReplacementState; observationState: CertificateMintState;
};

/** Allowlisted public aggregate for the certificate verifier; never includes beneficiary detail. */
export type PublicCertificateSummary = {
  tokenId: string; institutionId: string; activityId: string; certificateId: string; version: string;
  issuer: Hex; contentDigest: Hex; custodian: Hex;
  observation: CertificateMintObservation;
  totals: { confirmedCount: number; disputedCount: number; unconfirmedCount: number; totalRealizedIdr: string };
  /** Present from #112 on; older servers omit them, so readers must not assume a "current" label. */
  validity?: CertificateValidity;
  scope?: { sourceStatus: ScopeSourceStatus; disputedCount: number; changedCount: number };
  replacement?: { state: ReplacementState; version?: string; tokenId?: string };
  predecessor?: { version: string; tokenId?: string };
  /** Only the reason code is public; the officer's free-text note stays in the workspace view. */
  correction?: { reason: CorrectionReason };
  history?: PublicCertificateVersion[];
  /** Present when the token was replaced by custody recovery: original issuer/content are unchanged. */
  custody?: { current: boolean; tokens: PublicCustodyToken[]; recoveryReason?: "CUSTODY_RECOVERY" };
};

/** What a workspace operator sees for one version, including the scope drift that would justify a correction. */
export type CertificateLineVersion = PublicCertificateVersion & {
  intentId: string; endorsed: boolean; correction?: { reason: CorrectionReason; note: string };
};
export type CertificateLineStatus = {
  certificateId: string; headVersion: string | null; headTokenId?: string;
  /** Holder of the official token versus the institution's resolved custodian on the contract. */
  custody?: { holder: Hex; resolvedCustodian: Hex; recoveryNeeded: boolean };
  versions: CertificateLineVersion[];
  scope: { sourceStatus: ScopeSourceStatus; disputedCount: number; changedCount: number } | null;
  correctionAllowed: boolean;
};

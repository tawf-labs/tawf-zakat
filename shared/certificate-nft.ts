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

/** Allowlisted public aggregate for the certificate verifier; never includes beneficiary detail. */
export type PublicCertificateSummary = {
  tokenId: string; institutionId: string; activityId: string; certificateId: string; version: string;
  issuer: Hex; contentDigest: Hex; custodian: Hex;
  observation: CertificateMintObservation;
  totals: { confirmedCount: number; disputedCount: number; unconfirmedCount: number; totalRealizedIdr: string };
};

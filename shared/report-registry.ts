/** EIP-712 wire protocol shared by package review, wallet and relayer. */
export type Hex = `0x${string}`;
export type RegistryDomain = { name: "Tawf Report Evidence"; version: "1"; chainId: number; verifyingContract: Hex };
export const authorizationTypes = { Authorization: [
  { name: "action", type: "bytes32" },
  { name: "institutionId", type: "string" },
  { name: "reportId", type: "string" },
  { name: "version", type: "string" },
  { name: "packageId", type: "string" },
  { name: "predecessor", type: "string" },
  { name: "digest", type: "bytes32" },
  { name: "policy", type: "string" },
  { name: "outcome", type: "string" },
  { name: "signer", type: "address" },
  { name: "authorityEpoch", type: "uint256" },
  { name: "nonce", type: "bytes32" },
  { name: "deadline", type: "uint256" },
] } as const;
export type EvidenceAuthorization = {
  action: Hex; institutionId: string; reportId: string; version: string; packageId: string;
  predecessor: string; digest: Hex; policy: string; outcome: string; signer: Hex;
  authorityEpoch: string; nonce: Hex; deadline: string;
};
export const contractAuthorization = (a: EvidenceAuthorization) => ({ ...a, authorityEpoch: BigInt(a.authorityEpoch), deadline: BigInt(a.deadline) });
export const evidenceTypedData = (domain: RegistryDomain, a: EvidenceAuthorization) => ({
  domain, primaryType: "Authorization" as const, types: authorizationTypes, message: contractAuthorization(a),
});
export type RecordingObservation = {
  state: "PREPARED" | "SUBMITTED" | "INCLUDED" | "CONFIRMED" | "REVERTED" | "INVALID_EVENT" | "NONCANONICAL";
  confirmations: number; requiredConfirmations: number; confirmationPolicy: string;
  blockNumber?: string; blockHash?: Hex; logIndex?: number; blockTimestamp?: string;
};
export type RecordingIntent = {
  validator?: { authorization: EvidenceAuthorization; authorizationDigest: Hex; signature: Hex };
  id: string; domain: RegistryDomain; authorization: EvidenceAuthorization; authorizationDigest: Hex;
  accountKind: "EOA" | "ERC1271"; observation: RecordingObservation; transactionHash?: Hex;
};

/** The registry's fixed attestation vocabulary. Unfavourable conclusions are first-class members. */
export const ATTESTATION_SCOPES = ["REKONSILIASI_PERIODE", "SUMBER_DAN_KOMITMEN", "TINDAK_LANJUT_TEMUAN"] as const;
export const ATTESTATION_CONCLUSIONS = ["WAJAR_TANPA_PENGECUALIAN", "WAJAR_DENGAN_PENGECUALIAN", "TIDAK_WAJAR", "TIDAK_MENYATAKAN_PENDAPAT"] as const;
export type AttestationScope = (typeof ATTESTATION_SCOPES)[number];
export type AttestationConclusion = (typeof ATTESTATION_CONCLUSIONS)[number];
/** No predecessor: the zero reference, never an empty string. */
export const NO_ATTESTATION = `0x${"0".repeat(64)}` as Hex;

/** Auditor examination note over one published version. A conclusion, never an endorsement. */
export const attestationTypes = { Attestation: [
  { name: "action", type: "bytes32" },
  { name: "institutionId", type: "string" },
  { name: "reportId", type: "string" },
  { name: "version", type: "string" },
  { name: "packageId", type: "string" },
  { name: "packageDigest", type: "bytes32" },
  { name: "scope", type: "string" },
  { name: "conclusion", type: "string" },
  { name: "evidenceCommitment", type: "bytes32" },
  { name: "predecessor", type: "bytes32" },
  { name: "auditor", type: "address" },
  { name: "authorityEpoch", type: "uint256" },
  { name: "nonce", type: "bytes32" },
  { name: "deadline", type: "uint256" },
] } as const;
export type AttestationStatement = {
  action: Hex; institutionId: string; reportId: string; version: string; packageId: string;
  packageDigest: Hex; scope: AttestationScope; conclusion: AttestationConclusion;
  evidenceCommitment: Hex; predecessor: Hex; auditor: Hex; authorityEpoch: string; nonce: Hex; deadline: string;
};
export const contractAttestation = (a: AttestationStatement) => ({ ...a, authorityEpoch: BigInt(a.authorityEpoch), deadline: BigInt(a.deadline) });
export const attestationTypedData = (domain: RegistryDomain, a: AttestationStatement) => ({
  domain, primaryType: "Attestation" as const, types: attestationTypes, message: contractAttestation(a),
});
/** One examination evidence file as the auditor's commitment binds it; bytes stay in the private store. */
export type AttestationEvidenceFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; contentSha256: string };
export type AttestationIntent = {
  id: string; domain: RegistryDomain; statement: AttestationStatement; statementDigest: Hex;
  accountKind: "EOA" | "ERC1271"; observation: RecordingObservation; transactionHash?: Hex;
  evidence: { commitmentScheme: "HMAC-SHA256"; salt: Hex; files: AttestationEvidenceFile[];
    /** Deployment-private locators; excluded from commitments and HTTP responses. */
    storageRefs?: Record<string, string> };
};

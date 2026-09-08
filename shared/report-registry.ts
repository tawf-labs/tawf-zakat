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

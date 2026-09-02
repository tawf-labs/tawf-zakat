export const ZAKAT_PROTOCOL_L1_ADDRESS = "0x5f2394e6bc3dd842831c66253d4433f4f72b4e7b";
export const SEPOLIA_USDC_ADDRESS = "0xdb10a1ee7a3a628353d0d29db60f99d46d41e30d" as const;

export const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
export const SEPOLIA_CHAIN_ID = 421614;
export const SEPOLIA_EXPLORER_URL = "https://sepolia.arbiscan.io";
export const ARBISCAN_EXPLORER_URL = "https://sepolia.arbiscan.io";

export const PINATA_DEDICATED_GATEWAY = "https://white-lazy-marten-351.mypinata.cloud/ipfs";
export const PUBLIC_IPFS_GATEWAY = "https://ipfs.io/ipfs";

export function getIpfsUrl(cid?: string | null, preferredGateway = PINATA_DEDICATED_GATEWAY): string {
  if (!cid) return "";
  const cleanCid = cid.replace(/^ipfs:\/\//, "");
  return `${preferredGateway}/${cleanCid}`;
}

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
] as const;

export const ZAKAT_PROTOCOL_ABI = [
  {
    type: "function",
    name: "depositUSDC",
    inputs: [
      { name: "_amountUSDC", type: "uint256" },
      { name: "_isAnonymous", type: "bool" },
      { name: "_anonymousCommitment", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "recordFiatBatchSettlement",
    inputs: [
      { name: "_batchId", type: "uint256" },
      { name: "_merkleRoot", type: "bytes32" },
      { name: "_totalBatchAmountIDR", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "proposeDisbursement",
    inputs: [
      { name: "_currencyType", type: "uint8" },
      { name: "_amount", type: "uint256" },
      { name: "_asnafCategory", type: "uint8" },
      { name: "_beneficiaryHash", type: "bytes32" },
      { name: "_ipfsProofCID", type: "string" },
      { name: "_periodId", type: "uint256" },
      { name: "_usdcRecipient", type: "address" },
    ],
    outputs: [{ name: "proposalId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "approveDisbursement",
    inputs: [{ name: "_proposalId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelProposal",
    inputs: [
      { name: "_proposalId", type: "uint256" },
      { name: "_reason", type: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "executeDisbursement",
    inputs: [{ name: "_proposalId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdrawAmilShareUSDC",
    inputs: [
      { name: "_to", type: "address" },
      { name: "_amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "MAX_AMIL_BPS",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "fiatBatchRoots",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalCollectedIDR",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "mustahikVaultIDR",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "amilTreasuryIDR",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalDisbursedIDR",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalCollectedUSDC",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "mustahikVaultUSDC",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "amilTreasuryUSDC",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalDisbursedUSDC",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "proposalCounter",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasReceivedZakat",
    inputs: [
      { name: "", type: "bytes32" },
      { name: "", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "grantRole",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revokeRole",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const GOVERNANCE_ROLES = {
  DEFAULT_ADMIN_ROLE: "0x0000000000000000000000000000000000000000000000000000000000000000",
  SHARIA_SUPERVISOR_ROLE: "0x59a1c48e5837ad7a7f3dcedcbe129bf3249ec4fbf651fd4f5e2600ead39fe2f5",
  AUDITOR_ROLE: "0x3003ae5751e460db709762380ceeb0a0a748c8f2a9e2fe711468f692be74570c",
  RELAYER_ROLE: "0xe2b7fb3b832174769106daebcfd6d1970523240dda11281102db9363b83b0dc4",
} as const;

export const SAFE_DPS_MULTISIG_ADDRESS = "0xb4E4253e2aFfdC0710Cb9394b8C4E935F11B00f1" as const;

export const GOVERNANCE_EIP712_DOMAIN = {
  name: "Tawf Zakat Protocol",
  version: "1",
  chainId: 421614,
  verifyingContract: ZAKAT_PROTOCOL_L1_ADDRESS as `0x${string}`,
} as const;

export const GOVERNANCE_EIP712_TYPES = {
  AmilProposal: [
    { name: "currencyType", type: "uint8" },
    { name: "amount", type: "uint256" },
    { name: "asnafCategory", type: "uint8" },
    { name: "beneficiaryHash", type: "bytes32" },
    { name: "ipfsProofCID", type: "string" },
    { name: "periodId", type: "uint256" },
    { name: "usdcRecipient", type: "address" },
    { name: "timestamp", type: "uint256" },
  ],
  DpsApproval: [
    { name: "proposalId", type: "uint256" },
    { name: "decision", type: "string" },
    { name: "notes", type: "string" },
    { name: "timestamp", type: "uint256" },
  ],
  AmilExecution: [
    { name: "proposalId", type: "uint256" },
    { name: "disbursementReceiptCID", type: "string" },
    { name: "timestamp", type: "uint256" },
  ],
  ProposalCancellation: [
    { name: "proposalId", type: "uint256" },
    { name: "reason", type: "string" },
    { name: "timestamp", type: "uint256" },
  ],
  AuditorAttestation: [
    { name: "proposalId", type: "uint256" },
    { name: "beneficiaryHash", type: "bytes32" },
    { name: "amountIDR", type: "uint256" },
    { name: "auditOpinion", type: "string" },
    { name: "standard", type: "string" },
    { name: "auditorName", type: "string" },
    { name: "timestamp", type: "uint256" },
  ],
} as const;


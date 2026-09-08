import { createPublicClient, decodeEventLog, http, parseAbi, verifyMessage, type Hex } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { CONTRACT_CONFIG } from "./config";

export const GOVERNANCE_ABI = parseAbi([
  "function proposals(uint256) view returns (uint256 proposalId,uint8 currencyType,uint256 amount,uint8 asnafCategory,bytes32 beneficiaryHash,string ipfsProofCID,uint256 periodId,address usdcRecipient,uint256 approvalCount,uint8 status)",
  "event DisbursementProposed(uint256 indexed proposalId,uint8 currencyType,uint256 amount,bytes32 beneficiaryHash,string ipfsProofCID)",
  "event DisbursementApproved(uint256 indexed proposalId,address indexed approver,uint256 currentApprovals)",
  "event DisbursementExecuted(uint256 indexed proposalId,uint8 currencyType,uint256 amount,bytes32 beneficiaryHash,string ipfsProofCID)",
  "event DisbursementCancelled(uint256 indexed proposalId,address indexed canceller,string reason)",
]);
export const governancePublicClient = createPublicClient({
  chain: arbitrumSepolia, transport: http(CONTRACT_CONFIG.RPC_URL),
});
export const GOVERNANCE_ACTIONS = {
  propose: "DisbursementProposed", approve: "DisbursementApproved",
  execute: "DisbursementExecuted", cancel: "DisbursementCancelled",
} as const;
export const CHAIN_ASNAF = ["Fakir", "Miskin", "Amil", "Muallaf", "Riqab", "Gharimin", "Fisabilillah", "Ibnu Sabil"];
export const CHAIN_STATUSES = ["Pending", "Approved", "Executed", "Cancelled"] as const;
export type GovernanceMetadata = { beneficiaryName?: string; beneficiaryNIKMasked?: string; disbursementReceiptCID?: string };

export const governanceChain = {
  async readProposal(proposalId: number) {
    if (!Number.isSafeInteger(proposalId) || proposalId < 1) throw new Error("Invalid proposal ID");
    const p = await governancePublicClient.readContract({
      address: CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS, abi: GOVERNANCE_ABI,
      functionName: "proposals", args: [BigInt(proposalId)],
    });
    if (p[0] !== BigInt(proposalId)) throw new Error("Proposal tidak ditemukan pada kontrak aktif");
    // `amount` stays a number for the legacy column and its readers; `amountExact`
    // is the value as the chain actually stated it (ticket #80). The number form
    // is clamped rather than silently truncated, so a caller reading it can never
    // see a rounded amount - it sees a refusal, and the exact form beside it.
    if (p[2] > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount exceeds database precision");
    return {
      proposalId, currencyType: p[1], amount: Number(p[2]), amountExact: p[2].toString(), asnafCategory: p[3],
      asnafLabel: CHAIN_ASNAF[p[3]] ?? "Unknown", beneficiaryHash: p[4],
      ipfsProofCID: p[5], periodId: Number(p[6]), usdcRecipient: p[7],
      approvalCount: Number(p[8]), status: CHAIN_STATUSES[p[9]], chainVerified: true,
    };
  },

  async confirm(action: keyof typeof GOVERNANCE_ACTIONS, txHash: string, proposalId?: number,
    metadata?: GovernanceMetadata, metadataSignature?: Hex) {
    if (!Object.hasOwn(GOVERNANCE_ACTIONS, action) || !/^0x[0-9a-fA-F]{64}$/.test(txHash || "")) {
      throw new Error("Receipt transaksi onchain yang valid wajib disertakan");
    }
    if (await governancePublicClient.getChainId() !== CONTRACT_CONFIG.CHAIN_ID) throw new Error("RPC chain mismatch");
    const receipt = await governancePublicClient.getTransactionReceipt({ hash: txHash as Hex });
    if (receipt.status !== "success") throw new Error("Transaksi belum berhasil dikonfirmasi");
    if (metadata && Object.keys(metadata).length) {
      const message = `Tawf metadata\n${CONTRACT_CONFIG.CHAIN_ID}\n${CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS.toLowerCase()}\n${txHash}\n${JSON.stringify(metadata)}`;
      if (!metadataSignature || !await verifyMessage({ address: receipt.from, message, signature: metadataSignature })) {
        throw new Error("Metadata must be signed by the transaction sender");
      }
    }
    const matching = receipt.logs.flatMap(log => {
      if (log.address.toLowerCase() !== CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS.toLowerCase()) return [];
      try {
        const event = decodeEventLog({ abi: GOVERNANCE_ABI, data: log.data, topics: log.topics });
        if (event.eventName !== GOVERNANCE_ACTIONS[action]) return [];
        if (proposalId !== undefined && event.args.proposalId !== BigInt(proposalId)) return [];
        return [event];
      } catch { return []; }
    });
    if (matching.length !== 1) throw new Error("Receipt tidak membuktikan perubahan proposal pada kontrak aktif");
    const event = matching[0]!;
    const proposal = await this.readProposal(Number(event.args.proposalId));
    if ("beneficiaryHash" in event.args && event.args.beneficiaryHash !== proposal.beneficiaryHash) throw new Error("Proposal identity mismatch");
    const block = await governancePublicClient.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash) throw new Error("Receipt no longer canonical");
    return { proposal, txHash, sender: receipt.from, timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
      cancelReason: "reason" in event.args ? event.args.reason : undefined };
  },
};

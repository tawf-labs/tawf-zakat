import {
  createPublicClient, createWalletClient, http, isAddress, keccak256, parseAbi, toHex,
  zeroAddress, zeroHash, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia, foundry } from "viem/chains";

export interface CampaignChainRecorder {
  record(input: { eventId: string; campaignId: string; kind: string; payloadHash: string }): Promise<{ transactionHash: string }>;
}

export const CAMPAIGN_REGISTRY_ABI = parseAbi([
  "constructor(address administrator_, address recorder_)",
  "function administrator() view returns (address)",
  "function recorder() view returns (address)",
  "function rotateRecorder(address nextRecorder)",
  "function evidence(bytes32 eventId) view returns (bytes32 campaignId, bytes32 kind, bytes32 payloadHash)",
  "function record(bytes32 eventId, bytes32 campaignId, bytes32 kind, bytes32 payloadHash)",
  "event RecorderRotated(address indexed previousRecorder, address indexed newRecorder)",
  "event EvidenceRecorded(bytes32 indexed eventId, bytes32 indexed campaignId, bytes32 indexed kind, bytes32 payloadHash)",
  "error Unauthorized()", "error InvalidAddress()", "error InvalidCommitment()", "error EvidenceConflict()",
]);

type EvidenceArgs = readonly [Hex, Hex, Hex, Hex];
export type CampaignChainConfig = { address: Address; rpcUrl: string; chainId: 31337 | 421614; privateKey: Hex };

// No fallback to the existing custody/governance chain or its signing key.
export function parseCampaignChainConfig(env: Record<string, string | undefined>): CampaignChainConfig | null {
  const names = ["CAMPAIGN_REGISTRY_ADDRESS", "CAMPAIGN_CHAIN_RPC_URL", "CAMPAIGN_CHAIN_ID", "CAMPAIGN_RECORDER_PRIVATE_KEY"];
  if (names.every(name => env[name] === undefined)) return null;
  const address = env.CAMPAIGN_REGISTRY_ADDRESS;
  const rpcUrl = env.CAMPAIGN_CHAIN_RPC_URL;
  const privateKey = env.CAMPAIGN_RECORDER_PRIVATE_KEY;
  const chain = env.CAMPAIGN_CHAIN_ID ?? "421614";
  if (!address || !isAddress(address) || address.toLowerCase() === zeroAddress || !rpcUrl ||
      !privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey) || !["31337", "421614"].includes(chain)) {
    throw new Error("Invalid or partial campaign chain configuration; only local 31337 and Arbitrum Sepolia 421614 are allowed");
  }
  let url: URL;
  try { url = new URL(rpcUrl); } catch { throw new Error("Invalid CAMPAIGN_CHAIN_RPC_URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Campaign RPC must use HTTP(S)");
  // Validate scalar range without exposing the key in an error message.
  try { privateKeyToAccount(privateKey as Hex); } catch { throw new Error("Invalid CAMPAIGN_RECORDER_PRIVATE_KEY"); }
  return { address, rpcUrl, chainId: Number(chain) as 31337 | 421614, privateKey: privateKey as Hex };
}

export function campaignEvidenceArgs(input: Parameters<CampaignChainRecorder["record"]>[0]): EvidenceArgs {
  for (const field of ["eventId", "campaignId", "kind"] as const) {
    if (typeof input[field] !== "string" || !input[field].trim()) throw new Error(`Invalid campaign evidence ${field}`);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.payloadHash) || input.payloadHash.toLowerCase() === zeroHash) {
    throw new Error("Campaign payloadHash must be a nonzero 32-byte hash");
  }
  return [keccak256(toHex(input.eventId)), keccak256(toHex(input.campaignId)), keccak256(toHex(input.kind)), input.payloadHash.toLowerCase() as Hex];
}

/** Narrow transport seam for deterministic tests; no RPC or signing happens at import time. */
export interface CampaignChainTransport {
  getChainId(): Promise<number>;
  getBytecode(): Promise<Hex | undefined>;
  submit(args: EvidenceArgs): Promise<Hex>;
  waitForReceipt(hash: Hex, onReplaced: (reason: string) => void): Promise<{
    status: string; transactionHash: Hex; blockNumber: bigint; blockHash: Hex;
    to: Address | null; from: Address;
  }>;
  readEvidence(eventId: Hex, blockNumber: bigint): Promise<readonly [Hex, Hex, Hex]>;
  getBlockHash(blockNumber: bigint): Promise<Hex | null>;
}

export function createCampaignChainRecorder(
  config: Pick<CampaignChainConfig, "address" | "chainId">,
  account: Address,
  transport: CampaignChainTransport,
): CampaignChainRecorder {
  if (![31337, 421614].includes(config.chainId)) throw new Error("Unsupported campaign chain");
  return {
    async record(input) {
      const args = campaignEvidenceArgs(input);
      if (await transport.getChainId() !== config.chainId) throw new Error("Campaign RPC chain mismatch");
      const bytecode = await transport.getBytecode();
      if (!bytecode || bytecode === "0x") throw new Error("Campaign registry has no deployed bytecode");
      // Always submit the idempotent call, including retries after a lost receipt. A returned
      // transaction hash alone is never evidence of confirmation. Simulation rejects conflicts.
      const hash = await transport.submit(args);
      let replaced = false;
      const receipt = await transport.waitForReceipt(hash, reason => { if (reason !== "repriced") replaced = true; });
      if (replaced) throw new Error("Campaign transaction was cancelled or replaced with different data");
      if (receipt.status !== "success") throw new Error("Campaign evidence transaction reverted");
      if (receipt.to?.toLowerCase() !== config.address.toLowerCase() || receipt.from.toLowerCase() !== account.toLowerCase()) {
        throw new Error("Campaign receipt target or sender mismatch");
      }
      const stored = await transport.readEvidence(args[0], receipt.blockNumber);
      if (stored.some((value, index) => value.toLowerCase() !== args[index + 1])) throw new Error("Confirmed campaign evidence mismatch");
      if (await transport.getBlockHash(receipt.blockNumber) !== receipt.blockHash) throw new Error("Campaign receipt is no longer canonical");
      return { transactionHash: receipt.transactionHash };
    },
  };
}

export function createCampaignChainRecorderFromEnv(
  env: Record<string, string | undefined> = process.env,
): CampaignChainRecorder | null {
  const config = parseCampaignChainConfig(env);
  if (!config) return null;
  const chain = config.chainId === 31337 ? foundry : arbitrumSepolia;
  const account = privateKeyToAccount(config.privateKey);
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const wallet = createWalletClient({ chain, account, transport: http(config.rpcUrl) });
  const contract = { address: config.address, abi: CAMPAIGN_REGISTRY_ABI } as const;
  return createCampaignChainRecorder(config, account.address, {
    getChainId: () => publicClient.getChainId(),
    getBytecode: () => publicClient.getBytecode({ address: config.address }),
    async submit(args) {
      const { request } = await publicClient.simulateContract({ ...contract, account, functionName: "record", args });
      return wallet.writeContract(request);
    },
    waitForReceipt: (hash, onReplaced) => publicClient.waitForTransactionReceipt({
      hash, confirmations: 1, timeout: 120_000, onReplaced: replacement => onReplaced(replacement.reason),
    }),
    readEvidence: (eventId, blockNumber) => publicClient.readContract({ ...contract, functionName: "evidence", args: [eventId], blockNumber }),
    getBlockHash: async blockNumber => (await publicClient.getBlock({ blockNumber })).hash,
  });
}

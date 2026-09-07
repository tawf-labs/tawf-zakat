import {
  createWalletClient,
  createPublicClient,
  http,
  type Hex,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { CONTRACT_CONFIG } from "./config";

const RELAYER_ABI = parseAbi([
  "function recordFiatBatchSettlement(uint256 _batchId, bytes32 _merkleRoot, uint256 _totalBatchAmountIDR) external",
  "function fiatBatchRoots(uint256) external view returns (bytes32)",
]);

const privateKey = (process.env.RELAYER_PRIVATE_KEY ||
  process.env.PRIVATE_KEY) as Hex | undefined;

export async function settleBatchOnChain(
  batchId: number,
  merkleRoot: Hex,
  totalAmountIDR: number,
  waitForReceipt: boolean = true
): Promise<{
  success: boolean;
  txHash: string;
  explorerUrl: string;
  blockNumber?: bigint;
  error?: string;
}> {
  try {
    if (process.env.DEPLOYMENT_PENDING === "true") throw new Error("Deployment pending; settlement disabled");
    if (!privateKey) throw new Error("RELAYER_PRIVATE_KEY is required");
    const formattedKey = privateKey.startsWith("0x") ? privateKey : (`0x${privateKey}` as Hex);
    const account = privateKeyToAccount(formattedKey);

    const publicClient = createPublicClient({
      chain: arbitrumSepolia,
      transport: http(CONTRACT_CONFIG.RPC_URL),
    });

    const walletClient = createWalletClient({
      account,
      chain: arbitrumSepolia,
      transport: http(CONTRACT_CONFIG.RPC_URL),
    });

    console.log(`Relayer broadcasting batch #${batchId} to Arbitrum Sepolia contract ${CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS}...`);

    const txHash = await walletClient.writeContract({
      address: CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS as Hex,
      abi: RELAYER_ABI,
      functionName: "recordFiatBatchSettlement",
      args: [BigInt(batchId), merkleRoot, BigInt(totalAmountIDR)],
    });

    console.log(`Batch #${batchId} broadcasted! TxHash: ${txHash}`);

    if (waitForReceipt) {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 60_000,
      });

      return {
        success: receipt.status === "success",
        txHash,
        explorerUrl: `${CONTRACT_CONFIG.EXPLORER_URL}/tx/${txHash}`,
        blockNumber: receipt.blockNumber,
      };
    }

    return {
      success: true,
      txHash,
      explorerUrl: `${CONTRACT_CONFIG.EXPLORER_URL}/tx/${txHash}`,
    };
  } catch (err: any) {
    console.error("Live on-chain broadcast error:", err.message || err);
    return {
      success: false,
      txHash: "",
      explorerUrl: "",
      error: err.message || String(err),
    };
  }
}

import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  type Hex,
  parseUnits,
  formatUnits,
} from "viem";
import { sepolia } from "viem/chains";
import { getAccount } from "@wagmi/core";
import { wagmiConfig } from "./wagmiConfig";
import {
  ZAKAT_PROTOCOL_L1_ADDRESS,
  SEPOLIA_USDC_ADDRESS,
  ZAKAT_PROTOCOL_ABI,
  ERC20_ABI,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_EXPLORER_URL,
} from "./contracts";

export function getPublicClient() {
  return createPublicClient({
    chain: sepolia,
    transport: http("https://ethereum-sepolia-rpc.publicnode.com"),
  });
}

export async function getActiveWalletClient() {
  const account = getAccount(wagmiConfig);
  if (!account || !account.address || !account.connector) {
    throw new Error("Dompet belum terhubung. Silakan klik 'Connect Wallet' terlebih dahulu.");
  }

  // Get the isolated provider from the specific connector chosen by the user in ConnectKit (MetaMask / Phantom)
  const provider = await account.connector.getProvider();
  if (!provider) {
    throw new Error("Provider dompet tidak ditemukan.");
  }

  return {
    walletClient: createWalletClient({
      account: account.address,
      chain: sepolia,
      transport: custom(provider as any),
    }),
    accountAddress: account.address,
  };
}

export async function getUSDCAllowance(ownerAddress: string): Promise<bigint> {
  try {
    const client = getPublicClient();
    const allowance = await client.readContract({
      address: SEPOLIA_USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [ownerAddress as Hex, ZAKAT_PROTOCOL_L1_ADDRESS],
    });
    return allowance as bigint;
  } catch (err) {
    console.error("Failed to read USDC allowance:", err);
    return 0n;
  }
}

export async function getUSDCBalance(ownerAddress: string): Promise<bigint> {
  try {
    const client = getPublicClient();
    const balance = await client.readContract({
      address: SEPOLIA_USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [ownerAddress as Hex],
    });
    return balance as bigint;
  } catch (err) {
    console.error("Failed to read USDC balance:", err);
    return 0n;
  }
}

export async function approveUSDCOnChain(
  amountUSDC: number
): Promise<{ success: boolean; txHash: string; explorerUrl: string }> {
  const { walletClient } = await getActiveWalletClient();
  const parsedAmount = parseUnits(amountUSDC.toString(), 6); // USDC uses 6 decimals

  const txHash = await walletClient.writeContract({
    address: SEPOLIA_USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [ZAKAT_PROTOCOL_L1_ADDRESS, parsedAmount],
  });

  return {
    success: true,
    txHash,
    explorerUrl: `${SEPOLIA_EXPLORER_URL}/tx/${txHash}`,
  };
}

export async function depositUSDCOnChain(
  amountUSDC: number,
  isAnonymous: boolean,
  commitmentHash: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000"
): Promise<{ success: boolean; txHash: string; explorerUrl: string }> {
  const { walletClient } = await getActiveWalletClient();
  const parsedAmount = parseUnits(amountUSDC.toString(), 6); // USDC uses 6 decimals

  const txHash = await walletClient.writeContract({
    address: ZAKAT_PROTOCOL_L1_ADDRESS,
    abi: ZAKAT_PROTOCOL_ABI,
    functionName: "depositUSDC",
    args: [parsedAmount, isAnonymous, commitmentHash],
  });

  return {
    success: true,
    txHash,
    explorerUrl: `${SEPOLIA_EXPLORER_URL}/tx/${txHash}`,
  };
}

export async function approveDisbursementOnChain(
  proposalId: number
): Promise<{ success: boolean; txHash: string; explorerUrl: string }> {
  const { walletClient } = await getActiveWalletClient();

  const txHash = await walletClient.writeContract({
    address: ZAKAT_PROTOCOL_L1_ADDRESS,
    abi: ZAKAT_PROTOCOL_ABI,
    functionName: "approveDisbursement",
    args: [BigInt(proposalId)],
  });

  return {
    success: true,
    txHash,
    explorerUrl: `${SEPOLIA_EXPLORER_URL}/tx/${txHash}`,
  };
}

export async function cancelProposalOnChain(
  proposalId: number,
  reason: string
): Promise<{ success: boolean; txHash: string; explorerUrl: string }> {
  const { walletClient } = await getActiveWalletClient();

  const txHash = await walletClient.writeContract({
    address: ZAKAT_PROTOCOL_L1_ADDRESS,
    abi: ZAKAT_PROTOCOL_ABI,
    functionName: "cancelProposal",
    args: [BigInt(proposalId), reason],
  });

  return {
    success: true,
    txHash,
    explorerUrl: `${SEPOLIA_EXPLORER_URL}/tx/${txHash}`,
  };
}

export async function executeDisbursementOnChain(
  proposalId: number
): Promise<{ success: boolean; txHash: string; explorerUrl: string }> {
  const { walletClient } = await getActiveWalletClient();

  const txHash = await walletClient.writeContract({
    address: ZAKAT_PROTOCOL_L1_ADDRESS,
    abi: ZAKAT_PROTOCOL_ABI,
    functionName: "executeDisbursement",
    args: [BigInt(proposalId)],
  });

  return {
    success: true,
    txHash,
    explorerUrl: `${SEPOLIA_EXPLORER_URL}/tx/${txHash}`,
  };
}

export async function withdrawAmilShareOnChain(
  toAddress: string,
  amountUSDC: number
): Promise<{ success: boolean; txHash: string; explorerUrl: string }> {
  const { walletClient } = await getActiveWalletClient();
  const parsedAmount = parseUnits(amountUSDC.toString(), 6);

  const txHash = await walletClient.writeContract({
    address: ZAKAT_PROTOCOL_L1_ADDRESS,
    abi: ZAKAT_PROTOCOL_ABI,
    functionName: "withdrawAmilShareUSDC",
    args: [toAddress as Hex, parsedAmount],
  });

  return {
    success: true,
    txHash,
    explorerUrl: `${SEPOLIA_EXPLORER_URL}/tx/${txHash}`,
  };
}

import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  type Hex,
  parseUnits,
} from "viem";
import { arbitrumSepolia, sepolia } from "viem/chains";
import { getAccount } from "@wagmi/core";
import { wagmiConfig } from "./wagmiConfig";
import {
  ZAKAT_PROTOCOL_L1_ADDRESS,
  SEPOLIA_USDC_ADDRESS,
  ZAKAT_PROTOCOL_ABI,
  ERC20_ABI,
  SEPOLIA_EXPLORER_URL,
} from "./contracts";

export function getPublicClient() {
  return createPublicClient({
    chain: arbitrumSepolia,
    transport: http("https://sepolia-rollup.arbitrum.io/rpc"),
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
      chain: arbitrumSepolia,
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

async function getGasFeeParams() {
  try {
    const client = getPublicClient();
    const fees = await client.estimateFeesPerGas();
    if (fees.maxFeePerGas) {
      // Arbitrum Nitro sequencer base fee buffer (+50% buffer to prevent "max fee per gas less than block base fee")
      const maxFeePerGas = (fees.maxFeePerGas * 150n) / 100n;
      const maxPriorityFeePerGas = fees.maxPriorityFeePerGas
        ? (fees.maxPriorityFeePerGas * 150n) / 100n
        : parseUnits("0.05", 9);
      return { maxFeePerGas, maxPriorityFeePerGas };
    }
  } catch (e) {
    console.warn("Arbitrum gas fee estimation buffer fallback:", e);
  }
  return {};
}

export async function approveUSDCOnChain(
  amountUSDC: number
): Promise<{ success: boolean; txHash: string; explorerUrl: string }> {
  const { walletClient } = await getActiveWalletClient();
  const feeParams = await getGasFeeParams();
  const parsedAmount = parseUnits(amountUSDC.toString(), 6); // USDC uses 6 decimals

  const txHash = await walletClient.writeContract({
    address: SEPOLIA_USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [ZAKAT_PROTOCOL_L1_ADDRESS, parsedAmount],
    ...feeParams,
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
  const feeParams = await getGasFeeParams();
  const parsedAmount = parseUnits(amountUSDC.toString(), 6); // USDC uses 6 decimals

  const txHash = await walletClient.writeContract({
    address: ZAKAT_PROTOCOL_L1_ADDRESS,
    abi: ZAKAT_PROTOCOL_ABI,
    functionName: "depositUSDC",
    args: [parsedAmount, isAnonymous, commitmentHash],
    ...feeParams,
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
  const feeParams = await getGasFeeParams();

  const txHash = await walletClient.writeContract({
    address: ZAKAT_PROTOCOL_L1_ADDRESS,
    abi: ZAKAT_PROTOCOL_ABI,
    functionName: "approveDisbursement",
    args: [BigInt(proposalId)],
    ...feeParams,
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
  const feeParams = await getGasFeeParams();

  const txHash = await walletClient.writeContract({
    address: ZAKAT_PROTOCOL_L1_ADDRESS,
    abi: ZAKAT_PROTOCOL_ABI,
    functionName: "cancelProposal",
    args: [BigInt(proposalId), reason],
    ...feeParams,
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
  const feeParams = await getGasFeeParams();

  const txHash = await walletClient.writeContract({
    address: ZAKAT_PROTOCOL_L1_ADDRESS,
    abi: ZAKAT_PROTOCOL_ABI,
    functionName: "executeDisbursement",
    args: [BigInt(proposalId)],
    ...feeParams,
  });

  return {
    success: true,
    txHash,
    explorerUrl: `${SEPOLIA_EXPLORER_URL}/tx/${txHash}`,
  };
}

export async function proposeDisbursementOnChain(params: {
  currencyType: 0 | 1;
  amount: number;
  asnafCategory: number;
  beneficiaryHash: Hex;
  ipfsProofCID: string;
  periodId: number;
  usdcRecipient?: string;
}): Promise<{ success: boolean; txHash: string; proposalId: number; explorerUrl: string }> {
  const { walletClient, accountAddress } = await getActiveWalletClient();
  const client = getPublicClient();
  const feeParams = await getGasFeeParams();

  const parsedAmount =
    params.currencyType === 1
      ? parseUnits(params.amount.toString(), 6)
      : BigInt(params.amount);

  const recipient = (params.currencyType === 1
    ? (params.usdcRecipient || accountAddress)
    : "0x0000000000000000000000000000000000000000") as Hex;

  const txHash = await walletClient.writeContract({
    address: ZAKAT_PROTOCOL_L1_ADDRESS,
    abi: ZAKAT_PROTOCOL_ABI,
    functionName: "proposeDisbursement",
    args: [
      params.currencyType,
      parsedAmount,
      params.asnafCategory,
      params.beneficiaryHash,
      params.ipfsProofCID,
      BigInt(params.periodId),
      recipient,
    ],
    ...feeParams,
  });

  await client.waitForTransactionReceipt({ hash: txHash });

  // Read latest proposal counter
  let proposalId = 1;
  try {
    const count = await client.readContract({
      address: ZAKAT_PROTOCOL_L1_ADDRESS,
      abi: ZAKAT_PROTOCOL_ABI,
      functionName: "proposalCounter",
    });
    proposalId = Number(count);
  } catch (err) {
    console.warn("Failed to read proposalCounter, defaulting to 1:", err);
  }

  return {
    success: true,
    txHash,
    proposalId,
    explorerUrl: `${SEPOLIA_EXPLORER_URL}/tx/${txHash}`,
  };
}

export async function withdrawAmilShareOnChain(
  toAddress: string,
  amountUSDC: number
): Promise<{ success: boolean; txHash: string; explorerUrl: string }> {
  const { walletClient } = await getActiveWalletClient();
  const feeParams = await getGasFeeParams();
  const parsedAmount = parseUnits(amountUSDC.toString(), 6);

  const txHash = await walletClient.writeContract({
    address: ZAKAT_PROTOCOL_L1_ADDRESS,
    abi: ZAKAT_PROTOCOL_ABI,
    functionName: "withdrawAmilShareUSDC",
    args: [toAddress as Hex, parsedAmount],
    ...feeParams,
  });

  return {
    success: true,
    txHash,
    explorerUrl: `${SEPOLIA_EXPLORER_URL}/tx/${txHash}`,
  };
}

export async function getContractBalances(): Promise<{
  totalCollectedIDR: bigint;
  mustahikVaultIDR: bigint;
  amilTreasuryIDR: bigint;
  totalDisbursedIDR: bigint;
  totalCollectedUSDC: bigint;
  mustahikVaultUSDC: bigint;
  amilTreasuryUSDC: bigint;
  totalDisbursedUSDC: bigint;
  proposalCounter: number;
}> {
  const client = getPublicClient();

  try {
    const [
      totalCollectedIDR,
      mustahikVaultIDR,
      amilTreasuryIDR,
      totalDisbursedIDR,
      totalCollectedUSDC,
      mustahikVaultUSDC,
      amilTreasuryUSDC,
      totalDisbursedUSDC,
      proposalCounter,
    ] = await Promise.all([
      client.readContract({ address: ZAKAT_PROTOCOL_L1_ADDRESS, abi: ZAKAT_PROTOCOL_ABI, functionName: "totalCollectedIDR" }).catch(() => 0n),
      client.readContract({ address: ZAKAT_PROTOCOL_L1_ADDRESS, abi: ZAKAT_PROTOCOL_ABI, functionName: "mustahikVaultIDR" }).catch(() => 0n),
      client.readContract({ address: ZAKAT_PROTOCOL_L1_ADDRESS, abi: ZAKAT_PROTOCOL_ABI, functionName: "amilTreasuryIDR" }).catch(() => 0n),
      client.readContract({ address: ZAKAT_PROTOCOL_L1_ADDRESS, abi: ZAKAT_PROTOCOL_ABI, functionName: "totalDisbursedIDR" }).catch(() => 0n),
      client.readContract({ address: ZAKAT_PROTOCOL_L1_ADDRESS, abi: ZAKAT_PROTOCOL_ABI, functionName: "totalCollectedUSDC" }).catch(() => 0n),
      client.readContract({ address: ZAKAT_PROTOCOL_L1_ADDRESS, abi: ZAKAT_PROTOCOL_ABI, functionName: "mustahikVaultUSDC" }).catch(() => 0n),
      client.readContract({ address: ZAKAT_PROTOCOL_L1_ADDRESS, abi: ZAKAT_PROTOCOL_ABI, functionName: "amilTreasuryUSDC" }).catch(() => 0n),
      client.readContract({ address: ZAKAT_PROTOCOL_L1_ADDRESS, abi: ZAKAT_PROTOCOL_ABI, functionName: "totalDisbursedUSDC" }).catch(() => 0n),
      client.readContract({ address: ZAKAT_PROTOCOL_L1_ADDRESS, abi: ZAKAT_PROTOCOL_ABI, functionName: "proposalCounter" }).catch(() => 0n),
    ]);

    return {
      totalCollectedIDR: totalCollectedIDR as bigint,
      mustahikVaultIDR: mustahikVaultIDR as bigint,
      amilTreasuryIDR: amilTreasuryIDR as bigint,
      totalDisbursedIDR: totalDisbursedIDR as bigint,
      totalCollectedUSDC: totalCollectedUSDC as bigint,
      mustahikVaultUSDC: mustahikVaultUSDC as bigint,
      amilTreasuryUSDC: amilTreasuryUSDC as bigint,
      totalDisbursedUSDC: totalDisbursedUSDC as bigint,
      proposalCounter: Number(proposalCounter),
    };
  } catch (err) {
    console.error("Failed to read contract balances:", err);
    return {
      totalCollectedIDR: 0n,
      mustahikVaultIDR: 0n,
      amilTreasuryIDR: 0n,
      totalDisbursedIDR: 0n,
      totalCollectedUSDC: 0n,
      mustahikVaultUSDC: 0n,
      amilTreasuryUSDC: 0n,
      totalDisbursedUSDC: 0n,
      proposalCounter: 0,
    };
  }
}


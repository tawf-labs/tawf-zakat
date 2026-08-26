import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  type Hex,
  parseUnits,
} from "viem";
import { sepolia } from "viem/chains";
import {
  ZAKAT_PROTOCOL_L1_ADDRESS,
  SEPOLIA_USDC_ADDRESS,
  ZAKAT_PROTOCOL_ABI,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_EXPLORER_URL,
} from "./contracts";

export async function getEthereumProvider(): Promise<any> {
  if (typeof window !== "undefined" && (window as any).ethereum) {
    return (window as any).ethereum;
  }
  return null;
}

export async function ensureSepoliaNetwork(): Promise<boolean> {
  const ethereum = await getEthereumProvider();
  if (!ethereum) return false;

  try {
    const chainIdHex = await ethereum.request({ method: "eth_chainId" });
    const currentChainId = parseInt(chainIdHex, 16);

    if (currentChainId !== SEPOLIA_CHAIN_ID) {
      try {
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0xaa36a7" }], // 11155111 in hex
        });
      } catch (switchError: any) {
        if (switchError.code === 4902) {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0xaa36a7",
                chainName: "Sepolia Test Network",
                nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
                rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
                blockExplorerUrls: [SEPOLIA_EXPLORER_URL],
              },
            ],
          });
        } else {
          throw switchError;
        }
      }
    }
    return true;
  } catch (err) {
    console.error("Failed to switch network:", err);
    return false;
  }
}

export async function requestWalletConnection(): Promise<string | null> {
  const ethereum = await getEthereumProvider();
  if (!ethereum) {
    alert("Dompet Web3 (MetaMask) tidak terdeteksi. Silakan pasang ekstensi MetaMask!");
    return null;
  }

  await ensureSepoliaNetwork();

  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  return accounts && accounts.length > 0 ? accounts[0] : null;
}

export async function depositUSDCOnChain(
  amountUSDC: number,
  isAnonymous: boolean,
  commitmentHash: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000"
): Promise<{ success: boolean; txHash: string; explorerUrl: string }> {
  const ethereum = await getEthereumProvider();
  if (!ethereum) {
    // Fallback simulation
    const mockHash = `0x${Math.random().toString(36).substring(2, 15)}mock`;
    return { success: true, txHash: mockHash, explorerUrl: `${SEPOLIA_EXPLORER_URL}/tx/${mockHash}` };
  }

  await ensureSepoliaNetwork();
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  const account = accounts[0];

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: custom(ethereum),
  });

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
  const ethereum = await getEthereumProvider();
  if (!ethereum) {
    const mockHash = `0x${Math.random().toString(36).substring(2, 15)}mock`;
    return { success: true, txHash: mockHash, explorerUrl: `${SEPOLIA_EXPLORER_URL}/tx/${mockHash}` };
  }

  await ensureSepoliaNetwork();
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  const account = accounts[0];

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: custom(ethereum),
  });

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
  const ethereum = await getEthereumProvider();
  if (!ethereum) {
    const mockHash = `0x${Math.random().toString(36).substring(2, 15)}mock`;
    return { success: true, txHash: mockHash, explorerUrl: `${SEPOLIA_EXPLORER_URL}/tx/${mockHash}` };
  }

  await ensureSepoliaNetwork();
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  const account = accounts[0];

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: custom(ethereum),
  });

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
  const ethereum = await getEthereumProvider();
  if (!ethereum) {
    const mockHash = `0x${Math.random().toString(36).substring(2, 15)}mock`;
    return { success: true, txHash: mockHash, explorerUrl: `${SEPOLIA_EXPLORER_URL}/tx/${mockHash}` };
  }

  await ensureSepoliaNetwork();
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  const account = accounts[0];

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: custom(ethereum),
  });

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
  const ethereum = await getEthereumProvider();
  if (!ethereum) {
    const mockHash = `0x${Math.random().toString(36).substring(2, 15)}mock`;
    return { success: true, txHash: mockHash, explorerUrl: `${SEPOLIA_EXPLORER_URL}/tx/${mockHash}` };
  }

  await ensureSepoliaNetwork();
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  const account = accounts[0];

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: custom(ethereum),
  });

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

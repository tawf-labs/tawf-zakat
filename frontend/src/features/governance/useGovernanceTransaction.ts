import { useAccount, usePublicClient, useSignMessage, useSwitchChain, useWriteContract } from "wagmi";
import { parseAbi, type Hex } from "viem";
import { getApiBaseUrl, ZAKAT_PROTOCOL_L1_ADDRESS, ARBITRUM_SEPOLIA_CHAIN_ID } from "../../lib/contracts";

const abi = parseAbi([
  "function proposeDisbursement(uint8,uint256,uint8,bytes32,string,uint256,address) returns (uint256)",
  "function approveDisbursement(uint256)", "function executeDisbursement(uint256)",
  "function cancelProposal(uint256,string)",
]);
const functions = { propose: "proposeDisbursement", approve: "approveDisbursement", execute: "executeDisbursement", cancel: "cancelProposal" } as const;
type Metadata = { beneficiaryName?: string; beneficiaryNIKMasked?: string; disbursementReceiptCID?: string };

export async function uploadGovernanceFile(file: File | null): Promise<string> {
  if (!file) throw new Error("Berkas bukti wajib diunggah.");
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${getApiBaseUrl()}/api/ipfs/upload-file`, { method: "POST", body: form });
  const body = await response.json();
  if (!response.ok || !body.success || typeof body.cid !== "string") throw new Error(body.error || "Unggahan IPFS gagal.");
  return body.cid;
}

export function useGovernanceTransaction() {
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: ARBITRUM_SEPOLIA_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();

  return async (action: keyof typeof functions, args: readonly unknown[], proposalId?: number,
    metadata?: Metadata, onStatus: (message: string) => void = () => {}) => {
    if (!address || !client) throw new Error("Hubungkan wallet terlebih dahulu.");
    const health = await fetch(`${getApiBaseUrl()}/health`).then(r => r.json());
    if (health.deploymentPending || health.contractAddress?.toLowerCase() !== ZAKAT_PROTOCOL_L1_ADDRESS.toLowerCase()) {
      throw new Error("Konfigurasi deployment frontend dan backend belum siap atau tidak sama.");
    }
    if (chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) await switchChainAsync({ chainId: ARBITRUM_SEPOLIA_CHAIN_ID });
    const key = `tawf-confirm:${ZAKAT_PROTOCOL_L1_ADDRESS}:${address}:${action}:${proposalId ?? "new"}`;
    let pending = JSON.parse(sessionStorage.getItem(key) || "null");
    if (!pending) {
      onStatus("Konfirmasi transaksi kontrak di wallet...");
      const { request } = await client.simulateContract({
        address: ZAKAT_PROTOCOL_L1_ADDRESS as Hex, abi, functionName: functions[action], args: args as any, account: address,
      });
      const txHash = await writeContractAsync({ ...request, chainId: ARBITRUM_SEPOLIA_CHAIN_ID } as any);
      pending = { action, txHash, proposalId, metadata };
      sessionStorage.setItem(key, JSON.stringify(pending));
    }
    onStatus("Menunggu konfirmasi onchain...");
    const receipt = await client.waitForTransactionReceipt({ hash: pending.txHash, confirmations: 1 });
    if (receipt.status !== "success") {
      sessionStorage.removeItem(key);
      throw new Error("Transaksi revert; status tidak diubah.");
    }
    if (pending.metadata && !pending.metadataSignature) {
      onStatus("Tandatangani pengaitan bukti dengan transaksi...");
      const message = `Tawf metadata\n${ARBITRUM_SEPOLIA_CHAIN_ID}\n${ZAKAT_PROTOCOL_L1_ADDRESS.toLowerCase()}\n${pending.txHash}\n${JSON.stringify(pending.metadata)}`;
      pending.metadataSignature = await signMessageAsync({ message });
      sessionStorage.setItem(key, JSON.stringify(pending));
    }
    onStatus("Memverifikasi receipt dan menyinkronkan status...");
    const response = await fetch(`${getApiBaseUrl()}/api/governance/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending),
    });
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(`Transaksi ${pending.txHash} sudah terkirim, sinkronisasi belum berhasil. Ulangi aksi untuk menyinkronkan tanpa mengirim transaksi baru.`);
    sessionStorage.removeItem(key);
    return body.proposal;
  };
}

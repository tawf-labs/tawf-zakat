import { toast } from "sonner";
import { usePublicClient } from "wagmi";
import { decodeContractError } from "./errorHandler";
import type { Hex } from "viem";

export interface TrackTxOptions {
  txHash: Hex | string;
  pendingMessage?: string;
  successTitle?: string;
  successDescription?: string;
  errorMessage?: string;
  onSuccess?: () => void;
  onError?: (err: unknown) => void;
}

export function useTxToast() {
  const publicClient = usePublicClient();

  const trackTx = async ({
    txHash,
    pendingMessage = "Mengonfirmasi transaksi di Sepolia L1...",
    successTitle = "Transaksi Berhasil Dikonfirmasi!",
    successDescription,
    errorMessage,
    onSuccess,
    onError,
  }: TrackTxOptions) => {
    const toastId = toast.loading(pendingMessage, {
      description: `Tx: ${txHash.slice(0, 10)}...${txHash.slice(-6)}`,
    });

    try {
      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash as Hex,
          timeout: 60_000,
        });

        if (receipt.status === "success") {
          toast.success(successTitle, {
            id: toastId,
            description:
              successDescription ||
              `Tercatat permanen pada blok #${receipt.blockNumber.toString()}`,
            action: {
              label: "Arbiscan",
              onClick: () =>
                window.open(`https://sepolia.arbiscan.io/tx/${txHash}`, "_blank"),
            },
            duration: 8000,
          });
          onSuccess?.();
          return receipt;
        } else {
          throw new Error("Transaction execution reverted on Arbitrum Sepolia.");
        }
      } else {
        // Fallback without publicClient
        toast.success(successTitle, {
          id: toastId,
          description: `Tx: ${txHash.slice(0, 10)}...${txHash.slice(-6)}`,
          action: {
            label: "Arbiscan",
            onClick: () =>
              window.open(`https://sepolia.arbiscan.io/tx/${txHash}`, "_blank"),
          },
          duration: 8000,
        });
        onSuccess?.();
      }
    } catch (err: unknown) {
      const decoded = decodeContractError(err);
      toast.error(errorMessage || "Transaksi Gagal", {
        id: toastId,
        description: decoded,
        action: txHash
          ? {
              label: "Cek Tx",
              onClick: () =>
                window.open(`https://sepolia.arbiscan.io/tx/${txHash}`, "_blank"),
            }
          : undefined,
        duration: 9000,
      });
      onError?.(err);
    }
  };

  const showSuccess = (title: string, description?: string, txHash?: string) => {
    toast.success(title, {
      description,
      action: txHash
        ? {
            label: "Arbiscan",
            onClick: () =>
              window.open(`https://sepolia.arbiscan.io/tx/${txHash}`, "_blank"),
          }
        : undefined,
      duration: 6000,
    });
  };

  const showError = (error: unknown, customTitle: string = "Terjadi Kesalahan") => {
    const decoded = decodeContractError(error);
    toast.error(customTitle, {
      description: decoded,
      duration: 8000,
    });
  };

  const showInfo = (title: string, description?: string) => {
    toast.info(title, {
      description,
      duration: 5000,
    });
  };

  return {
    trackTx,
    showSuccess,
    showError,
    showInfo,
  };
}

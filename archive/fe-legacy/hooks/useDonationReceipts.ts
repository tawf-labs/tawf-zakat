"use client";

import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { CONTRACT_ADDRESSES, DonationReceiptNFTABI } from "@/lib/abi";

export interface DonationReceipt {
  tokenId: bigint;
  poolId: bigint;
  donor: string;
  amount: bigint;
  timestamp: bigint;
  receiptUri: string;
}

export function useDonationReceipts() {
  const { address } = useAccount();

  // Get total NFT balance for the user
  const {
    data: balance,
    isLoading: isLoadingBalance,
    error: balanceError,
  } = useReadContract({
    address: CONTRACT_ADDRESSES.DonationReceiptNFT,
    abi: DonationReceiptNFTABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      staleTime: 30_000,
      gcTime: 300_000,
    },
  });

  const nftBalance = Number(balance || 0);

  // Get token IDs owned by user
  const tokenQueries = Array.from({ length: nftBalance }, (_, index) => ({
    address: CONTRACT_ADDRESSES.DonationReceiptNFT,
    abi: DonationReceiptNFTABI,
    functionName: "tokenOfOwnerByIndex",
    args: address ? [address, BigInt(index)] : undefined,
  }));

  const {
    data: tokenIds,
    isLoading: isLoadingTokenIds,
    error: tokenIdsError,
  } = useReadContracts({
    contracts: tokenQueries as any,
    query: {
      enabled: !!address && nftBalance > 0,
      staleTime: 30_000,
      gcTime: 300_000,
    },
  });

  // Get receipt data for each token
  const receiptQueries =
    tokenIds?.flatMap((tokenData) => {
      if (!tokenData || typeof tokenData !== "object" || !("result" in tokenData)) {
        return [];
      }
      const tokenId = tokenData.result as bigint;

      return [
        {
          address: CONTRACT_ADDRESSES.DonationReceiptNFT,
          abi: DonationReceiptNFTABI,
          functionName: "getReceiptData",
          args: [tokenId],
        },
        {
          address: CONTRACT_ADDRESSES.DonationReceiptNFT,
          abi: DonationReceiptNFTABI,
          functionName: "tokenURI",
          args: [tokenId],
        },
      ];
    }) || [];

  const {
    data: receiptsData,
    isLoading: isLoadingReceipts,
    error: receiptsError,
    refetch,
  } = useReadContracts({
    contracts: receiptQueries as any,
    query: {
      enabled: !!tokenIds && tokenIds.length > 0,
      staleTime: 30_000,
      gcTime: 300_000,
    },
  });

  const receipts: DonationReceipt[] = [];
  if (receiptsData && tokenIds) {
    for (let i = 0; i < tokenIds.length; i++) {
      const tokenData = tokenIds[i];
      if (!tokenData || typeof tokenData !== "object" || !("result" in tokenData)) {
        continue;
      }
      const tokenId = tokenData.result as bigint;

      const receiptData = receiptsData[i * 2];
      const uriData = receiptsData[i * 2 + 1];

      if (
        receiptData &&
        typeof receiptData === "object" &&
        "result" in receiptData
      ) {
        const receipt = receiptData.result as any;
        const uri =
          uriData && typeof uriData === "object" && "result" in uriData
            ? (uriData.result as string)
            : "";

        receipts.push({
          tokenId,
          poolId: receipt.poolId || BigInt(0),
          donor: receipt.donor || "",
          amount: receipt.amount || BigInt(0),
          timestamp: receipt.timestamp || BigInt(0),
          receiptUri: uri,
        });
      }
    }
  }

  return {
    receipts,
    isLoading: isLoadingBalance || isLoadingTokenIds || isLoadingReceipts,
    error: balanceError || tokenIdsError || receiptsError,
    refetch,
  };
}

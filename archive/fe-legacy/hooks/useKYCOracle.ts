"use client";

import { useState } from "react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { CONTRACT_ADDRESSES, ZKTCoreABI } from "@/lib/abi";

// KYC Status enum (must match contract)
export enum KYCStatus {
  NotRequired = 0,
  Pending = 1,
  Verified = 2,
  Rejected = 3,
}

/**
 * Hook to update KYC status of a proposal (KYC Oracle only)
 */
export function useUpdateKYCStatus() {
  const [isPending, setIsPending] = useState(false);

  const { writeContractAsync, data: hash, error, isPending: isWritePending } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const updateKYCStatus = async (
    proposalId: number,
    status: KYCStatus,
    notes: string
  ) => {
    try {
      setIsPending(true);

      await writeContractAsync({
        address: CONTRACT_ADDRESSES.ZKTCore,
        abi: ZKTCoreABI,
        functionName: "updateKYCStatus",
        args: [BigInt(proposalId), status, notes],
      });

      setIsPending(false);
    } catch (err) {
      setIsPending(false);
      throw err;
    }
  };

  return {
    updateKYCStatus,
    isPending: isPending || isWritePending || isConfirming,
    isSuccess,
    error,
    hash,
  };
}

/**
 * Helper function to get KYC status label
 */
export function getKYCStatusLabel(status: number): string {
  switch (status) {
    case KYCStatus.Pending:
      return "Pending";
    case KYCStatus.Verified:
      return "Verified";
    case KYCStatus.Rejected:
      return "Rejected";
    case KYCStatus.NotRequired:
      return "Not Required";
    default:
      return "Unknown";
  }
}

/**
 * Helper function to get KYC status color
 */
export function getKYCStatusColor(status: number): string {
  switch (status) {
    case KYCStatus.Pending:
      return "bg-amber-100 text-amber-700 border-amber-200";
    case KYCStatus.Verified:
      return "bg-green-100 text-green-700 border-green-200";
    case KYCStatus.Rejected:
      return "bg-red-100 text-red-700 border-red-200";
    case KYCStatus.NotRequired:
      return "bg-gray-100 text-gray-700 border-gray-200";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

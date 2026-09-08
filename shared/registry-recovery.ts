import type { RecordingObservation } from "./report-registry";
export type RecoveryState = "CURRENT" | "CATCHING_UP" | "RECHECK_REQUIRED";
export type FileAvailability = "AVAILABLE" | "MISSING" | "CORRUPT" | "UNAVAILABLE";
export type RecoveryFileStatus = { id: string; contentSha256: string | null; availability: FileAvailability };
export type RecoveryStatus = {
  state: RecoveryState; requiredConfirmations: number; confirmationPolicy: string;
  checkpoint: { blockNumber: string; checkedAt: number } | null;
  observations: { intentId: string; transactionHash: string; observation: RecordingObservation }[];
};

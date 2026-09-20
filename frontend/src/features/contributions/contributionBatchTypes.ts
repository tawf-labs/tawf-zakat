import type { CurrencyUnit } from "./contributionClient";

export type Batch = { id: string; status: string; merkleRoot: string; cutoff: number; itemCount: number;
  currencyUnit: CurrencyUnit; totalAmountExact: string; endorsedBy: string | null;
  version: number; batchNumber: number; predecessorBatchId: string | null;
  correctionReason: string | null; sourceProofRef: string | null;
  items: { contributionId: string }[] };
export type Operation = { id: string; contributionId: string | null; status: string; error: string | null; txHash: string | null; attempts: number };

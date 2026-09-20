import type { WorkspaceRuntime } from "./workspace-runtime";

/** Inclusion and confirmation depth, independent of transaction success. */
export async function receiptIsFinal(
  runtime: WorkspaceRuntime,
  receipt: { blockNumber: bigint; blockHash: string },
): Promise<boolean> {
  const block = await runtime.zkPublicClient.getBlock({ blockNumber: receipt.blockNumber });
  const head = await runtime.zkPublicClient.getBlockNumber({ cacheTime: 0 });
  return block.hash === receipt.blockHash &&
    BigInt(head) - receipt.blockNumber + 1n >= BigInt(runtime.zkBudget?.confirmations ?? 1);
}

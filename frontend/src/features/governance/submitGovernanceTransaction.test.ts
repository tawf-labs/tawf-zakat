import { expect, it } from "bun:test";
import { submitGovernanceTransaction } from "./submitGovernanceTransaction";

const hash = `0x${"12".repeat(32)}` as const;
const request = { functionName: "approveDisbursement", args: [2n], chainId: 421614 };

it("sends DPS approval when base fee rises above the wallet's initial quote", async () => {
  const result = await submitGovernanceTransaction(request, {
    estimateFees: async () => ({ maxFeePerGas: 254964000n, maxPriorityFeePerGas: 0n }),
    write: async tx => {
      const cap = tx.maxFeePerGas ?? 254964000n;
      if (cap < 255284000n) throw new Error("max fee per gas less than block base fee");
      expect(tx.functionName).toBe("approveDisbursement");
      expect(tx.args).toEqual([2n]);
      expect(tx.chainId).toBe(421614);
      expect(tx.maxPriorityFeePerGas).toBe(0n);
      return hash;
    },
  });
  expect(result).toBe(hash);
});

it("refreshes fees on a new attempt without increasing the priority tip", async () => {
  let calls = 0;
  const caps: bigint[] = [];
  const ports = {
    estimateFees: async () => ({ maxFeePerGas: BigInt(++calls) * 100n, maxPriorityFeePerGas: 5n }),
    write: async (tx: typeof request & { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }) => {
      caps.push(tx.maxFeePerGas!);
      expect(tx.maxPriorityFeePerGas).toBe(5n);
      return hash;
    },
  };
  await submitGovernanceTransaction(request, ports);
  await submitGovernanceTransaction(request, ports);
  expect(caps).toEqual([200n, 400n]);
});

it("does not request a signature if fee estimation fails", async () => {
  let writes = 0;
  await expect(submitGovernanceTransaction(request, {
    estimateFees: async () => { throw new Error("RPC unavailable"); },
    write: async () => { writes++; return hash; },
  })).rejects.toThrow("RPC unavailable");
  expect(writes).toBe(0);
});

it("does not automatically resubmit a rejected wallet request", async () => {
  let writes = 0;
  await expect(submitGovernanceTransaction(request, {
    estimateFees: async () => ({ maxFeePerGas: 100n, maxPriorityFeePerGas: 0n }),
    write: async () => { writes++; throw new Error("User rejected"); },
  })).rejects.toThrow("User rejected");
  expect(writes).toBe(1);
});

import type { Hex } from "viem";

type Fees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

export async function submitGovernanceTransaction<T extends object>(request: T, ports: {
  estimateFees(): Promise<Fees>;
  write(request: T & Partial<Fees>): Promise<Hex>;
}): Promise<Hex> {
  // Estimate after simulation, immediately before asking the wallet to sign.
  // The cap gives the base fee room to move while the user confirms. It is
  // an upper bound, not a doubled priority tip or a fixed gas price.
  const fees = await ports.estimateFees();
  return ports.write({
    ...request,
    maxFeePerGas: fees.maxFeePerGas * 2n,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
}

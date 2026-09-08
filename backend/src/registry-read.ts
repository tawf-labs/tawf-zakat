import type { RegistryChain } from "./registry-chain";

export type RegistryReference = { blockNumber: string; blockHash: string };

/** One request, one chain reference; nothing is returned after a replaced reference. */
export async function withRegistryRead<T>(chain: RegistryChain, read: (chain: RegistryChain) => Promise<T>): Promise<T> {
  const reference = await chain.readHead();
  const result = await read(chain.readAt(reference));
  if (await chain.canonicalBlock(reference.blockNumber) !== reference.blockHash) {
    throw new Error("Acuan pembacaan registry berubah. Muat ulang status.");
  }
  return result;
}

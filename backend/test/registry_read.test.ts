import { expect, it } from "bun:test";
import { withRegistryRead } from "../src/registry-read";
import type { RegistryChain } from "../src/registry-chain";

function fixture() {
  let head = 10;
  let canonical = "hash-10";
  const chain = {
    readHead: async () => ({ blockNumber: String(head), blockHash: `hash-${head}` }),
    canonicalBlock: async () => canonical,
    readAt: (ref: { blockNumber: string }) => ({ officialLine: async () => ({ packageId: Number(ref.blockNumber) > 10 ? "p2" : "p1" }) }),
  } as unknown as RegistryChain;
  return { chain, advance: () => { head++; }, reorg: () => { canonical = "replacement"; } };
}
it("holds the first reference when a correction is accepted mid-read", async () => {
  const { chain, advance } = fixture();
  const result = await withRegistryRead(chain, async scoped => {
    const before = await scoped.officialLine("i", "r");
    advance();
    return [before, await scoped.officialLine("i", "r")];
  });
  expect(result.map(v => v.packageId)).toEqual(["p1", "p1"]);
});
it("discards partial success when the reference is replaced", async () => {
  const { chain, reorg } = fixture();
  await expect(withRegistryRead(chain, async scoped => {
    const result = await scoped.officialLine("i", "r"); reorg(); return result;
  })).rejects.toThrow("Acuan pembacaan");
});
it("propagates an RPC failure after a partial read", async () => {
  const { chain } = fixture();
  await expect(withRegistryRead(chain, async scoped => {
    await scoped.officialLine("i", "r"); throw new Error("RPC failed");
  })).rejects.toThrow("RPC failed");
});

import { describe, expect, it } from "bun:test";
import { receiptKeyOf } from "../src/zk-publication";

describe("receipt key", () => {
  // Topic observed in the ReceiptProofVerified log of a real Arbitrum Sepolia transaction
  // (registry 0x93d4…6A3C, tx 0xb49c…8101). The registry stores block.number, which is an
  // L1 block on Arbitrum, so the event is located by this indexed key rather than by block.
  it("matches the indexed key the deployed registry emitted", () => {
    expect(receiptKeyOf("demo-tawf-20260921", "contrib_1b3a56ba-fbc1-491d-afc7-e76b94afa703", 3n))
      .toBe("0x014cf062416212627ce4c262f2076749328aa7f480fedfd386125f68953e9c7b");
  });
  it("changes with the version", () => {
    expect(receiptKeyOf("demo-tawf-20260921", "contrib_1b3a56ba-fbc1-491d-afc7-e76b94afa703", 1n))
      .not.toBe(receiptKeyOf("demo-tawf-20260921", "contrib_1b3a56ba-fbc1-491d-afc7-e76b94afa703", 3n));
  });
});

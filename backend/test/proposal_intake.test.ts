import { describe, it, expect } from "bun:test";
import { computeBeneficiaryHash } from "../src/ipfs";
import { keccak256, encodePacked } from "viem";
import { isolateProtocolStore, seedProposal } from "./helpers/protocol-fixture";
import { expectRetired } from "./helpers/retired-governance";

describe("Proposal privacy hash and retired intake", () => {
  isolateProtocolStore();
  it("should compute collision-resistant salted hash matching canonical Keccak256 formula", () => {
    const nik = "3171012345670001";
    const name = "Suryanto";
    const salt = "secret_salt_xyz_2026";

    const computed = computeBeneficiaryHash(nik, name, salt);
    const expected = keccak256(
      encodePacked(["string", "string", "string"], [nik, name, salt])
    );

    expect(computed).toBe(expected);
    expect(computed.startsWith("0x")).toBe(true);
    expect(computed.length).toBe(66);
  });

  it("rejects incomplete and complete legacy intake without creating proposals", async () => {
    await expectRetired("/api/proposals/intake", {});
    await expectRetired("/api/proposals/intake", {
      programTitle: "Test", beneficiaryName: "Test", beneficiaryNIK: "3171012345670001",
      amount: 5000000, currencyType: 0, asnafCategory: 1, periodId: 202609,
    });
  });
  it("cannot attach an unverified transaction or change a proposal ID", async () => {
    const proposal = seedProposal();
    await expectRetired(`/api/proposals/${proposal.proposalId}/sync-tx`, {
      proposalIdOnChain: 99, txHash: `0x${"12".repeat(32)}`,
    });
  });
  it("cannot create a proposal from an unverified client record", async () => {
    await expectRetired("/api/proposals", { proposalId: 99, amount: 5000000, status: "Executed" });
  });
});

import { describe, it } from "bun:test";
import { isolateProtocolStore, seedProposal } from "./helpers/protocol-fixture";
import { expectRetired } from "./helpers/retired-governance";

describe("ADR-0019 retired gasless governance", () => {
  isolateProtocolStore();
  for (const action of ["propose", "approve", "execute", "cancel"]) {
    it(`rejects gasless ${action} without changing the ledger`, async () => {
      const proposal = seedProposal({ status: "Approved" });
      await expectRetired(`/api/governance/gasless-${action}`, {
        proposalId: proposal.proposalId, signature: `0x${"11".repeat(65)}`,
        status: "Executed", amount: 999999, cancelReason: "Unverified request",
      });
    });
  }
});

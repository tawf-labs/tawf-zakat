import { it } from "bun:test";
import { isolateProtocolStore, seedProposal } from "./helpers/protocol-fixture";
import { expectRetired } from "./helpers/retired-governance";

isolateProtocolStore();
it("does not fabricate a BAST CID from the retired metadata-only endpoint", async () => {
  const proposal = seedProposal({ status: "Approved" });
  await expectRetired(`/api/proposals/${proposal.proposalId}/bast`, {
    bankReferenceNumber: "UNVERIFIED", bastDocumentFileName: "receipt.pdf",
    signedByAmil: "Unverified name",
  });
});

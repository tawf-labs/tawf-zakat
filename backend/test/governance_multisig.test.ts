import { describe, expect, it } from "bun:test";
import app from "../src/index";
import { isolateProtocolStore, seedProposal } from "./helpers/protocol-fixture";
import { expectRetired } from "./helpers/retired-governance";

describe("Governance proposal reads and retired mutations", () => {
  isolateProtocolStore();
  it("lists its own confirmed proposal fixture", async () => {
    const proposal = seedProposal();
    const response = await app.fetch(new Request("http://localhost/api/proposals"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.proposals).toHaveLength(1);
    expect(body.proposals[0]).toMatchObject({ proposalId: proposal.proposalId,
      status: "Pending", ipfsProofCID: proposal.ipfsProofCID, asnafLabel: "Miskin" });
  });
  for (const action of ["approve", "cancel", "execute"]) {
    it(`rejects unverified ${action} without changing the proposal`, async () => {
      const proposal = seedProposal({ status: "Approved" });
      await expectRetired(`/api/proposals/${proposal.proposalId}/${action}`, {
        approverRole: "Dewan Pengawas Syariah (DPS)", txHash: `0x${"12".repeat(32)}`,
      });
    });
  }
});

import { afterEach, beforeEach } from "bun:test";
import { dataStore, type ProposalRecord } from "../../src/store";

// Restore shared memory even when an assertion fails; each test owns its fixtures.
export function isolateProtocolStore() {
  const maps = [dataStore.donations, dataStore.proposals, dataStore.batches, dataStore.batchTrees] as Map<unknown, unknown>[];
  let snapshots: [unknown, unknown][][];
  beforeEach(() => {
    snapshots = maps.map(map => [...map.entries()]);
    maps.forEach(map => map.clear());
  });
  afterEach(() => {
    maps.forEach((map, index) => {
      map.clear();
      for (const [key, value] of snapshots[index]!) map.set(key, value);
    });
  });
}

export function seedProposal(overrides: Partial<ProposalRecord> = {}) {
  const proposal: ProposalRecord = {
    proposalId: 91001, currencyType: 0, amount: 5000000, amountExact: "5000000",
    asnafCategory: 1, asnafLabel: "Miskin", beneficiaryName: "Test recipient",
    beneficiaryNIKMasked: "317101******0001", beneficiaryHash: `0x${"ab".repeat(32)}`,
    ipfsProofCID: "ipfs://test-dossier", periodId: 202609, approvalCount: 1,
    approvedBy: [], status: "Pending", chainVerified: true, ...overrides,
  };
  dataStore.proposals.set(proposal.proposalId, proposal);
  return proposal;
}

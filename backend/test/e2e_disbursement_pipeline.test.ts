import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/index";
import { CONTRACT_CONFIG } from "../src/config";
import { GOVERNANCE_ABI, governancePublicClient } from "../src/governance-chain";
import { dataStore } from "../src/store";
import { dbService } from "../src/db/index";
import { isolateProtocolStore } from "./helpers/protocol-fixture";

// Exercise retained receipt decoding -> persistence -> public HTTP reads. Only RPC is a fixture.
describe("Receipt-confirmed disbursement lifecycle", () => {
  isolateProtocolStore();
  const mocks: Array<{ mockRestore(): void }> = [];
  afterEach(() => { for (const mock of mocks.splice(0)) mock.mockRestore(); });
  const proposalId = 91001;
  const hash = `0x${"12".repeat(32)}` as const;
  const beneficiary = `0x${"ab".repeat(32)}` as const;
  const address = CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS;
  const sender = privateKeyToAccount(`0x${"22".repeat(32)}`);

  it("confirms propose, approve and execute receipts before exposing an executed proposal", async () => {
    mocks.push(spyOn(governancePublicClient, "getChainId").mockResolvedValue(CONTRACT_CONFIG.CHAIN_ID));
    mocks.push(spyOn(governancePublicClient, "getBlock").mockResolvedValue({ hash, timestamp: 1788912000n } as any));
    const receipt = spyOn(governancePublicClient, "getTransactionReceipt");
    const state = spyOn(governancePublicClient, "readContract");
    mocks.push(receipt, state);
    for (const [index, action] of ["propose", "approve", "execute"].entries()) {
      const eventName = ["DisbursementProposed", "DisbursementApproved", "DisbursementExecuted"][index] as "DisbursementProposed" | "DisbursementApproved" | "DisbursementExecuted";
      receipt.mockResolvedValue({ status: "success", blockNumber: 10n, blockHash: hash, from: sender.address,
        logs: [{ address, topics: encodeEventTopics({ abi: GOVERNANCE_ABI, eventName,
          args: { proposalId: BigInt(proposalId), ...(action === "approve" ? { approver: address } : {}) } }),
          data: action === "approve" ? encodeAbiParameters(parseAbiParameters("uint256"), [2n])
            : encodeAbiParameters(parseAbiParameters("uint8,uint256,bytes32,string"), [0, 2500000n, beneficiary, "ipfs://test-proof"]) }],
      } as any);
      state.mockResolvedValue([BigInt(proposalId), 0, 2500000n, 1, beneficiary, "ipfs://test-proof", 202609n, address, index ? 2n : 1n, index] as any);
      const metadata = action === "execute" ? { disbursementReceiptCID: "ipfs://signed-bast" } : undefined;
      const metadataSignature = metadata ? await sender.signMessage({
        message: `Tawf metadata\n${CONTRACT_CONFIG.CHAIN_ID}\n${address.toLowerCase()}\n${hash}\n${JSON.stringify(metadata)}`,
      }) : undefined;
      const proposal = await dbService.confirmGovernance(action as "propose" | "approve" | "execute", hash, proposalId, metadata, metadataSignature);
      const expectedStatus = ["Pending", "Approved", "Executed"][index];
      expect(proposal).toMatchObject({ status: expectedStatus, amountExact: "2500000", chainVerified: true });
      const list = await app.fetch(new Request("http://localhost/api/proposals"));
      expect((await list.json()).proposals).toEqual([expect.objectContaining({ proposalId, status: expectedStatus, beneficiaryHash: beneficiary })]);
    }
    expect(dataStore.proposals.get(proposalId)?.disbursementReceiptCID).toBe("ipfs://signed-bast");
    const before = structuredClone([...dataStore.proposals]);
    receipt.mockResolvedValue({ status: "reverted" } as any);
    await expect(dbService.confirmGovernance("cancel", hash, proposalId)).rejects.toThrow();
    expect([...dataStore.proposals]).toEqual(before);
    expect((await dbService.getAuditOverview()).totalDisbursedIDR).toBe(2500000);
  });

  it("persists cancellation and its reason only from a matching contract receipt", async () => {
    mocks.push(spyOn(governancePublicClient, "getChainId").mockResolvedValue(CONTRACT_CONFIG.CHAIN_ID));
    mocks.push(spyOn(governancePublicClient, "getBlock").mockResolvedValue({ hash, timestamp: 1788912000n } as any));
    mocks.push(spyOn(governancePublicClient, "readContract").mockResolvedValue([
      BigInt(proposalId), 0, 2500000n, 1, beneficiary, "ipfs://test-proof", 202609n, address, 1n, 3,
    ] as any));
    mocks.push(spyOn(governancePublicClient, "getTransactionReceipt").mockResolvedValue({
      status: "success", blockNumber: 10n, blockHash: hash, from: sender.address,
      logs: [{ address, topics: encodeEventTopics({ abi: GOVERNANCE_ABI, eventName: "DisbursementCancelled",
        args: { proposalId: BigInt(proposalId), canceller: sender.address } }),
        data: encodeAbiParameters(parseAbiParameters("string"), ["Confirmed reason"]) }],
    } as any));
    await dbService.confirmGovernance("cancel", hash, proposalId);
    expect(dataStore.proposals.get(proposalId)).toMatchObject({
      status: "Cancelled", chainVerified: true, cancelReason: "Confirmed reason",
    });
  });

});

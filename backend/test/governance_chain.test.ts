import { afterEach, expect, it, spyOn } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters } from "viem";
import { governanceChain, governancePublicClient, GOVERNANCE_ABI } from "../src/governance-chain";
import { CONTRACT_CONFIG } from "../src/config";

const hash = `0x${"ab".repeat(32)}` as const;
const beneficiary = `0x${"cd".repeat(32)}` as const;
const mocks: Array<{ mockRestore(): void }> = [];
afterEach(() => { for (const mock of mocks.splice(0)) mock.mockRestore(); });
function receipt(status = "success", address = CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS, id = 4n, logs = true, amount = 100n) {
  mocks.push(spyOn(governancePublicClient, "getChainId").mockResolvedValue(421614));
  mocks.push(spyOn(governancePublicClient, "getTransactionReceipt").mockResolvedValue({
    status, blockNumber: 10n, blockHash: hash, from: address,
    logs: logs ? [{ address, topics: encodeEventTopics({ abi: GOVERNANCE_ABI, eventName: "DisbursementExecuted", args: { proposalId: id } }),
      data: encodeAbiParameters(parseAbiParameters("uint8,uint256,bytes32,string"), [0, amount, beneficiary, "proof"]) }] : [],
  } as any));
}
it("rejects a successful relayer self-transfer without a contract event", async () => {
  receipt("success", undefined, 4n, false);
  await expect(governanceChain.confirm("execute", hash, 4)).rejects.toThrow("tidak membuktikan");
});
it("rejects reverted receipts", async () => {
  receipt("reverted");
  await expect(governanceChain.confirm("execute", hash, 4)).rejects.toThrow("belum berhasil");
});
it("rejects unsigned evidence even when the transaction succeeded", async () => {
  receipt();
  await expect(governanceChain.confirm("execute", hash, 4, { disbursementReceiptCID: "forged" })).rejects.toThrow("signed");
});
it("does not promote a pending proposal by counting database approvals", async () => {
  mocks.push(spyOn(governancePublicClient, "readContract").mockResolvedValue([4n, 0, 100n, 1, beneficiary, "proof", 202609n, CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS, 1n, 0] as any));
  expect((await governanceChain.readProposal(4)).status).toBe("Pending");
});
it("rejects events from a previous deployment", async () => {
  receipt("success", "0x1111111111111111111111111111111111111111");
  await expect(governanceChain.confirm("execute", hash, 4)).rejects.toThrow("tidak membuktikan");
});
it("rejects another proposal's execution", async () => {
  receipt("success", undefined, 5n);
  await expect(governanceChain.confirm("execute", hash, 4)).rejects.toThrow("tidak membuktikan");
});
it("uses confirmed chain state and block timestamp", async () => {
  receipt();
  mocks.push(spyOn(governancePublicClient, "readContract").mockResolvedValue([4n, 0, 100n, 1, beneficiary, "proof", 202609n, CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS, 2n, 2] as any));
  mocks.push(spyOn(governancePublicClient, "getBlock").mockResolvedValue({ hash, timestamp: 1000n } as any));
  const result = await governanceChain.confirm("execute", hash, 4);
  expect(result.proposal.status).toBe("Executed");
  expect(result.proposal.asnafLabel).toBe("Miskin");
  expect(result.timestamp).toBe("1970-01-01T00:16:40.000Z");
});
it("preserves a uint256 proposal amount above number precision", async () => {
  const amount = 123456789012345678901234567890n;
  mocks.push(spyOn(governancePublicClient, "readContract").mockResolvedValue([4n, 1, amount, 1, beneficiary, "proof", 202609n, CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS, 1n, 0] as any));
  const proposal = await governanceChain.readProposal(4);
  expect(proposal.amountExact).toBe("123456789012345678901234567890");
  expect(proposal.amount).toBe("123456789012345678901234567890");
});

it("confirms a receipt carrying a uint256 amount without rounding it", async () => {
  const amount = 9007199254740993n;
  receipt("success", undefined, 4n, true, amount);
  mocks.push(spyOn(governancePublicClient, "readContract").mockResolvedValue([4n, 0, amount, 1, beneficiary, "proof", 202609n, CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS, 2n, 2] as any));
  mocks.push(spyOn(governancePublicClient, "getBlock").mockResolvedValue({ hash, timestamp: 1000n } as any));
  expect((await governanceChain.confirm("execute", hash, 4)).proposal.amountExact).toBe("9007199254740993");
});

import { afterEach, expect, it, spyOn } from "bun:test";
import app from "../src/index";
import { dbService } from "../src/db";
import { sourceRead } from "../src/source-read";

const mocks: Array<{ mockRestore(): void }> = [];
afterEach(() => { for (const mock of mocks.splice(0)) mock.mockRestore(); });

it("HTTP retains an unverified legacy disbursement beside exact USDC comparisons", async () => {
  mocks.push(spyOn(dbService, "getIndexerState").mockResolvedValue({ lastIndexedBlock: 100, status: "READY" } as any));
  mocks.push(spyOn(dbService, "readDonationRows").mockResolvedValue(sourceRead([])));
  mocks.push(spyOn(dbService, "readBatches").mockResolvedValue(sourceRead([])));
  mocks.push(spyOn(dbService, "readProposalRows").mockResolvedValue(sourceRead([
    { proposalIdOnChain: 1, currencyType: 1, amount: 500000, amountExact: "500000", status: "Executed", asnafCategory: "Amil" },
    { proposalIdOnChain: 2, currencyType: 1, amount: 250, amountExact: null, status: "Executed", asnafCategory: "Amil" },
  ] as any)));
  mocks.push(spyOn(dbService, "readOnchainEventsInRange").mockResolvedValue(sourceRead([
    { eventName: "DisbursementExecuted", blockNumber: 100, txHash: "0x1", argsJson: JSON.stringify({ proposalId: "1", currencyType: 1, amount: "500000" }) },
  ] as any)));
  const response = await app.fetch(new Request("http://localhost/api/reconciliation/internal", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.unverified.USDC_6DP).toEqual([expect.objectContaining({ reference: "PROPOSAL#2", reason: expect.stringMatching(/belum terverifikasi/) })]);
  expect(body.reports.USDC_6DP.netDelta).toEqual({ amount: "0", unit: "USDC_6DP" });
  expect(body.reports.USDC_6DP.entryCounts.matched).toBe(1);
  expect(body.reports.USDC_6DP.amilAssessment.status).toBe("NOT_CHECKED");
});

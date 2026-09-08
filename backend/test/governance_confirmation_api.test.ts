import { expect, it, spyOn } from "bun:test";
import app from "../src/index";
import { dataStore } from "../src/store";
import { governanceChain } from "../src/governance-chain";

it("cannot mark a proposal executed with an arbitrary API payload", async () => {
  const response = await app.fetch(new Request("http://localhost/api/proposals/4/execute", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ disbursementReceiptCID: "QmFileFake" }),
  }));
  expect(response.status).toBe(410);
  expect(dataStore.proposals.get(4)?.status).not.toBe("Executed");
});
it("retires gasless simulation without writing proposals", async () => {
  const before = dataStore.proposals.size;
  const response = await app.fetch(new Request("http://localhost/api/governance/gasless-propose", { method: "POST", body: "{}" }));
  expect(response.status).toBe(410);
  expect(dataStore.proposals.size).toBe(before);
});

it("persists canonical values, ignoring a caller-supplied status", async () => {
  const mock = spyOn(governanceChain, "confirm").mockResolvedValue({
    proposal: { proposalId: 44, currencyType: 0, amount: 100, amountExact: "100", asnafCategory: 1, asnafLabel: "Miskin",
      beneficiaryHash: `0x${"ab".repeat(32)}`, ipfsProofCID: "proof", periodId: 202609,
      usdcRecipient: "0x0000000000000000000000000000000000000000", approvalCount: 1, status: "Pending", chainVerified: true },
    cancelReason: undefined, txHash: `0x${"12".repeat(32)}`, timestamp: "2026-09-08T00:00:00.000Z", sender: "0x0000000000000000000000000000000000000001",
  });
  try {
    const response = await app.fetch(new Request("http://localhost/api/governance/confirm", { method: "POST",
      headers: {"Content-Type":"application/json"}, body: JSON.stringify({ action: "propose", txHash: `0x${"12".repeat(32)}`, status: "Executed", amount: 999999 }) }));
    expect(response.status).toBe(200);
    expect(dataStore.proposals.get(44)?.status).toBe("Pending");
    expect(dataStore.proposals.get(44)?.amount).toBe(100);
  } finally { mock.mockRestore(); dataStore.proposals.delete(44); }
});

it("blocks reads and writes while a new deployment is pending", async () => {
  process.env.DEPLOYMENT_PENDING = "true";
  try {
    for (const [path, method] of [["/api/proposals", "GET"], ["/api/governance/confirm", "POST"]]) {
      const response = await app.fetch(new Request(`http://localhost${path}`, {method}));
      expect(response.status).toBe(503);
    }
  } finally { process.env.DEPLOYMENT_PENDING = "false"; }
});
it("replays chain-confirmed USDC precision without accepting a caller amount", async () => {
  const amountExact = "123456789012345678901234567890";
  const mock = spyOn(governanceChain, "confirm").mockResolvedValue({
    proposal: { proposalId: 45, currencyType: 1, amount: amountExact, amountExact,
      asnafCategory: 2, asnafLabel: "Amil", beneficiaryHash: `0x${"ab".repeat(32)}`,
      ipfsProofCID: "proof", periodId: 202609, usdcRecipient: "0x0000000000000000000000000000000000000000",
      approvalCount: 2, status: "Executed", chainVerified: true },
    cancelReason: undefined, txHash: `0x${"12".repeat(32)}`, timestamp: "2026-09-08T00:00:00.000Z", sender: "0x0000000000000000000000000000000000000001",
  });
  try {
    for (let replay = 0; replay < 2; replay++) {
      const response = await app.fetch(new Request("http://localhost/api/governance/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute", proposalId: 45, txHash: `0x${"12".repeat(32)}`, amountExact: "1" }),
      }));
      expect(response.status).toBe(200);
      expect(dataStore.proposals.get(45)?.amountExact).toBe(amountExact);
      expect(dataStore.proposals.get(45)?.amount).toBe(amountExact);
      const overview = await app.fetch(new Request("http://localhost/api/audit/overview"));
      expect((await overview.json() as any).totalDisbursedUSDC).toBe(amountExact);
    }
  } finally { mock.mockRestore(); dataStore.proposals.delete(45); }
});

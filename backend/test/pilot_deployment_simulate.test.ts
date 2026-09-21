import { expect, test } from "bun:test";
import { assertOwnedLoopbackUrl, simulatePilotDeployment, withOwnedAnvil } from "../src/scripts/pilot-deployment-simulate";

const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const input = () => ({ chainId: 421614, syntheticOnly: true, institutionId: "demo-local-simulation", budgetWei: "5000000000000000",
  roles: { deployer: a(101), admission: a(101), administrator: a(101), relayer: a(101), validator: a(101), zkSigner: a(101), custodian: a(101), browserOfficer: a(101), reportSignatory: a(102), browserApprover: a(102) },
  auditor: { address: a(103), mandate: "DEMO synthetic mandate" } });

test("only numeric IPv4 loopback HTTP URLs are accepted for local execution", () => {
  expect(assertOwnedLoopbackUrl("http://127.0.0.1:12345")).toBe("http://127.0.0.1:12345");
  for (const url of ["https://arb-sepolia.g.alchemy.com", "http://localhost:8545", "http://127.0.0.1.evil.test:8545", "http://user:secret@127.0.0.1:8545", "http://127.0.0.1:8545/path", "http://127.0.0.1:8545?redirect=1"]) {
    expect(() => assertOwnedLoopbackUrl(url)).toThrow();
  }
});

test("wrong upstream chain fails before any state-changing RPC", async () => {
  const methods: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as { method: string; id: number };
    methods.push(body.method);
    return Response.json({ jsonrpc: "2.0", id: body.id, result: "0x1" });
  } });
  try {
    await expect(simulatePilotDeployment(input(), { forkUrl: `http://127.0.0.1:${server.port}` })).rejects.toThrow(/chain mismatch/);
    expect(methods).toEqual(["eth_chainId"]);
  } finally { server.stop(true); }
});

test("owned ephemeral Anvil is stopped even when callback fails", async () => {
  let localUrl = "";
  await expect(withOwnedAnvil({}, async url => { localUrl = url; throw new Error("deliberate-test-failure"); })).rejects.toThrow("deliberate-test-failure");
  await expect(fetch(localUrl, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
}, 30_000);

test("fork mode is exercised against an owned local snapshot, never an external network", async () => {
  await withOwnedAnvil({}, async forkUrl => {
    const result = await simulatePilotDeployment(input(), { forkUrl });
    expect(result.forkBlockNumber).toBe("0");
    expect(result.steps).toHaveLength(11);
    const response = await fetch(forkUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) });
    expect((await response.json() as { result: string }).result).toBe("0x0");
  });
}, 60_000);

test("real local EVM executes four constructors and seven grants and reads authority back", async () => {
  const result = await simulatePilotDeployment(input());
  expect(result.chainId).toBe(421614);
  expect(result.externalBroadcastEnabled).toBe(false);
  expect(result.mode).toBe("local-anvil-simulation");
  expect(result.steps).toHaveLength(11);
  expect(result.steps.every(s => BigInt(s.gasUsed) > 0n && s.receiptStatus === "success")).toBe(true);
  expect(Object.keys(result.simulatedAddresses)).toHaveLength(4);
  expect(result.readbackChecks).toBeGreaterThanOrEqual(14);
  expect(result.budget.completeLiveCostEstimate).toBe(false);
  expect(result.budget.unknownCosts).toContain("Arbitrum L1 posting fees");
  expect(result.localBalanceOverrides).toHaveLength(1);
  expect(result.steps.filter(s => s.label.includes("setAuditor"))).toHaveLength(1);
}, 60_000);

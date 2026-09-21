import { describe, expect, test } from "bun:test";
import { buildPilotPlan, parsePilotInput, HISTORICAL_COMPROMISED_ADDRESS, CONTRACTS, verifyArtifact } from "../src/scripts/pilot-deployment-plan";
import { preflightPilot } from "../src/scripts/pilot-deployment-preflight";
import { keccak256, toHex } from "viem";
import { runPilotDeployment } from "../src/scripts/pilot-deployment";
import { assertCanApproveProposal } from "../src/operational-mandate";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const input = () => ({ chainId: 421614, syntheticOnly: true, institutionId: "synthetic-pilot", budgetWei: "1000000000000000",
  roles: { deployer: address(1), admission: address(2), administrator: address(3), relayer: address(1), reportSignatory: address(4), validator: address(5), zkSigner: address(6), custodian: address(7), browserOfficer: address(8), browserApprover: address(9) } });

test("default CLI needs explicit inputs and never offers broadcast", async () => {
  expect(await runPilotDeployment([])).toMatchObject({ status: "pending-public-input", broadcastEnabled: false });
  await expect(runPilotDeployment(["--broadcast"])).rejects.toThrow(/not supported/);
  await expect(runPilotDeployment(["--preflight"])).rejects.toThrow(/requires/);
});

test("confirmed three public accounts support separate signer/validator and personal officers", () => {
  const admin = HISTORICAL_COMPROMISED_ADDRESS;
  const signer = "0x6214e4e81a075c7ca6f4b5725ecd943d1c6b642c";
  const auditor = "0xe8a4ee352b95a4fc08667df5d85c167006fe2a2f";
  const plan = buildPilotPlan(parsePilotInput({ ...input(), budgetWei: "5000000000000000", allowHistoricalCompromisedWallet: true,
    roles: { deployer: admin, admission: admin, administrator: admin, relayer: admin, reportSignatory: signer, validator: admin,
      zkSigner: admin, custodian: admin, browserOfficer: admin, browserApprover: signer }, auditor: { address: auditor, mandate: "SYNTHETIC-DEMO-ONLY" } }));
  expect(plan.actions.find(a => a.functionName === "setValidator")!.args).toEqual([admin, true]);
  expect(plan.actions.filter(a => a.functionName === "setSigner")).toHaveLength(1);
  expect(assertCanApproveProposal({ creatorOfficerId: "synthetic-preparer", creatorAccount: admin, approverOfficerId: "synthetic-approver", approverAccount: signer }).allowed).toBe(true);
  expect(assertCanApproveProposal({ creatorOfficerId: "same-person", creatorAccount: admin, approverOfficerId: "same-person", approverAccount: signer }).allowed).toBe(false);
});

describe("pilot plan safety and exact authority calls", () => {
  test("deterministic four-contract dependency order and explicit senders", () => {
    const config = parsePilotInput(input());
    const plan = buildPilotPlan(config);
    expect(plan).toEqual(buildPilotPlan(config));
    expect(plan.deployments.map(d => d.contract)).toEqual(["ReportEvidenceRegistry", "Groth16Verifier", "ContributionProofRegistry", "DistributionCertificateNFT"]);
    expect(plan.deployments[2]!.args).toEqual([{ contract: "Groth16Verifier" }, config.roles.admission]);
    expect(plan.deployments[3]!.args).toEqual([{ contract: "ReportEvidenceRegistry" }]);
    expect(plan.actions.map(a => [a.functionName, a.sender])).toEqual([
      ["enrollInstitution", config.roles.admission], ["setSignatory", config.roles.administrator],
      ["setValidator", config.roles.admission], ["enrollInstitution", config.roles.admission],
      ["setSigner", config.roles.administrator], ["setSigner", config.roles.administrator],
      ["setCustodian", config.roles.administrator],
    ]);
    expect(plan.actions[5]!.args).toEqual([config.institutionId, config.roles.administrator, false]);
    expect(plan.legacyProtocol).toBe("0x0d6cec28a574aca41b879767b081f6f2b4e9a849");
    expect(plan.broadcastEnabled).toBe(false);
  });
  test("rejects other chain, missing budget, secrets, zero addresses and collapsed roles", () => {
    for (const patch of [{ chainId: 1 }, { syntheticOnly: false }, { budgetWei: "0" }, { budgetWei: "5000000000000001" }, { budgetWei: "invalid" }, { budgetWei: undefined }, { privateKey: "not-accepted" }]) {
      expect(() => parsePilotInput({ ...input(), ...patch })).toThrow();
    }
    for (const [role, value] of [["reportSignatory", address(5)], ["browserOfficer", address(9)], ["browserOfficer", address(4)], ["custodian", address(0)]]) {
      expect(() => parsePilotInput({ ...input(), roles: { ...input().roles, [role!]: value } })).toThrow();
    }
  });
  test("compromised wallet is permitted only with explicit synthetic-testnet acknowledgement", () => {
    const data = { ...input(), roles: { ...input().roles, admission: HISTORICAL_COMPROMISED_ADDRESS } };
    expect(() => parsePilotInput(data)).toThrow(/compromised/);
    const plan = buildPilotPlan(parsePilotInput({ ...data, allowHistoricalCompromisedWallet: true }));
    expect(plan.warnings.join(" ")).toContain("compromised");
  });
  test("optional auditor requires mandate and administrator sender; no implied auditor", () => {
    expect(buildPilotPlan(parsePilotInput(input())).actions.some(a => a.functionName === "setAuditor")).toBe(false);
    expect(() => parsePilotInput({ ...input(), auditor: { address: address(10), mandate: "" } })).toThrow();
    const plan = buildPilotPlan(parsePilotInput({ ...input(), auditor: { address: address(10), mandate: "SYNTHETIC-ONLY" } }));
    expect(plan.actions.at(-1)).toMatchObject({ contract: "ReportEvidenceRegistry", functionName: "setAuditor", sender: address(3), args: ["synthetic-pilot", address(10), true, "SYNTHETIC-ONLY"] });
  });
});

test("artifact verification rejects DAO verifier, wrong constructor and stale source", async () => {
  const source = "generated verifier";
  const artifact = { abi: [{ type: "function", name: "verifyProof", inputs: [{type: "uint256[2]"}, {type: "uint256[2][2]"}, {type: "uint256[2]"}, {type: "uint256[5]"}], outputs: [{type: "bool"}], stateMutability: "view" }], bytecode: { object: "0x6000" }, metadata: { settings: { compilationTarget: { "src/Groth16Verifier.sol": "Groth16Verifier" } }, sources: { "src/Groth16Verifier.sol": { keccak256: keccak256(toHex(source)) } } } };
  expect((await verifyArtifact(CONTRACTS[1]!, artifact, async () => source)).bytecode).toBe("0x6000");
  await expect(verifyArtifact(CONTRACTS[1]!, { ...artifact, metadata: { ...artifact.metadata, settings: { compilationTarget: { "lib/tawf-gov/Groth16Verifier.sol": "Groth16Verifier" } } } }, async () => source)).rejects.toThrow(/target/);
  await expect(verifyArtifact(CONTRACTS[0]!, artifact, async () => source)).rejects.toThrow();
  await expect(verifyArtifact(CONTRACTS[1]!, { ...artifact, abi: [...artifact.abi, { type: "constructor", inputs: [{ type: "address" }], stateMutability: "nonpayable" }] }, async () => source)).rejects.toThrow(/constructor/);
  await expect(verifyArtifact(CONTRACTS[1]!, { ...artifact, bytecode: { object: "0x__$unlinked$__" } }, async () => source)).rejects.toThrow(/unlinked/);
  await expect(verifyArtifact(CONTRACTS[1]!, artifact, async () => "changed")).rejects.toThrow(/stale/);
});

test("read-only preflight fails chain first and marks dependent estimates pending", async () => {
  const plan = buildPilotPlan(parsePilotInput(input()));
  const calls: string[] = [];
  const rpc = { getChainId: async () => 421614, getBlockNumber: async () => 123n,
    getBalance: async () => 10n ** 18n, getCode: async () => "0x" as const,
    getTransactionCount: async () => 0, getGasPrice: async () => 2n,
    estimateGas: async () => { calls.push("estimateGas"); return 100n; } };
  const artifacts = Object.fromEntries(CONTRACTS.map(c => [c.name, { abi: c.constructorTypes.length ? [{ type: "constructor", inputs: c.constructorTypes.map(type => ({ type })), stateMutability: "nonpayable" }] : [], bytecode: "0x6000" }])) as any;
  await expect(preflightPilot(plan, artifacts, { ...rpc, getChainId: async () => 1 })).rejects.toThrow(/421614/);
  expect(calls).toHaveLength(0);
  const result = await preflightPilot(plan, artifacts, rpc);
  expect(calls).toHaveLength(2);
  expect(result.estimates.filter(e => e.status === "pending-dependencies")).toHaveLength(2);
  expect(result.completeBudgetEstimate).toBe(false);
  expect(result.broadcastEnabled).toBe(false);
  await expect(preflightPilot(plan, artifacts, { ...rpc, getCode: async () => "0x6000" })).rejects.toThrow(/Deployer has code/);
  const failed = await preflightPilot(plan, artifacts, { ...rpc, estimateGas: async () => { throw new Error("https://secret-rpc-token.example"); } });
  expect(failed.estimates.filter(e => e.status === "rpc-estimate-failed")).toHaveLength(2);
  expect(JSON.stringify(failed)).not.toContain("secret-rpc-token");
  const overBudget = await preflightPilot({ ...plan, budgetWei: "1" }, artifacts, { ...rpc, getBalance: async () => 0n });
  expect(overBudget.partialEstimateExceedsBudget).toBe(true);
  expect(overBudget.deployerBalanceBelowPartialEstimate).toBe(true);
});

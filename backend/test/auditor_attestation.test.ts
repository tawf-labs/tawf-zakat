import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import app, { AUDITOR_EIP712_DOMAIN, AUDITOR_EIP712_TYPES } from "../src/index";
import { dbService } from "../src/db/index";
import * as ipfs from "../src/ipfs";
import { dataStore } from "../src/store";
import { isolateProtocolStore, seedProposal } from "./helpers/protocol-fixture";

// Signing uses a public test-only key. RPC and profile storage are controlled boundaries.
describe("Auditor attestation verification", () => {
  isolateProtocolStore();
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const mocks: Array<{ mockRestore(): void }> = [];
  const auditorName = "Test audit firm";
  let profile: ReturnType<typeof spyOn<typeof dbService, "getAuditorProfile">>;
  beforeEach(() => {
    profile = spyOn(dbService, "getAuditorProfile").mockResolvedValue({
      id: 1, accountAddress: account.address, name: auditorName, kapLicenseNumber: "TEST",
      licenseProofCID: "ipfs://test-license", isActive: true, registeredBy: account.address,
      registeredAt: new Date(), updatedAt: new Date(),
    });
    mocks.push(profile);
    mocks.push(spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const request = JSON.parse(String(init?.body));
      if (request.method !== "eth_call") throw new Error(`Unexpected RPC: ${request.method}`);
      return Response.json({ jsonrpc: "2.0", id: request.id, result: `0x${"0".repeat(63)}1` });
    }, { preconnect: fetch.preconnect })));
  });
  afterEach(() => { for (const mock of mocks.splice(0)) mock.mockRestore(); });

  async function signedPayload() {
    const proposal = seedProposal({ status: "Executed" });
    const timestamp = Math.floor(Date.now() / 1000);
    const documents = { laiDocumentCID: "ipfs://test-lai", financialStatementsCID: "ipfs://test-financials" };
    const signature = await account.signTypedData({ domain: AUDITOR_EIP712_DOMAIN, types: AUDITOR_EIP712_TYPES,
      primaryType: "AuditorAttestation", message: { proposalId: BigInt(proposal.proposalId),
        beneficiaryHash: proposal.beneficiaryHash, amountIDR: BigInt(proposal.amount), auditOpinion: "WTP",
        standard: "PSAK 109 & Fikih BAZNAS", auditorName, ...documents, timestamp: BigInt(timestamp) } });
    return { proposalId: proposal.proposalId, auditorAddress: account.address, auditOpinion: "WTP", ...documents, timestamp, signature };
  }
  const post = (body: unknown) => app.fetch(new Request("http://localhost/api/audit/attest", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));

  it("rejects forged signatures and document substitution without recording an audit", async () => {
    const body = await signedPayload();
    for (const altered of [{ ...body, signature: `0x${"99".repeat(65)}` }, { ...body, laiDocumentCID: "ipfs://substituted" }]) {
      expect((await post(altered)).status).toBe(401);
      expect(dataStore.proposals.get(body.proposalId)?.auditStatus).toBeUndefined();
    }
  });
  it("requires both registered identity and confirmed execution", async () => {
    const body = await signedPayload();
    dataStore.proposals.get(body.proposalId)!.chainVerified = false;
    expect((await post(body)).status).toBe(409);
    profile.mockResolvedValue(null);
    expect((await post(body)).status).toBe(403);
    expect(dataStore.proposals.get(body.proposalId)?.auditStatus).toBeUndefined();
  });
  it("verifies a valid signature but does not invent an audit transaction without a relayer", async () => {
    const body = await signedPayload();
    const upload = spyOn(ipfs, "uploadAuditReportToIPFS").mockResolvedValue({ cid: "test-audit", gatewayUrl: "https://example.test/test-audit" });
    mocks.push(upload);
    expect(process.env.PRIVATE_KEY).toBeUndefined();
    const response = await post(body);
    expect(response.status).toBe(503);
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ auditorSignature: body.signature, auditorName }));
    expect(dataStore.proposals.get(body.proposalId)?.auditTxHash).toBeUndefined();
    expect(dataStore.proposals.get(body.proposalId)?.auditStatus).toBeUndefined();
  });
});

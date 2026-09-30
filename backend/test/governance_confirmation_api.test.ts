import { describe, expect, it } from "bun:test";
import app from "../src/index";
import { dataStore } from "../src/store";
import { isolateProtocolStore, seedProposal } from "./helpers/protocol-fixture";
import { createTestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore } from "../src/tenancy-store";
import { configureWorkspace, resetWorkspace, workspaceRuntime } from "../src/workspace-runtime";

const retiredRoutes = [
  ["POST", "/api/governance/confirm"],
  ["POST", "/api/proposals"],
  ["POST", "/api/proposals/intake"],
  ...["sync-tx", "approve", "cancel", "execute", "bast"].map(action => ["POST", `/api/proposals/4/${action}`]),
  ...["propose", "approve", "execute", "cancel"].map(action => ["POST", `/api/governance/gasless-${action}`]),
  ["GET", "/api/governance/auditors"],
  ["GET", "/api/governance/auditors/0x0000000000000000000000000000000000000001"],
  ["POST", "/api/governance/auditors/register"],
  ["POST", "/api/audit/attest"],
  ["POST", "/api/governance/attest-audit"],
  ["GET", "/api/audit/overview"],
  ["GET", "/api/safe/info"],
  ["GET", "/api/safe/pending"],
  ["POST", "/api/disbursement/upload-proof"],
  ["POST", "/api/ipfs/upload-file"],
  ["POST", "/api/ipfs/upload-document"],
];

describe("Supervisor portal HTTP retirement", () => {
  isolateProtocolStore();
  for (const [method, path] of retiredRoutes) {
    it(`${method} ${path} is absent and cannot mutate historical proposals`, async () => {
      seedProposal({ proposalId: 4, status: "Approved" });
      const before = structuredClone([...dataStore.proposals]);
      const response = await app.fetch(new Request(`http://localhost${path}`, {
        method, ...(method === "POST" ? { body: JSON.stringify({ proposalId: 4, status: "Executed" }) } : {}),
      }));
      expect(response.status).toBe(404);
      expect([...dataStore.proposals]).toEqual(before);
    });
  }

  it("preserves historical public proposal reads and the independent admin roster", async () => {
    const proposal = seedProposal({ status: "Executed" });
    const response = await app.fetch(new Request("http://localhost/api/proposals"));
    expect(response.status).toBe(200);
    expect((await response.json()).proposals).toEqual([expect.objectContaining({ proposalId: proposal.proposalId })]);
    for (const path of ["/api/governance/roles", "/api/events"]) {
      const res = await app.fetch(new Request(`http://localhost${path}`));
      expect(res.status).toBe(200);
      expect((await res.json()).success).toBe(true);
    }
  });

  it("keeps the configured workspace door available behind its authentication gate", async () => {
    const previous = workspaceRuntime();
    const database = await createTestWorkspaceDatabase();
    try {
      const store = createWorkspaceStore(database.handle());
      await store.ensureSchema();
      configureWorkspace({ store, ethCall: async () => "0x", now: () => 1_800_000_000,
        challengeTtlSeconds: 300, sessionTtlSeconds: 3600 });
      const response = await app.fetch(new Request("http://localhost/api/workspace"));
      expect(response.status).toBe(401);
      expect((await response.json()).success).toBe(false);
    } finally {
      if (previous) configureWorkspace(previous);
      else resetWorkspace();
      await database.close();
    }
  });

  it("keeps the unconfigured workspace door explicit rather than returning 404", async () => {
    const previous = workspaceRuntime();
    resetWorkspace();
    try {
      const response = await app.fetch(new Request("http://localhost/api/workspace"));
      expect(response.status).toBe(503);
      expect((await response.json()).success).toBe(false);
    } finally {
      if (previous) configureWorkspace(previous);
    }
  });

  it("still blocks active reads and workspace writes while deployment is pending", async () => {
    const previous = process.env.DEPLOYMENT_PENDING;
    process.env.DEPLOYMENT_PENDING = "true";
    try {
      for (const [path, method] of [["/api/proposals", "GET"], ["/api/workspace/challenge", "POST"]]) {
        expect((await app.fetch(new Request(`http://localhost${path}`, { method }))).status).toBe(503);
      }
    } finally {
      if (previous === undefined) delete process.env.DEPLOYMENT_PENDING;
      else process.env.DEPLOYMENT_PENDING = previous;
    }
  });
});

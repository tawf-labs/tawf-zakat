import { expect, it } from "bun:test";
import { createReportVersions } from "../src/report-versions.ts";
import { canonicalJson, commitmentFor } from "../src/evidence-snapshot.ts";
import { evidenceTypedData } from "../../shared/report-registry.ts";
import { hashTypedData, keccak256, toHex } from "viem";
import type { WorkspaceRuntime } from "../src/workspace-runtime.ts";

function fixture(options: { recoveryMidRead?: boolean } = {}) {
  const salt = `0x${"11".repeat(32)}`;
  const snapshot = { institutionId: "i", preparationId: "prep", period: {}, balanceSheetScope: "BOTH",
    currencyUnit: "IDR", sides: [], files: [], tolerance: { amount: "0", unit: "IDR" } };
  const body = { id: "p", institutionId: "i", preparationId: "prep", reportId: "r", version: "1", snapshot,
    policy: { id: "policy", amilChecks: [] }, verdict: { outcome: "LOLOS" }, reconciliation: null };
  const canonical = canonicalJson(body);
  const digest = commitmentFor(new TextEncoder().encode(canonical), salt);
  const snap = canonicalJson(snapshot);
  const storedPackage = { canonical, digest };
  const record = { canonicalSnapshot: snap, commitmentSalt: salt,
    commitment: commitmentFor(new TextEncoder().encode(snap), salt), files: [] };
  const domain = { name: "Tawf Report Evidence", version: "1", chainId: 31337,
    verifyingContract: `0x${"22".repeat(20)}` } as const;
  const authorization = { action: keccak256(toHex("PUBLISH_REPORT")), institutionId: "i", reportId: "r",
    version: "1", packageId: "p", predecessor: "", digest, policy: "policy", outcome: "LOLOS",
    signer: `0x${"55".repeat(20)}`, authorityEpoch: "1", nonce: `0x${"66".repeat(32)}`, deadline: "1000" } as any;
  const intent = { id: "recovered-attempt", domain, authorization,
    authorizationDigest: hashTypedData(evidenceTypedData(domain, authorization)), observation: { state: "PREPARED" } };
  const hash = `0x${"44".repeat(32)}`;
  let content: any = null, listCalls = 0, canonicalHash = "canonical", writes = 0;
  let winningInsert: ((candidate: any) => any) | null = null;
  const chain: any = { domain, requiredConfirmations: 2, confirmationPolicy: "block-depth-v1", readOnly: true,
    readHead: async () => ({ blockNumber: "10", blockHash: "canonical" }),
    canonicalBlock: async () => canonicalHash, readAt: () => chain,
    publishedVersion: async () => ({ institution: authorization, validator: { signer: authorization.signer } }),
    publishedPackageVersion: async () => "1", officialLine: async () => ({ packageId: "p", version: "1" }),
    versionAttestations: async () => [],
    observe: async () => ({ state: "CONFIRMED", confirmations: 2, requiredConfirmations: 2,
      confirmationPolicy: "block-depth-v1", blockNumber: "9", blockHash: "publication-block" }),
  };
  const runtime = { evidence: {
    getPreparation: async () => record, getReportPackage: async () => storedPackage,
    findReportPackage: async () => storedPackage, getPublicReport: async () => content,
    savePublicReport: async (_id: string, candidate: any) => {
      writes++;
      // Models another request winning INSERT ... ON CONFLICT DO NOTHING.
      if (winningInsert) { content ??= winningInsert(candidate); winningInsert = null; }
      content ??= candidate;
    },
  }, store: { getInstitution: async () => ({ legalName: "Institution", isSynthetic: true }) },
    registry: { chain, store: {
      list: async () => ++listCalls === 1 && options.recoveryMidRead ? [] : [intent],
      get: async () => intent, attempt: async () => ({ hash }),
    } },
  } as unknown as WorkspaceRuntime;
  return {
    summary: () => createReportVersions(runtime, "i", "prep", "p").publicSummary(),
    durable: () => content, listCalls: () => listCalls, writes: () => writes,
    replaceReference: () => { canonicalHash = "replacement"; },
    raceNextInsert: (winner: (candidate: any) => any) => { winningInsert = winner; },
  };
}

it("does not mix a recovered attempt into a publication set already observed in this request", async () => {
  const f = fixture({ recoveryMidRead: true });
  await expect(f.summary()).rejects.toMatchObject({ status: 404 });
  expect(f.durable()).toBeNull();
  expect(f.listCalls()).toBe(1);
  const next = await f.summary();
  expect(next.publication).toMatchObject({ state: "PUBLISHED", observation: { state: "CONFIRMED" } });
  expect(next.anchor?.state).toBe("CONFIRMED");
});
it("discards buffered public content when canonical validation fails", async () => {
  const f = fixture(); f.replaceReference();
  await expect(f.summary()).rejects.toThrow("Acuan pembacaan");
  expect(f.writes()).toBe(0);
});
it("rejects an immutable insert conflict and reads the durable winner on the next explicit request", async () => {
  const f = fixture();
  f.raceNextInsert(candidate => ({ ...candidate, institution: { ...candidate.institution, name: "Concurrent winner" } }));
  await expect(f.summary()).rejects.toThrow("tersimpan bersamaan");
  const next = await f.summary();
  expect(next.content.institution.name).toBe("Concurrent winner");
  expect(next.content).toEqual(f.durable());
  expect(next.publication.observation?.state).toBe("CONFIRMED");
});

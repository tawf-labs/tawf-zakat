/**
 * ADR-0041: when the institution decides outside the application (Lazismu: rapat
 * pengurus / bendahara), the amil publishes a complete proposal straight to APPROVED,
 * citing that internal decision. The in-app examination + signed decision path stays
 * available and is the only path for an institution whose policy decides in the app.
 *
 * Real HTTP routes over real SQL and the encrypted private file store.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { createDisbursementStore, type DisbursementStore } from "../src/disbursement-store";
import { createContributionStore } from "../src/contribution-store";
import { createEncryptedFileStore, type PrivateFileStore } from "../src/evidence-files";
import { createActivityStore, type ActivityStore } from "../src/activity-store";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";

const BASE = "http://localhost:3001/api/workspace";
const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";

const adminSinar = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
const amilSinar = privateKeyToAccount(`0x${"22".repeat(32)}` as Hex);
const readerSinar = privateKeyToAccount(`0x${"33".repeat(32)}` as Hex);
const amilBaitul = privateKeyToAccount(`0x${"55".repeat(32)}` as Hex);

const NOW = 1_800_000_000;
let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let disbursement: DisbursementStore;
let activities: ActivityStore;
let files: PrivateFileStore;
let tempDir: string;

const request = (path: string, init: RequestInit = {}) => app.fetch(new Request(`${BASE}${path}`, init));
const post = (path: string, body: unknown, token?: string) =>
  request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const get = (path: string, token: string) => request(path, { headers: { Authorization: `Bearer ${token}` } });

async function signIn(account: typeof amilSinar, institutionId: string): Promise<string> {
  const { challenge, typedData } = await (await post("/challenge", { institutionId, account: account.address })).json();
  const signature = await account.signTypedData({
    ...typedData,
    message: { ...typedData.message, issuedAt: BigInt(typedData.message.issuedAt), expiresAt: BigInt(typedData.message.expiresAt) },
  });
  const session = await post("/session", { nonce: challenge.nonce, signature });
  expect(session.status).toBe(201);
  return (await session.json()).token;
}

const verificationDocument = {
  category: "RECIPIENT_VERIFICATION",
  fileName: "berita-acara-rt03.txt",
  mimeType: "text/plain",
  beneficiaryId: null,
  contentBase64: Buffer.from("Berita acara verifikasi warga RT 03/RW 05").toString("base64"),
};

async function draftProposal(token: string, adminToken: string, options: { withVerification?: boolean } = {}) {
  const program = await post("/programs", {
    name: "Penyaluran Zakat ke 100 Mustahik", purpose: "Santunan dhuafa", fundType: "ZAKAT",
    scope: "Tangerang Selatan", referenceCeiling: "100000000",
  }, adminToken);
  expect(program.status).toBe(201);
  const programId = (await program.json()).program.id;
  const created = await post("/proposals", {
    expectedVersion: 0, operationId: crypto.randomUUID(), programId,
    originOfRequest: "Data warga dari RT 03/RW 05", purpose: "Santunan dhuafa Oktober",
    personInCharge: "Bendahara", aidPeriod: { start: "2026-10-01", end: "2026-10-31" },
    beneficiaries: [1, 2].map((i) => ({
      id: `ben-${i}`, name: `Mustahik ${i}`, asnaf: "Fakir", addressOrScope: "RT 03/RW 05",
      identityBasis: { kind: "NIK", value: `367401010101000${i}` }, guardian: null, paymentRecipient: null,
    })),
    aidLines: [
      { id: "aid-1", beneficiaryId: "ben-1", aidType: "Uang tunai", period: "2026-10", value: { kind: "MONEY", amountRequestedIdr: "500000" } },
      { id: "aid-2", beneficiaryId: "ben-2", aidType: "Sembako", period: "2026-10",
        value: { kind: "GOODS", unit: "paket", quantityRequested: "2", valuedAmountIdr: null } },
    ],
  }, token);
  expect(created.status).toBe(201);
  const draft = (await created.json()).draft;
  if (options.withVerification !== false) {
    expect((await post(`/proposals/${draft.id}/documents`, verificationDocument, token)).status).toBe(201);
  }
  return { draft, programId };
}

const publish = (id: string, token: string, body: Record<string, unknown>) =>
  post(`/proposals/${id}/publish`, { operationId: crypto.randomUUID(), ...body }, token);

describe("Terbitkan pengajuan dengan keputusan internal di luar aplikasi (ADR-0041)", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "proposal-publish-test-"));
    files = createEncryptedFileStore({ directory: tempDir, key: Buffer.alloc(32, 41) });
    database = await createTestWorkspaceDatabase(process.env.PUBLISH_TEST_DATABASE_URL);
    store = createWorkspaceStore(database.handle());
    disbursement = createDisbursementStore(database.handle());
    activities = createActivityStore(database.handle());
    await store.ensureSchema();
    await disbursement.ensureSchema();
    await createContributionStore(database.handle()).ensureSchema();
    await activities.ensureSchema();
  });

  afterAll(async () => {
    resetWorkspace();
    await database.close();
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    await database.reset();
    configureWorkspace({
      store, disbursement, activities, files, ethCall: async () => "0x", now: () => NOW,
      sessionTtlSeconds: 3600, challengeTtlSeconds: 300,
    });
    for (const inst of SYNTHETIC_INSTITUTIONS) await store.upsertInstitution(institutionRecordOf(inst));
    await store.upsertMembership({ institutionId: SINAR, account: adminSinar.address, role: "ADMIN" });
    await store.upsertMembership({ institutionId: SINAR, account: amilSinar.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: SINAR, account: readerSinar.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: BAITUL, account: amilBaitul.address, role: "OFFICER" });
    for (const [id, name, account] of [
      ["off-admin-sinar", "Admin Sinar", adminSinar], ["off-amil-sinar", "Amil Sinar", amilSinar],
      ["off-reader-sinar", "Petugas tanpa mandat", readerSinar],
    ] as const) {
      await store.createOfficerProfile({ id, institutionId: SINAR, displayName: name, account: account.address,
        role: id === "off-admin-sinar" ? "ADMIN" : "OFFICER", actor: adminSinar.address, now: NOW });
    }
    for (const [officerId, fn] of [
      ["off-admin-sinar", "MANAGE_PROGRAMS"], ["off-amil-sinar", "PREPARE_PROPOSALS"], ["off-amil-sinar", "RECORD_REALIZATION"],
    ] as const) {
      await store.grantMandate({ institutionId: SINAR, actor: adminSinar.address, now: NOW, mandate: {
        officerId, function: fn, scopeType: "ALL_PROGRAMS", assignmentRef: `SK/${fn}`, validFrom: NOW - 1000, validUntil: NOW + 86400 * 30,
      } });
    }
  });

  it("publishes a complete proposal straight to APPROVED, citing the internal decision, by the same amil", async () => {
    const amil = await signIn(amilSinar, SINAR);
    const admin = await signIn(adminSinar, SINAR);
    const policy = (await (await get("/policy", admin)).json()).policy;
    expect(policy.decisionOutsideApp).toBe(true);

    const { draft } = await draftProposal(amil, admin);
    const res = await publish(draft.id, amil, {
      expectedVersion: draft.version, decisionReference: "Rapat pengurus 28 Sep 2026", decisionDate: "2026-09-28",
    });
    expect(res.status).toBe(200);
    const published = (await res.json()).draft;
    expect(published.status).toBe("APPROVED");
    // What was requested is what the internal decision granted.
    expect(published.aidLines[0].value.amountApprovedIdr).toBe("500000");
    expect(published.aidLines[1].value.quantityApproved).toBe("2");

    const decision = (await (await get(`/proposals/${draft.id}/decision`, amil)).json()).decision;
    expect(decision).toMatchObject({
      action: "APPROVE", basis: "RECORDED_OUTSIDE_APP", decisionReference: "Rapat pengurus 28 Sep 2026",
      decisionDate: "2026-09-28", operatorOfficerId: "off-amil-sinar", signature: null, decisionDocumentId: null,
    });

    const history = (await (await get(`/proposals/${draft.id}/history`, amil)).json()).history;
    expect(history.map((h: { action: string; toStatus: string }) => [h.action, h.toStatus])).toEqual([["PUBLISH", "APPROVED"]]);
    expect((await get(`/proposals/${draft.id}/versions/${published.version}`, amil)).status).toBe(200);
  });

  it("makes the published proposal ready for an activity and for realization within the requested rights", async () => {
    const amil = await signIn(amilSinar, SINAR);
    const admin = await signIn(adminSinar, SINAR);
    const { draft } = await draftProposal(amil, admin);
    const published = (await (await publish(draft.id, amil, {
      expectedVersion: draft.version, decisionReference: "Rapat pengurus", decisionDate: "2026-09-28",
    })).json()).draft;

    const activity = await post("/activities", { operationId: crypto.randomUUID(), proposalId: draft.id, name: "Santunan Oktober" }, amil);
    expect(activity.status).toBe(201);

    const realize = (amountIdr: string) => post(`/proposals/${draft.id}/realizations`, {
      operationId: crypto.randomUUID(), expectedVersion: published.version,
      items: [{ aidLineId: "aid-1", beneficiaryId: "ben-1", reportedAt: NOW - 60, method: "CASH", amountIdr }],
    }, amil);
    expect((await realize("600000")).status).toBe(409);
    expect((await realize("500000")).status).toBe(201);
  });

  it("requires the internal decision reference and a valid date", async () => {
    const amil = await signIn(amilSinar, SINAR);
    const { draft } = await draftProposal(amil, await signIn(adminSinar, SINAR));
    expect((await publish(draft.id, amil, { expectedVersion: draft.version, decisionReference: "  ", decisionDate: "2026-09-28" })).status).toBe(400);
    expect((await publish(draft.id, amil, { expectedVersion: draft.version, decisionReference: "Rapat", decisionDate: "28/09/2026" })).status).toBe(400);
    expect((await (await get(`/proposals/${draft.id}`, amil)).json()).draft.status).toBe("DRAFT");
  });

  it("refuses an incomplete proposal with the same completeness issues as a submission", async () => {
    const amil = await signIn(amilSinar, SINAR);
    const { draft } = await draftProposal(amil, await signIn(adminSinar, SINAR), { withVerification: false });
    const res = await publish(draft.id, amil, { expectedVersion: draft.version, decisionReference: "Rapat", decisionDate: "2026-09-28" });
    expect(res.status).toBe(400);
    expect((await res.json()).issues.map((i: { field: string }) => i.field)).toEqual(["documents.recipientVerification"]);
  });

  it("refuses publishing when the institution decides inside the application", async () => {
    const amil = await signIn(amilSinar, SINAR);
    const admin = await signIn(adminSinar, SINAR);
    const policy = (await (await get("/policy", admin)).json()).policy;
    expect((await post("/policy", { ...policy, expectedVersion: policy.version, decisionOutsideApp: false }, admin)).status).toBe(200);

    const { draft } = await draftProposal(amil, admin);
    const res = await publish(draft.id, amil, { expectedVersion: draft.version, decisionReference: "Rapat", decisionDate: "2026-09-28" });
    expect(res.status).toBe(409);
    expect((await (await get(`/proposals/${draft.id}`, amil)).json()).draft.status).toBe("DRAFT");
  });

  it("requires the PREPARE_PROPOSALS mandate and keeps institutions apart", async () => {
    const amil = await signIn(amilSinar, SINAR);
    const { draft } = await draftProposal(amil, await signIn(adminSinar, SINAR));
    const body = { expectedVersion: draft.version, decisionReference: "Rapat", decisionDate: "2026-09-28" };
    expect((await publish(draft.id, await signIn(readerSinar, SINAR), body)).status).toBe(403);
    expect((await publish(draft.id, await signIn(amilBaitul, BAITUL), body)).status).toBe(404);
  });

  it("replays a retried publication and refuses a second publication", async () => {
    const amil = await signIn(amilSinar, SINAR);
    const { draft } = await draftProposal(amil, await signIn(adminSinar, SINAR));
    const body = { operationId: "publish-once", expectedVersion: draft.version, decisionReference: "Rapat", decisionDate: "2026-09-28" };
    const first = await post(`/proposals/${draft.id}/publish`, body, amil);
    const retry = await post(`/proposals/${draft.id}/publish`, body, amil);
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect((await retry.json()).draft.version).toBe((await first.json()).draft.version);
    expect((await post(`/proposals/${draft.id}/publish`, { ...body, operationId: "publish-twice" }, amil)).status).toBe(409);
  });
});

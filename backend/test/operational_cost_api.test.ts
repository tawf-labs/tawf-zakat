/**
 * Biaya operasional per item, sumber dana, panjar, talangan dan koreksi berversi
 * (ADR-0042, issue #125). Real HTTP routes over real SQL.
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
const adminBaitul = privateKeyToAccount(`0x${"66".repeat(32)}` as Hex);

const NOW = 1_800_000_000;
let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let disbursement: DisbursementStore;
let activities: ActivityStore;
let files: PrivateFileStore;
let tempDir: string;

const request = (path: string, init: RequestInit = {}) => app.fetch(new Request(`${BASE}${path}`, init));
const post = (path: string, body: unknown, token: string) =>
  request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
const get = (path: string, token: string) => request(path, { headers: { Authorization: `Bearer ${token}` } });

async function signIn(account: typeof amilSinar, institutionId: string): Promise<string> {
  const minted = await request("/challenge", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ institutionId, account: account.address }),
  });
  const { challenge, typedData } = await minted.json();
  const signature = await account.signTypedData({
    ...typedData,
    message: { ...typedData.message, issuedAt: BigInt(typedData.message.issuedAt), expiresAt: BigInt(typedData.message.expiresAt) },
  });
  const session = await request("/session", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nonce: challenge.nonce, signature }),
  });
  expect(session.status).toBe(201);
  return (await session.json()).token;
}

/** A published (approved) proposal of one recipient, on the institution's internal decision. */
async function publishedProposal(amil: string, admin: string) {
  const program = await post("/programs", {
    name: "Jumat Berkah", purpose: "Santunan", fundType: "INFAK", scope: "Tangerang Selatan", referenceCeiling: "10000000",
  }, admin);
  expect(program.status).toBe(201);
  const programId = (await program.json()).program.id;
  const created = await post("/proposals", {
    expectedVersion: 0, operationId: crypto.randomUUID(), programId,
    originOfRequest: "Data RT", purpose: "Santunan Jumat", personInCharge: "Bendahara",
    aidPeriod: { start: "2026-09-01", end: "2026-09-30" },
    beneficiaries: [{ id: "ben-1", name: "Mustahik 1", asnaf: "Fakir", addressOrScope: "RT 03",
      identityBasis: { kind: "NIK", value: "3674010101010001" }, guardian: null, paymentRecipient: null }],
    aidLines: [{ id: "aid-1", beneficiaryId: "ben-1", aidType: "Uang tunai", period: "2026-09",
      value: { kind: "MONEY", amountRequestedIdr: "1000000" } }],
  }, amil);
  expect(created.status).toBe(201);
  const draft = (await created.json()).draft;
  expect((await post(`/proposals/${draft.id}/documents`, {
    category: "RECIPIENT_VERIFICATION", fileName: "ba.txt", mimeType: "text/plain", beneficiaryId: null,
    contentBase64: Buffer.from("Berita acara").toString("base64"),
  }, amil)).status).toBe(201);
  const published = await post(`/proposals/${draft.id}/publish`, {
    operationId: crypto.randomUUID(), expectedVersion: draft.version, decisionReference: "Rapat pengurus", decisionDate: "2026-09-27",
  }, amil);
  expect(published.status).toBe(200);
  return (await published.json()).draft as { id: string; version: number };
}

const costs = (proposalId: string) => `/proposals/${proposalId}/operational-costs`;
const talangan = (holderOfficerId: string) => ({ kind: "TALANGAN", holderOfficerId });
const line = (overrides: Record<string, unknown> = {}) => ({
  spentOn: "2026-09-28", purpose: "Bensin", quantity: "10", unit: "liter", unitPriceIdr: "10000", amountIdr: "100000",
  payee: "SPBU 34.153", fundingSource: talangan("off-ahmad"), ...overrides,
});
const recordItems = (proposalId: string, items: unknown[], token: string, operationId: string = crypto.randomUUID()) =>
  post(`${costs(proposalId)}/items`, { operationId, items }, token);
const overview = async (proposalId: string, token: string) =>
  (await (await get(costs(proposalId), token)).json()) as {
    items: any[]; panjar: any[]; reimbursements: any[]; holders: any[]; totals: Record<string, string>;
  };

describe("Biaya operasional per item (ADR-0042, #125)", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "operational-cost-test-"));
    files = createEncryptedFileStore({ directory: tempDir, key: Buffer.alloc(32, 42) });
    database = await createTestWorkspaceDatabase(process.env.OPERATIONAL_COST_TEST_DATABASE_URL);
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

  let amil: string;
  let admin: string;
  let proposal: { id: string; version: number };

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
    await store.upsertMembership({ institutionId: BAITUL, account: adminBaitul.address, role: "ADMIN" });
    const profiles: Array<[string, string, string, typeof amilSinar | null, string]> = [
      ["off-admin", "Admin Sinar", SINAR, adminSinar, "ADMIN"],
      ["off-amil", "Amil Sinar", SINAR, amilSinar, "OFFICER"],
      ["off-reader", "Petugas tanpa mandat", SINAR, readerSinar, "OFFICER"],
      // Field officers without a login: they pay and carry cash, an admin records it.
      ["off-ahmad", "Ahmad", SINAR, null, "OFFICER"],
      ["off-siti", "Siti", SINAR, null, "OFFICER"],
      ["off-baitul", "Amil Baitul", BAITUL, amilBaitul, "OFFICER"],
    ];
    for (const [id, displayName, institutionId, account, role] of profiles) {
      await store.createOfficerProfile({
        id, institutionId, displayName, ...(account ? { account: account.address, role: role as "ADMIN" | "OFFICER" } : {}),
        actor: institutionId === SINAR ? adminSinar.address : adminBaitul.address, now: NOW,
      });
    }
    for (const [officerId, fn, institutionId] of [
      ["off-admin", "MANAGE_PROGRAMS", SINAR], ["off-amil", "PREPARE_PROPOSALS", SINAR],
      ["off-amil", "RECORD_REALIZATION", SINAR], ["off-baitul", "RECORD_REALIZATION", BAITUL],
    ] as const) {
      await store.grantMandate({ institutionId, actor: institutionId === SINAR ? adminSinar.address : adminBaitul.address, now: NOW, mandate: {
        officerId, function: fn, scopeType: "ALL_PROGRAMS", assignmentRef: `SK/${fn}`, validFrom: NOW - 1000, validUntil: NOW + 86400 * 30,
      } });
    }
    amil = await signIn(amilSinar, SINAR);
    admin = await signIn(adminSinar, SINAR);
    proposal = await publishedProposal(amil, admin);
  });

  it("records a batch row by row for officers without a login, returning each bad row with its problems", async () => {
    const res = await recordItems(proposal.id, [
      line(),
      line({ purpose: "Sewa mobil pick-up", quantity: "1", unit: "hari", unitPriceIdr: "300000", amountIdr: "300000", payee: "Rental Pak Udin" }),
      line({ amountIdr: "110000" }),
      line({ fundingSource: talangan("off-baitul") }),
      line({ purpose: "Cetak foto dokumentasi", quantity: null, unit: null, unitPriceIdr: null, amountIdr: "25000",
        payee: "Fotocopy Jaya", fundingSource: { kind: "KAS_LEMBAGA" } }),
    ], amil);
    expect(res.status).toBe(201);
    const { results } = await res.json();
    expect(results.map((r: any) => (r.item ? "ok" : r.issues.map((i: any) => i.field).join(",")))).toEqual(
      ["ok", "ok", "amountIdr", "fundingSource", "ok"]
    );

    const view = await overview(proposal.id, amil);
    expect(view.items.map((i) => [i.purpose, i.version, i.recordedByOfficerId, i.fundingSource.kind])).toEqual([
      ["Bensin", 1, "off-amil", "TALANGAN"],
      ["Sewa mobil pick-up", 1, "off-amil", "TALANGAN"],
      ["Cetak foto dokumentasi", 1, "off-amil", "KAS_LEMBAGA"],
    ]);
    expect(view.holders).toEqual([
      { officerId: "off-ahmad", name: "Ahmad", talanganOutstandingIdr: "400000", talanganReimbursedIdr: "0", panjar: [] },
    ]);
  });

  it("replays a retried batch instead of recording it twice", async () => {
    const first = await recordItems(proposal.id, [line()], amil, "batch-once");
    const retry = await recordItems(proposal.id, [line()], amil, "batch-once");
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect((await retry.json()).results[0].item.id).toBe((await first.json()).results[0].item.id);
    expect((await overview(proposal.id, amil)).items).toHaveLength(1);
  });

  it("tracks a panjar: spending capped at what remains, the rest returned", async () => {
    const issued = await post(`${costs(proposal.id)}/panjar`, {
      operationId: crypto.randomUUID(), holderOfficerId: "off-siti", amountIdr: "300000", purpose: "Jumat Berkah",
      cashOutRef: "BKK-001", issuedOn: "2026-09-28",
    }, amil);
    expect(issued.status).toBe(201);
    const panjarId = (await issued.json()).panjar.id;
    const fromPanjar = { kind: "PANJAR", panjarId };

    const res = await recordItems(proposal.id, [
      line({ purpose: "Kantong plastik", quantity: "2", unit: "pak", unitPriceIdr: "100000", amountIdr: "200000", fundingSource: fromPanjar }),
      line({ purpose: "Tali rafia", quantity: null, unit: null, unitPriceIdr: null, amountIdr: "150000", fundingSource: fromPanjar }),
      line({ purpose: "Tali rafia", quantity: null, unit: null, unitPriceIdr: null, amountIdr: "50000", fundingSource: fromPanjar }),
    ], amil);
    expect((await res.json()).results.map((r: any) => (r.item ? "ok" : r.issues[0].field))).toEqual(["ok", "fundingSource", "ok"]);

    const returnPath = `${costs(proposal.id)}/panjar/${panjarId}/returns`;
    expect((await post(returnPath, { operationId: crypto.randomUUID(), amountIdr: "60000", returnedOn: "2026-09-29", reference: "Setor kas" }, amil)).status).toBe(400);
    expect((await post(returnPath, { operationId: crypto.randomUUID(), amountIdr: "50000", returnedOn: "2026-09-29", reference: "Setor kas" }, amil)).status).toBe(201);

    const view = await overview(proposal.id, amil);
    expect(view.holders).toEqual([{ officerId: "off-siti", name: "Siti", talanganOutstandingIdr: "0", talanganReimbursedIdr: "0", panjar: [
      { panjarId, cashOutRef: "BKK-001", amountIdr: "300000", usedIdr: "250000", returnedIdr: "50000", remainingIdr: "0" },
    ] }]);
    expect(view.totals).toEqual({ directExpensesIdr: "0", panjarAccountedIdr: "250000", panjarNetIdr: "250000", totalItemsIdr: "250000" });
  });

  it("corrects a row as a new version with a reason, keeping every earlier version", async () => {
    const recorded = (await (await recordItems(proposal.id, [line()], amil)).json()).results[0].item;
    const correct = (body: Record<string, unknown>) =>
      post(`${costs(proposal.id)}/items/${recorded.id}/correct`, { operationId: crypto.randomUUID(), ...body }, amil);

    expect((await correct({ expectedVersion: 1, reason: "ups", item: line({ unitPriceIdr: "11000", amountIdr: "110000" }) })).status).toBe(400);
    expect((await correct({ expectedVersion: 1, reason: "Salah ketik, struk Rp110.000", item: line({ amountIdr: "110000" }) })).status).toBe(400);
    expect((await correct({ expectedVersion: 2, reason: "Salah ketik, struk Rp110.000", item: line({ unitPriceIdr: "11000", amountIdr: "110000" }) })).status).toBe(409);

    const ok = await correct({ expectedVersion: 1, reason: "Salah ketik, struk Rp110.000",
      item: line({ unitPriceIdr: "11000", amountIdr: "110000", fundingSource: talangan("off-siti") }) });
    expect(ok.status).toBe(200);
    expect((await ok.json()).item).toMatchObject({ version: 2, amountIdr: "110000", fundingSource: talangan("off-siti") });

    const { history } = await (await get(`${costs(proposal.id)}/items/${recorded.id}/history`, amil)).json();
    expect(history.map((h: any) => [h.version, h.change, h.item.amountIdr, h.item.fundingSource.holderOfficerId, h.reason])).toEqual([
      [1, "RECORD", "100000", "off-ahmad", null],
      [2, "CORRECT", "110000", "off-siti", "Salah ketik, struk Rp110.000"],
    ]);
  });

  it("voids a double entry without deleting it, and it stops counting", async () => {
    const recorded = (await (await recordItems(proposal.id, [line(), line()], amil)).json()).results[1].item;
    const voidRow = (expectedVersion: number) => post(`${costs(proposal.id)}/items/${recorded.id}/void`,
      { operationId: crypto.randomUUID(), expectedVersion, reason: "Input dobel dari nota yang sama" }, amil);
    expect((await voidRow(1)).status).toBe(200);
    expect((await voidRow(2)).status).toBe(409);
    expect((await post(`${costs(proposal.id)}/items/${recorded.id}/correct`, {
      operationId: crypto.randomUUID(), expectedVersion: 2, reason: "Coba ubah baris batal", item: line(),
    }, amil)).status).toBe(409);

    const view = await overview(proposal.id, amil);
    expect(view.items.map((i) => i.status)).toEqual(["ACTIVE", "VOIDED"]);
    expect(view.totals.totalItemsIdr).toBe("100000");
  });

  it("reimburses one officer's talangan and then closes those rows to correction", async () => {
    const results = (await (await recordItems(proposal.id, [
      line(), line({ purpose: "Sewa mobil", quantity: null, unit: null, unitPriceIdr: null, amountIdr: "300000" }),
      line({ fundingSource: talangan("off-siti") }), line({ fundingSource: { kind: "KAS_LEMBAGA" } }),
    ], amil)).json()).results;
    const [bensin, mobil, siti, kas] = results.map((r: any) => r.item.id);
    const reimburse = (holderOfficerId: string, itemIds: string[]) => post(`${costs(proposal.id)}/reimbursements`, {
      operationId: crypto.randomUUID(), holderOfficerId, itemIds, paidOn: "2026-09-30", reference: "Transfer BSI 8812",
    }, amil);

    expect((await reimburse("off-ahmad", [bensin, siti])).status).toBe(400);
    expect((await reimburse("off-ahmad", [bensin, kas])).status).toBe(400);
    const paid = await reimburse("off-ahmad", [bensin, mobil]);
    expect(paid.status).toBe(201);
    expect((await paid.json()).reimbursement).toMatchObject({ holderOfficerId: "off-ahmad", totalIdr: "400000" });
    expect((await reimburse("off-ahmad", [bensin])).status).toBe(409);

    expect((await post(`${costs(proposal.id)}/items/${bensin}/correct`, {
      operationId: crypto.randomUUID(), expectedVersion: 1, reason: "Ubah setelah diganti", item: line({ amountIdr: "100000" }),
    }, amil)).status).toBe(409);
    expect((await post(`${costs(proposal.id)}/items/${mobil}/void`, {
      operationId: crypto.randomUUID(), expectedVersion: 1, reason: "Batal setelah diganti",
    }, amil)).status).toBe(409);

    const view = await overview(proposal.id, amil);
    expect(view.holders.find((h) => h.officerId === "off-ahmad")).toMatchObject({ talanganOutstandingIdr: "0", talanganReimbursedIdr: "400000" });
    expect(view.reimbursements).toHaveLength(1);
  });

  it("feeds the realization summary and activity accountability, never the aid realized", async () => {
    const activity = await post("/activities", { operationId: crypto.randomUUID(), proposalId: proposal.id, name: "Jumat Berkah" }, amil);
    expect(activity.status).toBe(201);
    const activityId = (await activity.json()).activity.id;

    const issued = await post(`${costs(proposal.id)}/panjar`, {
      operationId: crypto.randomUUID(), holderOfficerId: "off-siti", amountIdr: "300000", purpose: "Jumat Berkah",
      cashOutRef: "BKK-001", issuedOn: "2026-09-28",
    }, amil);
    const panjarId = (await issued.json()).panjar.id;
    await recordItems(proposal.id, [
      line(),
      line({ purpose: "Plastik", quantity: null, unit: null, unitPriceIdr: null, amountIdr: "40000", fundingSource: { kind: "PANJAR", panjarId } }),
    ], amil);

    const summary = (await (await get(`/proposals/${proposal.id}/realization-summary`, amil)).json()).summary;
    expect(summary).toMatchObject({ totalRealizedIdr: "0", totalExpensesIdr: "140000", totalAdvancesIdr: "300000" });

    const accountability = (await (await get(`/activities/${activityId}/accountability`, amil)).json()).accountability;
    expect(accountability).toMatchObject({
      totalRealizedMoneyIdr: "0", totalDirectExpensesIdr: "100000", totalAccountedExpensesIdr: "40000",
      totalAdvancesIdr: "300000", unaccountedAdvancesIdr: "260000",
    });
  });

  it("suggests purposes already used in the institution, most used first, never another institution's", async () => {
    const results = (await (await recordItems(proposal.id, [
      line(), line({ purpose: "Sewa mobil", quantity: null, unit: null, unitPriceIdr: null, amountIdr: "300000" }), line(),
    ], amil)).json()).results;
    await post(`${costs(proposal.id)}/items/${results[1].item.id}/void`,
      { operationId: crypto.randomUUID(), expectedVersion: 1, reason: "Input dobel dari nota" }, amil);
    await recordItems((await publishedProposal(amil, admin)).id, [line({ purpose: "Kantong plastik" })], amil);

    expect((await (await get("/operational-cost-purposes", amil)).json()).purposes).toEqual(["Bensin", "Kantong plastik"]);
    expect((await (await get("/operational-cost-purposes", await signIn(amilBaitul, BAITUL))).json()).purposes).toEqual([]);
    expect((await request("/operational-cost-purposes")).status).toBe(401);
  });

  it("requires the realization mandate, an approved proposal and the caller's own institution", async () => {
    const reader = await signIn(readerSinar, SINAR);
    expect((await recordItems(proposal.id, [line()], reader)).status).toBe(403);
    expect((await recordItems(proposal.id, [line()], await signIn(amilBaitul, BAITUL))).status).toBe(404);
    expect((await get(costs(proposal.id), await signIn(amilBaitul, BAITUL))).status).toBe(404);

    const draft = await post("/proposals", { expectedVersion: 0, operationId: crypto.randomUUID(), programId: null }, amil);
    const draftId = (await draft.json()).draft.id;
    expect((await recordItems(draftId, [line()], amil)).status).toBe(409);
    expect((await post(`${costs(proposal.id)}/panjar`, {
      operationId: crypto.randomUUID(), holderOfficerId: "off-baitul", amountIdr: "1000", purpose: "x", cashOutRef: "BKK", issuedOn: "2026-09-28",
    }, amil)).status).toBe(400);
  });
});

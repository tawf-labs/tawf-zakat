/**
 * The old uang muka and biaya rows (#95) carried into the ADR-0042 model on startup (#128).
 * Real HTTP routes over real SQL: old rows are written straight into the old tables, the
 * schema is ensured again as a restart would, and the activity's numbers must not move.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
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

const adminSinar = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
const amilSinar = privateKeyToAccount(`0x${"22".repeat(32)}` as Hex);

const NOW = 1_800_000_000;
// 23:00 UTC on 14 January 2027 is already 15 January in Tangerang Selatan (WIB).
const ISSUED = 1_799_967_600;

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
const rowsOf = async (query: ReturnType<typeof sql>) => {
  const result: any = await database.handle().execute(query);
  return (result.rows ?? result) as any[];
};

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

/** Rows the retired modal wrote: two uang muka, two biaya against the first, one paid directly. */
async function seedLegacyRows(proposalId: string) {
  const account = amilSinar.address.toLowerCase();
  for (const [id, amount, purpose, reference, at] of [
    ["adv-lama-1", "500000", "Uang muka Jumat Berkah", "BKK-LAMA-01", ISSUED],
    ["adv-lama-2", "200000", "Uang muka transport", "BKK-LAMA-02", ISSUED + 60],
  ] as const) {
    await database.handle().execute(sql`
      INSERT INTO disbursement_realization_advances (
        id, institution_id, proposal_id, officer_id, officer_account, amount_idr, purpose, reference, issued_at
      ) VALUES (${id}, ${SINAR}, ${proposalId}, 'off-amil', ${account}, ${amount}, ${purpose}, ${reference}, ${at})
    `);
  }
  for (const [id, advanceId, amount, purpose, payee, documentRef, at] of [
    ["exp-lama-1", "adv-lama-1", "300000", "Beras 20 kg", "Toko Berkah", "KW-77", ISSUED + 120],
    ["exp-lama-2", "adv-lama-1", "50000", "Plastik", "Toko Berkah", "KW-77 ", ISSUED + 180],
    ["exp-lama-3", null, "150000", "Transport relawan", "Supir", "Kuitansi supir", ISSUED + 240],
  ] as const) {
    await database.handle().execute(sql`
      INSERT INTO disbursement_realization_expenses (
        id, institution_id, proposal_id, advance_id, amount_idr, purpose, payee, document_ref, recorded_by_officer_id, recorded_at
      ) VALUES (${id}, ${SINAR}, ${proposalId}, ${advanceId}, ${amount}, ${purpose}, ${payee}, ${documentRef}, 'off-amil', ${at})
    `);
  }
}

/**
 * The activity's operational numbers as the reader before #128 computed them: the old rows
 * summed straight from their tables, plus whatever the tab had already recorded.
 */
async function numbersBeforeMigration(proposalId: string, token: string) {
  const [advances] = await rowsOf(sql`
    SELECT COALESCE(SUM(amount_idr::numeric), 0)::text AS total FROM disbursement_realization_advances
    WHERE institution_id = ${SINAR} AND proposal_id = ${proposalId}
  `);
  const [expenses] = await rowsOf(sql`
    SELECT
      COALESCE(SUM(CASE WHEN advance_id IS NULL THEN amount_idr::numeric ELSE 0 END), 0)::text AS direct_total,
      COALESCE(SUM(CASE WHEN advance_id IS NOT NULL THEN amount_idr::numeric ELSE 0 END), 0)::text AS accounted_total
    FROM disbursement_realization_expenses
    WHERE institution_id = ${SINAR} AND proposal_id = ${proposalId}
  `);
  const { totals } = await (await get(`/proposals/${proposalId}/operational-costs`, token)).json();
  const plus = (a: string, b: string) => (BigInt(a) + BigInt(b)).toString();
  return {
    totalDirectExpensesIdr: plus(expenses.direct_total, totals.directExpensesIdr),
    totalAccountedExpensesIdr: plus(expenses.accounted_total, totals.panjarAccountedIdr),
    totalAdvancesIdr: plus(advances.total, totals.panjarNetIdr),
  };
}

async function counts() {
  const counted: Record<string, number> = {};
  for (const table of ["operational_cost_panjar", "operational_cost_items", "operational_cost_receipts", "operational_cost_item_versions"]) {
    counted[table] = Number((await rowsOf(sql.raw(`SELECT COUNT(*) AS n FROM ${table}`)))[0].n);
  }
  return counted;
}

describe("Migrasi uang muka & biaya lama ke model ADR-0042 (#128)", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "operational-cost-migration-test-"));
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
  let proposal: { id: string; version: number };
  let activityId: string;

  beforeEach(async () => {
    await database.reset();
    configureWorkspace({
      store, disbursement, activities, files, ethCall: async () => "0x", now: () => NOW,
      sessionTtlSeconds: 3600, challengeTtlSeconds: 300,
    });
    for (const inst of SYNTHETIC_INSTITUTIONS) await store.upsertInstitution(institutionRecordOf(inst));
    await store.upsertMembership({ institutionId: SINAR, account: adminSinar.address, role: "ADMIN" });
    await store.upsertMembership({ institutionId: SINAR, account: amilSinar.address, role: "OFFICER" });
    for (const [id, displayName, account, role] of [
      ["off-admin", "Admin Sinar", adminSinar, "ADMIN"],
      ["off-amil", "Amil Sinar", amilSinar, "OFFICER"],
      ["off-siti", "Siti", null, "OFFICER"],
    ] as const) {
      await store.createOfficerProfile({
        id, institutionId: SINAR, displayName, ...(account ? { account: account.address, role } : {}),
        actor: adminSinar.address, now: NOW,
      });
    }
    for (const [officerId, fn] of [["off-admin", "MANAGE_PROGRAMS"], ["off-amil", "PREPARE_PROPOSALS"], ["off-amil", "RECORD_REALIZATION"]] as const) {
      await store.grantMandate({ institutionId: SINAR, actor: adminSinar.address, now: NOW, mandate: {
        officerId, function: fn, scopeType: "ALL_PROGRAMS", assignmentRef: `SK/${fn}`, validFrom: NOW - 1000, validUntil: NOW + 86400 * 30,
      } });
    }
    amil = await signIn(amilSinar, SINAR);
    proposal = await publishedProposal(amil, await signIn(adminSinar, SINAR));
    const activity = await post("/activities", { operationId: crypto.randomUUID(), proposalId: proposal.id, name: "Jumat Berkah" }, amil);
    expect(activity.status).toBe(201);
    activityId = (await activity.json()).activity.id;
  });

  /** Old rows beside rows the tab already recorded, then a restart. */
  async function migrateWithTabRows() {
    const costs = `/proposals/${proposal.id}/operational-costs`;
    expect((await post(`${costs}/panjar`, {
      operationId: crypto.randomUUID(), holderOfficerId: "off-siti", amountIdr: "100000", purpose: "Jumat Berkah",
      cashOutRef: "BKK-001", issuedOn: "2027-01-15",
    }, amil)).status).toBe(201);
    expect((await post(`${costs}/items`, { operationId: crypto.randomUUID(), items: [{
      spentOn: "2027-01-15", purpose: "Cetak foto", amountIdr: "25000", payee: "Fotocopy Jaya", fundingSource: { kind: "KAS_LEMBAGA" },
    }] }, amil)).status).toBe(201);
    await seedLegacyRows(proposal.id);
    const before = await numbersBeforeMigration(proposal.id, amil);
    await disbursement.ensureSchema();
    return before;
  }

  const accountability = async () =>
    (await (await get(`/activities/${activityId}/accountability`, amil)).json()).accountability;

  it("keeps every activity's operational numbers the same after the migration, and after running it again", async () => {
    const before = await migrateWithTabRows();
    expect(before).toEqual({ totalDirectExpensesIdr: "175000", totalAccountedExpensesIdr: "350000", totalAdvancesIdr: "800000" });

    const after = await accountability();
    expect(after).toMatchObject({ ...before, unaccountedAdvancesIdr: "450000", totalRealizedMoneyIdr: "0" });
    const summary = (await (await get(`/proposals/${proposal.id}/realization-summary`, amil)).json()).summary;
    expect(summary).toMatchObject({ totalRealizedIdr: "0", totalExpensesIdr: "525000", totalAdvancesIdr: "800000" });

    const carried = await counts();
    expect(carried).toEqual({
      operational_cost_panjar: 3, operational_cost_items: 4, operational_cost_receipts: 2, operational_cost_item_versions: 4,
    });
    await disbursement.ensureSchema();
    expect(await counts()).toEqual(carried);
    expect(await accountability()).toEqual(after);
  });

  it("carries an uang muka into a panjar held by the officer who recorded it, and a biaya into a cost row", async () => {
    await migrateWithTabRows();
    const view = await (await get(`/proposals/${proposal.id}/operational-costs`, amil)).json();

    expect(view.panjar.find((p: any) => p.id === "adv-lama-1")).toMatchObject({
      holderOfficerId: "off-amil", amountIdr: "500000", purpose: "Uang muka Jumat Berkah", cashOutRef: "BKK-LAMA-01",
      issuedOn: "2027-01-15", recordedByOfficerId: "off-amil", recordedAt: ISSUED, returns: [],
    });
    const items = Object.fromEntries(view.items.map((i: any) => [i.id, i]));
    expect(items["exp-lama-1"]).toMatchObject({
      version: 1, status: "ACTIVE", spentOn: "2027-01-15", purpose: "Beras 20 kg", quantity: null, unit: null, unitPriceIdr: null,
      amountIdr: "300000", payee: "Toko Berkah", fundingSource: { kind: "PANJAR", panjarId: "adv-lama-1" },
      recordedByOfficerId: "off-amil", recordedAt: ISSUED + 120, reimbursementId: null,
    });
    expect(items["exp-lama-3"].fundingSource).toEqual({ kind: "KAS_LEMBAGA" });

    // The free-text "Dokumen rujukan" becomes one nota per number, text only and marked old.
    const legacy = view.receipts.filter((r: any) => r.legacy);
    expect(legacy.map((r: any) => [r.reference, r.kind, r.files.length, r.evidencedAt])).toEqual([
      ["KW-77", "NOTA", 0, ISSUED + 120],
      ["Kuitansi supir", "NOTA", 0, ISSUED + 240],
    ]);
    expect(items["exp-lama-1"].receiptId).toBe(legacy[0].id);
    expect(items["exp-lama-2"].receiptId).toBe(legacy[0].id);
    expect(items["exp-lama-3"].receiptId).toBe(legacy[1].id);
    expect(view.holders.find((h: any) => h.officerId === "off-amil").panjar).toEqual([
      { panjarId: "adv-lama-1", cashOutRef: "BKK-LAMA-01", amountIdr: "500000", usedIdr: "350000", returnedIdr: "0", remainingIdr: "150000" },
      { panjarId: "adv-lama-2", cashOutRef: "BKK-LAMA-02", amountIdr: "200000", usedIdr: "0", returnedIdr: "0", remainingIdr: "200000" },
    ]);

    const history = (await (await get(`/proposals/${proposal.id}/operational-costs/items/exp-lama-1/history`, amil)).json()).history;
    expect(history).toEqual([{
      itemId: "exp-lama-1", version: 1, change: "RECORD", reason: "Dipindahkan dari catatan biaya lama.",
      actorOfficerId: "off-amil", actorAccount: amilSinar.address.toLowerCase(), at: ISSUED + 120,
      item: {
        spentOn: "2027-01-15", purpose: "Beras 20 kg", quantity: null, unit: null, unitPriceIdr: null, amountIdr: "300000",
        payee: "Toko Berkah", fundingSource: { kind: "PANJAR", panjarId: "adv-lama-1" }, receiptId: legacy[0].id, status: "ACTIVE",
      },
    }]);
  });

  it("treats carried rows like any other: capped panjar, correction kept by a rerun", async () => {
    await migrateWithTabRows();
    const costs = `/proposals/${proposal.id}/operational-costs`;
    const over = await post(`${costs}/items`, { operationId: crypto.randomUUID(), items: [{
      spentOn: "2027-01-16", purpose: "Minyak goreng", amountIdr: "200000", payee: "Toko Berkah",
      fundingSource: { kind: "PANJAR", panjarId: "adv-lama-1" },
    }] }, amil);
    expect((await over.json()).results[0].issues.map((i: any) => i.field)).toEqual(["fundingSource"]);

    expect((await post(`${costs}/items/exp-lama-3/void`,
      { operationId: crypto.randomUUID(), expectedVersion: 1, reason: "Input dobel dari nota" }, amil)).status).toBe(200);
    await disbursement.ensureSchema();
    const view = await (await get(costs, amil)).json();
    expect(view.items.find((i: any) => i.id === "exp-lama-3")).toMatchObject({ status: "VOIDED", version: 2 });
    expect((await accountability()).totalDirectExpensesIdr).toBe("25000");
  });

  it("refuses the old forms, pointing at the tab, while the old lists read the carried rows", async () => {
    await migrateWithTabRows();
    for (const path of ["advances", "expenses"]) {
      const refused = await post(`/proposals/${proposal.id}/${path}`, {
        operationId: crypto.randomUUID(), amountIdr: "1000", purpose: "x", reference: "x", payee: "x", documentRef: "x",
      }, amil);
      expect(refused.status).toBe(410);
      expect((await refused.json()).error).toContain("tab Biaya operasional");
    }

    const advances = (await (await get(`/proposals/${proposal.id}/advances`, amil)).json()).advances;
    expect(advances.find((a: any) => a.id === "adv-lama-1")).toEqual({
      id: "adv-lama-1", institutionId: SINAR, proposalId: proposal.id, officerId: "off-amil",
      officerAccount: amilSinar.address.toLowerCase(), amountIdr: "500000", purpose: "Uang muka Jumat Berkah",
      reference: "BKK-LAMA-01", accountedIdr: "350000", unaccountedIdr: "150000", issuedAt: ISSUED,
    });
    expect(advances).toHaveLength(3);

    const expenses = (await (await get(`/proposals/${proposal.id}/expenses`, amil)).json()).expenses;
    expect(expenses.find((e: any) => e.id === "exp-lama-2")).toEqual({
      id: "exp-lama-2", institutionId: SINAR, proposalId: proposal.id, advanceId: "adv-lama-1", amountIdr: "50000",
      purpose: "Plastik", payee: "Toko Berkah", documentRef: "KW-77", recordedByOfficerId: "off-amil", recordedAt: ISSUED + 180,
    });
    expect(expenses).toHaveLength(4);

    // The period report reads the same rows, in the order they happened.
    const source = await disbursement.readRealizationSourceData(SINAR);
    expect(source.advances.map((a) => a.id).slice(0, 2)).toEqual(["adv-lama-1", "adv-lama-2"]);
    expect(source.expenses.map((e) => [e.id, e.advanceId])).toEqual([
      ["exp-lama-1", "adv-lama-1"], ["exp-lama-2", "adv-lama-1"], ["exp-lama-3", null], [expect.stringMatching(/^opc-/), null],
    ]);
  });
});

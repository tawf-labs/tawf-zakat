/**
 * Allocation Reallocation and Activity Accountability over authenticated HTTP with PGlite (Issue #107, Spec #100).
 *
 * Covers:
 * - AC07: Connection between allocations, actual expenses, advances, and accountability.
 *   Double counting prevented (procurement expenses & advances tracked separately; physical units
 *   such as 'paket' / 'kg' kept strictly separate from IDR).
 * - AC08 / US-37: Reallocation decisions record source, target, exact amount, reason, officer,
 *   versions, and enforce fund type & purpose compatibility with the target activity.
 * - AC02 / AC11: Undelivered aid is not automatically free balance. Outstanding advances, unvalued
 *   goods, and valued goods not yet handed over all hold the allocation; only the delivered share
 *   is freed. Unvalued goods on an unclosed proposal render availability INDETERMINATE.
 * - AC07: Actual purchase price is charged, not the planned valuation, and the purchase and the
 *   handover are counted once between them.
 * - AC03: A stale source or target activity version is refused rather than silently applied.
 * - AC10 / #106: A correction made through the real correction endpoint leaves a visible shortfall,
 *   which makes availability INDETERMINATE instead of letting the same gap be spent again.
 * - AC12 / #106: A refund decided or paid leaves the contribution and never travels on as a
 *   reallocation.
 * - Remainder closure (#96) terminates unspent approved obligations without auto-reallocating; unspent
 *   allocated funds then become AVAILABLE for explicit reallocation.
 * - Concurrency protection: atomic row locking prevents double reallocation / over-allocation.
 * - Replay idempotency and isolation between ruang kerja lembaga (AC29).
 * - Database restart persistence.
 * - AC05 / AC06: a browser smoke over the real screens at phone width, opt-in via
 *   REGISTRY_BROWSER_MODULE.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore } from "../src/tenancy-store";
import { createDisbursementStore } from "../src/disbursement-store";
import { createContributionStore } from "../src/contribution-store";
import { createActivityStore } from "../src/activity-store";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { type EthCall } from "../src/account-signature";
import { createEncryptedFileStore, type PrivateFileStore } from "../src/evidence-files";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";

const FILE_KEY = Buffer.alloc(32, 9);
const BASE = "http://localhost:3001/api/workspace";
const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";
const NOW = 1_800_000_000;

const adminSinar = privateKeyToAccount(`0x${"1a".repeat(32)}` as Hex);
const preparerSinar = privateKeyToAccount(`0x${"1b".repeat(32)}` as Hex);
const approverSinar = privateKeyToAccount(`0x${"1c".repeat(32)}` as Hex);
const amilSinar = privateKeyToAccount(`0x${"1d".repeat(32)}` as Hex);
const adminBaitul = privateKeyToAccount(`0x${"2a".repeat(32)}` as Hex);
const amilBaitul = privateKeyToAccount(`0x${"2b".repeat(32)}` as Hex);

let tempDir: string;
let files: PrivateFileStore;
let database: TestWorkspaceDatabase;
let clock = NOW;
/** The same store the routes use, for asserting on what a browser run actually wrote. */
let activities: ReturnType<typeof createActivityStore>;
const ethCall: EthCall = async () => "0x";

function configure(handle: ReturnType<TestWorkspaceDatabase["handle"]>) {
  activities = createActivityStore(handle);
  configureWorkspace({
    store: createWorkspaceStore(handle),
    disbursement: createDisbursementStore(handle),
    contributions: createContributionStore(handle),
    activities,
    files,
    ethCall,
    now: () => clock,
    challengeTtlSeconds: 300,
    sessionTtlSeconds: 3600,
  });
}

const request = (path: string, init: RequestInit = {}) => app.fetch(new Request(`${BASE}${path}`, init));

const post = (path: string, body: unknown, token: string) =>
  request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(
      typeof body === "object" && body !== null && /\/(advances|expenses|reallocate)$/.test(path)
        ? { operationId: crypto.randomUUID(), ...(body as object) }
        : body
    ),
  });

const mutate = (path: string, body: Record<string, unknown>, token: string) =>
  post(path, { operationId: crypto.randomUUID(), ...body }, token);

const get = (path: string, token: string) => request(path, { headers: { Authorization: `Bearer ${token}` } });

async function signIn(account: typeof amilSinar, institutionId: string): Promise<string> {
  const minted = await request("/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ institutionId, account: account.address }),
  });
  const { challenge, typedData } = await minted.json();
  const signature = await account.signTypedData({
    ...typedData,
    message: {
      ...typedData.message,
      nonce: challenge.nonce,
      issuedAt: BigInt(challenge.issuedAt),
      expiresAt: BigInt(challenge.expiresAt),
    },
  });
  const res = await request("/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ institutionId, account: account.address, nonce: challenge.nonce, signature }),
  });
  return (await res.json()).token;
}

type Tokens = { amil: string; preparer: string; approver: string };

async function signInSinar(): Promise<Tokens> {
  return {
    amil: await signIn(amilSinar, SINAR),
    preparer: await signIn(preparerSinar, SINAR),
    approver: await signIn(approverSinar, SINAR),
  };
}

const signable = (typedData: any) => {
  const uints = new Set(
    typedData.types[typedData.primaryType].filter((field: any) => field.type === "uint256").map((field: any) => field.name)
  );
  const message = Object.fromEntries(
    Object.entries(typedData.message).map(([name, value]) => [name, uints.has(name) ? BigInt(value as number) : value])
  );
  return { ...typedData, message };
};

async function createProgram(fundType: "ZAKAT" | "INFAK", tokens: Tokens, nameSuffix = ""): Promise<string> {
  const res = await post(
    "/programs",
    { name: `Program ${fundType} ${nameSuffix}`.trim(), purpose: "Bantuan Mustahik", fundType, scope: "Tahun 2026" },
    tokens.amil
  );
  expect(res.status).toBe(201);
  return (await res.json()).program.id;
}

type AidValue =
  | { kind: "MONEY"; amountRequestedIdr: string }
  | {
      kind: "GOODS";
      unit: string;
      quantityRequested: string;
      valuedAmountIdr: string | null;
      valuationBasis?: string | null;
    };

const money = (amount: string): AidValue => ({ kind: "MONEY", amountRequestedIdr: amount });
const goods = (
  unit: string,
  quantity: string,
  valuedAmountIdr: string | null = null,
  valuationBasis: string | null = "Harga pasar lokal"
): AidValue => ({
  kind: "GOODS",
  unit,
  quantityRequested: quantity,
  valuedAmountIdr,
  valuationBasis: valuedAmountIdr ? valuationBasis : null,
});

async function approvedProposal(
  programId: string,
  proposalId: string,
  values: AidValue[],
  tokens: Tokens,
  approvedAmounts?: string[]
) {
  const beneficiaryId = `ben-${proposalId}`;
  const created = await mutate(
    "/proposals",
    {
      expectedVersion: 0,
      id: proposalId,
      programId,
      originOfRequest: "Permohonan Resmi",
      purpose: `Penyaluran ${proposalId}`,
      personInCharge: "Ahmad Amil",
      aidPeriod: { start: "2026-03-01", end: "2026-03-31" },
      beneficiaries: [
        {
          id: beneficiaryId,
          name: "Penerima Manfaat",
          asnaf: "Fakir",
          identityBasis: { kind: "NIK", value: "3201123456789012" },
          addressOrScope: "Wilayah Sintetis",
          guardian: null,
          paymentRecipient: null,
        },
      ],
      aidLines: values.map((value, index) => ({
        id: `aid-${proposalId}-${index}`,
        beneficiaryId,
        aidType: value.kind === "MONEY" ? "Bantuan tunai" : "Bantuan pangan",
        period: "2026-03",
        value:
          value.kind === "MONEY"
            ? { ...value, amountApprovedIdr: null }
            : { ...value, quantityApproved: null },
      })),
    },
    tokens.preparer
  );
  expect(created.status).toBe(201);

  for (const category of ["PROPOSAL_LETTER", "BENEFICIARY_IDENTITY"]) {
    const doc = await post(
      `/proposals/${proposalId}/documents`,
      {
        category,
        fileName: `${category.toLowerCase()}.txt`,
        mimeType: "text/plain",
        beneficiaryId: category === "BENEFICIARY_IDENTITY" ? beneficiaryId : null,
        contentBase64: Buffer.from("Dokumen bukti sah").toString("base64"),
      },
      tokens.preparer
    );
    expect(doc.status).toBe(201);
  }

  expect((await mutate(`/proposals/${proposalId}/submit`, { expectedVersion: 1 }, tokens.preparer)).status).toBe(200);
  expect((await mutate(`/proposals/${proposalId}/start-examination`, { expectedVersion: 1 }, tokens.amil)).status).toBe(200);
  const ready = await mutate(
    `/proposals/${proposalId}/ready`,
    {
      expectedVersion: 1,
      checklist: { administrativeChecksOk: true, eligibilityChecksOk: true, alternativeIdReviewed: true, notes: "Lengkap." },
    },
    tokens.amil
  );
  expect(ready.status).toBe(200);

  const uploaded = await post(
    `/proposals/${proposalId}/decision-documents`,
    {
      expectedVersion: 1,
      fileName: `qa107-${proposalId}.txt`,
      mimeType: "text/plain",
      contentBase64: Buffer.from(`Keputusan sintetis QA #107 untuk ${proposalId}`).toString("base64"),
    },
    tokens.approver
  );
  expect(uploaded.status).toBe(201);

  const intent = {
    expectedVersion: 1,
    action: "APPROVE",
    decisionReference: `SK-${proposalId}`,
    decisionDate: "2026-03-20",
    decisionDocumentId: (await uploaded.json()).document.id,
    approvedAidLines: values.map((value, index) => ({
      id: `aid-${proposalId}-${index}`,
      ...(value.kind === "MONEY"
        ? { amountApprovedIdr: approvedAmounts?.[index] ?? value.amountRequestedIdr }
        : { quantityApproved: value.quantityRequested }),
    })),
  };

  const minted = await post(`/proposals/${proposalId}/decision-challenge`, intent, tokens.approver);
  expect(minted.status).toBe(201);
  const { challenge, typedData } = await minted.json();
  const signature = await approverSinar.signTypedData(signable(typedData));

  const decided = await mutate(
    `/proposals/${proposalId}/decide`,
    {
      ...intent,
      signerAccount: challenge.signerAccount,
      mandateId: challenge.mandateId,
      nonce: challenge.nonce,
      signature,
    },
    tokens.approver
  );
  expect(decided.status).toBe(200);
  const persisted = await get(`/proposals/${proposalId}`, tokens.amil);
  const data = await persisted.json();
  expect(data.draft.status).toBe("APPROVED");
  return data.draft;
}

async function createActivity(activityId: string, proposalId: string, tokens: Tokens, name?: string) {
  const res = await mutate("/activities", { id: activityId, proposalId, name: name ?? `Kegiatan ${proposalId}` }, tokens.amil);
  expect(res.status).toBe(201);
  return (await res.json()).activity;
}

async function endorsedContribution(
  id: string,
  amount: string,
  fundType: string,
  purpose: string,
  tokens: Tokens,
  donorName: string | null = null
): Promise<number> {
  const recorded = await mutate(
    "/contributions",
    {
      id,
      sourceChannel: "BANK_TRANSFER",
      sourceReference: `TRX-${id}`,
      currencyUnit: "IDR",
      amountExact: amount,
      fundType,
      purpose,
      receivedAt: NOW - 100,
      donorName,
    },
    tokens.amil
  );
  expect(recorded.status).toBe(201);
  const reconciled = await mutate(`/contributions/${id}/reconcile`, { expectedVersion: 1, proofRef: `Mutasi ${id}` }, tokens.amil);
  expect(reconciled.status).toBe(200);
  const endorsed = await mutate(`/contributions/${id}/endorse`, { expectedVersion: 2, notes: "Disahkan" }, tokens.approver);
  expect(endorsed.status).toBe(200);
  return (await endorsed.json()).contribution.version;
}

const allocate = (contributionId: string, body: Record<string, unknown>, token: string) =>
  mutate(`/contributions/${contributionId}/allocate`, { reason: "Alokasi awal", ...body }, token);

/** The stored per-mustahik attribution of an activity, in one state (ADR-0037). */
async function beneficiaryShares(activityId: string, status: "ACTIVE" | "REVERSED"): Promise<any[]> {
  const result: any = await database.handle().execute(sql`
    SELECT * FROM allocation_beneficiary_shares
    WHERE activity_id = ${activityId} AND status = ${status}
    ORDER BY created_at, fill_sequence
  `);
  return result.rows ?? result;
}

async function recordAdvance(proposalId: string, amountIdr: string, purpose: string, reference: string, token: string) {
  const res = await post(`/proposals/${proposalId}/advances`, { amountIdr, purpose, reference }, token);
  expect(res.status).toBe(201);
  return (await res.json()).advance;
}

async function recordExpense(
  proposalId: string,
  amountIdr: string,
  purpose: string,
  payee: string,
  advanceId: string | null,
  token: string
) {
  const res = await post(
    `/proposals/${proposalId}/expenses`,
    { amountIdr, purpose, payee, documentRef: `KWT-${crypto.randomUUID().slice(0, 8)}`, advanceId },
    token
  );
  expect(res.status).toBe(201);
  return (await res.json()).expense;
}

async function realizeAid(
  proposalId: string,
  version: number,
  items: unknown[],
  token: string
) {
  const res = await post(
    `/proposals/${proposalId}/realizations`,
    { operationId: crypto.randomUUID(), expectedVersion: version, items },
    token
  );
  expect(res.status).toBe(201);
  return (await res.json()).records;
}

async function closeProposalRemainder(proposalId: string, version: number, reason: string, tokens: Tokens) {
  const docRes = await post(
    `/proposals/${proposalId}/decision-documents`,
    {
      expectedVersion: version,
      fileName: `sk-tutup-${proposalId}.txt`,
      mimeType: "text/plain",
      contentBase64: Buffer.from(`SK Penutupan Sisa ${proposalId}`).toString("base64"),
    },
    tokens.approver
  );
  expect(docRes.status).toBe(201);
  const decisionDocumentId = (await docRes.json()).document.id;

  const chalRes = await post(
    `/proposals/${proposalId}/close-remainder-challenge`,
    {
      decisionReference: `SK-TUTUP-${proposalId}`,
      decisionDate: "2026-03-25",
      decisionDocumentId,
      reason,
      expectedVersion: version,
    },
    tokens.approver
  );
  expect(chalRes.status).toBe(201);
  const { challenge, typedData } = await chalRes.json();
  const signature = await approverSinar.signTypedData(signable(typedData));

  const decideRes = await post(
    `/proposals/${proposalId}/decide`,
    {
      action: "CLOSE_REMAINDER",
      decisionReference: `SK-TUTUP-${proposalId}`,
      decisionDate: "2026-03-25",
      decisionDocumentId,
      signerAccount: challenge.signerAccount,
      mandateId: challenge.mandateId,
      signature,
      nonce: challenge.nonce,
      reason,
      expectedVersion: version,
      operationId: crypto.randomUUID(),
    },
    tokens.approver
  );
  expect(decideRes.status).toBe(200);
  return (await decideRes.json()).draft;
}

async function cancelProposal(proposalId: string, version: number, reason: string, tokens: Tokens) {
  const docRes = await post(
    `/proposals/${proposalId}/decision-documents`,
    {
      expectedVersion: version,
      fileName: `sk-batal-${proposalId}.txt`,
      mimeType: "text/plain",
      contentBase64: Buffer.from(`SK Pembatalan ${proposalId}`).toString("base64"),
    },
    tokens.approver
  );
  expect(docRes.status).toBe(201);
  const decisionDocumentId = (await docRes.json()).document.id;

  const chalRes = await post(
    `/proposals/${proposalId}/cancel-challenge`,
    {
      decisionReference: `SK-BATAL-${proposalId}`,
      decisionDate: "2026-03-25",
      decisionDocumentId,
      reason,
      expectedVersion: version,
    },
    tokens.approver
  );
  expect(chalRes.status).toBe(201);
  const { challenge, typedData } = await chalRes.json();
  const signature = await approverSinar.signTypedData(signable(typedData));

  const decideRes = await post(
    `/proposals/${proposalId}/decide`,
    {
      action: "CANCEL",
      decisionReference: `SK-BATAL-${proposalId}`,
      decisionDate: "2026-03-25",
      decisionDocumentId,
      signerAccount: challenge.signerAccount,
      mandateId: challenge.mandateId,
      signature,
      nonce: challenge.nonce,
      reason,
      expectedVersion: version,
      operationId: crypto.randomUUID(),
    },
    tokens.approver
  );
  expect(decideRes.status).toBe(200);
  return (await decideRes.json()).draft;
}

describe("Allocation Reallocation & Activity Accountability (Issue #107, Spec #100)", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "activity-reallocation-files-"));
    files = createEncryptedFileStore({ directory: tempDir, key: FILE_KEY });
    database = await createTestWorkspaceDatabase();
    const handle = database.handle();
    await createWorkspaceStore(handle).ensureSchema();
    await createDisbursementStore(handle).ensureSchema();
    await createContributionStore(handle).ensureSchema();
    await createActivityStore(handle).ensureSchema();
    configure(handle);
  });

  afterAll(async () => {
    resetWorkspace();
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    clock = NOW;
    await database.reset();
    const db = database.handle();
    const sinar = institutionRecordOf(SYNTHETIC_INSTITUTIONS[0]);
    const baitul = institutionRecordOf(SYNTHETIC_INSTITUTIONS[1]);
    await db.execute(sql`
      INSERT INTO institutions (id, legal_name, scope_unit, scope_level, mandate_note, is_synthetic)
      VALUES (${sinar.id}, ${sinar.legalName}, ${sinar.scopeUnit}, ${sinar.scopeLevel}, ${sinar.mandateNote}, true),
             (${baitul.id}, ${baitul.legalName}, ${baitul.scopeUnit}, ${baitul.scopeLevel}, ${baitul.mandateNote}, true)
    `);
    await db.execute(sql`
      INSERT INTO officer_profiles (id, institution_id, display_name, is_active)
      VALUES ('off-sinar-admin', ${SINAR}, 'Admin Sinar', true),
             ('off-sinar-preparer', ${SINAR}, 'Penyusun Sinar', true),
             ('off-sinar-approver', ${SINAR}, 'Pejabat Pengesah', true),
             ('off-sinar-amil', ${SINAR}, 'Amil Sinar', true),
             ('off-baitul-admin', ${BAITUL}, 'Admin Baitul', true),
             ('off-baitul-amil', ${BAITUL}, 'Amil Baitul', true)
    `);
    await db.execute(sql`
      INSERT INTO institution_memberships (institution_id, account_address, role, officer_id, is_active)
      VALUES (${SINAR}, ${adminSinar.address.toLowerCase()}, 'ADMIN', 'off-sinar-admin', true),
             (${SINAR}, ${preparerSinar.address.toLowerCase()}, 'OFFICER', 'off-sinar-preparer', true),
             (${SINAR}, ${approverSinar.address.toLowerCase()}, 'OFFICER', 'off-sinar-approver', true),
             (${SINAR}, ${amilSinar.address.toLowerCase()}, 'OFFICER', 'off-sinar-amil', true),
             (${BAITUL}, ${adminBaitul.address.toLowerCase()}, 'ADMIN', 'off-baitul-admin', true),
             (${BAITUL}, ${amilBaitul.address.toLowerCase()}, 'OFFICER', 'off-baitul-amil', true)
    `);
    const mandate = (id: string, institution: string, officer: string, account: string, fn: string) => sql`(
      ${id}, ${institution}, ${officer}, ${account.toLowerCase()}, ${fn}, 'ALL_PROGRAMS', NULL,
      ${NOW - 1000}, ${NOW + 100000}, ${`SK-${id}`}, NULL, 1, true, ${NOW}, ${NOW}, 'system'
    )`;
    await db.execute(sql`
      INSERT INTO operational_mandates (
        id, institution_id, officer_id, account_address, function, scope_type, program_id,
        valid_from, valid_until, assignment_ref, nominal_limit, version, is_active, created_at, updated_at, created_by
      ) VALUES ${sql.join(
        [
          mandate("sinar-prep", SINAR, "off-sinar-preparer", preparerSinar.address, "PREPARE_PROPOSALS"),
          mandate("sinar-exam", SINAR, "off-sinar-amil", amilSinar.address, "EXAMINE_PROPOSALS"),
          mandate("sinar-real", SINAR, "off-sinar-amil", amilSinar.address, "RECORD_REALIZATION"),
          mandate("sinar-rec", SINAR, "off-sinar-amil", amilSinar.address, "RECORD_CONTRIBUTIONS"),
          mandate("sinar-prog", SINAR, "off-sinar-amil", amilSinar.address, "MANAGE_PROGRAMS"),
          mandate("sinar-endorse", SINAR, "off-sinar-approver", approverSinar.address, "ENDORSE_CONTRIBUTIONS"),
          mandate("sinar-decision", SINAR, "off-sinar-approver", approverSinar.address, "APPROVE_DECISIONS"),
          mandate("baitul-rec", BAITUL, "off-baitul-amil", amilBaitul.address, "RECORD_CONTRIBUTIONS"),
          mandate("baitul-prog", BAITUL, "off-baitul-amil", amilBaitul.address, "MANAGE_PROGRAMS"),
        ],
        sql`, `
      )}
    `);
  });

  it("calculates accountability and separates physical goods units from IDR without double counting (AC07)", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens, "Pendidikan & Sembako");
    const proposal = await approvedProposal(
      programId,
      "prop-ac07",
      [money("3000000"), goods("paket", "20", "2000000")],
      tokens
    );
    const activity = await createActivity("act-ac07", proposal.id, tokens);

    await endorsedContribution("c-ac07", "5000000", "ZAKAT", "Bantuan", tokens);
    const alloc = await allocate("c-ac07", { activityId: activity.id, amountExact: "5000000", expectedVersion: 3 }, tokens.amil);
    expect(alloc.status).toBe(200);

    // Record advance 1.000.000, account 800.000 -> sisa advance 200.000
    const adv = await recordAdvance(proposal.id, "1000000", "Uang muka sembako", "ADV-01", tokens.amil);
    await recordExpense(proposal.id, "800000", "Pembelian 20 paket beras", "Toko Sembako", adv.id, tokens.amil);

    // Direct operational expense without advance: 150.000
    await recordExpense(proposal.id, "150000", "Transport relawan", "Supir", null, tokens.amil);

    // Realize cash aid: 1.000.000
    await realizeAid(
      proposal.id,
      proposal.version,
      [
        {
          aidLineId: `aid-${proposal.id}-0`,
          beneficiaryId: `ben-${proposal.id}`,
          reportedAt: clock - 3600,
          method: "CASH",
          amountIdr: "1000000",
        },
      ],
      tokens.amil
    );

    // Realize goods aid: 10 paket handed over physically
    await realizeAid(
      proposal.id,
      proposal.version,
      [
        {
          aidLineId: `aid-${proposal.id}-1`,
          beneficiaryId: `ben-${proposal.id}`,
          reportedAt: clock - 3600,
          method: "GOODS_HANDOVER",
          quantity: "10",
          unit: "paket",
          notes: "Penyerahan tahap 1",
        },
      ],
      tokens.amil
    );

    const accRes = await get(`/activities/${activity.id}/accountability`, tokens.amil);
    expect(accRes.status).toBe(200);
    const { accountability } = await accRes.json();

    expect(accountability.activityId).toBe(activity.id);
    expect(accountability.totalAllocatedAmount).toBe("5000000");
    expect(accountability.totalRealizedMoneyIdr).toBe("1000000");
    // totalExpenses = 800.000 (accounted advance) + 150.000 (direct expense) = 950.000
    expect(accountability.totalExpensesIdr).toBe("950000");
    // totalAdvances = 1.000.000, accounted = 800.000, unaccounted = 200.000
    expect(accountability.totalAdvancesIdr).toBe("1000000");
    expect(accountability.totalAccountedExpensesIdr).toBe("800000");
    expect(accountability.unaccountedAdvancesIdr).toBe("200000");

    // Physical goods must remain strictly separate from IDR totals (AC07)
    expect(accountability.unitSummaries).toEqual([
      { aidType: "Bantuan pangan", unit: "paket", approved: "20", realized: "10", remaining: "10" },
    ]);

    // Because unaccountedAdvances is 200.000 > 0, status must be INDETERMINATE
    expect(accountability.availabilityStatus).toBe("INDETERMINATE");
    expect(accountability.availabilityReason).toContain("200000");
    expect(accountability.availableForReallocation).toBe("0");
  });

  it("unaccounted advances block reallocation with 400 (AC11)", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens, "Beasiswa");
    const proposalA = await approvedProposal(programId, "prop-adv-a", [money("2000000")], tokens);
    const proposalB = await approvedProposal(programId, "prop-adv-b", [money("2000000")], tokens);

    const activityA = await createActivity("act-adv-a", proposalA.id, tokens);
    const activityB = await createActivity("act-adv-b", proposalB.id, tokens);

    await endorsedContribution("c-adv", "2000000", "ZAKAT", "Bantuan", tokens);
    const allocRes = await allocate("c-adv", { activityId: activityA.id, amountExact: "2000000", expectedVersion: 3 }, tokens.amil);
    expect(allocRes.status).toBe(200);
    const allocId = (await allocRes.json()).allocation.id;

    // Issue advance 500.000 on proposalA
    await recordAdvance(proposalA.id, "500000", "Operasional", "ADV-A", tokens.amil);

    // Attempt reallocation: must be blocked because unaccounted advance makes availability indeterminate
    const reallocRes = await post(
      `/activities/${activityA.id}/reallocate`,
      {
        sourceAllocationId: allocId,
        targetActivityId: activityB.id,
        amountExact: "500000",
        reason: "Pengalihan ke kegiatan B",
        expectedVersion: 1,
        expectedTargetActivityVersion: 1,
      },
      tokens.amil
    );

    expect(reallocRes.status).toBe(400);
    const errorBody = await reallocRes.json();
    expect(errorBody.error).toContain("belum dapat dilakukan");
    expect(errorBody.error).toContain("uang muka");
  });

  it("unvalued goods on an unclosed proposal render availability INDETERMINATE (AC11)", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens, "Logistik Darurat");
    // Goods line without valuedAmountIdr
    const proposal = await approvedProposal(
      programId,
      "prop-unvalued",
      [goods("karung", "50", null)],
      tokens
    );
    const activity = await createActivity("act-unvalued", proposal.id, tokens);

    await endorsedContribution("c-unval", "3000000", "ZAKAT", "Bantuan", tokens);
    const alloc = await allocate("c-unval", { activityId: activity.id, amountExact: "3000000", expectedVersion: 3 }, tokens.amil);
    expect(alloc.status).toBe(200);

    const accRes = await get(`/activities/${activity.id}/accountability`, tokens.amil);
    expect(accRes.status).toBe(200);
    const { accountability } = await accRes.json();

    expect(accountability.availabilityStatus).toBe("INDETERMINATE");
    expect(accountability.availabilityReason).toContain("tanpa valuasi rupiah");
    expect(accountability.availableForReallocation).toBe("0");
  });

  it("holds allocation against valued goods still undelivered, and frees only the delivered share (AC02, AC07)", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens, "Paket Pangan");
    // 20 paket valued at 2.000.000 in total: 100.000 of commitment per paket.
    const proposalA = await approvedProposal(
      programId,
      "prop-phys-a",
      [goods("paket", "20", "2000000")],
      tokens
    );
    const proposalB = await approvedProposal(programId, "prop-phys-b", [money("1000000")], tokens);
    const activityA = await createActivity("act-phys-a", proposalA.id, tokens);
    const activityB = await createActivity("act-phys-b", proposalB.id, tokens);

    await endorsedContribution("c-phys", "2000000", "ZAKAT", "Bantuan", tokens);
    const allocRes = await allocate(
      "c-phys",
      { activityId: activityA.id, amountExact: "2000000", expectedVersion: 3 },
      tokens.amil
    );
    expect(allocRes.status).toBe(200);
    const allocId = (await allocRes.json()).allocation.id;

    // Nothing handed over yet: the whole valuation is still owed, so nothing is spare.
    const before = (await (await get(`/activities/${activityA.id}/accountability`, tokens.amil)).json()).accountability;
    expect(before.totalCommittedGoodsIdr).toBe("2000000");
    expect(before.availabilityStatus).toBe("NONE");
    expect(before.availableForReallocation).toBe("0");

    const blocked = await post(
      `/activities/${activityA.id}/reallocate`,
      {
        sourceAllocationId: allocId,
        targetActivityId: activityB.id,
        amountExact: "100000",
        reason: "Mencoba mengalihkan dana yang masih terikat paket belum diserahkan",
        expectedVersion: 1,
        expectedTargetActivityVersion: 1,
      },
      tokens.amil
    );
    expect(blocked.status).toBe(400);
    expect((await blocked.json()).error).toContain("Tidak ada sisa dana");

    // Hand over 15 of 20 paket. 5 remain, so 500.000 of the valuation stays committed
    // and the quantity stays in 'paket' - it is never added to a rupiah total.
    await realizeAid(
      proposalA.id,
      proposalA.version,
      [
        {
          aidLineId: `aid-${proposalA.id}-0`,
          beneficiaryId: `ben-${proposalA.id}`,
          reportedAt: clock - 3600,
          method: "GOODS_HANDOVER",
          quantity: "15",
          unit: "paket",
          notes: "Serah terima 15 paket",
        },
      ],
      tokens.amil
    );

    const after = (await (await get(`/activities/${activityA.id}/accountability`, tokens.amil)).json()).accountability;
    expect(after.totalCommittedGoodsIdr).toBe("500000");
    expect(after.unitSummaries).toEqual([
      { aidType: "Bantuan pangan", unit: "paket", approved: "20", realized: "15", remaining: "5" },
    ]);
    // 2.000.000 allocated less 500.000 still owed as goods = 1.500.000 genuinely spare.
    expect(after.availabilityStatus).toBe("AVAILABLE");
    expect(after.availableForReallocation).toBe("1500000");

    const overReach = await post(
      `/activities/${activityA.id}/reallocate`,
      {
        sourceAllocationId: allocId,
        targetActivityId: activityB.id,
        amountExact: "1500001",
        reason: "Mencoba melebihi sisa yang benar-benar bebas",
        expectedVersion: 1,
        expectedTargetActivityVersion: 1,
      },
      tokens.amil
    );
    expect(overReach.status).toBe(400);
  });

  it("charges the actual price, not the planned valuation, against available funds (AC07)", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens, "Harga Berbeda");
    const proposalA = await approvedProposal(
      programId,
      "prop-price-a",
      [goods("paket", "10", "1000000")],
      tokens
    );
    const proposalB = await approvedProposal(programId, "prop-price-b", [money("1000000")], tokens);
    const activityA = await createActivity("act-price-a", proposalA.id, tokens);
    const activityB = await createActivity("act-price-b", proposalB.id, tokens);

    await endorsedContribution("c-price", "2000000", "ZAKAT", "Bantuan", tokens);
    const allocRes = await allocate(
      "c-price",
      { activityId: activityA.id, amountExact: "2000000", expectedVersion: 3 },
      tokens.amil
    );
    expect(allocRes.status).toBe(200);
    const allocId = (await allocRes.json()).allocation.id;

    // All 10 paket delivered, so the plan's valuation is fully discharged...
    await realizeAid(
      proposalA.id,
      proposalA.version,
      [
        {
          aidLineId: `aid-${proposalA.id}-0`,
          beneficiaryId: `ben-${proposalA.id}`,
          reportedAt: clock - 3600,
          method: "GOODS_HANDOVER",
          quantity: "10",
          unit: "paket",
          notes: "Serah terima 10 paket",
        },
      ],
      tokens.amil
    );
    // ...but procurement actually cost 1.400.000, not the 1.000.000 planned.
    await recordExpense(proposalA.id, "1400000", "Pembelian paket pangan", "CV Pangan", null, tokens.amil);

    const accountability = (await (await get(`/activities/${activityA.id}/accountability`, tokens.amil)).json())
      .accountability;
    expect(accountability.totalCommittedGoodsIdr).toBe("0");
    expect(accountability.totalExpensesIdr).toBe("1400000");
    // The purchase and the handover are one flow of aid, counted once: 2.000.000 less the
    // 1.400.000 actually spent leaves 600.000, not the 1.000.000 the plan implied.
    expect(accountability.availabilityStatus).toBe("AVAILABLE");
    expect(accountability.availableForReallocation).toBe("600000");

    const overPlan = await post(
      `/activities/${activityA.id}/reallocate`,
      {
        sourceAllocationId: allocId,
        targetActivityId: activityB.id,
        amountExact: "1000000",
        reason: "Mengalihkan sisa menurut harga rencana",
        expectedVersion: 1,
        expectedTargetActivityVersion: 1,
      },
      tokens.amil
    );
    expect(overPlan.status).toBe(400);

    const ok = await post(
      `/activities/${activityA.id}/reallocate`,
      {
        sourceAllocationId: allocId,
        targetActivityId: activityB.id,
        amountExact: "600000",
        reason: "Mengalihkan sisa menurut harga aktual pembelian",
        expectedVersion: 1,
        expectedTargetActivityVersion: 1,
      },
      tokens.amil
    );
    expect(ok.status).toBe(200);
  });

  it("keeps a refunded contribution out of what may be reallocated (AC12, #106)", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens, "Refund");
    const proposalA = await approvedProposal(programId, "prop-ref-a", [money("2000000")], tokens);
    const proposalB = await approvedProposal(programId, "prop-ref-b", [money("2000000")], tokens);
    const activityA = await createActivity("act-ref-a", proposalA.id, tokens);
    const activityB = await createActivity("act-ref-b", proposalB.id, tokens);

    await endorsedContribution("c-ref", "2000000", "ZAKAT", "Bantuan", tokens);
    const allocRes = await allocate(
      "c-ref",
      { activityId: activityA.id, amountExact: "1000000", expectedVersion: 3 },
      tokens.amil
    );
    expect(allocRes.status).toBe(200);
    const allocId = (await allocRes.json()).allocation.id;

    await cancelProposal(proposalA.id, proposalA.version, "Tutup sisa", tokens);

    // A refund decided but not yet paid is still owed to the donor, so it may not travel
    // on to another activity. 2.000.000 less a 1.400.000 refund leaves 600.000 movable.
    const decided = await mutate(
      `/contributions/c-ref/refunds`,
      {
        expectedVersion: 3,
        amountExact: "1400000",
        reason: "Donatur meminta pengembalian sebagian dana",
        policyBasis: "SOP pengembalian dana lembaga pasal 4",
      },
      tokens.amil
    );
    expect(decided.status).toBe(201);
    const refundId = (await decided.json()).refund.id;

    const blocked = await post(
      `/activities/${activityA.id}/reallocate`,
      {
        sourceAllocationId: allocId,
        targetActivityId: activityB.id,
        amountExact: "1000000",
        reason: "Mencoba mengalihkan dana yang sudah diputuskan dikembalikan",
        expectedVersion: 1,
        expectedTargetActivityVersion: 1,
      },
      tokens.amil
    );
    expect(blocked.status).toBe(400);
    expect((await blocked.json()).error).toContain("pengembalian dana");

    // Paying the refund does not turn it into a reallocation: the money left the
    // institution, it did not move to another activity (AC12).
    const paid = await mutate(
      `/contributions/c-ref/refunds/${refundId}/pay`,
      { paymentProofRef: "TRF-REFUND-001", paidAt: clock - 60 },
      tokens.amil
    );
    expect(paid.status).toBe(200);

    const stillBlocked = await post(
      `/activities/${activityA.id}/reallocate`,
      {
        sourceAllocationId: allocId,
        targetActivityId: activityB.id,
        amountExact: "1000000",
        reason: "Mencoba mengalihkan dana yang sudah dikembalikan",
        expectedVersion: 1,
        expectedTargetActivityVersion: 1,
      },
      tokens.amil
    );
    expect(stillBlocked.status).toBe(400);

    const reallocations = (await (await get(`/activities/${activityA.id}/reallocations`, tokens.amil)).json())
      .reallocations;
    expect(reallocations).toEqual([]);
  });

  it("refuses a reallocation whose target activity moved since it was read (AC03)", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens, "Versi Tujuan");
    const proposalA = await approvedProposal(programId, "prop-tv-a", [money("1000000")], tokens);
    const proposalB = await approvedProposal(programId, "prop-tv-b", [money("1000000")], tokens);
    const proposalC = await approvedProposal(programId, "prop-tv-c", [money("1000000")], tokens);
    const activityA = await createActivity("act-tv-a", proposalA.id, tokens);
    const activityB = await createActivity("act-tv-b", proposalB.id, tokens);
    const activityC = await createActivity("act-tv-c", proposalC.id, tokens);

    await endorsedContribution("c-tv", "2000000", "ZAKAT", "Bantuan", tokens);
    const allocRes = await allocate(
      "c-tv",
      { activityId: activityA.id, amountExact: "2000000", expectedVersion: 3 },
      tokens.amil
    );
    expect(allocRes.status).toBe(200);
    const allocId = (await allocRes.json()).allocation.id;
    await cancelProposal(proposalA.id, proposalA.version, "Tutup sisa", tokens);

    // Move funds into C first, which bumps C's version from 1 to 2.
    const first = await post(
      `/activities/${activityA.id}/reallocate`,
      {
        sourceAllocationId: allocId,
        targetActivityId: activityC.id,
        amountExact: "500000",
        reason: "Pengalihan pertama ke kegiatan C",
        expectedVersion: 1,
        expectedTargetActivityVersion: 1,
      },
      tokens.amil
    );
    expect(first.status).toBe(200);

    // An officer still holding C at version 1 is refused rather than silently overwriting.
    const stale = await post(
      `/activities/${activityA.id}/reallocate`,
      {
        sourceAllocationId: allocId,
        targetActivityId: activityC.id,
        amountExact: "200000",
        reason: "Pengalihan dari layar yang sudah basi",
        expectedVersion: 2,
        expectedTargetActivityVersion: 1,
      },
      tokens.amil
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toContain("Kegiatan tujuan telah diperbarui");

    // Omitting the target version stays allowed: the source version alone still guards it.
    const withoutTargetVersion = await post(
      `/activities/${activityA.id}/reallocate`,
      {
        sourceAllocationId: allocId,
        targetActivityId: activityB.id,
        amountExact: "200000",
        reason: "Pengalihan tanpa menyebut versi tujuan",
        expectedVersion: 2,
      },
      tokens.amil
    );
    expect(withoutTargetVersion.status).toBe(200);
  });

  it("proposal remainder closure (#96) makes unspent allocation available without auto-reallocating (AC11)", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens, "Keluarga Berdaya");
    const proposal = await approvedProposal(programId, "prop-close-rem", [money("3000000")], tokens);
    const activity = await createActivity("act-close-rem", proposal.id, tokens);

    await endorsedContribution("c-rem", "3000000", "ZAKAT", "Bantuan", tokens);
    const alloc = await allocate("c-rem", { activityId: activity.id, amountExact: "3000000", expectedVersion: 3 }, tokens.amil);
    expect(alloc.status).toBe(200);

    // Realize 1.000.000 out of 3.000.000
    await realizeAid(
      proposal.id,
      proposal.version,
      [
        {
          aidLineId: `aid-${proposal.id}-0`,
          beneficiaryId: `ben-${proposal.id}`,
          reportedAt: clock - 3600,
          method: "CASH",
          amountIdr: "1000000",
        },
      ],
      tokens.amil
    );

    // Before closing remainder, committed approved obligations are 2.000.000, so free balance is 3.000.000 - (1.000.000 realized + 2.000.000 obligations) = 0
    let accRes = await get(`/activities/${activity.id}/accountability`, tokens.amil);
    let { accountability } = await accRes.json();
    expect(accountability.availabilityStatus).toBe("NONE");
    expect(accountability.availableForReallocation).toBe("0");

    // Close remaining 2.000.000 aid via Ticket #96 close-remainder protocol
    const closedProposal = await closeProposalRemainder(
      proposal.id,
      proposal.version,
      "Mustahik telah mandiri dan menolak sisa bantuan",
      tokens
    );
    expect(closedProposal.status).toBe("REMAINDER_CLOSED");

    // After remainder closure:
    // Remaining approved aid obligations are terminated.
    // Unspent allocated balance is 3.000.000 - 1.000.000 = 2.000.000.
    // Notice: closing the remainder does NOT automatically reallocate or refund.
    accRes = await get(`/activities/${activity.id}/accountability`, tokens.amil);
    accountability = (await accRes.json()).accountability;

    expect(accountability.availabilityStatus).toBe("AVAILABLE");
    expect(accountability.availableForReallocation).toBe("2000000");

    // Check that reallocations list is empty (no auto-reallocation happened)
    const reallocsRes = await get(`/activities/${activity.id}/reallocations`, tokens.amil);
    expect(reallocsRes.status).toBe(200);
    expect((await reallocsRes.json()).reallocations).toHaveLength(0);
  });

  it("reallocates allocation between activities, records decision, updates balances, and preserves donor traceability (US-37, US-40, US-43, AC08)", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens, "Program Terpadu");
    const proposalA = await approvedProposal(programId, "prop-tr-a", [money("2000000")], tokens);
    const proposalB = await approvedProposal(programId, "prop-tr-b", [money("3000000")], tokens);

    const activityA = await createActivity("act-tr-a", proposalA.id, tokens, "Kegiatan A");
    const activityB = await createActivity("act-tr-b", proposalB.id, tokens, "Kegiatan B");

    await endorsedContribution("c-tr", "2000000", "ZAKAT", "Bantuan Fakir", tokens, "Bapak Dermawan");
    const allocRes = await allocate("c-tr", { activityId: activityA.id, amountExact: "2000000", expectedVersion: 3 }, tokens.amil);
    expect(allocRes.status).toBe(200);
    const sourceAlloc = (await allocRes.json()).allocation;

    // Cancel proposal A with 0 realization so 2.000.000 is available
    await cancelProposal(proposalA.id, proposalA.version, "Kegiatan dialihkan karena relokasi", tokens);

    // Reallocate 800.000 from activityA to activityB
    const reallocRes = await post(
      `/activities/${activityA.id}/reallocate`,
      {
        sourceAllocationId: sourceAlloc.id,
        targetActivityId: activityB.id,
        amountExact: "800000",
        reason: "Pengalihan sisa dana untuk mencukupi kebutuhan Kegiatan B",
        expectedVersion: 1,
        expectedTargetActivityVersion: 1,
      },
      tokens.amil
    );

    expect(reallocRes.status).toBe(200);
    const reallocData = await reallocRes.json();
    const decision = reallocData.decision;

    expect(decision.sourceActivityId).toBe(activityA.id);
    expect(decision.targetActivityId).toBe(activityB.id);
    expect(decision.sourceAllocationId).toBe(sourceAlloc.id);
    expect(decision.contributionId).toBe("c-tr");
    expect(decision.amountExact).toBe("800000");
    expect(decision.reason).toBe("Pengalihan sisa dana untuk mencukupi kebutuhan Kegiatan B");
    expect(decision.decidedByOfficerId).toBe("off-sinar-amil");

    // Source allocation decreased from 2.000.000 to 1.200.000
    expect(reallocData.sourceAllocation.amountExact).toBe("1200000");
    expect(reallocData.sourceAllocation.status).toBe("ACTIVE");

    // Target allocation created with 800.000 and sourceAllocationId linked
    expect(reallocData.targetAllocation.activityId).toBe(activityB.id);
    expect(reallocData.targetAllocation.amountExact).toBe("800000");
    expect(reallocData.targetAllocation.sourceAllocationId).toBe(sourceAlloc.id);

    // Activity versions incremented
    expect(reallocData.sourceActivitySummary.version).toBe(2);
    expect(reallocData.targetActivitySummary.version).toBe(2);

    // Check accountability on both activities
    const accA = (await (await get(`/activities/${activityA.id}/accountability`, tokens.amil)).json()).accountability;
    expect(accA.totalAllocatedAmount).toBe("1200000");
    expect(accA.availableForReallocation).toBe("1200000");

    const accB = (await (await get(`/activities/${activityB.id}/accountability`, tokens.amil)).json()).accountability;
    expect(accB.totalAllocatedAmount).toBe("800000");

    // Reallocations list endpoint returns the decision
    const reallocsA = (await (await get(`/activities/${activityA.id}/reallocations`, tokens.amil)).json()).reallocations;
    expect(reallocsA).toHaveLength(1);
    expect(reallocsA[0].id).toBe(decision.id);

    const reallocsB = (await (await get(`/activities/${activityB.id}/reallocations`, tokens.amil)).json()).reallocations;
    expect(reallocsB).toHaveLength(1);
    expect(reallocsB[0].id).toBe(decision.id);

    // Check contribution allocations history
    const contrib = (await (await get("/contributions/c-tr", tokens.amil)).json()).contribution;
    // Remainder should still be 0 because all 2.000.000 is still allocated (1.200.000 in A + 800.000 in B)
    expect(contrib.unallocatedAmount).toBe("0");

    const history = (await (await get("/contributions/c-tr/allocations", tokens.amil)).json()).history;
    const actions = history.map((h: any) => h.action);
    expect(actions).toContain("ALLOCATE");
    expect(actions).toContain("REALLOCATE_OUT");
    expect(actions).toContain("REALLOCATE_IN");
  });

  it("marks source allocation REALLOCATED when the entire amount is transferred", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens, "Pemberdayaan");
    const proposalA = await approvedProposal(programId, "prop-full-a", [money("1000000")], tokens);
    const proposalB = await approvedProposal(programId, "prop-full-b", [money("2000000")], tokens);

    const activityA = await createActivity("act-full-a", proposalA.id, tokens);
    const activityB = await createActivity("act-full-b", proposalB.id, tokens);

    await endorsedContribution("c-full", "1000000", "ZAKAT", "Bantuan", tokens);
    const allocRes = await allocate("c-full", { activityId: activityA.id, amountExact: "1000000", expectedVersion: 3 }, tokens.amil);
    expect(allocRes.status).toBe(200);
    const sourceAlloc = (await allocRes.json()).allocation;

    await cancelProposal(proposalA.id, proposalA.version, "Ditutup seluruhnya", tokens);

    // Reallocate entire 1.000.000
    const reallocRes = await post(
      `/activities/${activityA.id}/reallocate`,
      {
        sourceAllocationId: sourceAlloc.id,
        targetActivityId: activityB.id,
        amountExact: "1000000",
        reason: "Pengalihan 100%",
        expectedVersion: 1,
        expectedTargetActivityVersion: 1,
      },
      tokens.amil
    );
    expect(reallocRes.status).toBe(200);
    const { sourceAllocation } = await reallocRes.json();
    expect(sourceAllocation.amountExact).toBe("0");
    expect(sourceAllocation.status).toBe("REALLOCATED");

    // Nothing of this contribution is attributed to the source activity's mustahik any
    // more, and what was shown before stays readable as REVERSED (ADR-0037).
    expect(await beneficiaryShares(activityA.id, "ACTIVE")).toHaveLength(0);
    expect(await beneficiaryShares(activityA.id, "REVERSED")).toHaveLength(1);
    expect((await beneficiaryShares(activityB.id, "ACTIVE")).map((row) => row.share_exact)).toEqual(["1000000"]);
  });

  it("re-attributes what stays behind after a partial reallocation (ADR-0037)", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens, "Pemberdayaan Bertahap");
    const proposalA = await approvedProposal(programId, "prop-share-a", [money("2000000")], tokens);
    const proposalB = await approvedProposal(programId, "prop-share-b", [money("3000000")], tokens);

    const activityA = await createActivity("act-share-a", proposalA.id, tokens);
    const activityB = await createActivity("act-share-b", proposalB.id, tokens);

    await endorsedContribution("c-share", "2000000", "ZAKAT", "Bantuan", tokens);
    const allocRes = await allocate("c-share", { activityId: activityA.id, amountExact: "2000000", expectedVersion: 3 }, tokens.amil);
    expect(allocRes.status).toBe(200);
    const sourceAlloc = (await allocRes.json()).allocation;
    expect((await beneficiaryShares(activityA.id, "ACTIVE")).map((row) => row.share_exact)).toEqual(["2000000"]);

    await cancelProposal(proposalA.id, proposalA.version, "Sebagian dialihkan", tokens);
    const reallocRes = await post(
      `/activities/${activityA.id}/reallocate`,
      {
        sourceAllocationId: sourceAlloc.id,
        targetActivityId: activityB.id,
        amountExact: "800000",
        reason: "Pengalihan sebagian untuk Kegiatan B",
        expectedVersion: 1,
        expectedTargetActivityVersion: 1,
      },
      tokens.amil
    );
    expect(reallocRes.status).toBe(200);

    // The result is what a 1.200.000 allocation would have produced, with the old
    // attribution kept as REVERSED rather than deleted.
    expect((await beneficiaryShares(activityA.id, "ACTIVE")).map((row) => row.share_exact)).toEqual(["1200000"]);
    expect((await beneficiaryShares(activityA.id, "REVERSED")).map((row) => row.share_exact)).toEqual(["2000000"]);
    expect((await beneficiaryShares(activityB.id, "ACTIVE")).map((row) => row.share_exact)).toEqual(["800000"]);
  });

  it("rejects reallocation when target activity program fund type is incompatible (US-37, AC09)", async () => {
    const tokens = await signInSinar();
    const zakatProgramId = await createProgram("ZAKAT", tokens, "Zakat Program");
    const infakProgramId = await createProgram("INFAK", tokens, "Infak Program");

    const proposalA = await approvedProposal(zakatProgramId, "prop-inc-a", [money("1000000")], tokens);
    const proposalB = await approvedProposal(infakProgramId, "prop-inc-b", [money("1000000")], tokens);

    const activityA = await createActivity("act-inc-a", proposalA.id, tokens);
    const activityB = await createActivity("act-inc-b", proposalB.id, tokens);

    await endorsedContribution("c-inc", "1000000", "ZAKAT", "Zakat Mal", tokens);
    const allocRes = await allocate("c-inc", { activityId: activityA.id, amountExact: "1000000", expectedVersion: 3 }, tokens.amil);
    expect(allocRes.status).toBe(200);
    const sourceAlloc = (await allocRes.json()).allocation;

    await cancelProposal(proposalA.id, proposalA.version, "Ditutup", tokens);

    // Attempt to reallocate Zakat contribution into Infak activity
    const reallocRes = await post(
      `/activities/${activityA.id}/reallocate`,
      {
        sourceAllocationId: sourceAlloc.id,
        targetActivityId: activityB.id,
        amountExact: "500000",
        reason: "Coba silang akad",
        expectedVersion: 1,
        expectedTargetActivityVersion: 1,
      },
      tokens.amil
    );

    expect(reallocRes.status).toBe(400);
    const err = await reallocRes.json();
    expect(err.error).toContain("tidak kompatibel");
  });

  it("blocks reallocation exceeding the available balance or source allocation balance", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens, "Pendidikan");
    const proposalA = await approvedProposal(programId, "prop-exc-a", [money("2000000")], tokens);
    const proposalB = await approvedProposal(programId, "prop-exc-b", [money("2000000")], tokens);

    const activityA = await createActivity("act-exc-a", proposalA.id, tokens);
    const activityB = await createActivity("act-exc-b", proposalB.id, tokens);

    await endorsedContribution("c-exc", "2000000", "ZAKAT", "Bantuan", tokens);
    const allocRes = await allocate("c-exc", { activityId: activityA.id, amountExact: "2000000", expectedVersion: 3 }, tokens.amil);
    expect(allocRes.status).toBe(200);
    const sourceAlloc = (await allocRes.json()).allocation;

    // Realize 1.500.000 out of 2.000.000
    await realizeAid(
      proposalA.id,
      proposalA.version,
      [
        {
          aidLineId: `aid-${proposalA.id}-0`,
          beneficiaryId: `ben-${proposalA.id}`,
          reportedAt: clock - 3600,
          method: "CASH",
          amountIdr: "1500000",
        },
      ],
      tokens.amil
    );

    await closeProposalRemainder(proposalA.id, proposalA.version, "Selesai sebagian", tokens);

    // Available is now 500.000, even though source allocation nominally has 2.000.000
    const reallocRes = await post(
      `/activities/${activityA.id}/reallocate`,
      {
        sourceAllocationId: sourceAlloc.id,
        targetActivityId: activityB.id,
        amountExact: "600000",
        reason: "Melebihi saldo tersedia",
        expectedVersion: 1,
        expectedTargetActivityVersion: 1,
      },
      tokens.amil
    );

    expect(reallocRes.status).toBe(400);
    const err = await reallocRes.json();
    expect(err.error).toContain("melebihi");
  });

  it("does not let a concurrent expense and a reallocation both spend the same remainder (AC04)", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens, "Konkurensi Lintas Domain");
    const proposalA = await approvedProposal(programId, "prop-xd-a", [money("1000000")], tokens);
    const proposalB = await approvedProposal(programId, "prop-xd-b", [money("1000000")], tokens);
    const activityA = await createActivity("act-xd-a", proposalA.id, tokens);
    const activityB = await createActivity("act-xd-b", proposalB.id, tokens);

    await endorsedContribution("c-xd", "1000000", "ZAKAT", "Bantuan", tokens);
    const allocRes = await allocate(
      "c-xd",
      { activityId: activityA.id, amountExact: "1000000", expectedVersion: 3 },
      tokens.amil
    );
    expect(allocRes.status).toBe(200);
    const sourceAlloc = (await allocRes.json()).allocation;

    await cancelProposal(proposalA.id, proposalA.version, "Tutup sisa", tokens);

    // 1.000.000 is free. An officer books an 800.000 expense while another reallocates
    // 800.000 at the same instant. Both read the same remainder unless they serialise on
    // the proposal, and together they would commit 1.600.000 against 1.000.000.
    const [expenseRes, reallocRes] = await Promise.all([
      post(
        `/proposals/${proposalA.id}/expenses`,
        {
          amountIdr: "800000",
          purpose: "Pembelian mendadak",
          payee: "CV Pangan",
          documentRef: "KWT-XD-01",
          advanceId: null,
        },
        tokens.amil
      ),
      post(
        `/activities/${activityA.id}/reallocate`,
        {
          sourceAllocationId: sourceAlloc.id,
          targetActivityId: activityB.id,
          amountExact: "800000",
          reason: "Pengalihan bersamaan dengan pencatatan biaya",
          expectedVersion: 1,
          expectedTargetActivityVersion: 1,
        },
        tokens.amil
      ),
    ]);

    // An expense is a record of something that really happened, so it is never refused.
    expect(expenseRes.status).toBe(201);
    const moved =
      reallocRes.status === 200
        ? BigInt((await (await get(`/activities/${activityB.id}`, tokens.amil)).json()).activity.totalAllocatedAmount)
        : 0n;
    const accountability = (await (await get(`/activities/${activityA.id}/accountability`, tokens.amil)).json())
      .accountability;
    const spent = BigInt(accountability.totalExpensesIdr);
    expect(spent).toBe(800000n);

    // The two orderings give two honest outcomes, and never a silent double spend:
    if (reallocRes.status !== 200) {
      // The expense landed first, so the reallocation read the real remainder and was
      // refused. Nothing is over-committed.
      expect(moved).toBe(0n);
      expect(accountability.totalOverCommitmentIdr).toBe("0");
      expect(accountability.availableForReallocation).toBe("200000");
    } else {
      // The reallocation landed first against a genuinely free remainder, and the expense
      // then overran what was left. The overrun stays visible and is not read as a tidy
      // zero, and nothing further may leave until the institution settles it.
      expect(moved).toBe(800000n);
      expect(accountability.totalOverCommitmentIdr).toBe("600000");
      expect(accountability.availabilityStatus).toBe("INDETERMINATE");
      expect(accountability.availableForReallocation).toBe("0");
      expect(accountability.availabilityReason).toContain("melampaui dana teralokasi");
    }

    // Either way the source activity never reports a remainder it does not have.
    expect(BigInt(accountability.availableForReallocation)).toBeLessThanOrEqual(
      1000000n - moved - spent > 0n ? 1000000n - moved - spent : 0n
    );
  });

  it("prevents double-reallocation under concurrent requests via row-locking", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens, "Konkurensi");
    const proposalA = await approvedProposal(programId, "prop-conc-a", [money("1000000")], tokens);
    const proposalB = await approvedProposal(programId, "prop-conc-b", [money("1000000")], tokens);

    const activityA = await createActivity("act-conc-a", proposalA.id, tokens);
    const activityB = await createActivity("act-conc-b", proposalB.id, tokens);

    await endorsedContribution("c-conc", "1000000", "ZAKAT", "Bantuan", tokens);
    const allocRes = await allocate("c-conc", { activityId: activityA.id, amountExact: "1000000", expectedVersion: 3 }, tokens.amil);
    expect(allocRes.status).toBe(200);
    const sourceAlloc = (await allocRes.json()).allocation;

    await cancelProposal(proposalA.id, proposalA.version, "Tutup sisa", tokens);

    // Two parallel requests attempting to reallocate 600.000 from 1.000.000 total available
    const [res1, res2] = await Promise.all([
      post(
        `/activities/${activityA.id}/reallocate`,
        {
          sourceAllocationId: sourceAlloc.id,
          targetActivityId: activityB.id,
          amountExact: "600000",
          reason: "Request 1",
          expectedVersion: 1,
          expectedTargetActivityVersion: 1,
        },
        tokens.amil
      ),
      post(
        `/activities/${activityA.id}/reallocate`,
        {
          sourceAllocationId: sourceAlloc.id,
          targetActivityId: activityB.id,
          amountExact: "600000",
          reason: "Request 2",
          expectedVersion: 1,
          expectedTargetActivityVersion: 1,
        },
        tokens.amil
      ),
    ]);

    const statuses = [res1.status, res2.status].sort();
    // One must succeed (200) and one must be rejected (400 or 409 due to version or insufficient balance)
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);

    // Verify final allocation total on target is exactly 600.000, not 1.200.000
    const targetActivity = (await (await get(`/activities/${activityB.id}`, tokens.amil)).json()).activity;
    expect(targetActivity.totalAllocatedAmount).toBe("600000");
  });

  it("shortfall from contribution correction reduces available balance (ADR-0033 Q28, Issue #106)", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens, "Shortfall Test");
    const proposalA = await approvedProposal(programId, "prop-sh-a", [money("2000000")], tokens);
    const proposalB = await approvedProposal(programId, "prop-sh-b", [money("2000000")], tokens);

    const activityA = await createActivity("act-sh-a", proposalA.id, tokens);
    const activityB = await createActivity("act-sh-b", proposalB.id, tokens);

    await endorsedContribution("c-sh", "2000000", "ZAKAT", "Bantuan", tokens);
    const allocRes = await allocate("c-sh", { activityId: activityA.id, amountExact: "2000000", expectedVersion: 3 }, tokens.amil);
    expect(allocRes.status).toBe(200);
    const sourceAlloc = (await allocRes.json()).allocation;

    await cancelProposal(proposalA.id, proposalA.version, "Tutup sisa", tokens);

    // The correction runs through #106's own endpoint, not a direct write: the shortfall
    // must arise from the recorded workflow to prove the workflow produces it.
    const corrected = await mutate(
      `/contributions/c-sh/correct`,
      {
        expectedVersion: 3,
        correctionType: "AMOUNT",
        amountExact: "1500000",
        reason: "Nota transfer donatur ternyata 1.500.000, bukan 2.000.000",
        sourceProofRef: "SLIP-KOREKSI-SH",
      },
      tokens.approver
    );
    expect(corrected.status).toBe(200);
    expect((await corrected.json()).contribution.amountExact).toBe("1500000");

    // 2.000.000 allocated against a contribution now recording 1.500.000 leaves a 500.000
    // gap. Until it is settled, availability is not determinable and no rupiah may leave:
    // reallocating any of it would spend the same shortfall a second time (AC04, AC10).
    const accRes = await get(`/activities/${activityA.id}/accountability`, tokens.amil);
    expect(accRes.status).toBe(200);
    const accountability = (await accRes.json()).accountability;
    expect(accountability.totalContributionShortfall).toBe("500000");
    expect(accountability.availabilityStatus).toBe("INDETERMINATE");
    expect(accountability.availableForReallocation).toBe("0");
    expect(accountability.availabilityReason).toContain("selisih");

    const blocked = await post(
      `/activities/${activityA.id}/reallocate`,
      {
        sourceAllocationId: sourceAlloc.id,
        targetActivityId: activityB.id,
        amountExact: "1500000",
        reason: "Mencoba mengalihkan sisa yang masih berselisih",
        expectedVersion: 1,
        expectedTargetActivityVersion: 1,
      },
      tokens.amil
    );
    expect(blocked.status).toBe(400);
    expect((await blocked.json()).error).toContain("selisih");

    // The correction did not silently rewrite the allocation: it still stands at its
    // recorded amount, and the gap stays visible rather than being written down to zero.
    const detail = await (await get(`/activities/${activityA.id}`, tokens.amil)).json();
    expect(detail.activity.allocations[0].amountExact).toBe("2000000");
    expect(detail.activity.allocations[0].status).toBe("ACTIVE");
  });

  it("replays idempotent operation and rejects reused operationId with different payload", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens, "Idempotency");
    const proposalA = await approvedProposal(programId, "prop-idm-a", [money("1000000")], tokens);
    const proposalB = await approvedProposal(programId, "prop-idm-b", [money("1000000")], tokens);

    const activityA = await createActivity("act-idm-a", proposalA.id, tokens);
    const activityB = await createActivity("act-idm-b", proposalB.id, tokens);

    await endorsedContribution("c-idm", "1000000", "ZAKAT", "Bantuan", tokens);
    const allocRes = await allocate("c-idm", { activityId: activityA.id, amountExact: "1000000", expectedVersion: 3 }, tokens.amil);
    expect(allocRes.status).toBe(200);
    const sourceAlloc = (await allocRes.json()).allocation;

    await cancelProposal(proposalA.id, proposalA.version, "Tutup", tokens);

    const opId = crypto.randomUUID();
    const payload = {
      operationId: opId,
      sourceAllocationId: sourceAlloc.id,
      targetActivityId: activityB.id,
      amountExact: "400000",
      reason: "Reallokasi idempotent",
      expectedVersion: 1,
      expectedTargetActivityVersion: 1,
    };

    const first = await post(`/activities/${activityA.id}/reallocate`, payload, tokens.amil);
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    // Replaying identical payload returns identical response
    const second = await post(`/activities/${activityA.id}/reallocate`, payload, tokens.amil);
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.decision.id).toBe(firstBody.decision.id);

    // Reusing operationId with different payload returns 409 Conflict
    const conflicting = await post(
      `/activities/${activityA.id}/reallocate`,
      { ...payload, amountExact: "500000" },
      tokens.amil
    );
    expect(conflicting.status).toBe(409);
  });

  it("enforces isolation between ruang kerja lembaga (AC29)", async () => {
    const sinarTokens = await signInSinar();
    const baitulAmilToken = await signIn(amilBaitul, BAITUL);

    const programId = await createProgram("ZAKAT", sinarTokens, "Tenant Test");
    const proposal = await approvedProposal(programId, "prop-iso", [money("1000000")], sinarTokens);
    const activity = await createActivity("act-iso", proposal.id, sinarTokens);

    await endorsedContribution("c-iso", "1000000", "ZAKAT", "Bantuan", sinarTokens);
    const allocRes = await allocate("c-iso", { activityId: activity.id, amountExact: "1000000", expectedVersion: 3 }, sinarTokens.amil);
    expect(allocRes.status).toBe(200);
    const sourceAlloc = (await allocRes.json()).allocation;

    // Baitul officer attempts to read accountability of Sinar's activity
    const readRes = await get(`/activities/${activity.id}/accountability`, baitulAmilToken);
    expect(readRes.status).toBe(404);

    // Baitul officer attempts to read reallocations of Sinar's activity
    const reallocsRes = await get(`/activities/${activity.id}/reallocations`, baitulAmilToken);
    expect(reallocsRes.status).toBe(404);

    // Baitul officer attempts to reallocate Sinar's activity
    const reallocRes = await post(
      `/activities/${activity.id}/reallocate`,
      {
        sourceAllocationId: sourceAlloc.id,
        targetActivityId: "act-baitul-dummy",
        amountExact: "500000",
        reason: "Serangan cross-tenant",
        expectedVersion: 1,
        expectedTargetActivityVersion: 1,
      },
      baitulAmilToken
    );
    expect(reallocRes.status).toBe(404);
  });

  it("persists reallocations, accountability and decisions across database restart", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens, "Persistence");
    const proposalA = await approvedProposal(programId, "prop-rst-a", [money("2000000")], tokens);
    const proposalB = await approvedProposal(programId, "prop-rst-b", [money("2000000")], tokens);

    const activityA = await createActivity("act-rst-a", proposalA.id, tokens);
    const activityB = await createActivity("act-rst-b", proposalB.id, tokens);

    await endorsedContribution("c-rst", "2000000", "ZAKAT", "Bantuan", tokens);
    const allocRes = await allocate("c-rst", { activityId: activityA.id, amountExact: "2000000", expectedVersion: 3 }, tokens.amil);
    expect(allocRes.status).toBe(200);
    const sourceAlloc = (await allocRes.json()).allocation;

    await cancelProposal(proposalA.id, proposalA.version, "Tutup", tokens);

    const reallocRes = await post(
      `/activities/${activityA.id}/reallocate`,
      {
        sourceAllocationId: sourceAlloc.id,
        targetActivityId: activityB.id,
        amountExact: "750000",
        reason: "Reallokasi sebelum restart database",
        expectedVersion: 1,
        expectedTargetActivityVersion: 1,
      },
      tokens.amil
    );
    expect(reallocRes.status).toBe(200);

    // Reopen database
    await database.reopen();
    configure(database.handle());

    // Re-sign tokens after restart
    const newTokens = await signInSinar();

    const accRes = await get(`/activities/${activityA.id}/accountability`, newTokens.amil);
    expect(accRes.status).toBe(200);
    const { accountability } = await accRes.json();
    expect(accountability.totalAllocatedAmount).toBe("1250000");
    expect(accountability.availableForReallocation).toBe("1250000");

    const reallocs = (await (await get(`/activities/${activityA.id}/reallocations`, newTokens.amil)).json()).reallocations;
    expect(reallocs).toHaveLength(1);
    expect(reallocs[0].amountExact).toBe("750000");
    expect(reallocs[0].reason).toBe("Reallokasi sebelum restart database");
  });

  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)(
    "browser: reads availability, reallocates through the screen, and refuses a stale source version (AC05, AC06)",
    async () => {
      const tokens = await signInSinar();
      const programId = await createProgram("ZAKAT", tokens, "Smoke Pengalihan");
      const proposalA = await approvedProposal(programId, "prop-smoke-a", [money("2000000")], tokens);
      const proposalB = await approvedProposal(programId, "prop-smoke-b", [money("2000000")], tokens);
      const activityA = await createActivity("act-smoke-a", proposalA.id, tokens, "Kegiatan Sumber Smoke");
      const activityB = await createActivity("act-smoke-b", proposalB.id, tokens, "Kegiatan Tujuan Smoke");

      await endorsedContribution("c-smoke", "2000000", "ZAKAT", "Bantuan", tokens, "Donatur Smoke");
      const allocRes = await allocate(
        "c-smoke",
        { activityId: activityA.id, amountExact: "2000000", expectedVersion: 3 },
        tokens.amil
      );
      expect(allocRes.status).toBe(200);

      // Realize 500.000, then close the remainder so the rest is genuinely spare.
      await realizeAid(
        proposalA.id,
        proposalA.version,
        [
          {
            aidLineId: `aid-${proposalA.id}-0`,
            beneficiaryId: `ben-${proposalA.id}`,
            reportedAt: clock - 3600,
            method: "CASH",
            amountIdr: "500000",
          },
        ],
        tokens.amil
      );
      await closeProposalRemainder(proposalA.id, proposalA.version, "Sisa ditutup untuk smoke", tokens);

      const build = Bun.spawn(
        [
          "bun",
          "build",
          new URL("../../frontend/test/activity-reallocation-smoke.tsx", import.meta.url).pathname,
          "--target",
          "browser",
        ],
        { stdout: "pipe", stderr: "pipe" }
      );
      const bundle = await new Response(build.stdout).text();
      if ((await build.exited) !== 0) throw new Error(await new Response(build.stderr).text());
      const cssBuild = Bun.spawn(
        ["bun", new URL("../../frontend/test/build-smoke-css.ts", import.meta.url).pathname],
        { stdout: "pipe", stderr: "pipe" }
      );
      const css = await new Response(cssBuild.stdout).text();
      if ((await cssBuild.exited) !== 0) throw new Error(await new Response(cssBuild.stderr).text());

      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(req) {
          const path = new URL(req.url).pathname;
          if (path === "/")
            return new Response(
              '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/smoke.css"><div id="root"></div><script type="module" src="/smoke.js"></script>',
              { headers: { "Content-Type": "text/html" } }
            );
          if (path === "/smoke.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
          if (path === "/smoke.js")
            return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
          if (path === "/bootstrap")
            return Response.json({
              sourceActivityId: activityA.id,
              targetActivityId: activityB.id,
              account: amilSinar.address,
              institutionId: SINAR,
              now: clock,
            });
          if (path === "/sign")
            return Response.json({ signature: await amilSinar.signTypedData(signable(await req.json())) });
          return app.fetch(req);
        },
      });

      const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
      const browser = await chromium.launch({
        executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE,
        headless: true,
        args: ["--no-sandbox"],
      });
      try {
        // Phone width: the officer decides this on a handset in the field.
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        page.setDefaultTimeout(10000);
        page.on("pageerror", (error: Error) => console.error(error));

        await page.goto(server.url.toString());
        await page.getByRole("button", { name: "Buka kegiatan sumber" }).click();
        const detail = page.getByRole("dialog", { name: "Detail kegiatan penyaluran" });
        await detail.waitFor();

        // AC05: the screen shows what is allocated, still needed, committed and left over,
        // and the availability status is its own reading - not a distribution status.
        await detail.getByText("Dana Tersedia Untuk Dialihkan", { exact: true }).waitFor();
        await detail.getByText("Hak Bantuan Belum Diserahkan", { exact: true }).waitFor();
        await detail.getByText("Selisih Kontribusi", { exact: true }).waitFor();
        await detail.getByText("Sisa Bantuan Ditutup (SK Sah)", { exact: true }).waitFor();

        // The dialog fits a 390px viewport without a sideways scroll.
        const box = await detail.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(390);
        expect(
          await detail.evaluate((node: HTMLElement) => node.scrollWidth <= node.clientWidth)
        ).toBe(true);

        await detail.getByRole("button", { name: "Alihkan Dana" }).click();
        const form = page.getByRole("dialog", { name: "Pengalihan alokasi kegiatan" });
        await form.waitFor();

        // Reason is required: the decision must stay readable afterwards (AC03).
        await form.getByLabel("Nominal Pengalihan (IDR)").fill("600000");
        await form.getByRole("button", { name: "Sahkan Pengalihan" }).click();
        await form.getByText(/Alasan pengalihan wajib diisi/).waitFor();

        // Over the available remainder is refused before anything is sent.
        await form.getByLabel("Alasan Pengalihan (Keputusan Lembaga)").fill(
          "Sisa kegiatan sumber dialihkan ke kegiatan tujuan smoke"
        );
        await form.getByLabel("Nominal Pengalihan (IDR)").fill("1600000");
        await form.getByRole("button", { name: "Sahkan Pengalihan" }).click();
        await form.getByText(/melebihi sisa dana yang dapat dialihkan/).waitFor();

        await form.getByLabel("Nominal Pengalihan (IDR)").fill("600000");
        await form.getByRole("button", { name: "Sahkan Pengalihan" }).click();
        await form.waitFor({ state: "detached" });

        // The decision landed and the reopened detail reflects it, from the server.
        await detail.getByText("Riwayat Keputusan Pengalihan Alokasi", { exact: true }).waitFor();
        await detail.getByText(`Keluar ke ${activityB.id}`, { exact: true }).waitFor();

        const decisions = await activities.listReallocationsForActivity(SINAR, activityA.id);
        expect(decisions).toHaveLength(1);
        expect(decisions[0].amountExact).toBe("600000");
        expect(decisions[0].targetActivityId).toBe(activityB.id);
        expect(decisions[0].reason).toBe("Sisa kegiatan sumber dialihkan ke kegiatan tujuan smoke");
        expect(decisions[0].decidedByOfficerId).toBe("off-sinar-amil");

        // The target activity shows the same move as an incoming one, so one decision
        // reads the same from both ends.
        await detail.getByRole("button", { name: "Tutup", exact: true }).last().click();
        await page.getByRole("button", { name: "Buka kegiatan tujuan" }).click();
        await detail.getByText(`Masuk dari ${activityA.id}`, { exact: true }).waitFor();
        await detail.getByRole("button", { name: "Tutup", exact: true }).last().click();

        // A second officer moves funds behind this screen, so its source version goes
        // stale. The next submit from here is refused rather than spending it twice.
        await page.getByRole("button", { name: "Buka kegiatan sumber" }).click();
        await detail.getByRole("button", { name: "Alihkan Dana" }).click();
        await form.waitFor();

        const behindTheBack = await post(
          `/activities/${activityA.id}/reallocate`,
          {
            sourceAllocationId: (await activities.getActivity(SINAR, activityA.id, false))!.allocations.find(
              (a) => a.status === "ACTIVE"
            )!.id,
            targetActivityId: activityB.id,
            amountExact: "100000",
            reason: "Pengalihan petugas lain di layar terpisah",
            expectedVersion: 2,
          },
          tokens.amil
        );
        expect(behindTheBack.status).toBe(200);

        await form.getByLabel("Alasan Pengalihan (Keputusan Lembaga)").fill("Pengalihan dari layar yang sudah basi");
        await form.getByLabel("Nominal Pengalihan (IDR)").fill("100000");
        await form.getByRole("button", { name: "Sahkan Pengalihan" }).click();
        await form.getByText(/telah diperbarui sejak versi yang Anda muat/).waitFor();

        // Exactly the two intended decisions exist: the stale one never committed.
        expect(await activities.listReallocationsForActivity(SINAR, activityA.id)).toHaveLength(2);
      } finally {
        await browser.close();
        server.stop(true);
      }
    },
    120000
  );
});

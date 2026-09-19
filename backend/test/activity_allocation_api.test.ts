/**
 * Distribution Activities and Contribution Allocations over authenticated HTTP with a
 * real (PGlite) PostgreSQL (Spec #100, Ticket #103).
 *
 * Covers US-01, US-03 (activity follows one approved proposal version), US-35..US-38
 * (explicit, pooled and partial allocation; limit; fund type/purpose; tracing coverage),
 * US-91, AC09, AC15, AC29.
 *
 * Proposal approval follows #93's document/challenge/signature/decision protocol.
 * No SQL status override stands in for the durable decision.
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
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { createEncryptedFileStore, type PrivateFileStore } from "../src/evidence-files";

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
const ethCall: EthCall = async () => "0x";

function configure(handle: ReturnType<TestWorkspaceDatabase["handle"]>) {
  configureWorkspace({
    store: createWorkspaceStore(handle),
    disbursement: createDisbursementStore(handle),
    contributions: createContributionStore(handle),
    activities: createActivityStore(handle),
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
    body: JSON.stringify(body),
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

async function createProgram(fundType: "ZAKAT" | "INFAK", tokens: Tokens): Promise<string> {
  const res = await post("/programs", { name: `Program ${fundType}`, purpose: "Bantuan", fundType, scope: "Tahun 2026" }, tokens.amil);
  expect(res.status).toBe(201);
  return (await res.json()).program.id;
}

type AidValue =
  | { kind: "MONEY"; amountRequestedIdr: string }
  | { kind: "GOODS"; unit: string; quantityRequested: string; valuedAmountIdr: string | null };

/** Submit, examine and approve over authenticated HTTP with a separate signer. */
async function approvedProposal(programId: string, proposalId: string, values: AidValue[], tokens: Tokens, approvedAmounts?: string[]) {
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
        aidType: value.kind === "MONEY" ? "Bantuan tunai" : "Sembako",
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

  const uploaded = await post(`/proposals/${proposalId}/decision-documents`, {
    expectedVersion: 1, fileName: "qa103-decision.txt", mimeType: "text/plain",
    contentBase64: Buffer.from("Keputusan sintetis QA #103").toString("base64"),
  }, tokens.approver);
  expect(uploaded.status).toBe(201);
  const intent = {
    expectedVersion: 1, action: "APPROVE", decisionReference: `SK-${proposalId}`,
    decisionDate: "2027-01-15", decisionDocumentId: (await uploaded.json()).document.id,
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
  const uints = new Set(typedData.types[typedData.primaryType]
    .filter((field: { type: string }) => field.type === "uint256")
    .map((field: { name: string }) => field.name));
  const signature = await approverSinar.signTypedData({ ...typedData, message: Object.fromEntries(
    Object.entries(typedData.message).map(([name, value]) => [name, uints.has(name) ? BigInt(value as string) : value])
  ) });
  const decided = await mutate(`/proposals/${proposalId}/decide`, {
    ...intent, signerAccount: challenge.signerAccount, mandateId: challenge.mandateId,
    nonce: challenge.nonce, signature,
  }, tokens.approver);
  expect(decided.status).toBe(200);
  const persisted = await get(`/proposals/${proposalId}`, tokens.amil);
  expect((await persisted.json()).draft.status).toBe("APPROVED");
}

async function createActivity(activityId: string, proposalId: string, tokens: Tokens) {
  const res = await mutate("/activities", { id: activityId, proposalId, name: `Kegiatan ${proposalId}` }, tokens.amil);
  expect(res.status).toBe(201);
  return (await res.json()).activity;
}

const money = (amount: string): AidValue => ({ kind: "MONEY", amountRequestedIdr: amount });

/** Record, reconcile and endorse a contribution; returns its version (3). */
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
      id, sourceChannel: "BANK_TRANSFER", sourceReference: `TRX-${id}`, currencyUnit: "IDR",
      amountExact: amount, fundType, purpose, receivedAt: NOW - 100, donorName,
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
  mutate(`/contributions/${contributionId}/allocate`, { reason: "Alokasi tahap I", ...body }, token);

describe("Distribution Activities & Contribution Allocations (Ticket #103)", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "activity-test-files-"));
    files = createEncryptedFileStore({ directory: tempDir, key: FILE_KEY });
    database = await createTestWorkspaceDatabase(process.env.ACTIVITY_TEST_DATABASE_URL);
    const handle = database.handle();
    await createWorkspaceStore(handle).ensureSchema();
    await createDisbursementStore(handle).ensureSchema();
    await createContributionStore(handle).ensureSchema();
    await createActivityStore(handle).ensureSchema();
    configure(handle);
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
          mandate("sinar-rec", SINAR, "off-sinar-amil", amilSinar.address, "RECORD_CONTRIBUTIONS"),
          mandate("sinar-prog", SINAR, "off-sinar-amil", amilSinar.address, "MANAGE_PROGRAMS"),
          mandate("sinar-endorse", SINAR, "off-sinar-approver", approverSinar.address, "ENDORSE_CONTRIBUTIONS"),
          mandate("sinar-decision", SINAR, "off-sinar-approver", approverSinar.address, "APPROVE_DECISIONS"),
          mandate("baitul-rec", BAITUL, "off-baitul-amil", amilBaitul.address, "RECORD_CONTRIBUTIONS"),
        ],
        sql`, `
      )}
    `);
  });

  afterAll(async () => {
    resetWorkspace();
    await database.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates one activity per approved proposal version, refusing unapproved and duplicate ones (US-01, US-03)", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens);
    await approvedProposal(programId, "prop-dhuafa", [money("5000000")], tokens);

    // A proposal still in review cannot become an activity.
    await mutate("/proposals", {
      expectedVersion: 0, id: "prop-draft", programId, originOfRequest: "x", purpose: "x", personInCharge: "x",
      aidPeriod: null, beneficiaries: [], aidLines: [],
    }, tokens.preparer);
    const early = await mutate("/activities", { proposalId: "prop-draft" }, tokens.amil);
    expect(early.status).toBe(400);
    expect((await early.json()).error).toContain("wajib disahkan (APPROVED)");

    // An exact retry replays the first result instead of creating twice.
    const body = { id: "act-dhuafa", proposalId: "prop-dhuafa", name: "Beasiswa Dhuafa", operationId: "op-act-1" };
    const first = await post("/activities", body, tokens.amil);
    expect(first.status).toBe(201);
    const retry = await post("/activities", body, tokens.amil);
    expect(retry.status).toBe(201);
    const activity = (await first.json()).activity;
    expect((await retry.json()).activity.id).toBe(activity.id);
    expect(activity).toMatchObject({
      proposalId: "prop-dhuafa", proposalVersion: 1, programFundType: "ZAKAT",
      targetAmount: "5000000", targetIsPartial: false, status: "ACTIVE",
    });

    const duplicate = await mutate("/activities", { proposalId: "prop-dhuafa" }, tokens.amil);
    expect(duplicate.status).toBe(409);

    // A member without a disbursement mandate cannot create one.
    const approverAttempt = await mutate("/activities", { proposalId: "prop-dhuafa" }, tokens.approver);
    expect(approverAttempt.status).toBe(403);

    const list = await (await get("/activities", tokens.amil)).json();
    expect(list.activities).toHaveLength(1);
  });

  it("uses signed approved rights rather than the larger requested amount as the activity target", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens);
    await approvedProposal(programId, "prop-reduced", [money("1000000")], tokens, ["600000"]);
    const activity = await createActivity("act-reduced", "prop-reduced", tokens);
    expect(activity).toMatchObject({ proposalVersion: 1, targetAmount: "600000", targetIsPartial: false });
    const decision = await get("/proposals/prop-reduced/decision", tokens.amil);
    expect(decision.status).toBe(200);
    expect((await decision.json()).decision).toBeTruthy();
  });

  it("lets only one of two concurrent officers create the activity for a proposal version", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens);
    await approvedProposal(programId, "prop-race", [money("1000000")], tokens);

    const results = await Promise.all([
      mutate("/activities", { proposalId: "prop-race" }, tokens.amil),
      mutate("/activities", { proposalId: "prop-race" }, tokens.preparer),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await (await get("/activities", tokens.amil)).json()).activities).toHaveLength(1);
  });

  it("marks a target with unvalued goods as partial and never fully allocated", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens);
    await approvedProposal(
      programId,
      "prop-sembako",
      [{ kind: "GOODS", unit: "paket", quantityRequested: "10", valuedAmountIdr: null }],
      tokens
    );
    const activity = await createActivity("act-sembako", "prop-sembako", tokens);
    expect(activity.targetAmount).toBe("0");
    expect(activity.targetIsPartial).toBe(true);

    const detail = (await (await get("/activities/act-sembako", tokens.amil)).json()).activity;
    expect(detail.isFullyAllocated).toBe(false);
  });

  it("allocates one contribution to two activities with its remainder visible and history readable (US-35, US-36)", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens);
    await approvedProposal(programId, "prop-a", [money("3000000")], tokens);
    await approvedProposal(programId, "prop-b", [money("2000000")], tokens);
    await createActivity("act-a", "prop-a", tokens);
    await createActivity("act-b", "prop-b", tokens);
    const version = await endorsedContribution("c-split", "500000", "ZAKAT", "Zakat Mal", tokens, "Donatur A");

    const first = await allocate("c-split", { activityId: "act-a", amountExact: "200000", expectedVersion: version, reason: "Tahap I sembako" }, tokens.amil);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.contributionSummary).toMatchObject({ allocatedAmount: "200000", unallocatedAmount: "300000", shortfallAmount: "0" });
    expect(firstBody.activitySummary).toMatchObject({ totalAllocatedAmount: "200000", unallocatedNeed: "2800000" });

    // Allocating does not change the contribution's version, so the same version still applies.
    const second = await allocate("c-split", { activityId: "act-b", amountExact: "150000", expectedVersion: version, reason: "Tahap I pengobatan" }, tokens.amil);
    expect(second.status).toBe(200);

    const detail = (await (await get("/contributions/c-split", tokens.amil)).json()).contribution;
    expect(detail).toMatchObject({ version, allocatedAmount: "350000", unallocatedAmount: "150000", shortfallAmount: "0" });

    const listed = (await (await get("/contributions", tokens.amil)).json()).contributions;
    expect(listed.find((c: { id: string }) => c.id === "c-split")).toMatchObject({ unallocatedAmount: "150000" });

    const trail = await (await get("/contributions/c-split/allocations", tokens.amil)).json();
    expect(trail.allocations.map((a: { activityName: string; amountExact: string }) => [a.activityName, a.amountExact]).sort()).toEqual([
      ["Kegiatan prop-a", "200000"],
      ["Kegiatan prop-b", "150000"],
    ]);
    expect(trail.history).toHaveLength(2);
    expect(trail.history[0]).toMatchObject({
      action: "ALLOCATE", actorAccount: amilSinar.address.toLowerCase(), actorOfficerId: "off-sinar-amil",
      reason: "Tahap I sembako", version: 1, contributionVersion: version, amountExact: "200000",
    });
  });

  it("pools several donors in one activity, stating coverage and hiding donor detail from non-mandate readers (US-35, US-38, AC15)", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("INFAK", tokens);
    await approvedProposal(programId, "prop-santunan", [money("1000000")], tokens);
    await createActivity("act-santunan", "prop-santunan", tokens);

    const donors: Array<[string, string, string, string | null]> = [
      ["c-d1", "300000", "300000", "Donatur A"],
      ["c-d2", "500000", "400000", "Donatur B"],
      ["c-d3", "400000", "200000", null],
    ];
    for (const [id, amount, allocated, donor] of donors) {
      const version = await endorsedContribution(id, amount, "INFAK_SEDEKAH", "Santunan", tokens, donor);
      const res = await allocate(id, { activityId: "act-santunan", amountExact: allocated, expectedVersion: version }, tokens.amil);
      expect(res.status).toBe(200);
    }

    const act = (await (await get("/activities/act-santunan", tokens.amil)).json()).activity;
    expect(act).toMatchObject({ targetAmount: "1000000", totalAllocatedAmount: "900000", unallocatedNeed: "100000", contributionCount: 3, isFullyAllocated: false });
    expect(act.disclaimer).toContain("bukan saldo bank terverifikasi");
    expect(act.disclaimer).not.toContain("crowdfunding");
    expect(act.tracingCoverage).toContain("tidak ditampilkan sebagai kontribusi donatur");
    expect(act.history).toHaveLength(3);
    const unnamed = act.allocations.find((a: { contributionId: string }) => a.contributionId === "c-d3");
    expect(unnamed.source).toMatchObject({ donorName: null });

    // The preparer holds no contribution mandate: funding totals yes, donor detail no.
    const forPreparer = (await (await get("/activities/act-santunan", tokens.preparer)).json()).activity;
    expect(forPreparer.totalAllocatedAmount).toBe("900000");
    expect(forPreparer.allocations.every((a: { source: unknown }) => a.source === null)).toBe(true);
  });

  it("keeps fund type and purpose, including against the activity's program (US-37, AC09)", async () => {
    const tokens = await signInSinar();
    const zakatProgram = await createProgram("ZAKAT", tokens);
    const infakProgram = await createProgram("INFAK", tokens);
    await approvedProposal(zakatProgram, "prop-zakat", [money("5000000")], tokens);
    await approvedProposal(infakProgram, "prop-infak", [money("5000000")], tokens);
    await createActivity("act-zakat", "prop-zakat", tokens);
    await createActivity("act-infak", "prop-infak", tokens);
    const version = await endorsedContribution("c-zakat", "1000000", "ZAKAT", "Gempa Cianjur", tokens);

    const restated = await allocate("c-zakat", { activityId: "act-zakat", amountExact: "100000", fundType: "FITRAH", expectedVersion: version }, tokens.amil);
    expect(restated.status).toBe(400);
    expect((await restated.json()).error).toContain("tidak selaras dengan jenis dana kontribusi");

    const repurposed = await allocate("c-zakat", { activityId: "act-zakat", amountExact: "100000", purpose: "Operasional Kantor", expectedVersion: version }, tokens.amil);
    expect(repurposed.status).toBe(400);
    expect((await repurposed.json()).error).toContain("tidak selaras dengan batasan peruntukan kontribusi");

    const wrongProgram = await allocate("c-zakat", { activityId: "act-infak", amountExact: "100000", expectedVersion: version }, tokens.amil);
    expect(wrongProgram.status).toBe(400);
    expect((await wrongProgram.json()).error).toContain("tidak dapat mendanai kegiatan dari program berjenis dana");

    const kept = await allocate("c-zakat", { activityId: "act-zakat", amountExact: "100000", fundType: "ZAKAT", purpose: "Gempa Cianjur", expectedVersion: version }, tokens.amil);
    expect(kept.status).toBe(200);
    expect((await kept.json()).allocation).toMatchObject({ fundType: "ZAKAT", purpose: "Gempa Cianjur" });
  });

  it("refuses to allocate a contribution the institution has not endorsed", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens);
    await approvedProposal(programId, "prop-x", [money("1000000")], tokens);
    await createActivity("act-x", "prop-x", tokens);
    await mutate("/contributions", {
      id: "c-received", sourceChannel: "CASH", sourceReference: "CSH-1", currencyUnit: "IDR",
      amountExact: "300000", fundType: "ZAKAT", purpose: "Zakat", receivedAt: NOW - 10,
    }, tokens.amil);

    const res = await allocate("c-received", { activityId: "act-x", amountExact: "100000", expectedVersion: 1 }, tokens.amil);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("belum disahkan lembaga");
  });

  it("blocks over-allocation, including under concurrent requests, and refuses a stale version (US-36, AC09)", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens);
    await approvedProposal(programId, "prop-pangan", [money("10000000")], tokens);
    await createActivity("act-pangan", "prop-pangan", tokens);
    const version = await endorsedContribution("c-limit", "300000", "ZAKAT", "Zakat", tokens);

    // Two officers each try to take 200.000 of 300.000 at once: exactly one wins.
    const racing = await Promise.all([
      allocate("c-limit", { activityId: "act-pangan", amountExact: "200000", expectedVersion: version }, tokens.amil),
      allocate("c-limit", { activityId: "act-pangan", amountExact: "200000", expectedVersion: version }, tokens.amil),
    ]);
    expect(racing.map((r) => r.status).sort()).toEqual([200, 400]);

    const over = await allocate("c-limit", { activityId: "act-pangan", amountExact: "150000", expectedVersion: version }, tokens.amil);
    expect(over.status).toBe(400);
    expect((await over.json()).error).toContain("melebihi sisa kontribusi yang tersedia (100000)");

    const stale = await allocate("c-limit", { activityId: "act-pangan", amountExact: "50000", expectedVersion: version - 1 }, tokens.amil);
    expect(stale.status).toBe(409);

    const summary = (await (await get("/contributions/c-limit", tokens.amil)).json()).contribution;
    expect(summary).toMatchObject({ allocatedAmount: "200000", unallocatedAmount: "100000" });
  });

  it("keeps a shortfall visible after a contribution is corrected below its allocations (ADR-0033 Q28)", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens);
    await approvedProposal(programId, "prop-koreksi", [money("1000000")], tokens);
    await createActivity("act-koreksi", "prop-koreksi", tokens);
    const version = await endorsedContribution("c-koreksi", "500000", "ZAKAT", "Zakat", tokens);
    expect((await allocate("c-koreksi", { activityId: "act-koreksi", amountExact: "450000", expectedVersion: version }, tokens.amil)).status).toBe(200);

    // No correction route exists yet; this is the state an authorized correction leaves behind.
    await database.handle().execute(sql`UPDATE contributions SET amount_exact = '400000', version = version + 1 WHERE id = 'c-koreksi'`);

    const detail = (await (await get("/contributions/c-koreksi", tokens.amil)).json()).contribution;
    expect(detail).toMatchObject({ allocatedAmount: "450000", unallocatedAmount: "0", shortfallAmount: "50000" });

    const worsen = await allocate("c-koreksi", { activityId: "act-koreksi", amountExact: "1", expectedVersion: version + 1 }, tokens.amil);
    expect(worsen.status).toBe(400);
  });

  it("replays an identical retry and refuses a reused operationId with a different payload", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("INFAK", tokens);
    await approvedProposal(programId, "prop-idem", [money("2000000")], tokens);
    await createActivity("act-idem", "prop-idem", tokens);
    const version = await endorsedContribution("c-idem", "500000", "INFAK_SEDEKAH", "Umum", tokens);

    const body = { activityId: "act-idem", amountExact: "200000", expectedVersion: version, reason: "Tahap I", operationId: "op-retry" };
    const first = await post("/contributions/c-idem/allocate", body, tokens.amil);
    const retry = await post("/contributions/c-idem/allocate", body, tokens.amil);
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect((await retry.json()).allocation.id).toBe((await first.json()).allocation.id);

    const changed = await post("/contributions/c-idem/allocate", { ...body, amountExact: "250000" }, tokens.amil);
    expect(changed.status).toBe(409);

    const trail = await (await get("/contributions/c-idem/allocations", tokens.amil)).json();
    expect(trail.allocations).toHaveLength(1);
    expect(trail.history).toHaveLength(1);
  });

  it("isolates institutions (AC29)", async () => {
    const tokens = await signInSinar();
    const baitul = await signIn(amilBaitul, BAITUL);
    const programId = await createProgram("ZAKAT", tokens);
    await approvedProposal(programId, "prop-sinar", [money("1000000")], tokens);
    await createActivity("act-sinar", "prop-sinar", tokens);
    await endorsedContribution("c-sinar", "1000000", "ZAKAT", "Zakat", tokens);

    expect((await get("/activities/act-sinar", baitul)).status).toBe(404);
    expect((await (await get("/activities", baitul)).json()).activities).toHaveLength(0);
    expect((await (await get("/contributions/c-sinar/allocations", baitul)).json()).allocations).toHaveLength(0);
    const cross = await allocate("c-sinar", { activityId: "act-sinar", amountExact: "100000", expectedVersion: 3 }, baitul);
    expect(cross.status).toBe(404);
  });

  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("browser smoke: creates an activity, allocates partially, rejects excess and reads the remainder after reload", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens);
    await approvedProposal(programId, "prop-browser", [money("1000000")], tokens);
    await endorsedContribution("c-browser", "700000", "ZAKAT", "Bantuan", tokens, "Donatur Sintetis");
    const built = await Bun.build({
      entrypoints: [new URL("../../frontend/test/officer-smoke.tsx", import.meta.url).pathname],
      target: "browser",
      define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "" }) },
    });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const bundle = await built.outputs[0]!.text();
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/") return new Response('<!doctype html><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
        if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
        if (path === "/wallet-rpc") {
          const { method, params } = await req.json();
          if (["eth_accounts", "eth_requestAccounts"].includes(method)) return Response.json([amilSinar.address]);
          if (method === "eth_chainId") return Response.json("0x7a69");
          if (method === "eth_signTypedData_v4") return Response.json(await amilSinar.signTypedData(JSON.parse(params[1])));
          return Response.json(null);
        }
        return app.fetch(req);
      },
    });
    let browser: any;
    try {
      const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
      browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
      const page = await browser.newPage();
      await page.addInitScript((now: number) => { Date.now = () => now * 1000; }, NOW);
      page.setDefaultTimeout(10000);
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => { errors.push(error.message); console.error("Activity browser:", error.message); });
      page.on("response", async (response: any) => {
        if (response.status() >= 400 && response.url().includes("/api/workspace")) console.error("Activity browser HTTP:", response.url(), response.status(), await response.text());
      });
      await page.goto(server.url.toString());
      await page.getByRole("button", { name: /^0x/ }).waitFor();
      await page.getByLabel("Pengelola Zakat", { exact: true }).selectOption(SINAR);
      await page.waitForFunction((institution: string) => (document.querySelector("#institution") as HTMLSelectElement)?.value === institution, SINAR);
      await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();
      await page.getByRole("heading", { name: "LPZ Sinar Amanah (sintetis)" }).waitFor();
      await page.getByRole("button", { name: "Buat Kegiatan", exact: true }).click();
      const create = page.getByRole("dialog", { name: "Buat kegiatan penyaluran", exact: true });
      await create.getByLabel(/ID pengajuan yang disahkan/).fill("prop-browser");
      await create.getByLabel("Nama kegiatan (opsional)", { exact: true }).fill("Kegiatan Smoke 103");
      await create.getByRole("button", { name: "Buat Kegiatan", exact: true }).click();
      await create.waitFor({ state: "detached" });
      const activityRow = page.getByRole("row").filter({ hasText: "Kegiatan Smoke 103" });
      await activityRow.waitFor();
      const contributionRow = page.getByRole("row").filter({ hasText: "TRX-c-browser" });
      await contributionRow.getByRole("button", { name: "Alokasikan", exact: true }).click();
      const allocation = page.getByRole("dialog", { name: "Alokasikan kontribusi", exact: true });
      const activities = (await (await get("/activities", tokens.amil)).json()).activities;
      await allocation.getByLabel(/Kegiatan penyaluran/).selectOption(activities[0].id);
      await allocation.getByLabel(/Nominal \(unit minor\)/).fill("700001");
      await allocation.getByLabel(/Alasan alokasi/).fill("Smoke tahap pertama");
      await allocation.getByRole("button", { name: "Konfirmasi Alokasi", exact: true }).click();
      await allocation.getByText(/Nominal melebihi sisa kontribusi/).waitFor();
      await allocation.getByLabel(/Nominal \(unit minor\)/).fill("300000");
      await allocation.getByRole("button", { name: "Konfirmasi Alokasi", exact: true }).click();
      await allocation.waitFor({ state: "detached" });
      await contributionRow.getByText(/Teralokasi:.*300\.000/).waitFor();
      await contributionRow.getByText(/Sisa:.*400\.000/).waitFor();
      // Both panels must reflect the same allocation without a manual reload.
      await activityRow.getByText(/300\.000/, { exact: false }).waitFor({ timeout: 2000 });
      await page.reload();
      await contributionRow.getByText(/Sisa:.*400\.000/).waitFor();
      await activityRow.getByText(/300\.000/, { exact: false }).waitFor();
      await activityRow.getByRole("button", { name: "Detail Alokasi", exact: true }).click();
      await page.getByRole("dialog").getByText("Smoke tahap pertama", { exact: true }).waitFor();
      const record = (await (await get("/contributions/c-browser", tokens.amil)).json()).contribution;
      expect(record).toMatchObject({ allocatedAmount: "300000", unallocatedAmount: "400000" });
      expect(errors).toEqual([]);
      await page.screenshot({ path: "/tmp/issue103-browser.png", fullPage: true });
    } finally {
      await browser?.close();
      await server.stop(true);
    }
  }, 60000);

  it("keeps activities, allocations, balances and operation replay across a database restart", async () => {
    const tokens = await signInSinar();
    const programId = await createProgram("ZAKAT", tokens);
    await approvedProposal(programId, "prop-durable", [money("4000000")], tokens);
    await createActivity("act-durable", "prop-durable", tokens);
    const version = await endorsedContribution("c-durable", "700000", "ZAKAT", "Zakat", tokens);
    const body = { activityId: "act-durable", amountExact: "300000", expectedVersion: version, reason: "Tahap I", operationId: "op-durable" };
    const before = await (await post("/contributions/c-durable/allocate", body, tokens.amil)).json();

    configure(await database.reopen());
    const amil = await signIn(amilSinar, SINAR);

    const act = (await (await get("/activities/act-durable", amil)).json()).activity;
    expect(act).toMatchObject({ totalAllocatedAmount: "300000", unallocatedNeed: "3700000" });
    expect(act.history).toHaveLength(1);
    const contribution = (await (await get("/contributions/c-durable", amil)).json()).contribution;
    expect(contribution).toMatchObject({ allocatedAmount: "300000", unallocatedAmount: "400000" });

    const replay = await post("/contributions/c-durable/allocate", body, amil);
    expect(replay.status).toBe(200);
    expect((await replay.json()).allocation.id).toBe(before.allocation.id);
  });
});

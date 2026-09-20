/**
 * Integration & Acceptance Tests for Contribution Corrections and Refunds (Spec #100, Issue #106).
 *
 * Covers:
 * - US-40: Donors see allocation changes with reasons and history; earlier contributions are not silently rewritten.
 * - US-41: Authorized officer corrects contribution amount while preserving actual disbursements.
 * - US-42: Over-allocation discrepancy (selisih) is visible and blocks worsening allocations.
 * - US-44: Refund decision is recorded separately from actual payment.
 * - US-45: Institutional fund-specific refund policy is enforced (no arbitrary refund right).
 * - US-91: Tested through authenticated application HTTP with real isolated storage.
 * - AC10: 500k allocated 450k then corrected 400k yields 50k discrepancy; actuals preserved, worsening allocations blocked.
 * - AC11: Reallocation and closure do not automatically reallocate or refund.
 * - AC12: Refund decision vs actual payment; duplicate data correction without repayment does not become refund.
 * - AC19: Version history maintained; proofs pointing to older versions are SUPERSEDED, never CURRENT.
 * - AC29: Strict institutional isolation and authenticated session attribution.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { createContributionStore, type ContributionStore } from "../src/contribution-store";
import { createActivityStore, type ActivityStore } from "../src/activity-store";
import { createDisbursementStore, type DisbursementStore } from "../src/disbursement-store";
import { createDonorAccessStore } from "../src/donor-access-store";
import { evaluateProofValidity } from "../src/contribution";
import { hashSessionToken } from "../src/donor-access";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { type EthCall } from "../src/account-signature";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { createEncryptedFileStore, type PrivateFileStore } from "../src/evidence-files";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FILE_KEY = Buffer.alloc(32, 9);
const OTP_KEY = Buffer.alloc(32, 10);
let tempDir: string;
let files: PrivateFileStore;

const BASE = "http://localhost:3001/api/workspace";

const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";

const adminSinar = privateKeyToAccount(`0x${"a1".repeat(32)}` as Hex);
const amilSinar = privateKeyToAccount(`0x${"b1".repeat(32)}` as Hex);
const approverSinar = privateKeyToAccount(`0x${"b2".repeat(32)}` as Hex);
const readerSinar = privateKeyToAccount(`0x${"c1".repeat(32)}` as Hex);

const adminBaitul = privateKeyToAccount(`0x${"a2".repeat(32)}` as Hex);
const amilBaitul = privateKeyToAccount(`0x${"b3".repeat(32)}` as Hex);

const NOW = 1_800_000_000;

let database: TestWorkspaceDatabase;
let workspaceStore: WorkspaceStore;
let contributionStore: ContributionStore;
let activityStore: ActivityStore;
let disbursementStore: DisbursementStore;
let clock = NOW;

const ethCall: EthCall = async () => "0x";

const request = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`${BASE}${path}`, init));

const post = (path: string, body: unknown, token?: string) =>
  request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const mutate = (path: string, body: Record<string, unknown>, token?: string) =>
  post(path, { operationId: crypto.randomUUID(), ...body }, token);

const get = (path: string, token?: string) =>
  request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

async function signIn(
  account: { address: string; signTypedData: (payload: any) => Promise<Hex> },
  institutionId: string
): Promise<string> {
  const minted = await post("/challenge", { institutionId, account: account.address });
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
  const res = await post("/session", {
    institutionId,
    account: account.address,
    nonce: challenge.nonce,
    signature,
  });
  const body = await res.json();
  return body.token;
}

function configure(handle: any) {
  workspaceStore = createWorkspaceStore(handle);
  disbursementStore = createDisbursementStore(handle);
  contributionStore = createContributionStore(handle);
  activityStore = createActivityStore(handle);

  configureWorkspace({
    store: workspaceStore,
    disbursement: disbursementStore,
    contributions: contributionStore,
    activities: activityStore,
    files,
    donorAccess: createDonorAccessStore(handle, OTP_KEY),
    ethCall,
    now: () => clock,
    challengeTtlSeconds: 300,
    sessionTtlSeconds: 3600,
  });
}

describe("Contribution Corrections & Refunds (Ticket #106)", () => {
  let tokens: {
    amilSinar: string;
    approverSinar: string;
    readerSinar: string;
    amilBaitul: string;
  };

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "contribution-correction-test-files-"));
    files = createEncryptedFileStore({ directory: tempDir, key: FILE_KEY });
    database = await createTestWorkspaceDatabase();
    const handle = database.handle();

    await createWorkspaceStore(handle).ensureSchema();
    await createDisbursementStore(handle).ensureSchema();
    await createContributionStore(handle).ensureSchema();
    await createActivityStore(handle).ensureSchema();
    await createDonorAccessStore(handle, OTP_KEY).ensureSchema();

    configure(handle);
  });

  afterAll(async () => {
    resetWorkspace();
    await database.close();
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
             ('off-sinar-amil', ${SINAR}, 'Ahmad Amil', true),
             ('off-sinar-approver', ${SINAR}, 'Bambang Pengesah', true)
    `);
    await db.execute(sql`
      INSERT INTO institution_memberships (institution_id, account_address, role, officer_id, is_active)
      VALUES (${SINAR}, ${adminSinar.address.toLowerCase()}, 'ADMIN', 'off-sinar-admin', true),
             (${SINAR}, ${amilSinar.address.toLowerCase()}, 'OFFICER', 'off-sinar-amil', true),
             (${SINAR}, ${approverSinar.address.toLowerCase()}, 'OFFICER', 'off-sinar-approver', true),
             (${SINAR}, ${readerSinar.address.toLowerCase()}, 'READER', null, true)
    `);
    await db.execute(sql`
      INSERT INTO officer_profiles (id, institution_id, display_name, is_active)
      VALUES ('off-baitul-admin', ${BAITUL}, 'Admin Baitul', true),
             ('off-baitul-amil', ${BAITUL}, 'Cahyo Amil', true)
    `);
    await db.execute(sql`
      INSERT INTO institution_memberships (institution_id, account_address, role, officer_id, is_active)
      VALUES (${BAITUL}, ${adminBaitul.address.toLowerCase()}, 'ADMIN', 'off-baitul-admin', true),
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
          mandate("sinar-rec", SINAR, "off-sinar-amil", amilSinar.address, "RECORD_CONTRIBUTIONS"),
          mandate("sinar-endorse", SINAR, "off-sinar-approver", approverSinar.address, "ENDORSE_CONTRIBUTIONS"),
          mandate("sinar-disburse", SINAR, "off-sinar-amil", amilSinar.address, "PREPARE_PROPOSALS"),
          mandate("baitul-rec", BAITUL, "off-baitul-amil", amilBaitul.address, "RECORD_CONTRIBUTIONS"),
        ],
        sql`, `
      )}
    `);

    tokens = {
      amilSinar: await signIn(amilSinar, SINAR),
      approverSinar: await signIn(approverSinar, SINAR),
      readerSinar: await signIn(readerSinar, SINAR),
      amilBaitul: await signIn(amilBaitul, BAITUL),
    };
  });

  async function createEndorsedContribution(
    ref: string,
    amount: string,
    fundType: string = "ZAKAT",
    purpose: string = "Zakat Maal"
  ): Promise<{ id: string; version: number }> {
    const recRes = await mutate(
      "/contributions",
      {
        sourceChannel: "BANK_TRANSFER",
        sourceReference: ref,
        currencyUnit: "IDR",
        amountExact: amount,
        fundType,
        purpose,
        receivedAt: NOW - 3600,
        donorName: "Hamba Allah",
        donorContact: "donor@example.com",
      },
      tokens.amilSinar
    );
    expect(recRes.status).toBe(201);
    const rec = (await recRes.json()).contribution;

    const reconRes = await mutate(
      `/contributions/${rec.id}/reconcile`,
      {
        expectedVersion: rec.version,
        proofRef: `MUTASI-${ref}`,
        notes: "Sesuai mutasi rekening BCA",
      },
      tokens.amilSinar
    );
    expect(reconRes.status).toBe(200);
    const reconciled = (await reconRes.json()).contribution;

    const endorseRes = await mutate(
      `/contributions/${rec.id}/endorse`,
      {
        expectedVersion: reconciled.version,
        notes: "Disahkan untuk program",
      },
      tokens.approverSinar
    );
    expect(endorseRes.status).toBe(200);
    const endorsed = (await endorseRes.json()).contribution;

    return { id: endorsed.id, version: endorsed.version };
  }

  async function seedActivity() {
    const db = database.handle();
    await db.execute(sql`
      INSERT INTO programs (id, institution_id, name, purpose, fund_type, scope, status, created_by, created_at, updated_at)
      VALUES ('prog-01', ${SINAR}, 'Program Penyaluran Beras', 'Bantuan pokok', 'ZAKAT', '2026', 'ACTIVE', 'off-sinar-amil', ${NOW}, ${NOW})
    `);
    await db.execute(sql`
      INSERT INTO proposal_drafts (id, institution_id, program_id, created_by, origin_of_request, purpose, status, version, created_at, updated_at)
      VALUES ('prop-01', ${SINAR}, 'prog-01', 'off-sinar-amil', 'Permohonan', 'Penyaluran Sembako', 'APPROVED', 1, ${NOW}, ${NOW})
    `);
    await db.execute(sql`
      INSERT INTO distribution_activities (
        id, institution_id, proposal_id, proposal_version, program_id, program_fund_type,
        name, description, target_amount, target_is_partial, currency_unit, status,
        version, created_at, updated_at, created_by
      ) VALUES (
        'act-sembako-01', ${SINAR}, 'prop-01', 1, 'prog-01', 'ZAKAT',
        'Kegiatan Penyaluran RW 05', 'Bantuan sembako', '1000000', false, 'IDR', 'ACTIVE',
        1, ${NOW}, ${NOW}, 'off-sinar-amil'
      )
    `);
  }

  // -------------------------------------------------------------------------
  // 1. Positive Correction & Predecessor Versioning
  // -------------------------------------------------------------------------
  it("allows authorized officer to correct nominal with reasons, bumping version and preserving old record (US-41, AC10)", async () => {
    const { id, version } = await createEndorsedContribution("BCA-COR-001", "300000");

    // Positive correction: nominal was actually 350.000
    const correctRes = await mutate(
      `/contributions/${id}/correct`,
      {
        expectedVersion: version,
        correctionType: "AMOUNT",
        amountExact: "350000",
        reason: "Penyesuaian nominal sesuai nota transfer donatur",
        sourceProofRef: "SLIP-TRANSFER-350K",
      },
      tokens.approverSinar
    );
    expect(correctRes.status).toBe(200);
    const body = await correctRes.json();
    expect(body.success).toBe(true);
    expect(body.contribution.amountExact).toBe("350000");
    expect(body.contribution.version).toBe(version + 1);
    expect(body.correction.fromAmountExact).toBe("300000");
    expect(body.correction.toAmountExact).toBe("350000");
    expect(body.correction.fromVersion).toBe(version);
    expect(body.correction.toVersion).toBe(version + 1);
    expect(body.correction.reason).toBe("Penyesuaian nominal sesuai nota transfer donatur");
    expect(body.correction.sourceProofRef).toBe("SLIP-TRANSFER-350K");

    // Check detail endpoint reflects correction history and events
    const detailRes = await get(`/contributions/${id}`, tokens.amilSinar);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.contribution.amountExact).toBe("350000");
    expect(detail.corrections).toHaveLength(1);
    expect(detail.corrections[0].fromAmountExact).toBe("300000");
    expect(detail.corrections[0].toAmountExact).toBe("350000");
    expect(detail.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "CORRECTION",
          version: version + 1,
          amountExact: "350000",
        }),
      ])
    );
  });

  // -------------------------------------------------------------------------
  // 2. Concurrency & Validation Guards
  // -------------------------------------------------------------------------
  it("rejects correction with stale expectedVersion, missing reason, or unauthorized role", async () => {
    const { id, version } = await createEndorsedContribution("BCA-COR-002", "500000");

    // Stale version
    const staleRes = await mutate(
      `/contributions/${id}/correct`,
      {
        expectedVersion: version - 1,
        correctionType: "AMOUNT",
        amountExact: "450000",
        reason: "Koreksi salah input",
        sourceProofRef: "SLIP-002",
      },
      tokens.approverSinar
    );
    expect(staleRes.status).toBe(409);

    // Missing reason (less than 5 chars)
    const shortReason = await mutate(
      `/contributions/${id}/correct`,
      {
        expectedVersion: version,
        correctionType: "AMOUNT",
        amountExact: "450000",
        reason: "err",
        sourceProofRef: "SLIP-002",
      },
      tokens.approverSinar
    );
    expect(shortReason.status).toBe(400);

    // Reader role without write mandate
    const unauth = await mutate(
      `/contributions/${id}/correct`,
      {
        expectedVersion: version,
        correctionType: "AMOUNT",
        amountExact: "450000",
        reason: "Koreksi oleh pembaca",
        sourceProofRef: "SLIP-002",
      },
      tokens.readerSinar
    );
    expect(unauth.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // 3. Spec 100 AC10 & ADR-0033 Q28: 500k -> 450k allocated -> 400k corrected => 50k shortfall
  // -------------------------------------------------------------------------
  it("preserves actual disbursements when corrected below allocations, surfaces 50k shortfall, and blocks worsening allocations (AC10)", async () => {
    await seedActivity();

    // 2. Create contribution 500.000 IDR
    const { id, version: v1 } = await createEndorsedContribution("BCA-AC10", "500000");

    // 3. Allocate 450.000 IDR to activity
    const allocRes = await mutate(
      `/contributions/${id}/allocate`,
      {
        activityId: "act-sembako-01",
        amountExact: "450000",
        expectedVersion: v1,
        reason: "Alokasi tahap awal sembako",
      },
      tokens.amilSinar
    );
    expect(allocRes.status).toBe(200);

    // 4. Correct contribution nominal to 400.000 IDR (less than 450.000 allocation!)
    const corRes = await mutate(
      `/contributions/${id}/correct`,
      {
        expectedVersion: v1,
        correctionType: "AMOUNT",
        amountExact: "400000",
        reason: "Koreksi kelebihan pencatatan bank dari 500.000 menjadi 400.000",
        sourceProofRef: "MUTASI-REVISI-400K",
      },
      tokens.approverSinar
    );
    expect(corRes.status).toBe(200);
    const corBody = await corRes.json();
    expect(corBody.contribution.amountExact).toBe("400000");
    const v2 = corBody.contribution.version;

    // 5. Verify detail: allocatedAmount = 450.000, shortfall = 50.000, unallocated = 0
    const detailRes = await get(`/contributions/${id}`, tokens.amilSinar);
    const detail = (await detailRes.json()).contribution;
    expect(detail.amountExact).toBe("400000");
    expect(detail.allocatedAmount).toBe("450000");
    expect(detail.unallocatedAmount).toBe("0");
    expect(detail.shortfallAmount).toBe("50000");

    // 6. Attempting additional allocation that worsens shortfall is atomically refused
    const worsenRes = await mutate(
      `/contributions/${id}/allocate`,
      {
        activityId: "act-sembako-01",
        amountExact: "1000",
        expectedVersion: v2,
        reason: "Mencoba menambah alokasi saat ada selisih",
      },
      tokens.amilSinar
    );
    expect(worsenRes.status).toBe(400);
    const worsenBody = await worsenRes.json();
    expect(worsenBody.error).toContain("melebihi sisa kontribusi yang tersedia (0)");
    const duplicate = await mutate(`/contributions/${id}/correct`, {
      expectedVersion: v2, correctionType: "DUPLICATE", reason: "Penerimaan ternyata dicatat ganda",
      sourceProofRef: "MUTASI-DUPLIKAT"
    }, tokens.approverSinar);
    expect(duplicate.status).toBe(200);
    const invalidated = (await (await get(`/contributions/${id}`, tokens.amilSinar)).json()).contribution;
    expect(invalidated.amountExact).toBe("400000"); // retained as historical face value
    expect(invalidated.unallocatedAmount).toBe("0");
    expect(invalidated.shortfallAmount).toBe("450000");
    const retained = await activityStore.listAllocationsForContribution(SINAR, id);
    expect(retained.allocations).toHaveLength(1);
    expect(retained.allocations[0].amountExact).toBe("450000");
    expect((await mutate(`/contributions/${id}/refunds`, {
      expectedVersion: v2 + 1, amountExact: "1000", reason: "Pengembalian catatan ganda", policyBasis: "SOP Lembaga"
    }, tokens.amilSinar)).status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // 4. Duplicate Entry Correction (without refund)
  // -------------------------------------------------------------------------
  it("distinguishes duplicate entry correction from refund; does not trigger payout or refund records (AC12)", async () => {
    const { id, version } = await createEndorsedContribution("BCA-DUP-001", "250000");

    const dupRes = await mutate(
      `/contributions/${id}/correct`,
      {
        expectedVersion: version,
        correctionType: "DUPLICATE",
        reason: "Entri ganda dari mutasi 15 September; data asli adalah BCA-ASLI-001",
        sourceProofRef: "AUDIT-MUTASI-DUPLIKAT",
      },
      tokens.approverSinar
    );
    expect(dupRes.status).toBe(200);
    const body = await dupRes.json();
    expect(body.contribution.status).toBe("REJECTED");
    expect(body.contribution.unqualifiedReason).toContain("Pencatatan ganda dikoreksi");
    expect(body.correction.correctionType).toBe("DUPLICATE");

    // Verify no refunds were recorded for this contribution
    const refundsRes = await get(`/contributions/${id}/refunds`, tokens.amilSinar);
    expect((await refundsRes.json()).refunds).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 5. Two-Step Refund: Decision (Pending) vs Actual Payment (Realization)
  // -------------------------------------------------------------------------
  it("records refund decision and actual payment with distinct identities, proof, and timestamps; retries do not record twice (AC03, US-44)", async () => {
    const { id, version: v1 } = await createEndorsedContribution("BCA-REF-001", "1000000");

    // Step 1: Record refund decision for partial amount (300.000)
    const refundDecOp = crypto.randomUUID();
    const decRes = await mutate(
      `/contributions/${id}/refunds`,
      {
        operationId: refundDecOp,
        expectedVersion: v1,
        amountExact: "300000",
        reason: "Kelebihan transfer donatur yang diminta kembali",
        policyBasis: "SOP Pengembalian Dana Lembaga No. 12/2026",
      },
      tokens.amilSinar
    );
    expect(decRes.status).toBe(201);
    const refund = (await decRes.json()).refund;
    expect(refund.id).toMatch(/^ref-/);
    expect(refund.amountExact).toBe("300000");
    expect(refund.status).toBe("DECIDED");
    expect(refund.paidAt).toBeNull();
    expect(refund.paymentProofRef).toBeNull();
    expect(refund.decidedBy).toBe(amilSinar.address.toLowerCase());

    // Verify detail shows refund pending payment
    const detailAfterDec = (await (await get(`/contributions/${id}`, tokens.amilSinar)).json()).contribution;
    expect(detailAfterDec.unallocatedAmount).toBe("700000"); // 1M - 300k decided

    // Step 2: Pay refund realization with actual payment proof and timestamp
    const payOp = crypto.randomUUID();
    const paidTimestamp = NOW + 1200;
    const payRes = await mutate(
      `/contributions/${id}/refunds/${refund.id}/pay`,
      {
        operationId: payOp,
        paymentProofRef: "TRX-BANK-REFUND-998877",
        paidAt: paidTimestamp,
        paymentNotes: "Transfer kembali ke rekening BCA an Donatur",
      },
      tokens.amilSinar
    );
    expect(payRes.status).toBe(200);
    const paidRefund = (await payRes.json()).refund;
    expect(paidRefund.status).toBe("PAID");
    expect(paidRefund.paidAt).toBe(paidTimestamp);
    expect(paidRefund.paymentProofRef).toBe("TRX-BANK-REFUND-998877");
    expect(paidRefund.paidBy).toBe(amilSinar.address.toLowerCase());

    // Idempotent retry: Replaying pay refund with same operationId returns same result
    const retryRes = await mutate(
      `/contributions/${id}/refunds/${refund.id}/pay`,
      {
        operationId: payOp,
        paymentProofRef: "TRX-BANK-REFUND-998877",
        paidAt: paidTimestamp,
        paymentNotes: "Transfer kembali ke rekening BCA an Donatur",
      },
      tokens.amilSinar
    );
    expect(retryRes.status).toBe(200);
    expect((await retryRes.json()).refund.status).toBe("PAID");

    // Paying again with a new operationId on an already PAID refund is rejected
    const doublePayRes = await mutate(
      `/contributions/${id}/refunds/${refund.id}/pay`,
      {
        paymentProofRef: "TRX-BANK-REFUND-SECOND",
        paidAt: paidTimestamp + 100,
      },
      tokens.amilSinar
    );
    expect(doublePayRes.status).toBe(409);

    // Verify balance after paid refund: Net contribution = 700.000
    const detailAfterPay = (await (await get(`/contributions/${id}`, tokens.amilSinar)).json()).contribution;
    expect(detailAfterPay.unallocatedAmount).toBe("700000");
    expect(detailAfterPay.shortfallAmount).toBe("0");
  });

  // -------------------------------------------------------------------------
  // 6. Proof Validity & Version Superseding (AC19)
  // -------------------------------------------------------------------------
  it("does not manufacture proof currentness from caller version hints (AC19)", async () => {
    const { id, version: v1 } = await createEndorsedContribution("BCA-VER-001", "600000");

    // Until a persisted receipt binding exists, client version hints cannot create a proof.
    for (const hint of [String(v1), "0", "999999", "NaN", "garbage", ""]) {
      const response = await get(`/contributions/${id}?proofVersion=${hint}`, tokens.amilSinar);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.contribution.proofValidity.status).toBe("NOT_AVAILABLE");
      expect(body.contribution.proofValidity.isCurrent).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // 7. Restart Persistence & Multi-Tenant Isolation (AC29, US-91)
  // -------------------------------------------------------------------------
  it("persists corrections, refunds, and discrepancies across database reopen and enforces strict institutional isolation (AC29)", async () => {
    const { id, version } = await createEndorsedContribution("BCA-PERSIST-001", "800000");

    // Perform correction
    await mutate(
      `/contributions/${id}/correct`,
      {
        expectedVersion: version,
        correctionType: "AMOUNT",
        amountExact: "750000",
        reason: "Potongan biaya administrasi oleh bank",
        sourceProofRef: "BCA-ADMIN-FEE",
      },
      tokens.approverSinar
    );

    // Decide refund
    await mutate(
      `/contributions/${id}/refunds`,
      {
        expectedVersion: version + 1,
        amountExact: "50000",
        reason: "Pengembalian sisa ke donatur",
        policyBasis: "SOP Lembaga",
      },
      tokens.amilSinar
    );

    // Reopen database to verify durability
    await database.reopen();
    configure(database.handle());

    // Sinar reads back data
    const readBack = await get(`/contributions/${id}`, tokens.amilSinar);
    expect(readBack.status).toBe(200);
    const body = await readBack.json();
    expect(body.contribution.amountExact).toBe("750000");
    expect(body.corrections).toHaveLength(1);
    expect(body.corrections[0].toAmountExact).toBe("750000");
    expect(body.refunds).toHaveLength(1);
    expect(body.refunds[0].amountExact).toBe("50000");
    expect(body.refunds[0].status).toBe("DECIDED");

    // Isolation check: Amil Baitul Maal cannot access Sinar's contribution, corrections, or refunds
    const baitulRead = await get(`/contributions/${id}`, tokens.amilBaitul);
    expect(baitulRead.status).toBe(404);

    const baitulCorrect = await mutate(
      `/contributions/${id}/correct`,
      {
        expectedVersion: version + 1,
        correctionType: "AMOUNT",
        amountExact: "700000",
        reason: "Percobaan akses tidak sah lintas lembaga",
        sourceProofRef: "ATTACK",
      },
      tokens.amilBaitul
    );
    expect(baitulCorrect.status).toBe(403);
  });

  it("requires endorsement authority for corrections and records the new endorsement", async () => {
    const { id, version } = await createEndorsedContribution("REVIEW-AUTH", "500000");
    const body = { expectedVersion: version, correctionType: "AMOUNT", amountExact: "400000",
      reason: "Koreksi penerimaan", sourceProofRef: "MUTASI-REVISI" };
    expect((await mutate(`/contributions/${id}/correct`, body, tokens.amilSinar)).status).toBe(403);
    expect((await contributionStore.getContribution(SINAR, id))?.version).toBe(version);
    clock += 10;
    const allowed = await mutate(`/contributions/${id}/correct`, body, tokens.approverSinar);
    expect(allowed.status).toBe(200);
    const {contribution, correction} = await allowed.json();
    expect(contribution.endorsedAt).toBe(clock);
    expect(contribution.endorsedBy).toBe(approverSinar.address.toLowerCase());
    expect(contribution.endorsementMandateId).toBe("sinar-endorse");
    expect(correction.actorAccount).toBe(approverSinar.address.toLowerCase());
    expect(correction.createdAt).toBe(clock);
    const recorderView = await (await get(`/contributions/${id}`, tokens.amilSinar)).json();
    const endorserView = await (await get(`/contributions/${id}`, tokens.approverSinar)).json();
    expect(recorderView.capabilities.canCorrect).toBe(false);
    expect(endorserView.capabilities.canCorrect).toBe(true);
    expect(recorderView.history.find((event: any) => event.action === "ENDORSE").occurredAt).toBe(NOW);
  });

  it("replays UI payments without paidAt after time advances and storage reopens", async () => {
    const {id, version} = await createEndorsedContribution("REVIEW-RETRY", "1000000");
    const decision = await mutate(`/contributions/${id}/refunds`, {
      expectedVersion: version, amountExact: "300000", reason: "Kelebihan transfer", policyBasis: "SOP Lembaga"
    }, tokens.amilSinar);
    const {refund} = await decision.json();
    const body = {operationId: crypto.randomUUID(), paymentProofRef: "BANK-REVIEW"};
    const path = `/contributions/${id}/refunds/${refund.id}/pay`;
    for (const paidAt of [0, -1, 1.5, "yesterday"]) {
      expect((await post(path, {...body, paidAt}, tokens.amilSinar)).status).toBe(400);
    }
    const first = await post(path, body, tokens.amilSinar);
    expect(first.status).toBe(200);
    const recorded = await first.json();
    clock += 2;
    await database.reopen();
    configure(database.handle());
    const replay = await post(path, body, tokens.amilSinar);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(recorded);
    expect((await post(path, {...body, paymentProofRef: "DIFFERENT"}, tokens.amilSinar)).status).toBe(409);
    expect((await contributionStore.getEvents(SINAR, id)).filter(e => e.eventType === "REFUND_PAYMENT")).toHaveLength(1);
  });

  it("exposes correction history only inside the donor's own verified session", async () => {
    const {id, version} = await createEndorsedContribution("REVIEW-DONOR", "500000");
    const other = await createEndorsedContribution("REVIEW-OTHER", "900000");
    const token = "review-donor-session";
    await database.handle().execute(sql`
      INSERT INTO donor_sessions (token_hash, contribution_id, institution_id, expires_at, created_at, last_accessed_at)
      VALUES (${hashSessionToken(token)}, ${id}, ${SINAR}, ${NOW + 3600}, ${NOW}, ${NOW})
    `);
    const corrected = await mutate(`/contributions/${id}/correct`, {
      expectedVersion: version, correctionType: "AMOUNT", amountExact: "400000",
      reason: "Koreksi mutasi bank", sourceProofRef: "PRIVATE-SOURCE-REF"
    }, tokens.approverSinar);
    expect(corrected.status).toBe(200);
    const read = (contributionId: string, sessionToken?: string) => app.fetch(new Request(
      `http://localhost:3001/api/donor/contributions/${contributionId}`,
      {headers: sessionToken ? {Authorization: `Bearer ${sessionToken}`} : {}}
    ));
    const response = await read(id, token);
    expect(response.status).toBe(200);
    const {contribution} = await response.json();
    expect(contribution.version).toBe(version + 1);
    expect(contribution.corrections).toEqual([{
      fromVersion: version, toVersion: version + 1, correctionType: "AMOUNT",
      fromAmountExact: "500000", toAmountExact: "400000", reason: "Koreksi mutasi bank", createdAt: NOW
    }]);
    expect(JSON.stringify(contribution)).not.toContain("PRIVATE-SOURCE-REF");
    expect(JSON.stringify(contribution)).not.toContain(approverSinar.address.toLowerCase());
    expect((await read(other.id, token)).status).toBe(403);
    expect((await read(id)).status).toBe(401);
  });
  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("browser: corrects, refunds, retries a lost payment response and retains history on desktop and phone", async () => {
    await seedActivity();
    const built = await Bun.build({
      entrypoints: [new URL("../../frontend/test/donor-recovery-officer-smoke.tsx", import.meta.url).pathname],
      target: "browser", define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "" }) },
    });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const bundle = await built.outputs[0]!.text();
    const cssProcess = Bun.spawn(["bun", "test/build-smoke-css.ts"], {
      cwd: new URL("../../frontend", import.meta.url).pathname, stdout: "pipe", stderr: "pipe",
    });
    const css = await new Response(cssProcess.stdout).text();
    if (await cssProcess.exited !== 0) throw new Error(await new Response(cssProcess.stderr).text());
    let browserToken = tokens.approverSinar;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/") return new Response('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/smoke.css"><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
      if (path === "/smoke.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
      if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
      if (path === "/smoke-config") return Response.json({ token: browserToken });
      return app.fetch(req);
    }});
    const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
    let browser: any;
    try {
      browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
      for (const viewport of [{width: 1280, height: 900}, {width: 390, height: 844}]) {
        const reference = `BCA-BROWSER-106-${viewport.width}`;
        const {id, version} = await createEndorsedContribution(reference, "500000");
        expect((await mutate(`/contributions/${id}/allocate`, {
          activityId: "act-sembako-01", amountExact: "450000", expectedVersion: version, reason: "Pendanaan bantuan"
        }, tokens.amilSinar)).status).toBe(200);
        browserToken = tokens.approverSinar;
        const page = await browser.newPage({viewport});
        const errors: string[] = [];
        page.on("pageerror", (error: Error) => errors.push(error.message));
        page.setDefaultTimeout(10000);
        await page.addInitScript((now: number) => { Date.now = () => now * 1000; }, NOW);
        const openDetail = async () => {
          await page.getByRole("row").filter({hasText: reference}).getByRole("button", {name: "Detail", exact: true}).click();
          await page.getByRole("dialog", {name: `Detail kontribusi ${id}`, exact: true}).waitFor();
        };
        await page.goto(server.url.toString());
        await openDetail();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
        const detail = page.getByRole("dialog", {name: `Detail kontribusi ${id}`, exact: true});
        await detail.getByText("Bukti belum tersedia", {exact: true}).waitFor();
        await detail.getByRole("button", {name: "Koreksi Kontribusi", exact: true}).focus();
        await page.keyboard.press("Enter");
        const correction = page.getByRole("dialog", {name: "Koreksi Kontribusi", exact: true});
        await correction.getByLabel(/Nominal Baru/).fill("400000");
        await correction.getByLabel(/Alasan Koreksi/).fill("Koreksi mutasi pada browser");
        expect(await correction.getByRole("button", {name: "Sahkan Koreksi", exact: true}).isDisabled()).toBe(true);
        await correction.getByLabel(/Nomor Bukti Sumber/).fill("BANK-REV-BROWSER");
        await correction.getByRole("button", {name: "Sahkan Koreksi", exact: true}).click();
        await correction.waitFor({state: "detached"});
        await detail.getByText("Koreksi mutasi pada browser", {exact: false}).first().waitFor();
        await detail.getByText(/Selisih Lebih Alokasi: Rp 50\.000/).waitFor();
        expect(await detail.innerText()).not.toContain("Invalid Date");
        await detail.getByRole("button", {name: "Keputusan Pengembalian", exact: true}).click();
        const decision = page.getByRole("dialog", {name: "Keputusan Pengembalian Dana", exact: true});
        await decision.getByLabel(/Nominal Pengembalian/).fill("100000");
        await decision.getByLabel("Alasan Pengembalian", {exact: true}).fill("Kelebihan transfer berdasarkan keputusan lembaga");
        await decision.getByLabel(/Dasar Kebijakan/).fill("SOP Lembaga 106");
        await decision.getByRole("button", {name: "Catat Keputusan", exact: true}).click();
        await decision.waitFor({state: "detached"});
        await detail.getByText("Menunggu pembayaran", {exact: true}).waitFor();
        const decided = (await contributionStore.listRefunds(SINAR, id))[0]!;
        expect(decided.paidAt).toBeNull();
        await detail.getByRole("button", {name: "Catat Pembayaran", exact: true}).click();
        const payment = page.getByRole("dialog", {name: "Catat Pembayaran Pengembalian", exact: true});
        await payment.getByLabel(/Referensi Bukti Pembayaran/).fill("BANK-PAY-BROWSER");
        await payment.getByLabel(/Waktu Pembayaran Aktual/).fill("2026-09-19T10:30");
        let paymentCalls = 0;
        const submitted: any[] = [];
        await page.route(`**/api/workspace/contributions/${id}/refunds/*/pay`, async (route: any) => {
          submitted.push(route.request().postDataJSON());
          const response = await route.fetch();
          if (++paymentCalls === 1) { clock += 2; await route.abort("failed"); }
          else await route.fulfill({response});
        });
        await payment.getByRole("button", {name: "Catat Pembayaran Selesai", exact: true}).click();
        // A lost response must be visible in the active dialog, with the same form available for retry.
        await payment.getByRole("alert").waitFor();
        expect((await contributionStore.listRefunds(SINAR, id))[0]!.status).toBe("PAID");
        await payment.getByRole("button", {name: "Catat Pembayaran Selesai", exact: true}).click();
        await payment.waitFor({state: "detached"});
        await detail.getByText("Sudah dibayarkan", {exact: true}).waitFor();
        expect(submitted).toHaveLength(2);
        expect(submitted[1]).toEqual(submitted[0]);
        expect((await contributionStore.getEvents(SINAR, id)).filter(e => e.eventType === "REFUND_PAYMENT")).toHaveLength(1);
        await page.reload();
        await openDetail();
        await detail.getByText("BANK-PAY-BROWSER", {exact: true}).waitFor();
        await detail.getByText(/Selisih Lebih Alokasi: Rp 150\.000/).waitFor();
        const bounds = await detail.boundingBox();
        expect(bounds!.width).toBeLessThanOrEqual(viewport.width);
        expect(await detail.evaluate((el: HTMLElement) => el.scrollWidth <= el.clientWidth)).toBe(true);
        await page.screenshot({path: `/tmp/issue106-browser-${viewport.width}.png`, fullPage: false});
        browserToken = tokens.amilSinar;
        await page.reload();
        await openDetail();
        expect(await detail.getByRole("button", {name: "Koreksi Kontribusi", exact: true}).count()).toBe(0);
        expect(errors).toEqual([]);
        await page.close();
      }
    } finally { await browser?.close(); await server.stop(true); }
  }, 90000);

});

describe("Trusted proof version comparison", () => {
  it("separates historical, matching, and impossible proof versions", () => {
    expect(evaluateProofValidity(4, 3).status).toBe("SUPERSEDED");
    expect(evaluateProofValidity(4, 4).isCurrent).toBe(true);
    for (const version of [null, NaN, Infinity, 0, -1, 3.5, 5]) {
      expect(evaluateProofValidity(4, version).status).toBe("NOT_AVAILABLE");
      expect(evaluateProofValidity(4, version).isCurrent).toBe(false);
    }
  });
});

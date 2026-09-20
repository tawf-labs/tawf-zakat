/**
 * Integration & Acceptance Tests for Donor Contact & Access Recovery (Spec #100, Ticket #105).
 *
 * Covers:
 * - US-50: Recover access through authorized officer with evidence and audit trail.
 * - US-51: Retain contributions with absent or incorrect contacts (no deletion, no fake contacts).
 * - US-89: Clear error messages and accessible feedback.
 * - US-91: Tested through authenticated HTTP with real isolated storage.
 * - AC13: Single-contribution bounded access; shared contact isolation.
 * - AC14: Revocation of old unspent codes and sessions on approved recovery.
 * - AC15: Public projections do not leak donor name, amount, or unmasked contacts.
 * - AC29: Separation between operator authority and donor session; mandate checking.
 * - AC30: Smoke browser test demonstrating recovery request, officer examination, approval, and recovered OTP access.
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
import { createDonorAccessStore, type DonorAccessStore } from "../src/donor-access-store";
import { configureWorkspace, resetWorkspace, type RecipientMessageTransport } from "../src/workspace-runtime";
import { type EthCall } from "../src/account-signature";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { CONTRIBUTION_SCHEMA_STATEMENTS } from "../src/contribution-store";
import { ACTIVITY_SCHEMA_STATEMENTS } from "../src/activity-store";
import { DISBURSEMENT_SCHEMA_STATEMENTS } from "../src/disbursement-store";
import { DONOR_ACCESS_SCHEMA_STATEMENTS } from "../src/donor-access-store";
import { rowsOf } from "../src/sql-rows";

const BASE_DONOR = "http://localhost:3001/api/donor";
const BASE_WORKSPACE = "http://localhost:3001/api/workspace";

const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";

const adminSinar = privateKeyToAccount(`0x${"a1".repeat(32)}` as Hex);
const amilSinar = privateKeyToAccount(`0x${"b1".repeat(32)}` as Hex);
const approverSinar = privateKeyToAccount(`0x${"b2".repeat(32)}` as Hex);
const unauthorizedOfficer = privateKeyToAccount(`0x${"c3".repeat(32)}` as Hex);

const NOW = 1_800_000_000;
const OTP_KEY = Buffer.alloc(32, 9);

let database: TestWorkspaceDatabase;
let workspaceStore: WorkspaceStore;
let disbursementStore: DisbursementStore;
let contributionStore: ContributionStore;
let activityStore: ActivityStore;
let donorAccessStore: DonorAccessStore;
let clock = NOW;

let outbox: Array<{ to: string; body: string }> = [];
const messageTransport: RecipientMessageTransport = {
  async send(message) {
    outbox.push(message);
  },
  canDeliver(to) {
    return to.includes("@");
  },
};

const ethCall: EthCall = async () => "0x";

const requestDonor = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`${BASE_DONOR}${path}`, init));

const postDonor = (path: string, body: unknown, token?: string) =>
  requestDonor(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const getDonor = (path: string, token?: string) =>
  requestDonor(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

const requestWorkspace = (path: string, token: string, init: RequestInit = {}) =>
  app.fetch(
    new Request(`${BASE_WORKSPACE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    })
  );

async function signInWorkspace(
  account: { address: string; signTypedData: (payload: any) => Promise<Hex> },
  institutionId: string
): Promise<string> {
  const challengeRes = await app.fetch(
    new Request(`${BASE_WORKSPACE}/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ institutionId, account: account.address }),
    })
  );
  const { challenge, typedData } = await challengeRes.json();
  const signature = await account.signTypedData({
    ...typedData,
    message: {
      ...typedData.message,
      nonce: challenge.nonce,
      issuedAt: BigInt(challenge.issuedAt),
      expiresAt: BigInt(challenge.expiresAt),
    },
  });
  const sessionRes = await app.fetch(
    new Request(`${BASE_WORKSPACE}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        institutionId,
        account: account.address,
        nonce: challenge.nonce,
        signature,
      }),
    })
  );
  const body = await sessionRes.json();
  return body.token;
}

describe("Donor Contact & Access Recovery (Ticket #105)", () => {
  let amilToken: string;
  let unauthorizedToken: string;

  beforeAll(async () => {
    database = await createTestWorkspaceDatabase(process.env.DONOR_ACCESS_TEST_DATABASE_URL);
    const handle = database.handle();
    workspaceStore = createWorkspaceStore(handle);
    disbursementStore = createDisbursementStore(handle);
    contributionStore = createContributionStore(handle);
    activityStore = createActivityStore(handle);
    donorAccessStore = createDonorAccessStore(handle, OTP_KEY);

    await workspaceStore.ensureSchema();
    for (const stmt of DISBURSEMENT_SCHEMA_STATEMENTS) await handle.execute(sql.raw(stmt));
    for (const stmt of CONTRIBUTION_SCHEMA_STATEMENTS) await handle.execute(sql.raw(stmt));
    for (const stmt of ACTIVITY_SCHEMA_STATEMENTS) await handle.execute(sql.raw(stmt));
    for (const stmt of DONOR_ACCESS_SCHEMA_STATEMENTS) await handle.execute(sql.raw(stmt));

    configureWorkspace({
      store: workspaceStore,
      disbursement: disbursementStore,
      contributions: contributionStore,
      activities: activityStore,
      donorAccess: donorAccessStore,
      donorMessages: messageTransport,
      ethCall,
      now: () => clock,
      challengeTtlSeconds: 300,
      sessionTtlSeconds: 3600,
    });
  });

  afterAll(async () => {
    resetWorkspace();
    await database.close();
  });

  beforeEach(async () => {
    clock = NOW;
    outbox = [];
    await database.reset();

    configureWorkspace({
      store: workspaceStore,
      disbursement: disbursementStore,
      contributions: contributionStore,
      activities: activityStore,
      donorAccess: donorAccessStore,
      donorMessages: messageTransport,
      ethCall,
      now: () => clock,
      challengeTtlSeconds: 300,
      sessionTtlSeconds: 3600,
    });

    const db = database.handle();
    const sinar = institutionRecordOf(SYNTHETIC_INSTITUTIONS[0]);
    const baitul = institutionRecordOf(SYNTHETIC_INSTITUTIONS[1]);
    await db.execute(sql`
      INSERT INTO institutions (id, legal_name, scope_unit, scope_level, mandate_note, is_synthetic)
      VALUES (${sinar.id}, ${sinar.legalName}, ${sinar.scopeUnit}, ${sinar.scopeLevel}, ${sinar.mandateNote}, true),
             (${baitul.id}, ${baitul.legalName}, ${baitul.scopeUnit}, ${baitul.scopeLevel}, ${baitul.mandateNote}, true)
    `);

    const admin = adminSinar.address.toLowerCase();
    const amil = amilSinar.address.toLowerCase();
    const unauth = unauthorizedOfficer.address.toLowerCase();

    await db.execute(sql`
      INSERT INTO officer_profiles (id, institution_id, display_name, is_active)
      VALUES ('off-sinar-admin', ${SINAR}, 'Admin Sinar', true),
             ('off-sinar-amil', ${SINAR}, 'Ahmad Amil', true),
             ('off-sinar-unauth', ${SINAR}, 'Pemeriksa Luar', true)
    `);

    await db.execute(sql`
      INSERT INTO institution_memberships (institution_id, account_address, role, officer_id, is_active)
      VALUES (${SINAR}, ${admin}, 'ADMIN', 'off-sinar-admin', true),
             (${SINAR}, ${amil}, 'OFFICER', 'off-sinar-amil', true),
             (${SINAR}, ${unauth}, 'READER', 'off-sinar-unauth', true)
    `);

    await db.execute(sql`
      INSERT INTO operational_mandates (
        id, institution_id, officer_id, account_address, function, scope_type,
        program_id, valid_from, valid_until, assignment_ref, nominal_limit, version, is_active, created_at, updated_at, created_by
      ) VALUES
        ('mandate-amil-record', ${SINAR}, 'off-sinar-amil', ${amil},
        'RECORD_CONTRIBUTIONS', 'ALL_PROGRAMS', null, ${NOW - 1000}, ${NOW + 100000}, 'SK-AMIL-01', null, 1, true, ${NOW}, ${NOW}, ${admin})
    `);

    amilToken = await signInWorkspace(amilSinar, SINAR);
    unauthorizedToken = await signInWorkspace(unauthorizedOfficer, SINAR);
  });

  it("submits a recovery request with reference, new contact, and evidence basis (US-50, AC105.1)", async () => {
    const handle = database.handle();
    await handle.execute(sql`
      INSERT INTO contributions (
        id, institution_id, source_channel, source_reference, currency_unit,
        amount_exact, fund_type, purpose, received_at, donor_name, donor_contact,
        status, version, created_at, updated_at, created_by
      ) VALUES (
        'c-rec-001', ${SINAR}, 'BANK_TRANSFER', 'BCA-REC-001', 'IDR',
        '1000000', 'ZAKAT_MAL', 'Zakat Maal', ${NOW - 5000}, 'Donatur A', null,
        'RECEIVED', 1, ${NOW - 5000}, ${NOW - 5000}, 'sys'
      );
    `);

    // 1. Fails when reference does not resolve
    const resBadRef = await postDonor("/recovery-request", {
      reference: "NON-EXISTENT-REF",
      requestedContact: "donatur-baru@example.com",
      donorName: "Donatur A",
      evidenceBasis: "Bukti transfer m-banking BCA jam 10:15 WIB",
    });
    expect(resBadRef.status).toBe(404);

    // 2. Fails when contact is invalid email
    const resBadContact = await postDonor("/recovery-request", {
      reference: "BCA-REC-001",
      requestedContact: "not-an-email",
      donorName: "Donatur A",
      evidenceBasis: "Bukti transfer m-banking BCA jam 10:15 WIB",
    });
    expect(resBadContact.status).toBe(400);

    // 3. Fails when evidenceBasis is missing or too short
    const resNoEvidence = await postDonor("/recovery-request", {
      reference: "BCA-REC-001",
      requestedContact: "donatur-baru@example.com",
      donorName: "Donatur A",
      evidenceBasis: "abc",
    });
    expect(resNoEvidence.status).toBe(400);

    // 4. Valid request succeeds
    const resOk = await postDonor("/recovery-request", {
      reference: "BCA-REC-001",
      requestedContact: "donatur-baru@example.com",
      donorName: "Donatur A",
      evidenceBasis: "Bukti transfer m-banking BCA tanggal 19 Sep jam 10:15 WIB nomor ref 998877",
    });
    expect(resOk.status).toBe(201);
    const bodyOk = await resOk.json();
    expect(bodyOk.success).toBe(true);
    expect(bodyOk.requestId).toMatch(/^d-rec-[0-9a-f]{32}$/);
    expect(bodyOk.status).toBe("PENDING");

    // 5. Duplicate pending request for the same contribution is rejected (AC105.2)
    const resDup = await postDonor("/recovery-request", {
      reference: "BCA-REC-001",
      requestedContact: "donatur-lain@example.com",
      donorName: "Donatur B",
      evidenceBasis: "Klaim ganda yang mendahului pemeriksaan",
    });
    expect(resDup.status).toBe(409);
  });

  it("exposes public stage without leaking donor identity, amount, or unmasked contact (AC15, AC105.4)", async () => {
    const handle = database.handle();
    await handle.execute(sql`
      INSERT INTO contributions (
        id, institution_id, source_channel, source_reference, currency_unit,
        amount_exact, fund_type, purpose, received_at, donor_name, donor_contact,
        status, version, created_at, updated_at, created_by
      ) VALUES (
        'c-rec-002', ${SINAR}, 'BANK_TRANSFER', 'BCA-REC-002', 'IDR',
        '25000000', 'ZAKAT_MAL', 'Zakat Maal Privat', ${NOW - 5000}, 'Hamba Allah Rahasia', 'old-contact@example.com',
        'RECEIVED', 1, ${NOW - 5000}, ${NOW - 5000}, 'sys'
      );
    `);

    const submitRes = await postDonor("/recovery-request", {
      reference: "BCA-REC-002",
      requestedContact: "donatur-pemulihan@test.com",
      donorName: "Hamba Allah",
      evidenceBasis: "Struk ATM BCA Cabang Sudirman",
    });
    const { requestId } = await submitRes.json();

    // Check by request ID
    const resById = await getDonor(`/recovery-request/${requestId}`);
    expect(resById.status).toBe(200);
    const dataById = await resById.json();
    expect(dataById.request.status).toBe("PENDING");
    expect(dataById.request.requestedContactMasked).toBe("d***n@test.com");
    expect(JSON.stringify(dataById)).not.toContain("25000000");
    expect(JSON.stringify(dataById)).not.toContain("donatur-pemulihan@test.com");
    expect(JSON.stringify(dataById)).not.toContain("old-contact@example.com");

    // Check by contribution reference
    const resByRef = await getDonor(`/recovery-status?reference=BCA-REC-002`);
    expect(resByRef.status).toBe(200);
    const dataByRef = await resByRef.json();
    expect(dataByRef.request.id).toBe(requestId);
    expect(dataByRef.request.status).toBe("PENDING");
  });

  it("enforces officer mandate RECORD_CONTRIBUTIONS to review recovery requests (AC29, AC105.1)", async () => {
    // 1. Without token -> 401
    const resNoAuth = await app.fetch(new Request(`${BASE_WORKSPACE}/contributions/recovery-requests`));
    expect(resNoAuth.status).toBe(401);

    // 2. Officer without RECORD_CONTRIBUTIONS (READER role) -> 403
    const resUnauth = await requestWorkspace("/contributions/recovery-requests", unauthorizedToken);
    expect(resUnauth.status).toBe(403);

    // 3. Authorized amil with RECORD_CONTRIBUTIONS -> 200
    const resAuth = await requestWorkspace("/contributions/recovery-requests", amilToken);
    expect(resAuth.status).toBe(200);
    const body = await resAuth.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.requests)).toBe(true);
  });

  it("records rejection without modifying contribution or fabricating contact (US-51, AC105.4)", async () => {
    const handle = database.handle();
    await handle.execute(sql`
      INSERT INTO contributions (
        id, institution_id, source_channel, source_reference, currency_unit,
        amount_exact, fund_type, purpose, received_at, donor_name, donor_contact,
        status, version, created_at, updated_at, created_by
      ) VALUES (
        'c-rec-003', ${SINAR}, 'BANK_TRANSFER', 'BCA-REC-003', 'IDR',
        '500000', 'INFAQ', 'Infaq Umum', ${NOW - 5000}, null, null,
        'RECEIVED', 1, ${NOW - 5000}, ${NOW - 5000}, 'sys'
      );
    `);

    const submitRes = await postDonor("/recovery-request", {
      reference: "BCA-REC-003",
      requestedContact: "stranger@fraud.test",
      donorName: "Penyerobot Referensi",
      evidenceBasis: "Nomor referensi saya dapat dari struk yang tercecer",
    });
    const { requestId } = await submitRes.json();

    // Officer reviews and REJECTS
    const rejectRes = await requestWorkspace(
      `/contributions/recovery-requests/${requestId}/decision`,
      amilToken,
      {
        method: "POST",
        body: JSON.stringify({
          decision: "REJECTED",
          reason: "Bukti transfer tidak memuat kecocokan dengan donor Rahasia Sintetis, nominal 987654321, kontak privat@example.test.",
          expectedContributionVersion: 1,
        }),
      }
    );
    expect(rejectRes.status).toBe(200);
    const rejectBody = await rejectRes.json();
    expect(rejectBody.request.status).toBe("REJECTED");
    expect(rejectBody.request.decisionReason).toContain("Bukti transfer tidak memuat");

    // Verify contribution was untouched (version is still 1, contact is still null)
    const [cRow] = rowsOf(await handle.execute(sql`SELECT * FROM contributions WHERE id = 'c-rec-003'`));
    expect(cRow.version).toBe(1);
    expect(cRow.donor_contact).toBeNull();

    // Verify audit history entry was written
    const historyRows = rowsOf(
      await handle.execute(sql`SELECT * FROM contribution_history WHERE contribution_id = 'c-rec-003'`)
    );
    expect(historyRows.length).toBe(1);
    expect(historyRows[0].action).toBe("REJECT_DONOR_CONTACT_RECOVERY");
    expect(historyRows[0].actor_account).toBe(amilSinar.address.toLowerCase());

    // Public check shows stage only; examination reasons stay private
    const pubRes = await getDonor(`/recovery-request/${requestId}`);
    const pubBody = await pubRes.json();
    expect(pubBody.request.status).toBe("REJECTED");
    expect(pubBody.request).not.toHaveProperty("decisionReason");
    const byReference = await getDonor('/recovery-status?reference=BCA-REC-003');
    const publicText = JSON.stringify([pubBody, await byReference.json()]);
    for (const secret of ['Rahasia Sintetis', '987654321', 'privat@example.test']) {
      expect(publicText).not.toContain(secret);
    }
    const privateDetail = await requestWorkspace(`/contributions/recovery-requests/${requestId}`, amilToken);
    expect((await privateDetail.json()).request.decisionReason).toContain('Rahasia Sintetis');
  });

  it("approves recovery, updates contact, bumps version, revokes old session and codes, and allows new OTP access (AC14, AC105.2, AC105.3)", async () => {
    const handle = database.handle();
    await handle.execute(sql`
      INSERT INTO contributions (
        id, institution_id, source_channel, source_reference, currency_unit,
        amount_exact, fund_type, purpose, received_at, donor_name, donor_contact,
        status, version, created_at, updated_at, created_by
      ) VALUES (
        'c-rec-004', ${SINAR}, 'BANK_TRANSFER', 'BCA-REC-004', 'IDR',
        '750000', 'ZAKAT_MAL', 'Zakat Maal', ${NOW - 10000}, 'Donatur Lama', 'lama@example.test',
        'RECEIVED', 1, ${NOW - 10000}, ${NOW - 10000}, 'sys'
      );
    `);

    // 1. Issue an OTP and get a session under the old contact
    const oldChallengeRes = await postDonor("/otp-challenge", { reference: "BCA-REC-004" });
    expect(oldChallengeRes.status).toBe(201);
    const { challengeId: oldChallengeId } = await oldChallengeRes.json();
    const oldCode = outbox[0].body.match(/\b(\d{6})\b/)![1];

    const oldSessionRes = await postDonor("/session", { challengeId: oldChallengeId, otpCode: oldCode });
    expect(oldSessionRes.status).toBe(201);
    const { sessionToken: oldSessionToken } = await oldSessionRes.json();

    // Verify old session works
    const oldAccessRes = await getDonor("/contributions/c-rec-004", oldSessionToken);
    expect(oldAccessRes.status).toBe(200);

    // 2. Donor submits recovery request with new contact
    clock += 100;
    const reqRes = await postDonor("/recovery-request", {
      reference: "BCA-REC-004",
      requestedContact: "pemulihan.sah@test.com",
      donorName: "Donatur Sah Terverifikasi",
      evidenceBasis: "Buku tabungan BCA a.n. Donatur Sah, mutasi debet 750000",
    });
    expect(reqRes.status).toBe(201);
    const { requestId } = await reqRes.json();

    // 3. Officer approves recovery
    clock += 50;
    const approveRes = await requestWorkspace(
      `/contributions/recovery-requests/${requestId}/decision`,
      amilToken,
      {
        method: "POST",
        body: JSON.stringify({
          decision: "APPROVED",
          reason: "Buku tabungan dan mutasi BCA telah dicocokkan dengan rekening koran lembaga.",
          expectedContributionVersion: 1,
        }),
      }
    );
    expect(approveRes.status).toBe(200);
    const approveBody = await approveRes.json();
    expect(approveBody.request.status).toBe("APPROVED");
    expect(approveBody.contribution.version).toBe(2);
    expect(approveBody.contribution.donor_contact).toBe("pemulihan.sah@test.com");

    // 4. OLD SESSION IS REVOKED (AC14, AC105.3): should immediately return 401
    const staleAccessRes = await getDonor("/contributions/c-rec-004", oldSessionToken);
    expect(staleAccessRes.status).toBe(401);

    // 5. Subsequent OTP request sends ONLY to the new contact
    clock += 65;
    outbox = [];
    const newChallengeRes = await postDonor("/otp-challenge", { reference: "BCA-REC-004" });
    expect(newChallengeRes.status).toBe(201);
    const { challengeId: newChallengeId } = await newChallengeRes.json();

    expect(outbox.length).toBe(1);
    expect(outbox[0].to).toBe("pemulihan.sah@test.com"); // Reaches ONLY new contact!
    const newCode = outbox[0].body.match(/\b(\d{6})\b/)![1];

    // 6. Sign in with new OTP
    const newSessionRes = await postDonor("/session", { challengeId: newChallengeId, otpCode: newCode });
    expect(newSessionRes.status).toBe(201);
    const { sessionToken: newSessionToken } = await newSessionRes.json();

    // 7. Verify details under new session
    const newAccessRes = await getDonor("/contributions/c-rec-004", newSessionToken);
    expect(newAccessRes.status).toBe(200);
    const newAccessBody = await newAccessRes.json();
    expect(newAccessBody.contribution.donorContactMasked).toBe("p***h@test.com");

    // 8. Audit trail recorded properly
    const [auditRow] = rowsOf(
      await handle.execute(sql`
        SELECT * FROM contribution_history
        WHERE contribution_id = 'c-rec-004' AND action = 'RECOVER_DONOR_CONTACT'
      `)
    );
    expect(auditRow.version).toBe(2);
    expect(auditRow.actor_account).toBe(amilSinar.address.toLowerCase());
    expect(auditRow.notes).toContain("p***h@test.com");
  });

  it("handles version conflict and prevents concurrent double-approval (AC105.2)", async () => {
    const handle = database.handle();
    await handle.execute(sql`
      INSERT INTO contributions (
        id, institution_id, source_channel, source_reference, currency_unit,
        amount_exact, fund_type, purpose, received_at, donor_name, donor_contact,
        status, version, created_at, updated_at, created_by
      ) VALUES (
        'c-rec-005', ${SINAR}, 'BANK_TRANSFER', 'BCA-REC-005', 'IDR',
        '300000', 'ZAKAT_MAL', 'Zakat Maal', ${NOW - 10000}, null, null,
        'RECEIVED', 1, ${NOW - 10000}, ${NOW - 10000}, 'sys'
      );
    `);

    const reqRes = await postDonor("/recovery-request", {
      reference: "BCA-REC-005",
      requestedContact: "contact1@test.com",
      donorName: "Pemohon",
      evidenceBasis: "Struk ATM",
    });
    const { requestId } = await reqRes.json();

    await handle.execute(sql`
      INSERT INTO operational_mandates (
        id, institution_id, officer_id, account_address, function, scope_type, program_id,
        valid_from, valid_until, assignment_ref, nominal_limit, version, is_active, created_at, updated_at, created_by
      ) VALUES ('mandate-admin-record', ${SINAR}, 'off-sinar-admin', ${adminSinar.address.toLowerCase()},
        'RECORD_CONTRIBUTIONS', 'ALL_PROGRAMS', null, ${NOW - 1000}, ${NOW + 100000}, 'SK-ADMIN-02', null, 1, true, ${NOW}, ${NOW}, ${adminSinar.address.toLowerCase()})
    `);
    const secondOfficerToken = await signInWorkspace(adminSinar, SINAR);
    // Two authorized officers decide at the same time; exactly one may persist.
    const decisions = await Promise.all(["APPROVED", "REJECTED"].map((decision, index) =>
      requestWorkspace(`/contributions/recovery-requests/${requestId}/decision`, index === 0 ? amilToken : secondOfficerToken, {
        method: "POST",
        body: JSON.stringify({ decision, reason: `Pemeriksaan ${decision}`, expectedContributionVersion: 1 }),
      })
    ));
    expect(decisions.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = await decisions.find((r) => r.status === 200)!.json();
    const reread = await requestWorkspace(`/contributions/recovery-requests/${requestId}`, amilToken);
    expect((await reread.json()).request.status).toBe(winner.request.status);
    const history = rowsOf(await handle.execute(sql`SELECT * FROM contribution_history WHERE contribution_id = 'c-rec-005'`));
    expect(history).toHaveLength(1);
    expect(history[0].reason).toBe(winner.request.decisionReason);
    expect(outbox).toHaveLength(0);

  });

  it("is idempotent when retrying decision with operationId (AC105.2)", async () => {
    const handle = database.handle();
    await handle.execute(sql`
      INSERT INTO contributions (
        id, institution_id, source_channel, source_reference, currency_unit,
        amount_exact, fund_type, purpose, received_at, donor_name, donor_contact,
        status, version, created_at, updated_at, created_by
      ) VALUES (
        'c-rec-006', ${SINAR}, 'BANK_TRANSFER', 'BCA-REC-006', 'IDR',
        '400000', 'ZAKAT_MAL', 'Zakat Maal', ${NOW - 10000}, null, null,
        'RECEIVED', 1, ${NOW - 10000}, ${NOW - 10000}, 'sys'
      );
    `);

    const reqRes = await postDonor("/recovery-request", {
      reference: "BCA-REC-006",
      requestedContact: "idempotent@test.com",
      donorName: "Pemohon Idempotent",
      evidenceBasis: "Struk Transfer ATM BCA",
    });
    const { requestId } = await reqRes.json();

    const opId = "op-recovery-decide-001";
    const payload = {
      decision: "APPROVED",
      reason: "Pemeriksaan sah dengan mutasi.",
      expectedContributionVersion: 1,
      operationId: opId,
    };

    const res1 = await requestWorkspace(`/contributions/recovery-requests/${requestId}/decision`, amilToken, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();

    // Retry with same operationId returns cached result
    const res2 = await requestWorkspace(`/contributions/recovery-requests/${requestId}/decision`, amilToken, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2).toEqual(body1);
  });

  it("persists recovery state across database restart (US-91)", async () => {
    const handle = database.handle();
    await handle.execute(sql`
      INSERT INTO contributions (
        id, institution_id, source_channel, source_reference, currency_unit,
        amount_exact, fund_type, purpose, received_at, donor_name, donor_contact,
        status, version, created_at, updated_at, created_by
      ) VALUES (
        'c-rec-007', ${SINAR}, 'BANK_TRANSFER', 'BCA-REC-007', 'IDR',
        '900000', 'ZAKAT_MAL', 'Zakat Maal', ${NOW - 10000}, null, 'old-restart@example.test',
        'RECEIVED', 1, ${NOW - 10000}, ${NOW - 10000}, 'sys'
      );
    `);

    const reqRes = await postDonor("/recovery-request", {
      reference: "BCA-REC-007",
      requestedContact: "persisted@test.com",
      donorName: "Pemohon Persist",
      evidenceBasis: "Mutasi BCA",
    });
    const { requestId } = await reqRes.json();

    const issue = await postDonor('/otp-challenge', { reference: 'BCA-REC-007' });
    expect(issue.status).toBe(201);
    const oldChallenge = await issue.json();
    const oldCode = outbox.at(-1)!.body.match(/\b(\d{6})\b/)![1];
    const verified = await postDonor('/session', { challengeId: oldChallenge.challengeId, otpCode: oldCode });
    expect(verified.status).toBe(201);
    const oldSession = await verified.json();
    clock += 61;
    const unspent = await postDonor('/otp-challenge', { reference: 'BCA-REC-007' });
    const unspentChallenge = await unspent.json();
    const unspentCode = outbox.at(-1)!.body.match(/\b(\d{6})\b/)![1];
    const payload = { decision: 'APPROVED', reason: 'Mutasi BCA diperiksa dan cocok.', expectedContributionVersion: 1, operationId: 'durable-recovery' };
    const decisionPath = `/contributions/recovery-requests/${requestId}/decision`;
    const decided = await requestWorkspace(decisionPath, amilToken, { method: 'POST', body: JSON.stringify(payload) });
    expect(decided.status).toBe(200);
    const decidedBody = await decided.json();
    const reopened = await database.reopen();
    workspaceStore = createWorkspaceStore(reopened);
    disbursementStore = createDisbursementStore(reopened);
    contributionStore = createContributionStore(reopened);
    activityStore = createActivityStore(reopened);
    donorAccessStore = createDonorAccessStore(reopened, OTP_KEY);
    configureWorkspace({ store: workspaceStore, disbursement: disbursementStore, contributions: contributionStore,
      activities: activityStore, donorAccess: donorAccessStore, donorMessages: messageTransport, ethCall, now: () => clock,
      challengeTtlSeconds: 300, sessionTtlSeconds: 3600 });
    const publicResult = await getDonor(`/recovery-request/${requestId}`);
    expect((await publicResult.json()).request.status).toBe('APPROVED');
    const retry = await requestWorkspace(decisionPath, amilToken, { method: 'POST', body: JSON.stringify(payload) });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(decidedBody);
    const detail = await requestWorkspace(`/contributions/recovery-requests/${requestId}`, amilToken);
    const saved = (await detail.json()).request;
    expect(saved.contribution.currentContact).toBe('persisted@test.com');
    expect(saved.contribution.version).toBe(2);
    expect(saved.decidedByAccount).toBe(amilSinar.address.toLowerCase());
    const revokedSession = await getDonor('/contributions/c-rec-007', oldSession.sessionToken);
    expect(revokedSession.status).toBe(401);
    const revokedCode = await postDonor('/session', { challengeId: unspentChallenge.challengeId, otpCode: unspentCode });
    expect(revokedCode.status).toBe(400);
    expect(rowsOf(await reopened.execute(sql`SELECT * FROM contribution_history WHERE contribution_id = 'c-rec-007'`))).toHaveLength(1);

  });

  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)(
    "browser: donor and officer recover twice, reject safely, and navigate by keyboard on laptop and phone (AC30)",
    async () => {
      const bundles = await Promise.all(['verification-smoke', 'donor-recovery-officer-smoke'].map(async (name) => {
        const built = await Bun.build({
          entrypoints: [new URL(`../../frontend/test/${name}.tsx`, import.meta.url).pathname],
          target: "browser", define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "" }) },
        });
        if (!built.success) throw new Error(built.logs.join("\n"));
        return built.outputs[0]!.text();
      }));
      const cssProcess = Bun.spawn(['bun', 'test/build-smoke-css.ts'], {
        cwd: new URL('../../frontend', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe',
      });
      const css = await new Response(cssProcess.stdout).text();
      if (await cssProcess.exited !== 0) throw new Error(await new Response(cssProcess.stderr).text());
      const server = Bun.serve({
        hostname: "127.0.0.1", port: 0,
        fetch(req) {
          const path = new URL(req.url).pathname;
          if (path === '/' || path === '/officer') return new Response(
            `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/smoke.css"><div id="root"></div><script type="module" src="${path === '/officer' ? '/officer.js' : '/donor.js'}"></script>`,
            { headers: { 'Content-Type': 'text/html' } });
          if (path === '/smoke.css') return new Response(css, { headers: { 'Content-Type': 'text/css' } });
          if (path === '/donor.js' || path === '/officer.js') return new Response(bundles[path === '/donor.js' ? 0 : 1], { headers: { 'Content-Type': 'application/javascript' } });
          if (path === '/smoke-config') return Response.json({ token: amilToken });
          return app.fetch(req);
        },
      });
      const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
      try {
        browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox'] });
        for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
          const reference = `BCA-REC-SMOKE-${viewport.width}`;
          await database.handle().execute(sql`
            INSERT INTO contributions (id, institution_id, source_channel, source_reference, currency_unit,
              amount_exact, fund_type, purpose, received_at, donor_name, donor_contact, status, version, created_at, updated_at, created_by)
            VALUES (${reference}, ${SINAR}, 'BANK_TRANSFER', ${reference}, 'IDR', '1500000', 'ZAKAT_MAL', 'Zakat Maal',
              ${NOW - 5000}, 'Donatur Sintetis', 'wrong-contact@test.com', 'RECEIVED', 1, ${NOW - 5000}, ${NOW - 5000}, 'sys')
          `);
          const page = await browser.newPage({ viewport });
          const officer = await browser.newPage({ viewport });
          const errors: string[] = [];
          for (const tab of [page, officer]) {
            tab.setDefaultTimeout(10000);
            tab.on('pageerror', (error: Error) => errors.push(error.message));
            await tab.addInitScript((now: number) => { Date.now = () => now * 1000; }, NOW);
          }
          const openRecovery = async () => {
            const trigger = page.getByRole('button', { name: 'Ajukan Pemulihan Kontak & Akses', exact: true });
            await trigger.focus();
            await page.keyboard.press('Enter');
            await page.getByRole('dialog').waitFor();
          };
          const submitRequest = async (contact: string) => {
            await page.locator('#recovery-contact').fill(contact);
            await page.locator('#recovery-evidence').fill('abc');
            await page.getByRole('button', { name: 'Ajukan Pemulihan', exact: true }).click();
            await page.getByRole('alert').waitFor();
            await page.locator('#recovery-evidence').fill(`Bukti transfer sintetis untuk ${reference}`);
            await page.getByRole('button', { name: 'Ajukan Pemulihan', exact: true }).focus();
            await page.keyboard.press('Enter');
            await page.getByText('Permohonan Sedang Diperiksa', { exact: true }).waitFor();
          };
          const decide = async (decision: 'APPROVED' | 'REJECTED') => {
            await officer.goto(`${server.url}officer`);
            await officer.getByRole('button', { name: /Pemulihan Kontak \(/ }).click();
            const row = officer.getByRole('row').filter({ hasText: reference }).filter({ hasText: 'Menunggu' });
            await row.getByRole('button', { name: 'Periksa', exact: true }).focus();
            await officer.keyboard.press('Enter');
            const dialog = officer.getByRole('dialog');
            await dialog.waitFor();
            await officer.getByLabel(decision === 'APPROVED' ? 'Setujui Pemulihan Kontak' : 'Tolak Permohonan', { exact: true }).check();
            await officer.getByLabel(/Alasan Keputusan/).fill('abc');
            const action = officer.getByRole('button', { name: decision === 'APPROVED' ? 'Setujui & Perbarui Kontak' : 'Tolak Permohonan', exact: true });
            await action.click();
            await officer.getByRole('alert').waitFor();
            await officer.getByLabel(/Alasan Keputusan/).fill('Donatur Sintetis, nominal 1500000, kontak privat@example.test diperiksa.');
            const bounds = await dialog.boundingBox();
            expect(bounds!.width).toBeLessThanOrEqual(viewport.width);
            await action.focus();
            await officer.keyboard.press('Tab');
            expect(await dialog.evaluate((element: HTMLElement) => element.contains(document.activeElement))).toBe(true);
            await action.focus();
            await officer.keyboard.press('Enter');
            await dialog.waitFor({ state: 'hidden' });
          };
          await page.goto(`${server.url}?trxId=${reference}`);
          await openRecovery();
          const close = page.getByRole('button', { name: 'Tutup jendela pemulihan' });
          await close.focus();
          await page.keyboard.press('Shift+Tab');
          expect(await page.getByRole('dialog').evaluate((element: HTMLElement) => element.contains(document.activeElement))).toBe(true);
          await page.keyboard.press('Escape');
          await page.getByRole('dialog').waitFor({ state: 'hidden' });
          await page.waitForFunction(() => document.activeElement?.textContent?.includes('Ajukan Pemulihan Kontak & Akses'));
          await openRecovery();
          await submitRequest('first@example.test');
          await decide('REJECTED');
          await page.keyboard.press('Escape');
          await openRecovery();
          await page.getByText('Permohonan Sebelumnya Ditolak', { exact: true }).waitFor();
          expect(await page.getByRole('dialog').textContent()).not.toContain('privat@example.test');
          await page.getByRole('button', { name: 'Ajukan Pemulihan Baru' }).click();
          clock++;
          await submitRequest('first@example.test');
          await decide('APPROVED');
          await page.reload();
          await openRecovery();
          await page.getByText('Akses Telah Dipulihkan', { exact: true }).waitFor();
          await page.getByRole('button', { name: 'Ajukan Pemulihan Baru' }).focus();
          await page.keyboard.press('Enter');
          clock++;
          await submitRequest('second@example.test');
          await decide('APPROVED');
          await page.keyboard.press('Escape');
          outbox = [];
          await page.getByRole('button', { name: 'Kirim Kode OTP' }).click();
          await page.getByLabel(/Masukkan 6 digit kode/).waitFor();
          expect(outbox).toHaveLength(1);
          expect(outbox[0].to).toBe('second@example.test');
          await page.getByLabel(/Masukkan 6 digit kode/).fill(outbox[0].body.match(/\b(\d{6})\b/)![1]);
          await page.getByRole('button', { name: 'Verifikasi', exact: true }).click();
          await page.getByRole('heading', { name: 'Kontribusi Anda' }).waitFor();
          await page.getByText('Rp 1.500.000', { exact: true }).waitFor();
          expect(errors).toEqual([]);
          await page.close();
          await officer.close();
        }
      } finally {
        await browser?.close();
        server.stop(true);
      }
    }, 120000,
  );
});

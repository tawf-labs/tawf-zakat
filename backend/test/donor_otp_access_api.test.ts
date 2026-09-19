/**
 * Integration & Acceptance Tests for Accountless Donor Access via OTP (Spec #100, Ticket #104).
 *
 * Covers:
 * - US-38: Donors view their contribution and the activity it funds.
 * - US-39: Donors see pooled activity progress without other donors' identities.
 * - US-46: Minimal notification through available contact without private details.
 * - US-47: Open one contribution after OTP verification without compulsory registration.
 * - US-48: Bounded verified session allows navigation without a new code per page.
 * - US-49: Access confined to authorized contribution (shared contact does not reveal whole history).
 * - US-52: Public/aggregate views preserve recipient privacy (no photos, NIK, or private documents).
 * - US-53: Genuine institutional receipt while ZK publication is pending.
 * - US-54: Explicit proof pending / not available without manufactured success.
 * - US-91: Tested through authenticated application HTTP with real isolated storage.
 * - AC13: IDOR prevention, link forwarding protection, bounded single-contribution session.
 * - AC14: Replay protection, rate limiting, attempt limit, expiration.
 * - AC15: No private donor identity, amount, or recipient documents in unauthorized/public contexts.
 * - AC20: Truthful representation of proof status without fabricated proofs.
 * - AC29: Strict separation between donor session and operator workspace authority.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { createHash, createHmac } from "node:crypto";
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
import { isEmailAddress } from "../src/email-transport";

const BASE_DONOR = "http://localhost:3001/api/donor";
const BASE_WORKSPACE = "http://localhost:3001/api/workspace";

const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";

const adminSinar = privateKeyToAccount(`0x${"a1".repeat(32)}` as Hex);
const amilSinar = privateKeyToAccount(`0x${"b1".repeat(32)}` as Hex);
const approverSinar = privateKeyToAccount(`0x${"b2".repeat(32)}` as Hex);

const NOW = 1_800_000_000;
const OTP_KEY = Buffer.alloc(32, 7);

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

describe("Accountless Donor Access via OTP (Ticket #104)", () => {
  let amilToken: string;

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

  beforeEach(async () => {
    clock = NOW;
    outbox = [];
    await database.reset();

    // Re-configure with working message transport
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

    // Officers and memberships
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
             (${SINAR}, ${approverSinar.address.toLowerCase()}, 'OFFICER', 'off-sinar-approver', true)
    `);

    // Grant amil contribution mandate
    await db.execute(sql`
      INSERT INTO operational_mandates (
        id, institution_id, officer_id, account_address, function, scope_type,
        program_id, valid_from, valid_until, assignment_ref, nominal_limit, version, is_active, created_at, updated_at, created_by
      ) VALUES (
        'mandate-sinar-record', ${SINAR}, 'off-sinar-amil', ${amilSinar.address.toLowerCase()},
        'RECORD_CONTRIBUTIONS', 'ALL_PROGRAMS', null, ${NOW - 1000}, ${NOW + 100000}, 'SK-AMIL-01', null, 1, true, ${NOW}, ${NOW}, ${adminSinar.address.toLowerCase()}
      ), (
        'mandate-sinar-endorse', ${SINAR}, 'off-sinar-approver', ${approverSinar.address.toLowerCase()},
        'ENDORSE_CONTRIBUTIONS', 'ALL_PROGRAMS', null, ${NOW - 1000}, ${NOW + 100000}, 'SK-DIR-01', null, 1, true, ${NOW}, ${NOW}, ${adminSinar.address.toLowerCase()}
      )
    `);

    amilToken = await signInWorkspace(amilSinar, SINAR);
  });

  afterAll(async () => {
    resetWorkspace();
    await database.close();
  });

  async function createFixtureContribution(overrides: Partial<{
    donorName: string | null;
    donorContact: string | null;
    amountExact: string;
    sourceReference: string;
  }> = {}) {
    const res = await app.fetch(
      new Request(`${BASE_WORKSPACE}/contributions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${amilToken}`,
        },
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          sourceChannel: "BANK_TRANSFER",
          sourceReference: overrides.sourceReference ?? `BCA-${crypto.randomUUID().slice(0, 8)}`,
          currencyUnit: "IDR",
          amountExact: overrides.amountExact ?? "1000000",
          fundType: "ZAKAT",
          purpose: "Bantuan Mustahik Pendidikan",
          receivedAt: NOW - 3600,
          donorName: overrides.donorName !== undefined ? overrides.donorName : "Hamba Allah",
          donorContact: overrides.donorContact !== undefined ? overrides.donorContact : "081234567890",
        }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    return body.contribution;
  }

  async function openSession(reference: string): Promise<string> {
    const challenge = await (await postDonor("/otp-challenge", { reference })).json();
    const code = outbox.at(-1)?.body.match(/\b(\d{6})\b/)?.[1]!;
    const verified = await (await postDonor("/session", { challengeId: challenge.challengeId, otpCode: code })).json();
    return verified.sessionToken;
  }

  async function createApprovedProposalAndActivity(targetAmount = "5000000") {
    const db = database.handle();
    const progId = `prog-${crypto.randomUUID().slice(0, 8)}`;
    const propId = `prop-${crypto.randomUUID().slice(0, 8)}`;
    const actId = `act-${crypto.randomUUID().slice(0, 8)}`;

    await db.execute(sql`
      INSERT INTO programs (id, institution_id, name, purpose, fund_type, scope, status, created_by, created_at, updated_at)
      VALUES (${progId}, ${SINAR}, 'Program Beasiswa Dhuafa', 'Bantuan biaya sekolah', 'ZAKAT', 'REGIONAL', 'ACTIVE', 'off-amil', ${NOW}, ${NOW})
    `);

    await db.execute(sql`
      INSERT INTO proposal_drafts (id, institution_id, program_id, created_by, origin_of_request, purpose, person_in_charge, status, version, created_at, updated_at)
      VALUES (${propId}, ${SINAR}, ${progId}, 'off-amil', 'Permohonan Resmi', 'Penyaluran Beasiswa', 'Ahmad Amil', 'APPROVED', 1, ${NOW}, ${NOW})
    `);

    await db.execute(sql`
      INSERT INTO proposal_versions (proposal_id, version, institution_id, status, data_json, created_at)
      VALUES (${propId}, 1, ${SINAR}, 'APPROVED', '{}', ${NOW})
    `);

    await db.execute(sql`
      INSERT INTO distribution_activities (
        id, institution_id, proposal_id, proposal_version, program_id, program_fund_type,
        name, description, target_amount, target_is_partial, currency_unit, status, version, created_at, updated_at, created_by
      ) VALUES (
        ${actId}, ${SINAR}, ${propId}, 1, ${progId}, 'ZAKAT',
        'Kegiatan Penyerahan Beasiswa Pelajar', 'Bantuan semester genap', ${targetAmount}, false, 'IDR', 'ACTIVE', 1, ${NOW}, ${NOW}, 'off-amil'
      )
    `);

    return { propId, actId };
  }

  it("delivers a minimal OTP notification to fixture transport without private details (US-46, AC14)", async () => {
    const contrib = await createFixtureContribution({
      donorName: "Fulan bin Fulan",
      donorContact: "081234567890",
      amountExact: "1500000",
    });

    const res = await postDonor("/otp-challenge", { reference: contrib.id });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.challengeId).toMatch(/^d-otp-/);
    expect(body.expiresAt).toBe(NOW + 900);
    expect(body.resendAvailableAt).toBe(NOW + 60);
    // A reference alone reveals neither the contribution ID nor the contact.
    expect(JSON.stringify(body)).not.toContain(contrib.id);
    expect(body.contactMasked).toBeUndefined();
    // Plaintext OTP code must NEVER be returned in response
    expect(body.code).toBeUndefined();
    expect(body.otpCode).toBeUndefined();

    // Verify fixture outbox received minimal message
    expect(outbox).toHaveLength(1);
    const sent = outbox[0];
    expect(sent.to).toBe("081234567890");
    expect(sent.body).toMatch(/Kode verifikasi akses kontribusi Anda: \d{6}\. Berlaku selama 15 menit/);

    // CRITICAL (US-46): Must NOT contain private details
    expect(sent.body).not.toContain("Fulan bin Fulan");
    expect(sent.body).not.toContain("1500000");
    expect(sent.body).not.toContain("1.500.000");
    expect(sent.body).not.toContain(contrib.id);
  });

  it("answers 503 when message transport is unconfigured, without fabricating delivery (AC14)", async () => {
    // Configure workspace with NO message transport
    configureWorkspace({
      store: workspaceStore,
      disbursement: disbursementStore,
      contributions: contributionStore,
      activities: activityStore,
      donorAccess: donorAccessStore,
      donorMessages: undefined,
      ethCall,
      now: () => clock,
      challengeTtlSeconds: 300,
      sessionTtlSeconds: 3600,
    });

    const contrib = await createFixtureContribution();
    const res = await postDonor("/otp-challenge", { reference: contrib.id });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Layanan pengiriman OTP belum tersedia");
  });

  it("refuses to issue OTP for contribution with missing or empty contact (US-51)", async () => {
    const contrib = await createFixtureContribution({ donorContact: null });
    const res = await postDonor("/otp-challenge", { reference: contrib.id });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("tidak memiliki kontak terdaftar");
  });

  it("enforces cooldown rate-limiting between OTP requests (AC14)", async () => {
    const contrib = await createFixtureContribution();
    const first = await postDonor("/otp-challenge", { reference: contrib.id });
    expect(first.status).toBe(201);

    // Immediate second request
    const second = await postDonor("/otp-challenge", { reference: contrib.id });
    expect(second.status).toBe(429);
    const body = await second.json();
    expect(body.error).toContain("Harap tunggu 60 detik");

    // Advance clock by 61 seconds
    clock += 61;
    const third = await postDonor("/otp-challenge", { reference: contrib.id });
    expect(third.status).toBe(201);
  });

  it("rejects wrong OTP code with remaining attempts, and invalidates after 5 wrong attempts (AC14)", async () => {
    const contrib = await createFixtureContribution();
    const challengeRes = await postDonor("/otp-challenge", { reference: contrib.id });
    const { challengeId } = await challengeRes.json();

    // 1st wrong attempt
    const r1 = await postDonor("/session", { challengeId, otpCode: "000000" });
    expect(r1.status).toBe(401);
    expect((await r1.json()).remainingAttempts).toBe(4);

    // 2nd, 3rd, 4th wrong attempts
    for (let i = 0; i < 3; i++) {
      const res = await postDonor("/session", { challengeId, otpCode: "000000" });
      expect(res.status).toBe(401);
    }

    // 5th wrong attempt -> exhausts max attempts
    const r5 = await postDonor("/session", { challengeId, otpCode: "000000" });
    expect(r5.status).toBe(401);
    const b5 = await r5.json();
    expect(b5.remainingAttempts).toBe(0);
    expect(b5.error).toContain("Batas percobaan habis");

    // 6th attempt -> challenge is consumed/spent
    const r6 = await postDonor("/session", { challengeId, otpCode: "000000" });
    expect(r6.status).toBe(400);
    expect((await r6.json()).error).toContain("sudah pernah digunakan atau kedaluwarsa");
  });

  it("rejects expired OTP challenge after 15 minutes TTL (AC14)", async () => {
    const contrib = await createFixtureContribution();
    const challengeRes = await postDonor("/otp-challenge", { reference: contrib.id });
    const { challengeId } = await challengeRes.json();

    const deliveredCode = outbox[0].body.match(/\b(\d{6})\b/)?.[1]!;
    expect(deliveredCode).toBeDefined();

    // Advance clock past 900s TTL
    clock += 901;

    const verifyRes = await postDonor("/session", { challengeId, otpCode: deliveredCode });
    expect(verifyRes.status).toBe(400);
    expect((await verifyRes.json()).error).toContain("kedaluwarsa");
  });

  it("verifies valid OTP, issues bounded session token, and prevents replay (US-47, US-48, AC14)", async () => {
    const contrib = await createFixtureContribution();
    const challengeRes = await postDonor("/otp-challenge", { reference: contrib.id });
    const { challengeId } = await challengeRes.json();

    const code = outbox[0].body.match(/\b(\d{6})\b/)?.[1]!;
    expect(code).toBeDefined();

    const verifyRes = await postDonor("/session", { challengeId, otpCode: code });
    expect(verifyRes.status).toBe(201);
    const { sessionToken, expiresAt, contributionId } = await verifyRes.json();

    expect(sessionToken).toMatch(/^dsess_/);
    expect(contributionId).toBe(contrib.id);
    expect(expiresAt).toBe(NOW + 3600);

    // Replay attack prevention: Attempting to verify the same challenge again fails
    const replayRes = await postDonor("/session", { challengeId, otpCode: code });
    expect(replayRes.status).toBe(400);
    expect((await replayRes.json()).error).toContain("sudah pernah digunakan");
  });

  it("allows navigation with session token without asking OTP on every page, and expires after 1 hour (US-48, AC14)", async () => {
    const contrib = await createFixtureContribution();
    const sessionToken = await openSession(contrib.id);

    // Call contribution details
    const getRes1 = await getDonor(`/contributions/${contrib.id}`, sessionToken);
    expect(getRes1.status).toBe(200);
    const data1 = await getRes1.json();
    expect(data1.contribution.id).toBe(contrib.id);

    // Call allocations endpoint with the same token without re-entering OTP
    const getRes2 = await getDonor(`/contributions/${contrib.id}/allocations`, sessionToken);
    expect(getRes2.status).toBe(200);

    // Advance clock past session TTL (3600s)
    clock += 3601;

    const expiredRes = await getDonor(`/contributions/${contrib.id}`, sessionToken);
    expect(expiredRes.status).toBe(401);
    expect((await expiredRes.json()).error).toContain("kedaluwarsa");
  });

  it("enforces object authorization and blocks IDOR attacks (AC13)", async () => {
    const contribA = await createFixtureContribution({ sourceReference: "REF-CONTRIB-A", donorName: "Donatur A" });
    const contribB = await createFixtureContribution({ sourceReference: "REF-CONTRIB-B", donorName: "Donatur B" });

    // Obtain verified session for Contribution A
    const chalRes = await postDonor("/otp-challenge", { reference: contribA.id });
    const { challengeId } = await chalRes.json();
    const code = outbox[0].body.match(/\b(\d{6})\b/)?.[1]!;
    const { sessionToken } = await (await postDonor("/session", { challengeId, otpCode: code })).json();

    // Legitimate access to Contribution A succeeds
    const legit = await getDonor(`/contributions/${contribA.id}`, sessionToken);
    expect(legit.status).toBe(200);
    expect((await legit.json()).contribution.id).toBe(contribA.id);

    // IDOR Attack: Swapping ID to Contribution B MUST BE FORBIDDEN (403)
    const idorContrib = await getDonor(`/contributions/${contribB.id}`, sessionToken);
    expect(idorContrib.status).toBe(403);
    const idorBody = await idorContrib.json();
    expect(idorBody.success).toBe(false);
    expect(idorBody.error).toContain("Akses ditolak: sesi ini hanya berlaku untuk kontribusi yang diotorisasi");

    // IDOR Attack on allocations endpoint
    const idorAlloc = await getDonor(`/contributions/${contribB.id}/allocations`, sessionToken);
    expect(idorAlloc.status).toBe(403);
  });

  it("keeps shared contacts strictly isolated per contribution (US-49, AC13)", async () => {
    // Two donations sharing the exact same phone number
    const SHARED_PHONE = "081299998888";
    const contrib1 = await createFixtureContribution({
      sourceReference: "ZKT-FAM-01",
      donorName: "Ayah",
      donorContact: SHARED_PHONE,
      amountExact: "2000000",
    });
    const contrib2 = await createFixtureContribution({
      sourceReference: "ZKT-FAM-02",
      donorName: "Ibu",
      donorContact: SHARED_PHONE,
      amountExact: "1000000",
    });

    // Request and verify OTP for Contrib 1 only
    const chalRes = await postDonor("/otp-challenge", { reference: contrib1.id });
    const { challengeId } = await chalRes.json();
    const code = outbox.at(-1)?.body.match(/\b(\d{6})\b/)?.[1]!;
    const { sessionToken } = await (await postDonor("/session", { challengeId, otpCode: code })).json();

    // Session 1 can read Contrib 1
    const res1 = await getDonor(`/contributions/${contrib1.id}`, sessionToken);
    expect(res1.status).toBe(200);
    const data1 = (await res1.json()).contribution;
    expect(data1.amountExact).toBe("2000000");
    expect(data1.donorName).toBe("Ayah");

    // Session 1 CANNOT read Contrib 2, even though contact is the same
    const res2 = await getDonor(`/contributions/${contrib2.id}`, sessionToken);
    expect(res2.status).toBe(403);
  });

  it("displays honest proof status and pooled activity progress without exposing other donors or recipient privacy (US-38, US-39, US-54, AC15, AC20)", async () => {
    const { propId, actId } = await createApprovedProposalAndActivity("10000000");

    // Two donors fund the same activity
    const contrib1 = await createFixtureContribution({ donorName: "Donatur Satu", amountExact: "3000000" });
    const contrib2 = await createFixtureContribution({ donorName: "Donatur Dua", amountExact: "2000000" });

    // Endorse contributions so they can be allocated
    const db = database.handle();
    await db.execute(sql`
      UPDATE contributions
      SET status = 'ENDORSED', reconciled_at = ${NOW}, endorsed_at = ${NOW}
      WHERE id IN (${contrib1.id}, ${contrib2.id})
    `);

    // Allocate both contributions to the activity
    await db.execute(sql`
      INSERT INTO contribution_allocations (
        id, institution_id, contribution_id, activity_id, currency_unit, amount_exact,
        fund_type, purpose, reason, status, allocated_at, allocated_by, contribution_version, version, created_at, updated_at
      ) VALUES
        ('alloc-1', ${SINAR}, ${contrib1.id}, ${actId}, 'IDR', '3000000', 'ZAKAT', 'Bantuan Pelajar', 'Alokasi batch 1', 'ACTIVE', ${NOW}, 'off-amil', 1, 1, ${NOW}, ${NOW}),
        ('alloc-2', ${SINAR}, ${contrib2.id}, ${actId}, 'IDR', '2000000', 'ZAKAT', 'Bantuan Pelajar', 'Alokasi batch 1', 'ACTIVE', ${NOW}, 'off-amil', 1, 1, ${NOW}, ${NOW})
    `);

    // Authenticate Donor 1
    const chalRes = await postDonor("/otp-challenge", { reference: contrib1.id });
    const { challengeId } = await chalRes.json();
    const code = outbox.at(-1)?.body.match(/\b(\d{6})\b/)?.[1]!;
    const { sessionToken } = await (await postDonor("/session", { challengeId, otpCode: code })).json();

    // Check contribution detail
    const detailRes = await getDonor(`/contributions/${contrib1.id}`, sessionToken);
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()).contribution;
    expect(detail.amountExact).toBe("3000000");
    expect(detail.donorName).toBe("Donatur Satu");
    // Honest proof status (US-54, AC20)
    expect(detail.zkProof.status).toBe("NOT_AVAILABLE");

    // Check allocations & pooled progress (US-38, US-39, AC15)
    const allocRes = await getDonor(`/contributions/${contrib1.id}/allocations`, sessionToken);
    expect(allocRes.status).toBe(200);
    const { allocations } = await allocRes.json();
    expect(allocations).toHaveLength(1);

    const alloc = allocations[0];
    expect(alloc.amountExact).toBe("3000000");
    expect(alloc.activity.name).toBe("Kegiatan Penyerahan Beasiswa Pelajar");
    expect(alloc.activity.targetAmount).toBe("10000000");

    // Pooled totals: total allocated is 3.000.000 + 2.000.000 = 5.000.000 across 2 donors
    expect(alloc.activity.pooled.totalAllocatedAmount).toBe("5000000");
    expect(alloc.activity.pooled.allocationCount).toBe(2);

    // CRITICAL (US-39, AC15): Must NOT leak Donatur Dua's identity or individual amount in response!
    const jsonString = JSON.stringify(allocations);
    expect(jsonString).not.toContain("Donatur Dua");
    expect(jsonString).not.toContain("alloc-2");
  });

  it("revokes session on logout and clears access (AC29)", async () => {
    const contrib = await createFixtureContribution();
    const chalRes = await postDonor("/otp-challenge", { reference: contrib.id });
    const { challengeId } = await chalRes.json();
    const code = outbox.at(-1)?.body.match(/\b(\d{6})\b/)?.[1]!;
    const { sessionToken } = await (await postDonor("/session", { challengeId, otpCode: code })).json();

    // Valid before logout
    expect((await getDonor(`/contributions/${contrib.id}`, sessionToken)).status).toBe(200);

    // Logout
    const logoutRes = await requestDonor("/session", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    expect(logoutRes.status).toBe(200);

    // Subsequent access is refused
    const afterLogout = await getDonor(`/contributions/${contrib.id}`, sessionToken);
    expect(afterLogout.status).toBe(401);
  });

  it("strictly isolates donor session from operator workspace authority (AC29)", async () => {
    const contrib = await createFixtureContribution();
    const chalRes = await postDonor("/otp-challenge", { reference: contrib.id });
    const { challengeId } = await chalRes.json();
    const code = outbox.at(-1)?.body.match(/\b(\d{6})\b/)?.[1]!;
    const { sessionToken } = await (await postDonor("/session", { challengeId, otpCode: code })).json();

    // Trying to use donor session token on workspace operator endpoint must be refused
    const workspaceCall = await app.fetch(
      new Request(`${BASE_WORKSPACE}/contributions`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      })
    );
    expect(workspaceCall.status).toBe(401);
  });

  it("resolves a receipt's source reference to its contribution, and refuses an ambiguous one", async () => {
    const contrib = await createFixtureContribution({ sourceReference: "BCA-SHARED-REF" });
    const byRef = await postDonor("/otp-challenge", { reference: "BCA-SHARED-REF" });
    expect(byRef.status).toBe(201);

    const db = database.handle();
    await db.execute(sql`
      INSERT INTO contributions (
        id, institution_id, source_channel, source_reference, currency_unit, amount_exact, fund_type,
        purpose, received_at, donor_name, donor_contact, status, version, created_at, updated_at, created_by
      )
      SELECT 'contrib-baitul-dup', ${BAITUL}, source_channel, source_reference, currency_unit, amount_exact, fund_type,
             purpose, received_at, NULL, '089900001111', status, 1, created_at, updated_at, created_by
      FROM contributions WHERE id = ${contrib.id}
    `);
    clock += 61;
    const ambiguous = await postDonor("/otp-challenge", { reference: "BCA-SHARED-REF" });
    expect(ambiguous.status).toBe(404);
    expect((await ambiguous.json()).error).toContain("lebih dari satu kontribusi");
    // The ID on the institution's receipt still works.
    expect((await postDonor("/otp-challenge", { reference: contrib.id })).status).toBe(201);
  });

  it("caps codes per contribution per hour, so guesses and code replacement are bounded (AC14)", async () => {
    const contrib = await createFixtureContribution();
    for (let i = 0; i < 5; i++) {
      expect((await postDonor("/otp-challenge", { reference: contrib.id })).status).toBe(201);
      clock += 61;
    }
    const capped = await postDonor("/otp-challenge", { reference: contrib.id });
    expect(capped.status).toBe(429);
    const body = await capped.json();
    expect(body.error).toContain("Batas 5 kode per 60 menit");
    expect(body.retryAt).toBe(NOW + 3600);
    expect(outbox).toHaveLength(5);

    clock = NOW + 3601;
    expect((await postDonor("/otp-challenge", { reference: contrib.id })).status).toBe(201);
  });

  it("counts concurrent code requests one at a time, so both cannot pass the cooldown (AC14)", async () => {
    const contrib = await createFixtureContribution();
    const statuses = (
      await Promise.all([
        postDonor("/otp-challenge", { reference: contrib.id }),
        postDonor("/otp-challenge", { reference: contrib.id }),
      ])
    ).map((res) => res.status).sort();
    expect(statuses).toEqual([201, 429]);
    expect(outbox).toHaveLength(1);
  });

  it("stores codes as a keyed hash that the table alone cannot reverse", async () => {
    const contrib = await createFixtureContribution();
    const { challengeId } = await (await postDonor("/otp-challenge", { reference: contrib.id })).json();
    const code = outbox[0].body.match(/\b(\d{6})\b/)?.[1]!;
    const [row] = rowsOf(
      await database.handle().execute(sql`SELECT code_hash FROM donor_otp_challenges WHERE id = ${challengeId}`)
    );
    expect(row.code_hash).toBe(createHmac("sha256", OTP_KEY).update(`${challengeId}:${code}`).digest("hex"));
    expect(row.code_hash).not.toBe(createHash("sha256").update(`${challengeId}:${code}`).digest("hex"));
  });

  it("says whether a delivery channel exists, and marks private answers uncacheable", async () => {
    const channel = await getDonor("/channel");
    expect(await channel.json()).toEqual({ success: true, available: true });

    const contrib = await createFixtureContribution();
    const sessionToken = await openSession(contrib.id);
    const detail = await getDonor(`/contributions/${contrib.id}`, sessionToken);
    expect(detail.headers.get("Cache-Control")).toBe("private, no-store");
    expect(detail.headers.get("Vary")).toContain("Authorization");

    configureWorkspace({
      store: workspaceStore,
      contributions: contributionStore,
      donorAccess: donorAccessStore,
      ethCall,
      now: () => clock,
      challengeTtlSeconds: 300,
      sessionTtlSeconds: 3600,
    });
    expect(await (await getDonor("/channel")).json()).toEqual({ success: true, available: false });
  });

  it("shows only reference and honest state publicly, REJECTED included, with no ID or contact (US-52, AC15, AC20)", async () => {
    const contrib = await createFixtureContribution({ sourceReference: "BCA-PUBLIC-01", donorName: "Fulanah" });
    const lookup = async () =>
      (await app.fetch(new Request("http://localhost:3001/api/public/contributions/BCA-PUBLIC-01"))).json();

    const found = await lookup();
    expect(found.lookupStatus).toBe("FOUND");
    expect(found.contribution.recordKind).toBe("INSTITUTION_CONTRIBUTION");
    expect(found.contribution.status).toBe("RECEIVED");
    const text = JSON.stringify(found);
    for (const secret of [contrib.id, SINAR, "Fulanah", "1000000", "0812", "7890"]) {
      expect(text).not.toContain(secret);
    }

    await database.handle().execute(sql`UPDATE contributions SET status = 'REJECTED' WHERE id = ${contrib.id}`);
    const rejected = await lookup();
    expect(rejected.contribution.status).toBe("REJECTED");
    expect(rejected.contribution.paidAt).toBeNull();
  });

  it("with an email-only channel, refuses a phone contact honestly and sends to an email contact (US-46)", async () => {
    const emailOnly: RecipientMessageTransport = { ...messageTransport, canDeliver: isEmailAddress };
    configureWorkspace({
      store: workspaceStore,
      contributions: contributionStore,
      donorAccess: donorAccessStore,
      donorMessages: emailOnly,
      ethCall,
      now: () => clock,
      challengeTtlSeconds: 300,
      sessionTtlSeconds: 3600,
    });

    const phoneOnly = await createFixtureContribution({ donorContact: "081234567890" });
    const refused = await postDonor("/otp-challenge", { reference: phoneOnly.id });
    expect(refused.status).toBe(422);
    expect((await refused.json()).error).toContain("hanya melalui email");
    expect(outbox).toHaveLength(0);

    const withEmail = await createFixtureContribution({ donorContact: "donatur@example.org" });
    expect((await postDonor("/otp-challenge", { reference: withEmail.id })).status).toBe(201);
    expect(outbox[0].to).toBe("donatur@example.org");
  });

  it("voids a code whose delivery failed and says so, without a fake success", async () => {
    configureWorkspace({
      store: workspaceStore,
      contributions: contributionStore,
      donorAccess: donorAccessStore,
      donorMessages: { async send() { throw new Error("provider down"); } },
      ethCall,
      now: () => clock,
      challengeTtlSeconds: 300,
      sessionTtlSeconds: 3600,
    });
    const contrib = await createFixtureContribution();
    const res = await postDonor("/otp-challenge", { reference: contrib.id });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("belum dapat dikirim");
    const live = rowsOf(
      await database.handle().execute(
        sql`SELECT id FROM donor_otp_challenges WHERE contribution_id = ${contrib.id} AND consumed_at IS NULL`
      )
    );
    expect(live).toHaveLength(0);
  });

  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)(
    "browser: fixture code opens one contribution without signup, survives navigation, and closes on expiry and logout (AC30)",
    async () => {
      const { actId } = await createApprovedProposalAndActivity("4000000");
      const contrib = await createFixtureContribution({ sourceReference: "BCA-SMOKE-104", amountExact: "1250000" });
      await database.handle().execute(sql`
        UPDATE contributions SET status = 'ENDORSED', reconciled_at = ${NOW}, endorsed_at = ${NOW} WHERE id = ${contrib.id}
      `);
      await database.handle().execute(sql`
        INSERT INTO contribution_allocations (
          id, institution_id, contribution_id, activity_id, currency_unit, amount_exact,
          fund_type, purpose, reason, status, allocated_at, allocated_by, contribution_version, version, created_at, updated_at
        ) VALUES ('alloc-smoke', ${SINAR}, ${contrib.id}, ${actId}, 'IDR', '1000000', 'ZAKAT', 'Bantuan Pelajar',
                  'Alokasi semester genap', 'ACTIVE', ${NOW}, 'off-amil', 1, 1, ${NOW}, ${NOW})
      `);

      const built = await Bun.build({
        entrypoints: [new URL("../../frontend/test/verification-smoke.tsx", import.meta.url).pathname],
        target: "browser",
        define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "" }) },
      });
      if (!built.success) throw new Error(built.logs.join("\n"));
      const bundle = await built.outputs[0]!.text();
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(req) {
          const path = new URL(req.url).pathname;
          if (path === "/") return new Response('<!doctype html><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
          if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
          return app.fetch(req);
        },
      });
      const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
      try {
        browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
        const page = await browser.newPage();
        page.setDefaultTimeout(10000);
        const pageErrors: string[] = [];
        page.on("pageerror", (error: Error) => pageErrors.push(error.message));
        const requestedUrls: string[] = [];
        page.on("request", (request: any) => requestedUrls.push(request.url()));

        const signIn = async () => {
          await page.getByRole("button", { name: "Kirim Kode OTP" }).click();
          await page.getByLabel(/Masukkan 6 digit kode/).waitFor();
          const code = outbox.at(-1)!.body.match(/\b(\d{6})\b/)![1];
          await page.getByLabel(/Masukkan 6 digit kode/).fill(code);
          await page.getByRole("button", { name: "Verifikasi" }).click();
          await page.getByRole("heading", { name: "Kontribusi Anda" }).waitFor();
          return code;
        };

        await page.goto(`${server.url}?trxId=BCA-SMOKE-104`);
        await page.getByRole("heading", { name: "Catatan Kontribusi" }).waitFor();
        // Before the code, nothing private is on the page.
        expect(await page.getByText("Rp 1.250.000").count()).toBe(0);

        const code = await signIn();
        await page.getByText("Rp 1.250.000").waitFor();
        await page.getByRole("heading", { name: "Kegiatan Penyerahan Beasiswa Pelajar" }).waitFor();
        await page.getByText(/Rp 1\.000\.000 \/ Rp 4\.000\.000 \(25%\)/).waitFor();
        // Neither the code nor the token ever appears in a URL.
        expect(requestedUrls.some((url) => url.includes(code) || url.includes("dsess_"))).toBe(false);

        // Navigation within the session needs no new code.
        await page.reload();
        await page.getByText("Rp 1.250.000").waitFor();

        // Expiry: the server refuses the session; private detail leaves the page.
        clock += 3601;
        await page.reload();
        await page.getByText(/kedaluwarsa/).waitFor();
        await page.getByRole("button", { name: "Kirim Kode OTP" }).waitFor();
        expect(await page.getByText("Rp 1.250.000").count()).toBe(0);

        // Logout revokes the session and forgets it.
        clock += 61;
        await signIn();
        await page.getByRole("button", { name: "Tutup Sesi" }).click();
        await page.getByRole("button", { name: "Kirim Kode OTP" }).waitFor();
        expect(await page.getByText("Rp 1.250.000").count()).toBe(0);
        await page.reload();
        await page.getByRole("button", { name: "Kirim Kode OTP" }).waitFor();
        expect(await page.getByText("Rp 1.250.000").count()).toBe(0);

        expect(pageErrors).toEqual([]);
      } finally {
        await browser?.close();
        server.stop(true);
      }
    },
    60000
  );
});

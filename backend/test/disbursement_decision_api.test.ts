/**
 * Integration tests for Keputusan lembaga dan pengesahan pencatatan pengajuan
 * (Spec #86, ticket #93).
 *
 * Covers review data (examination result, operator, reference ceiling, quorum
 * statement); mandate scope and nominal limits against the approved amount;
 * separation of duties; real EOA and ERC-1271 signatures, with an unreachable
 * RPC reported as pending; signed rights that cannot be altered afterwards;
 * expiry, replay, revoked mandates and stale versions; identical retries and
 * conflicting payloads; the SOP quorum hold; restart durability; and the
 * hand-off to distribution activities (#103).
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
import { ERC1271_MAGIC_VALUE, type EthCall } from "../src/account-signature";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { sql } from "drizzle-orm";
import { recoverDecidedAidLines } from "../src/proposal-decision-lines";

const BASE = "http://localhost:3001/api/workspace";

const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";

const adminSinar = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
const amilSinar = privateKeyToAccount(`0x${"22".repeat(32)}` as Hex);
const examinerSinar = privateKeyToAccount(`0x${"33".repeat(32)}` as Hex);
const approverSinar = privateKeyToAccount(`0x${"44".repeat(32)}` as Hex);
const secondaryApproverAccount = privateKeyToAccount(`0x${"77".repeat(32)}` as Hex);

const adminBaitul = privateKeyToAccount(`0x${"66".repeat(32)}` as Hex);
const amilBaitul = privateKeyToAccount(`0x${"55".repeat(32)}` as Hex);

const contractSigner = privateKeyToAccount(`0x${"88".repeat(32)}` as Hex);
const CONTRACT_ACCOUNT = "0x00000000000000000000000000000000000c0de5" as const;

const NOW = 1_800_000_000;
const FILE_KEY = Buffer.alloc(32, 42);

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let disbursement: DisbursementStore;
let activities: ActivityStore;
let files: PrivateFileStore;
let tempDir: string;
let clock = NOW;

let ethCallBehavior: "magic" | "revert" | "error" = "magic";

const ethCall: EthCall = async ({ to }) => {
  if (ethCallBehavior === "error") throw new Error("RPC node unreachable");
  if (ethCallBehavior === "revert") return "0x";
  if (to.toLowerCase() !== CONTRACT_ACCOUNT.toLowerCase()) return "0x";
  return `${ERC1271_MAGIC_VALUE}${"0".repeat(56)}`;
};

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
      issuedAt: BigInt(typedData.message.issuedAt),
      expiresAt: BigInt(typedData.message.expiresAt),
    },
  });
  const session = await post("/session", { nonce: challenge.nonce, signature });
  expect(session.status).toBe(201);
  return (await session.json()).token;
}

const documentInput = (category = "PROPOSAL_LETTER") => ({
  category,
  fileName: "dokumen-keputusan.txt",
  mimeType: "text/plain",
  beneficiaryId: category === "BENEFICIARY_IDENTITY" ? "ben-fixture" : null,
  contentBase64: Buffer.from("Bukti kelayakan keputusan").toString("base64"),
});

async function prepareReadyProposal(options?: {
  amount?: string;
  programId?: string;
  purpose?: string;
  creatorToken?: string;
  examinerToken?: string;
}) {
  const amilToken = options?.creatorToken ?? (await signIn(amilSinar, SINAR));
  const examinerToken = options?.examinerToken ?? (await signIn(examinerSinar, SINAR));
  const adminToken = await signIn(adminSinar, SINAR);

  let programId = options?.programId;
  if (!programId) {
    const progRes = await post(
      "/programs",
      {
        name: "Program Penyaluran Sembako",
        purpose: "Bantuan mustahik",
        fundType: "ZAKAT",
        scope: "Kecamatan Amanah",
        referenceCeiling: "50000000",
      },
      adminToken
    );
    expect(progRes.status).toBe(201);
    programId = (await progRes.json()).program.id;
  }

  const propRes = await post(
    "/proposals",
    {
      expectedVersion: 0,
      operationId: crypto.randomUUID(),
      programId,
      originOfRequest: "Permohonan mustahik",
      purpose: options?.purpose ?? "Penyaluran sembako dhuafa",
      personInCharge: "Ahmad Amil",
      aidPeriod: { start: "2026-03-01", end: "2026-03-31" },
      beneficiaries: [
        {
          id: "ben-fixture",
          name: "Mustahik Satu",
          asnaf: "Fakir",
          identityBasis: { kind: "NIK", value: "3201123456789012" },
          addressOrScope: "Kp. Berkah",
          guardian: null,
          paymentRecipient: null,
        },
      ],
      aidLines: [
        {
          id: "aid-fixture",
          beneficiaryId: "ben-fixture",
          aidType: "Bantuan Uang",
          period: "2026-03",
          value: { kind: "MONEY", amountRequestedIdr: options?.amount ?? "500000" },
        },
      ],
    },
    amilToken
  );
  expect(propRes.status).toBe(201);
  const draft = (await propRes.json()).draft;

  // Upload required documents
  for (const cat of ["PROPOSAL_LETTER", "BENEFICIARY_IDENTITY"]) {
    expect((await post(`/proposals/${draft.id}/documents`, documentInput(cat), amilToken)).status).toBe(201);
  }

  // Submit
  const submitRes = await post(
    `/proposals/${draft.id}/submit`,
    { expectedVersion: draft.version, operationId: crypto.randomUUID() },
    amilToken
  );
  expect(submitRes.status).toBe(200);
  const submitted = (await submitRes.json()).draft;

  // Start examination
  const startRes = await post(
    `/proposals/${draft.id}/start-examination`,
    { expectedVersion: submitted.version, operationId: crypto.randomUUID() },
    examinerToken
  );
  expect(startRes.status).toBe(200);

  // Mark ready
  const readyRes = await post(
    `/proposals/${draft.id}/ready`,
    {
      expectedVersion: submitted.version,
      operationId: crypto.randomUUID(),
      checklist: {
        administrativeChecksOk: true,
        eligibilityChecksOk: true,
        alternativeIdReviewed: true,
        recurringAidExceptions: [],
        notes: "Semua syarat administrasi & kelayakan terpenuhi.",
      },
    },
    examinerToken
  );
  expect(readyRes.status).toBe(200);
  const readyDraft = (await readyRes.json()).draft;
  expect(readyDraft.status).toBe("READY_FOR_DECISION");

  return { draft: readyDraft, programId: programId! };
}

describe("Keputusan lembaga dan pengesahan pencatatan pengajuan (Ticket #93)", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "disbursement-decision-test-"));
    files = createEncryptedFileStore({ directory: tempDir, key: FILE_KEY });
    database = await createTestWorkspaceDatabase(process.env.DECISION_TEST_DATABASE_URL);
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
    clock = NOW;
    ethCallBehavior = "magic";
    await database.reset();

    configureWorkspace({
      store,
      disbursement,
      activities,
      files,
      ethCall,
      now: () => clock,
      sessionTtlSeconds: 3600,
      challengeTtlSeconds: 300,
    });

    for (const inst of SYNTHETIC_INSTITUTIONS) {
      await store.upsertInstitution(institutionRecordOf(inst));
    }

    // Memberships
    await store.upsertMembership({ institutionId: SINAR, account: adminSinar.address, role: "ADMIN" });
    await store.upsertMembership({ institutionId: SINAR, account: amilSinar.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: SINAR, account: examinerSinar.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: SINAR, account: approverSinar.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: SINAR, account: secondaryApproverAccount.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: BAITUL, account: adminBaitul.address, role: "ADMIN" });
    await store.upsertMembership({ institutionId: BAITUL, account: amilBaitul.address, role: "OFFICER" });

    // Officer profiles
    await store.createOfficerProfile({
      id: "off-admin-sinar",
      institutionId: SINAR,
      displayName: "Admin Sinar",
      account: adminSinar.address,
      role: "ADMIN",
      actor: adminSinar.address,
      now: clock,
    });

    await store.createOfficerProfile({
      id: "off-amil-sinar",
      institutionId: SINAR,
      displayName: "Ahmad Amil",
      account: amilSinar.address,
      role: "OFFICER",
      actor: adminSinar.address,
      now: clock,
    });

    await store.createOfficerProfile({
      id: "off-examiner-sinar",
      institutionId: SINAR,
      displayName: "Budi Pemeriksa",
      account: examinerSinar.address,
      role: "OFFICER",
      actor: adminSinar.address,
      now: clock,
    });

    await store.createOfficerProfile({
      id: "off-approver-sinar",
      institutionId: SINAR,
      displayName: "Citra Direktur",
      account: approverSinar.address,
      role: "OFFICER",
      actor: adminSinar.address,
      now: clock,
    });

    // Link secondary account to Citra Direktur
    await store.linkOfficerAccount({
      institutionId: SINAR,
      officerId: "off-approver-sinar",
      account: secondaryApproverAccount.address,
      role: "OFFICER",
      actor: adminSinar.address,
      now: clock,
    });

    // Operational mandates
    await store.grantMandate({
      institutionId: SINAR,
      actor: adminSinar.address,
      now: clock,
      mandate: {
        officerId: "off-admin-sinar",
        function: "MANAGE_PROGRAMS",
        scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK-000/ADMIN",
        validFrom: clock - 1000,
        validUntil: clock + 86400 * 30,
      },
    });

    await store.grantMandate({
      institutionId: SINAR,
      actor: adminSinar.address,
      now: clock,
      mandate: {
        officerId: "off-amil-sinar",
        function: "PREPARE_PROPOSALS",
        scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK-001/AMIL",
        validFrom: clock - 1000,
        validUntil: clock + 86400 * 30,
      },
    });

    await store.grantMandate({
      institutionId: SINAR,
      actor: adminSinar.address,
      now: clock,
      mandate: {
        officerId: "off-examiner-sinar",
        function: "EXAMINE_PROPOSALS",
        scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK-002/EXAMINER",
        validFrom: clock - 1000,
        validUntil: clock + 86400 * 30,
      },
    });

    await store.grantMandate({
      institutionId: SINAR,
      actor: adminSinar.address,
      now: clock,
      mandate: {
        officerId: "off-approver-sinar",
        function: "APPROVE_DECISIONS",
        scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK-003/DIREKTUR",
        validFrom: clock - 1000,
        validUntil: clock + 86400 * 30,
      },
    });

    // Institutional endorsement account
    await store.registerEndorsementAccount({
      institutionId: SINAR,
      actor: adminSinar.address,
      now: clock,
      data: {
        accountAddress: CONTRACT_ACCOUNT,
        label: "Akun Pengesahan Yayasan Sinar",
        authorizedOfficerIds: ["off-approver-sinar"],
      },
    });
  });


  type DecisionIntentBody = {
    action: "APPROVE" | "REJECT";
    decisionReference: string;
    decisionDate: string;
    decisionDocumentId?: string;
    notes?: string | null;
    rejectionReason?: string | null;
    approvedAidLines?: { id: string; amountApprovedIdr?: string | null }[];
  };
  type SignedChallenge = { challenge: any; signature: Hex };
  type Signer = { signTypedData: (payload: any) => Promise<Hex> };

  const approval = (decisionReference: string, extra: Partial<DecisionIntentBody> = {}): DecisionIntentBody => ({
    action: "APPROVE",
    decisionReference,
    decisionDate: "2026-09-17",
    ...extra,
  });

  const DECISION_FILE = "SK Direksi sintetis nomor 014";

  const postDecisionDocument = (token: string, draft: any, content = DECISION_FILE) =>
    post(
      `/proposals/${draft.id}/decision-documents`,
      {
        fileName: "sk-keputusan.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from(content).toString("base64"),
        expectedVersion: draft.version,
      },
      token
    );

  async function uploadDecisionDocument(token: string, draft: any, content = DECISION_FILE) {
    const res = await postDecisionDocument(token, draft, content);
    expect(res.status).toBe(201);
    return (await res.json()).document;
  }

  /** Uploads a decision document first unless the intent names one; a refused upload is the answer. */
  async function requestChallenge(token: string, draft: any, intent: DecisionIntentBody, signerAccount?: string) {
    let decisionDocumentId = intent.decisionDocumentId;
    if (!decisionDocumentId) {
      const upload = await postDecisionDocument(token, draft);
      if (upload.status !== 201) return upload;
      decisionDocumentId = (await upload.json()).document.id;
    }
    return post(
      `/proposals/${draft.id}/decision-challenge`,
      { ...intent, decisionDocumentId, signerAccount, expectedVersion: draft.version },
      token
    );
  }

  /** What a wallet client does with the wire payload: every uint256 field becomes a bigint. */
  function signable(typedData: any) {
    const uints = new Set(
      typedData.types[typedData.primaryType].filter((field: any) => field.type === "uint256").map((field: any) => field.name)
    );
    const message = Object.fromEntries(
      Object.entries(typedData.message).map(([name, value]) => [name, uints.has(name) ? BigInt(value as number) : value])
    );
    return { ...typedData, message };
  }

  async function signedChallenge(
    token: string,
    draft: any,
    intent: DecisionIntentBody,
    signer: Signer = approverSinar,
    signerAccount?: string
  ): Promise<SignedChallenge> {
    const res = await requestChallenge(token, draft, intent, signerAccount);
    expect(res.status).toBe(201);
    const { challenge, typedData } = await res.json();
    return { challenge, signature: await signer.signTypedData(signable(typedData)) };
  }

  const decide = (
    token: string,
    draft: any,
    intent: DecisionIntentBody,
    signed: SignedChallenge,
    extra: Record<string, unknown> = {}
  ) =>
    post(
      `/proposals/${draft.id}/decide`,
      {
        decisionDocumentId: signed.challenge.decisionDocumentId,
        ...intent,
        signerAccount: signed.challenge.signerAccount,
        mandateId: signed.challenge.mandateId,
        nonce: signed.challenge.nonce,
        signature: signed.signature,
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
        ...extra,
      },
      token
    );

  it("provides review data: examination result, operator, reference ceiling and quorum statement", async () => {
    const { draft } = await prepareReadyProposal();
    const approverToken = await signIn(approverSinar, SINAR);

    const reviewRes = await get(`/proposals/${draft.id}/decision-review`, approverToken);
    expect(reviewRes.status).toBe(200);
    const body = await reviewRes.json();

    expect(body.draft.status).toBe("READY_FOR_DECISION");
    expect(body.program.name).toBe("Program Penyaluran Sembako");
    expect(body.examination.checklist.administrativeChecksOk).toBe(true);
    expect(body.examination.notes).toContain("Semua syarat administrasi");
    expect(body.operator.name).toBe("Citra Direktur");
    expect(body.operator.account.toLowerCase()).toBe(approverSinar.address.toLowerCase());
    expect(body.referenceCeilingWarning).toContain("bukan saldo bank terverifikasi");
    expect(body.quorumStatement).toContain("bukan bukti seluruh peserta pleno menandatangani");
    expect(body.canDecide).toBe(true);
    expect(body.refusalReason).toBeNull();
    expect(body.mandate.function).toBe("APPROVE_DECISIONS");
    expect(body.availableSigners.institutional[0].accountAddress.toLowerCase()).toBe(CONTRACT_ACCOUNT.toLowerCase());
  });

  it("enforces separation of duties: proposal creator cannot decide their own proposal (US-33, Skenario 10)", async () => {
    const { draft } = await prepareReadyProposal();
    const amilToken = await signIn(amilSinar, SINAR);

    expect((await requestChallenge(amilToken, draft, approval("SK-DIR-01"))).status).toBe(403);

    await store.grantMandate({
      institutionId: SINAR,
      actor: adminSinar.address,
      now: clock,
      mandate: {
        officerId: "off-amil-sinar",
        function: "APPROVE_DECISIONS",
        scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK-AMIL-APPROVER",
        validFrom: clock - 1000,
        validUntil: clock + 86400 * 30,
      },
    });

    const refused = await requestChallenge(amilToken, draft, approval("SK-DIR-01"));
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toContain("Penyusun pengajuan tidak boleh mengesahkan keputusannya sendiri");

    const review = await (await get(`/proposals/${draft.id}/decision-review`, amilToken)).json();
    expect(review.canDecide).toBe(false);
    expect(review.refusalReason).toContain("Penyusun pengajuan tidak boleh mengesahkan keputusannya sendiri");
  });

  it("refuses callers without APPROVE_DECISIONS mandate (ADMIN or EXAMINER only)", async () => {
    const { draft } = await prepareReadyProposal();

    const adminChallenge = await requestChallenge(await signIn(adminSinar, SINAR), draft, approval("SK-DIR-01"));
    expect(adminChallenge.status).toBe(403);
    expect((await adminChallenge.json()).error).toContain("Mengesahkan keputusan penyaluran");

    expect((await requestChallenge(await signIn(examinerSinar, SINAR), draft, approval("SK-DIR-01"))).status).toBe(403);
  });

  it("enforces scope and checks the nominal limit against the approved amount", async () => {
    await store.grantMandate({
      institutionId: SINAR,
      actor: adminSinar.address,
      now: clock,
      mandate: {
        officerId: "off-approver-sinar",
        function: "APPROVE_DECISIONS",
        scopeType: "SPECIFIC_PROGRAM",
        programId: "prog-other-unrelated",
        assignmentRef: "SK-LIMITED-PROG",
        validFrom: clock - 1000,
        validUntil: clock + 86400 * 30,
      },
    });

    const { draft } = await prepareReadyProposal({ amount: "100000000" });
    const approverToken = await signIn(approverSinar, SINAR);

    const mandates = await store.listMandates(SINAR, { officerId: "off-approver-sinar" });
    const allProgMandate = mandates.find((m) => m.assignmentRef === "SK-003/DIREKTUR")!;
    await store.revokeMandate({
      institutionId: SINAR,
      id: allProgMandate.id,
      expectedVersion: allProgMandate.version,
      actor: adminSinar.address,
      now: clock,
    });

    const scopeRes = await requestChallenge(approverToken, draft, approval("SK-DIR-01"));
    expect(scopeRes.status).toBe(403);
    expect((await scopeRes.json()).error).toContain("hanya berlaku untuk program spesifik");

    await store.grantMandate({
      institutionId: SINAR,
      actor: adminSinar.address,
      now: clock,
      mandate: {
        officerId: "off-approver-sinar",
        function: "APPROVE_DECISIONS",
        scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK-LIMITED-AMOUNT",
        nominalLimit: "5000000",
        validFrom: clock - 1000,
        validUntil: clock + 86400 * 30,
      },
    });

    const limitRes = await requestChallenge(approverToken, draft, approval("SK-DIR-01"));
    expect(limitRes.status).toBe(403);
    expect((await limitRes.json()).error).toContain("melampaui batas nominal mandat");

    // Approving only part of the request brings the committed nominal within the limit.
    const partial = approval("SK-DIR-01", { approvedAidLines: [{ id: "aid-fixture", amountApprovedIdr: "4000000" }] });
    expect((await requestChallenge(approverToken, draft, partial)).status).toBe(201);
  });

  it("approves with a real EOA signature, persisting the signed rights digest and replaying retries", async () => {
    const { draft } = await prepareReadyProposal();
    const approverToken = await signIn(approverSinar, SINAR);
    const intent = approval("SK-DIR-2026-001", {
      notes: "Disetujui sebagian sesuai hasil pleno.",
      approvedAidLines: [{ id: "aid-fixture", amountApprovedIdr: "300000" }],
    });

    const signed = await signedChallenge(approverToken, draft, intent);
    expect(signed.challenge.rightsDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(signed.challenge.decisionDate).toBe("2026-09-17");

    const operationId = crypto.randomUUID();
    const decideRes = await decide(approverToken, draft, intent, signed, { operationId });
    expect(decideRes.status).toBe(200);
    const body = await decideRes.json();
    expect(body.draft.status).toBe("APPROVED");
    expect(body.draft.aidLines[0].value.amountApprovedIdr).toBe("300000");
    expect(body.decision.action).toBe("APPROVE");
    expect(body.decision.notes).toBe("Disetujui sebagian sesuai hasil pleno.");
    expect(body.decision.rightsDigest).toBe(signed.challenge.rightsDigest);
    expect(body.decision.operatorAccount.toLowerCase()).toBe(approverSinar.address.toLowerCase());
    expect(body.decision.signerAccount.toLowerCase()).toBe(approverSinar.address.toLowerCase());

    const readBody = await (await get(`/proposals/${draft.id}/decision`, approverToken)).json();
    expect(readBody.decision.rightsDigest).toBe(signed.challenge.rightsDigest);

    const history = (await (await get(`/proposals/${draft.id}/history`, approverToken)).json()).history;
    expect(history[history.length - 1].action).toBe("APPROVE");
    expect(history[history.length - 1].toStatus).toBe("APPROVED");

    // An identical retry returns the same decision, although the nonce is spent and the proposal decided.
    const retryRes = await decide(approverToken, draft, intent, signed, { operationId });
    expect(retryRes.status).toBe(200);
    expect((await retryRes.json()).decision.id).toBe(body.decision.id);

    // The same operation with a different payload does not overwrite the result.
    const conflictRes = await decide(approverToken, draft, { ...intent, notes: "Isi berbeda" }, signed, { operationId });
    expect(conflictRes.status).toBe(409);
    expect((await (await get(`/proposals/${draft.id}/decision`, approverToken)).json()).decision.notes).toBe(
      "Disetujui sebagian sesuai hasil pleno."
    );
  });

  it("records the decided lines with the decision; a legacy decision is recovered only when it reproduces the signed digest", async () => {
    const { draft } = await prepareReadyProposal();
    const approverToken = await signIn(approverSinar, SINAR);
    const intent = approval("SK-DIR-LINES", { approvedAidLines: [{ id: "aid-fixture", amountApprovedIdr: "300000" }] });
    const signed = await signedChallenge(approverToken, draft, intent);
    expect((await decide(approverToken, draft, intent, signed)).status).toBe(200);

    const versionLine = async () =>
      (await (await get(`/proposals/${draft.id}/versions/${draft.version}`, approverToken)).json()).version.data.aidLines[0].value;
    // The version reads what its approval decided, without its submitted snapshot being rewritten.
    expect((await versionLine()).amountApprovedIdr).toBe("300000");
    const db = database.handle();
    const snapshot = (await db.execute(sql`SELECT data_json FROM proposal_versions WHERE proposal_id = ${draft.id}`)) as any;
    const snapshotRows = Array.isArray(snapshot) ? snapshot : snapshot.rows;
    expect(JSON.parse(snapshotRows[0].data_json).aidLines[0].value.amountApprovedIdr).toBeNull();

    // A decision recorded before the column existed reads as submitted, and verify writes nothing.
    await db.execute(sql`UPDATE proposal_decisions SET decided_aid_lines_json = NULL WHERE proposal_id = ${draft.id}`);
    expect((await versionLine()).amountApprovedIdr).toBeNull();
    const verified = await recoverDecidedAidLines(db, { apply: false });
    expect(verified.outcomes.find((o) => o.proposalId === draft.id)?.state).toBe("RECOVERED_FROM_DRAFT");
    expect((await versionLine()).amountApprovedIdr).toBeNull();

    // A candidate that does not reproduce the signed digest is never written.
    const digest = (await (await get(`/proposals/${draft.id}/decision`, approverToken)).json()).decision.rightsDigest;
    await db.execute(sql`UPDATE proposal_decisions SET rights_digest = ${`0x${"0".repeat(64)}`} WHERE proposal_id = ${draft.id}`);
    const refused = await recoverDecidedAidLines(db, { apply: true });
    expect(refused.outcomes.find((o) => o.proposalId === draft.id)?.state).toBe("UNRECOVERABLE");
    expect((await versionLine()).amountApprovedIdr).toBeNull();

    await db.execute(sql`UPDATE proposal_decisions SET rights_digest = ${digest} WHERE proposal_id = ${draft.id}`);
    await recoverDecidedAidLines(db, { apply: true });
    expect((await versionLine()).amountApprovedIdr).toBe("300000");
    expect((await recoverDecidedAidLines(db, { apply: false })).outcomes.some((o) => o.proposalId === draft.id)).toBe(false);
  });

  it("refuses approved amounts that differ from what was signed or exceed the request", async () => {
    const { draft } = await prepareReadyProposal();
    const approverToken = await signIn(approverSinar, SINAR);

    const excessive = approval("SK-DIR-02", { approvedAidLines: [{ id: "aid-fixture", amountApprovedIdr: "600000" }] });
    const excessiveRes = await requestChallenge(approverToken, draft, excessive);
    expect(excessiveRes.status).toBe(409);
    expect((await excessiveRes.json()).error).toContain("melebihi jumlah yang diajukan");

    const unknown = approval("SK-DIR-02", { approvedAidLines: [{ id: "aid-missing", amountApprovedIdr: "1" }] });
    expect((await requestChallenge(approverToken, draft, unknown)).status).toBe(409);

    const intent = approval("SK-DIR-02", { approvedAidLines: [{ id: "aid-fixture", amountApprovedIdr: "100000" }] });
    const signed = await signedChallenge(approverToken, draft, intent);

    const tampered = { ...intent, approvedAidLines: [{ id: "aid-fixture", amountApprovedIdr: "500000" }] };
    const tamperedRes = await decide(approverToken, draft, tampered, signed);
    expect(tamperedRes.status).toBe(409);
    expect((await tamperedRes.json()).error).toContain("berubah sejak tanda tangan diminta");

    const otherDate = await decide(approverToken, draft, { ...intent, decisionDate: "2026-09-18" }, signed);
    expect(otherDate.status).toBe(409);

    // Nothing was recorded and the challenge stays usable for what was actually signed.
    expect((await get(`/proposals/${draft.id}/decision`, approverToken)).status).toBe(404);
    const okRes = await decide(approverToken, draft, intent, signed);
    expect(okRes.status).toBe(200);
    expect((await okRes.json()).draft.aidLines[0].value.amountApprovedIdr).toBe("100000");
  });

  it("binds the uploaded decision document by hash and refuses a swapped or foreign document", async () => {
    const { draft, programId } = await prepareReadyProposal();
    const approverToken = await signIn(approverSinar, SINAR);

    const missing = await post(
      `/proposals/${draft.id}/decision-challenge`,
      { ...approval("SK-DOK-01"), expectedVersion: draft.version },
      approverToken
    );
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toContain("Berkas SK / berita acara");

    // Uploading needs the decision mandate, and does not make the uploader a proposal contributor.
    const amilUpload = await post(
      `/proposals/${draft.id}/decision-documents`,
      { fileName: "x.txt", contentBase64: Buffer.from("x").toString("base64"), expectedVersion: draft.version },
      await signIn(amilSinar, SINAR)
    );
    expect(amilUpload.status).toBe(403);

    const other = await prepareReadyProposal({ programId });
    const foreign = await uploadDecisionDocument(approverToken, other.draft);
    const foreignRes = await requestChallenge(approverToken, draft, approval("SK-DOK-01", { decisionDocumentId: foreign.id }));
    expect(foreignRes.status).toBe(409);

    const document = await uploadDecisionDocument(approverToken, draft);
    expect(document.contentSha256).toBe(`0x${new Bun.CryptoHasher("sha256").update(DECISION_FILE).digest("hex")}`);
    expect(document.storageRef).toBeUndefined();

    const intent = approval("SK-DOK-01", { decisionDocumentId: document.id });
    const signed = await signedChallenge(approverToken, draft, intent);
    expect(signed.challenge.decisionDocumentSha256).toBe(document.contentSha256);

    const replacement = await uploadDecisionDocument(approverToken, draft, "SK lain yang tidak ditandatangani");
    const swapped = await decide(approverToken, draft, { ...intent, decisionDocumentId: replacement.id }, signed);
    expect(swapped.status).toBe(409);

    const okRes = await decide(approverToken, draft, intent, signed);
    expect(okRes.status).toBe(200);
    const { decision } = await okRes.json();
    expect(decision.decisionDocumentId).toBe(document.id);
    expect(decision.decisionDocumentSha256).toBe(document.contentSha256);

    const download = await get(`/proposals/${draft.id}/decision-documents/${document.id}`, approverToken);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe(DECISION_FILE);
  });

  it("rejects with a mandatory reason, distinct from an approval", async () => {
    const { draft } = await prepareReadyProposal();
    const approverToken = await signIn(approverSinar, SINAR);

    const withoutReason = await requestChallenge(approverToken, draft, { ...approval("BA-PLENO-TOLAK-01"), action: "REJECT" });
    expect(withoutReason.status).toBe(400);

    const intent: DecisionIntentBody = {
      action: "REJECT",
      decisionReference: "BA-PLENO-TOLAK-01",
      decisionDate: "2026-09-17",
      rejectionReason: "Tidak sesuai dengan fokus prioritas mustahik periode ini.",
    };
    const decideRes = await decide(approverToken, draft, intent, await signedChallenge(approverToken, draft, intent));

    expect(decideRes.status).toBe(200);
    const body = await decideRes.json();
    expect(body.draft.status).toBe("REJECTED");
    expect(body.draft.revisionReason).toBe(intent.rejectionReason);
    expect(body.draft.aidLines[0].value.amountApprovedIdr ?? null).toBeNull();
    expect(body.decision.action).toBe("REJECT");
    expect(body.decision.rejectionReason).toBe(intent.rejectionReason);
  });

  it("verifies ERC-1271 signatures; an unreachable RPC is pending and leaves the challenge usable", async () => {
    const { draft } = await prepareReadyProposal();
    const approverToken = await signIn(approverSinar, SINAR);
    const intent = approval("SK-INSTITUSI-01");
    const signed = await signedChallenge(approverToken, draft, intent, contractSigner, CONTRACT_ACCOUNT);
    expect(signed.challenge.signerAccount.toLowerCase()).toBe(CONTRACT_ACCOUNT.toLowerCase());

    ethCallBehavior = "error";
    const pendingRes = await decide(approverToken, draft, intent, signed);
    expect(pendingRes.status).toBe(503);
    expect((await pendingRes.json()).reason).toBe("signature-unverifiable");

    ethCallBehavior = "revert";
    expect((await decide(approverToken, draft, intent, signed)).status).toBe(401);

    ethCallBehavior = "magic";
    const successRes = await decide(approverToken, draft, intent, signed);
    expect(successRes.status).toBe(200);
    expect((await successRes.json()).decision.signerAccount.toLowerCase()).toBe(CONTRACT_ACCOUNT.toLowerCase());
  });

  it("blocks replayed nonces, expired challenges, and tampered signatures", async () => {
    const { draft } = await prepareReadyProposal();
    const approverToken = await signIn(approverSinar, SINAR);

    const expiring = approval("SK-EXP-01");
    const stale = await signedChallenge(approverToken, draft, expiring);
    clock = NOW + 400;
    const expiredRes = await decide(approverToken, draft, expiring, stale);
    expect(expiredRes.status).toBe(401);
    expect((await expiredRes.json()).error).toMatch(/kedaluwarsa|expired/i);

    clock = NOW + 10;
    const intent = approval("SK-EXP-02");
    const fresh = await signedChallenge(approverToken, draft, intent);

    const badSig = `${fresh.signature.slice(0, -4)}ffff` as Hex;
    expect((await decide(approverToken, draft, intent, { ...fresh, signature: badSig })).status).toBe(401);

    expect((await decide(approverToken, draft, intent, fresh)).status).toBe(200);

    const replayRes = await decide(approverToken, draft, intent, fresh);
    expect(replayRes.status).toBe(401);
    expect((await replayRes.json()).error).toMatch(/pernah dipakai|replayed/i);
  });

  it("does not apply a signature after the mandate is revoked or the version changes", async () => {
    const { draft } = await prepareReadyProposal();
    const approverToken = await signIn(approverSinar, SINAR);
    const intent = approval("SK-CABUT-01");
    const signed = await signedChallenge(approverToken, draft, intent);

    const staleVersion = await decide(approverToken, draft, intent, signed, { expectedVersion: draft.version + 1 });
    expect(staleVersion.status).toBe(409);

    const [mandate] = await store.listMandates(SINAR, { officerId: "off-approver-sinar" });
    await store.revokeMandate({
      institutionId: SINAR,
      id: mandate!.id,
      expectedVersion: mandate!.version,
      actor: adminSinar.address,
      now: clock,
    });

    expect((await decide(approverToken, draft, intent, signed)).status).toBe(403);
    expect((await get(`/proposals/${draft.id}/decision`, approverToken)).status).toBe(404);
    expect((await disbursement.getProposalDraft(SINAR, draft.id))!.status).toBe("READY_FOR_DECISION");
  });

  it("isolates institutions: another institution's decider cannot review, upload, challenge, decide or read", async () => {
    const { draft } = await prepareReadyProposal();
    const approverToken = await signIn(approverSinar, SINAR);
    const intent = approval("SK-ISOLASI-01");
    const signed = await signedChallenge(approverToken, draft, intent);

    // A Baitul Maal official with a full decision mandate in their own institution.
    await store.createOfficerProfile({
      id: "off-approver-baitul", institutionId: BAITUL, displayName: "Pejabat Baitul",
      account: amilBaitul.address, role: "OFFICER", actor: adminBaitul.address, now: clock,
    });
    await store.grantMandate({
      institutionId: BAITUL, actor: adminBaitul.address, now: clock,
      mandate: {
        officerId: "off-approver-baitul", function: "APPROVE_DECISIONS", scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK-BAITUL-01", validFrom: clock - 1000, validUntil: clock + 86400,
      },
    });
    const baitulToken = await signIn(amilBaitul, BAITUL);

    expect((await get(`/proposals/${draft.id}/decision-review`, baitulToken)).status).toBe(404);
    expect((await postDecisionDocument(baitulToken, draft)).status).toBe(404);
    expect((await post(`/proposals/${draft.id}/decision-challenge`,
      { ...intent, decisionDocumentId: signed.challenge.decisionDocumentId, expectedVersion: draft.version }, baitulToken)).status).toBe(404);
    expect((await decide(baitulToken, draft, intent, signed)).status).toBe(404);
    expect((await get(`/proposals/${draft.id}/decision-documents/${signed.challenge.decisionDocumentId}`, baitulToken)).status).toBe(404);

    // Naming the other institution explicitly does not switch the session's tenant.
    const named = await post(`/proposals/${draft.id}/decide`, {
      ...intent, institutionId: SINAR, decisionDocumentId: signed.challenge.decisionDocumentId,
      signerAccount: signed.challenge.signerAccount, mandateId: signed.challenge.mandateId,
      nonce: signed.challenge.nonce, signature: signed.signature, expectedVersion: draft.version, operationId: crypto.randomUUID(),
    }, baitulToken);
    expect(named.status).toBe(403);

    // A challenge signed for one proposal cannot decide another in the same institution.
    const sibling = await prepareReadyProposal({ programId: draft.programId, purpose: "Pengajuan saudara" });
    const siblingDocument = await uploadDecisionDocument(approverToken, sibling.draft);
    const misrouted = await decide(approverToken, sibling.draft, { ...intent, decisionDocumentId: siblingDocument.id }, signed);
    expect(misrouted.status).toBe(409);

    expect((await get(`/proposals/${draft.id}/decision`, approverToken)).status).toBe(404);
    expect((await decide(approverToken, draft, intent, signed)).status).toBe(200);
    expect((await get(`/proposals/${draft.id}/decision`, baitulToken)).status).toBe(404);
  });

  it("applies nothing from a session that was logged out, expired or had its membership revoked", async () => {
    const { draft } = await prepareReadyProposal();
    const intent = approval("SK-SESI-01");

    // Logout between signing and submitting.
    const loggedOut = await signIn(approverSinar, SINAR);
    const signed = await signedChallenge(loggedOut, draft, intent);
    expect((await request("/session", { method: "DELETE", headers: { Authorization: `Bearer ${loggedOut}` } })).status).toBeLessThan(300);
    const afterLogout = await decide(loggedOut, draft, intent, signed);
    expect(afterLogout.status).toBe(401);
    expect((await afterLogout.json()).sessionEnd).toBe("REVOKED");

    // Expiry between signing and submitting.
    const expiring = await signIn(approverSinar, SINAR);
    clock += 3601;
    const afterExpiry = await decide(expiring, draft, intent, signed);
    expect(afterExpiry.status).toBe(401);
    expect((await afterExpiry.json()).sessionEnd).toBe("EXPIRED");
    clock = NOW;

    // Membership revocation ends the session at once.
    const revoked = await signIn(approverSinar, SINAR);
    await store.deactivateMembership({ institutionId: SINAR, account: approverSinar.address });
    expect((await decide(revoked, draft, intent, signed)).status).toBe(401);
    expect((await get(`/proposals/${draft.id}/decision`, await signIn(adminSinar, SINAR))).status).toBe(404);
    expect((await disbursement.getProposalDraft(SINAR, draft.id))!.status).toBe("READY_FOR_DECISION");

    // The rightful owner, signed in again, can still use the unspent challenge.
    await store.upsertMembership({ institutionId: SINAR, account: approverSinar.address, role: "OFFICER" });
    const restored = await signIn(approverSinar, SINAR);
    expect((await decide(restored, draft, intent, signed)).status).toBe(200);
  });

  it("holds and explains when institutional policy requires multi-signer digital quorum", async () => {
    const { draft } = await prepareReadyProposal();
    const approverToken = await signIn(approverSinar, SINAR);

    const currentPolicy = await disbursement.getInstitutionPolicy(SINAR);
    await disbursement.saveInstitutionPolicy(
      { ...currentPolicy, sopRequiresMultiSignerQuorum: true, updatedAt: clock, updatedBy: "admin-test" },
      currentPolicy.version
    );

    const reviewBody = await (await get(`/proposals/${draft.id}/decision-review`, approverToken)).json();
    expect(reviewBody.sopQuorumHeld).toBe(true);
    expect(reviewBody.canDecide).toBe(false);
    expect(reviewBody.refusalReason).toContain("kuorum digital banyak pejabat yang belum didukung");

    const challengeRes = await requestChallenge(approverToken, draft, approval("SK-QUORUM"));
    expect(challengeRes.status).toBe(403);
    expect((await challengeRes.json()).error).toContain("kuorum digital banyak pejabat yang belum didukung");
  });

  it("keeps the decision and approved rights durable across a database restart", async () => {
    const { draft } = await prepareReadyProposal();
    const approverToken = await signIn(approverSinar, SINAR);
    const intent = approval("SK-DURABLE-01");
    const signed = await signedChallenge(approverToken, draft, intent);
    const operationId = crypto.randomUUID();
    const decided = await (await decide(approverToken, draft, intent, signed, { operationId })).json();

    await database.reopen();
    store = createWorkspaceStore(database.handle());
    disbursement = createDisbursementStore(database.handle());
    activities = createActivityStore(database.handle());
    await store.ensureSchema();
    await disbursement.ensureSchema();
    configureWorkspace({
      store,
      disbursement,
      activities,
      files,
      ethCall,
      now: () => clock,
      sessionTtlSeconds: 3600,
      challengeTtlSeconds: 300,
    });

    const readBody = await (await get(`/proposals/${draft.id}/decision`, approverToken)).json();
    expect(readBody.decision.id).toBe(decided.decision.id);
    expect((await disbursement.getProposalDraft(SINAR, draft.id))!.aidLines[0]!.value).toMatchObject({
      amountApprovedIdr: "500000",
    });

    const retryRes = await decide(approverToken, draft, intent, signed, { operationId });
    expect(retryRes.status).toBe(200);
    expect((await retryRes.json()).decision.id).toBe(decided.decision.id);
  });

  it("integrates with Ticket #103: an APPROVED proposal is accepted to create a distribution activity", async () => {
    const { draft } = await prepareReadyProposal();
    const approverToken = await signIn(approverSinar, SINAR);
    const intent = approval("SK-PILOT-ACTIVITY");
    expect((await decide(approverToken, draft, intent, await signedChallenge(approverToken, draft, intent))).status).toBe(200);

    const activity = await activities.createActivity(
      SINAR,
      { proposalId: draft.id, name: "Kegiatan Penyaluran Sembako Terpadu" },
      { id: crypto.randomUUID(), account: approverSinar.address, requestHash: "hash-act-test" },
      { account: approverSinar.address, officerId: "off-approver-sinar" },
      clock
    );

    expect(activity.proposalId).toBe(draft.id);
    expect(activity.status).toBe("ACTIVE");
  });

  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("browser: review, upload, sign and record; institutional signer with pending result; context change while signing", async () => {
    const first = await prepareReadyProposal({ purpose: "Keputusan Smoke A" });
    const second = await prepareReadyProposal({ programId: first.programId, purpose: "Keputusan Smoke B" });
    const third = await prepareReadyProposal({ programId: first.programId, purpose: "Keputusan Smoke C" });
    const fourth = await prepareReadyProposal({ programId: first.programId, purpose: "Keputusan Smoke D" });
    let holdDecide: Promise<void> | null = null;
    const approverToken = await signIn(approverSinar, SINAR);

    let beforeSign: (() => Promise<void>) | null = null;
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
          if (["eth_accounts", "eth_requestAccounts"].includes(method)) return Response.json([approverSinar.address]);
          if (method === "eth_chainId") return Response.json("0x7a69");
          if (method === "eth_signTypedData_v4") {
            const typedData = JSON.parse(params[1]);
            if (typedData.primaryType === "DisbursementDecision" && beforeSign) await beforeSign();
            return Response.json(await approverSinar.signTypedData(typedData));
          }
          return Response.json(null);
        }
        if (holdDecide && path.endsWith("/decide")) {
          const response = await app.fetch(req);
          await holdDecide;
          return response;
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
      page.on("pageerror", (error: Error) => errors.push(error.message));

      await page.goto(server.url.toString());
      await page.getByRole("button", { name: /^0x/ }).waitFor();
      const signInToProgram = async () => {
        await page.getByLabel("Pengelola Zakat", { exact: true }).selectOption(SINAR);
        await page.waitForFunction((institution: string) => (document.querySelector("#institution") as HTMLSelectElement)?.value === institution, SINAR);
        await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();
        await page.getByLabel(/Program bantuan/).selectOption(first.programId);
      };
      await signInToProgram();

      const openDecision = async (purpose: string) => {
        await page.getByRole("button", { name: new RegExp(purpose) }).click();
        await page.getByRole("button", { name: "Tinjau & Putuskan", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByText("Hasil pemeriksaan", { exact: true }).waitFor();
        return dialog;
      };
      const fillDecision = async (dialog: any, reference: string) => {
        await dialog.getByLabel(/Nomor SK/).fill(reference);
        await dialog.getByLabel(/Berkas SK/).setInputFiles({ name: `${reference}.txt`, mimeType: "text/plain", buffer: Buffer.from(`Berkas ${reference}`) });
      };
      const decisionOf = async (id: string) => get(`/proposals/${id}/decision`, approverToken);

      // 1. Review, upload the SK, sign and record a partial approval.
      let dialog = await openDecision("Keputusan Smoke A");
      await dialog.getByText("Administrasi: Terpenuhi").waitFor();
      await dialog.getByText("Citra Direktur", { exact: true }).waitFor();
      await fillDecision(dialog, "SK-SMOKE-A");
      await dialog.getByLabel("Disetujui untuk Mustahik Satu", { exact: true }).fill("400000");
      await dialog.getByRole("button", { name: "Tanda tangani pengesahan", exact: true }).click();
      await page.getByText("Pengajuan disetujui lembaga", { exact: true }).waitFor();
      const recordedA = (await (await decisionOf(first.draft.id)).json()).decision;
      expect(recordedA.decisionReference).toBe("SK-SMOKE-A");
      expect(recordedA.decisionDocumentSha256).toBe(`0x${new Bun.CryptoHasher("sha256").update("Berkas SK-SMOKE-A").digest("hex")}`);
      expect((await disbursement.getProposalDraft(SINAR, first.draft.id))!.aidLines[0]!.value).toMatchObject({ amountApprovedIdr: "400000" });

      // 2. The operator signs as the institutional account; an unreachable RPC is pending, not failed.
      dialog = await openDecision("Keputusan Smoke B");
      await dialog.getByRole("radio", { name: /Akun Pengesahan Yayasan Sinar/ }).check();
      await dialog.getByText(CONTRACT_ACCOUNT, { exact: true }).first().waitFor();
      await fillDecision(dialog, "SK-SMOKE-B");
      ethCallBehavior = "error";
      await dialog.getByRole("button", { name: "Tanda tangani pengesahan", exact: true }).click();
      await dialog.getByRole("alert").getByText(/belum diketahui/).waitFor();
      expect((await decisionOf(second.draft.id)).status).toBe(404);
      ethCallBehavior = "magic";
      await dialog.getByRole("button", { name: "Periksa hasil pengesahan", exact: true }).click();
      await page.getByText("Pengajuan disetujui lembaga", { exact: true }).waitFor();
      const recordedB = (await (await decisionOf(second.draft.id)).json()).decision;
      expect(recordedB.signerAccount.toLowerCase()).toBe(CONTRACT_ACCOUNT.toLowerCase());
      expect(recordedB.operatorAccount.toLowerCase()).toBe(approverSinar.address.toLowerCase());

      // 3. The mandate is revoked while the wallet is signing: the signature is not applied.
      dialog = await openDecision("Keputusan Smoke C");
      await fillDecision(dialog, "SK-SMOKE-C");
      beforeSign = async () => {
        beforeSign = null;
        const [mandate] = await store.listMandates(SINAR, { officerId: "off-approver-sinar", activeOnly: true });
        await store.revokeMandate({ institutionId: SINAR, id: mandate!.id, expectedVersion: mandate!.version, actor: adminSinar.address, now: clock });
      };
      await dialog.getByRole("button", { name: "Tanda tangani pengesahan", exact: true }).click();
      await dialog.getByRole("alert").waitFor();
      expect(await dialog.getByRole("alert").textContent()).not.toMatch(/belum diketahui/);
      expect((await decisionOf(third.draft.id)).status).toBe(404);
      expect((await disbursement.getProposalDraft(SINAR, third.draft.id))!.status).toBe("READY_FOR_DECISION");

      // 4. A late response to the old session, after logout, is not applied; a new session reads the durable result.
      await dialog.getByRole("button", { name: "Tutup", exact: true }).click();
      await store.grantMandate({
        institutionId: SINAR, actor: adminSinar.address, now: clock,
        mandate: {
          officerId: "off-approver-sinar", function: "APPROVE_DECISIONS", scopeType: "ALL_PROGRAMS",
          assignmentRef: "SK-003/DIREKTUR-ULANG", validFrom: clock - 1000, validUntil: clock + 86400 * 30,
        },
      });
      dialog = await openDecision("Keputusan Smoke D");
      await fillDecision(dialog, "SK-SMOKE-D");
      let release!: () => void;
      holdDecide = new Promise<void>((resolve) => { release = resolve; });
      await dialog.getByRole("button", { name: "Tanda tangani pengesahan", exact: true }).click();
      for (let attempt = 0; attempt < 50 && (await decisionOf(fourth.draft.id)).status !== 200; attempt++) await Bun.sleep(100);
      expect((await decisionOf(fourth.draft.id)).status).toBe(200);
      // The modal makes the rest of the page inert, so logout is dispatched as the app's own button click.
      await page.locator("button").filter({ hasText: /^\s*Keluar\s*$/ }).first().dispatchEvent("click");
      await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).waitFor();
      release();
      holdDecide = null;
      await Bun.sleep(500);
      expect(await page.getByText("Pengajuan disetujui lembaga", { exact: true }).count()).toBe(0);
      expect(await page.getByRole("dialog").count()).toBe(0);

      await signInToProgram();
      await page.getByRole("button", { name: /Keputusan Smoke D/ }).click();
      await page.getByText("Pengajuan disetujui lembaga", { exact: true }).waitFor();
      await page.getByText("SK-SMOKE-D", { exact: true }).waitFor();

      await page.screenshot({ path: "/tmp/issue93-browser.png", fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      server.stop(true);
    }
  }, 60000);
});

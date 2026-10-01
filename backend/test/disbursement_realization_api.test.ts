/**
 * Integration tests for Realisasi IDR bertahap dan bukti pembayaran
 * (Spec #86, ticket #94, pilot amendment #100).
 *
 * Real HTTP routes over real SQL and the encrypted private file store. Only the
 * outside world is a fixture: the clock and the OTP message transport (no real
 * contact is used, and the code is read from the fixture outbox, never from the API).
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
import { configureWorkspace, resetWorkspace, type RecipientMessageTransport } from "../src/workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { REALIZATION_DISCLAIMER_NOTICE } from "../src/disbursement";

const BASE = "http://localhost:3001/api/workspace";

const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";

const adminSinar = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
const amilSinar = privateKeyToAccount(`0x${"22".repeat(32)}` as Hex);
const examinerSinar = privateKeyToAccount(`0x${"33".repeat(32)}` as Hex);
const approverSinar = privateKeyToAccount(`0x${"44".repeat(32)}` as Hex);

const adminBaitul = privateKeyToAccount(`0x${"66".repeat(32)}` as Hex);
const amilBaitul = privateKeyToAccount(`0x${"55".repeat(32)}` as Hex);

const NOW = 1_800_000_000;
const FILE_KEY = Buffer.alloc(32, 77);
/** A reserved fixture number; the transport below never leaves the process. */
const FIXTURE_CONTACT = "080000000123";

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let disbursement: DisbursementStore;
let activities: ActivityStore;
let files: PrivateFileStore;
let tempDir: string;
let clock = NOW;

let outbox: Array<{ to: string; body: string }> = [];
let transportFails = false;
const messages: RecipientMessageTransport = {
  async send(message) {
    if (transportFails) throw new Error("SMS gateway unreachable");
    outbox.push(message);
  },
};

const configure = (overrides: { messages?: RecipientMessageTransport | undefined } = { messages }) =>
  configureWorkspace({
    store,
    disbursement,
    activities,
    files,
    ...overrides,
    ethCall: async () => "0x",
    now: () => clock,
    sessionTtlSeconds: 3600,
    challengeTtlSeconds: 300,
  });

const request = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`${BASE}${path}`, init));

const post = (path: string, body: unknown, token?: string) =>
  request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(/\/(advances|expenses|disputes|examinations)$/.test(path)
      ? { operationId: crypto.randomUUID(), ...(body as object) } : body),
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

const signable = (typedData: any) => {
  const uints = new Set(
    typedData.types[typedData.primaryType].filter((field: any) => field.type === "uint256").map((field: any) => field.name)
  );
  const message = Object.fromEntries(
    Object.entries(typedData.message).map(([name, value]) => [name, uints.has(name) ? BigInt(value as number) : value])
  );
  return { ...typedData, message };
};

const documentInput = (category = "PROPOSAL_LETTER") => ({
  category,
  fileName: "dokumen.txt",
  mimeType: "text/plain",
  beneficiaryId: category === "BENEFICIARY_IDENTITY" ? "ben-1" : null,
  contentBase64: Buffer.from("Konten dokumen pengajuan").toString("base64"),
});

async function prepareApprovedProposal(options?: {
  beneficiariesCount?: number;
  perBeneficiaryAmount?: string;
  purpose?: string;
  beneficiary?: { guardian?: { name: string; relationship: string } | null; contact?: { phone?: string; email?: string; relation?: string } | null };
}) {
  const amilToken = await signIn(amilSinar, SINAR);
  const examinerToken = await signIn(examinerSinar, SINAR);
  const approverToken = await signIn(approverSinar, SINAR);
  const adminToken = await signIn(adminSinar, SINAR);

  const progRes = await post(
    "/programs",
    {
      name: "Program Bantuan Pendidikan & Kesehatan",
      purpose: "Bantuan mustahik bertahap",
      fundType: "ZAKAT",
      scope: "Jawa Barat",
      referenceCeiling: "999999999999999999",
    },
    adminToken
  );
  expect(progRes.status).toBe(201);
  const programId = (await progRes.json()).program.id;

  const count = options?.beneficiariesCount ?? 1;
  const unitAmount = options?.perBeneficiaryAmount ?? "1000000";

  if (count > 1) {
    const curPol = (await (await get("/policy", adminToken)).json()).policy;
    const savePolRes = await post("/policy", { ...curPol, expectedVersion: curPol.version, requireIdentityDoc: false }, adminToken);
    expect(savePolRes.status).toBe(200);
  }

  const beneficiaries = [];
  const aidLines = [];
  for (let i = 1; i <= count; i++) {
    beneficiaries.push({
      id: `ben-${i}`,
      name: `Mustahik ${i}`,
      asnaf: "Fakir",
      identityBasis: { kind: "NIK", value: `3201123456${String(i).padStart(6, "0")}` },
      addressOrScope: "Bandung",
      guardian: null,
      contact: { phone: FIXTURE_CONTACT, relation: "SELF" },
      paymentRecipient: null,
      ...options?.beneficiary,
    });
    aidLines.push({
      id: `aid-${i}`,
      beneficiaryId: `ben-${i}`,
      aidType: "Bantuan Biaya Pendidikan",
      period: "2026-03",
      value: { kind: "MONEY", amountRequestedIdr: unitAmount },
    });
  }

  const propRes = await post(
    "/proposals",
    {
      expectedVersion: 0,
      operationId: crypto.randomUUID(),
      programId,
      originOfRequest: "Rekomendasi Lapangan",
      purpose: options?.purpose ?? "Penyaluran bertahap mustahik",
      personInCharge: "Ahmad Amil",
      aidPeriod: { start: "2026-03-01", end: "2026-03-31" },
      beneficiaries,
      aidLines,
    },
    amilToken
  );
  expect(propRes.status).toBe(201);
  const draft = (await propRes.json()).draft;

  for (const cat of ["PROPOSAL_LETTER", "RECIPIENT_VERIFICATION", "BENEFICIARY_IDENTITY", ...(options?.beneficiary?.guardian ? ["REPRESENTATION_PROOF"] : [])]) {
    expect((await post(`/proposals/${draft.id}/documents`, { ...documentInput(cat), ...(cat === "REPRESENTATION_PROOF" ? { beneficiaryId: "ben-1" } : {}) }, amilToken)).status).toBe(201);
  }

  const submitRes = await post(`/proposals/${draft.id}/submit`, { expectedVersion: draft.version, operationId: crypto.randomUUID() }, amilToken);
  expect(submitRes.status).toBe(200);
  const submitted = (await submitRes.json()).draft;

  await post(`/proposals/${draft.id}/start-examination`, { expectedVersion: submitted.version, operationId: crypto.randomUUID() }, examinerToken);

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
        notes: "Kelayakan disetujui",
      },
    },
    examinerToken
  );
  expect(readyRes.status).toBe(200);
  const readyDraft = (await readyRes.json()).draft;

  const docRes = await post(
    `/proposals/${readyDraft.id}/decision-documents`,
    {
      fileName: "sk-penetapan.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("SK Penetapan Direktur").toString("base64"),
      expectedVersion: readyDraft.version,
    },
    approverToken
  );
  expect(docRes.status).toBe(201);
  const decisionDocumentId = (await docRes.json()).document.id;

  const approvedAidLines = aidLines.map((al) => ({ id: al.id, amountApprovedIdr: unitAmount }));
  const intent = { action: "APPROVE", decisionReference: "SK-DIREKSI-001", decisionDate: "2026-03-15", decisionDocumentId };
  const chalRes = await post(
    `/proposals/${readyDraft.id}/decision-challenge`,
    { ...intent, expectedVersion: readyDraft.version, approvedAidLines },
    approverToken
  );
  expect(chalRes.status).toBe(201);
  const { challenge, typedData } = await chalRes.json();
  const signature = await approverSinar.signTypedData(signable(typedData));

  const decideRes = await post(
    `/proposals/${readyDraft.id}/decide`,
    {
      ...intent,
      signerAccount: challenge.signerAccount,
      mandateId: challenge.mandateId,
      nonce: challenge.nonce,
      signature,
      expectedVersion: readyDraft.version,
      operationId: crypto.randomUUID(),
      approvedAidLines,
    },
    approverToken
  );
  expect(decideRes.status).toBe(200);
  const approvedDraft = (await decideRes.json()).draft;
  expect(approvedDraft.status).toBe("APPROVED");

  return { draft: approvedDraft, programId, amilToken, examinerToken, approverToken, adminToken };
}

type Draft = Awaited<ReturnType<typeof prepareApprovedProposal>>["draft"];

const item = (draft: Draft, index: number, overrides: Record<string, unknown> = {}) => ({
  aidLineId: draft.aidLines[index].id,
  beneficiaryId: draft.beneficiaries[index].id,
  reportedAt: clock - 3600,
  method: "CASH",
  amountIdr: "500000",
  ...overrides,
});

const realize = (draft: Draft, token: string, items: unknown[], extra: Record<string, unknown> = {}) =>
  post(`/proposals/${draft.id}/realizations`, { operationId: crypto.randomUUID(), expectedVersion: draft.version, items, ...extra }, token);

async function realizeOne(draft: Draft, token: string, overrides: Record<string, unknown> = {}) {
  const res = await realize(draft, token, [item(draft, 0, overrides)]);
  expect(res.status).toBe(201);
  return (await res.json()).records[0];
}

const upload = (draft: Draft, realizationId: string, token: string, input: Record<string, unknown>) =>
  post(
    `/proposals/${draft.id}/realizations/${realizationId}/documents`,
    {
      operationId: crypto.randomUUID(),
      fileName: "bukti.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from(`bukti ${crypto.randomUUID()}`).toString("base64"),
      ...input,
    },
    token
  );

const summaryOf = async (draft: Draft, token: string) =>
  (await (await get(`/proposals/${draft.id}/realization-summary`, token)).json()).summary;

/** The only way to learn the code: read what the fixture transport "delivered" to the recipient. */
const deliveredCode = () => /kode (\d{6})/.exec(outbox.at(-1)?.body ?? "")?.[1] ?? "";

const issueOtp = (draft: Draft, realizationId: string, token: string, contact = FIXTURE_CONTACT) =>
  post(`/proposals/${draft.id}/realizations/${realizationId}/otp-challenge`, { recipientContact: contact }, token);

const verifyOtp = (draft: Draft, realizationId: string, token: string, nonce: string, otpCode: string) =>
  post(`/proposals/${draft.id}/realizations/${realizationId}/otp-verify`, { nonce, otpCode }, token);

async function rowsOf(query: string) {
  const result: any = await database.handle().execute((await import("drizzle-orm")).sql.raw(query));
  return (result.rows ?? result) as any[];
}

describe("Realisasi IDR bertahap dan bukti pembayaran (Ticket #94)", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "disbursement-realization-test-"));
    files = createEncryptedFileStore({ directory: tempDir, key: FILE_KEY });
    database = await createTestWorkspaceDatabase(process.env.REALIZATION_TEST_DATABASE_URL);
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
    outbox = [];
    transportFails = false;
    await database.reset();
    configure();

    for (const inst of SYNTHETIC_INSTITUTIONS) {
      await store.upsertInstitution(institutionRecordOf(inst));
    }

    await store.upsertMembership({ institutionId: SINAR, account: adminSinar.address, role: "ADMIN" });
    await store.upsertMembership({ institutionId: SINAR, account: amilSinar.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: SINAR, account: examinerSinar.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: SINAR, account: approverSinar.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: BAITUL, account: adminBaitul.address, role: "ADMIN" });
    await store.upsertMembership({ institutionId: BAITUL, account: amilBaitul.address, role: "OFFICER" });

    const officers = [
      ["off-admin-sinar", "Admin Sinar", adminSinar, "ADMIN"],
      ["off-amil-sinar", "Ahmad Amil", amilSinar, "OFFICER"],
      ["off-examiner-sinar", "Budi Pemeriksa", examinerSinar, "OFFICER"],
      ["off-approver-sinar", "Citra Direktur", approverSinar, "OFFICER"],
    ] as const;
    for (const [id, displayName, account, role] of officers) {
      await store.createOfficerProfile({ id, institutionId: SINAR, displayName, account: account.address, role, actor: adminSinar.address, now: clock });
    }
    await store.createOfficerProfile({
      id: "off-amil-baitul", institutionId: BAITUL, displayName: "Amil Baitul", account: amilBaitul.address,
      role: "OFFICER", actor: adminBaitul.address, now: clock,
    });

    const mandates = [
      ["off-admin-sinar", "MANAGE_PROGRAMS", "SK-000/ADMIN"],
      ["off-amil-sinar", "PREPARE_PROPOSALS", "SK-001/AMIL"],
      ["off-amil-sinar", "RECORD_REALIZATION", "SK-001/REALISASI"],
      ["off-examiner-sinar", "EXAMINE_PROPOSALS", "SK-002/EXAMINER"],
      ["off-approver-sinar", "APPROVE_DECISIONS", "SK-003/DIREKTUR"],
    ] as const;
    for (const [officerId, fn, assignmentRef] of mandates) {
      await store.grantMandate({
        institutionId: SINAR,
        actor: adminSinar.address,
        now: clock,
        mandate: { officerId, function: fn, scopeType: "ALL_PROGRAMS", assignmentRef, validFrom: clock - 1000, validUntil: clock + 86400 * 30 },
      });
    }
    await store.grantMandate({
      institutionId: BAITUL,
      actor: adminBaitul.address,
      now: clock,
      mandate: {
        officerId: "off-amil-baitul", function: "RECORD_REALIZATION", scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK-B/REALISASI", validFrom: clock - 1000, validUntil: clock + 86400 * 30,
      },
    });
  });

  it("explains the recording, separates reported time from server time and operator, and requires a retry identity and version", async () => {
    const { draft, amilToken } = await prepareApprovedProposal();
    const reportedAt = clock - 7200;

    const withoutRetryIdentity = await post(
      `/proposals/${draft.id}/realizations`,
      { expectedVersion: draft.version, items: [item(draft, 0, { reportedAt })] },
      amilToken
    );
    expect(withoutRetryIdentity.status).toBe(400);
    const withoutVersion = await post(
      `/proposals/${draft.id}/realizations`,
      { operationId: crypto.randomUUID(), items: [item(draft, 0, { reportedAt })] },
      amilToken
    );
    expect(withoutVersion.status).toBe(400);

    const res = await realize(draft, amilToken, [item(draft, 0, { reportedAt, notes: "Penyerahan tunai di kantor" })]);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.notice).toBe(REALIZATION_DISCLAIMER_NOTICE);
    const record = body.records[0];
    expect(record.reportedAt).toBe(reportedAt);
    expect(record.recordedAt).toBe(clock);
    expect(record.operatorOfficerId).toBe("off-amil-sinar");
    expect(record.operatorAccount).toBe(amilSinar.address.toLowerCase());
    expect(record.paymentRecipient).toBeNull();
    expect(record).toMatchObject({ evidenceStatus: "EVIDENCE_PENDING", confirmationStatus: "UNCONFIRMED", confirmationMethod: null, version: 1 });
  });

  it("pays a school for a beneficiary with exact large IDR amounts, without changing the beneficiary identity", async () => {
    const { draft, amilToken } = await prepareApprovedProposal({ perBeneficiaryAmount: "900000000000000001" });
    const school = { name: "SMK TI Sinar Harapan", relation: "Sekolah penerima manfaat" };

    const first = await realizeOne(draft, amilToken, { method: "BANK_TRANSFER", amountIdr: "900000000000000000", paymentRecipient: school });
    expect(first.paymentRecipient).toEqual(school);
    const second = await realizeOne(draft, amilToken, { method: "BANK_TRANSFER", amountIdr: "1", paymentRecipient: school });
    expect(second.amountIdr).toBe("1");

    const summary = await summaryOf(draft, amilToken);
    expect(summary.totalApprovedIdr).toBe("900000000000000001");
    expect(summary.totalRealizedIdr).toBe("900000000000000001");
    expect(summary.totalRemainingIdr).toBe("0");
    expect(summary.disbursementStatus).toBe("FULLY_REALIZED");
    expect(summary.evidenceCompleteness).toBe("EVIDENCE_PENDING");
    expect(summary.lines[0].paymentRecipients).toEqual([school]);
    expect(summary.lines[0].beneficiaryName).toBe("Mustahik 1");

    const incompleteRecipient = await realize(draft, amilToken, [item(draft, 0, { amountIdr: "1", paymentRecipient: { name: "Sekolah" } })]);
    expect(incompleteRecipient.status).toBe(400);

    const currentDraft = (await (await get(`/proposals/${draft.id}`, amilToken)).json()).draft;
    expect(currentDraft.beneficiaries[0].name).toBe("Mustahik 1");
    expect(currentDraft.beneficiaries[0].identityBasis.value).toBe("3201123456000001");
    expect(currentDraft.beneficiaries[0].paymentRecipient).toBeNull();
  });

  it("Skenario 13: 80 of 100 beneficiaries realized is partial, and unique beneficiaries differ from payment events", async () => {
    const { draft, amilToken } = await prepareApprovedProposal({ beneficiariesCount: 100, perBeneficiaryAmount: "500000" });

    const items = Array.from({ length: 80 }, (_, i) => item(draft, i, { amountIdr: "300000" }));
    const res = await realize(draft, amilToken, items);
    expect(res.status).toBe(201);
    expect((await res.json()).records.length).toBe(80);
    await realizeOne(draft, amilToken, { amountIdr: "200000" });

    const summary = await summaryOf(draft, amilToken);
    expect(summary.totalApprovedIdr).toBe("50000000");
    expect(summary.totalRealizedIdr).toBe("24200000");
    expect(summary.totalRemainingIdr).toBe("25800000");
    expect(summary.approvedBeneficiaryCount).toBe(100);
    expect(summary.realizedBeneficiaryCount).toBe(80);
    expect(summary.paymentEventCount).toBe(81);
    expect(summary.disbursementStatus).toBe("PARTIALLY_REALIZED");
    expect(summary.lines[0].status).toBe("FULLY_REALIZED");
    expect(summary.lines[1].status).toBe("PARTIALLY_REALIZED");
    expect(summary.lines[99].status).toBe("NOT_REALIZED");
  });

  it("Skenario 14: caps rights atomically under concurrent requests, replays a lost response, and refuses a stale version", async () => {
    const { draft, amilToken } = await prepareApprovedProposal({ perBeneficiaryAmount: "1000000" });

    const [a, b] = await Promise.all([
      realize(draft, amilToken, [item(draft, 0, { amountIdr: "600000" })]),
      realize(draft, amilToken, [item(draft, 0, { amountIdr: "600000" })]),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await summaryOf(draft, amilToken)).totalRealizedIdr).toBe("600000");

    const over = await realize(draft, amilToken, [item(draft, 0, { amountIdr: "400001" })]);
    expect(over.status).toBe(409);
    expect((await over.json()).error).toContain("melebihi sisa hak yang disetujui");

    // The same retry identity sent twice at once (a double tap, or a retry after a lost response).
    const retryBody = { operationId: "op-retry-001", expectedVersion: draft.version, items: [item(draft, 0, { amountIdr: "400000" })] };
    const [first, retried] = await Promise.all([
      post(`/proposals/${draft.id}/realizations`, retryBody, amilToken),
      post(`/proposals/${draft.id}/realizations`, retryBody, amilToken),
    ]);
    expect([first.status, retried.status]).toEqual([201, 201]);
    expect((await first.json()).records[0].id).toBe((await retried.json()).records[0].id);
    expect((await rowsOf("SELECT id FROM disbursement_realizations")).length).toBe(2);

    const reused = await post(`/proposals/${draft.id}/realizations`, { ...retryBody, items: [item(draft, 0, { amountIdr: "1" })] }, amilToken);
    expect(reused.status).toBe(409);

    const stale = await realize(draft, amilToken, [item(draft, 0, { amountIdr: "1" })], { expectedVersion: draft.version + 1 });
    expect(stale.status).toBe(409);
  });

  it("refuses malformed amounts everywhere with 400 and keeps the summary readable", async () => {
    const { draft, amilToken } = await prepareApprovedProposal();
    const rec = await realizeOne(draft, amilToken);

    for (const amountIdr of ["abc", "0", "-5", "1.5", "1234567890123456789", " "]) {
      expect((await realize(draft, amilToken, [item(draft, 0, { amountIdr })])).status).toBe(400);
      expect((await post(`/proposals/${draft.id}/advances`, { amountIdr, purpose: "Transport", reference: "ADV-1" }, amilToken)).status).toBe(400);
      expect((await post(`/proposals/${draft.id}/expenses`, { amountIdr, purpose: "Sewa", payee: "Rental", documentRef: "KWT-1" }, amilToken)).status).toBe(400);
      expect((await post(
        `/proposals/${draft.id}/realizations/${rec.id}/disputes`,
        { complainantType: "BENEFICIARY", subject: "AMOUNT", reason: "Kurang", disputedAmountIdr: amountIdr },
        amilToken
      )).status).toBe(400);
      expect((await upload(draft, rec.id, amilToken, { documentType: "RECEIPT_OR_BAST", allocations: [{ realizationId: rec.id, amountIdr }] })).status).toBe(400);
    }

    const summaryRes = await get(`/proposals/${draft.id}/realization-summary`, amilToken);
    expect(summaryRes.status).toBe(200);
    expect((await summaryRes.json()).summary.totalExpensesIdr).toBe("0");
  });

  it("counts reported events with incomplete evidence against rights, and completes evidence only with the method's document and amount", async () => {
    const { draft, amilToken } = await prepareApprovedProposal({ perBeneficiaryAmount: "800000", purpose: "Bantuan biaya sekolah" });
    const rec = await realizeOne(draft, amilToken, { amountIdr: "800000" });

    const pending = await summaryOf(draft, amilToken);
    expect(pending.totalRemainingIdr).toBe("0");
    expect(pending.disbursementStatus).toBe("FULLY_REALIZED");
    expect(pending.evidenceCompleteness).toBe("EVIDENCE_PENDING");
    expect(pending.totalPendingEvidenceIdr).toBe("800000");

    const queue = (await (await get("/proposals/queue/incomplete-evidence", amilToken)).json()).queue;
    expect(queue).toEqual([{ proposalId: draft.id, purpose: "Bantuan biaya sekolah", pendingCount: 1, totalPendingIdr: "800000", goods: [], oldestPendingReportedAt: clock - 3600 }]);

    // A photo supports, never completes, and is never allocated an amount.
    expect((await upload(draft, rec.id, amilToken, { documentType: "SUPPORTING_PHOTO", allocations: [{ realizationId: rec.id, amountIdr: "800000" }] })).status).toBe(400);
    const photo = await upload(draft, rec.id, amilToken, { documentType: "SUPPORTING_PHOTO" });
    expect(photo.status).toBe(201);
    expect((await photo.json()).realizations[0].evidenceStatus).toBe("EVIDENCE_PENDING");

    // Cash is evidenced by a receipt/BAST, never a transfer proof, and never without the amount it covers.
    expect((await upload(draft, rec.id, amilToken, { documentType: "PAYMENT_PROOF", allocations: [{ realizationId: rec.id, amountIdr: "800000" }] })).status).toBe(400);
    expect((await upload(draft, rec.id, amilToken, { documentType: "RECEIPT_OR_BAST" })).status).toBe(400);

    const firstReceipt = await upload(draft, rec.id, amilToken, { documentType: "RECEIPT_OR_BAST", allocations: [{ realizationId: rec.id, amountIdr: "500000" }] });
    expect(firstReceipt.status).toBe(201);
    const firstBody = await firstReceipt.json();
    expect(firstBody.realizations[0].evidenceStatus).toBe("EVIDENCE_PENDING");
    expect(firstBody.document.storageRef).toBeUndefined();
    expect(firstBody.document.allocations).toEqual([{ realizationId: rec.id, amountIdr: "500000" }]);

    expect((await upload(draft, rec.id, amilToken, { documentType: "RECEIPT_OR_BAST", allocations: [{ realizationId: rec.id, amountIdr: "300001" }] })).status).toBe(400);

    // Retrying the same upload does not add a second document.
    const retryInput = { operationId: "op-upload-retry", documentType: "RECEIPT_OR_BAST", contentBase64: Buffer.from("kuitansi sisa").toString("base64"), allocations: [{ realizationId: rec.id, amountIdr: "300000" }] };
    const completed = await upload(draft, rec.id, amilToken, retryInput);
    const replayed = await upload(draft, rec.id, amilToken, retryInput);
    expect([completed.status, replayed.status]).toEqual([201, 201]);
    const completedBody = await completed.json();
    expect((await replayed.json()).document.id).toBe(completedBody.document.id);
    expect(completedBody.realizations[0]).toMatchObject({ evidenceStatus: "EVIDENCE_COMPLETE", version: 2 });

    const documents = (await (await get(`/proposals/${draft.id}/realization-documents`, amilToken)).json()).documents;
    expect(documents.map((doc: any) => doc.documentType)).toEqual(["SUPPORTING_PHOTO", "RECEIPT_OR_BAST", "RECEIPT_OR_BAST"]);

    const complete = await summaryOf(draft, amilToken);
    expect(complete.evidenceCompleteness).toBe("EVIDENCE_COMPLETE");
    expect(complete.totalPendingEvidenceIdr).toBe("0");
    expect((await (await get("/proposals/queue/incomplete-evidence", amilToken)).json()).queue).toEqual([]);
  });

  it("allocates one group BAST explicitly to every realization of the handover batch", async () => {
    const { draft, amilToken } = await prepareApprovedProposal({ beneficiariesCount: 4, perBeneficiaryAmount: "250000" });
    const grouped = await realize(draft, amilToken, [0, 1, 2].map((i) => item(draft, i, { amountIdr: "250000" })), { batchGroupId: "serah-terima-balai-desa" });
    expect(grouped.status).toBe(201);
    const [r1, r2, r3] = (await grouped.json()).records;
    expect(r1.batchGroupId).toBe("serah-terima-balai-desa");
    const outsider = (await (await realize(draft, amilToken, [item(draft, 3, { amountIdr: "250000" })])).json()).records[0];

    const outsideBatch = await upload(draft, r1.id, amilToken, {
      documentType: "RECEIPT_OR_BAST",
      allocations: [{ realizationId: r1.id, amountIdr: "250000" }, { realizationId: outsider.id, amountIdr: "250000" }],
    });
    expect(outsideBatch.status).toBe(400);
    const withoutAnchor = await upload(draft, r1.id, amilToken, {
      documentType: "RECEIPT_OR_BAST",
      allocations: [{ realizationId: r2.id, amountIdr: "250000" }],
    });
    expect(withoutAnchor.status).toBe(400);

    const groupBast = await upload(draft, r1.id, amilToken, {
      documentType: "RECEIPT_OR_BAST",
      fileName: "bast-kelompok.pdf",
      allocations: [r3, r1, r2].map((r: any) => ({ realizationId: r.id, amountIdr: "250000" })),
    });
    expect(groupBast.status).toBe(201);
    const body = await groupBast.json();
    expect(body.document.batchGroupId).toBe("serah-terima-balai-desa");
    expect(body.document.allocations.map((a: any) => a.realizationId).sort()).toEqual([r1.id, r2.id, r3.id].sort());
    expect(body.realizations.every((r: any) => r.evidenceStatus === "EVIDENCE_COMPLETE")).toBe(true);

    const summary = await summaryOf(draft, amilToken);
    expect(summary.completeEvidenceCount).toBe(3);
    expect(summary.pendingEvidenceCount).toBe(1);
  });

  it("keeps evidence private: no locator in responses, integrity-checked download, mandate required, proposal file access unchanged", async () => {
    const { draft, amilToken, adminToken, approverToken } = await prepareApprovedProposal();
    const other = await prepareApprovedProposal();
    const rec = await realizeOne(draft, amilToken);

    const content = "Tanda terima bertanda tangan basah";
    const doc = (await (await upload(draft, rec.id, amilToken, {
      documentType: "RECEIPT_OR_BAST",
      contentBase64: Buffer.from(content).toString("base64"),
      allocations: [{ realizationId: rec.id, amountIdr: "500000" }],
    })).json()).document;

    const downloaded = await get(`/proposals/${draft.id}/realization-documents/${doc.id}`, amilToken);
    expect(downloaded.status).toBe(200);
    expect(await downloaded.text()).toBe(content);
    expect((await get(`/proposals/${draft.id}/realization-documents/${doc.id}`, approverToken)).status).toBe(200);

    // The admin holds no operational mandate for this program.
    expect((await get(`/proposals/${draft.id}/realization-documents/${doc.id}`, adminToken)).status).toBe(403);
    // A document is only reachable under its own proposal.
    expect((await get(`/proposals/${other.draft.id}/realization-documents/${doc.id}`, amilToken)).status).toBe(404);
    expect((await upload(other.draft, rec.id, amilToken, { documentType: "SUPPORTING_PHOTO" })).status).toBe(404);

    const stored = (await rowsOf("SELECT storage_ref FROM disbursement_realization_documents"))[0].storage_ref;
    expect(JSON.stringify(await (await get(`/proposals/${draft.id}/realization-documents`, amilToken)).json())).not.toContain(stored);
  });

  it("confirms a cash handover by OTP delivered only to the recipient, bound to the event version, with expiry, replay and attempt limits", async () => {
    const { draft, amilToken, approverToken } = await prepareApprovedProposal({ beneficiariesCount: 3, perBeneficiaryAmount: "1000000" });
    const [rec, other, transfer] = (await (await realize(draft, amilToken, [
      item(draft, 0, { amountIdr: "750000" }),
      item(draft, 1),
      item(draft, 2, { method: "BANK_TRANSFER" }),
    ])).json()).records;

    const issued = await issueOtp(draft, rec.id, amilToken);
    expect(issued.status).toBe(201);
    const challenge = await issued.json();
    expect(Object.keys(challenge).sort()).toEqual(["contactHint", "expiresAt", "nonce", "success"]);
    expect(challenge.contactHint).toBe("*********123");
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe(FIXTURE_CONTACT);
    expect(outbox[0]!.body).toContain("Bantuan Biaya Pendidikan");
    expect(outbox[0]!.body).toContain("750.000");
    const code = deliveredCode();

    const [stored] = await rowsOf("SELECT * FROM disbursement_realization_challenges");
    expect(JSON.stringify(stored)).not.toContain(FIXTURE_CONTACT);
    expect(stored.code_hash).not.toBe(code);
    expect(stored.realization_version).toBe(1);

    const wrong = await verifyOtp(draft, rec.id, amilToken, challenge.nonce, code === "000000" ? "111111" : "000000");
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error).toContain("Sisa percobaan: 4");

    // Another realization's nonce, and a caller without the recording mandate, are refused.
    expect((await verifyOtp(draft, other.id, amilToken, challenge.nonce, code)).status).toBe(401);
    expect((await verifyOtp(draft, rec.id, approverToken, challenge.nonce, code)).status).toBe(403);

    const ok = await verifyOtp(draft, rec.id, amilToken, challenge.nonce, code);
    expect(ok.status).toBe(200);
    expect((await ok.json()).realization).toMatchObject({ confirmationStatus: "CONFIRMED", confirmationMethod: "OTP", version: 2 });
    expect((await verifyOtp(draft, rec.id, amilToken, challenge.nonce, code)).status).toBe(401);
    expect((await issueOtp(draft, rec.id, amilToken)).status).toBe(409);

    // A transfer is not labelled a recipient confirmation.
    expect((await issueOtp(draft, transfer.id, amilToken)).status).toBe(409);

    // Expiry.
    const expiring = await (await issueOtp(draft, other.id, amilToken)).json();
    const expiringCode = deliveredCode();
    clock += 901;
    expect((await verifyOtp(draft, other.id, amilToken, expiring.nonce, expiringCode)).status).toBe(401);

    // A newer code voids the older one; five wrong attempts spend the challenge.
    const older = await (await issueOtp(draft, other.id, amilToken)).json();
    const olderCode = deliveredCode();
    const newer = await (await issueOtp(draft, other.id, amilToken)).json();
    const newerCode = deliveredCode();
    expect((await verifyOtp(draft, other.id, amilToken, older.nonce, olderCode)).status).toBe(401);
    const wrongCode = newerCode === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await verifyOtp(draft, other.id, amilToken, newer.nonce, wrongCode)).status).toBe(400);
    }
    expect((await verifyOtp(draft, other.id, amilToken, newer.nonce, newerCode)).status).toBe(401);

    // The code binds the event version: evidence added after sending invalidates it.
    const bound = await (await issueOtp(draft, other.id, amilToken)).json();
    const boundCode = deliveredCode();
    expect((await upload(draft, other.id, amilToken, { documentType: "RECEIPT_OR_BAST", allocations: [{ realizationId: other.id, amountIdr: "500000" }] })).status).toBe(201);
    const changed = await verifyOtp(draft, other.id, amilToken, bound.nonce, boundCode);
    expect(changed.status).toBe(401);
    expect((await changed.json()).error).toContain("berubah");
  });

  it("rejects an OTP destination outside the approved beneficiary contact", async () => {
    const { draft, amilToken } = await prepareApprovedProposal();
    const rec = await realizeOne(draft, amilToken);
    expect((await issueOtp(draft, rec.id, amilToken, "081299999999")).status).toBe(400);
    expect(outbox).toHaveLength(0);
    expect(await rowsOf("SELECT nonce FROM disbursement_realization_challenges")).toHaveLength(0);
  });

  it("binds a registered representative to the immutable proposal version and refuses absent contacts", async () => {
    const { draft, amilToken } = await prepareApprovedProposal({ beneficiary: {
      guardian: { name: "Ibu Sintetis", relationship: "Ibu" }, contact: { email: "wali@example.test", relation: "Ibu" },
    } });
    const rec = await realizeOne(draft, amilToken);
    const challenge = await issueOtp(draft, rec.id, amilToken, "wali@example.test");
    expect(challenge.status).toBe(201);
    const { nonce } = await challenge.json();
    const [stored] = await rowsOf("SELECT confirmer_json FROM disbursement_realization_challenges");
    expect(JSON.parse(stored.confirmer_json)).toEqual({ beneficiaryName: "Mustahik 1", guardian: { name: "Ibu Sintetis", relationship: "Ibu" }, contactRelation: "Ibu" });
    expect((await verifyOtp(draft, rec.id, amilToken, nonce, deliveredCode())).status).toBe(200);
    const noContact = await prepareApprovedProposal({ beneficiary: { contact: null } });
    const other = await realizeOne(noContact.draft, noContact.amilToken);
    expect((await issueOtp(noContact.draft, other.id, noContact.amilToken)).status).toBe(400);
  });

  it("refuses full BAST confirmation until allocated receipts cover the amount", async () => {
    const { draft, amilToken, examinerToken } = await prepareApprovedProposal();
    const rec = await realizeOne(draft, amilToken);
    await upload(draft, rec.id, amilToken, { documentType: "RECEIPT_OR_BAST", allocations: [{ realizationId: rec.id, amountIdr: "1" }] });
    const path = `/proposals/${draft.id}/realizations/${rec.id}/bast-verify`;
    expect((await post(path, { notes: "Periksa nominal" }, examinerToken)).status).toBe(409);
    expect((await summaryOf(draft, amilToken)).confirmedCount).toBe(0);
    await upload(draft, rec.id, amilToken, { documentType: "RECEIPT_OR_BAST", allocations: [{ realizationId: rec.id, amountIdr: "499999" }] });
    expect((await post(path, { notes: "Seluruh nominal terbukti" }, examinerToken)).status).toBe(200);
  });

  it("replays advance, expense, dispute and examination writes without duplicating durable records", async () => {
    const { draft, amilToken, examinerToken } = await prepareApprovedProposal();
    const retry = async (path: string, input: object, token: string, status: number) => {
      const body = { ...input, operationId: crypto.randomUUID() };
      const [a, b] = await Promise.all([post(path, body, token), post(path, body, token)]);
      expect(a.status).toBe(status); expect(b.status).toBe(status);
      const result = await a.json();
      expect(await b.json()).toEqual(result);
      await database.reopen();
      store = createWorkspaceStore(database.handle());
      disbursement = createDisbursementStore(database.handle());
      activities = createActivityStore(database.handle());
      configure();
      expect(await (await post(path, body, token)).json()).toEqual(result);
      expect((await post(path, { ...body, notes: "different payload" }, token)).status).toBe(409);
      return result;
    };
    const { advance } = await retry(`/proposals/${draft.id}/advances`, { amountIdr: "1000000", purpose: "Transport", reference: "ADV-retry" }, amilToken, 201);
    await retry(`/proposals/${draft.id}/expenses`, { advanceId: advance.id, amountIdr: "100000", purpose: "Transport", payee: "Rental", documentRef: "KWT-1" }, amilToken, 201);
    const rec = await realizeOne(draft, amilToken);
    const path = `/proposals/${draft.id}/realizations/${rec.id}/disputes`;
    const { dispute } = await retry(path, { complainantType: "BENEFICIARY", subject: "AMOUNT", reason: "Jumlah berbeda", disputedAmountIdr: "100000" }, amilToken, 201);
    await retry(`${path}/${dispute.id}/examinations`, { outcome: "RESOLVED", notes: "Diperiksa" }, examinerToken, 200);
    for (const table of ["advances", "expenses", "disputes", "dispute_examinations"]) {
      expect(await rowsOf(`SELECT id FROM disbursement_realization_${table}`)).toHaveLength(1);
    }
  });

  it("answers 503 without a message transport or when delivery fails, leaving no redeemable challenge", async () => {
    const { draft, amilToken } = await prepareApprovedProposal();
    const rec = await realizeOne(draft, amilToken);

    configure({ messages: undefined });
    expect((await issueOtp(draft, rec.id, amilToken)).status).toBe(503);
    expect(await rowsOf("SELECT nonce FROM disbursement_realization_challenges")).toEqual([]);

    configure();
    transportFails = true;
    expect((await issueOtp(draft, rec.id, amilToken)).status).toBe(503);
    const [voided] = await rowsOf("SELECT consumed_at FROM disbursement_realization_challenges");
    expect(Number(voided.consumed_at)).toBe(clock);
    expect((await issueOtp(draft, rec.id, amilToken, "not-a-contact")).status).toBe(400);
  });

  it("confirms by a BAST examined by an officer other than the recorder, only once a receipt is uploaded", async () => {
    const { draft, amilToken, examinerToken, adminToken } = await prepareApprovedProposal({ beneficiariesCount: 2, perBeneficiaryAmount: "1000000" });
    const [rec, transfer] = (await (await realize(draft, amilToken, [item(draft, 0), item(draft, 1, { method: "BANK_TRANSFER" })])).json()).records;
    const bastVerify = (id: string, token: string) =>
      post(`/proposals/${draft.id}/realizations/${id}/bast-verify`, { notes: "Tanda tangan dan identitas sesuai." }, token);

    expect((await bastVerify(rec.id, examinerToken)).status).toBe(409);
    await upload(draft, rec.id, amilToken, { documentType: "RECEIPT_OR_BAST", allocations: [{ realizationId: rec.id, amountIdr: "500000" }] });

    const self = await bastVerify(rec.id, amilToken);
    expect(self.status).toBe(403);
    expect((await self.json()).error).toContain("Petugas pencatat tidak dapat memverifikasi BAST miliknya sendiri");
    expect((await bastVerify(rec.id, adminToken)).status).toBe(403);

    const verified = await bastVerify(rec.id, examinerToken);
    expect(verified.status).toBe(200);
    const body = await verified.json();
    expect(body.realization).toMatchObject({ confirmationStatus: "CONFIRMED", confirmationMethod: "BAST_EXAMINED" });
    expect(body.examination.verifierOfficerId).toBe("off-examiner-sinar");
    expect((await bastVerify(rec.id, examinerToken)).status).toBe(409);

    await upload(draft, transfer.id, amilToken, { documentType: "PAYMENT_PROOF", allocations: [{ realizationId: transfer.id, amountIdr: "500000" }] });
    expect((await bastVerify(transfer.id, examinerToken)).status).toBe(409);
    expect((await summaryOf(draft, amilToken)).confirmedCount).toBe(1);
  });

  it("confirms a whole group handover in one call, reporting each member's own outcome (batch BAST)", async () => {
    const { draft, amilToken, examinerToken } = await prepareApprovedProposal({ beneficiariesCount: 4, perBeneficiaryAmount: "250000" });
    const grouped = await realize(draft, amilToken, [0, 1, 2].map((i) => item(draft, i, { amountIdr: "250000" })), { batchGroupId: "serah-terima-balai-desa" });
    expect(grouped.status).toBe(201);
    const [r1, r2, r3] = (await grouped.json()).records;
    const outsider = (await (await realize(draft, amilToken, [item(draft, 3, { amountIdr: "250000" })])).json()).records[0];

    const batchPath = `/proposals/${draft.id}/realization-batches/serah-terima-balai-desa/bast-verify`;

    // A missing batch group answers not-found, not an empty success.
    expect((await post(`/proposals/${draft.id}/realization-batches/tidak-ada/bast-verify`, { notes: "x" }, examinerToken)).status).toBe(404);

    // Only r1 and r2 have their group BAST allocated; r3 is still short of evidence.
    await upload(draft, r1.id, amilToken, {
      documentType: "RECEIPT_OR_BAST", fileName: "bast-kelompok.pdf",
      allocations: [r1, r2].map((r: any) => ({ realizationId: r.id, amountIdr: "250000" })),
    });

    const first = await post(batchPath, { notes: "Diperiksa langsung di balai desa" }, examinerToken);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.confirmedCount).toBe(2);
    expect(firstBody.outcomes).toEqual(expect.arrayContaining([
      { realizationId: r1.id, beneficiaryId: r1.beneficiaryId, state: "CONFIRMED" },
      { realizationId: r2.id, beneficiaryId: r2.beneficiaryId, state: "CONFIRMED" },
      expect.objectContaining({ realizationId: r3.id, beneficiaryId: r3.beneficiaryId, state: "NOT_EVIDENCED" }),
    ]));
    expect(firstBody.outcomes).toHaveLength(3);
    // Only the batch's own members are touched.
    expect(firstBody.outcomes.some((o: any) => o.realizationId === outsider.id)).toBe(false);

    const summary = await summaryOf(draft, amilToken);
    expect(summary.confirmedCount).toBe(2);

    // Complete r3's evidence and dispute r2 before running the batch again.
    await upload(draft, r3.id, amilToken, { documentType: "RECEIPT_OR_BAST", allocations: [{ realizationId: r3.id, amountIdr: "250000" }] });
    const disputed = await post(`/proposals/${draft.id}/realizations/${r2.id}/disputes`, {
      complainantType: "OFFICER", subject: "AMOUNT", reason: "Selisih ditemukan saat rekap", disputedAmountIdr: "250000",
    }, amilToken);
    expect(disputed.status).toBe(201);

    // A retry is idempotent and honest: r1 was already confirmed, r2 is now held by a dispute,
    // and only r3 is newly confirmed - never a blanket re-success or a silent skip.
    const second = await post(batchPath, { notes: "Susulan" }, examinerToken);
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.confirmedCount).toBe(1);
    expect(secondBody.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ realizationId: r1.id, beneficiaryId: r1.beneficiaryId, state: "ALREADY_CONFIRMED" }),
      expect.objectContaining({ realizationId: r2.id, beneficiaryId: r2.beneficiaryId, state: "DISPUTED" }),
      { realizationId: r3.id, beneficiaryId: r3.beneficiaryId, state: "CONFIRMED" },
    ]));
  });

  it("never lets the batch confirm what the recording officer recorded themselves", async () => {
    const { draft, amilToken, examinerToken } = await prepareApprovedProposal({ beneficiariesCount: 2, perBeneficiaryAmount: "250000" });
    const grouped = await realize(draft, amilToken, [0, 1].map((i) => item(draft, i, { amountIdr: "250000" })), { batchGroupId: "serah-terima-mandiri" });
    const [r1, r2] = (await grouped.json()).records;
    await upload(draft, r1.id, amilToken, {
      documentType: "RECEIPT_OR_BAST", fileName: "bast.pdf",
      allocations: [r1, r2].map((r: any) => ({ realizationId: r.id, amountIdr: "250000" })),
    });

    // The recorder tries to confirm their own batch: every member is refused, none silently passes.
    const selfAttempt = await post(`/proposals/${draft.id}/realization-batches/serah-terima-mandiri/bast-verify`, { notes: "x" }, amilToken);
    expect(selfAttempt.status).toBe(200);
    expect((await selfAttempt.json()).outcomes.every((o: any) => o.state === "SELF_EXAMINATION")).toBe(true);
    expect((await summaryOf(draft, amilToken)).confirmedCount).toBe(0);

    // A different officer confirms the same batch normally.
    const other = await post(`/proposals/${draft.id}/realization-batches/serah-terima-mandiri/bast-verify`, { notes: "Diperiksa" }, examinerToken);
    expect((await other.json()).confirmedCount).toBe(2);
  });

  it("keeps officer advances and expenses apart from aid, accounting expenses only against an advance of the same proposal", async () => {
    const { draft, amilToken, approverToken } = await prepareApprovedProposal({ perBeneficiaryAmount: "5000000" });
    const other = await prepareApprovedProposal();

    const advRes = await post(`/proposals/${draft.id}/advances`, { amountIdr: "1500000", purpose: "Transport relawan", reference: "ADV-OP-2026-001" }, amilToken);
    expect(advRes.status).toBe(201);
    const advance = (await advRes.json()).advance;
    expect(advance).toMatchObject({ amountIdr: "1500000", accountedIdr: "0", unaccountedIdr: "1500000", officerId: "off-amil-sinar" });
    expect((await post(`/proposals/${draft.id}/advances`, { amountIdr: "1", purpose: "x", reference: "y" }, approverToken)).status).toBe(403);

    const expense = (body: Record<string, unknown>, proposal = draft) =>
      post(`/proposals/${proposal.id}/expenses`, { amountIdr: "350000", purpose: "Sewa mobil", payee: "Rental Berkah", documentRef: "KWT-RENTAL-01", ...body }, amilToken);

    expect((await expense({ advanceId: "adv-tidak-ada" })).status).toBe(400);
    expect((await expense({ advanceId: advance.id }, other.draft)).status).toBe(400);
    expect((await expense({ advanceId: advance.id, amountIdr: "1500001" })).status).toBe(400);
    expect(await rowsOf("SELECT id FROM disbursement_realization_expenses")).toEqual([]);

    expect((await expense({ advanceId: advance.id })).status).toBe(201);
    expect((await expense({ advanceId: null, amountIdr: "50000", payee: "Fotokopi Jaya" })).status).toBe(201);

    const [listed] = (await (await get(`/proposals/${draft.id}/advances`, amilToken)).json()).advances;
    expect(listed).toMatchObject({ accountedIdr: "350000", unaccountedIdr: "1150000" });
    expect(Object.keys(listed)).not.toContain("status");

    const summary = await summaryOf(draft, amilToken);
    expect(summary).toMatchObject({ totalRealizedIdr: "0", totalRemainingIdr: "5000000", totalAdvancesIdr: "1500000", totalExpensesIdr: "400000" });
  });

  it("records a dispute after confirmation, holds confirmation, keeps the realization, and resolves only by an authorized examination with history", async () => {
    const { draft, amilToken, examinerToken, approverToken, adminToken } = await prepareApprovedProposal({ perBeneficiaryAmount: "2000000" });
    const rec = await realizeOne(draft, amilToken, { amountIdr: "2000000" });
    await upload(draft, rec.id, amilToken, { documentType: "RECEIPT_OR_BAST", allocations: [{ realizationId: rec.id, amountIdr: "2000000" }] });
    const challenge = await (await issueOtp(draft, rec.id, amilToken)).json();
    expect((await verifyOtp(draft, rec.id, amilToken, challenge.nonce, deliveredCode())).status).toBe(200);

    const disputeBody = { complainantType: "BENEFICIARY", subject: "AMOUNT", reason: "Mustahik hanya menerima Rp 1.500.000", disputedAmountIdr: "500000" };
    const disputesPath = `/proposals/${draft.id}/realizations/${rec.id}/disputes`;
    expect((await post(disputesPath, { ...disputeBody, disputedAmountIdr: "2000001" }, amilToken)).status).toBe(400);
    expect((await post(disputesPath, { ...disputeBody, subject: "DOCUMENTS" }, amilToken)).status).toBe(400);
    expect((await post(disputesPath, disputeBody, adminToken)).status).toBe(403);

    const dispRes = await post(disputesPath, disputeBody, approverToken);
    expect(dispRes.status).toBe(201);
    const disputed = await dispRes.json();
    expect(disputed.dispute).toMatchObject({ status: "OPEN", subject: "AMOUNT", recordedByOfficerId: "off-approver-sinar", examinations: [] });
    expect(disputed.realization).toMatchObject({ confirmationStatus: "DISPUTED", amountIdr: "2000000", evidenceStatus: "EVIDENCE_COMPLETE" });

    const held = await summaryOf(draft, amilToken);
    expect(held).toMatchObject({ totalRealizedIdr: "2000000", totalRemainingIdr: "0", disputedCount: 1, confirmedCount: 0 });
    expect(held.lines[0].isDisputed).toBe(true);
    expect((await issueOtp(draft, rec.id, amilToken)).status).toBe(409);
    expect((await post(`/proposals/${draft.id}/realizations/${rec.id}/bast-verify`, { notes: "Periksa" }, examinerToken)).status).toBe(409);

    const examine = (outcome: string, token: string) =>
      post(`${disputesPath}/${disputed.dispute.id}/examinations`, { outcome, notes: `Hasil ${outcome}` }, token);
    expect((await examine("EXAMINED", amilToken)).status).toBe(403);

    const examined = await examine("EXAMINED", examinerToken);
    expect(examined.status).toBe(200);
    const examinedBody = await examined.json();
    expect(examinedBody.dispute.status).toBe("EXAMINED");
    expect(examinedBody.realization.confirmationStatus).toBe("DISPUTED");

    const resolved = await examine("RESOLVED", examinerToken);
    expect(resolved.status).toBe(200);
    const resolvedBody = await resolved.json();
    expect(resolvedBody.dispute.status).toBe("RESOLVED");
    expect(resolvedBody.dispute.examinations.map((e: any) => e.outcome)).toEqual(["EXAMINED", "RESOLVED"]);
    expect(resolvedBody.realization).toMatchObject({ confirmationStatus: "UNCONFIRMED", confirmationMethod: null });
    expect((await examine("RESOLVED", examinerToken)).status).toBe(409);

    const history = (await (await get(disputesPath, amilToken)).json()).disputes;
    expect(history[0].examinations).toHaveLength(2);
    expect(await rowsOf("SELECT id FROM disbursement_realizations")).toHaveLength(1);
    expect((await summaryOf(draft, amilToken)).totalRealizedIdr).toBe("2000000");
  });

  it("isolates institutions and proposals, and applies nothing from an ended session", async () => {
    const { draft, amilToken } = await prepareApprovedProposal();
    const other = await prepareApprovedProposal();
    const rec = await realizeOne(draft, amilToken);
    const baitulToken = await signIn(amilBaitul, BAITUL);

    expect((await get(`/proposals/${draft.id}/realizations`, baitulToken)).status).toBe(404);
    expect((await get(`/proposals/${draft.id}/realization-summary`, baitulToken)).status).toBe(404);
    expect((await realize(draft, baitulToken, [item(draft, 0)])).status).toBe(404);
    expect((await issueOtp(draft, rec.id, baitulToken)).status).toBe(404);
    expect((await post(`/proposals/${draft.id}/realizations/${rec.id}/disputes`, { complainantType: "OFFICER", subject: "RECEIPT", reason: "x", disputedAmountIdr: "1" }, baitulToken)).status).toBe(404);

    // A realization id is only valid under its own proposal.
    expect((await issueOtp(other.draft, rec.id, amilToken)).status).toBe(404);
    expect(await (await get(`/proposals/${other.draft.id}/realizations/${rec.id}/disputes`, amilToken)).json()).toMatchObject({ disputes: [] });
    expect((await post(`/proposals/${other.draft.id}/realizations/${rec.id}/disputes`, { complainantType: "OFFICER", subject: "RECEIPT", reason: "x", disputedAmountIdr: "1" }, amilToken)).status).toBe(404);

    expect((await request("/session", { method: "DELETE", headers: { Authorization: `Bearer ${amilToken}` } })).status).toBeLessThan(300);
    expect((await realize(draft, amilToken, [item(draft, 0)])).status).toBe(401);
    const fresh = await signIn(amilSinar, SINAR);
    clock += 3601;
    expect((await realize(draft, fresh, [item(draft, 0)])).status).toBe(401);
    expect(await rowsOf("SELECT id FROM disbursement_realizations")).toHaveLength(1);
  });

  it("keeps realizations, evidence, disputes and retry results durable across a database restart", async () => {
    const { draft, amilToken, approverToken } = await prepareApprovedProposal({ perBeneficiaryAmount: "3000000" });
    const body = { operationId: "op-restart-01", expectedVersion: draft.version, items: [item(draft, 0, { amountIdr: "1200000" })] };
    const recorded = await (await post(`/proposals/${draft.id}/realizations`, body, amilToken)).json();
    const rec = recorded.records[0];
    await upload(draft, rec.id, amilToken, { documentType: "RECEIPT_OR_BAST", allocations: [{ realizationId: rec.id, amountIdr: "1200000" }] });
    await post(`/proposals/${draft.id}/realizations/${rec.id}/disputes`, { complainantType: "BENEFICIARY", subject: "RECEIPT", reason: "Belum menerima", disputedAmountIdr: "1200000" }, approverToken);

    await database.reopen();
    store = createWorkspaceStore(database.handle());
    disbursement = createDisbursementStore(database.handle());
    activities = createActivityStore(database.handle());
    await store.ensureSchema();
    await disbursement.ensureSchema();
    configure();

    const summary = await summaryOf(draft, amilToken);
    expect(summary).toMatchObject({ totalApprovedIdr: "3000000", totalRealizedIdr: "1200000", totalRemainingIdr: "1800000", evidenceCompleteness: "EVIDENCE_COMPLETE", disputedCount: 1 });
    expect((await (await get(`/proposals/${draft.id}/realization-documents`, amilToken)).json()).documents).toHaveLength(1);
    expect((await (await get(`/proposals/${draft.id}/realizations/${rec.id}/disputes`, amilToken)).json()).disputes).toHaveLength(1);

    const retried = await post(`/proposals/${draft.id}/realizations`, body, amilToken);
    expect(retried.status).toBe(201);
    expect((await retried.json()).records[0].id).toBe(rec.id);
    expect(await rowsOf("SELECT id FROM disbursement_realizations")).toHaveLength(1);
  });
  it("migrates the pre-goods schema without changing IDR records, evidence, disputes or OTP amounts", async () => {
    const { draft, amilToken } = await prepareApprovedProposal();
    const rec = await realizeOne(draft, amilToken, { amountIdr: "100000" });
    expect((await issueOtp(draft, rec.id, amilToken)).status).toBe(201);
    expect((await upload(draft, rec.id, amilToken, { documentType: "RECEIPT_OR_BAST",
      allocations: [{ realizationId: rec.id, amountIdr: "100000" }] })).status).toBe(201);
    expect((await post(`/proposals/${draft.id}/realizations/${rec.id}/disputes`, {
      complainantType: "OFFICER", subject: "AMOUNT", reason: "Periksa nominal historis", disputedAmountIdr: "10000",
    }, amilToken)).status).toBe(201);
    const legacyDonations = await rowsOf("SELECT * FROM donations ORDER BY id");
    const oldTables = ["disbursement_realizations", "disbursement_realization_document_allocations", "disbursement_realization_challenges", "disbursement_realization_disputes"];
    const original = new Map<string, any[]>();
    for (const table of oldTables) {
      const dispute = table.endsWith("disputes");
      await rowsOf(`ALTER TABLE ${table} DROP COLUMN ${dispute ? "disputed_quantity" : "quantity"}`);
      await rowsOf(`ALTER TABLE ${table} DROP COLUMN ${dispute ? "disputed_unit" : "unit"}`);
      await rowsOf(`ALTER TABLE ${table} ALTER COLUMN ${dispute ? "disputed_amount_idr" : "amount_idr"} SET NOT NULL`);
      original.set(table, await rowsOf(`SELECT * FROM ${table}`));
    }
    await disbursement.ensureSchema();
    await disbursement.ensureSchema();
    for (const table of oldTables) {
      const migrated = await rowsOf(`SELECT * FROM ${table}`);
      expect(migrated).toHaveLength(original.get(table)!.length);
      expect(migrated[0]).toMatchObject(original.get(table)![0]);
      expect(migrated[0][table.endsWith("disputes") ? "disputed_quantity" : "quantity"]).toBeNull();
    }
    expect(await rowsOf("SELECT * FROM donations ORDER BY id")).toEqual(legacyDonations);
    expect((await summaryOf(draft, amilToken)).totalRealizedIdr).toBe("100000");
    expect((await realize(draft, amilToken, [item(draft, 0, { amountIdr: "10000" })])).status).toBe(201);
  });

  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("browser: record, lose the response and retry safely, complete evidence and read back, on laptop and phone with the keyboard", async () => {
    const { draft, programId } = await prepareApprovedProposal({ beneficiariesCount: 2, perBeneficiaryAmount: "750000", purpose: "Realisasi Smoke" });
    let dropNextRealization = false;
    let dropNextWritePath: string | null = null;
    let walletAccount = amilSinar;

    const built = await Bun.build({
      entrypoints: [new URL("../../frontend/test/officer-smoke.tsx", import.meta.url).pathname],
      target: "browser",
      define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "" }) },
    });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const bundle = await built.outputs[0]!.text();
    const cssDirectory = new URL("../../frontend/.output/public/assets/", import.meta.url).pathname;
    const cssFiles = Array.from(new Bun.Glob("styles-*.css").scanSync(cssDirectory));
    if (!cssFiles.length) throw new Error("Jalankan frontend bun run build sebelum smoke browser agar CSS produksi diuji.");
    const css = await Bun.file(`${cssDirectory}/${cssFiles[0]}`).text();
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/") return new Response('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/smoke.css"><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
        if (path === "/smoke.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
        if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
        if (path === "/wallet-rpc") {
          const { method, params } = await req.json();
          if (["eth_accounts", "eth_requestAccounts"].includes(method)) return Response.json([walletAccount.address]);
          if (method === "eth_chainId") return Response.json("0x7a69");
          if (method === "eth_signTypedData_v4") return Response.json(await walletAccount.signTypedData(JSON.parse(params[1])));
          return Response.json(null);
        }
        if (dropNextRealization && req.method === "POST" && path.endsWith(`/proposals/${draft.id}/realizations`)) {
          dropNextRealization = false;
          await app.fetch(req);
          return new Response("gateway lost the response", { status: 502 });
        }
        if (req.method === "POST" && path === dropNextWritePath) {
          dropNextWritePath = null;
          await app.fetch(req);
          return new Response("lost response after commit", { status: 502 });
        }
        return app.fetch(req);
      },
    });

    let browser: any;
    try {
      const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
      browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
      const errors: string[] = [];
      const openProposal = async (viewport: { width: number; height: number }, account = amilSinar) => {
        walletAccount = account;
        const page = await browser.newPage({ viewport });
        await page.addInitScript((now: number) => { Date.now = () => now * 1000; }, NOW);
        page.setDefaultTimeout(10000);
        page.on("pageerror", (error: Error) => errors.push(error.message));
        await page.goto(server.url.toString());
        await page.getByRole("button", { name: /^0x/ }).waitFor();
        await page.getByLabel("Pengelola Zakat", { exact: true }).selectOption(SINAR);
        await page.waitForFunction((institution: string) => (document.querySelector("#institution") as HTMLSelectElement)?.value === institution, SINAR);
        await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();
        await page.getByLabel(/Program bantuan/).selectOption(programId);
        await page.getByRole("button", { name: /Realisasi Smoke/ }).click();
        await page.getByRole("heading", { name: "Realisasi penyaluran" }).waitFor();
        await page.getByText(REALIZATION_DISCLAIMER_NOTICE).first().waitFor();
        return page;
      };
      // The rest of the workspace page has its own wide tables; this ticket owns the realization section and its dialogs.
      const realizationOverflow = (page: any) => page.evaluate(() =>
        [...document.querySelectorAll("section[aria-labelledby^='realization-'] *, [role='dialog'] *")]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
          .map((el) => `${el.tagName}: ${(el.textContent ?? "").slice(0, 40)}`));
      const realizationCount = async () => (await rowsOf("SELECT id FROM disbursement_realizations")).length;

      // Laptop: the response is lost after the server committed; the retry replays it instead of recording twice.
      let page = await openProposal({ width: 1280, height: 900 });
      await page.getByRole("button", { name: "Catat realisasi", exact: true }).click();
      let dialog = page.getByRole("dialog");
      await dialog.getByRole("status").getByText("Belum tersimpan").waitFor();
      const amount = dialog.getByLabel("Nominal (Rp)");
      await amount.fill("");
      await amount.pressSequentially("500000");
      dropNextRealization = true;
      await amount.press("Enter");
      await dialog.getByRole("status").getByText("Hasil penyimpanan belum diketahui").waitFor();
      expect(await realizationCount()).toBe(1);
      expect(await dialog.getByLabel("Nominal (Rp)").isDisabled()).toBe(true);
      await dialog.getByRole("button", { name: "Kirim ulang penyimpanan" }).click();
      await dialog.getByRole("status").getByText("Realisasi tersimpan").waitFor();
      expect(await realizationCount()).toBe(1);

      await dialog.getByRole("button", { name: "Unggah bukti sekarang" }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByText("Lengkapi bukti realisasi").waitFor();
      await dialog.getByLabel("Berkas bukti").setInputFiles({ name: "bast-smoke.txt", mimeType: "text/plain", buffer: Buffer.from("BAST smoke") });
      expect(await dialog.getByLabel(/Mustahik 1 · belum berbukti/).inputValue()).toBe("500000");
      await dialog.getByRole("button", { name: "Unggah bukti" }).click();
      await page.getByText("Bukti lengkap", { exact: true }).first().waitFor();
      await page.screenshot({ path: "/tmp/issue94-laptop.png", fullPage: true });
      await page.close();

      // Read back from a fresh session: the event, its evidence and a working private download.
      page = await openProposal({ width: 1280, height: 900 });
      await page.getByText(/Mustahik 1 · Rp 500\.000/).waitFor();
      await page.getByText("Tanda terima / BAST: bast-smoke.txt").waitFor();
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Unduh bast-smoke.txt" }).click()]);
      expect(download.suggestedFilename()).toBe("bast-smoke.txt");
      await page.close();

      // Phone: record the second beneficiary with the keyboard only, without horizontal scrolling.
      page = await openProposal({ width: 390, height: 844 });
      expect(await realizationOverflow(page)).toEqual([]);
      await page.getByRole("button", { name: "Catat realisasi", exact: true }).focus();
      await page.keyboard.press("Enter");
      dialog = page.getByRole("dialog");
      await dialog.getByLabel(/Rincian bantuan/).selectOption("aid-2");
      expect(await realizationOverflow(page)).toEqual([]);
      await dialog.getByLabel("Cara penyaluran").focus();
      await page.keyboard.press("Tab");
      await dialog.getByRole("checkbox", { name: /Dibayarkan ke pihak lain/ }).press("Space");
      await dialog.getByLabel("Nama penerima pembayaran").fill("SD Negeri Smoke");
      await dialog.getByLabel("Hubungan dengan penerima manfaat").fill("Sekolah penerima manfaat");
      await dialog.getByLabel("Hubungan dengan penerima manfaat").press("Enter");
      await dialog.getByRole("status").getByText("Realisasi tersimpan").waitFor();
      await dialog.getByRole("button", { name: "Selesai" }).press("Enter");
      await page.getByText("Dibayarkan ke SD Negeri Smoke (Sekolah penerima manfaat)").waitFor();
      await page.getByText("Tersalurkan sebagian").waitFor();
      expect(await realizationOverflow(page)).toEqual([]);
      await page.screenshot({ path: "/tmp/issue94-phone.png", fullPage: true });

      expect(await realizationCount()).toBe(2);
      expect((await summaryOf(draft, await signIn(amilSinar, SINAR))).totalRealizedIdr).toBe("1250000");
      // Phone amendment: recipient OTP uses the fixture transport, then a dispute holds confirmation.
      const firstEvent = () => page.getByRole("list", { name: "Kejadian realisasi" }).locator(":scope > li").filter({ hasText: "Mustahik 1 ·" });
      await firstEvent().getByRole("button", { name: "Konfirmasi penerimaan", exact: true }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Kirim kode ke penerima" }).click();
      await dialog.getByLabel("Kode dari penerima (6 digit)").waitFor();
      await dialog.getByLabel("Kode dari penerima (6 digit)").fill(deliveredCode());
      await dialog.getByRole("button", { name: "Konfirmasi penerimaan", exact: true }).click();
      await firstEvent().getByText("Dikonfirmasi (OTP)", { exact: true }).waitFor();
      await firstEvent().getByRole("button", { name: "Keberatan", exact: true }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByLabel("Nominal yang diperselisihkan (Rp)").fill("100000");
      await dialog.getByLabel("Uraian keberatan").fill("Jumlah yang diterima perlu diperiksa.");
      const firstId = (await rowsOf("SELECT id FROM disbursement_realizations WHERE beneficiary_id = 'ben-1'"))[0].id;
      dropNextWritePath = `/api/workspace/proposals/${draft.id}/realizations/${firstId}/disputes`;
      await dialog.getByRole("button", { name: "Catat keberatan", exact: true }).click();
      await dialog.getByRole("status").getByText("Hasil penyimpanan belum diketahui").waitFor();
      expect(await rowsOf("SELECT id FROM disbursement_realization_disputes")).toHaveLength(1);
      await dialog.getByRole("button", { name: "Kirim ulang penyimpanan" }).click();
      await dialog.getByRole("status").getByText("Tersimpan", { exact: true }).waitFor();
      expect(await rowsOf("SELECT id FROM disbursement_realization_disputes")).toHaveLength(1);
      expect(await realizationOverflow(page)).toEqual([]);
      await dialog.getByRole("button", { name: "Tutup", exact: true }).click();
      await firstEvent().getByText("Diperselisihkan, konfirmasi ditahan (OTP)", { exact: true }).waitFor();

      await page.getByRole("button", { name: "Uang muka & biaya", exact: true }).click();
      dialog = page.getByRole("dialog");
      const advanceForm = dialog.locator("form").nth(0);
      await advanceForm.getByLabel("Nominal (Rp)").fill("1000000");
      await advanceForm.getByLabel("Tujuan", { exact: true }).fill("Transport lapangan");
      await advanceForm.getByLabel("Referensi pertanggungjawaban").fill("ADV-smoke");
      dropNextWritePath = `/api/workspace/proposals/${draft.id}/advances`;
      await advanceForm.getByRole("button", { name: "Catat uang muka" }).click();
      await dialog.getByRole("button", { name: "Kirim ulang penyimpanan" }).click();
      await dialog.getByText(/Ref ADV-smoke/).waitFor();
      expect(await rowsOf("SELECT id FROM disbursement_realization_advances")).toHaveLength(1);
      const expenseForm = dialog.locator("form").nth(1);
      await expenseForm.getByLabel("Nominal (Rp)").fill("100000");
      await expenseForm.getByLabel("Tujuan", { exact: true }).fill("Sewa kendaraan");
      await expenseForm.getByLabel("Payee", { exact: true }).fill("Rental Sintetis");
      await expenseForm.getByLabel("Dokumen rujukan").fill("KWT-smoke");
      const advanceId = (await rowsOf("SELECT id FROM disbursement_realization_advances"))[0].id;
      await expenseForm.getByLabel("Mempertanggungjawabkan uang muka (opsional)").selectOption(advanceId);
      dropNextWritePath = `/api/workspace/proposals/${draft.id}/expenses`;
      await expenseForm.getByRole("button", { name: "Catat biaya" }).click();
      await dialog.getByRole("button", { name: "Kirim ulang penyimpanan" }).click();
      await dialog.getByText(/Payee Rental Sintetis/).waitFor();
      expect(await rowsOf("SELECT id FROM disbursement_realization_expenses")).toHaveLength(1);
      expect(await realizationOverflow(page)).toEqual([]);
      await dialog.getByRole("button", { name: "Tutup", exact: true }).click();
      await page.close();

      // A separate authorized officer resolves the objection and examines the full BAST on phone.
      page = await openProposal({ width: 390, height: 844 }, examinerSinar);
      await firstEvent().getByRole("button", { name: "Keberatan", exact: true }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Catat hasil pemeriksaan" }).click();
      await dialog.getByLabel("Hasil pemeriksaan berwenang").selectOption("RESOLVED");
      await dialog.getByLabel("Catatan pemeriksaan").fill("Penerima dan seluruh nominal BAST telah diperiksa.");
      const disputeId = (await rowsOf("SELECT id FROM disbursement_realization_disputes"))[0].id;
      dropNextWritePath = `/api/workspace/proposals/${draft.id}/realizations/${firstId}/disputes/${disputeId}/examinations`;
      await dialog.getByRole("button", { name: "Simpan hasil" }).click();
      await dialog.getByRole("button", { name: "Kirim ulang penyimpanan" }).click();
      await dialog.getByRole("status").getByText("Tersimpan", { exact: true }).waitFor();
      expect(await rowsOf("SELECT id FROM disbursement_realization_dispute_examinations")).toHaveLength(1);
      await dialog.getByRole("button", { name: "Tutup", exact: true }).click();
      await firstEvent().getByRole("button", { name: "Konfirmasi penerimaan", exact: true }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByLabel("BAST diperiksa petugas lain", { exact: true }).check();
      await dialog.getByLabel("Hasil pemeriksaan tanda terima / BAST").fill("Identitas, tanda tangan dan nominal sesuai.");
      await dialog.getByRole("button", { name: "Catat pemeriksaan BAST" }).click();
      await firstEvent().getByText("Dikonfirmasi (BAST diperiksa)", { exact: true }).waitFor();
      expect(await realizationOverflow(page)).toEqual([]);
      const [bast] = await rowsOf("SELECT verifier_officer_id FROM disbursement_realization_bast_examinations");
      expect(bast.verifier_officer_id).toBe("off-examiner-sinar");
      expect(await realizationCount()).toBe(2);
      await page.screenshot({ path: "/tmp/issue94-phone-amendment.png", fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      server.stop(true);
    }
  }, 90000);
});

/**
 * Integration tests for Revisi, pembatalan, dan penutupan sisa pengajuan
 * (Spec #86, ticket #96, ADR-0028, ADR-0029, pilot amendment #100).
 *
 * Scenarios:
 *   - Skenario 17: Pembatalan pengajuan sebelum ada realisasi dengan SK dan EIP-712
 *   - Skenario 18 & 19: Penutupan sisa pengajuan setelah realisasi bertahap
 *   - Skenario 9 & 12: Revisi pengajuan yang telah disetujui (floor rule, held lines, kompetisi revisi, siklus telaah & keputusan)
 *   - Ketahanan data lintas restart database
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
import { configureWorkspace, resetWorkspace, type RecipientMessageTransport } from "../src/workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { PROPOSAL_STATUS_LABELS } from "../src/disbursement";

const BASE = "http://localhost:3001/api/workspace";
const SINAR = "lpz-sinar-amanah";

const adminSinar = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
const amilSinar = privateKeyToAccount(`0x${"22".repeat(32)}` as Hex);
const examinerSinar = privateKeyToAccount(`0x${"33".repeat(32)}` as Hex);
const approverSinar = privateKeyToAccount(`0x${"44".repeat(32)}` as Hex);

const NOW = 1_800_000_000;
const FILE_KEY = Buffer.alloc(32, 77);

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let disbursement: DisbursementStore;
let activities: ActivityStore;
let files: PrivateFileStore;
let tempDir: string;
let clock = NOW;

const configure = () =>
  configureWorkspace({
    store,
    disbursement,
    activities,
    files,
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

/** A money line, or a goods line carrying its own unit — the suite exercises both. */
type PreparedLine =
  | { id: string; beneficiaryId: string; amountIdr: string }
  | { id: string; beneficiaryId: string; unit: string; quantity: string; aidType?: string };

const isGoodsLine = (line: PreparedLine): line is Extract<PreparedLine, { unit: string }> => "unit" in line;

async function prepareApprovedProposal(options?: {
  lines?: PreparedLine[];
  purpose?: string;
}) {
  const amilToken = await signIn(amilSinar, SINAR);
  const examinerToken = await signIn(examinerSinar, SINAR);
  const approverToken = await signIn(approverSinar, SINAR);
  const adminToken = await signIn(adminSinar, SINAR);

  const progRes = await post(
    "/programs",
    {
      name: "Program Bantuan Darurat",
      purpose: "Bantuan mustahik berkebutuhan khusus",
      fundType: "ZAKAT",
      scope: "Jawa Barat",
      referenceCeiling: "999999999999999999",
    },
    adminToken
  );
  expect(progRes.status).toBe(201);
  const programId = (await progRes.json()).program.id;

  const curPol = (await (await get("/policy", adminToken)).json()).policy;
  const savePolRes = await post("/policy", { ...curPol, expectedVersion: curPol.version, requireIdentityDoc: false }, adminToken);
  expect(savePolRes.status).toBe(200);

  const rawLines = options?.lines ?? [
    { id: "aid-1", beneficiaryId: "ben-1", amountIdr: "1000000" },
    { id: "aid-2", beneficiaryId: "ben-2", amountIdr: "2000000" },
  ];

  const beneficiaries = [
    {
      id: "ben-1",
      name: "Mustahik Satu",
      asnaf: "Fakir",
      identityBasis: { kind: "NIK", value: "3201123456000001" },
      addressOrScope: "Bandung",
      guardian: null,
      contact: { phone: "081234567890", relation: "SELF" },
      paymentRecipient: null,
    },
    {
      id: "ben-2",
      name: "Mustahik Dua",
      asnaf: "Miskin",
      identityBasis: { kind: "NIK", value: "3201123456000002" },
      addressOrScope: "Cimahi",
      guardian: null,
      contact: { phone: "081234567891", relation: "SELF" },
      paymentRecipient: null,
    },
  ];

  const aidLines = rawLines.map((line) => ({
    id: line.id,
    beneficiaryId: line.beneficiaryId,
    aidType: isGoodsLine(line) ? line.aidType ?? "Paket Sembako" : "Bantuan Tunai Pendidikan",
    period: "2026-03",
    value: isGoodsLine(line)
      ? { kind: "GOODS", unit: line.unit, quantityRequested: line.quantity, valuedAmountIdr: null, valuationBasis: null }
      : { kind: "MONEY", amountRequestedIdr: line.amountIdr },
  }));

  const propRes = await post(
    "/proposals",
    {
      expectedVersion: 0,
      operationId: crypto.randomUUID(),
      programId,
      originOfRequest: "Rekomendasi Lapangan",
      purpose: options?.purpose ?? "Penyaluran bantuan mustahik",
      personInCharge: "Ahmad Amil",
      aidPeriod: { start: "2026-03-01", end: "2026-03-31" },
      beneficiaries,
      aidLines,
    },
    amilToken
  );
  expect(propRes.status).toBe(201);
  const draft = (await propRes.json()).draft;

  for (const cat of ["PROPOSAL_LETTER", "RECIPIENT_VERIFICATION", "BENEFICIARY_IDENTITY"]) {
    expect(
      (await post(`/proposals/${draft.id}/documents`, { ...documentInput(cat) }, amilToken)).status
    ).toBe(201);
  }

  const submitRes = await post(
    `/proposals/${draft.id}/submit`,
    { expectedVersion: draft.version, operationId: crypto.randomUUID() },
    amilToken
  );
  expect(submitRes.status).toBe(200);
  const submitted = (await submitRes.json()).draft;

  await post(
    `/proposals/${draft.id}/start-examination`,
    { expectedVersion: submitted.version, operationId: crypto.randomUUID() },
    examinerToken
  );

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

  const approvedAidLines = rawLines.map((al) =>
    isGoodsLine(al) ? { id: al.id, quantityApproved: al.quantity } : { id: al.id, amountApprovedIdr: al.amountIdr }
  );
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
      signature,
      nonce: challenge.nonce,
      expectedVersion: readyDraft.version,
      operationId: crypto.randomUUID(),
      approvedAidLines,
    },
    approverToken
  );
  expect(decideRes.status).toBe(200);
  const approvedDraft = (await decideRes.json()).draft;

  return {
    programId,
    draft: approvedDraft,
    tokens: { amilToken, examinerToken, approverToken, adminToken },
  };
}

describe("Revisi, pembatalan, dan penutupan sisa pengajuan (Ticket #96)", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zkt-revision-files-"));
    files = createEncryptedFileStore({ directory: tempDir, key: FILE_KEY });
    database = await createTestWorkspaceDatabase(process.env.REVISION_TEST_DATABASE_URL);
    store = createWorkspaceStore(database.handle());
    disbursement = createDisbursementStore(database.handle());
    activities = createActivityStore(database.handle());
    await store.ensureSchema();
    await disbursement.ensureSchema();
    await createContributionStore(database.handle()).ensureSchema();
    await activities.ensureSchema();

    for (const inst of SYNTHETIC_INSTITUTIONS) {
      await store.upsertInstitution(institutionRecordOf(inst));
    }

    // Memberships
    await store.upsertMembership({ institutionId: SINAR, account: adminSinar.address, role: "ADMIN" });
    await store.upsertMembership({ institutionId: SINAR, account: amilSinar.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: SINAR, account: examinerSinar.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: SINAR, account: approverSinar.address, role: "OFFICER" });

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

    await store.grantMandate({
      institutionId: SINAR,
      actor: adminSinar.address,
      now: clock,
      mandate: {
        officerId: "off-amil-sinar",
        function: "RECORD_REALIZATION",
        scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK-004/REALISASI",
        validFrom: clock - 1000,
        validUntil: clock + 86400 * 30,
      },
    });
  });

  afterAll(async () => {
    resetWorkspace();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    if (database) await database.close();
  });

  beforeEach(async () => {
    clock = NOW;
    configure();
  });

  it("Skenario 17: membatalkan pengajuan yang belum terealisasi dengan SK dan EIP-712", async () => {
    const { draft, tokens } = await prepareApprovedProposal();

    // 1. Upload SK pembatalan
    const docRes = await post(
      `/proposals/${draft.id}/decision-documents`,
      {
        fileName: "sk-batal.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("SK Pembatalan Direktur").toString("base64"),
        expectedVersion: draft.version,
      },
      tokens.approverToken
    );
    expect(docRes.status).toBe(201);
    const decisionDocumentId = (await docRes.json()).document.id;

    // 2. Request cancel challenge
    const chalRes = await post(
      `/proposals/${draft.id}/cancel-challenge`,
      {
        decisionReference: "SK-BATAL-001",
        decisionDate: "2026-03-20",
        decisionDocumentId,
        reason: "Mustahik telah pindah domisili ke luar negeri sebelum penyaluran",
        expectedVersion: draft.version,
      },
      tokens.approverToken
    );
    expect(chalRes.status).toBe(201);
    const { challenge, typedData } = await chalRes.json();
    expect(challenge.action).toBe("CANCEL");

    // 3. Sign EIP-712 challenge
    const signature = await approverSinar.signTypedData(signable(typedData));

    // 4. Submit cancellation via decide endpoint
    const decideRes = await post(
      `/proposals/${draft.id}/decide`,
      {
        action: "CANCEL",
        decisionReference: "SK-BATAL-001",
        decisionDate: "2026-03-20",
        decisionDocumentId,
        signerAccount: challenge.signerAccount,
        mandateId: challenge.mandateId,
        signature,
        nonce: challenge.nonce,
        reason: "Mustahik telah pindah domisili ke luar negeri sebelum penyaluran",
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
      },
      tokens.approverToken
    );
    expect(decideRes.status).toBe(200);
    const cancelled = (await decideRes.json()).draft;
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelReason).toBe("Mustahik telah pindah domisili ke luar negeri sebelum penyaluran");

    // 5. Verification: status label in proposal read
    const readRes = await get(`/proposals/${draft.id}`, tokens.amilToken);
    expect(readRes.status).toBe(200);
    const readData = await readRes.json();
    expect(readData.draft.status).toBe("CANCELLED");
    expect(PROPOSAL_STATUS_LABELS[readData.draft.status as keyof typeof PROPOSAL_STATUS_LABELS]).toBe("Dibatalkan");

    // 6. Cannot record realizations on cancelled proposal
    const reaRes = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: cancelled.version,
        operationId: crypto.randomUUID(),
        items: [
          {
            aidLineId: "aid-1",
            beneficiaryId: "ben-1",
            method: "CASH",
            amountIdr: "500000",
            reportedAt: NOW,
          },
        ],
      },
      tokens.amilToken
    );
    expect(reaRes.status).toBe(409);
  });

  it("menolak pembatalan jika pengajuan sudah memiliki realisasi tercatat", async () => {
    const { draft, tokens } = await prepareApprovedProposal();

    // Catat realisasi sebagian terlebih dahulu
    const reaRes = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
        items: [
          {
            aidLineId: "aid-1",
            beneficiaryId: "ben-1",
            method: "CASH",
            amountIdr: "500000",
            reportedAt: NOW,
          },
        ],
      },
      tokens.amilToken
    );
    expect(reaRes.status).toBe(201);

    // Upload SK pembatalan
    const docRes = await post(
      `/proposals/${draft.id}/decision-documents`,
      {
        fileName: "sk-batal-conflict.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("SK Pembatalan").toString("base64"),
        expectedVersion: draft.version,
      },
      tokens.approverToken
    );
    const decisionDocumentId = (await docRes.json()).document.id;

    // Request cancel-challenge harus gagal dengan 409
    const chalRes = await post(
      `/proposals/${draft.id}/cancel-challenge`,
      {
        decisionReference: "SK-BATAL-002",
        decisionDate: "2026-03-20",
        decisionDocumentId,
        reason: "Ingin dibatalkan",
        expectedVersion: draft.version,
      },
      tokens.approverToken
    );
    expect(chalRes.status).toBe(409);
    const body = await chalRes.json();
    expect(body.error).toContain("sudah memiliki realisasi tidak dapat dibatalkan");
  });

  it("Skenario 18 & 19: menutup sisa hak bantuan setelah realisasi bertahap dengan SK dan rincian", async () => {
    const { draft, tokens } = await prepareApprovedProposal();

    // 1. Realisasi baris aid-1 sebesar Rp500.000 (dari Rp1.000.000 yang disetujui)
    const reaRes = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
        items: [
          {
            aidLineId: "aid-1",
            beneficiaryId: "ben-1",
            method: "CASH",
            amountIdr: "500000",
            reportedAt: NOW,
          },
        ],
      },
      tokens.amilToken
    );
    expect(reaRes.status).toBe(201);

    // 2. Upload SK penutupan sisa
    const docRes = await post(
      `/proposals/${draft.id}/decision-documents`,
      {
        fileName: "sk-tutup-sisa.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("SK Penutupan Sisa Penyaluran").toString("base64"),
        expectedVersion: draft.version,
      },
      tokens.approverToken
    );
    expect(docRes.status).toBe(201);
    const decisionDocumentId = (await docRes.json()).document.id;

    // 3. Request close-remainder-challenge
    const chalRes = await post(
      `/proposals/${draft.id}/close-remainder-challenge`,
      {
        decisionReference: "SK-TUTUP-001",
        decisionDate: "2026-03-25",
        decisionDocumentId,
        reason: "Penerima manfaat telah mandiri secara finansial dan menolak sisa bantuan",
        expectedVersion: draft.version,
      },
      tokens.approverToken
    );
    expect(chalRes.status).toBe(201);
    const { challenge, typedData } = await chalRes.json();
    expect(challenge.action).toBe("CLOSE_REMAINDER");

    // 4. Sign and submit
    const signature = await approverSinar.signTypedData(signable(typedData));
    const decideRes = await post(
      `/proposals/${draft.id}/decide`,
      {
        action: "CLOSE_REMAINDER",
        decisionReference: "SK-TUTUP-001",
        decisionDate: "2026-03-25",
        decisionDocumentId,
        signerAccount: challenge.signerAccount,
        mandateId: challenge.mandateId,
        signature,
        nonce: challenge.nonce,
        reason: "Penerima manfaat telah mandiri secara finansial dan menolak sisa bantuan",
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
      },
      tokens.approverToken
    );
    expect(decideRes.status).toBe(200);
    const closedData = await decideRes.json();
    expect(closedData.draft.status).toBe("REMAINDER_CLOSED");
    expect(closedData.closure).toBeDefined();
    // aid-1 approved 1.000.000, realized 500.000, remainder 500.000
    // aid-2 approved 2.000.000, realized 0, remainder 2.000.000
    // Total approved 3.000.000, realized 500.000, remainder 2.500.000
    expect(closedData.closure.totalApprovedIdr).toBe("3000000");
    expect(closedData.closure.totalRealizedIdr).toBe("500000");
    expect(closedData.closure.totalUnrealizedRemainderIdr).toBe("2500000");

    // 5. Verification: realization summary marks disbursementStatus = REMAINDER_CLOSED
    const sumRes = await get(`/proposals/${draft.id}/realization-summary`, tokens.amilToken);
    expect(sumRes.status).toBe(200);
    const summary = (await sumRes.json()).summary;
    expect(summary.disbursementStatus).toBe("REMAINDER_CLOSED");
    expect(summary.closure).toBeDefined();
    expect(summary.closure.totalUnrealizedRemainderIdr).toBe("2500000");

    // 6. Get closure endpoint
    const closureRes = await get(`/proposals/${draft.id}/closure`, tokens.amilToken);
    expect(closureRes.status).toBe(200);
    expect((await closureRes.json()).closure.decisionReference).toBe("SK-TUTUP-001");

    // 7. Cannot record further realizations on closed proposal
    const postReaRes = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
        items: [
          {
            aidLineId: "aid-2",
            beneficiaryId: "ben-2",
            method: "CASH",
            amountIdr: "1000000",
            reportedAt: NOW,
          },
        ],
      },
      tokens.amilToken
    );
    expect(postReaRes.status).toBe(409);
  });

  it("Skenario 9 & 12: revisi pengajuan yang disetujui, aturan floor, dan penahanan realisasi", async () => {
    const { draft, tokens } = await prepareApprovedProposal();

    // 1. Realisasi bertahap sebagian pada aid-1 sebesar Rp400.000
    const rea1Res = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
        items: [
          {
            aidLineId: "aid-1",
            beneficiaryId: "ben-1",
            method: "CASH",
            amountIdr: "400000",
            reportedAt: NOW,
          },
        ],
      },
      tokens.amilToken
    );
    expect(rea1Res.status).toBe(201);

    // 2. Floor Rule Check: mencoba menurunkan nominal aid-1 di bawah Rp400.000 (misal Rp300.000) harus ditolak
    const invalidFloorRes = await post(
      `/proposals/${draft.id}/revisions`,
      {
        reason: "Turunkan alokasi aid-1 jadi 300rb",
        operationId: crypto.randomUUID(),
        beneficiaries: draft.beneficiaries,
        aidLines: [
          { ...draft.aidLines[0], value: { kind: "MONEY", amountRequestedIdr: "300000" } },
          draft.aidLines[1],
        ],
        expectedVersion: draft.version,
      },
      tokens.amilToken
    );
    expect(invalidFloorRes.status).toBe(409);
    const floorErr = await invalidFloorRes.json();
    expect(floorErr.error).toContain("tidak boleh turun di bawah realisasi yang sudah tercatat");

    // 3. Propose Revision yang sah:
    // aid-1 dinaikkan jadi 1.500.000 (dimodifikasi -> harus di-hold)
    // aid-2 tetap 2.000.000 (tidak berubah -> TIDAK di-hold)
    // tambah aid-3 sebesar 500.000 untuk ben-1 (ditambah -> harus di-hold)
    const validRevRes = await post(
      `/proposals/${draft.id}/revisions`,
      {
        reason: "Penyesuaian biaya semester kedua dan penambahan buku",
        operationId: crypto.randomUUID(),
        beneficiaries: draft.beneficiaries,
        aidLines: [
          { ...draft.aidLines[0], value: { kind: "MONEY", amountRequestedIdr: "1500000" } },
          draft.aidLines[1],
          {
            id: "aid-3",
            beneficiaryId: "ben-1",
            aidType: "Bantuan Buku Pelajaran",
            period: "2026-03",
            value: { kind: "MONEY", amountRequestedIdr: "500000" },
          },
        ],
        expectedVersion: draft.version,
      },
      tokens.amilToken
    );
    expect(validRevRes.status).toBe(201);
    const revision = (await validRevRes.json()).revision;
    expect(revision.status).toBe("SUBMITTED");
    expect(revision.heldAidLineIds).toEqual(expect.arrayContaining(["aid-1", "aid-3"]));
    expect(revision.heldAidLineIds).not.toContain("aid-2");

    // 4. Realization Hold Rule: mencoba mencatat realisasi pada aid-1 (yang sedang ditahan) harus 409
    const heldReaRes = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
        items: [
          {
            aidLineId: "aid-1",
            beneficiaryId: "ben-1",
            method: "CASH",
            amountIdr: "200000",
            reportedAt: NOW,
          },
        ],
      },
      tokens.amilToken
    );
    expect(heldReaRes.status).toBe(409);
    expect((await heldReaRes.json()).error).toContain("sedang ditahan");

    // 5. Unchanged lines CAN be realized: mencatat realisasi pada aid-2 (tidak diubah) harus berhasil
    const unchangedReaRes = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
        items: [
          {
            aidLineId: "aid-2",
            beneficiaryId: "ben-2",
            method: "CASH",
            amountIdr: "1000000",
            reportedAt: NOW,
          },
        ],
      },
      tokens.amilToken
    );
    expect(unchangedReaRes.status).toBe(201);

    // 6. Concurrency Conflict: mencoba mengajukan revisi kedua saat revisi aktif masih berjalan harus 409
    const compRevRes = await post(
      `/proposals/${draft.id}/revisions`,
      {
        reason: "Revisi saingan",
        operationId: crypto.randomUUID(),
        beneficiaries: draft.beneficiaries,
        aidLines: draft.aidLines,
        expectedVersion: draft.version,
      },
      tokens.amilToken
    );
    expect(compRevRes.status).toBe(409);
    expect((await compRevRes.json()).error).toContain("Terdapat revisi yang sedang aktif");

    // 7. Siklus telaah revisi: start-examination -> return -> start-examination -> ready
    const startExamRes = await post(
      `/proposals/${draft.id}/revisions/${revision.id}/start-examination`,
      { operationId: crypto.randomUUID() },
      tokens.examinerToken
    );
    expect(startExamRes.status).toBe(200);
    expect((await startExamRes.json()).revision.status).toBe("UNDER_EXAMINATION");

    const returnRes = await post(
      `/proposals/${draft.id}/revisions/${revision.id}/return`,
      { reason: "Lampirkan estimasi rincian buku", operationId: crypto.randomUUID() },
      tokens.examinerToken
    );
    expect(returnRes.status).toBe(200);
    expect((await returnRes.json()).revision.status).toBe("REVISION_REQUIRED");

    // Telaah ulang dan nyatakan siap keputusan
    await post(
      `/proposals/${draft.id}/revisions/${revision.id}/start-examination`,
      { operationId: crypto.randomUUID() },
      tokens.examinerToken
    );
    const readyRes = await post(
      `/proposals/${draft.id}/revisions/${revision.id}/ready`,
      {
        notes: "Estimasi buku telah diperiksa dan disetujui",
        operationId: crypto.randomUUID(),
        checklist: {
          administrativeChecksOk: true,
          eligibilityChecksOk: true,
          alternativeIdReviewed: true,
          recurringAidExceptions: [],
          notes: "Telaah ulang versi revisi",
        },
      },
      tokens.examinerToken
    );
    expect(readyRes.status).toBe(200);
    expect((await readyRes.json()).revision.status).toBe("READY_FOR_DECISION");

    // 8. Pengesahan keputusan revisi:
    // Upload SK revisi
    const docRevRes = await post(
      `/proposals/${draft.id}/decision-documents`,
      {
        fileName: "sk-revisi-01.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("SK Persetujuan Perubahan Hak Bantuan").toString("base64"),
        expectedVersion: draft.version,
      },
      tokens.approverToken
    );
    const revDocId = (await docRevRes.json()).document.id;

    const chalRevRes = await post(
      `/proposals/${draft.id}/revisions/${revision.id}/decision-challenge`,
      {
        action: "APPROVE",
        decisionReference: "SK-REV-001",
        decisionDate: "2026-03-22",
        decisionDocumentId: revDocId,
        notes: "Perubahan disetujui direksi",
      },
      tokens.approverToken
    );
    expect(chalRevRes.status).toBe(201);
    const { challenge: revChallenge, typedData: revTypedData } = await chalRevRes.json();
    const revSig = await approverSinar.signTypedData(signable(revTypedData));

    const decideRevRes = await post(
      `/proposals/${draft.id}/revisions/${revision.id}/decide`,
      {
        nonce: revChallenge.nonce,
        signature: revSig,
        operationId: crypto.randomUUID(),
        notes: "Perubahan disetujui direksi",
      },
      tokens.approverToken
    );
    expect(decideRevRes.status).toBe(200);
    const decideRevBody = await decideRevRes.json();
    expect(decideRevBody.revision.status).toBe("APPROVED");
    expect(decideRevBody.draft.version).toBe(draft.version + 1);
    expect(decideRevBody.draft.activeRevisionId).toBeNull();
    expect(decideRevBody.draft.heldAidLineIds).toEqual([]);

    // 9. Setelah disetujui, aid-1 dan aid-3 yang baru sudah dapat direalisasikan
    const reaAid1Res = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: decideRevBody.draft.version,
        operationId: crypto.randomUUID(),
        items: [
          {
            aidLineId: "aid-1",
            beneficiaryId: "ben-1",
            method: "CASH",
            amountIdr: "500000",
            reportedAt: NOW,
          },
        ],
      },
      tokens.amilToken
    );
    expect(reaAid1Res.status).toBe(201);
  });

  it("penarikan revisi (withdraw) membebaskan garis yang ditahan tanpa mengubah versi aktif", async () => {
    const { draft, tokens } = await prepareApprovedProposal();

    // 1. Propose revision
    const revRes = await post(
      `/proposals/${draft.id}/revisions`,
      {
        reason: "Revisi sementara",
        operationId: crypto.randomUUID(),
        beneficiaries: draft.beneficiaries,
        aidLines: [
          { ...draft.aidLines[0], value: { kind: "MONEY", amountRequestedIdr: "1500000" } },
          draft.aidLines[1],
        ],
        expectedVersion: draft.version,
      },
      tokens.amilToken
    );
    expect(revRes.status).toBe(201);
    const revision = (await revRes.json()).revision;

    // Garis aid-1 ditahan
    const heldRes = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
        items: [{ aidLineId: "aid-1", beneficiaryId: "ben-1", method: "CASH", amountIdr: "100000", reportedAt: NOW }],
      },
      tokens.amilToken
    );
    expect(heldRes.status).toBe(409);

    // 2. Tarik revisi
    const withdrawRes = await post(
      `/proposals/${draft.id}/revisions/${revision.id}/withdraw`,
      { reason: "Dibatalkan oleh pemohon", operationId: crypto.randomUUID() },
      tokens.amilToken
    );
    expect(withdrawRes.status).toBe(200);
    expect((await withdrawRes.json()).revision.status).toBe("WITHDRAWN");

    // 3. Garis aid-1 sekarang kembali dapat direalisasikan
    const releaseRes = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
        items: [{ aidLineId: "aid-1", beneficiaryId: "ben-1", method: "CASH", amountIdr: "100000", reportedAt: NOW }],
      },
      tokens.amilToken
    );
    expect(releaseRes.status).toBe(201);
  });

  // -------------------------------------------------------------------------
  // Konkurensi, retry dan pemisahan tugas (AC: pemeriksaan atomik, retry identik)
  // -------------------------------------------------------------------------

  /** Upload an SK and run the full challenge -> sign -> decide cycle for a termination action. */
  async function terminate(
    draft: any,
    tokens: any,
    action: "CANCEL" | "CLOSE_REMAINDER",
    reason: string,
    overrides: Record<string, unknown> = {}
  ) {
    const docRes = await post(
      `/proposals/${draft.id}/decision-documents`,
      {
        fileName: `sk-${action.toLowerCase()}.txt`,
        mimeType: "text/plain",
        contentBase64: Buffer.from(`SK ${action}`).toString("base64"),
        expectedVersion: draft.version,
      },
      tokens.approverToken
    );
    expect(docRes.status).toBe(201);
    const decisionDocumentId = (await docRes.json()).document.id;

    const endpoint = action === "CANCEL" ? "cancel-challenge" : "close-remainder-challenge";
    const intent = {
      decisionReference: `SK-${action}-900`,
      decisionDate: "2026-03-28",
      decisionDocumentId,
      reason,
      expectedVersion: draft.version,
    };
    const chalRes = await post(`/proposals/${draft.id}/${endpoint}`, intent, tokens.approverToken);
    if (chalRes.status !== 201) return { challengeStatus: chalRes.status, body: await chalRes.json() };

    const { challenge, typedData } = await chalRes.json();
    const signature = await approverSinar.signTypedData(signable(typedData));
    const payload = {
      ...intent,
      action,
      signerAccount: challenge.signerAccount,
      mandateId: challenge.mandateId,
      signature,
      nonce: challenge.nonce,
      operationId: crypto.randomUUID(),
      ...overrides,
    };
    const decideRes = await post(`/proposals/${draft.id}/decide`, payload, tokens.approverToken);
    return { challengeStatus: 201, decideRes, payload };
  }

  it("retry identik pada pembatalan tidak menggandakan keputusan", async () => {
    const { draft, tokens } = await prepareApprovedProposal();
    const first = await terminate(draft, tokens, "CANCEL", "Program dihentikan sebelum penyaluran");
    expect(first.decideRes!.status).toBe(200);
    const firstBody = await first.decideRes!.json();
    expect(firstBody.draft.status).toBe("CANCELLED");

    // The same operation id with the same payload replays the committed decision, not a second one.
    const retryRes = await post(`/proposals/${draft.id}/decide`, first.payload, tokens.approverToken);
    expect(retryRes.status).toBe(200);
    const retryBody = await retryRes.json();
    expect(retryBody.decision.id).toBe(firstBody.decision.id);

    const decisionsRes = await get(`/proposals/${draft.id}/decision`, tokens.amilToken);
    expect(decisionsRes.status).toBe(200);

    // A different payload under the same operation id is a conflict, never an overwrite.
    const divergent = await post(
      `/proposals/${draft.id}/decide`,
      { ...first.payload, reason: "Alasan yang berbeda" },
      tokens.approverToken
    );
    expect(divergent.status).toBe(409);
  });

  it("retry identik pada pengajuan revisi mengembalikan revisi yang sama", async () => {
    const { draft, tokens } = await prepareApprovedProposal();
    const body = {
      reason: "Turunkan alokasi aid-2",
      operationId: crypto.randomUUID(),
      beneficiaries: draft.beneficiaries,
      aidLines: draft.aidLines.map((line: any) =>
        line.id === "aid-2" ? { ...line, value: { ...line.value, amountApprovedIdr: "1500000" } } : line
      ),
      expectedVersion: draft.version,
    };

    const first = await post(`/proposals/${draft.id}/revisions`, body, tokens.amilToken);
    expect(first.status).toBe(201);
    const firstRev = (await first.json()).revision;

    const retry = await post(`/proposals/${draft.id}/revisions`, body, tokens.amilToken);
    expect(retry.status).toBe(201);
    expect((await retry.json()).revision.id).toBe(firstRev.id);

    // Exactly one revision exists despite the retry.
    const listRes = await get(`/proposals/${draft.id}/revisions`, tokens.amilToken);
    expect((await listRes.json()).revisions).toHaveLength(1);
  });

  it("realisasi yang bersaing dengan penutupan sisa tidak membuat sisa menjadi negatif", async () => {
    const { draft, tokens } = await prepareApprovedProposal();

    const reaRes = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
        items: [{ aidLineId: "aid-1", beneficiaryId: "ben-1", method: "CASH", amountIdr: "400000", reportedAt: NOW }],
      },
      tokens.amilToken
    );
    expect(reaRes.status).toBe(201);

    const closed = await terminate(draft, tokens, "CLOSE_REMAINDER", "Program berakhir");
    expect(closed.decideRes!.status).toBe(200);
    const closure = (await closed.decideRes!.json()).closure;
    expect(closure.totalRealizedIdr).toBe("400000");
    expect(closure.totalUnrealizedRemainderIdr).toBe("2600000");

    // A realization arriving after closure is refused; the closed figures stand.
    const lateRes = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
        items: [{ aidLineId: "aid-1", beneficiaryId: "ben-1", method: "CASH", amountIdr: "100000", reportedAt: NOW }],
      },
      tokens.amilToken
    );
    expect(lateRes.status).toBeGreaterThanOrEqual(400);

    const sumRes = await get(`/proposals/${draft.id}/realization-summary`, tokens.amilToken);
    expect((await sumRes.json()).summary.totalRealizedIdr).toBe("400000");
  });

  it("penyusun revisi tidak boleh mengesahkan revisinya sendiri", async () => {
    const { draft, tokens } = await prepareApprovedProposal();

    const revRes = await post(
      `/proposals/${draft.id}/revisions`,
      {
        reason: "Perbaikan alokasi",
        operationId: crypto.randomUUID(),
        beneficiaries: draft.beneficiaries,
        aidLines: draft.aidLines,
        expectedVersion: draft.version,
      },
      tokens.amilToken
    );
    expect(revRes.status).toBe(201);
    const revision = (await revRes.json()).revision;

    await post(
      `/proposals/${draft.id}/revisions/${revision.id}/start-examination`,
      { operationId: crypto.randomUUID() },
      tokens.examinerToken
    );
    const readyRes = await post(
      `/proposals/${draft.id}/revisions/${revision.id}/ready`,
      {
        operationId: crypto.randomUUID(),
        checklist: {
          administrativeChecksOk: true,
          eligibilityChecksOk: true,
          alternativeIdReviewed: true,
          recurringAidExceptions: [],
          notes: "",
        },
      },
      tokens.examinerToken
    );
    expect(readyRes.status).toBe(200);

    const docRes = await post(
      `/proposals/${draft.id}/decision-documents`,
      {
        fileName: "sk-revisi.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("SK Revisi").toString("base64"),
        expectedVersion: draft.version,
      },
      tokens.approverToken
    );
    const decisionDocumentId = (await docRes.json()).document.id;

    // The amil who drafted the revision asks to approve it; separation of duties refuses.
    const selfRes = await post(
      `/proposals/${draft.id}/revisions/${revision.id}/decision-challenge`,
      {
        action: "APPROVE",
        decisionReference: "SK-REV-001",
        decisionDate: "2026-03-28",
        decisionDocumentId,
      },
      tokens.amilToken
    );
    expect(selfRes.status).toBe(403);
    expect((await selfRes.json()).error).toMatch(/penyusun|menyusun|pengesah/i);
  });

  it("revisi tidak dapat dinyatakan siap diputus tanpa checklist pemeriksaan yang ditegaskan", async () => {
    const { draft, tokens } = await prepareApprovedProposal();

    const revRes = await post(
      `/proposals/${draft.id}/revisions`,
      {
        reason: "Perbaikan alokasi",
        operationId: crypto.randomUUID(),
        beneficiaries: draft.beneficiaries,
        aidLines: draft.aidLines,
        expectedVersion: draft.version,
      },
      tokens.amilToken
    );
    const revision = (await revRes.json()).revision;
    await post(
      `/proposals/${draft.id}/revisions/${revision.id}/start-examination`,
      { operationId: crypto.randomUUID() },
      tokens.examinerToken
    );

    const noChecklist = await post(
      `/proposals/${draft.id}/revisions/${revision.id}/ready`,
      { operationId: crypto.randomUUID() },
      tokens.examinerToken
    );
    expect(noChecklist.status).toBe(400);

    const unaffirmed = await post(
      `/proposals/${draft.id}/revisions/${revision.id}/ready`,
      {
        operationId: crypto.randomUUID(),
        checklist: {
          administrativeChecksOk: true,
          eligibilityChecksOk: false,
          alternativeIdReviewed: false,
          recurringAidExceptions: [],
          notes: "",
        },
      },
      tokens.examinerToken
    );
    expect(unaffirmed.status).toBe(400);
  });

  it("revisi yang dikembalikan dapat diperbaiki dan diperiksa ulang tanpa menyentuh versi berlaku", async () => {
    const { draft, tokens } = await prepareApprovedProposal();

    const revRes = await post(
      `/proposals/${draft.id}/revisions`,
      {
        reason: "Perbaikan alokasi",
        operationId: crypto.randomUUID(),
        beneficiaries: draft.beneficiaries,
        aidLines: draft.aidLines,
        expectedVersion: draft.version,
      },
      tokens.amilToken
    );
    const revision = (await revRes.json()).revision;

    await post(
      `/proposals/${draft.id}/revisions/${revision.id}/start-examination`,
      { operationId: crypto.randomUUID() },
      tokens.examinerToken
    );
    const returned = await post(
      `/proposals/${draft.id}/revisions/${revision.id}/return`,
      { reason: "Rincian belum lengkap", operationId: crypto.randomUUID() },
      tokens.examinerToken
    );
    expect((await returned.json()).revision.status).toBe("REVISION_REQUIRED");

    const amended = await post(
      `/proposals/${draft.id}/revisions/${revision.id}/amend`,
      {
        reason: "Rincian dilengkapi sesuai catatan pemeriksa",
        operationId: crypto.randomUUID(),
        beneficiaries: draft.beneficiaries,
        aidLines: draft.aidLines.map((line: any) =>
          line.id === "aid-1" ? { ...line, value: { ...line.value, amountApprovedIdr: "900000" } } : line
        ),
      },
      tokens.amilToken
    );
    expect(amended.status).toBe(200);
    const amendedRev = (await amended.json()).revision;
    expect(amendedRev.status).toBe("SUBMITTED");
    expect(amendedRev.id).toBe(revision.id);

    // The proposal's in-force version is untouched by the amendment.
    const readRes = await get(`/proposals/${draft.id}`, tokens.amilToken);
    const current = (await readRes.json()).draft;
    expect(current.version).toBe(draft.version);
    expect(current.status).toBe("APPROVED");
  });

  it("revisi dan penutupan sisa tidak membuat efek keuangan atau publikasi otomatis", async () => {
    const { draft, tokens } = await prepareApprovedProposal();

    await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
        items: [{ aidLineId: "aid-1", beneficiaryId: "ben-1", method: "CASH", amountIdr: "500000", reportedAt: NOW }],
      },
      tokens.amilToken
    );

    const closed = await terminate(draft, tokens, "CLOSE_REMAINDER", "Periode program berakhir");
    expect(closed.decideRes!.status).toBe(200);
    const closure = (await closed.decideRes!.json()).closure;

    // Closing a remainder records no disbursement: what was realized stays exactly as it was,
    // and the unrealized part is reported separately rather than as a handover.
    expect(closure.totalRealizedIdr).toBe("500000");
    expect(closure.totalUnrealizedRemainderIdr).toBe("2500000");
    expect(closure.lineRemainders.every((line: any) => BigInt(line.unrealizedRemainder) >= 0n)).toBe(true);

    // No realization was invented for the closed remainder.
    const realizationsRes = await get(`/proposals/${draft.id}/realizations`, tokens.amilToken);
    const realizations = (await realizationsRes.json()).realizations;
    expect(realizations).toHaveLength(1);
    expect(realizations[0].amountIdr).toBe("500000");
  });

  // -------------------------------------------------------------------------
  // Rincian bantuan bersatuan (AC: aturan bekerja pada satuan, bukan hanya uang)
  // -------------------------------------------------------------------------

  const goodsProposal = () =>
    prepareApprovedProposal({
      purpose: "Penyaluran sembako mustahik",
      lines: [
        { id: "aid-1", beneficiaryId: "ben-1", unit: "kg", quantity: "25", aidType: "Beras Premium" },
        { id: "aid-2", beneficiaryId: "ben-2", unit: "liter", quantity: "10", aidType: "Minyak Goreng" },
      ],
    });

  const goodsRevisionBody = (draft: any, aidLineId: string, quantity: string) => ({
    reason: "Penyesuaian kuantitas barang setelah verifikasi gudang",
    operationId: crypto.randomUUID(),
    beneficiaries: draft.beneficiaries,
    aidLines: draft.aidLines.map((line: any) =>
      line.id === aidLineId ? { ...line, value: { ...line.value, quantityApproved: quantity } } : line
    ),
    expectedVersion: draft.version,
  });

  it("hak barang revisi tidak boleh turun di bawah kuantitas yang sudah terealisasi", async () => {
    const { draft, tokens } = await goodsProposal();

    // 10 kg of the 25 kg approved has already been handed over.
    const reaRes = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
        items: [
          {
            aidLineId: "aid-1",
            beneficiaryId: "ben-1",
            method: "GOODS_HANDOVER",
            quantity: "10",
            unit: "kg",
            reportedAt: NOW,
          },
        ],
      },
      tokens.amilToken
    );
    expect(reaRes.status).toBe(201);

    // Below the realized quantity: refused, in the line's own unit.
    const belowFloor = await post(
      `/proposals/${draft.id}/revisions`,
      goodsRevisionBody(draft, "aid-1", "8"),
      tokens.amilToken
    );
    expect(belowFloor.status).toBe(409);
    // The goods branch, not the money one: the refusal speaks in quantities.
    expect((await belowFloor.json()).error).toContain("Kuantitas barang revisi");

    // Exactly at the realized quantity is allowed: the floor is a floor, not a gap.
    const atFloor = await post(
      `/proposals/${draft.id}/revisions`,
      goodsRevisionBody(draft, "aid-1", "10"),
      tokens.amilToken
    );
    expect(atFloor.status).toBe(201);
    const revision = (await atFloor.json()).revision;
    expect(revision.heldAidLineIds).toEqual(["aid-1"]);
  });

  it("satuan barang yang sudah terealisasi tidak dapat diubah, dan barisnya tidak dapat dihapus", async () => {
    const { draft, tokens } = await goodsProposal();
    await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
        items: [
          { aidLineId: "aid-1", beneficiaryId: "ben-1", method: "GOODS_HANDOVER", quantity: "5", unit: "kg", reportedAt: NOW },
        ],
      },
      tokens.amilToken
    );

    const switchedUnit = await post(
      `/proposals/${draft.id}/revisions`,
      {
        reason: "Ubah satuan",
        operationId: crypto.randomUUID(),
        beneficiaries: draft.beneficiaries,
        aidLines: draft.aidLines.map((line: any) =>
          line.id === "aid-1" ? { ...line, value: { ...line.value, unit: "karung" } } : line
        ),
        expectedVersion: draft.version,
      },
      tokens.amilToken
    );
    expect(switchedUnit.status).toBe(409);
    expect((await switchedUnit.json()).error).toContain("Satuan barang");

    const removed = await post(
      `/proposals/${draft.id}/revisions`,
      {
        reason: "Hapus baris",
        operationId: crypto.randomUUID(),
        beneficiaries: draft.beneficiaries,
        aidLines: draft.aidLines.filter((line: any) => line.id !== "aid-1"),
        expectedVersion: draft.version,
      },
      tokens.amilToken
    );
    expect(removed.status).toBe(409);
    expect((await removed.json()).error).toContain("tidak dapat dihapus");
  });

  it("penutupan sisa mencatat sisa barang per satuan, terpisah dari yang sudah diserahkan", async () => {
    const { draft, tokens } = await goodsProposal();
    expect(
      (
        await post(
          `/proposals/${draft.id}/realizations`,
          {
            expectedVersion: draft.version,
            operationId: crypto.randomUUID(),
            items: [
              { aidLineId: "aid-1", beneficiaryId: "ben-1", method: "GOODS_HANDOVER", quantity: "15", unit: "kg", reportedAt: NOW },
            ],
          },
          tokens.amilToken
        )
      ).status
    ).toBe(201);

    const closed = await terminate(draft, tokens, "CLOSE_REMAINDER", "Stok gudang habis, sisa tidak disalurkan");
    expect(closed.decideRes!.status).toBe(200);
    const closure = (await closed.decideRes!.json()).closure;

    // No money changed hands, so the IDR totals stay zero while the goods remainders carry the figures.
    expect(closure.totalRealizedIdr).toBe("0");
    expect(closure.totalUnrealizedRemainderIdr).toBe("0");

    const beras = closure.goodsUnitRemainders.find((g: any) => g.unit === "kg");
    expect(beras.totalApproved).toBe("25");
    expect(beras.totalRealized).toBe("15");
    expect(beras.totalUnrealizedRemainder).toBe("10");

    const minyak = closure.goodsUnitRemainders.find((g: any) => g.unit === "liter");
    expect(minyak.totalRealized).toBe("0");
    expect(minyak.totalUnrealizedRemainder).toBe("10");

    // Per line, what was handed over and what was closed are reported apart.
    const line = closure.lineRemainders.find((l: any) => l.aidLineId === "aid-1");
    expect(line.kind).toBe("GOODS");
    expect(line.unit).toBe("kg");
    expect(line.realized).toBe("15");
    expect(line.unrealizedRemainder).toBe("10");
  });

  it("revisi yang kalah bersaing menolak menimpa versi yang sudah terisi dan dapat dipulihkan dengan membaca ulang", async () => {
    const { draft, tokens } = await prepareApprovedProposal({ purpose: "Dua revisi bersaing" });

    // Two revisions are drafted against the same in-force version. Only one may reach it.
    const firstRes = await post(
      `/proposals/${draft.id}/revisions`,
      {
        reason: "Revisi pertama",
        operationId: crypto.randomUUID(),
        beneficiaries: draft.beneficiaries,
        aidLines: draft.aidLines.map((line: any) =>
          line.id === "aid-1" ? { ...line, value: { ...line.value, amountApprovedIdr: "900000" } } : line
        ),
        expectedVersion: draft.version,
      },
      tokens.amilToken
    );
    expect(firstRes.status).toBe(201);
    const first = (await firstRes.json()).revision;

    // A competing revision against a version that has already moved on is refused outright.
    const staleRes = await post(
      `/proposals/${draft.id}/revisions`,
      {
        reason: "Revisi kedua",
        operationId: crypto.randomUUID(),
        beneficiaries: draft.beneficiaries,
        aidLines: draft.aidLines,
        expectedVersion: draft.version,
      },
      tokens.amilToken
    );
    expect(staleRes.status).toBe(409);

    // Occupy the target version behind the revision's back, as a racing decision would.
    await database.handle().execute(
      sql`INSERT INTO proposal_versions (proposal_id, version, institution_id, status, data_json, created_at)
          VALUES (${draft.id}, ${first.toVersion}, ${SINAR}, 'APPROVED', ${JSON.stringify({ beneficiaries: [], aidLines: [] })}, ${NOW})`
    );

    await post(
      `/proposals/${draft.id}/revisions/${first.id}/start-examination`,
      { operationId: crypto.randomUUID() },
      tokens.examinerToken
    );
    await post(
      `/proposals/${draft.id}/revisions/${first.id}/ready`,
      {
        operationId: crypto.randomUUID(),
        checklist: {
          administrativeChecksOk: true,
          eligibilityChecksOk: true,
          alternativeIdReviewed: true,
          recurringAidExceptions: [],
          notes: "",
        },
      },
      tokens.examinerToken
    );

    const docRes = await post(
      `/proposals/${draft.id}/decision-documents`,
      {
        fileName: "sk-revisi-bersaing.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("SK Revisi Bersaing").toString("base64"),
        expectedVersion: draft.version,
      },
      tokens.approverToken
    );
    const decisionDocumentId = (await docRes.json()).document.id;

    const chalRes = await post(
      `/proposals/${draft.id}/revisions/${first.id}/decision-challenge`,
      { action: "APPROVE", decisionReference: "SK-REV-BERSAING", decisionDate: "2026-03-28", decisionDocumentId },
      tokens.approverToken
    );
    expect(chalRes.status).toBe(201);
    const { challenge, typedData } = await chalRes.json();
    const signature = await approverSinar.signTypedData(signable(typedData));

    const decideRes = await post(
      `/proposals/${draft.id}/revisions/${first.id}/decide`,
      { nonce: challenge.nonce, signature, operationId: crypto.randomUUID() },
      tokens.approverToken
    );
    expect(decideRes.status).toBe(409);
    expect((await decideRes.json()).error).toContain("Baca ulang pengajuan");

    // Recoverable by re-reading: the proposal is untouched and still readable at its own version.
    const readRes = await get(`/proposals/${draft.id}`, tokens.amilToken);
    expect(readRes.status).toBe(200);
    expect((await readRes.json()).draft.version).toBe(draft.version);
  });

  // Skenario 25: the whole change is demonstrable in a browser, decision trail still readable.
  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)(
    "browser: revisi sampai pengesahan ulang, lalu penutupan sisa dengan jejak keputusan terbaca",
    async () => {
      const prepared = await prepareApprovedProposal({ purpose: "Revisi Smoke A" });
      const reapproving = await prepareApprovedProposal({ purpose: "Pengesahan Ulang Smoke C" });
      const closing = await prepareApprovedProposal({
        purpose: "Tutup Sisa Smoke B",
        lines: [
          { id: "aid-1", beneficiaryId: "ben-1", amountIdr: "1000000" },
          { id: "aid-2", beneficiaryId: "ben-2", amountIdr: "2000000" },
        ],
      });

      // The closing proposal needs a partial realization before its remainder can be closed.
      expect(
        (
          await post(
            `/proposals/${closing.draft.id}/realizations`,
            {
              expectedVersion: closing.draft.version,
              operationId: crypto.randomUUID(),
              items: [
                { aidLineId: "aid-1", beneficiaryId: "ben-1", method: "CASH", amountIdr: "500000", reportedAt: NOW },
              ],
            },
            closing.tokens.amilToken
          )
        ).status
      ).toBe(201);

      const built = await Bun.build({
        entrypoints: [new URL("../../frontend/test/officer-smoke.tsx", import.meta.url).pathname],
        target: "browser",
        define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "" }) },
      });
      if (!built.success) throw new Error(built.logs.join("\n"));
      const bundle = await built.outputs[0]!.text();

      let walletAccount = approverSinar;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(req) {
          const path = new URL(req.url).pathname;
          if (path === "/")
            return new Response('<!doctype html><div id="root"></div><script type="module" src="/smoke.js"></script>', {
              headers: { "Content-Type": "text/html" },
            });
          if (path === "/smoke.js")
            return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
          if (path === "/switch-wallet") {
            walletAccount = walletAccount === approverSinar ? amilSinar : approverSinar;
            return Response.json([walletAccount.address]);
          }
          if (path === "/wallet-rpc") {
            const { method, params } = await req.json();
            if (["eth_accounts", "eth_requestAccounts"].includes(method)) return Response.json([walletAccount.address]);
            if (method === "eth_chainId") return Response.json("0x7a69");
            if (method === "eth_signTypedData_v4")
              return Response.json(await walletAccount.signTypedData(JSON.parse(params[1])));
            return Response.json(null);
          }
          return app.fetch(req);
        },
      });

      let browser: any;
      try {
        const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
        browser = await chromium.launch({
          executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE,
          headless: true,
          args: ["--no-sandbox"],
        });
        const page = await browser.newPage();
        await page.addInitScript((now: number) => {
          Date.now = () => now * 1000;
        }, NOW);
        page.setDefaultTimeout(15000);
        const errors: string[] = [];
        page.on("pageerror", (error: Error) => errors.push(error.message));

        // After a reload the workspace session survives, so the sign-in step is skipped.
        const signInToProgram = async (programId: string) => {
          await page.getByRole("button", { name: /^0x/ }).waitFor();
          const signIn = page.getByRole("button", { name: "Tandatangani dan masuk", exact: true });
          if (await signIn.count()) {
            await page.getByLabel("Pengelola Zakat", { exact: true }).selectOption(SINAR);
            await page.waitForFunction(
              (institution: string) =>
                (document.querySelector("#institution") as HTMLSelectElement)?.value === institution,
              SINAR
            );
            await signIn.click();
          }
          await page.getByLabel(/Program bantuan/).selectOption(programId);
        };

        await page.goto(server.url.toString());
        await signInToProgram(prepared.programId);

        // 1. The revision is composed and submitted from the browser by the signed-in officer.
        await page.getByRole("button", { name: /Revisi Smoke A/ }).click();
        await page.getByRole("button", { name: "Ajukan revisi", exact: true }).click();
        let dialog = page.getByRole("dialog");
        await dialog.getByText(/Rincian Hak Bantuan/).waitFor();
        await dialog.getByLabel(/Alasan Pengajuan Revisi/).fill("Penyesuaian alokasi setelah verifikasi lapangan");
        await dialog.getByRole("button", { name: "Kirim Pengajuan Revisi", exact: true }).click();

        // The revision is now visible in the workflow banner, awaiting examination.
        await page.getByText(/Revisi Pengajuan #1/).waitFor();
        await page.getByText("Menunggu Pemeriksaan", { exact: true }).waitFor();

        // 2. Re-approval through the UI, on a revision drafted and examined by other officers
        //    (the amil and the examiner), as separation of duties requires.
        const revRes = await post(
          `/proposals/${reapproving.draft.id}/revisions`,
          {
            reason: "Penyesuaian alokasi hasil verifikasi",
            operationId: crypto.randomUUID(),
            beneficiaries: reapproving.draft.beneficiaries,
            aidLines: reapproving.draft.aidLines.map((line: any) =>
              line.id === "aid-1" ? { ...line, value: { ...line.value, amountApprovedIdr: "750000" } } : line
            ),
            expectedVersion: reapproving.draft.version,
          },
          reapproving.tokens.amilToken
        );
        expect(revRes.status).toBe(201);
        const pendingRevision = (await revRes.json()).revision;

        for (const step of [
          { path: "start-examination", body: { operationId: crypto.randomUUID() } },
          {
            path: "ready",
            body: {
              operationId: crypto.randomUUID(),
              checklist: {
                administrativeChecksOk: true,
                eligibilityChecksOk: true,
                alternativeIdReviewed: true,
                recurringAidExceptions: [],
                notes: "Telaah ulang versi revisi",
              },
            },
          },
        ]) {
          const stepRes = await post(
            `/proposals/${reapproving.draft.id}/revisions/${pendingRevision.id}/${step.path}`,
            step.body,
            reapproving.tokens.examinerToken
          );
          expect(stepRes.status).toBe(200);
        }

        await page.goto(server.url.toString());
        await signInToProgram(reapproving.programId);
        await page.getByRole("button", { name: /Pengesahan Ulang Smoke C/ }).click();
        await page.getByText("Siap Diputus", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Putuskan Revisi Lembaga", exact: true }).click();

        dialog = page.getByRole("dialog");
        await dialog.getByLabel(/Nomor SK \/ Berita Acara/).fill("SK-SMOKE-REV");
        await dialog.getByLabel(/Berkas Dokumen SK/).setInputFiles({
          name: "sk-smoke-rev.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("SK Pengesahan Revisi Smoke"),
        });
        await dialog.getByRole("button", { name: "Tanda Tangani Pengesahan Revisi", exact: true }).click();

        // The new version is in force: the revision reads as approved.
        await page.getByText("Revisi Disetujui", { exact: true }).waitFor();

        // 3. The remainder closure of the second proposal, end to end, with its reason.
        // A fresh page drops the open proposal, so the program picker is reachable again.
        await page.goto(server.url.toString());
        await signInToProgram(closing.programId);
        await page.getByRole("button", { name: /Tutup Sisa Smoke B/ }).click();
        await page.getByRole("button", { name: "Tutup sisa", exact: true }).click();
        dialog = page.getByRole("dialog");
        await dialog.getByText("Sisa Hak yang Akan Ditutup:", { exact: true }).waitFor();
        await dialog.getByLabel(/Nomor SK Penutupan Sisa/).fill("SK-SMOKE-TUTUP");
        await dialog.getByLabel(/Berkas Dokumen SK Penutupan Sisa/).setInputFiles({
          name: "sk-smoke-tutup.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("SK Penutupan Sisa Smoke"),
        });
        await dialog.getByLabel(/Alasan Penutupan Sisa/).fill("Periode program berakhir dan penerima menolak sisa");
        await dialog.getByRole("button", { name: "Tanda Tangani Penutupan Sisa", exact: true }).click();

        // 4. The decision trail stays readable: outcome, reason, and disbursed vs undisbursed apart.
        await page.getByText("Sisa hak pengajuan ditutup lembaga", { exact: true }).waitFor();

        // Reopening the proposal reads the stored decision and closure back from the server.
        await page.goto(server.url.toString());
        await signInToProgram(closing.programId);
        await page.getByRole("button", { name: /Tutup Sisa Smoke B/ }).click();
        await page.getByText("Sisa hak pengajuan ditutup lembaga", { exact: true }).waitFor();
        await page.getByText("SK-SMOKE-TUTUP", { exact: true }).waitFor();
        await page.getByText("Periode program berakhir dan penerima menolak sisa", { exact: true }).waitFor();
        await page.getByText(/Rincian Sisa Hak yang Ditutup/).waitFor();
        await page.getByText(/Sisa yang ditutup tidak dipindahkan ke penerima lain/).waitFor();

        await page.screenshot({ path: "/tmp/issue96-browser.png", fullPage: true });
        expect(errors).toEqual([]);
      } finally {
        await browser?.close();
        server.stop(true);
      }
    },
    60000
  );

  it("ketahanan data revisi, penutupan sisa dan pembatalan lintas restart database", async () => {
    const { draft, tokens } = await prepareApprovedProposal();

    // 1. Catat realisasi sebagian
    await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
        items: [{ aidLineId: "aid-1", beneficiaryId: "ben-1", method: "CASH", amountIdr: "500000", reportedAt: NOW }],
      },
      tokens.amilToken
    );

    // 2. Tutup sisa bantuan
    const docRes = await post(
      `/proposals/${draft.id}/decision-documents`,
      {
        fileName: "sk-tutup.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("SK Tutup").toString("base64"),
        expectedVersion: draft.version,
      },
      tokens.approverToken
    );
    const decisionDocumentId = (await docRes.json()).document.id;

    const chalRes = await post(
      `/proposals/${draft.id}/close-remainder-challenge`,
      {
        decisionReference: "SK-TUTUP-DURABLE",
        decisionDate: "2026-03-25",
        decisionDocumentId,
        reason: "Penutupan sisa tahan uji",
        expectedVersion: draft.version,
      },
      tokens.approverToken
    );
    const { challenge, typedData } = await chalRes.json();
    const signature = await approverSinar.signTypedData(signable(typedData));

    await post(
      `/proposals/${draft.id}/decide`,
      {
        action: "CLOSE_REMAINDER",
        decisionReference: "SK-TUTUP-DURABLE",
        decisionDate: "2026-03-25",
        decisionDocumentId,
        signerAccount: challenge.signerAccount,
        mandateId: challenge.mandateId,
        signature,
        nonce: challenge.nonce,
        reason: "Penutupan sisa tahan uji",
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
      },
      tokens.approverToken
    );

    // 3. Simulasikan "restart" runtime: instansiasi ulang store dari database yang sama
    const restartedDisbursement = createDisbursementStore(database.handle());
    configureWorkspace({
      store,
      disbursement: restartedDisbursement,
      activities,
      files,
      ethCall: async () => "0x",
      now: () => clock,
      sessionTtlSeconds: 3600,
      challengeTtlSeconds: 300,
    });

    // 4. Baca proposal dan summary setelah restart
    const restartedAmilToken = await signIn(amilSinar, SINAR);
    const readRes = await get(`/proposals/${draft.id}`, restartedAmilToken);
    expect(readRes.status).toBe(200);
    const proposal = (await readRes.json()).draft;
    expect(proposal.status).toBe("REMAINDER_CLOSED");
    expect(proposal.closureReason).toBe("Penutupan sisa tahan uji");
    expect(proposal.remainderClosed).toBeDefined();
    expect(proposal.remainderClosed.totalUnrealizedRemainderIdr).toBe("2500000");

    const sumRes = await get(`/proposals/${draft.id}/realization-summary`, restartedAmilToken);
    expect(sumRes.status).toBe(200);
    expect((await sumRes.json()).summary.disbursementStatus).toBe("REMAINDER_CLOSED");
  });
});

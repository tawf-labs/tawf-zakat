/**
 * Integration tests for Bantuan Barang realization, exact decimal math,
 * BAST allocation, and separate operational expenses (Ticket #95, Spec #86, Pilot Amendment #100).
 *
 * Real HTTP routes over real SQL and private encrypted file storage.
 * Prohibits float math, unit mixing, and IDR fabrication for unvalued goods.
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
import { calculateProposalRealizationSummary, computeRightsDigest, REALIZATION_DISCLAIMER_NOTICE } from "../src/disbursement";

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
    body: JSON.stringify(/\/(panjar|items|disputes|examinations)$/.test(path)
      ? { operationId: crypto.randomUUID(), ...(body as object) } : body),
  });

/** Panjar and biaya operasional, recorded in the Biaya operasional tab (ADR-0042). */
async function issuePanjar(proposalId: string, amountIdr: string, purpose: string, cashOutRef: string, token: string) {
  const res = await post(`/proposals/${proposalId}/operational-costs/panjar`,
    { holderOfficerId: "off-amil-sinar", amountIdr, purpose, cashOutRef, issuedOn: "2026-09-28" }, token);
  expect(res.status).toBe(201);
  return (await res.json()).panjar.id as string;
}

async function recordCost(proposalId: string, panjarId: string, amountIdr: string, purpose: string, payee: string, token: string) {
  const res = await post(`/proposals/${proposalId}/operational-costs/items`, { items: [{
    spentOn: "2026-09-28", purpose, amountIdr, payee, fundingSource: { kind: "PANJAR", panjarId },
  }] }, token);
  expect(res.status).toBe(201);
  expect((await res.json()).results[0].issues).toBeUndefined();
}

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
  contentBase64: Buffer.from("Konten dokumen pengajuan barang").toString("base64"),
});

async function prepareApprovedGoodsProposal(options?: {
  beneficiariesCount?: number;
  lines?: Array<{
    beneficiaryIndex: number;
    aidType: string;
    unit: string;
    quantityRequested: string;
    quantityApproved?: string;
    valuedAmountIdr?: string | null;
    valuationBasis?: string | null;
  }>;
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
      name: "Program Bantuan Pangan & Sembako",
      purpose: "Distribusi logistik beras dan sembako",
      fundType: "ZAKAT",
      scope: "Jawa Barat",
      referenceCeiling: "999999999999999999",
    },
    adminToken
  );
  expect(progRes.status).toBe(201);
  const programId = (await progRes.json()).program.id;

  const count = options?.beneficiariesCount ?? 1;

  if (count > 1) {
    const curPol = (await (await get("/policy", adminToken)).json()).policy;
    const savePolRes = await post("/policy", { ...curPol, expectedVersion: curPol.version, requireIdentityDoc: false }, adminToken);
    expect(savePolRes.status).toBe(200);
  }

  const beneficiaries = [];
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
  }

  const defaultLines = [
    {
      beneficiaryIndex: 1,
      aidType: "Beras Premium",
      unit: "kg",
      quantityRequested: "25",
      quantityApproved: "25",
      valuedAmountIdr: null,
      valuationBasis: null,
    },
  ];

  const lineConfigs = options?.lines ?? defaultLines;
  const aidLines = lineConfigs.map((cfg, idx) => ({
    id: `aid-${idx + 1}`,
    beneficiaryId: `ben-${cfg.beneficiaryIndex}`,
    aidType: cfg.aidType,
    period: "2026-03",
    value: {
      kind: "GOODS",
      unit: cfg.unit,
      quantityRequested: cfg.quantityRequested,
      valuedAmountIdr: cfg.valuedAmountIdr ?? null,
      valuationBasis: cfg.valuationBasis ?? null,
    },
  }));

  const propRes = await post(
    "/proposals",
    {
      expectedVersion: 0,
      operationId: crypto.randomUUID(),
      programId,
      originOfRequest: "Survei Logistik",
      purpose: options?.purpose ?? "Penyaluran beras dan bahan pokok",
      personInCharge: "Ahmad Amil Logistik",
      aidPeriod: { start: "2026-03-01", end: "2026-03-31" },
      beneficiaries,
      aidLines,
    },
    amilToken
  );
  expect(propRes.status).toBe(201);
  const draft = (await propRes.json()).draft;

  for (const cat of ["PROPOSAL_LETTER", "RECIPIENT_VERIFICATION", "BENEFICIARY_IDENTITY"]) {
    expect((await post(`/proposals/${draft.id}/documents`, documentInput(cat), amilToken)).status).toBe(201);
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
        notes: "Kelayakan bantuan barang disetujui",
      },
    },
    examinerToken
  );
  expect(readyRes.status).toBe(200);
  const readyDraft = (await readyRes.json()).draft;

  const docRes = await post(
    `/proposals/${readyDraft.id}/decision-documents`,
    {
      fileName: "sk-distribusi-barang.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("SK Distribusi Logistik").toString("base64"),
      expectedVersion: readyDraft.version,
    },
    approverToken
  );
  expect(docRes.status).toBe(201);
  const decisionDocumentId = (await docRes.json()).document.id;

  const approvedAidLines = lineConfigs.map((cfg, idx) => ({
    id: `aid-${idx + 1}`,
    quantityApproved: cfg.quantityApproved ?? cfg.quantityRequested,
  }));

  const intent = { action: "APPROVE", decisionReference: "SK-LOGISTIK-001", decisionDate: "2026-03-15", decisionDocumentId };
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

type Draft = Awaited<ReturnType<typeof prepareApprovedGoodsProposal>>["draft"];

const goodsItem = (draft: Draft, lineIndex: number, overrides: Record<string, unknown> = {}) => ({
  aidLineId: draft.aidLines[lineIndex].id,
  beneficiaryId: draft.aidLines[lineIndex].beneficiaryId,
  reportedAt: clock - 1800,
  method: "GOODS_HANDOVER",
  quantity: "10",
  unit: "kg",
  notes: "Penyerahan di gudang kecamatan",
  ...overrides,
});

const realize = (draft: Draft, token: string, items: unknown[], extra: Record<string, unknown> = {}) =>
  post(`/proposals/${draft.id}/realizations`, { operationId: crypto.randomUUID(), expectedVersion: draft.version, items, ...extra }, token);

const uploadEvidence = (draft: Draft, realizationId: string, token: string, input: Record<string, unknown>) =>
  post(
    `/proposals/${draft.id}/realizations/${realizationId}/documents`,
    {
      operationId: crypto.randomUUID(),
      fileName: "bast-penyerahan.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("BAST Penyerahan Barang Fisik").toString("base64"),
      ...input,
    },
    token
  );

describe("Realisasi Bantuan Barang, Kuantitas Desimal, Alokasi BAST, dan Biaya Operasional (Issue #95)", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "disbursement-goods-test-"));
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

  it("antrean bukti mempertahankan jenis/kuantitas/satuan dan tidak mengubah barang menjadi Rp0", async () => {
    const { draft, amilToken } = await prepareApprovedGoodsProposal({ lines: [
      { beneficiaryIndex: 1, aidType: "Beras", unit: "kg", quantityRequested: "0.3" },
      { beneficiaryIndex: 1, aidType: "Gula", unit: "kg", quantityRequested: "2" },
      { beneficiaryIndex: 1, aidType: "Sembako", unit: "paket", quantityRequested: "1" },
    ] });
    const response = await realize(draft, amilToken, [goodsItem(draft, 0, { quantity: "0.1" }),
      goodsItem(draft, 0, { quantity: "0.2" }), goodsItem(draft, 1, { quantity: "2" }),
      goodsItem(draft, 2, { quantity: "1", unit: "paket" })]);
    expect(response.status).toBe(201);
    const records = (await response.json()).records;
    const readQueue = async () => (await (await get("/proposals/queue/incomplete-evidence", amilToken)).json()).queue;
    expect(await readQueue()).toEqual([{ proposalId: draft.id, purpose: draft.purpose, pendingCount: 4,
      totalPendingIdr: null, oldestPendingReportedAt: clock - 1800, goods: [
        { aidType: "Beras", unit: "kg", quantity: "0.3" },
        { aidType: "Gula", unit: "kg", quantity: "2" },
        { aidType: "Sembako", unit: "paket", quantity: "1" },
      ] }]);
    for (const record of records) {
      expect((await uploadEvidence(draft, record.id, amilToken, { documentType: "RECEIPT_OR_BAST",
        allocations: [{ realizationId: record.id, quantity: record.quantity, unit: record.unit }],
      })).status).toBe(201);
    }
    expect(await readQueue()).toEqual([]);
  });

  it("menolak alokasi BAST negatif, format rusak, dan campuran uang/barang tanpa mengubah bukti", async () => {
    const { draft, amilToken } = await prepareApprovedGoodsProposal();
    const result = await realize(draft, amilToken, [goodsItem(draft, 0)]);
    const realization = (await result.json()).records[0];
    for (const quantity of ["-1", "0", "rusak", "1e1", "1"]) {
      const rejected = await uploadEvidence(draft, realization.id, amilToken, {
        documentType: "RECEIPT_OR_BAST",
        allocations: [{ realizationId: realization.id, amountIdr: "1", quantity, unit: "kg" }],
      });
      expect(rejected.status).toBe(400);
    }
    const excess = await uploadEvidence(draft, realization.id, amilToken, {
      documentType: "RECEIPT_OR_BAST",
      allocations: [{ realizationId: realization.id, quantity: "11", unit: "kg" }],
    });
    expect(excess.status).toBe(400);
    const overview = await (await get(`/proposals/${draft.id}/realizations`, amilToken)).json();
    expect((await (await get(`/proposals/${draft.id}/realization-documents`, amilToken)).json()).documents).toHaveLength(0);
    expect(overview.realizations[0].evidenceStatus).toBe("EVIDENCE_PENDING");
    const valid = await uploadEvidence(draft, realization.id, amilToken, {
      documentType: "RECEIPT_OR_BAST",
      allocations: [{ realizationId: realization.id, quantity: "10", unit: "kg" }],
    });
    expect(valid.status).toBe(201);
    expect((await valid.json()).realizations[0].evidenceStatus).toBe("EVIDENCE_COMPLETE");
  });

  it("memisahkan jenis barang dengan satuan sama dan menggabungkan jenis yang sama", async () => {
    const { draft, amilToken } = await prepareApprovedGoodsProposal({ beneficiariesCount: 2, lines: [
      { beneficiaryIndex: 1, aidType: "Beras", unit: "kg", quantityRequested: "10" },
      { beneficiaryIndex: 1, aidType: "Gula", unit: "kg", quantityRequested: "2" },
      { beneficiaryIndex: 2, aidType: "Beras", unit: "kg", quantityRequested: "5" },
    ] });
    const response = await realize(draft, amilToken, [goodsItem(draft, 0, { quantity: "5" }), goodsItem(draft, 1, { quantity: "2" })]);
    const { summary } = await response.json();
    expect(summary.unitSummaries).toEqual([
      { aidType: "Beras", unit: "kg", approved: "15", realized: "5", remaining: "10" },
      { aidType: "Gula", unit: "kg", approved: "2", realized: "2", remaining: "0" },
    ]);
  });

  it("mencatat realisasi barang bertahap dengan kuantitas desimal dan melacak sisa per satuan", async () => {
    const { draft, amilToken } = await prepareApprovedGoodsProposal({
      lines: [
        { beneficiaryIndex: 1, aidType: "Beras Premium", unit: "kg", quantityRequested: "25", quantityApproved: "25" },
      ],
    });

    const res = await realize(draft, amilToken, [
      goodsItem(draft, 0, { quantity: "12.5", unit: "kg" }),
    ]);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.notice).toBe(REALIZATION_DISCLAIMER_NOTICE);
    expect(body.records).toHaveLength(1);

    const rec = body.records[0];
    expect(rec.method).toBe("GOODS_HANDOVER");
    expect(rec.amountIdr).toBeNull();
    expect(rec.quantity).toBe("12.5");
    expect(rec.unit).toBe("kg");
    expect(rec.evidenceStatus).toBe("EVIDENCE_PENDING");
    expect(rec.confirmationStatus).toBe("UNCONFIRMED");
    expect(rec.recordedAt).toBe(clock);
    expect(rec.operatorAccount).toBe(amilSinar.address.toLowerCase());

    const summary = body.summary;
    expect(summary.unitSummaries.find((item: any) => item.unit === "kg")).toEqual({
      aidType: "Beras Premium",
      unit: "kg",
      approved: "25",
      realized: "12.5",
      remaining: "12.5",
    });
    expect(summary.disbursementStatus).toBe("PARTIALLY_REALIZED");
    expect(summary.paymentEventCount).toBe(1);

    // Salurkan sisa 12.5 kg
    const res2 = await realize(draft, amilToken, [
      goodsItem(draft, 0, { quantity: "12.5", unit: "kg" }),
    ]);
    expect(res2.status).toBe(201);
    const summary2 = (await res2.json()).summary;
    expect(summary2.unitSummaries.find((item: any) => item.unit === "kg").remaining).toBe("0");
    expect(summary2.disbursementStatus).toBe("FULLY_REALIZED");
  });

  it("mencegah kesalahan matematika float pada pecahan desimal bertingkat", async () => {
    const { draft, amilToken } = await prepareApprovedGoodsProposal({
      lines: [
        { beneficiaryIndex: 1, aidType: "Minyak Goreng", unit: "liter", quantityRequested: "10", quantityApproved: "10" },
      ],
    });

    // 3.333 liter tahap 1
    const res1 = await realize(draft, amilToken, [goodsItem(draft, 0, { quantity: "3.333", unit: "liter" })]);
    expect(res1.status).toBe(201);

    // 3.333 liter tahap 2
    const res2 = await realize(draft, amilToken, [goodsItem(draft, 0, { quantity: "3.333", unit: "liter" })]);
    expect(res2.status).toBe(201);

    const summary = (await res2.json()).summary;
    expect(summary.unitSummaries.find((item: any) => item.unit === "liter")).toEqual({
      aidType: "Minyak Goreng",
      unit: "liter",
      approved: "10",
      realized: "6.666",
      remaining: "3.334",
    });

    // Menolak format kuantitas tidak sah
    const badRes = await realize(draft, amilToken, [goodsItem(draft, 0, { quantity: "3.3.3", unit: "liter" })]);
    expect(badRes.status).toBe(400);

    const badRes2 = await realize(draft, amilToken, [goodsItem(draft, 0, { quantity: "-5", unit: "liter" })]);
    expect(badRes2.status).toBe(400);

    const badRes3 = await realize(draft, amilToken, [goodsItem(draft, 0, { quantity: "0", unit: "liter" })]);
    expect(badRes3.status).toBe(400);
  });

  it("menangani pengajuan multi-satuan dan melarang pencampuran satuan berbeda", async () => {
    const { draft, amilToken } = await prepareApprovedGoodsProposal({
      lines: [
        { beneficiaryIndex: 1, aidType: "Beras Premium", unit: "kg", quantityRequested: "20" },
        { beneficiaryIndex: 1, aidType: "Paket Sembako", unit: "paket", quantityRequested: "2" },
      ],
    });

    // Mencoba mencatat satuan 'paket' pada baris 'kg' ditolak
    const mismatchRes = await realize(draft, amilToken, [
      { aidLineId: draft.aidLines[0].id, beneficiaryId: "ben-1", method: "GOODS_HANDOVER", quantity: "5", unit: "paket", reportedAt: clock - 100 },
    ]);
    expect(mismatchRes.status).toBe(400);
    expect((await mismatchRes.json()).error).toContain("Satuan");

    // Catat realisasi untuk masing-masing baris dengan satuan yang benar
    const okRes = await realize(draft, amilToken, [
      { aidLineId: draft.aidLines[0].id, beneficiaryId: "ben-1", method: "GOODS_HANDOVER", quantity: "15", unit: "kg", reportedAt: clock - 100 },
      { aidLineId: draft.aidLines[1].id, beneficiaryId: "ben-1", method: "GOODS_HANDOVER", quantity: "2", unit: "paket", reportedAt: clock - 100 },
    ]);
    expect(okRes.status).toBe(201);
    const summary = (await okRes.json()).summary;
    expect(summary.unitSummaries.find((item: any) => item.unit === "kg")).toEqual({ aidType: "Beras Premium", unit: "kg", approved: "20", realized: "15", remaining: "5" });
    expect(summary.unitSummaries.find((item: any) => item.unit === "paket")).toEqual({ aidType: "Paket Sembako", unit: "paket", approved: "2", realized: "2", remaining: "0" });
    expect(summary.disbursementStatus).toBe("PARTIALLY_REALIZED");
  });

  it("tidak merekayasa nilai rupiah saat nilai barang tidak diketahui (unknown value is null, not 0)", async () => {
    const { draft, amilToken } = await prepareApprovedGoodsProposal({
      lines: [
        { beneficiaryIndex: 1, aidType: "Beras Zakat Fitrah", unit: "kg", quantityRequested: "50", valuedAmountIdr: null },
      ],
    });

    const res = await realize(draft, amilToken, [
      goodsItem(draft, 0, { quantity: "50", unit: "kg" }),
    ]);
    expect(res.status).toBe(201);
    const summary = (await res.json()).summary;
    expect(summary.hasUnvaluedGoods).toBe(true);
    expect(summary.totalApprovedIdr).toBe("0");
    expect(summary.totalRealizedIdr).toBe("0");
    expect(summary.totalValuedGoodsApprovedIdr).toBeNull();
  });

  it("tidak menganggap nominal historis tanpa dasar sebagai valuasi tersedia", async () => {
    const { draft } = await prepareApprovedGoodsProposal();
    const legacy = { ...draft, aidLines: draft.aidLines.map((line: any) => ({ ...line,
      value: { ...line.value, valuedAmountIdr: "1500000", valuationBasis: undefined },
    })) };
    const summary = calculateProposalRealizationSummary(legacy, []);
    expect(summary.hasUnvaluedGoods).toBe(true);
    expect(summary.totalValuedGoodsApprovedIdr).toBeNull();
    expect(summary.lines[0].valuedAmountIdr).toBeNull();
    expect(legacy.aidLines[0].value.valuedAmountIdr).toBe("1500000");
    const intent = { action: "APPROVE" as const, decisionReference: "SK-01", decisionDate: "2026-03-01", notes: "", rejectionReason: null };
    const original = computeRightsDigest(legacy.aidLines, intent);
    const withBasis = legacy.aidLines.map((line: any) => ({ ...line, value: { ...line.value, valuationBasis: "Penawaran pemasok REF-01" } }));
    expect(computeRightsDigest(withBasis, intent)).not.toBe(original);
  });

  it("menampilkan valuasi rupiah bila ada dasar valuasi yang dinyatakan", async () => {
    const { draft, amilToken } = await prepareApprovedGoodsProposal({
      lines: [
        { beneficiaryIndex: 1, aidType: "Beras Berbayar", unit: "kg", quantityRequested: "100", valuedAmountIdr: "1500000", valuationBasis: "Estimasi 100 kg × Rp15.000; penawaran pemasok LOG-01 tanggal 2026-03-01" },
      ],
    });

    const res = await realize(draft, amilToken, [
      goodsItem(draft, 0, { quantity: "50", unit: "kg" }),
    ]);
    expect(res.status).toBe(201);
    const summary = (await res.json()).summary;
    expect(summary.hasUnvaluedGoods).toBe(false);
    expect(summary.totalValuedGoodsApprovedIdr).toBe("1500000");
    expect(summary.lines[0].valuationBasis).toBe(draft.aidLines[0].value.valuationBasis);
    expect(summary.lines[0].valuationBasis).toContain("LOG-01");
    await database.reopen();
    store = createWorkspaceStore(database.handle());
    disbursement = createDisbursementStore(database.handle());
    activities = createActivityStore(database.handle());
    configure();
    const reread = await (await get(`/proposals/${draft.id}/realization-summary`, amilToken)).json();
    expect(reread.summary.lines[0].valuationBasis).toBe(summary.lines[0].valuationBasis);

    // A new proposal cannot claim a value while omitting its basis; incomplete drafts remain saveable.
    const missingBasis = await post("/proposals", {
      ...draft, id: undefined, expectedVersion: 0, operationId: crypto.randomUUID(),
      aidLines: draft.aidLines.map((line: any) => ({ ...line, value: { ...line.value, valuationBasis: null } })),
    }, amilToken);
    expect(missingBasis.status).toBe(201);
    const incomplete = (await missingBasis.json()).draft;
    expect(incomplete.issues.some((issue: any) => issue.field === "value.valuationBasis")).toBe(true);
    const rejected = await post(`/proposals/${incomplete.id}/submit`, { expectedVersion: incomplete.version, operationId: crypto.randomUUID() }, amilToken);
    expect(rejected.status).toBe(400);
  });

  it("menegakkan batas hak barang secara atomik dan mencegah over-realization di bawah konkuren", async () => {
    const { draft, amilToken } = await prepareApprovedGoodsProposal({
      lines: [
        { beneficiaryIndex: 1, aidType: "Beras", unit: "kg", quantityRequested: "20" },
      ],
    });

    // Mencoba merealisasikan melebihi batas hak langsung ditolak
    const excess = await realize(draft, amilToken, [goodsItem(draft, 0, { quantity: "20.1", unit: "kg" })]);
    expect(excess.status).toBe(409);
    expect((await excess.json()).error).toContain("melebihi sisa hak");

    // Dua permintaan konkuren masing-masing meminta 15 kg (total 30 kg > 20 kg)
    const [p1, p2] = await Promise.all([
      realize(draft, amilToken, [goodsItem(draft, 0, { quantity: "15", unit: "kg" })]),
      realize(draft, amilToken, [goodsItem(draft, 0, { quantity: "15", unit: "kg" })]),
    ]);

    const statuses = [p1.status, p2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const sumRes = await get(`/proposals/${draft.id}/realization-summary`, amilToken);
    expect(sumRes.status).toBe(200);
    expect((await sumRes.json()).summary.unitSummaries.find((item: any) => item.unit === "kg").realized).toBe("15");
  });

  it("mengulang kembali respon yang hilang secara idempoten tanpa mencatat barang ganda", async () => {
    const { draft, amilToken } = await prepareApprovedGoodsProposal({
      lines: [
        { beneficiaryIndex: 1, aidType: "Beras", unit: "kg", quantityRequested: "20" },
      ],
    });

    const opId = crypto.randomUUID();
    const payload = {
      operationId: opId,
      expectedVersion: draft.version,
      items: [goodsItem(draft, 0, { quantity: "10", unit: "kg" })],
    };

    const first = await post(`/proposals/${draft.id}/realizations`, payload, amilToken);
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await post(`/proposals/${draft.id}/realizations`, payload, amilToken);
    expect(second.status).toBe(201);
    const secondBody = await second.json();
    expect(secondBody.records[0].id).toBe(firstBody.records[0].id);

    // List harus tetap 1
    const listRes = await get(`/proposals/${draft.id}/realizations`, amilToken);
    expect((await listRes.json()).realizations).toHaveLength(1);
  });

  it("mengalokasikan 1 BAST kelompok secara eksplisit untuk setiap penerima manfaat", async () => {
    const { draft, amilToken } = await prepareApprovedGoodsProposal({
      beneficiariesCount: 2,
      lines: [
        { beneficiaryIndex: 1, aidType: "Beras", unit: "kg", quantityRequested: "10" },
        { beneficiaryIndex: 2, aidType: "Beras", unit: "kg", quantityRequested: "15" },
      ],
    });

    const batchGroupId = "batch-penyerahan-rw05";
    const batchRes = await realize(draft, amilToken, [
      goodsItem(draft, 0, { quantity: "10", unit: "kg" }),
      goodsItem(draft, 1, { quantity: "15", unit: "kg" }),
    ], { batchGroupId });
    expect(batchRes.status).toBe(201);
    const [rec1, rec2] = (await batchRes.json()).records;

    // Menolak upload alokasi melebihi kuantitas realisasi
    const excessDoc = await uploadEvidence(draft, rec1.id, amilToken, {
      documentType: "RECEIPT_OR_BAST",
      batchGroupId,
      allocations: [
        { realizationId: rec1.id, quantity: "10.5", unit: "kg" },
      ],
    });
    expect(excessDoc.status).toBe(400);

    // Sukses alokasi BAST kelompok untuk kedua penerima
    const uploadRes = await uploadEvidence(draft, rec1.id, amilToken, {
      documentType: "RECEIPT_OR_BAST",
      batchGroupId,
      allocations: [
        { realizationId: rec1.id, quantity: "10", unit: "kg" },
        { realizationId: rec2.id, quantity: "15", unit: "kg" },
      ],
    });
    expect(uploadRes.status).toBe(201);
    const uploadBody = await uploadRes.json();
    expect(uploadBody.realizations).toHaveLength(2);
    expect(uploadBody.realizations[0].evidenceStatus).toBe("EVIDENCE_COMPLETE");
    expect(uploadBody.realizations[1].evidenceStatus).toBe("EVIDENCE_COMPLETE");

    // Foto pendukung tidak menerima alokasi
    const photoRes = await uploadEvidence(draft, rec1.id, amilToken, {
      documentType: "SUPPORTING_PHOTO",
      fileName: "foto-penyerahan.jpg",
      mimeType: "image/jpeg",
      allocations: [{ realizationId: rec1.id, quantity: "10", unit: "kg" }],
    });
    expect(photoRes.status).toBe(400);
  });

  it("mengonfirmasi penyerahan barang via OTP dengan pesan terikat kuantitas dan satuan", async () => {
    const { draft, amilToken } = await prepareApprovedGoodsProposal({
      lines: [
        { beneficiaryIndex: 1, aidType: "Beras Premium", unit: "kg", quantityRequested: "10" },
      ],
    });

    const real = (await (await realize(draft, amilToken, [goodsItem(draft, 0, { quantity: "10", unit: "kg" })])).json()).records[0];

    const chalRes = await post(`/proposals/${draft.id}/realizations/${real.id}/otp-challenge`, { recipientContact: FIXTURE_CONTACT }, amilToken);
    expect(chalRes.status).toBe(201);
    const { nonce } = await chalRes.json();

    expect(outbox).toHaveLength(1);
    expect(outbox[0].body).toContain("Beras Premium sebanyak 10 kg");
    const codeMatch = outbox[0].body.match(/\b(\d{6})\b/);
    expect(codeMatch).not.toBeNull();
    const code = codeMatch![1];

    const verifyRes = await post(`/proposals/${draft.id}/realizations/${real.id}/otp-verify`, { nonce, otpCode: code }, amilToken);
    expect(verifyRes.status).toBe(200);
    const verified = (await verifyRes.json()).realization;
    expect(verified.confirmationStatus).toBe("CONFIRMED");
    expect(verified.confirmationMethod).toBe("OTP");
  });

  it("mengonfirmasi penyerahan barang via pemeriksaan BAST oleh petugas lain", async () => {
    const { draft, amilToken, approverToken } = await prepareApprovedGoodsProposal({
      lines: [
        { beneficiaryIndex: 1, aidType: "Beras Premium", unit: "kg", quantityRequested: "20" },
      ],
    });

    const real = (await (await realize(draft, amilToken, [goodsItem(draft, 0, { quantity: "20", unit: "kg" })])).json()).records[0];

    // Belum upload BAST -> ditolak
    const noBast = await post(`/proposals/${draft.id}/realizations/${real.id}/bast-verify`, { notes: "Pemeriksaan fisik" }, approverToken);
    expect(noBast.status).toBe(409);

    // Upload BAST hanya sebagian (10 kg dari 20 kg) -> ditolak
    await uploadEvidence(draft, real.id, amilToken, {
      documentType: "RECEIPT_OR_BAST",
      allocations: [{ realizationId: real.id, quantity: "10", unit: "kg" }],
    });
    const partialBast = await post(`/proposals/${draft.id}/realizations/${real.id}/bast-verify`, { notes: "Pemeriksaan fisik" }, approverToken);
    expect(partialBast.status).toBe(409);

    // Upload sisa BAST 10 kg
    await uploadEvidence(draft, real.id, amilToken, {
      documentType: "RECEIPT_OR_BAST",
      allocations: [{ realizationId: real.id, quantity: "10", unit: "kg" }],
    });

    // Petugas pencatat (amilToken) tidak boleh memeriksa BAST miliknya sendiri (Separation of duties)
    const selfExam = await post(`/proposals/${draft.id}/realizations/${real.id}/bast-verify`, { notes: "Pemeriksaan diri sendiri" }, amilToken);
    expect(selfExam.status).toBe(403);

    // Petugas lain (approverToken) memeriksa BAST -> Sukses
    const okExam = await post(`/proposals/${draft.id}/realizations/${real.id}/bast-verify`, { notes: "BAST lengkap dan cocok" }, approverToken);
    expect(okExam.status).toBe(200);
    const examBody = await okExam.json();
    expect(examBody.realization.confirmationStatus).toBe("CONFIRMED");
    expect(examBody.realization.confirmationMethod).toBe("BAST_EXAMINED");
  });

  it("mencatat sengketa atas kuantitas barang, menahan konfirmasi, dan menyelesaikannya lewat pemeriksaan berwenang", async () => {
    const { draft, amilToken, approverToken } = await prepareApprovedGoodsProposal({
      lines: [
        { beneficiaryIndex: 1, aidType: "Beras Premium", unit: "kg", quantityRequested: "20" },
      ],
    });

    const real = (await (await realize(draft, amilToken, [goodsItem(draft, 0, { quantity: "20", unit: "kg" })])).json()).records[0];

    // Sengketa dengan kuantitas melebihi realisasi ditolak
    const excessDisp = await post(`/proposals/${draft.id}/realizations/${real.id}/disputes`, {
      complainantType: "BENEFICIARY",
      subject: "AMOUNT",
      reason: "Beras susut",
      disputedQuantity: "25",
      disputedUnit: "kg",
    }, amilToken);
    expect(excessDisp.status).toBe(400);

    // Catat sengketa sah atas 5 kg beras yang kurang
    const dispRes = await post(`/proposals/${draft.id}/realizations/${real.id}/disputes`, {
      complainantType: "BENEFICIARY",
      subject: "AMOUNT",
      reason: "Beras diterima hanya 15 kg, kurang 5 kg",
      disputedQuantity: "5",
      disputedUnit: "kg",
    }, amilToken);
    expect(dispRes.status).toBe(201);
    const { dispute, realization: dispReal } = await dispRes.json();
    expect(dispute.disputedQuantity).toBe("5");
    expect(dispute.disputedUnit).toBe("kg");
    expect(dispReal.confirmationStatus).toBe("DISPUTED");

    // Sengketa menahan OTP confirmation
    const holdOtp = await post(`/proposals/${draft.id}/realizations/${real.id}/otp-challenge`, { recipientContact: FIXTURE_CONTACT }, amilToken);
    expect(holdOtp.status).toBe(409);

    // Pemeriksaan berwenang EXAMINED -> tetap ditahan
    const exam1 = await post(
      `/proposals/${draft.id}/realizations/${real.id}/disputes/${dispute.id}/examinations`,
      { outcome: "EXAMINED", notes: "Sedang dikonfirmasi ke tim penimbang lapangan" },
      approverToken
    );
    expect(exam1.status).toBe(200);
    expect((await exam1.json()).realization.confirmationStatus).toBe("DISPUTED");

    // Pemeriksaan berwenang RESOLVED -> tahanan dilepas
    const exam2 = await post(
      `/proposals/${draft.id}/realizations/${real.id}/disputes/${dispute.id}/examinations`,
      { outcome: "RESOLVED", notes: "Kekurangan 5 kg sudah diserahkan susulan" },
      approverToken
    );
    expect(exam2.status).toBe(200);
    expect((await exam2.json()).realization.confirmationStatus).toBe("UNCONFIRMED");
  });

  it("memisahkan uang muka & biaya operasional pengadaan barang dari penyaluran hak penerima tanpa double-counting", async () => {
    const { draft, amilToken } = await prepareApprovedGoodsProposal({
      lines: [
        { beneficiaryIndex: 1, aidType: "Beras", unit: "kg", quantityRequested: "100", valuedAmountIdr: null },
      ],
    });

    // 1. Catat panjar operasional pembelian & sewa truk beras: Rp 2.000.000
    const panjarId = await issuePanjar(draft.id, "2000000", "Uang muka pembelian beras dan sewa pick-up", "ADV-OP-001", amilToken);

    // 2. Catat biaya operasional riil belanja karung beras: Rp 500.000
    await recordCost(draft.id, panjarId, "500000", "Pembelian karung dan tali pengikat", "Toko Plastik Maju", amilToken);

    // 3. Catat realisasi penyaluran barang ke penerima: 50 kg beras
    const realRes = await realize(draft, amilToken, [
      goodsItem(draft, 0, { quantity: "50", unit: "kg" }),
    ]);
    expect(realRes.status).toBe(201);

    // Ringkasan realisasi memisahkan biaya operasional dari bantuan yang diterima
    const sumRes = await get(`/proposals/${draft.id}/realization-summary`, amilToken);
    expect(sumRes.status).toBe(200);
    const summary = (await sumRes.json()).summary;

    expect(summary.totalAdvancesIdr).toBe("2000000");
    expect(summary.totalExpensesIdr).toBe("500000");
    // Penyaluran beras tetap 50 kg dan tidak tercampur menjadi nilai IDR bantuan
    expect(summary.unitSummaries.find((item: any) => item.unit === "kg").realized).toBe("50");
    expect(summary.totalRealizedIdr).toBe("0");
  });

  it("harga aktual berbeda dari estimasi tanpa menghitung barang dua kali atau menutup pertanggungjawaban", async () => {
    const { draft, amilToken } = await prepareApprovedGoodsProposal({ lines: [
      { beneficiaryIndex: 1, aidType: "Beras", unit: "kg", quantityRequested: "10", valuedAmountIdr: "100000", valuationBasis: "Penawaran A: 10 kg × Rp10.000" },
    ] });
    const panjarId = await issuePanjar(draft.id, "200000", "Pembelian beras", "ADV-HARGA", amilToken);
    await recordCost(draft.id, panjarId, "120000", "Harga aktual beras 10 kg × Rp12.000", "Pemasok A", amilToken);
    const result = await realize(draft, amilToken, [goodsItem(draft, 0)]);
    expect(result.status).toBe(201);
    const { records, summary } = await result.json();
    expect(summary).toMatchObject({ disbursementStatus: "FULLY_REALIZED", evidenceCompleteness: "EVIDENCE_PENDING", confirmedCount: 0,
      totalValuedGoodsApprovedIdr: "100000", totalExpensesIdr: "120000", totalRealizedIdr: "0", totalAdvancesIdr: "200000" });
    expect(summary.unitSummaries).toEqual([{ aidType: "Beras", unit: "kg", approved: "10", realized: "10", remaining: "0" }]);
    const accounts = await (await get(`/proposals/${draft.id}/advances`, amilToken)).json();
    expect(accounts.advances[0]).toMatchObject({ accountedIdr: "120000", unaccountedIdr: "80000" });
    const originalId = records[0].id;
    await uploadEvidence(draft, originalId, amilToken, { documentType: "RECEIPT_OR_BAST", allocations: [{ realizationId: originalId, quantity: "10", unit: "kg" }] });
    const current = (await (await get(`/proposals/${draft.id}/realizations`, amilToken)).json()).realizations[0];
    expect(current.id).toBe(originalId);
    expect(current.version).toBeGreaterThan(records[0].version);
    expect(current.proposalVersion).toBe(draft.version);
    expect(current.confirmationStatus).toBe("UNCONFIRMED");
    expect((await (await get(`/proposals/${draft.id}/advances`, amilToken)).json()).advances[0].unaccountedIdr).toBe("80000");
  });

  it("menyimpan realisasi barang, alokasi dokumen, dan sengketa secara tahan lama melintasi restart database", async () => {
    const { draft, amilToken } = await prepareApprovedGoodsProposal({
      lines: [
        { beneficiaryIndex: 1, aidType: "Beras Premium", unit: "kg", quantityRequested: "25" },
      ],
    });

    const realRes = await realize(draft, amilToken, [goodsItem(draft, 0, { quantity: "15", unit: "kg" })]);
    expect(realRes.status).toBe(201);
    const real = (await realRes.json()).records[0];

    const docRes = await uploadEvidence(draft, real.id, amilToken, {
      documentType: "RECEIPT_OR_BAST",
      allocations: [{ realizationId: real.id, quantity: "15", unit: "kg" }],
    });
    expect(docRes.status).toBe(201);

    // Simulasikan database restart
    await database.reopen();
    store = createWorkspaceStore(database.handle());
    disbursement = createDisbursementStore(database.handle());
    activities = createActivityStore(database.handle());
    await store.ensureSchema();
    await disbursement.ensureSchema();
    configure();

    const listRes = await get(`/proposals/${draft.id}/realizations`, amilToken);
    expect(listRes.status).toBe(200);
    const realizations = (await listRes.json()).realizations;
    expect(realizations).toHaveLength(1);
    expect(realizations[0].quantity).toBe("15");
    expect(realizations[0].unit).toBe("kg");
    expect(realizations[0].evidenceStatus).toBe("EVIDENCE_COMPLETE");

    const sumRes = await get(`/proposals/${draft.id}/realization-summary`, amilToken);
    expect(sumRes.status).toBe(200);
    expect((await sumRes.json()).summary.unitSummaries.find((item: any) => item.unit === "kg").remaining).toBe("10");
  });
  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("browser: barang pecahan dan BAST bertahap tetap eksak di laptop dan ponsel", async () => {
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
      for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
        const { draft, programId, amilToken } = await prepareApprovedGoodsProposal({ purpose: `Barang Smoke ${viewport.width}`, lines: [
          { beneficiaryIndex: 1, aidType: "Beras", unit: "kg", quantityRequested: "0.3" },
          { beneficiaryIndex: 1, aidType: "Gula", unit: "kg", quantityRequested: "0.2" },
        ] });
        const page = await browser.newPage({ viewport });
        const errors: string[] = [];
        page.on("pageerror", (error: Error) => errors.push(error.message));
        page.setDefaultTimeout(10000);
        await page.addInitScript((now: number) => { Date.now = () => now * 1000; }, NOW);
        await page.goto(server.url.toString());
        await page.getByRole("button", { name: /^0x/ }).waitFor();
        await page.getByLabel("Pengelola Zakat", { exact: true }).selectOption(SINAR);
        await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();
        await page.getByLabel(/Program bantuan/).selectOption(programId);
        await page.getByRole("button", { name: new RegExp(`Barang Smoke ${viewport.width}`) }).click();
        await page.getByRole("heading", { name: "Realisasi penyaluran", exact: true }).waitFor();
        await page.getByText("Beras (kg):", { exact: true }).waitFor();
        await page.getByText("Gula (kg):", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Catat realisasi", exact: true }).click();
        let dialog = page.getByRole("dialog");
        const quantity = dialog.getByLabel("Jumlah (kg)", { exact: true });
        expect(await quantity.inputValue()).toBe("0.3");
        await quantity.press("Enter");
        await dialog.getByRole("status").getByText("Realisasi tersimpan").waitFor();
        await dialog.getByRole("button", { name: "Unggah bukti sekarang" }).click();
        dialog = page.getByRole("dialog");
        await dialog.getByLabel("Berkas bukti").setInputFiles({ name: "bast-01.txt", mimeType: "text/plain", buffer: Buffer.from("BAST 0.1 kg beras") });
        await dialog.getByLabel(/Mustahik 1 · belum berbukti/).fill("0.1");
        await dialog.getByRole("button", { name: "Unggah bukti", exact: true }).click();
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        await page.getByRole("button", { name: "Bukti Penyaluran Belum Lengkap", exact: true }).click();
        const queue = page.getByRole("region", { name: "Antrean bukti realisasi", exact: true });
        await queue.getByText("Beras: 0.3 kg", { exact: true }).waitFor();
        expect(await queue.innerText()).not.toContain("Rp");
        await queue.getByRole("button", { name: "Buka dan lengkapi bukti", exact: true }).click();
        await page.getByRole("heading", { name: "Realisasi penyaluran", exact: true }).waitFor();
        await page.getByRole("button", { name: "Lengkapi bukti", exact: true }).click();
        dialog = page.getByRole("dialog");
        const remainder = dialog.getByLabel(/Mustahik 1 · belum berbukti/);
        expect(await remainder.inputValue()).toBe("0.2");
        await dialog.getByLabel("Berkas bukti").setInputFiles({ name: "bast-02.txt", mimeType: "text/plain", buffer: Buffer.from("BAST sisa 0.2 kg beras") });
        await remainder.press("Enter");
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        await page.getByText("Bukti lengkap", { exact: true }).first().waitFor();
        const overview = await (await get(`/proposals/${draft.id}/realizations`, amilToken)).json();
        expect(overview.realizations[0].quantity).toBe("0.3");
        expect(overview.realizations[0].evidenceStatus).toBe("EVIDENCE_COMPLETE");
        expect(overview.realizations[0].confirmationStatus).toBe("UNCONFIRMED");
        await page.getByRole("button", { name: "Catat realisasi", exact: true }).click();
        dialog = page.getByRole("dialog");
        expect(await dialog.getByLabel("Jumlah (kg)", { exact: true }).inputValue()).toBe("0.2");
        await dialog.getByLabel("Jumlah (kg)", { exact: true }).press("Enter");
        await dialog.getByRole("status").getByText("Realisasi tersimpan").waitFor();
        await dialog.getByRole("button", { name: "Unggah bukti sekarang" }).click();
        dialog = page.getByRole("dialog");
        await dialog.getByLabel("Berkas bukti").setInputFiles({ name: "bast-gula.txt", mimeType: "text/plain", buffer: Buffer.from("BAST 0.2 kg gula") });
        await dialog.getByRole("button", { name: "Unggah bukti", exact: true }).click();
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        const fully = (await (await get(`/proposals/${draft.id}/realization-summary`, amilToken)).json()).summary;
        expect(fully.disbursementStatus).toBe("FULLY_REALIZED");
        expect(fully.evidenceCompleteness).toBe("EVIDENCE_COMPLETE");
        expect(fully.confirmedCount).toBe(0);
        const overflows = await page.evaluate(() => [...document.querySelectorAll("section[aria-labelledby^='realization-'] *")]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).map((el) => el.tagName));
        expect(overflows).toEqual([]);
        expect(errors).toEqual([]);
        await page.screenshot({ path: `/tmp/issue95-fixed-${viewport.width}.png`, fullPage: true });
        await page.close();
      }
    } finally {
      await browser?.close();
      server.stop(true);
    }
  }, 60000);

});

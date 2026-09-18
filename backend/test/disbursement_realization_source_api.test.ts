/**
 * Integration tests for Disbursement Realization Reporting Sources & Evidence Traceability
 * (Spec #86, Spec #100, GitHub Issue #98).
 *
 * Verifies:
 * 1. Scope and cut-off: records within period recorded <= cut-off normalized into rows;
 *    records after cut-off named as not yet examined (belum terperiksa), not unverified.
 * 2. Exact Money and Separate Goods: integer IDR strings; goods quantities kept by unit (never Rp0).
 * 3. No Double Counting (AC07): Officer advances & procurement expenses tracked separately,
 *    never added to recipient aid rows.
 * 4. Stable Provenance: Frozen canonical snapshot binds exact proposal version, beneficiaries,
 *    and documents; subsequent revisions (#96/#97) leave historical packages unchanged.
 * 5. Honest Statements: Distinguishes full realization breakdown from recap summaries.
 * 6. Public Summary Privacy (AC31): No NIK, bank accounts, or recipient PII in public view.
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
import { createEvidenceStore, type EvidenceStore } from "../src/evidence-store";
import { createActivityStore, type ActivityStore } from "../src/activity-store";
import { createEncryptedFileStore, type PrivateFileStore } from "../src/evidence-files";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import {
  DISBURSEMENT_REALIZATION_STREAM,
  buildDisbursementRealizationSide,
  type RealizationItemData,
} from "../src/realization-source";
import { PROVENANCE_FILE_NAMES } from "../../shared/realization-provenance";

const BASE = "http://localhost:3001/api/workspace";
const EVIDENCE = "http://localhost:3001/api/evidence";

const SINAR = "lpz-sinar-amanah";
const adminSinar = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
const amilSinar = privateKeyToAccount(`0x${"22".repeat(32)}` as Hex);
const examinerSinar = privateKeyToAccount(`0x${"33".repeat(32)}` as Hex);
const approverSinar = privateKeyToAccount(`0x${"44".repeat(32)}` as Hex);

// Epoch seconds
// 2024 Semester 1: 2024-01-01 00:00:00 UTC (1704067200) to 2024-07-01 00:00:00 UTC (1719792000)
const SEMESTER_1_START = 1704067200; // 2024-01-01
const CUT_OFF_SECONDS = 1714521600;   // 2024-05-01 00:00:00 UTC
const CUT_OFF_ISO = new Date(CUT_OFF_SECONDS * 1000).toISOString();
const AFTER_CUT_OFF_SECONDS = 1717200000; // 2024-06-01 (within Semester 1, but after cut-off)
const OUTSIDE_PERIOD_SECONDS = 1725148800; // 2024-09-01 (Semester 2)

const FILE_KEY = Buffer.alloc(32, 88);

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let disbursement: DisbursementStore;
let evidence: EvidenceStore;
let activities: ActivityStore;
let fileStore: PrivateFileStore;
let tempDir: string;
let clock = CUT_OFF_SECONDS;

const request = (url: string, init: RequestInit = {}) => app.fetch(new Request(url, init));
const post = (url: string, body: unknown, token?: string) => {
  const fullUrl = url.startsWith("http") ? url : `${BASE}${url.startsWith("/") ? "" : "/"}${url}`;
  return request(fullUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(
      /\/(advances|expenses|disputes|examinations|realizations|revisions)$/.test(url)
        ? { operationId: crypto.randomUUID(), ...(body as object) }
        : body
    ),
  });
};
const get = (url: string, token?: string) => {
  const fullUrl = url.startsWith("http") ? url : `${BASE}${url.startsWith("/") ? "" : "/"}${url}`;
  return request(fullUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
};

async function signIn(account: ReturnType<typeof privateKeyToAccount>, institutionId = SINAR): Promise<string> {
  const minted = await post(`${BASE}/challenge`, { institutionId, account: account.address });
  const { challenge, typedData } = await minted.json();
  const signature = await account.signTypedData({
    ...typedData,
    message: {
      ...typedData.message,
      issuedAt: BigInt(typedData.message.issuedAt),
      expiresAt: BigInt(typedData.message.expiresAt),
    },
  });
  const session = await post(`${BASE}/session`, { nonce: challenge.nonce, signature });
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
  beneficiaryId: null,
  contentBase64: Buffer.from("Konten dokumen pengajuan").toString("base64"),
});

async function prepareApprovedProposal(options?: {
  name?: string;
  purpose?: string;
  beneficiaries?: Array<{
    id: string;
    name: string;
    nik?: string;
    asnaf?: string;
    addressOrScope?: string;
  }>;
  lines?: Array<{
    id: string;
    beneficiaryId: string;
    aidType: string;
    kind: "MONEY" | "GOODS";
    amountRequestedIdr?: string;
    unit?: string;
    quantityRequested?: string;
  }>;
}) {
  const amilToken = await signIn(amilSinar);
  const examinerToken = await signIn(examinerSinar);
  const approverToken = await signIn(approverSinar);
  const adminToken = await signIn(adminSinar);

  const curPol = (await (await get("/policy", adminToken)).json()).policy;
  const savePolRes = await post("/policy", { ...curPol, expectedVersion: curPol.version, requireIdentityDoc: false }, adminToken);
  expect(savePolRes.status).toBe(200);

  const progRes = await post(
    "/programs",
    {
      name: options?.name ?? "Program Bantuan Darurat Pangan",
      purpose: options?.purpose ?? "Penyaluran beras dan santunan",
      fundType: "ZAKAT",
      scope: "Jawa Barat",
      referenceCeiling: "999999999999999999",
    },
    adminToken
  );
  expect(progRes.status).toBe(201);
  const programId = (await progRes.json()).program.id;

  const beneficiaries = (options?.beneficiaries ?? [
    { id: "ben-1", name: "Bapak Ahmad", nik: "3201123456780001", asnaf: "Fakir", addressOrScope: "Bandung" }
  ]).map((b) => ({
    id: b.id,
    name: b.name,
    asnaf: b.asnaf ?? "Fakir",
    identityBasis: { kind: "NIK", value: b.nik ?? "3201123456780001" },
    addressOrScope: b.addressOrScope ?? "Bandung",
    guardian: null,
    contact: { phone: "081234567890", relation: "SELF" },
    paymentRecipient: null,
  }));

  const aidLines = (options?.lines ?? [
    {
      id: "aid-1",
      beneficiaryId: "ben-1",
      aidType: "Santunan Tunai",
      kind: "MONEY",
      amountRequestedIdr: "1000000",
    }
  ]).map((l) => ({
    id: l.id,
    beneficiaryId: l.beneficiaryId,
    aidType: l.aidType,
    period: "2024-03",
    value: l.kind === "GOODS"
      ? {
          kind: "GOODS",
          unit: l.unit ?? "kg",
          quantityRequested: l.quantityRequested ?? "10",
          valuedAmountIdr: null,
          valuationBasis: null,
        }
      : {
          kind: "MONEY",
          amountRequestedIdr: l.amountRequestedIdr ?? "1000000",
        },
  }));

  const propRes = await post(
    "/proposals",
    {
      expectedVersion: 0,
      operationId: crypto.randomUUID(),
      programId,
      originOfRequest: "Surat Permohonan Warga",
      purpose: options?.purpose ?? "Penyaluran bantuan",
      personInCharge: "Ahmad Amil",
      aidPeriod: { start: "2024-01-01", end: "2024-06-30" },
      beneficiaries,
      aidLines,
    },
    amilToken
  );
  expect(propRes.status).toBe(201);
  const draft = (await propRes.json()).draft;

  expect((await post(`/proposals/${draft.id}/documents`, documentInput("PROPOSAL_LETTER"), amilToken)).status).toBe(201);

  const submitRes = await post(`/proposals/${draft.id}/submit`, { expectedVersion: draft.version, operationId: crypto.randomUUID() }, amilToken);
  if (submitRes.status !== 200) {
    console.error("submitRes failed:", submitRes.status, await submitRes.text());
  }
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
      fileName: "sk-persetujuan.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("SK Persetujuan").toString("base64"),
      expectedVersion: readyDraft.version,
    },
    approverToken
  );
  expect(docRes.status).toBe(201);
  const decisionDocumentId = (await docRes.json()).document.id;

  const approvedAidLines = readyDraft.aidLines.map((line: any) => ({
    id: line.id,
    ...(line.value.kind === "GOODS"
      ? { quantityApproved: line.value.quantityRequested }
      : { amountApprovedIdr: line.value.amountRequestedIdr }),
  }));

  const intent = { action: "APPROVE", decisionReference: "SK-001", decisionDate: "2024-03-15", decisionDocumentId };
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

function configureRuntime(disbursementStore: DisbursementStore) {
  configureWorkspace({
    store,
    disbursement: disbursementStore,
    evidence,
    files: fileStore,
    now: () => clock,
    sessionTtlSeconds: 7200,
    challengeTtlSeconds: 300,
    ethCall: async () => "0x",
  });
}

const pastedClaim = (amount: string) => ({
  manifest: {
    label: "Klaim Buku Besar",
    origin: "PASTE",
    scopeUnit: "NASIONAL",
    scopeLevel: "PUSAT",
    fundTypes: ["ZAKAT"],
    balanceSheet: "ON",
    currencyUnit: "IDR",
    period: { kind: "SEMESTER", year: 2024 },
    cutOff: CUT_OFF_ISO,
    format: "baris-ledger",
    mappingVersion: "1",
    transactionDetail: "PRESENT",
  },
  status: "READ",
  rows: [{ key: "klaim-1", bucket: "ZAKAT", balanceSheet: "ON", value: { amount, unit: "IDR" } }],
});

beforeAll(async () => {
  database = await createTestWorkspaceDatabase();
  const db = database.handle();
  store = createWorkspaceStore(db);
  disbursement = createDisbursementStore(db);
  evidence = createEvidenceStore(db);
  activities = createActivityStore(db);
  tempDir = await mkdtemp(join(tmpdir(), "zkt-realization-source-test-"));
  fileStore = createEncryptedFileStore({ directory: tempDir, key: FILE_KEY });

  await store.ensureSchema();
  await disbursement.ensureSchema();
  await evidence.ensureSchema();

  configureRuntime(disbursement);
});

beforeEach(async () => {
  await database.reset();
  await store.ensureSchema();
  await disbursement.ensureSchema();
  await evidence.ensureSchema();

  for (const inst of SYNTHETIC_INSTITUTIONS) {
    await store.upsertInstitution(institutionRecordOf(inst));
  }

  await store.upsertMembership({ institutionId: SINAR, account: adminSinar.address, role: "ADMIN" });
  await store.upsertMembership({ institutionId: SINAR, account: amilSinar.address, role: "OFFICER" });
  await store.upsertMembership({ institutionId: SINAR, account: examinerSinar.address, role: "OFFICER" });
  await store.upsertMembership({ institutionId: SINAR, account: approverSinar.address, role: "OFFICER" });

  const officers = [
    ["off-admin-sinar", "Admin Sinar", adminSinar, "ADMIN"],
    ["off-amil-sinar", "Ahmad Amil", amilSinar, "OFFICER"],
    ["off-examiner-sinar", "Budi Pemeriksa", examinerSinar, "OFFICER"],
    ["off-approver-sinar", "Citra Direktur", approverSinar, "OFFICER"],
  ] as const;
  for (const [id, displayName, account, role] of officers) {
    await store.createOfficerProfile({
      id,
      institutionId: SINAR,
      displayName,
      account: account.address,
      role,
      actor: adminSinar.address,
      now: clock,
    });
  }

  const mandates = [
    ["off-admin-sinar", "MANAGE_PROGRAMS", "SK-000/ADMIN"],
    ["off-amil-sinar", "MANAGE_PROGRAMS", "SK-001/PROGRAM"],
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
      mandate: {
        officerId,
        function: fn,
        scopeType: "ALL_PROGRAMS",
        assignmentRef,
        validFrom: SEMESTER_1_START - 86400 * 30,
        validUntil: clock + 86400 * 365,
      },
    });
  }
});

afterAll(async () => {
  resetWorkspace();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("Sumber Laporan dari Realisasi dan Penelusuran Bukti (Issue #98)", () => {
  it("menawarkan stream DISBURSEMENT_REALIZATIONS pada GET /api/evidence/internal-sources", async () => {
    const amilToken = await signIn(amilSinar);
    const res = await get(`${EVIDENCE}/internal-sources?periodKind=SEMESTER&year=2024`, amilToken);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const relStream = body.streams.find((s: any) => s.stream === DISBURSEMENT_REALIZATION_STREAM);
    expect(relStream).toBeDefined();
    expect(relStream.currencyUnit).toBe("IDR");
    expect(relStream.balanceSheetScope).toBe("ON");
    expect(relStream.available).toBe(true);
    expect(relStream.sides.length).toBeGreaterThan(0);
    expect(relStream.sides[0].role).toBe("SOURCE");
  });

  it("membekukan realisasi dengan cut-off, menyatakan realisasi setelah cut-off belum terperiksa", async () => {
    // 1. Siapkan pengajuan yang telah disetujui dengan bantuan uang dan barang
    let { draft, amilToken } = await prepareApprovedProposal({
      name: "Program Bantuan Darurat Pangan",
      purpose: "Bantuan Pangan Tahap 1",
      beneficiaries: [
        { id: "ben-1", name: "Bapak Ahmad", nik: "3201123456780001", asnaf: "Fakir" },
        { id: "ben-2", name: "Ibu Siti", nik: "3201123456780002", asnaf: "Miskin" },
        { id: "ben-3", name: "Pak Budi", nik: "3201123456780003", asnaf: "Miskin" },
      ],
      lines: [
        {
          id: "line-money",
          beneficiaryId: "ben-1",
          aidType: "Santunan Tunai",
          kind: "MONEY",
          amountRequestedIdr: "1000000",
        },
        {
          id: "line-goods",
          beneficiaryId: "ben-2",
          aidType: "Beras Premium",
          kind: "GOODS",
          unit: "kg",
          quantityRequested: "25",
        },
        {
          id: "line-money-budi",
          beneficiaryId: "ben-3",
          aidType: "Santunan Tunai",
          kind: "MONEY",
          amountRequestedIdr: "1000000",
        },
      ],
    });

    // Catat realisasi:
    // Realisasi 1: Ahmad (uang 1.000.000) pada April 2024 (sebelum cut-off)
    clock = 1713000000; // 2024-04-13
    const real1 = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        items: [
          {
            aidLineId: "line-money",
            beneficiaryId: "ben-1",
            method: "BANK_TRANSFER",
            amountIdr: "1000000",
            reportedAt: 1713000000,
            notes: "Transfer bank penerima Ahmad",
          },
        ],
      },
      amilToken
    );
    expect(real1.status).toBe(201);

    // Realisasi 2: Siti (beras 25 kg) pada April 2024 (sebelum cut-off)
    clock = 1713500000; // 2024-04-19
    const real2 = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        items: [
          {
            aidLineId: "line-goods",
            beneficiaryId: "ben-2",
            method: "GOODS_HANDOVER",
            quantity: "25",
            unit: "kg",
            reportedAt: 1713500000,
            notes: "Serah terima beras 25 kg",
          },
        ],
      },
      amilToken
    );
    expect(real2.status).toBe(201);

    // Realisasi 3: Budi (uang 1.000.000) pada Juni 2024 (SETELAH cut-off 1 Mei 2024)
    clock = AFTER_CUT_OFF_SECONDS; // 2024-06-01
    amilToken = await signIn(amilSinar);
    const real3 = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        items: [
          {
            aidLineId: "line-money-budi",
            beneficiaryId: "ben-3",
            method: "CASH",
            amountIdr: "1000000",
            reportedAt: AFTER_CUT_OFF_SECONDS,
            notes: "Penyaluran susulan setelah batas cut-off",
          },
        ],
      },
      amilToken
    );
    expect(real3.status).toBe(201);
    const budiRealizationId = (await real3.json()).records[0].id;

    // 3. Rekam uang muka petugas & biaya operasional pengadaan beras (AC07), sebelum cut-off
    clock = 1713600000; // 2024-04-20
    amilToken = await signIn(amilSinar);
    const advRes = await post(
      `/proposals/${draft.id}/advances`,
      {
        amountIdr: "250000",
        purpose: "Uang muka transportasi tim distribusi",
        reference: "ADV-001",
      },
      amilToken
    );
    expect(advRes.status).toBe(201);

    const expRes = await post(
      `/proposals/${draft.id}/expenses`,
      {
        advanceId: null,
        amountIdr: "150000",
        purpose: "Biaya karung dan pengemasan beras",
        payee: "Toko Plastik Makmur",
        documentRef: "NOTA-PACK-01",
      },
      amilToken
    );
    expect(expRes.status).toBe(201);

    // 4. Bekukan paket bukti menggunakan DISBURSEMENT_REALIZATIONS dengan cut-off 2024-05-01
    clock = CUT_OFF_SECONDS;
    amilToken = await signIn(amilSinar);
    const freezeRes = await post(
      EVIDENCE,
      {
        label: "Paket Bukti Penyaluran Semester I 2024",
        period: { kind: "SEMESTER", year: 2024 },
        currencyUnit: "IDR",
        balanceSheetScope: "ON",
        claim: {
          manifest: {
            label: "Klaim Buku Besar",
            origin: "PASTE",
            scopeUnit: "NASIONAL",
            scopeLevel: "PUSAT",
            fundTypes: ["ZAKAT"],
            balanceSheet: "ON",
            currencyUnit: "IDR",
            period: { kind: "SEMESTER", year: 2024 },
            cutOff: CUT_OFF_ISO,
            format: "baris-ledger",
            mappingVersion: "1",
            transactionDetail: "PRESENT",
          },
          status: "READ",
          rows: [
            {
              key: "klaim-1",
              bucket: "ZAKAT",
              balanceSheet: "ON",
              value: { amount: "1000000", unit: "IDR" },
            },
          ],
        },
        source: {
          internal: {
            stream: DISBURSEMENT_REALIZATION_STREAM,
            cutOff: CUT_OFF_ISO,
          },
        },
      },
      amilToken
    );

    if (freezeRes.status !== 201) {
      console.error("freezeRes failed:", freezeRes.status, await freezeRes.json());
    }
    expect(freezeRes.status).toBe(201);
    const { preparation } = await freezeRes.json();
    expect(preparation.id).toBeDefined();

    // Periksa sisi sumber yang dibekukan
    const sourceSide = preparation.sources.find((s: any) => s.role === "SOURCE");
    expect(sourceSide).toBeDefined();

    // Ahmad (uang 1.000.000) masuk sebagai baris IDR aktif
    const idrRow = sourceSide.rows.find((r: any) => r.unit === "IDR" && !r.isDeclaredTotal);
    expect(idrRow).toBeDefined();
    expect(idrRow.amount).toBe("1000000");

    // AC07: Uang muka (250.000) dan biaya pengemasan (150.000) TIDAK dijumlahkan ke hak penerima manfaat!
    expect(idrRow.amount).not.toBe("1400000");
    expect(idrRow.amount).not.toBe("1250000");

    // Realisasi ke-3 (Budi) yang dicatat setelah cut-off belum terperiksa: bukan catatan belum terverifikasi
    expect((sourceSide.unverified ?? []).some((u: any) => u.reference === budiRealizationId)).toBe(false);
    expect(preparation.snapshot.coverageNotes.some((n: string) => n.includes("belum terperiksa"))).toBe(true);

    // 5. Periksa berkas provenance terenkripsi yang dibekukan
    const provFile = preparation.files.find((f: any) => f.fileName === PROVENANCE_FILE_NAMES.SOURCE);
    expect(provFile).toBeDefined();
    expect(provFile.storageStatus).toBe("STORED");

    // 6. Uji GET /api/evidence/:id/drill-down
    const drillRes = await get(`${EVIDENCE}/${preparation.id}/drill-down`, amilToken);
    expect(drillRes.status).toBe(200);
    const drillData = await drillRes.json();
    expect(drillData.success).toBe(true);
    expect(drillData.available).toBe(true);
    expect(drillData.transactionDetail).toBe("PRESENT");
    expect(drillData.unreadable).toEqual([]);

    const prov = drillData.provenances[0];
    expect(prov.format).toBe("tawf.realization.provenance");
    expect(prov.role).toBe("SOURCE");
    expect(prov.excludedAfterCutOff.map((e: any) => e.realizationId)).toEqual([budiRealizationId]);
    expect(prov.totals.handoverEventCount).toBe(2);
    expect(prov.totals.totalRealizedIdr).toBe("1000000");
    expect(prov.totals.advancesIdr).toBe("250000");
    expect(prov.totals.expensesIdr).toBe("150000");

    // Barang: 25 kg beras tetap terpisah dan TIDAK direkayasa menjadi Rp0
    const goodsKg = prov.totals.goods.find((g: any) => g.unit === "kg");
    expect(goodsKg).toBeDefined();
    expect(goodsKg.totalQuantity).toBe("25");

    // Rincian penerima manfaat: NIK disamarkan untuk privasi
    const ahmadItem = prov.realizations.find((r: any) => r.beneficiary.name === "Bapak Ahmad");
    expect(ahmadItem).toBeDefined();
    expect(ahmadItem.beneficiary.nikMasked).toContain("********");
    expect(ahmadItem.beneficiary.nikMasked).not.toBe("3201123456780001");
  });

  it("stabilitas snapshot historis: revisi proposal di masa depan (#96/#97) tidak mengubah paket bukti yang telah dibekukan", async () => {
    // Siapkan pengajuan beasiswa versi 1 yang disetujui
    let { draft, amilToken, examinerToken, approverToken } = await prepareApprovedProposal({
      name: "Program Pendidikan Beasiswa",
      purpose: "Beasiswa Santri Berprestasi",
      beneficiaries: [
        { id: "santri-1", name: "Zaidan Akbar", nik: "3201999900000001", asnaf: "Fisabilillah" },
      ],
      lines: [
        {
          id: "line-scholarship",
          beneficiaryId: "santri-1",
          aidType: "Beasiswa SPP",
          kind: "MONEY",
          amountRequestedIdr: "5000000",
        },
      ],
    });

    // Catat realisasi santri-1 di versi 1
    clock = 1711000000; // 2024-03-21
    amilToken = await signIn(amilSinar);
    const realRes = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        items: [
          {
            aidLineId: "line-scholarship",
            beneficiaryId: "santri-1",
            method: "BANK_TRANSFER",
            amountIdr: "5000000",
            reportedAt: 1711000000,
            notes: "Beasiswa semester genap",
          },
        ],
      },
      amilToken
    );
    expect(realRes.status).toBe(201);

    // Bekukan paket bukti untuk versi 1
    clock = CUT_OFF_SECONDS;
    amilToken = await signIn(amilSinar);
    const freezeRes = await post(
      EVIDENCE,
      {
        label: "Bukti Beasiswa Versi 1",
        period: { kind: "SEMESTER", year: 2024 },
        currencyUnit: "IDR",
        balanceSheetScope: "ON",
        claim: {
          manifest: {
            label: "Klaim",
            origin: "PASTE",
            scopeUnit: "NASIONAL",
            scopeLevel: "PUSAT",
            fundTypes: ["ZAKAT"],
            balanceSheet: "ON",
            currencyUnit: "IDR",
            period: { kind: "SEMESTER", year: 2024 },
            cutOff: CUT_OFF_ISO,
            format: "baris-ledger",
            mappingVersion: "1",
            transactionDetail: "PRESENT",
          },
          status: "READ",
          rows: [
            { key: "k-1", bucket: "ZAKAT", balanceSheet: "ON", value: { amount: "5000000", unit: "IDR" } },
          ],
        },
        source: {
          internal: {
            stream: DISBURSEMENT_REALIZATION_STREAM,
            cutOff: CUT_OFF_ISO,
          },
        },
      },
      amilToken
    );
    expect(freezeRes.status).toBe(201);
    const { preparation: prepV1 } = await freezeRes.json();

    // Sekarang, ajukan revisi pengajuan di masa depan (versi 2)
    examinerToken = await signIn(examinerSinar);
    approverToken = await signIn(approverSinar);
    const revRes = await post(
      `/proposals/${draft.id}/revisions`,
      {
        reason: "Penyesuaian nama santri dan penambahan kuota",
        beneficiaries: [
          {
            id: "santri-1",
            name: "Zaidan Akbar REVISI",
            asnaf: "Fisabilillah",
            identityBasis: { kind: "NIK", value: "3201999900000001" },
            addressOrScope: "Bandung",
            guardian: null,
            contact: { phone: "081234567890", relation: "SELF" },
            paymentRecipient: null,
          },
          {
            id: "santri-2",
            name: "Santri Tambahan",
            asnaf: "Fisabilillah",
            identityBasis: { kind: "NIK", value: "3201999900000002" },
            addressOrScope: "Bandung",
            guardian: null,
            contact: { phone: "081234567891", relation: "SELF" },
            paymentRecipient: null,
          },
        ],
        aidLines: [
          {
            id: "line-scholarship",
            beneficiaryId: "santri-1",
            aidType: "Beasiswa SPP",
            period: "2024-03",
            value: { kind: "MONEY", amountRequestedIdr: "6000000" },
          },
        ],
        expectedVersion: draft.version,
      },
      amilToken
    );
    expect(revRes.status).toBe(201);
    const { revision } = await revRes.json();

    // Jalankan alur persetujuan revisi hingga versi 2 disahkan
    const startRevExam = await post(`/proposals/${draft.id}/revisions/${revision.id}/start-examination`, { operationId: crypto.randomUUID() }, examinerToken);
    expect(startRevExam.status).toBe(200);

    const readyRevRes = await post(
      `/proposals/${draft.id}/revisions/${revision.id}/ready`,
      {
        notes: "Perubahan disetujui",
        operationId: crypto.randomUUID(),
        checklist: {
          administrativeChecksOk: true,
          eligibilityChecksOk: true,
          alternativeIdReviewed: true,
          recurringAidExceptions: [],
          notes: "Telaah revisi disetujui",
        },
      },
      examinerToken
    );
    expect(readyRevRes.status).toBe(200);
    expect((await readyRevRes.json()).revision.status).toBe("READY_FOR_DECISION");
    const docRevRes = await post(
      `/proposals/${draft.id}/decision-documents`,
      {
        fileName: "sk-revisi.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("SK Revisi Beasiswa").toString("base64"),
        expectedVersion: draft.version,
      },
      approverToken
    );
    expect(docRevRes.status).toBe(201);
    const revDocId = (await docRevRes.json()).document.id;

    const chalRes = await post(
      `/proposals/${draft.id}/revisions/${revision.id}/decision-challenge`,
      {
        action: "APPROVE",
        decisionReference: "SK-REV-01",
        decisionDate: "2024-04-01",
        decisionDocumentId: revDocId,
        notes: "Persetujuan revisi",
      },
      approverToken
    );
    expect(chalRes.status).toBe(201);
    const chal = await chalRes.json();
    const sig = await approverSinar.signTypedData(signable(chal.typedData));
    const decideRevRes = await post(
      `/proposals/${draft.id}/revisions/${revision.id}/decide`,
      {
        nonce: chal.challenge.nonce,
        signature: sig,
        operationId: crypto.randomUUID(),
        notes: "Persetujuan revisi",
      },
      approverToken
    );
    expect(decideRevRes.status).toBe(200);

    // Buka kembali paket bukti lama melalui drill-down
    const drillRes = await get(`${EVIDENCE}/${prepV1.id}/drill-down`, amilToken);
    const drillData = await drillRes.json();
    expect(drillData.success).toBe(true);

    // Snapshot versi 1 harus TETAP mempertahankan nama asli ("Zaidan Akbar", bukan "Zaidan Akbar REVISI")
    // dan versi proposal yang terikat harus tepat 1
    const zaidanRealization = drillData.provenances[0].realizations[0];
    expect(zaidanRealization.proposalVersion).toBe(1);
    expect(zaidanRealization.beneficiary.name).toBe("Zaidan Akbar");
    expect(zaidanRealization.amountIdr).toBe("5000000");
  });

  it("kejujuran penelusuran: paket rekapitulasi tanpa transaksi mengembalikan transactionDetail NOT_AVAILABLE", async () => {
    const amilToken = await signIn(amilSinar);

    // Bekukan paket dari sumber eksternal rekapitulasi biasa tanpa rincian transaksi
    const res = await post(
      EVIDENCE,
      {
        label: "Rekapitulasi Donasi Kas",
        period: { kind: "SEMESTER", year: 2024 },
        currencyUnit: "IDR",
        balanceSheetScope: "ON",
        claim: {
          manifest: {
            label: "Klaim Rekap",
            origin: "PASTE",
            scopeUnit: "NASIONAL",
            scopeLevel: "PUSAT",
            fundTypes: ["ZAKAT"],
            balanceSheet: "ON",
            currencyUnit: "IDR",
            period: { kind: "SEMESTER", year: 2024 },
            cutOff: CUT_OFF_ISO,
            format: "baris-ledger",
            mappingVersion: "1",
            transactionDetail: "NOT_AVAILABLE",
          },
          status: "READ",
          rows: [
            { key: "rk-1", bucket: "ZAKAT", balanceSheet: "ON", value: { amount: "10000000", unit: "IDR" } },
          ],
        },
        source: {
          manifest: {
            label: "Sumber Rekap",
            origin: "PASTE",
            scopeUnit: "NASIONAL",
            scopeLevel: "PUSAT",
            fundTypes: ["ZAKAT"],
            balanceSheet: "ON",
            currencyUnit: "IDR",
            period: { kind: "SEMESTER", year: 2024 },
            cutOff: CUT_OFF_ISO,
            format: "baris-ledger",
            mappingVersion: "1",
            transactionDetail: "NOT_AVAILABLE",
          },
          status: "READ",
          rows: [
            { key: "rk-1", bucket: "ZAKAT", balanceSheet: "ON", value: { amount: "10000000", unit: "IDR" } },
          ],
        },
      },
      amilToken
    );

    const { preparation } = await res.json();
    const drillRes = await get(`${EVIDENCE}/${preparation.id}/drill-down`, amilToken);
    const drillData = await drillRes.json();
    expect(drillData.success).toBe(true);
    expect(drillData.available).toBe(false);
    expect(drillData.transactionDetail).toBe("NOT_AVAILABLE");
    expect(drillData.reason).toContain("rekapitulasi tanpa rincian transaksi");
  });

  it("privasi proyeksi publik (AC31): ringkasan publik tidak membocorkan NIK atau rekening penerima", async () => {
    // Siapkan pengajuan dengan data pribadi penerima
    const { draft, amilToken } = await prepareApprovedProposal({
      name: "Program Bantuan Medis",
      purpose: "Bantuan pengobatan dhuafa",
      beneficiaries: [
        { id: "pasien-1", name: "Bapak Rahasia", nik: "3201999988887777", asnaf: "Gharimin" },
      ],
      lines: [
        {
          id: "line-med",
          beneficiaryId: "pasien-1",
          aidType: "Biaya Operasi",
          kind: "MONEY",
          amountRequestedIdr: "3000000",
        },
      ],
    });

    clock = 1712000000;
    let amilTokenMed = await signIn(amilSinar);
    const realRes = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        items: [
          {
            aidLineId: "line-med",
            beneficiaryId: "pasien-1",
            method: "BANK_TRANSFER",
            amountIdr: "3000000",
            reportedAt: 1712000000,
            notes: "Transfer biaya operasi",
          },
        ],
      },
      amilTokenMed
    );
    expect(realRes.status).toBe(201);

    clock = CUT_OFF_SECONDS;
    amilTokenMed = await signIn(amilSinar);
    const freezeRes = await post(
      EVIDENCE,
      {
        label: "Paket Bukti Medis 2024",
        period: { kind: "SEMESTER", year: 2024 },
        currencyUnit: "IDR",
        balanceSheetScope: "ON",
        claim: {
          manifest: {
            label: "Klaim",
            origin: "PASTE",
            scopeUnit: "NASIONAL",
            scopeLevel: "PUSAT",
            fundTypes: ["ZAKAT"],
            balanceSheet: "ON",
            currencyUnit: "IDR",
            period: { kind: "SEMESTER", year: 2024 },
            cutOff: CUT_OFF_ISO,
            format: "baris-ledger",
            mappingVersion: "1",
            transactionDetail: "PRESENT",
          },
          status: "READ",
          rows: [
            { key: "m-1", bucket: "ZAKAT", balanceSheet: "ON", value: { amount: "3000000", unit: "IDR" } },
          ],
        },
        source: {
          internal: {
            stream: DISBURSEMENT_REALIZATION_STREAM,
            cutOff: CUT_OFF_ISO,
          },
        },
      },
      amilToken
    );

    const { preparation } = await freezeRes.json();

    // Akses endpoint publik tanpa token otentikasi
    const publicRes = await get(`${EVIDENCE}/${preparation.id}/public`);
    expect(publicRes.status).toBe(200);
    const publicBody = await publicRes.json();
    const publicJsonStr = JSON.stringify(publicBody);

    // AC31: Tidak boleh ada NIK, nama lengkap penerima, rekening bank, atau commitment salt
    expect(publicJsonStr).not.toContain("3201999988887777");
    expect(publicJsonStr).not.toContain("Bapak Rahasia");
    expect(publicBody.summary.salt).toBeUndefined();
    expect(publicBody.summary.sides[0].rows).toBeUndefined();
  });

  it("sumber kosong terbaca penuh tanpa klaim 'Rp 0 untuk 0 penerima'; sumber gagal dibaca tidak menjadi sumber kosong", async () => {
    const amilToken = await signIn(amilSinar);
    const freeze = (label: string) =>
      post(
        EVIDENCE,
        {
          label,
          period: { kind: "SEMESTER", year: 2024 },
          currencyUnit: "IDR",
          balanceSheetScope: "ON",
          claim: pastedClaim("0"),
          source: { internal: { stream: DISBURSEMENT_REALIZATION_STREAM, cutOff: CUT_OFF_ISO } },
        },
        amilToken
      );

    // Kosong: dibaca dengan berhasil, tidak ada realisasi dalam cakupan.
    const emptyRes = await freeze("Sumber kosong");
    expect(emptyRes.status).toBe(201);
    const empty = (await emptyRes.json()).preparation;
    const emptySide = empty.sources.find((s: any) => s.role === "SOURCE");
    expect(emptySide.status).toBe("READ");
    expect(emptySide.rows).toEqual([]);
    const notes: string[] = empty.snapshot.coverageNotes;
    expect(notes.some((n) => n.includes("tidak memuat realisasi"))).toBe(true);
    expect(notes.some((n) => n.includes("untuk 0 penerima"))).toBe(false);

    // Gagal: pembacaan penyimpanan melempar galat.
    configureRuntime({
      ...disbursement,
      readRealizationSourceData: async () => {
        throw new Error("koneksi terputus");
      },
    });
    try {
      const failedRes = await freeze("Sumber gagal");
      expect(failedRes.status).toBe(201);
      const failed = (await failedRes.json()).preparation;
      expect(failed.outcome).toBe("INCOMPLETE");
      expect(failed.sources.find((s: any) => s.role === "SOURCE").status).toBe("FAILED");
      expect(failed.files.some((f: any) => f.fileName === PROVENANCE_FILE_NAMES.SOURCE)).toBe(false);
      expect(failed.snapshot.coverageNotes.some((n: string) => n.includes("belum terperiksa"))).toBe(true);

      const drill = await (await get(`${EVIDENCE}/${failed.id}/drill-down`, amilToken)).json();
      expect(drill.available).toBe(false);
      expect(drill.transactionDetail).toBe("NO_REALIZATION_SOURCE");

      const offered = await (await get(`${EVIDENCE}/internal-sources?periodKind=SEMESTER&year=2024`, amilToken)).json();
      const relStream = offered.streams.find((s: any) => s.stream === DISBURSEMENT_REALIZATION_STREAM);
      expect(relStream.available).toBe(false);
      expect(relStream.sides[0].status).toBe("FAILED");
    } finally {
      configureRuntime(disbursement);
    }
  });

  it("lampiran tidak dapat memakai nama berkas provenance yang dicadangkan server", async () => {
    const amilToken = await signIn(amilSinar);
    const res = await post(
      EVIDENCE,
      {
        label: "Upaya pemalsuan provenance",
        period: { kind: "SEMESTER", year: 2024 },
        currencyUnit: "IDR",
        balanceSheetScope: "ON",
        claim: pastedClaim("1000"),
        source: { internal: { stream: DISBURSEMENT_REALIZATION_STREAM, cutOff: CUT_OFF_ISO } },
        files: [
          {
            role: "SOURCE",
            fileName: PROVENANCE_FILE_NAMES.SOURCE,
            mimeType: "application/json",
            contentBase64: Buffer.from(JSON.stringify({ format: "tawf.realization.provenance" })).toString("base64"),
          },
        ],
      },
      amilToken
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("dicadangkan");
  });

  it("dokumen dan sengketa sesudah cut-off tidak ikut dibekukan; sengketa sesudah freeze tidak mengubah snapshot lama", async () => {
    const { draft } = await prepareApprovedProposal({
      beneficiaries: [{ id: "ben-1", name: "Ibu Wati", nik: "3201123456780009" }],
      lines: [{ id: "line-1", beneficiaryId: "ben-1", aidType: "Santunan", kind: "MONEY", amountRequestedIdr: "700000" }],
    });

    clock = 1713000000; // sebelum cut-off
    let amilToken = await signIn(amilSinar);
    const realRes = await post(
      `/proposals/${draft.id}/realizations`,
      {
        expectedVersion: draft.version,
        items: [{ aidLineId: "line-1", beneficiaryId: "ben-1", method: "CASH", amountIdr: "700000", reportedAt: 1713000000 }],
      },
      amilToken
    );
    expect(realRes.status).toBe(201);
    const realizationId = (await realRes.json()).records[0].id;

    const raiseDispute = (reason: string) =>
      post(
        `/proposals/${draft.id}/realizations/${realizationId}/disputes`,
        { complainantType: "BENEFICIARY", subject: "AMOUNT", reason, disputedAmountIdr: "100000" },
        amilToken
      );
    expect((await raiseDispute("Diajukan sebelum cut-off")).status).toBe(201);

    // Sesudah cut-off, sebelum freeze
    clock = CUT_OFF_SECONDS + 3600;
    amilToken = await signIn(amilSinar);
    expect((await raiseDispute("Diajukan sesudah cut-off")).status).toBe(201);

    const freezeRes = await post(
      EVIDENCE,
      {
        label: "Paket sengketa",
        period: { kind: "SEMESTER", year: 2024 },
        currencyUnit: "IDR",
        balanceSheetScope: "ON",
        claim: pastedClaim("700000"),
        source: { internal: { stream: DISBURSEMENT_REALIZATION_STREAM, cutOff: CUT_OFF_ISO } },
      },
      amilToken
    );
    expect(freezeRes.status).toBe(201);
    const preparationId = (await freezeRes.json()).preparation.id;

    const readDisputes = async () => {
      const drill = await (await get(`${EVIDENCE}/${preparationId}/drill-down`, amilToken)).json();
      return drill.provenances[0].realizations[0].disputes.map((d: any) => d.reason);
    };
    expect(await readDisputes()).toEqual(["Diajukan sebelum cut-off"]);

    // Sesudah freeze
    clock = CUT_OFF_SECONDS + 7200;
    amilToken = await signIn(amilSinar);
    expect((await raiseDispute("Diajukan sesudah freeze")).status).toBe(201);
    expect(await readDisputes()).toEqual(["Diajukan sebelum cut-off"]);

    // Status terkini tampil berdampingan dengan waktu bacanya, tanpa mengubah snapshot.
    const drill = await (await get(`${EVIDENCE}/${preparationId}/drill-down`, amilToken)).json();
    expect(drill.current.available).toBe(true);
    expect(drill.current.observedAt).toBe(clock);
    const current = drill.current.realizations.find((r: any) => r.realizationId === realizationId);
    expect(current.found).toBe(true);
    expect(current.disputes).toHaveLength(3);
    expect(drill.provenances[0].realizations[0].disputes).toHaveLength(1);

    // Status terkini gagal dibaca: rincian beku tetap tersedia, kegagalan dinyatakan.
    configureRuntime({
      ...disbursement,
      readRealizationSourceData: async () => {
        throw new Error("koneksi terputus");
      },
    });
    try {
      const degraded = await (await get(`${EVIDENCE}/${preparationId}/drill-down`, amilToken)).json();
      expect(degraded.available).toBe(true);
      expect(degraded.provenances[0].realizations[0].disputes).toHaveLength(1);
      expect(degraded.current.available).toBe(false);
      expect(degraded.current.reason).toContain("tidak dapat dibaca");
    } finally {
      configureRuntime(disbursement);
    }
  });
  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)(
    "browser: petugas memilih mode realisasi penyaluran, menentukan cut-off, dan melihat drill-down rincian penerima",
    async () => {
      // Realisasi sebelum cut-off, lalu paket dibekukan; sengketa dicatat sesudah freeze.
      const { draft } = await prepareApprovedProposal({
        beneficiaries: [{ id: "ben-1", name: "Ibu Smoke", nik: "3201123456780011" }],
        lines: [{ id: "line-1", beneficiaryId: "ben-1", aidType: "Santunan", kind: "MONEY", amountRequestedIdr: "450000" }],
      });
      clock = 1713000000;
      let amilToken = await signIn(amilSinar);
      const realRes = await post(
        `/proposals/${draft.id}/realizations`,
        {
          expectedVersion: draft.version,
          items: [{ aidLineId: "line-1", beneficiaryId: "ben-1", method: "CASH", amountIdr: "450000", reportedAt: 1713000000 }],
        },
        amilToken
      );
      expect(realRes.status).toBe(201);
      const realizationId = (await realRes.json()).records[0].id;
      clock = CUT_OFF_SECONDS;
      amilToken = await signIn(amilSinar);
      const freezeRes = await post(
        EVIDENCE,
        {
          label: "Paket Smoke Realisasi",
          period: { kind: "SEMESTER", year: 2024 },
          currencyUnit: "IDR",
          balanceSheetScope: "ON",
          claim: pastedClaim("450000"),
          source: { internal: { stream: DISBURSEMENT_REALIZATION_STREAM, cutOff: CUT_OFF_ISO } },
        },
        amilToken
      );
      expect(freezeRes.status).toBe(201);
      expect(
        (
          await post(
            `/proposals/${draft.id}/realizations/${realizationId}/disputes`,
            { complainantType: "BENEFICIARY", subject: "AMOUNT", reason: "Sesudah freeze", disputedAmountIdr: "1000" },
            amilToken
          )
        ).status
      ).toBe(201);
      // The browser checks session expiry against its own clock.
      clock = Math.floor(Date.now() / 1000);

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
        hostname: "127.0.0.1",
        port: 0,
        async fetch(req) {
          const path = new URL(req.url).pathname;
          if (path === "/") {
            return new Response(
              '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/smoke.css"><div id="root"></div><script type="module" src="/smoke.js"></script>',
              { headers: { "Content-Type": "text/html" } }
            );
          }
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

      try {
        const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
        const browser = await chromium.launch({
          executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE,
          headless: true,
          args: ["--no-sandbox"],
        });

        for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
          const page = await browser.newPage({ viewport });
          const errors: string[] = [];
          page.on("pageerror", (error: Error) => errors.push(error.message));
          page.setDefaultTimeout(10000);

          await page.goto(server.url.toString());
          await page.getByRole("button", { name: /^0x/ }).waitFor();
          await page.getByLabel("Pengelola Zakat", { exact: true }).selectOption(SINAR);
          await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();

          // Form persiapan: mode realisasi menampilkan pemilih cut-off, tanpa editor JSON manual.
          await page.getByRole("button", { name: /Realisasi Penyaluran/ }).click();
          await page.getByLabel(/Batas Akhir Cut-off Realisasi/).waitFor();
          expect(await page.getByText("Unggah ledger JSON").count()).toBe(0);

          // Paket lama: drill-down ke versi pengajuan dan penerima yang dibekukan.
          await page.getByRole("button", { name: /Paket Smoke Realisasi/ }).click();
          await page.getByRole("button", { name: "Buka Rincian Penelusuran" }).click();
          await page.getByRole("cell", { name: /Ibu Smoke/ }).first().waitFor();
          await page.getByRole("button", { name: "v1", exact: true }).click();
          await page.getByText(/Penerima pada versi ini: Ibu Smoke/).waitFor();
          // Sengketa sesudah freeze hanya muncul pada kolom status terkini, bukan pada snapshot lama.
          await page.getByText(/Kolom "Status terkini" dibaca dari data kerja/).waitFor();
          await page.getByText("Berubah sejak dibekukan").waitFor();
          expect(await page.getByText(/Penerimaan diperselisihkan/).count()).toBe(1);

          expect(errors).toHaveLength(0);
          await page.close();
        }
        await browser.close();
      } finally {
        server.stop();
      }
    },
    90000
  );
});

describe("buildDisbursementRealizationSide (Issue #98)", () => {
  const realization = (overrides: Partial<RealizationItemData> = {}): RealizationItemData => ({
    id: "real-1",
    institutionId: SINAR,
    proposalId: "prop-1",
    proposalVersion: 1,
    proposalVersionFound: true,
    programId: "prog-1",
    programName: "Program",
    programFundType: "ZAKAT",
    proposalPurpose: "Bantuan",
    aidLineId: "line-1",
    beneficiaryId: "ben-1",
    beneficiaryName: "Penerima",
    method: "CASH",
    amountIdr: "100000",
    quantity: null,
    unit: null,
    reportedAt: 1713000000,
    recordedAt: 1713000000,
    operatorAccount: "0x0",
    operatorOfficerId: "off-1",
    notes: null,
    evidenceStatus: "EVIDENCE_PENDING",
    confirmationStatus: "UNCONFIRMED",
    confirmationMethod: null,
    documents: [],
    disputes: [],
    ...overrides,
  });
  const build = (input: Partial<Parameters<typeof buildDisbursementRealizationSide>[0]>) =>
    buildDisbursementRealizationSide({
      institution: { id: SINAR, legalName: "LPZ Sinar Amanah", scopeUnit: "NASIONAL", scopeLevel: "PUSAT" },
      period: { kind: "SEMESTER", year: 2024 },
      cutOff: CUT_OFF_ISO,
      realizations: [],
      advances: [],
      expenses: [],
      ...input,
    });

  it("tidak menebak jenis dana, nilai rusak, atau versi pengajuan yang hilang", () => {
    const { side } = build({
      realizations: [
        realization({ id: "unknown-fund", programFundType: "WAKAF" }),
        realization({ id: "bad-amount", amountIdr: "12.5" }),
        realization({ id: "no-version", proposalVersionFound: false }),
      ],
    });
    expect(side.status).toBe("READ");
    if (side.status !== "READ") return;
    expect(side.rows).toEqual([]);
    expect(side.unverified?.map((u) => u.reference).sort()).toEqual(["bad-amount", "no-version", "unknown-fund"]);
    expect(side.manifest.fundTypes).not.toEqual(["ZAKAT"]);
  });

  it("jenis dana manifest hanya yang benar-benar dicakup; INFAK dipetakan ke INFAK_SEDEKAH", () => {
    const { side } = build({ realizations: [realization({ programFundType: "INFAK" })] });
    expect(side.manifest.fundTypes).toEqual(["INFAK_SEDEKAH"]);
  });

  it("uang muka dan beban sesudah cut-off atau di luar periode tidak dijumlahkan", () => {
    const { provenance } = build({
      advances: [
        { id: "adv-in", proposalId: "p", amountIdr: "100", purpose: "x", reference: "r", issuedAt: 1713000000 },
        { id: "adv-late", proposalId: "p", amountIdr: "900", purpose: "x", reference: "r", issuedAt: AFTER_CUT_OFF_SECONDS },
      ],
      expenses: [
        { id: "exp-in", proposalId: "p", advanceId: null, amountIdr: "50", purpose: "x", payee: "y", recordedAt: 1713000000 },
        { id: "exp-out", proposalId: "p", advanceId: null, amountIdr: "700", purpose: "x", payee: "y", recordedAt: OUTSIDE_PERIOD_SECONDS },
      ],
    });
    expect(provenance.totals.advancesIdr).toBe("100");
    expect(provenance.totals.expensesIdr).toBe("50");
    expect(provenance.advances.map((a) => a.id)).toEqual(["adv-in"]);
    expect(provenance.expenses.map((e) => e.id)).toEqual(["exp-in"]);
  });

  it("dokumen yang diunggah sesudah cut-off tidak menjadi relasi beku", () => {
    const doc = (id: string, createdAt: number) => ({
      id, documentType: "RECEIPT_OR_BAST", fileName: `${id}.pdf`, mimeType: "application/pdf",
      sizeBytes: 1, contentSha256: "0x", storageRef: "ref", createdAt,
    });
    const { provenance } = build({
      realizations: [realization({ documents: [doc("early", 1713000000), doc("late", AFTER_CUT_OFF_SECONDS)] })],
    });
    expect(provenance.realizations[0]!.documents.map((d) => d.id)).toEqual(["early"]);
  });
});

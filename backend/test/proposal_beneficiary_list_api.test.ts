/**
 * Proposal beneficiary list comparison and revision API Tests
 * (Spec #86, Ticket #97, US-26, US-27, US-42, US-47, US-50; Skenario 7, 17, 19, 24, 25).
 *
 * Scenarios & Acceptance Criteria covered:
 *   - Skenario 7 / AC 1, AC 4: Identical file re-upload detects 0 changes, keeps stable IDs;
 *     duplicate retry with identical operationId replays saved result; operationId reuse with
 *     different payload returns 409 conflict.
 *   - AC 1, AC 2: Diff categorization (added, modified, removed, unchanged), field-level changes
 *     (amount IDR, goods quantity/unit, contact, guardian), and totalsByUnit (IDR vs goods units).
 *   - AC 3: Apply to draft with expectedVersion lock, atomic draft + BENEFICIARY_ROSTER document save;
 *     stale version returns 409 conflict.
 *   - AC 4: Multi-tenant and operational capability isolation: foreign institution access returns 404,
 *     foreign IDs return 403, and unmandated users return 403.
 *   - Skenario 17 / AC 5, AC 6: Approved proposal re-upload routes through formal revision;
 *     floor rule (T10 / validateRevisionFloor) blocks reducing or deleting realized aid lines (409);
 *     valid revision holds changed lines (heldAidLineIds) without erasing old realizations or documents.
 *   - Pilot amendment & durability: Private contact changes tracked, data survives DB restart, no spurious NFTs.
 *   - Skenario 25: Browser smoke test (opt-in via REGISTRY_BROWSER_MODULE).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, readdir, rename, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { pruneProposalPreviews } from "../src/proposal-preview-maintenance";
import { createEvidenceStore } from "../src/evidence-store";
import * as XLSX from "xlsx";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { createDisbursementStore, type DisbursementStore } from "../src/disbursement-store";
import { createActivityStore, type ActivityStore } from "../src/activity-store";
import { createContributionStore } from "../src/contribution-store";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { createEncryptedFileStore, type PrivateFileStore } from "../src/evidence-files";
import {
  BENEFICIARY_TEMPLATE_HEADERS,
  BENEFICIARY_TEMPLATE_VERSION,
} from "../src/beneficiary-template-generator";
import type { BeneficiaryColumn } from "../src/beneficiary-tabular-schema";

const WORKSPACE = "http://localhost:3001/api/workspace";

const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";

const adminSinarAccount = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
const amilSinarAccount = privateKeyToAccount(`0x${"21".repeat(32)}` as Hex);
const examinerSinarAccount = privateKeyToAccount(`0x${"31".repeat(32)}` as Hex);
const approverSinarAccount = privateKeyToAccount(`0x${"41".repeat(32)}` as Hex);
const readerSinarAccount = privateKeyToAccount(`0x${"51".repeat(32)}` as Hex);
const rivalOfficerAccount = privateKeyToAccount(`0x${"61".repeat(32)}` as Hex);

const adminBaitulAccount = privateKeyToAccount(`0x${"71".repeat(32)}` as Hex);

const NOW = 1_800_000_000;
const FILE_KEY = Buffer.alloc(32, 88);

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let disbursement: DisbursementStore;
let activities: ActivityStore;
let files: PrivateFileStore;
let tempDir: string;
let clock = NOW;
const outbox: Array<{ to: string; body: string }> = [];

const configure = () =>
  configureWorkspace({
    store,
    disbursement,
    activities,
    files,
    evidence: createEvidenceStore(database.handle() as never),
    messages: { async send(message) { outbox.push(message); } },
    ethCall: async () => "0x",
    now: () => clock,
    sessionTtlSeconds: 3600,
    challengeTtlSeconds: 300,
  });

const request = (url: string, init: RequestInit = {}) => app.fetch(new Request(url, init));

const post = (url: string, body: unknown, token?: string) =>
  request(url.startsWith("http") ? url : `${WORKSPACE}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

const get = (url: string, token?: string) =>
  request(url.startsWith("http") ? url : `${WORKSPACE}${url}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

async function signIn(account: { address: string; signTypedData: (payload: any) => Promise<Hex> }, institutionId: string): Promise<string> {
  const minted = await post(`${WORKSPACE}/challenge`, { institutionId, account: account.address });
  if (minted.status !== 201) {
    const errText = await minted.text();
    throw new Error(`Failed to mint challenge (${minted.status}): ${errText}`);
  }
  const { challenge, typedData } = await minted.json();
  const signature = await account.signTypedData({
    ...typedData,
    message: {
      ...typedData.message,
      issuedAt: BigInt(typedData.message.issuedAt),
      expiresAt: BigInt(typedData.message.expiresAt),
    },
  });
  const session = await post(`${WORKSPACE}/session`, { nonce: challenge.nonce, signature });
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

type SheetRow = Partial<Record<BeneficiaryColumn, string>>;

const cellsOf = (row: SheetRow) => BENEFICIARY_TEMPLATE_HEADERS.map((column) => row[column] ?? "");

function buildXlsxBase64(rows: SheetRow[]): string {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([Array.from(BENEFICIARY_TEMPLATE_HEADERS), ...rows.map(cellsOf)]);
  XLSX.utils.book_append_sheet(wb, ws, "Daftar_Penerima");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(buf).toString("base64");
}

function buildCsvString(rows: SheetRow[]): string {
  const lines = [
    Array.from(BENEFICIARY_TEMPLATE_HEADERS).join(","),
    ...rows.map((r) =>
      cellsOf(r)
        .map((val) => (/[",\n\r]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val))
        .join(",")
    ),
  ];
  return lines.join("\n");
}

const moneyRow = (overrides: SheetRow = {}): SheetRow => ({
  nama: "Mustahik Satu",
  dasar_identitas: "NIK",
  nik: "3201010101800001",
  alamat_cakupan: "Bandung Kulon",
  asnaf: "FAKIR",
  jenis_bantuan: "UANG",
  nama_bantuan: "Bantuan Tunai Pendidikan",
  nilai_idr: "1000000",
  periode_bantuan: "2026-03",
  referensi_bukti: "BUKTI-001",
  kontak_telepon: "081234567890",
  kontak_relasi: "Pribadi",
  ...overrides,
});

const goodsRow = (overrides: SheetRow = {}): SheetRow => ({
  nama: "Mustahik Dua",
  dasar_identitas: "NIK",
  nik: "3201010101800002",
  alamat_cakupan: "Cimahi Selatan",
  asnaf: "MISKIN",
  jenis_bantuan: "BARANG",
  nama_bantuan: "Beras Premium",
  jumlah_barang: "50",
  satuan_barang: "Kg",
  nilai_idr_barang: "750000",
  dasar_valuasi_barang: "Harga pasar grosir Rp15.000/Kg",
  periode_bantuan: "2026-03",
  referensi_bukti: "BUKTI-002",
  kontak_telepon: "081234567891",
  kontak_relasi: "Pribadi",
  ...overrides,
});

async function createTestProgram(token: string, inst = SINAR) {
  const res = await post(
    `${WORKSPACE}/programs`,
    {
      institutionId: inst,
      name: `Program Penyaluran Ramadhan ${crypto.randomUUID().slice(0, 8)}`,
      purpose: "Bantuan asnaf fakir miskin",
      fundType: "ZAKAT",
      scope: "Jawa Barat",
      referenceCeiling: "500000000",
    },
    token
  );
  expect(res.status).toBe(201);
  return (await res.json()).program;
}

async function prepareDraftProposal(amilToken: string, programId: string, initialRows: SheetRow[]) {
  // First import preview to generate valid beneficiaries & aidLines
  const prevRes = await post(
    `${WORKSPACE}/proposals/import/preview`,
    { fileName: "daftar-awal.xlsx", contentBase64: buildXlsxBase64(initialRows) },
    amilToken
  );
  expect(prevRes.status).toBe(200);
  const { preview } = await prevRes.json();

  const createRes = await post(
    `${WORKSPACE}/proposals`,
    {
      programId,
      originOfRequest: "Rekomendasi RW",
      purpose: "Penyaluran Mustahik Tahap 1",
      aidPeriod: { start: "2026-03-01", end: "2026-03-31" },
      personInCharge: "Ahmad Amil",
      previewId: preview.previewId,
          beneficiaries: preview.beneficiaries,
      aidLines: preview.aidLines,
      operationId: crypto.randomUUID(),
      expectedVersion: 0,
      file: {
        fileName: "daftar-awal.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        contentBase64: buildXlsxBase64(initialRows),
      },
    },
    amilToken
  );
  expect(createRes.status).toBe(201);
  const draft = (await createRes.json()).draft;
  const attachment = await post(`${WORKSPACE}/proposals/${draft.id}/documents`, {
    category: "BENEFICIARY_ROSTER", fileName: "daftar-awal.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    contentBase64: buildXlsxBase64(initialRows), expectedVersion: draft.version,
  }, amilToken);
  expect(attachment.status).toBe(201);
  return draft;
}

async function prepareApprovedProposalWithRealization(tokens: {
  amilToken: string;
  examinerToken: string;
  approverToken: string;
  adminToken: string;
}) {
  const program = await createTestProgram(tokens.adminToken);

  // Policy without strict identity doc for smooth test approval
  const pol = (await (await get(`${WORKSPACE}/policy`, tokens.adminToken)).json()).policy;
  await post(`${WORKSPACE}/policy`, { ...pol, expectedVersion: pol.version, requireIdentityDoc: false }, tokens.adminToken);

  const initialRows = [
    moneyRow({ id_penerima: "ben-1", id_baris: "aid-1", nilai_idr: "1000000" }),
    goodsRow({ id_penerima: "ben-2", id_baris: "aid-2", jumlah_barang: "50", satuan_barang: "Kg" }),
  ];

  const draft = await prepareDraftProposal(tokens.amilToken, program.id, initialRows);

  // Upload proposal letter
  const docRes = await post(
    `${WORKSPACE}/proposals/${draft.id}/documents`,
    {
      category: "PROPOSAL_LETTER",
      fileName: "surat.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("Surat Pengajuan").toString("base64"),
    },
    tokens.amilToken
  );
  expect(docRes.status).toBe(201);

  // Submit
  const subRes = await post(
    `${WORKSPACE}/proposals/${draft.id}/submit`,
    { expectedVersion: draft.version, operationId: crypto.randomUUID() },
    tokens.amilToken
  );
  expect(subRes.status).toBe(200);
  const submitted = (await subRes.json()).draft;

  // Examiner ready
  await post(
    `${WORKSPACE}/proposals/${draft.id}/start-examination`,
    { expectedVersion: submitted.version, operationId: crypto.randomUUID() },
    tokens.examinerToken
  );
  const readyRes = await post(
    `${WORKSPACE}/proposals/${draft.id}/ready`,
    {
      expectedVersion: submitted.version,
      operationId: crypto.randomUUID(),
      checklist: {
        administrativeChecksOk: true,
        eligibilityChecksOk: true,
        alternativeIdReviewed: true,
        recurringAidExceptions: [],
        notes: "Lolos telaah",
      },
    },
    tokens.examinerToken
  );
  expect(readyRes.status).toBe(200);
  const readyDraft = (await readyRes.json()).draft;

  // Approver decision
  const skRes = await post(
    `${WORKSPACE}/proposals/${draft.id}/decision-documents`,
    {
      fileName: "sk-persetujuan.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("SK Penetapan").toString("base64"),
      expectedVersion: readyDraft.version,
    },
    tokens.approverToken
  );
  expect(skRes.status).toBe(201);
  const skDocId = (await skRes.json()).document.id;

  const approvedLines = [
    { id: "aid-1", amountApprovedIdr: "1000000" },
    { id: "aid-2", quantityApproved: "50" },
  ];
  const intent = { action: "APPROVE", decisionReference: "SK-001/DIR", decisionDate: "2026-03-10", decisionDocumentId: skDocId };
  const chalRes = await post(
    `${WORKSPACE}/proposals/${draft.id}/decision-challenge`,
    { ...intent, expectedVersion: readyDraft.version, approvedAidLines: approvedLines },
    tokens.approverToken
  );
  expect(chalRes.status).toBe(201);
  const { challenge, typedData } = await chalRes.json();
  const signature = await approverSinarAccount.signTypedData(signable(typedData));

  const decideRes = await post(
    `${WORKSPACE}/proposals/${draft.id}/decide`,
    {
      ...intent,
      signerAccount: challenge.signerAccount,
      mandateId: challenge.mandateId,
      signature,
      nonce: challenge.nonce,
      expectedVersion: readyDraft.version,
      operationId: crypto.randomUUID(),
      approvedAidLines: approvedLines,
    },
    tokens.approverToken
  );
  expect(decideRes.status).toBe(200);
  const approvedDraft = (await decideRes.json()).draft;

  // Record partial realization:
  // aid-1 realized Rp 400.000 out of Rp 1.000.000
  // aid-2 realized 30 Kg out of 50 Kg
  const reaRes = await post(
    `${WORKSPACE}/proposals/${draft.id}/realizations`,
    {
      expectedVersion: approvedDraft.version,
      operationId: crypto.randomUUID(),
      items: [
        {
          aidLineId: "aid-1",
          beneficiaryId: "ben-1",
          method: "CASH",
          amountIdr: "400000",
          reportedAt: NOW,
        },
        {
          aidLineId: "aid-2",
          beneficiaryId: "ben-2",
          method: "GOODS_HANDOVER",
          quantity: "30",
          unit: "Kg",
          reportedAt: NOW,
        },
      ],
    },
    tokens.amilToken
  );
  expect(reaRes.status).toBe(201);

  const updatedDraft = (await (await get(`${WORKSPACE}/proposals/${draft.id}`, tokens.amilToken)).json()).draft;
  return { program, draft: updatedDraft };
}

describe("Proposal beneficiary list comparison and revision (Ticket #97)", () => {
  let adminBaitulToken: string;
  let amilToken: string;
  let examinerToken: string;
  let approverToken: string;
  let adminToken: string;
  let readerToken: string;
  let rivalToken: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zkt-beneficiary-list-files-"));
    files = createEncryptedFileStore({ directory: tempDir, key: FILE_KEY });
    database = await createTestWorkspaceDatabase();
    store = createWorkspaceStore(database.handle());
    disbursement = createDisbursementStore(database.handle() as never);
    activities = createActivityStore(database.handle() as never);
    await store.ensureSchema();
    await disbursement.ensureSchema();
    await createEvidenceStore(database.handle() as never).ensureSchema();
    await createContributionStore(database.handle() as never).ensureSchema();
    await activities.ensureSchema();
    configure();

    for (const inst of SYNTHETIC_INSTITUTIONS) {
      await store.upsertInstitution(institutionRecordOf(inst));
    }

    // Memberships for SINAR
    await store.upsertMembership({ institutionId: SINAR, account: adminSinarAccount.address, role: "ADMIN" });
    await store.upsertMembership({ institutionId: SINAR, account: amilSinarAccount.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: SINAR, account: examinerSinarAccount.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: SINAR, account: approverSinarAccount.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: SINAR, account: readerSinarAccount.address, role: "READER" });

    // Memberships for BAITUL
    await store.upsertMembership({ institutionId: BAITUL, account: adminBaitulAccount.address, role: "ADMIN" });
    await store.upsertMembership({ institutionId: BAITUL, account: rivalOfficerAccount.address, role: "OFFICER" });

    // Officer profiles for SINAR
    await store.createOfficerProfile({
      id: "off-admin-sinar",
      institutionId: SINAR,
      displayName: "Admin Sinar",
      account: adminSinarAccount.address,
      role: "ADMIN",
      actor: adminSinarAccount.address,
      now: clock,
    });
    await store.createOfficerProfile({
      id: "off-amil-sinar",
      institutionId: SINAR,
      displayName: "Ahmad Amil",
      account: amilSinarAccount.address,
      role: "OFFICER",
      actor: adminSinarAccount.address,
      now: clock,
    });
    await store.createOfficerProfile({
      id: "off-examiner-sinar",
      institutionId: SINAR,
      displayName: "Budi Pemeriksa",
      account: examinerSinarAccount.address,
      role: "OFFICER",
      actor: adminSinarAccount.address,
      now: clock,
    });
    await store.createOfficerProfile({
      id: "off-approver-sinar",
      institutionId: SINAR,
      displayName: "Citra Direktur",
      account: approverSinarAccount.address,
      role: "OFFICER",
      actor: adminSinarAccount.address,
      now: clock,
    });

    // Officer profile for BAITUL
    await store.createOfficerProfile({
      id: "off-admin-baitul",
      institutionId: BAITUL,
      displayName: "Admin Baitul",
      account: adminBaitulAccount.address,
      role: "ADMIN",
      actor: adminBaitulAccount.address,
      now: clock,
    });
    await store.createOfficerProfile({
      id: "off-rival-baitul",
      institutionId: BAITUL,
      displayName: "Petugas Baitul",
      account: rivalOfficerAccount.address,
      role: "OFFICER",
      actor: adminBaitulAccount.address,
      now: clock,
    });

    // Mandates for Sinar officers
    const grantSinar = (officerId: string, fn: any) =>
      store.grantMandate({
        institutionId: SINAR,
        actor: adminSinarAccount.address,
        now: clock,
        mandate: {
          officerId,
          function: fn,
          scopeType: "ALL_PROGRAMS",
          assignmentRef: `SK-${fn}`,
          validFrom: clock - 1000,
          validUntil: clock + 86400 * 30,
        },
      });

    await grantSinar("off-admin-sinar", "MANAGE_PROGRAMS");
    await grantSinar("off-amil-sinar", "PREPARE_PROPOSALS");
    await grantSinar("off-amil-sinar", "RECORD_REALIZATION");
    await grantSinar("off-examiner-sinar", "EXAMINE_PROPOSALS");
    await grantSinar("off-approver-sinar", "APPROVE_DECISIONS");

    // Mandates for Baitul
    await store.grantMandate({
      institutionId: BAITUL,
      actor: adminBaitulAccount.address,
      now: clock,
      mandate: {
        officerId: "off-admin-baitul",
        function: "MANAGE_PROGRAMS",
        scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK-ADMIN-BAITUL",
        validFrom: clock - 1000,
        validUntil: clock + 86400 * 30,
      },
    });
    await store.grantMandate({
      institutionId: BAITUL,
      actor: adminBaitulAccount.address,
      now: clock,
      mandate: {
        officerId: "off-rival-baitul",
        function: "PREPARE_PROPOSALS",
        scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK-RIVAL-BAITUL",
        validFrom: clock - 1000,
        validUntil: clock + 86400 * 30,
      },
    });

    adminToken = await signIn(adminSinarAccount, SINAR);
    amilToken = await signIn(amilSinarAccount, SINAR);
    examinerToken = await signIn(examinerSinarAccount, SINAR);
    approverToken = await signIn(approverSinarAccount, SINAR);
    readerToken = await signIn(readerSinarAccount, SINAR);
    adminBaitulToken = await signIn(adminBaitulAccount, BAITUL);
    rivalToken = await signIn(rivalOfficerAccount, BAITUL);
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

  describe("Scenario 7 / AC 1, AC 4: Identical file upload & idempotency", () => {
    it("detects identical file with zero changes and preserves existing IDs", async () => {
      const program = await createTestProgram(adminToken);
      const initialRows = [
        moneyRow({ nama: "Mustahik Satu", nik: "3201010101800001", nilai_idr: "500000" }),
        goodsRow({ nama: "Mustahik Dua", nik: "3201010101800002", jumlah_barang: "25", satuan_barang: "Kg" }),
      ];
      const draft = await prepareDraftProposal(amilToken, program.id, initialRows);

      // Re-upload the exact same xlsx file
      const identicalBase64 = buildXlsxBase64(initialRows);
      const previewRes = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/preview`,
        { fileName: "daftar-awal.xlsx", contentBase64: identicalBase64 },
        amilToken,
      );
      expect(previewRes.status).toBe(200);
      const { diff } = await previewRes.json();

      expect(diff.isIdentical).toBe(true);
      expect(diff.aidLineCounts.added).toBe(0);
      expect(diff.aidLineCounts.modified).toBe(0);
      expect(diff.aidLineCounts.removed).toBe(0);
      expect(diff.aidLineCounts.unchanged).toBe(2);
      expect(diff.unchangedAidLineIds.length).toBe(2);

      // Preserves original IDs
      const origLineIds = draft.aidLines.map((l: any) => l.id);
      expect(diff.unchangedAidLineIds).toEqual(origLineIds);
    });

    it("replays identical response for duplicate apply with same operationId, rejects payload collision with 409", async () => {
      const program = await createTestProgram(adminToken);
      const initialRows = [moneyRow({ nilai_idr: "500000" })];
      const draft = await prepareDraftProposal(amilToken, program.id, initialRows);

      const modifiedRows = [
        moneyRow({
          id_penerima: draft.beneficiaries[0].id,
          id_baris: draft.aidLines[0].id,
          nilai_idr: "600000",
        }),
      ];
      const previewRes = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/preview`,
        {
          fileName: "daftar-revisi.xlsx",
          contentBase64: buildXlsxBase64(modifiedRows),
        },
        amilToken,
      );
      const { preview } = await previewRes.json();

      const operationId = crypto.randomUUID();
      const applyPayload = {
        expectedVersion: draft.version,
        operationId,
        previewId: preview.previewId,
          beneficiaries: preview.beneficiaries,
        aidLines: preview.aidLines,
        file: {
          fileName: "daftar-revisi.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          contentBase64: buildXlsxBase64(modifiedRows),
        },
      };

      // 1. Initial Apply
      const firstApply = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/apply`,
        applyPayload,
        amilToken,
      );
      expect(firstApply.status).toBe(200);
      const firstJson = await firstApply.json();
      expect(firstJson.draft.version).toBe(draft.version + 1);

      // 2. Duplicate retry with same operationId & identical payload: replays saved result
      const retryApply = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/apply`,
        applyPayload,
        amilToken,
      );
      expect(retryApply.status).toBe(200);
      const retryJson = await retryApply.json();
      expect(retryJson.draft.version).toBe(firstJson.draft.version);

      // 3. Reused operationId with different payload throws 409 Conflict
      const collisionPayload = {
        ...applyPayload,
        beneficiaries: [],
      };
      const collisionRes = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/apply`,
        collisionPayload,
        amilToken,
      );
      expect(collisionRes.status).toBe(409);
    });
  });

  describe("AC 1, AC 2: Diff Calculation and Totals Comparison", () => {
    it("correctly identifies added, modified, removed, unchanged rows and calculates totals by unit", async () => {
      const program = await createTestProgram(adminToken);
      const initialRows = [
        moneyRow({ nama: "Mustahik A", nik: "3201010101800001", nilai_idr: "500000" }),
        goodsRow({ nama: "Mustahik B", nik: "3201010101800002", jumlah_barang: "50", satuan_barang: "Kg" }),
        moneyRow({ nama: "Mustahik C", nik: "3201010101800003", nilai_idr: "1000000" }),
      ];
      const draft = await prepareDraftProposal(amilToken, program.id, initialRows);

      const bA = draft.beneficiaries[0];
      const lA = draft.aidLines[0];
      const bB = draft.beneficiaries[1];
      const lB = draft.aidLines[1];
      // Mustahik C (draft.beneficiaries[2]) is omitted -> should be REMOVED

      const updatedRows = [
        // Mustahik A: modified money (500rb -> 750rb), phone changed, added guardian
        moneyRow({
          id_penerima: bA.id,
          id_baris: lA.id,
          nama: "Mustahik A",
          nik: "3201010101800001",
          nilai_idr: "750000",
          kontak_telepon: "081999999999",
          nama_perwakilan: "Wali Barokah",
          hubungan_perwakilan: "Paman",
        }),
        // Mustahik B: modified goods quantity (50 -> 40 Kg)
        goodsRow({
          id_penerima: bB.id,
          id_baris: lB.id,
          nama: "Mustahik B",
          nik: "3201010101800002",
          jumlah_barang: "40",
          satuan_barang: "Kg",
        }),
        // Mustahik D: brand new row -> ADDED
        moneyRow({
          nama: "Mustahik D Baru",
          nik: "3201010101800004",
          nilai_idr: "300000",
        }),
      ];

      const previewRes = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/preview`,
        {
          fileName: "daftar-perubahan.xlsx",
          contentBase64: buildXlsxBase64(updatedRows),
        },
        amilToken,
      );
      expect(previewRes.status).toBe(200);
      const { diff } = await previewRes.json();

      expect(diff.isIdentical).toBe(false);
      expect(diff.aidLineCounts.added).toBe(1);
      expect(diff.aidLineCounts.modified).toBe(2);
      expect(diff.aidLineCounts.removed).toBe(1);
      expect(diff.aidLineCounts.unchanged).toBe(0);

      // Verify Added
      const addedDetails = diff.rowDetails.filter((r: any) => r.status === "ADDED");
      expect(addedDetails.length).toBe(1);
      expect(addedDetails[0].name).toBe("Mustahik D Baru");

      // Verify Modified
      const modDetails = diff.rowDetails.filter((r: any) => r.status === "MODIFIED");
      expect(modDetails.length).toBe(2);
      const modA = modDetails.find((m: any) => m.aidLineId === lA.id);
      expect(modA).toBeDefined();
      expect(modA.changes.some((c: any) => c.field === "amountIdr")).toBe(true);
      expect(modA.changes.some((c: any) => c.field === "contact")).toBe(true);
      expect(modA.changes.some((c: any) => c.field === "guardian")).toBe(true);

      const modB = modDetails.find((m: any) => m.aidLineId === lB.id);
      expect(modB).toBeDefined();
      expect(modB.changes.some((c: any) => c.field === "quantity")).toBe(true);

      // Verify Removed
      const remDetails = diff.rowDetails.filter((r: any) => r.status === "REMOVED");
      expect(remDetails.length).toBe(1);
      expect(remDetails[0].name).toBe("Mustahik C");

      // Verify Totals by Unit:
      // IDR before: 500.000 + 1.000.000 = 1.500.000
      // IDR after: 750.000 + 300.000 = 1.050.000
      expect(diff.totalsBefore["IDR"]).toBe("1500000");
      expect(diff.totalsAfter["IDR"]).toBe("1050000");

      // Goods (Kg) before: 50
      // Goods (Kg) after: 40
      expect(diff.totalsBefore["Beras Premium:Kg"]).toBe("50");
      expect(diff.totalsAfter["Beras Premium:Kg"]).toBe("40");
    });
  });

  describe("AC 3: Apply to Draft & Version Lock", () => {
    it("applies re-upload to draft atomically advancing version and storing roster document", async () => {
      const program = await createTestProgram(adminToken);
      const initialRows = [moneyRow({ nilai_idr: "500000" })];
      const draft = await prepareDraftProposal(amilToken, program.id, initialRows);

      const updatedRows = [
        moneyRow({
          id_penerima: draft.beneficiaries[0].id,
          id_baris: draft.aidLines[0].id,
          nilai_idr: "750000",
        }),
      ];
      const prevRes = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/preview`,
        {
          fileName: "update.csv",
          contentBase64: Buffer.from(buildCsvString(updatedRows)).toString(
            "base64",
          ),
        },
        amilToken,
      );
      const { preview } = await prevRes.json();

      const applyRes = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/apply`,
        {
          expectedVersion: draft.version,
          operationId: crypto.randomUUID(),
          previewId: preview.previewId,
          beneficiaries: preview.beneficiaries,
          aidLines: preview.aidLines,
          file: {
            fileName: "update.csv",
            mimeType: "text/csv",
            contentBase64: Buffer.from(buildCsvString(updatedRows)).toString(
              "base64",
            ),
          },
        },
        amilToken,
      );
      expect(applyRes.status).toBe(200);
      const applyData = await applyRes.json();
      expect(applyData.draft.version).toBe(draft.version + 1);
      expect(applyData.draft.aidLines[0].value.amountRequestedIdr).toBe("750000");
      expect(applyData.document).toBeDefined();
      expect(applyData.document.category).toBe("BENEFICIARY_ROSTER");
      expect(applyData.document.version).toBe(applyData.draft.version);

      // Verify stored document can be listed
      const docs = await disbursement.listProposalDocuments(SINAR, draft.id);
      const storedRoster = docs.find((d) => d.category === "BENEFICIARY_ROSTER" && d.version === applyData.draft.version);
      expect(storedRoster).toBeDefined();
      expect(storedRoster?.fileName).toBe("update.csv");
    });

    it("rejects apply with stale expectedVersion with 409 Conflict", async () => {
      const program = await createTestProgram(adminToken);
      const draft = await prepareDraftProposal(amilToken, program.id, [moneyRow()]);

      // Provide stale expectedVersion (draft.version + 99)
      const applyRes = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/apply`,
        {
          expectedVersion: draft.version + 99,
          operationId: crypto.randomUUID(),
          beneficiaries: draft.beneficiaries,
          aidLines: draft.aidLines,
        },
        amilToken,
      );
      expect(applyRes.status).toBe(409);
    });
  });

  describe("AC 4: Multi-Tenant and Capability Isolation", () => {
    it("returns 404 when rival institution tries to preview or apply on another institution's proposal", async () => {
      const program = await createTestProgram(adminToken);
      const draft = await prepareDraftProposal(amilToken, program.id, [moneyRow()]);

      const rivalPreview = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/preview`,
        {
          fileName: "rival.xlsx",
          contentBase64: buildXlsxBase64([moneyRow()]),
        },
        rivalToken,
      );
      expect(rivalPreview.status).toBe(404);

      const rivalApply = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/apply`,
        {
          expectedVersion: draft.version,
          operationId: crypto.randomUUID(),
          beneficiaries: draft.beneficiaries,
          aidLines: draft.aidLines,
        },
        rivalToken,
      );
      expect(rivalApply.status).toBe(404);
    });

    it("returns 403 when re-upload references foreign line or beneficiary IDs belonging to another institution", async () => {
      // 1. Create a proposal in Baitul to seed foreign IDs
      const rivalProg = await createTestProgram(adminBaitulToken, BAITUL);
      const rivalDraft = await prepareDraftProposal(rivalToken, rivalProg.id, [
        moneyRow({ nama: "Mustahik Baitul", id_penerima: "foreign-ben-99", id_baris: "foreign-aid-99" }),
      ]);
      const foreignLineId = rivalDraft.aidLines[0].id;

      // 2. In Sinar, try to upload a file with the foreign line ID
      const sinarProg = await createTestProgram(adminToken, SINAR);
      const sinarDraft = await prepareDraftProposal(amilToken, sinarProg.id, [moneyRow()]);

      const maliciousRows = [
        moneyRow({
          id_baris: foreignLineId,
          nama: "Penyusup Asing",
        }),
      ];
      const previewRes = await post(
        `${WORKSPACE}/proposals/${sinarDraft.id}/beneficiary-list/preview`,
        {
          fileName: "malicious.xlsx",
          contentBase64: buildXlsxBase64(maliciousRows),
        },
        amilToken,
      );
      expect(previewRes.status).toBe(403);
      expect((await previewRes.json()).error).toContain("milik lembaga lain");
    });

    it("returns 403 when user lacks PREPARE_PROPOSALS capability", async () => {
      const program = await createTestProgram(adminToken);
      const draft = await prepareDraftProposal(amilToken, program.id, [moneyRow()]);

      const readerPreview = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/preview`,
        { fileName: "test.xlsx", contentBase64: buildXlsxBase64([moneyRow()]) },
        readerToken,
      );
      expect(readerPreview.status).toBe(403);
    });
  });

  describe("Scenario 17 / AC 5, AC 6: Approved Proposal Re-upload, Revision Lifecycle & Floor Rule", () => {
    it("evaluates floor rule on approved proposal: prevents deleting or reducing realized lines below cumulative realization", async () => {
      const { draft } = await prepareApprovedProposalWithRealization({
        amilToken,
        examinerToken,
        approverToken,
        adminToken,
      });

      // aid-1 has Rp 400.000 realized (approved Rp 1.000.000)
      // aid-2 has 30 Kg realized (approved 50 Kg)

      // Attempt A: Reduce aid-1 to Rp 300.000 (< Rp 400.000 realized)
      const belowFloorRows = [
        moneyRow({ id_penerima: "ben-1", id_baris: "aid-1", nilai_idr: "300000" }),
        goodsRow({ id_penerima: "ben-2", id_baris: "aid-2", jumlah_barang: "50", satuan_barang: "Kg" }),
      ];

      // Preview should detect floor violation
      const prevRes = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/preview`,
        {
          fileName: "floor-violation.xlsx",
          contentBase64: buildXlsxBase64(belowFloorRows),
        },
        amilToken,
      );
      expect(prevRes.status).toBe(200);
      const { diff, preview } = await prevRes.json();
      expect(diff.floorVerdict?.ok).toBe(false);
      expect(diff.canApply).toBe(false);
      expect(diff.floorVerdict?.aidLineId).toBe("aid-1");
      expect(diff.floorVerdict?.error).toContain("tidak boleh turun di bawah realisasi");

      // Attempting to apply should be blocked with 409 Conflict
      const applyRes = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/apply`,
        {
          expectedVersion: draft.version,
          operationId: crypto.randomUUID(),
          reason: "Pengurangan alokasi yang melanggar floor",
          previewId: preview.previewId,
          beneficiaries: preview.beneficiaries,
          aidLines: preview.aidLines,
        },
        amilToken,
      );
      expect(applyRes.status).toBe(400);
      expect(preview.previewId).toBe("");

      // Attempt B: Removing aid-2 entirely (which has 30 Kg realized)
      const removeRealizedRows = [
        moneyRow({ id_penerima: "ben-1", id_baris: "aid-1", nilai_idr: "1000000" }),
      ];
      const prevRemove = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/preview`,
        {
          fileName: "remove-realized.xlsx",
          contentBase64: buildXlsxBase64(removeRealizedRows),
        },
        amilToken,
      );
      expect(prevRemove.status).toBe(200);
      const removeDiff = (await prevRemove.json()).diff;
      expect(removeDiff.floorVerdict?.ok).toBe(false);
      expect(removeDiff.canApply).toBe(false);
      expect(removeDiff.floorVerdict?.aidLineId).toBe("aid-2");
      expect(removeDiff.floorVerdict?.error).toContain("tidak dapat dihapus");
    });

    it("allows valid revision re-upload: routes through proposeRevision, holds changed lines, attaches document, preserves history", async () => {
      const { draft } = await prepareApprovedProposalWithRealization({
        amilToken,
        examinerToken,
        approverToken,
        adminToken,
      });

      // Valid update:
      // aid-1 modified to Rp 1.500.000 (>= Rp 400.000 realized) -> should be held
      // aid-2 remains 50 Kg (unchanged) -> should NOT be held
      // aid-3 added for new beneficiary
      const validRows = [
        moneyRow({ id_penerima: "ben-1", id_baris: "aid-1", nilai_idr: "1500000" }),
        goodsRow({ id_penerima: "ben-2", id_baris: "aid-2", jumlah_barang: "50", satuan_barang: "Kg" }),
        moneyRow({ nama: "Mustahik Baru Tiga", nik: "3201010101800099", nilai_idr: "800000" }),
      ];

      const prevRes = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/preview`,
        {
          fileName: "valid-revision.xlsx",
          contentBase64: buildXlsxBase64(validRows),
        },
        amilToken,
      );
      expect(prevRes.status).toBe(200);
      const { diff, preview } = await prevRes.json();
      expect(diff.floorVerdict?.ok).toBe(true);
      expect(diff.canApply).toBe(true);

      // Re-upload on APPROVED proposal requires `reason`
      const noReasonRes = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/apply`,
        {
          expectedVersion: draft.version,
          operationId: crypto.randomUUID(),
          previewId: preview.previewId,
          beneficiaries: preview.beneficiaries,
          aidLines: preview.aidLines,
        },
        amilToken,
      );
      expect(noReasonRes.status).toBe(400);

      const applyPayload = {
          expectedVersion: draft.version,
          operationId: crypto.randomUUID(),
          reason: "Kenaikan santunan aid-1 dan penambahan mustahik tiga",
          previewId: preview.previewId,
          beneficiaries: preview.beneficiaries,
          aidLines: preview.aidLines,
          file: {
            fileName: "valid-revision.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            contentBase64: buildXlsxBase64(validRows),
          },
        };
      const validApply = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/apply`,
        applyPayload,
        amilToken,
      );
      expect(validApply.status).toBe(201);
      const appliedJson = await validApply.json();
      expect(appliedJson.revision).toBeDefined();
      expect(appliedJson.revision.heldAidLineIds).toContain("aid-1");
      expect(appliedJson.revision.heldAidLineIds).not.toContain("aid-2");

      // Verify old realizations remain intact
      const realizations = await disbursement.getProposalRealizations(SINAR, draft.id);
      expect(realizations.length).toBe(2);
      expect(realizations.find((r) => r.aidLineId === "aid-1")?.amountIdr).toBe("400000");

      // Verify roster document attached to revision version
      expect(appliedJson.document).toBeDefined();
      expect(appliedJson.document.version).toBe(appliedJson.revision.toVersion);
      const retry = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/apply`,
        applyPayload,
        amilToken,
      );
      expect(retry.status).toBe(201);
      expect((await retry.json()).document.id).toBe(appliedJson.document.id);
      const documents = await disbursement.listProposalDocuments(SINAR, draft.id);
      expect(documents.filter(doc => doc.version === appliedJson.revision.toVersion)).toHaveLength(1);

    });
  });

  describe("Pilot amendment & Database Restart Durability", () => {
    it("tracks private contact diff and survives database restart intact", async () => {
      const program = await createTestProgram(adminToken);
      const initialRows = [
        moneyRow({
          nama: "Mustahik Kontak",
          nik: "3201010101809999",
          kontak_telepon: "081111111111",
          kontak_relasi: "Pribadi",
        }),
      ];
      const draft = await prepareDraftProposal(amilToken, program.id, initialRows);

      const modifiedRows = [
        moneyRow({
          id_penerima: draft.beneficiaries[0].id,
          id_baris: draft.aidLines[0].id,
          nama: "Mustahik Kontak",
          nik: "3201010101809999",
          kontak_telepon: "082222222222",
          kontak_email: "mustahik@example.org",
          kontak_relasi: "Kepala Keluarga",
        }),
      ];

      const prevRes = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/preview`,
        {
          fileName: "kontak.xlsx",
          contentBase64: buildXlsxBase64(modifiedRows),
        },
        amilToken,
      );
      const { diff, preview } = await prevRes.json();
      const mod = diff.rowDetails.find((r: any) => r.status === "MODIFIED");
      expect(mod).toBeDefined();
      expect(mod.changes.some((c: any) => c.field === "contact")).toBe(true);

      const applyRes = await post(
        `${WORKSPACE}/proposals/${draft.id}/beneficiary-list/apply`,
        {
          expectedVersion: draft.version,
          operationId: crypto.randomUUID(),
          previewId: preview.previewId,
          beneficiaries: preview.beneficiaries,
          aidLines: preview.aidLines,
          file: {
            fileName: "kontak.xlsx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            contentBase64: buildXlsxBase64(modifiedRows),
          },
        },
        amilToken,
      );
      expect(applyRes.status).toBe(200);

      // Reopen database to verify durability
      await database.reopen();
      store = createWorkspaceStore(database.handle());
      disbursement = createDisbursementStore(database.handle() as never);
      activities = createActivityStore(database.handle() as never);
      configure();

      const reloadedDraft = await disbursement.getProposalDraft(SINAR, draft.id);
      expect(reloadedDraft?.beneficiaries[0].contact?.phone).toBe("082222222222");
      expect(reloadedDraft?.beneficiaries[0].contact?.email).toBe("mustahik@example.org");
      expect(reloadedDraft?.beneficiaries[0].contact?.relation).toBe("Kepala Keluarga");

      const reloadedDocs = await disbursement.listProposalDocuments(SINAR, draft.id);
      expect(reloadedDocs.some((d) => d.fileName === "kontak.xlsx")).toBe(true);
    });
  });

  it("binds reviewed rows, source, account and base version; recovers a durable result before retry", async () => {
    const program = await createTestProgram(adminToken);
    const draft = await prepareDraftProposal(amilToken, program.id, [moneyRow()]);
    const source = { fileName: "bound.csv", contentBase64: Buffer.from(buildCsvString([
      moneyRow({ id_penerima: draft.beneficiaries[0].id, id_baris: draft.aidLines[0].id, nilai_idr: "1200000" }),
    ])).toString("base64") };
    const preview = await (
      await post(
        `/proposals/${draft.id}/beneficiary-list/preview`,
        source,
        amilToken,
      )
    ).json();
    const input = { previewId: preview.previewId, expectedVersion: draft.version, operationId: crypto.randomUUID() };
    const resultPath = `/proposals/${draft.id}/beneficiary-list/result`;
    expect((await (await post(resultPath, input, amilToken)).json()).pending).toBe(true);
    expect(
      (
        await post(
          `/proposals/${draft.id}/beneficiary-list/apply`,
          { ...input, beneficiaries: [] },
          amilToken,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          `/proposals/${draft.id}/beneficiary-list/apply`,
          {
            ...input,
            file: {
              ...source,
              contentBase64: Buffer.from("tampered").toString("base64"),
            },
          },
          amilToken,
        )
      ).status,
    ).toBe(400);
    const other = await prepareDraftProposal(amilToken, program.id, [goodsRow()]);
    expect(
      (
        await post(
          `/proposals/${other.id}/beneficiary-list/apply`,
          { ...input, expectedVersion: other.version },
          amilToken,
        )
      ).status,
    ).toBe(400);
    await database.reopen();
    store = createWorkspaceStore(database.handle());
    disbursement = createDisbursementStore(database.handle() as never);
    activities = createActivityStore(database.handle() as never);
    configure();
    const applied = await post(
      `/proposals/${draft.id}/beneficiary-list/apply`,
      input,
      amilToken,
    );
    expect(applied.status).toBe(200);
    const saved = await applied.json();
    expect(saved.draft.aidLines[0].value.amountRequestedIdr).toBe("1200000");
    const durable = await (await post(resultPath, input, amilToken)).json();
    expect(durable).toEqual(saved);
    expect(JSON.stringify(durable)).not.toContain("storageRef");
    expect((await post(resultPath, input, rivalToken)).status).toBe(404);
    expect((await post(resultPath, { ...input, reason: "changed" }, amilToken)).status).toBe(409);
    expect(
      (
        await post(
          `/proposals/${draft.id}/beneficiary-list/apply`,
          { ...input, operationId: crypto.randomUUID() },
          amilToken,
        )
      ).status,
    ).toBe(409);
  });

  it("compares stable IDs independently of array order and notices payment recipient reassignment", async () => {
    const program = await createTestProgram(adminToken);
    const draft = await prepareDraftProposal(amilToken, program.id, [moneyRow(), goodsRow()]);
    const rows = [
      goodsRow({ id_penerima: draft.beneficiaries[1].id, id_baris: draft.aidLines[1].id }),
      moneyRow({ id_penerima: draft.beneficiaries[0].id, id_baris: draft.aidLines[0].id }),
    ];
    const preview = async (input: SheetRow[]) =>
      await (
        await post(
          `/proposals/${draft.id}/beneficiary-list/preview`,
          {
            fileName: "rows.csv",
            contentBase64: Buffer.from(buildCsvString(input)).toString(
              "base64",
            ),
          },
          amilToken,
        )
      ).json();
    expect((await preview(rows)).diff.isIdentical).toBe(true);
    // Both aid lines now belong to the second beneficiary; only stable links decide this change.
    rows[1] = moneyRow({ ...goodsRow(), jenis_bantuan: "UANG", jumlah_barang: "", satuan_barang: "", nilai_idr_barang: "", dasar_valuasi_barang: "",
      nama_bantuan: "Bantuan Tunai Pendidikan", nilai_idr: "1000000", referensi_bukti: "BUKTI-001",
      id_penerima: draft.beneficiaries[1].id, id_baris: draft.aidLines[0].id });
    const changed = await preview(rows);
    expect(changed.diff.isIdentical).toBe(false);
    expect(changed.diff.rowDetails.find((row: any) => row.aidLineId === draft.aidLines[0].id).status).toBe("MODIFIED");
    const applied = await post(
      `/proposals/${draft.id}/beneficiary-list/apply`,
      {
        previewId: changed.previewId,
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
      },
      amilToken,
    );
    expect(applied.status).toBe(200);
    expect((await applied.json()).draft.aidLines.find((line: any) => line.id === draft.aidLines[0].id).beneficiaryId).toBe(draft.beneficiaries[1].id);
  });

  it("keeps invalid source rows visible without presenting parse failures as deletions, warns about missing IDs", async () => {
    const program = await createTestProgram(adminToken);
    const draft = await prepareDraftProposal(amilToken, program.id, [moneyRow()]);
    const invalid = await (
      await post(
        `/proposals/${draft.id}/beneficiary-list/preview`,
        {
          fileName: "invalid.csv",
          contentBase64: Buffer.from(
            buildCsvString([
              moneyRow({
                id_penerima: draft.beneficiaries[0].id,
                id_baris: draft.aidLines[0].id,
                nilai_idr: "wrong",
              }),
            ]),
          ).toString("base64"),
        },
        amilToken,
      )
    ).json();
    expect(invalid.diff.canApply).toBe(false);
    expect(invalid.diff.aidLineCounts.removed).toBe(0);
    expect(invalid.diff.rowDetails.some((row: any) => row.status === "REMOVED")).toBe(false);
    expect(invalid.preview.allRowsPreview).toHaveLength(1);
    expect(invalid.preview.issues.length).toBeGreaterThan(0);
    const source = { fileName: "missing.csv", contentBase64: Buffer.from(buildCsvString([moneyRow({ nilai_idr: "1500000" })])).toString("base64") };
    const first = await (
      await post(
        `/proposals/${draft.id}/beneficiary-list/preview`,
        source,
        amilToken,
      )
    ).json();
    const repeat = await (
      await post(
        `/proposals/${draft.id}/beneficiary-list/preview`,
        source,
        amilToken,
      )
    ).json();
    expect(first.warnings.join(" ")).toContain("tanpa id_baris/id_penerima");
    expect(first.preview.beneficiaries).toEqual(repeat.preview.beneficiaries);
    expect(first.preview.aidLines).toEqual(repeat.preview.aidLines);
  });

  it("refuses IDs from another proposal in the same institution without matching arbitrary field values", async () => {
    const program = await createTestProgram(adminToken);
    const original = await prepareDraftProposal(amilToken, program.id, [moneyRow()]);
    const draft = await prepareDraftProposal(amilToken, program.id, [goodsRow()]);
    const preview = (id: string) =>
      post(
        `/proposals/${draft.id}/beneficiary-list/preview`,
        {
          fileName: "ids.csv",
          contentBase64: Buffer.from(
            buildCsvString([
              moneyRow({ id_penerima: id, id_baris: "new-line" }),
            ]),
          ).toString("base64"),
        },
        amilToken,
      );
    expect((await preview(original.beneficiaries[0].id)).status).toBe(403);
    expect((await preview(original.beneficiaries[0].name)).status).toBe(200);
  });

  it("does not inherit approvals when the identity or contact behind a stable line changes", async () => {
    const { draft } = await prepareApprovedProposalWithRealization({ amilToken, examinerToken, approverToken, adminToken });
    const result = await (
      await post(
        `/proposals/${draft.id}/beneficiary-list/preview`,
        {
          fileName: "identity.csv",
          contentBase64: Buffer.from(
            buildCsvString([
              moneyRow({
                id_penerima: "ben-1",
                id_baris: "aid-1",
                nama: "Penerima Pengganti",
                nik: "3201010101809999",
                kontak_telepon: "089999999999",
              }),
              goodsRow({ id_penerima: "ben-2", id_baris: "aid-2" }),
            ]),
          ).toString("base64"),
        },
        amilToken,
      )
    ).json();
    expect(result.preview.aidLines[0].value.amountApprovedIdr).toBeNull();
    expect(result.diff.heldAidLineIds).toContain("aid-1");
    const rendered = JSON.stringify(result.diff.rowDetails);
    expect(rendered).not.toContain("3201010101809999");
    expect(rendered).not.toContain("089999999999");
    expect(result.diff.rowDetails[0].changes.some((change: any) => change.field === "identityBasis")).toBe(true);
  });

  it("preserves frozen sources, OTP confirmation and operational costs through a roster revision", async () => {
    const { draft } = await prepareApprovedProposalWithRealization({ amilToken, examinerToken, approverToken, adminToken });
    const events = await disbursement.getProposalRealizations(SINAR, draft.id);
    const cash = events.find(event => event.aidLineId === "aid-1")!;
    const issued = await post(`/proposals/${draft.id}/realizations/${cash.id}/otp-challenge`, { recipientContact: "081234567890" }, amilToken);
    expect(issued.status).toBe(201);
    const { nonce } = await issued.json();
    const otpCode = /kode (\d{6})/.exec(outbox.at(-1)?.body ?? "")?.[1];
    expect(otpCode).toBeDefined();
    expect((await post(`/proposals/${draft.id}/realizations/${cash.id}/otp-verify`, { nonce, otpCode }, amilToken)).status).toBe(200);
    const expense = await post(`/proposals/${draft.id}/expenses`, { operationId: crypto.randomUUID(), amountIdr: "50000", purpose: "Transport", payee: "Relawan", documentRef: "KW-97", advanceId: null }, amilToken);
    expect(expense.status).toBe(201);
    const frozenVersion = await (await get(`/proposals/${draft.id}/versions/${draft.version}`, amilToken)).json();
    const period = { kind: "AKHIR_TAHUN", year: 2026 };
    const side = { manifest: { label: `Realisasi ${draft.id} versi ${draft.version}`, origin: "PASTE", scopeUnit: "Lembaga", scopeLevel: "KAB_KOTA", fundTypes: ["ZAKAT"], balanceSheet: "ON", currencyUnit: "IDR", period, cutOff: "2026-09-18T00:00:00.000Z", format: "baris-ledger", mappingVersion: "1", transactionDetail: "PRESENT" },
      rows: [{ key: cash.id, label: `${draft.id}/${draft.version}/aid-1`, bucket: "ZAKAT", balanceSheet: "ON", value: { amount: "400000", unit: "IDR" } }] };
    const freeze = await post("http://localhost:3001/api/evidence", { label: "Snapshot realisasi awal", period, currencyUnit: "IDR", balanceSheetScope: "ON", claim: side, source: side }, amilToken);
    expect(freeze.status).toBe(201);
    const frozenId = (await freeze.json()).preparation.id;
    const frozen = await (await get(`http://localhost:3001/api/evidence/${frozenId}`, amilToken)).json();
    const tables = ["disbursement_realizations", "disbursement_realization_challenges", "disbursement_realization_expenses", "contributions", "contribution_allocations"];
    const before = await Promise.all(tables.map(async table => {
      const result: any = await database.handle().execute(sql`SELECT * FROM ${sql.identifier(table)}`);
      return result.rows ?? result;
    }));
    const source = { fileName: "contact-and-goods.csv", contentBase64: Buffer.from(buildCsvString([
      moneyRow({ id_penerima: "ben-1", id_baris: "aid-1", kontak_telepon: "089999999999" }),
      goodsRow({ id_penerima: "ben-2", id_baris: "aid-2", jumlah_barang: "60", dasar_valuasi_barang: "Penawaran baru" }),
    ])).toString("base64") };
    const preview = await (
      await post(
        `/proposals/${draft.id}/beneficiary-list/preview`,
        source,
        amilToken,
      )
    ).json();
    expect(preview.diff.canApply).toBe(true);
    const applied = await post(
      `/proposals/${draft.id}/beneficiary-list/apply`,
      {
        previewId: preview.previewId,
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
        reason: "Kontak dan barang diperbaiki",
      },
      amilToken,
    );
    expect(applied.status).toBe(201);
    const revision = (await applied.json()).revision;
    expect(revision.beneficiaries[0].contact.phone).toBe("089999999999");
    expect(JSON.stringify(revision.beneficiaries)).not.toContain("confirmation");
    const after = await Promise.all(tables.map(async table => {
      const result: any = await database.handle().execute(sql`SELECT * FROM ${sql.identifier(table)}`);
      return result.rows ?? result;
    }));
    expect(after).toEqual(before);
    expect((await disbursement.getProposalRealizations(SINAR, draft.id)).find(event => event.id === cash.id)).toMatchObject({ confirmationStatus: "CONFIRMED", confirmationMethod: "OTP", proposalVersion: draft.version });
    expect(await (await get(`/proposals/${draft.id}/versions/${draft.version}`, amilToken)).json()).toEqual(frozenVersion);
    expect(await (await get(`http://localhost:3001/api/evidence/${frozenId}`, amilToken)).json()).toEqual(frozen);
    expect((await post(`/proposals/${draft.id}/realizations/${cash.id}/otp-verify`, { nonce, otpCode }, amilToken)).status).toBe(401);
  });

  it("restricts applied source downloads to authorized institution readers", async () => {
    const program = await createTestProgram(adminToken);
    const draft = await prepareDraftProposal(amilToken, program.id, [
      moneyRow(),
    ]);
    const source = buildCsvString([
      moneyRow({
        id_penerima: draft.beneficiaries[0].id,
        id_baris: draft.aidLines[0].id,
        nilai_idr: "1600000",
      }),
    ]);
    const preview = await (
      await post(
        `/proposals/${draft.id}/beneficiary-list/preview`,
        {
          fileName: "restricted.csv",
          contentBase64: Buffer.from(source).toString("base64"),
        },
        amilToken,
      )
    ).json();
    expect(
      (
        await get(
          `/proposals/${draft.id}/files/doc-${preview.previewId}`,
          amilToken,
        )
      ).status,
    ).toBe(404);
    const response = await post(
      `/proposals/${draft.id}/beneficiary-list/apply`,
      {
        previewId: preview.previewId,
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
      },
      amilToken,
    );
    expect(response.status).toBe(200);
    const { document } = await response.json();
    for (const token of [amilToken, examinerToken, approverToken]) {
      const download = await get(
        `/proposals/${draft.id}/files/${document.id}`,
        token,
      );
      expect(download.status).toBe(200);
      expect(await download.text()).toBe(source);
    }
    expect(
      (await get(`/proposals/${draft.id}/files/${document.id}`, readerToken))
        .status,
    ).toBe(403);
    expect(
      (await get(`/proposals/${draft.id}/files/${document.id}`)).status,
    ).toBe(401);
    expect(
      (await get(`/proposals/${draft.id}/files/${document.id}`, rivalToken))
        .status,
    ).toBe(404);
    expect(
      await disbursement.getProposalBeneficiaryListPreview(
        {
          institutionId: SINAR,
          proposalId: draft.id,
          account: amilSinarAccount.address.toLowerCase(),
        },
        preview.previewId,
        clock,
      ),
    ).toBeNull();
  });

  it("rejects identifiers that exist only in another proposal's revision", async () => {
    const { draft } = await prepareApprovedProposalWithRealization({
      amilToken,
      examinerToken,
      approverToken,
      adminToken,
    });
    const preview = await (
      await post(
        `/proposals/${draft.id}/beneficiary-list/preview`,
        {
          fileName: "new-person.csv",
          contentBase64: Buffer.from(
            buildCsvString([
              moneyRow({ id_penerima: "ben-1", id_baris: "aid-1" }),
              goodsRow({ id_penerima: "ben-2", id_baris: "aid-2" }),
              moneyRow({
                id_penerima: "revision-only-person",
                id_baris: "revision-only-line",
                nama: "Penerima Baru",
                nik: "3201010101800003",
              }),
            ]),
          ).toString("base64"),
        },
        amilToken,
      )
    ).json();
    expect(
      (
        await post(
          `/proposals/${draft.id}/beneficiary-list/apply`,
          {
            previewId: preview.previewId,
            expectedVersion: draft.version,
            operationId: crypto.randomUUID(),
            reason: "Tambahan penerima",
          },
          amilToken,
        )
      ).status,
    ).toBe(201);
    const program = await createTestProgram(adminToken);
    const other = await prepareDraftProposal(amilToken, program.id, [
      moneyRow(),
    ]);
    expect(
      (
        await post(
          `/proposals/${other.id}/beneficiary-list/preview`,
          {
            fileName: "copied.csv",
            contentBase64: Buffer.from(
              buildCsvString([
                moneyRow({
                  id_penerima: "revision-only-person",
                  id_baris: "revision-only-line",
                  nama: "Penerima Baru",
                  nik: "3201010101800003",
                }),
              ]),
            ).toString("base64"),
          },
          amilToken,
        )
      ).status,
    ).toBe(403);
  });

  it("migrates legacy plaintext previews and prunes only uncommitted source files", async () => {
    const program = await createTestProgram(adminToken);
    const draft = await prepareDraftProposal(amilToken, program.id, [
      moneyRow(),
    ]);
    const committed = (
      await disbursement.listProposalDocuments(SINAR, draft.id)
    )[0]!;
    const original = await files.get(committed.storageRef!);
    const abandoned = await files.put({
      institutionId: SINAR,
      preparationId: draft.id,
      fileId: crypto.randomUUID(),
      bytes: Buffer.from("abandoned private source"),
    });
    await database
      .handle()
      .execute(
        sql`CREATE TABLE proposal_roster_previews (payload_json TEXT NOT NULL)`,
      );
    for (const storageRef of [committed.storageRef, abandoned.storageRef]) {
      await database
        .handle()
        .execute(
          sql`INSERT INTO proposal_roster_previews VALUES (${JSON.stringify({ document: { storageRef }, beneficiaries: [{ name: "Legacy private recipient" }] })})`,
        );
    }
    await disbursement.ensureSchema();
    await disbursement.ensureSchema();
    await pruneProposalPreviews(disbursement, files, clock);
    expect(await files.get(abandoned.storageRef)).toBeNull();
    expect(await files.get(committed.storageRef!)).toEqual(original);
    expect(await database.rowCount("proposal_preview_file_cleanup")).toBe(0);
    const result: any = await database
      .handle()
      .execute(sql`SELECT to_regclass('proposal_roster_previews') AS legacy`);
    expect((result.rows ?? result)[0].legacy).toBeNull();
  });

  it("cleans encrypted temporary files left by an interrupted source write", async () => {
    const source = await files.put({ institutionId: SINAR, preparationId: "interrupted", fileId: crypto.randomUUID(), bytes: Buffer.from("private source") });
    const temporary = `${source.storageRef}.${"ab".repeat(12)}.tmp`;
    await disbursement.queueUncommittedProposalFile(source.storageRef, clock);
    // Simulate a process dying after its encrypted temporary write, before rename.
    await rename(source.storageRef, temporary);
    clock += 1801;
    await pruneProposalPreviews(disbursement, files, clock);
    expect(await access(temporary).then(() => true, () => false)).toBe(false);
    expect(await database.rowCount("proposal_preview_file_cleanup")).toBe(0);
  });

  it("expires abandoned previews without retaining plaintext recipients or creating source blobs", async () => {
    const program = await createTestProgram(adminToken);
    const draft = await prepareDraftProposal(amilToken, program.id, [
      moneyRow(),
    ]);
    const beforeFiles = (await readdir(tempDir, { recursive: true })).sort();
    const preview = await (
      await post(
        `/proposals/${draft.id}/beneficiary-list/preview`,
        {
          fileName: "private.csv",
          contentBase64: Buffer.from(
            buildCsvString([
              moneyRow({
                id_penerima: draft.beneficiaries[0].id,
                id_baris: draft.aidLines[0].id,
                nama: "Rahasia Pratinjau",
                nilai_idr: "1500000",
              }),
            ]),
          ).toString("base64"),
        },
        amilToken,
      )
    ).json();
    const rows: any = await database
      .handle()
      .execute(
        sql`SELECT * FROM proposal_beneficiary_list_previews WHERE id = ${preview.previewId}`,
      );
    expect(JSON.stringify(rows.rows ?? rows)).not.toContain(
      "Rahasia Pratinjau",
    );
    expect((await readdir(tempDir, { recursive: true })).sort()).toEqual(
      beforeFiles,
    );
    clock += 1801;
    const applied = await post(
      `/proposals/${draft.id}/beneficiary-list/apply`,
      {
        previewId: preview.previewId,
        expectedVersion: draft.version,
        operationId: crypto.randomUUID(),
      },
      amilToken,
    );
    expect(applied.status).toBe(400);
    await pruneProposalPreviews(disbursement, files, clock);
    expect(await database.rowCount("proposal_beneficiary_list_previews")).toBe(
      0,
    );
    expect(
      (await disbursement.getProposalDraft(SINAR, draft.id))!.version,
    ).toBe(draft.version);
  });

  it("acknowledges identical files without new versions, revisions or source documents", async () => {
    const program = await createTestProgram(adminToken);
    const editable = await prepareDraftProposal(amilToken, program.id, [moneyRow()]);
    const approved = (await prepareApprovedProposalWithRealization({ amilToken, examinerToken, approverToken, adminToken })).draft;
    for (const draft of [editable, approved]) {
      const documentsBefore = await disbursement.listProposalDocuments(SINAR, draft.id);
      const rows = draft.status === "APPROVED" ? [moneyRow({ id_penerima: "ben-1", id_baris: "aid-1" }), goodsRow({ id_penerima: "ben-2", id_baris: "aid-2" })]
        : [moneyRow({ id_penerima: draft.beneficiaries[0].id, id_baris: draft.aidLines[0].id })];
      const preview = await (
        await post(
          `/proposals/${draft.id}/beneficiary-list/preview`,
          {
            fileName: "unchanged.csv",
            contentBase64: Buffer.from(buildCsvString(rows)).toString("base64"),
          },
          amilToken,
        )
      ).json();
      expect(preview.diff.isIdentical).toBe(true);
      const input = { previewId: preview.previewId, expectedVersion: draft.version, operationId: crypto.randomUUID() };
      const applied = await post(
        `/proposals/${draft.id}/beneficiary-list/apply`,
        input,
        amilToken,
      );
      expect(applied.status).toBe(200);
      const result = await applied.json();
      expect(result.draft).toEqual(draft);
      expect(result.revision).toBeUndefined();
      expect(await disbursement.listProposalDocuments(SINAR, draft.id)).toEqual(documentsBefore);
      expect(await disbursement.getProposalRevisions(SINAR, draft.id)).toHaveLength(0);
      expect(
        await (
          await get(
            `/proposals/${draft.id}/beneficiary-list/result?operationId=${input.operationId}`,
            amilToken,
          )
        ).json(),
      ).toEqual(result);
      expect(
        (
          await get(
            `/proposals/${draft.id}/beneficiary-list/result?operationId=${input.operationId}`,
            readerToken,
          )
        ).status,
      ).toBe(403);
    }
  });

  it("rolls back the revision and operation ledger when the source document cannot commit", async () => {
    const { draft } = await prepareApprovedProposalWithRealization({ amilToken, examinerToken, approverToken, adminToken });
    const preview = await (
      await post(
        `/proposals/${draft.id}/beneficiary-list/preview`,
        {
          fileName: "rollback.csv",
          contentBase64: Buffer.from(
            buildCsvString([
              moneyRow({
                id_penerima: "ben-1",
                id_baris: "aid-1",
                nilai_idr: "1500000",
              }),
              goodsRow({ id_penerima: "ben-2", id_baris: "aid-2" }),
            ]),
          ).toString("base64"),
        },
        amilToken,
      )
    ).json();
    const input = { previewId: preview.previewId, expectedVersion: draft.version, operationId: crypto.randomUUID(), reason: "Atomic source" };
    // An actual SQL constraint failure at document insertion must undo all earlier writes.
    await database.handle().execute(sql.raw("ALTER TABLE proposal_documents ADD CONSTRAINT reject_test_source CHECK (file_name <> 'rollback.csv')"));
    try {
      expect(
        (
          await post(
            `/proposals/${draft.id}/beneficiary-list/apply`,
            input,
            amilToken,
          )
        ).status,
      ).toBe(500);
      expect(await disbursement.getProposalRevisions(SINAR, draft.id)).toHaveLength(0);
      expect((await disbursement.getProposalDraft(SINAR, draft.id))!.activeRevisionId).toBeNull();
      expect(
        (
          await (
            await post(
              `/proposals/${draft.id}/beneficiary-list/result`,
              input,
              amilToken,
            )
          ).json()
        ).pending,
      ).toBe(true);
    } finally {
      await database.handle().execute(sql.raw("ALTER TABLE proposal_documents DROP CONSTRAINT reject_test_source"));
    }
    const saved = await post(
      `/proposals/${draft.id}/beneficiary-list/apply`,
      input,
      amilToken,
    );
    expect(saved.status).toBe(201);
    const { document } = await saved.json();
    expect(await database.rowCount("proposal_preview_file_cleanup")).toBe(1);
    clock += 1801;
    await pruneProposalPreviews(disbursement, files, clock);
    expect(await database.rowCount("proposal_preview_file_cleanup")).toBe(0);
    expect(
      (await get(`/proposals/${draft.id}/files/${document.id}`, amilToken))
        .status,
    ).toBe(200);
  });

  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)(
    "browser: inspect diff, explicitly apply, recover lost response, reject stale preview and show revision history",
    async () => {
      const program = await createTestProgram(adminToken);
      const editable = await prepareDraftProposal(amilToken, program.id, [moneyRow()]);
      const approved = (await prepareApprovedProposalWithRealization({ amilToken, examinerToken, approverToken, adminToken })).draft;
      let selected = editable;
      const build = Bun.spawn(["bun", "build", new URL("../../frontend/test/proposal-beneficiary-list-smoke.tsx", import.meta.url).pathname, "--target", "browser"], { stdout: "pipe", stderr: "pipe" });
      const bundle = await new Response(build.stdout).text();
      if (await build.exited !== 0) throw new Error(await new Response(build.stderr).text());
      const cssBuild = Bun.spawn(
        [
          "bun",
          new URL("../../frontend/test/build-smoke-css.ts", import.meta.url)
            .pathname,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const css = await new Response(cssBuild.stdout).text();
      if ((await cssBuild.exited) !== 0)
        throw new Error(await new Response(cssBuild.stderr).text());
      const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/")
          return new Response(
            '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/smoke.css"><div id="root"></div><script type="module" src="/smoke.js"></script>',
            { headers: { "Content-Type": "text/html" } },
          );
        if (path === "/smoke.css")
          return new Response(css, { headers: { "Content-Type": "text/css" } });
        if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
        if (path === "/bootstrap") return Response.json({ draft: selected, account: amilSinarAccount.address, otherAccount: rivalOfficerAccount.address, institutionId: SINAR, now: clock });
        if (path === "/sign") return Response.json({ signature: await amilSinarAccount.signTypedData(signable(await req.json())) });
        return app.fetch(req);
      } });
      const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
      const browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
      try {
        const page = await browser.newPage({
          viewport: { width: 390, height: 844 },
        });
        page.setDefaultTimeout(10000);
        page.on("pageerror", (error: Error) => console.error(error));
        const open = async () => { await page.goto(server.url.toString()); await page.getByRole("button", { name: "Perbarui daftar penerima dari berkas" }).click(); };
        const upload = async (rows: SheetRow[]) => page.getByLabel("Berkas daftar penerima", { exact: true }).setInputFiles({ name: "browser.csv", mimeType: "text/csv", buffer: Buffer.from(buildCsvString(rows)) });
        await open();
        const rows = [moneyRow({ id_penerima: editable.beneficiaries[0].id, id_baris: editable.aidLines[0].id, nilai_idr: "1300000" })];
        await upload(rows);
        await page.getByText("~1 Baris Diubah (0 Penerima)", { exact: true }).waitFor();
        expect((await disbursement.getProposalDraft(SINAR, editable.id))!.version).toBe(editable.version);
        const dialogBox = await page.getByRole("dialog").boundingBox();
        expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
        expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(390);
        expect(
          await page
            .getByRole("dialog")
            .evaluate(
              (node: HTMLElement) => node.scrollWidth <= node.clientWidth,
            ),
        ).toBe(true);
        // Let the real server commit, then lose the response at the transport boundary.
        await page.route(
          "**/beneficiary-list/apply",
          async (route: any) => {
            await route.fetch();
            await route.abort("failed");
          },
          { times: 1 },
        );
        await page
          .getByRole("button", { name: "Terapkan Perubahan ke Draf" })
          .focus();
        await page.keyboard.press("Enter");
        await page.getByText(/Hasil penyimpanan belum diketahui/).waitFor();
        await page.getByRole("button", { name: "Batal", exact: true }).click();
        const recovered = page.waitForResponse((response: any) =>
          new URL(response.url()).pathname.endsWith("/beneficiary-list/result"),
        );
        await page.getByRole("button", { name: "Perbarui daftar penerima dari berkas" }).click();
        expect((await recovered).status()).toBe(200);
        await page.getByRole("dialog").waitFor({ state: "detached" });
        expect((await disbursement.getProposalDraft(SINAR, editable.id))!.version).toBe(editable.version + 1);
        selected = (await disbursement.getProposalDraft(SINAR, editable.id))!;
        await open();
        rows[0]!.nilai_idr = "1400000";
        await upload(rows);
        await page.getByText("~1 Baris Diubah (0 Penerima)", { exact: true }).waitFor();
        const concurrent = await post("/proposals", { ...selected, expectedVersion: selected.version, operationId: crypto.randomUUID(), purpose: "Edit bersamaan" }, amilToken);
        expect(concurrent.status).toBe(200);
        await page.getByRole("button", { name: "Terapkan Perubahan ke Draf" }).click();
        await page.getByRole("alert").filter({ hasText: /berubah|versi/i }).waitFor();
        selected = approved;
        await open();
        await upload([moneyRow({ id_penerima: "ben-1", id_baris: "aid-1", nilai_idr: "300000" }), goodsRow({ id_penerima: "ben-2", id_baris: "aid-2" })]);
        await page.getByText("Perubahan bertentangan dengan realisasi tercatat", { exact: true }).waitFor();
        expect(await page.getByRole("button", { name: "Ajukan Revisi dari Berkas" }).isDisabled()).toBe(true);
        await upload([moneyRow({ id_penerima: "ben-1", id_baris: "aid-1", nilai_idr: "1500000" }), goodsRow({ id_penerima: "ben-2", id_baris: "aid-2" })]);
        await page.getByText("~1 Baris Diubah (0 Penerima)", { exact: true }).waitFor();
        await page.getByLabel("Alasan Pengajuan Revisi *").fill("Penyesuaian dari berkas browser");
        await page.getByRole("button", { name: "Ajukan Revisi dari Berkas" }).click();
        await page.getByRole("dialog").waitFor({ state: "detached" });
        await page.getByText("Menunggu Pemeriksaan", { exact: true }).waitFor();
        expect(await disbursement.getProposalRevisions(SINAR, approved.id)).toHaveLength(1);
        await page
          .locator("summary")
          .filter({ hasText: "Riwayat revisi pengajuan" })
          .focus();
        await page.keyboard.press("Enter");
        const history = page.getByRole("list", {
          name: "Riwayat revisi pengajuan",
        });
        await history
          .getByText("Penyesuaian dari berkas browser", { exact: true })
          .waitFor();
        expect(await history.getByRole("listitem").count()).toBe(1);
        // A response from the old access context may never reopen private UI.
        await page.getByRole("button", { name: "Perbarui daftar penerima dari berkas" }).click();
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let started!: () => void;
        const arrival = new Promise<void>(resolve => { started = resolve; });
        await page.route("**/beneficiary-list/preview", async (route: any) => {
          const response = await route.fetch();
          started();
          await gate;
          await route.fulfill({ response });
        });
        await upload(rows);
        await arrival;
        // Simulate the session owner's account event while the modal is open.
        await page.getByRole("button", { name: "Ganti akun", exact: true, includeHidden: true }).dispatchEvent("click");
        release();
        await page.getByText("Akun berganti", { exact: true }).waitFor();
        expect(await page.getByRole("dialog").count()).toBe(0);
      } finally { await browser.close(); server.stop(true); }
    }, 60000
  );

});

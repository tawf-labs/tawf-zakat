/**
 * Integration tests for Dokumen pengajuan dan pemeriksaan kelayakan
 * (Spec #86, ticket #91).
 *
 * Covers:
 * 1. Completeness Gate: missing fields and missing required documents per policy.
 * 2. Structural alternative identity accepted & human review enforced.
 * 3. Recurring aid detection warnings & exception recording.
 * 4. Full lifecycle: submit -> start examination -> return for revision -> revision queue -> amil resubmit -> mark ready.
 * 5. Withdrawal flow: amil withdraws proposal with reason.
 * 6. Document management: upload AES-256-GCM, download verification with SHA-256, delete.
 * 7. Multi-tenancy isolation: queues, proposals, documents isolated by institution.
 * 8. Audit history and immutable version snapshots.
 * 9. Idempotency & version conflict protection.
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
import { createEncryptedFileStore, type PrivateFileStore } from "../src/evidence-files";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { type EthCall } from "../src/account-signature";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";

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
const FILE_KEY = Buffer.alloc(32, 42);

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let disbursement: DisbursementStore;
let files: PrivateFileStore;
let tempDir: string;
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

const get = (path: string, token?: string) =>
  request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

const del = (path: string, token?: string, body?: unknown) =>
  request(path, {
    method: "DELETE",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

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

async function syntheticProposal(programId?: string, amount = "150000") {
  const amilToken = await signIn(amilSinar, SINAR);
  const adminToken = await signIn(adminSinar, SINAR);
  if (!programId) {
    const response = await post("/programs", {
      name: "Program Sintetis", purpose: "Bantuan keluarga", fundType: "ZAKAT", scope: "Wilayah sintetis",
    }, adminToken);
    expect(response.status).toBe(201);
    programId = (await response.json()).program.id;
  }
  const response = await post("/proposals", {
    expectedVersion: 0, operationId: crypto.randomUUID(), programId,
    originOfRequest: "Permohonan sintetis", purpose: "Bantuan keluarga sintetis", personInCharge: "Ahmad Amil",
    aidPeriod: { start: "2026-03-01", end: "2026-03-31" },
    beneficiaries: [{ id: "ben-fixture", name: "Penerima Sintetis", asnaf: "Fakir",
      identityBasis: { kind: "NIK", value: "3201123456789012" }, addressOrScope: "Wilayah sintetis", guardian: null, paymentRecipient: null }],
    aidLines: [{ id: "aid-fixture", beneficiaryId: "ben-fixture", aidType: "Bantuan tunai", period: "2026-03",
      value: { kind: "MONEY", amountRequestedIdr: amount } }],
  }, amilToken);
  expect(response.status).toBe(201);
  return { draft: (await response.json()).draft, programId: programId!, amilToken, adminToken };
}

const documentInput = (category = "PROPOSAL_LETTER") => ({
  category, fileName: "dokumen-sintetis.txt", mimeType: "text/plain",
  beneficiaryId: category === "BENEFICIARY_IDENTITY" ? "ben-fixture" : null,
  contentBase64: Buffer.from("Bukti sintetis \u00e9 \u2713").toString("base64"),
});
async function completeAndSubmit(draft: { id: string; version: number }, token: string) {
  for (const category of ["PROPOSAL_LETTER", "BENEFICIARY_IDENTITY"]) {
    expect((await post(`/proposals/${draft.id}/documents`, documentInput(category), token)).status).toBe(201);
  }
  const response = await post(`/proposals/${draft.id}/submit`, {
    expectedVersion: draft.version, operationId: crypto.randomUUID(),
  }, token);
  expect(response.status).toBe(200);
}

describe("Dokumen pengajuan dan pemeriksaan kelayakan (Ticket #91)", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "disbursement-test-files-"));
    files = createEncryptedFileStore({ directory: tempDir, key: FILE_KEY });
    database = await createTestWorkspaceDatabase();
    store = createWorkspaceStore(database.handle());
    disbursement = createDisbursementStore(database.handle());
    await store.ensureSchema();
    await disbursement.ensureSchema();
  });

  afterAll(async () => {
    resetWorkspace();
    await database.close();
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    clock = NOW;
    await database.reset();

    configureWorkspace({
      store,
      disbursement,
      files,
      ethCall,
      now: () => clock,
      sessionTtlSeconds: 3600,
      challengeTtlSeconds: 300,
    });

    for (const inst of SYNTHETIC_INSTITUTIONS) {
      await store.upsertInstitution(institutionRecordOf(inst));
    }

    // Set up memberships
    await store.upsertMembership({ institutionId: SINAR, account: adminSinar.address, role: "ADMIN" });
    await store.upsertMembership({ institutionId: SINAR, account: amilSinar.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: SINAR, account: examinerSinar.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: SINAR, account: approverSinar.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: BAITUL, account: adminBaitul.address, role: "ADMIN" });
    await store.upsertMembership({ institutionId: BAITUL, account: amilBaitul.address, role: "OFFICER" });

    // Set up officer profiles
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

    await store.createOfficerProfile({
      id: "off-amil-baitul",
      institutionId: BAITUL,
      displayName: "Dedi Amil Baitul",
      account: amilBaitul.address,
      role: "OFFICER",
      actor: adminBaitul.address,
      now: clock,
    });

    // Grant operational mandates
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
        assignmentRef: "SK-003/APPROVER",
        validFrom: clock - 1000,
        validUntil: clock + 86400 * 30,
      },
    });

    await store.grantMandate({
      institutionId: BAITUL,
      actor: adminBaitul.address,
      now: clock,
      mandate: {
        officerId: "off-amil-baitul",
        function: "PREPARE_PROPOSALS",
        scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK-B01",
        validFrom: clock - 1000,
        validUntil: clock + 86400 * 30,
      },
    });
  });

  it("enforces completeness gate: missing fields and required documents per policy", async () => {
    const amilToken = await signIn(amilSinar, SINAR);
    const adminToken = await signIn(adminSinar, SINAR);

    // Create program
    const progRes = await post("/programs", {
      name: "Bantuan Beras Mustahik",
      purpose: "Ketahanan pangan keluarga prasejahtera",
      fundType: "ZAKAT",
      scope: "Kecamatan Bogor Barat",
      referenceCeiling: "100000000",
    }, adminToken);
    expect(progRes.status).toBe(201);
    const { program } = await progRes.json();

    // Configure strict policy
    const policyRes = await post("/policy", {
      expectedVersion: 1,
      requireProposalLetter: true,
      requireIdentityDoc: true,
      requireAlternativeIdProof: true,
      requireGuardianProof: true,
      warnRecurringAid: true,
    }, adminToken);
    expect(policyRes.status).toBe(200);

    // Create draft with incomplete fields
    const draftRes = await post("/proposals", {
      expectedVersion: 0,
      operationId: "op-create-draft-1",
      programId: program.id,
      originOfRequest: "", // empty
      purpose: "Bantuan sembako",
      aidPeriod: { start: "2026-03-01", end: "2026-03-31" },
      personInCharge: "Ahmad Amil",
      beneficiaries: [
        {
          id: "ben-1",
          name: "Siti Rahma",
          identityBasis: { kind: "NIK", value: "3201123456789012" },
          asnaf: "Fakir",
          addressOrScope: "RT 01 RW 02",
          guardian: null,
          paymentRecipient: null,
        },
      ],
      aidLines: [
        {
          id: "aid-1",
          beneficiaryId: "ben-1",
          aidType: "Beras 10kg",
          period: "2026-03",
          value: { kind: "MONEY", amountRequestedIdr: "150000" },
        },
      ],
    }, amilToken);
    expect(draftRes.status).toBe(201);
    const { draft } = await draftRes.json();
    expect(draft.status).toBe("DRAFT");

    // Attempt submit -> fails on empty originOfRequest and missing proposal letter
    const sub1 = await post(`/proposals/${draft.id}/submit`, {
      expectedVersion: 1,
      operationId: "op-sub-1",
    }, amilToken);
    expect(sub1.status).toBe(400);
    const sub1Data = await sub1.json();
    expect(sub1Data.issues.some((i: any) => i.field === "originOfRequest")).toBe(true);
    expect(sub1Data.issues.some((i: any) => i.field === "documents.proposalLetter")).toBe(true);

    // Fix originOfRequest
    const updateRes = await post("/proposals", {
      id: draft.id,
      expectedVersion: 1,
      operationId: "op-edit-draft-1",
      programId: program.id,
      originOfRequest: "Permohonan Warga RW 02",
      purpose: "Bantuan sembako",
      aidPeriod: { start: "2026-03-01", end: "2026-03-31" },
      personInCharge: "Ahmad Amil",
      beneficiaries: draft.beneficiaries,
      aidLines: draft.aidLines,
    }, amilToken);
    expect(updateRes.status).toBe(200);

    // Attempt submit -> still fails because proposal letter and identity doc are missing
    const sub2 = await post(`/proposals/${draft.id}/submit`, {
      expectedVersion: 2,
      operationId: "op-sub-2",
    }, amilToken);
    expect(sub2.status).toBe(400);
    const sub2Data = await sub2.json();
    expect(sub2Data.issues.some((i: any) => i.field === "documents.proposalLetter")).toBe(true);
    expect(sub2Data.issues.some((i: any) => i.field === "documents.identity")).toBe(true);

    // Upload proposal letter
    const letterBytes = Buffer.from("Surat Pengajuan Resmi No 001/2026", "utf-8");
    const doc1 = await post(`/proposals/${draft.id}/documents`, {
      category: "PROPOSAL_LETTER",
      fileName: "surat_pengajuan.pdf",
      mimeType: "application/pdf",
      contentBase64: letterBytes.toString("base64"),
    }, amilToken);
    expect(doc1.status).toBe(201);
    const { document: savedLetter } = await doc1.json();
    expect(savedLetter.storageStatus).toBe("STORED");

    // Upload KTP for ben-1
    const ktpBytes = Buffer.from("KTP Data Siti Rahma 3201123456789012", "utf-8");
    const doc2 = await post(`/proposals/${draft.id}/documents`, {
      category: "BENEFICIARY_IDENTITY",
      beneficiaryId: "ben-1",
      fileName: "ktp_siti.jpg",
      mimeType: "image/jpeg",
      contentBase64: ktpBytes.toString("base64"),
    }, amilToken);
    expect(doc2.status).toBe(201);

    // Now submit succeeds!
    const sub3 = await post(`/proposals/${draft.id}/submit`, {
      expectedVersion: 2,
      operationId: "op-sub-3",
    }, amilToken);
    expect(sub3.status).toBe(200);
    const { draft: submittedDraft } = await sub3.json();
    expect(submittedDraft.status).toBe("SUBMITTED");
    const examinerToken = await signIn(examinerSinar, SINAR);
    const before = (await (await get(`/proposals/${draft.id}/versions/2`, amilToken)).json()).version;
    expect((await del(`/proposals/${draft.id}`, amilToken,
      { expectedVersion: 2, operationId: "delete-submitted" })).status).toBe(409);
    expect((await post(`/proposals/${draft.id}/return`, {
      expectedVersion: 2, operationId: "return-documents", reason: "Ganti surat",
    }, examinerToken)).status).toBe(200);
    expect((await del(`/proposals/${draft.id}/documents/${savedLetter.id}`, amilToken)).status).toBe(204);
    expect((await post(`/proposals/${draft.id}/documents`, {
      category: "PROPOSAL_LETTER", fileName: "replacement.pdf", mimeType: "application/pdf",
      contentBase64: Buffer.from("replacement").toString("base64"),
    }, amilToken)).status).toBe(201);
    const resubmit = { expectedVersion: 2, operationId: "resubmit-documents" };
    const resubmitted = await post(`/proposals/${draft.id}/submit`, resubmit, amilToken);
    expect(resubmitted.status).toBe(200);
    const next = (await resubmitted.json()).draft;
    expect(next.version).toBe(3);
    expect((await (await post(`/proposals/${draft.id}/submit`, resubmit, amilToken)).json()).draft.version).toBe(3);
    expect((await (await get(`/proposals/${draft.id}/versions/2`, amilToken)).json()).version).toEqual(before);
    const frozenDocs = (await (await get(`/proposals/${draft.id}/documents?version=2`, examinerToken)).json()).documents;
    expect(frozenDocs.some((doc: any) => doc.id === savedLetter.id)).toBe(true);
    const frozenFile = await get(`/proposals/${draft.id}/files/${savedLetter.id}?version=2`, examinerToken);
    expect(frozenFile.status).toBe(200);
    expect(await frozenFile.text()).toBe(letterBytes.toString());
    expect((await del(`/proposals/${draft.id}`, amilToken,
      { expectedVersion: 3, operationId: "delete-resubmitted" })).status).toBe(409);
    expect((await (await get(`/proposals/${draft.id}/history`, amilToken)).json()).history).toHaveLength(3);

  });

  it("handles structural alternative identity and enforces human review during examination", async () => {
    const amilToken = await signIn(amilSinar, SINAR);
    const examinerToken = await signIn(examinerSinar, SINAR);
    const adminToken = await signIn(adminSinar, SINAR);

    const progRes = await post("/programs", {
      name: "Bantuan Korban Bencana",
      purpose: "Bantuan darurat korban banjir",
      fundType: "INFAK",
      scope: "Kabupaten Bogor",
      referenceCeiling: null,
    }, adminToken);
    const { program } = await progRes.json();

    // Draft with ALTERNATIVE identity basis (no NIK) and guardian
    const draftRes = await post("/proposals", {
      expectedVersion: 0,
      operationId: "op-create-alt-draft",
      programId: program.id,
      originOfRequest: "Posko Pengungsian",
      purpose: "Bantuan kebutuhan anak yatim korban banjir",
      aidPeriod: { start: "2026-03-01", end: "2026-03-15" },
      personInCharge: "Ahmad Amil",
      beneficiaries: [
        {
          id: "ben-alt",
          name: "Anak Yatim Tanpa NIK",
          identityBasis: {
            kind: "ALTERNATIVE",
            description: "Surat keterangan domisili sementara & surat keterangan RT 05",
          },
          asnaf: "Ibnu Sabil",
          addressOrScope: "Posko Balai Desa",
          guardian: {
            name: "Paman Suryo",
            relationship: "Paman kandung / Wali sementara",
          },
          paymentRecipient: null,
        },
      ],
      aidLines: [
        {
          id: "aid-alt",
          beneficiaryId: "ben-alt",
          aidType: "Perlengkapan sekolah & pakaian",
          period: "2026-03",
          value: { kind: "MONEY", amountRequestedIdr: "500000" },
        },
      ],
    }, amilToken);
    expect(draftRes.status).toBe(201);
    const { draft } = await draftRes.json();

    // Upload required docs: PROPOSAL_LETTER, ALTERNATIVE_IDENTITY_PROOF, and REPRESENTATION_PROOF
    await post(`/proposals/${draft.id}/documents`, {
      category: "PROPOSAL_LETTER",
      fileName: "surat_posko.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("Surat Permohonan Posko").toString("base64"),
    }, amilToken);

    await post(`/proposals/${draft.id}/documents`, {
      category: "ALTERNATIVE_IDENTITY_PROOF",
      beneficiaryId: "ben-alt",
      fileName: "surat_keterangan_rt.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("Surat Keterangan RT No 12").toString("base64"),
    }, amilToken);

    await post(`/proposals/${draft.id}/documents`, {
      category: "REPRESENTATION_PROOF",
      beneficiaryId: "ben-alt",
      fileName: "surat_perwalian_paman.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("Surat Pernyataan Perwalian Paman Suryo").toString("base64"),
    }, amilToken);

    // Submit succeeds
    const subRes = await post(`/proposals/${draft.id}/submit`, {
      expectedVersion: 1,
      operationId: "op-sub-alt",
    }, amilToken);
    expect(subRes.status).toBe(200);

    // Examiner starts examination
    const startRes = await post(`/proposals/${draft.id}/start-examination`, {
      expectedVersion: 1,
      operationId: "op-start-alt",
    }, examinerToken);
    expect(startRes.status).toBe(200);
    expect((await startRes.json()).draft.status).toBe("UNDER_EXAMINATION");

    const unreviewed = await post(`/proposals/${draft.id}/ready`, {
      expectedVersion: 1, operationId: "op-ready-alt-unreviewed",
      checklist: { administrativeChecksOk: true, eligibilityChecksOk: true,
        alternativeIdReviewed: false, recurringAidExceptions: [], notes: "" },
    }, examinerToken);
    expect(unreviewed.status).toBe(400);
    expect((await (await get(`/proposals/${draft.id}`, examinerToken)).json()).draft.status).toBe("UNDER_EXAMINATION");

    // Examiner marks ready with alternativeIdReviewed = true
    const readyRes = await post(`/proposals/${draft.id}/ready`, {
      expectedVersion: 1,
      operationId: "op-ready-alt",
      checklist: {
        administrativeChecksOk: true,
        eligibilityChecksOk: true,
        alternativeIdReviewed: true,
        recurringAidExceptions: [],
        notes: "Identitas alternatif telah diverifikasi langsung di posko bersama RT setempat.",
      },
    }, examinerToken);
    expect(readyRes.status).toBe(200);
    const readyDraft = (await readyRes.json()).draft;
    expect(readyDraft.status).toBe("READY_FOR_DECISION");
    expect(readyDraft.examinationNotes).toContain("Identitas alternatif telah diverifikasi");
    expect(readyDraft.examinationChecklist.alternativeIdReviewed).toBe(true);
  });

  it("detects recurring aid warnings across proposals and records examiner exception", async () => {
    const amilToken = await signIn(amilSinar, SINAR);
    const examinerToken = await signIn(examinerSinar, SINAR);
    const adminToken = await signIn(adminSinar, SINAR);

    const progRes = await post("/programs", {
      name: "Program Reguler Dhuafa",
      purpose: "Bantuan bulanan keluarga mustahik",
      fundType: "ZAKAT",
      scope: "Kota Bogor",
      referenceCeiling: null,
    }, adminToken);
    const { program } = await progRes.json();

    const nikMustahik = "3201999988887777";

    // Proposal 1 for Mustahik in 2026-Q1
    const p1Res = await post("/proposals", {
      expectedVersion: 0,
      operationId: "op-p1-create",
      programId: program.id,
      originOfRequest: "Kelurahan",
      purpose: "Bantuan sembako Q1",
      aidPeriod: { start: "2026-01-01", end: "2026-03-31" },
      personInCharge: "Ahmad Amil",
      beneficiaries: [
        {
          id: "ben-p1",
          name: "Pak Herman",
          identityBasis: { kind: "NIK", value: nikMustahik },
          asnaf: "Miskin",
          addressOrScope: "Jalan Melati No 1",
          guardian: null,
          paymentRecipient: null,
        },
      ],
      aidLines: [
        {
          id: "aid-p1",
          beneficiaryId: "ben-p1",
          aidType: "Sembako",
          period: "2026-Q1",
          value: { kind: "MONEY", amountRequestedIdr: "300000" },
        },
      ],
    }, amilToken);
    const { draft: d1 } = await p1Res.json();

    await post(`/proposals/${d1.id}/documents`, {
      category: "PROPOSAL_LETTER",
      fileName: "surat_p1.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("Surat P1").toString("base64"),
    }, amilToken);
    await post(`/proposals/${d1.id}/documents`, {
      category: "BENEFICIARY_IDENTITY",
      beneficiaryId: "ben-p1",
      fileName: "ktp_herman.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("KTP Herman").toString("base64"),
    }, amilToken);

    await post(`/proposals/${d1.id}/submit`, {
      expectedVersion: 1,
      operationId: "op-p1-sub",
    }, amilToken);

    // Proposal 2 also includes Pak Herman with the same NIK during overlapping period
    const p2Res = await post("/proposals", {
      expectedVersion: 0,
      operationId: "op-p2-create",
      programId: program.id,
      originOfRequest: "Yayasan",
      purpose: "Bantuan tambahan Q1",
      aidPeriod: { start: "2026-02-01", end: "2026-03-31" },
      personInCharge: "Ahmad Amil",
      beneficiaries: [
        {
          id: "ben-p2",
          name: "Herman S.",
          identityBasis: { kind: "NIK", value: nikMustahik },
          asnaf: "Miskin",
          addressOrScope: "Jalan Melati No 1",
          guardian: null,
          paymentRecipient: null,
        },
      ],
      aidLines: [
        {
          id: "aid-p2",
          beneficiaryId: "ben-p2",
          aidType: "Bantuan Beras",
          period: "2026-Q1",
          value: { kind: "MONEY", amountRequestedIdr: "200000" },
        },
      ],
    }, amilToken);
    const { draft: d2 } = await p2Res.json();

    await post(`/proposals/${d2.id}/documents`, {
      category: "PROPOSAL_LETTER",
      fileName: "surat_p2.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("Surat P2").toString("base64"),
    }, amilToken);
    await post(`/proposals/${d2.id}/documents`, {
      category: "BENEFICIARY_IDENTITY",
      beneficiaryId: "ben-p2",
      fileName: "ktp_herman_2.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("KTP Herman 2").toString("base64"),
    }, amilToken);

    // Submit Proposal 2 -> should return warnings
    const subP2Res = await post(`/proposals/${d2.id}/submit`, {
      expectedVersion: 1,
      operationId: "op-p2-sub",
    }, amilToken);
    expect(subP2Res.status).toBe(200);
    const { draft: d2Submitted, warnings } = await subP2Res.json();
    expect(d2Submitted.status).toBe("SUBMITTED");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].matchedProposalId).toBe(d1.id);
    expect(warnings[0].message).toContain("tercatat menerima bantuan");

    // Examiner inspects queue and marks ready with exception
    await post(`/proposals/${d2.id}/start-examination`, {
      expectedVersion: 1,
      operationId: "op-p2-exam",
    }, examinerToken);

    const readyRes = await post(`/proposals/${d2.id}/ready`, {
      expectedVersion: 1,
      operationId: "op-p2-ready",
      checklist: {
        administrativeChecksOk: true,
        eligibilityChecksOk: true,
        alternativeIdReviewed: false,
        recurringAidExceptions: [
          `Penerima menerima bantuan tambahan karena kondisi darurat kesehatan sesuai rekomendasi survei. Terkait ${d1.id}`,
        ],
        notes: "Disetujui dengan catatan bantuan berulang.",
      },
    }, examinerToken);
    expect(readyRes.status).toBe(200);
    const readyD2 = (await readyRes.json()).draft;
    expect(readyD2.status).toBe("READY_FOR_DECISION");
    expect(readyD2.examinationChecklist.recurringAidExceptions.length).toBe(1);
  });

  it("executes full revision loop: amil submits, examiner returns, revision queue shows it, amil revises, resubmits, and examiner approves", async () => {
    const amilToken = await signIn(amilSinar, SINAR);
    const examinerToken = await signIn(examinerSinar, SINAR);
    const adminToken = await signIn(adminSinar, SINAR);

    const progRes = await post("/programs", {
      name: "Program Usaha Mandiri",
      purpose: "Modal kerja usaha mikro",
      fundType: "INFAK",
      scope: "Kecamatan Bogor Tengah",
      referenceCeiling: null,
    }, adminToken);
    const { program } = await progRes.json();

    const createRes = await post("/proposals", {
      expectedVersion: 0,
      operationId: "op-rev-create",
      programId: program.id,
      originOfRequest: "Paguyuban Pedagang",
      purpose: "Modal gerobak bakso",
      aidPeriod: { start: "2026-04-01", end: "2026-04-30" },
      personInCharge: "Ahmad Amil",
      beneficiaries: [
        {
          id: "ben-rev",
          name: "Bambang Sudiro",
          identityBasis: { kind: "NIK", value: "3201555544443333" },
          asnaf: "Fakir",
          addressOrScope: "Pasar Anyar Kios 12",
          guardian: null,
          paymentRecipient: null,
        },
      ],
      aidLines: [
        {
          id: "aid-rev",
          beneficiaryId: "ben-rev",
          aidType: "Modal Usaha",
          period: "2026-04",
          value: { kind: "MONEY", amountRequestedIdr: "2500000" },
        },
      ],
    }, amilToken);
    const { draft } = await createRes.json();

    await post(`/proposals/${draft.id}/documents`, {
      category: "PROPOSAL_LETTER",
      fileName: "proposal_usaha.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("Surat Usaha").toString("base64"),
    }, amilToken);
    await post(`/proposals/${draft.id}/documents`, {
      category: "BENEFICIARY_IDENTITY",
      beneficiaryId: "ben-rev",
      fileName: "ktp_bambang.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("KTP Bambang").toString("base64"),
    }, amilToken);

    // 1. Submit -> SUBMITTED (version 1)
    const subRes = await post(`/proposals/${draft.id}/submit`, {
      expectedVersion: 1,
      operationId: "op-rev-sub1",
    }, amilToken);
    expect(subRes.status).toBe(200);

    // 2. Examiner queue has it
    const exQueueRes = await get("/proposals/queue/examiner", examinerToken);
    expect(exQueueRes.status).toBe(200);
    const exQueue = (await exQueueRes.json()).queue;
    expect(exQueue.some((q: any) => q.id === draft.id)).toBe(true);

    // Revision queue does NOT have it yet
    const revQueueRes1 = await get("/proposals/queue/revision", amilToken);
    expect(revQueueRes1.status).toBe(200);
    expect((await revQueueRes1.json()).queue.some((q: any) => q.id === draft.id)).toBe(false);

    // 3. Examiner starts examination
    await post(`/proposals/${draft.id}/start-examination`, {
      expectedVersion: 1,
      operationId: "op-rev-start1",
    }, examinerToken);

    // 4. Examiner returns for revision with actionable reason
    const returnReason = "Rincian kebutuhan modal kerja belum jelas. Sertakan breakdown alat dan bahan.";
    const returnRes = await post(`/proposals/${draft.id}/return`, {
      expectedVersion: 1,
      operationId: "op-rev-return1",
      reason: returnReason,
    }, examinerToken);
    expect(returnRes.status).toBe(200);
    const returnedDraft = (await returnRes.json()).draft;
    expect(returnedDraft.status).toBe("REVISION_REQUIRED");
    expect(returnedDraft.revisionReason).toBe(returnReason);

    // 5. Check queues: gone from examiner queue, present in amil revision queue
    const exQueueRes2 = await get("/proposals/queue/examiner", examinerToken);
    expect((await exQueueRes2.json()).queue.some((q: any) => q.id === draft.id)).toBe(false);

    const revQueueRes2 = await get("/proposals/queue/revision", amilToken);
    expect((await revQueueRes2.json()).queue.some((q: any) => q.id === draft.id)).toBe(true);

    // 6. Amil revises the proposal (adds breakdown, updates draft)
    const updateRes = await post("/proposals", {
      id: draft.id,
      expectedVersion: 1,
      operationId: "op-rev-edit1",
      programId: program.id,
      originOfRequest: "Paguyuban Pedagang",
      purpose: "Modal gerobak bakso (Gerobak Rp 1.5jt, Peralatan Rp 500rb, Bahan awal Rp 500rb)",
      aidPeriod: { start: "2026-04-01", end: "2026-04-30" },
      personInCharge: "Ahmad Amil",
      beneficiaries: draft.beneficiaries,
      aidLines: [
        {
          id: "aid-rev-1",
          beneficiaryId: "ben-rev",
          aidType: "Gerobak & Peralatan Usaha",
          period: "2026-04",
          value: { kind: "MONEY", amountRequestedIdr: "2000000" },
        },
        {
          id: "aid-rev-2",
          beneficiaryId: "ben-rev",
          aidType: "Bahan Baku Awal",
          period: "2026-04",
          value: { kind: "MONEY", amountRequestedIdr: "500000" },
        },
      ],
    }, amilToken);
    expect(updateRes.status).toBe(200);
    const revisedDraft = (await updateRes.json()).draft;
    expect(revisedDraft.version).toBe(2);

    // 7. Amil resubmits proposal at version 2
    const resubRes = await post(`/proposals/${draft.id}/submit`, {
      expectedVersion: 2,
      operationId: "op-rev-sub2",
    }, amilToken);
    expect(resubRes.status).toBe(200);
    const resubmittedDraft = (await resubRes.json()).draft;
    expect(resubmittedDraft.status).toBe("SUBMITTED");
    expect(resubmittedDraft.revisionReason).toBeNull(); // revision reason is cleared

    // 8. Examiner examines and marks ready
    await post(`/proposals/${draft.id}/start-examination`, {
      expectedVersion: 2,
      operationId: "op-rev-start2",
    }, examinerToken);

    const readyRes = await post(`/proposals/${draft.id}/ready`, {
      expectedVersion: 2,
      operationId: "op-rev-ready2",
      checklist: {
        administrativeChecksOk: true,
        eligibilityChecksOk: true,
        alternativeIdReviewed: false,
        recurringAidExceptions: [],
        notes: "Breakdown rincian biaya sudah lengkap dan layak.",
      },
    }, examinerToken);
    expect(readyRes.status).toBe(200);
    expect((await readyRes.json()).draft.status).toBe("READY_FOR_DECISION");

    // 9. Verify history has full timeline
    const historyRes = await get(`/proposals/${draft.id}/history`, amilToken);
    expect(historyRes.status).toBe(200);
    const history = (await historyRes.json()).history;
    const actions = history.map((h: any) => h.action);
    expect(actions).toContain("SUBMIT");
    expect(actions).toContain("START_EXAMINATION");
    expect(actions).toContain("RETURN_FOR_REVISION");
    expect(actions).toContain("MARK_READY");

    // 10. Verify version snapshot 1 can still be retrieved
    const v1Res = await get(`/proposals/${draft.id}/versions/1`, amilToken);
    expect(v1Res.status).toBe(200);
    const v1 = (await v1Res.json()).version;
    expect(v1.version).toBe(1);
    expect(v1.data.purpose).toBe("Modal gerobak bakso");
  });

  it("allows amil to withdraw proposal with mandatory reason", async () => {
    const amilToken = await signIn(amilSinar, SINAR);
    const adminToken = await signIn(adminSinar, SINAR);

    const progRes = await post("/programs", {
      name: "Program Bantuan Khusus",
      purpose: "Bantuan khusus",
      fundType: "SEDEKAH",
      scope: "Bogor",
      referenceCeiling: null,
    }, adminToken);
    const { program } = await progRes.json();

    const dRes = await post("/proposals", {
      expectedVersion: 0,
      operationId: "op-w-create",
      programId: program.id,
      originOfRequest: "Lurah",
      purpose: "Bantuan darurat",
      aidPeriod: { start: "2026-05-01", end: "2026-05-31" },
      personInCharge: "Ahmad Amil",
      beneficiaries: [
        {
          id: "ben-w",
          name: "Wawan",
          identityBasis: { kind: "NIK", value: "3201000000009999" },
          asnaf: "Fakir",
          addressOrScope: "Bogor",
          guardian: null,
          paymentRecipient: null,
        },
      ],
      aidLines: [
        {
          id: "aid-w",
          beneficiaryId: "ben-w",
          aidType: "Tunai",
          period: "2026-05",
          value: { kind: "MONEY", amountRequestedIdr: "100000" },
        },
      ],
    }, amilToken);
    const { draft } = await dRes.json();

    await post(`/proposals/${draft.id}/documents`, {
      category: "PROPOSAL_LETTER",
      fileName: "surat.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("Surat").toString("base64"),
    }, amilToken);
    await post(`/proposals/${draft.id}/documents`, {
      category: "BENEFICIARY_IDENTITY",
      beneficiaryId: "ben-w",
      fileName: "ktp.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("KTP").toString("base64"),
    }, amilToken);

    await post(`/proposals/${draft.id}/submit`, {
      expectedVersion: 1,
      operationId: "op-w-sub",
    }, amilToken);

    // Empty reason fails
    const failWithdraw = await post(`/proposals/${draft.id}/withdraw`, {
      expectedVersion: 1,
      operationId: "op-w-fail",
      reason: "   ",
    }, amilToken);
    expect(failWithdraw.status).toBe(400);

    // Valid withdrawal succeeds
    const withdrawRes = await post(`/proposals/${draft.id}/withdraw`, {
      expectedVersion: 1,
      operationId: "op-w-ok",
      reason: "Pemohon telah menerima bantuan mandiri dari sumber lain.",
    }, amilToken);
    expect(withdrawRes.status).toBe(200);
    const withdrawnDraft = (await withdrawRes.json()).draft;
    expect(withdrawnDraft.status).toBe("WITHDRAWN");
    expect(withdrawnDraft.withdrawalReason).toBe("Pemohon telah menerima bantuan mandiri dari sumber lain.");
  });

  it("stores documents encrypted, verifies SHA-256 on download, and allows deletion during draft", async () => {
    const amilToken = await signIn(amilSinar, SINAR);
    const examinerToken = await signIn(examinerSinar, SINAR);
    const adminToken = await signIn(adminSinar, SINAR);

    const progRes = await post("/programs", {
      name: "Program Kesehatan",
      purpose: "Bantuan biaya pengobatan",
      fundType: "ZAKAT",
      scope: "Bogor",
      referenceCeiling: null,
    }, adminToken);
    const { program } = await progRes.json();

    const draftRes = await post("/proposals", {
      expectedVersion: 0,
      operationId: "op-doc-test",
      programId: program.id,
      originOfRequest: "RSUD",
      purpose: "Operasi katarak",
      aidPeriod: { start: "2026-06-01", end: "2026-06-30" },
      personInCharge: "Ahmad Amil",
      beneficiaries: [
        {
          id: "ben-med",
          name: "Ibu Maryam",
          identityBasis: { kind: "NIK", value: "3201444433332222" },
          asnaf: "Miskin",
          addressOrScope: "Bogor",
          guardian: null,
          paymentRecipient: null,
        },
      ],
      aidLines: [
        {
          id: "aid-med",
          beneficiaryId: "ben-med",
          aidType: "Biaya Operasi",
          period: "2026-06",
          value: { kind: "MONEY", amountRequestedIdr: "4000000" },
        },
      ],
    }, amilToken);
    const { draft } = await draftRes.json();

    const originalContent = "Keterangan Medis Rahasia: Pasien membutuhkan operasi katarak segera.";
    const originalBytes = Buffer.from(originalContent, "utf-8");

    // Upload document
    const uploadRes = await post(`/proposals/${draft.id}/documents`, {
      category: "OTHER",
      fileName: "surat_rujukan.txt",
      mimeType: "text/plain",
      contentBase64: originalBytes.toString("base64"),
    }, amilToken);
    expect(uploadRes.status).toBe(201);
    const { document: doc } = await uploadRes.json();
    expect(doc.storageStatus).toBe("STORED");
    expect(doc.fileName).toBe("surat_rujukan.txt");
    expect(doc.sizeBytes).toBe(originalBytes.byteLength);

    // List documents
    const listDocsRes = await get(`/proposals/${draft.id}/documents`, examinerToken);
    expect(listDocsRes.status).toBe(200);
    const docs = (await listDocsRes.json()).documents;
    expect(docs.some((d: any) => d.id === doc.id)).toBe(true);

    // Download document as examiner
    const dlRes = await get(`/proposals/${draft.id}/files/${doc.id}`, examinerToken);
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers.get("content-type")).toBe("text/plain");
    const downloadedText = await dlRes.text();
    expect(downloadedText).toBe(originalContent);

    // Delete document as amil
    const delRes = await del(`/proposals/${draft.id}/documents/${doc.id}`, amilToken);
    expect(delRes.status).toBe(204);

    // Verify document is gone
    const listAfter = await get(`/proposals/${draft.id}/documents`, amilToken);
    expect((await listAfter.json()).documents.some((d: any) => d.id === doc.id)).toBe(false);

    // Download returns 404
    const dlGone = await get(`/proposals/${draft.id}/files/${doc.id}`, examinerToken);
    expect(dlGone.status).toBe(404);
  });

  it("strictly enforces multi-tenancy isolation across institutions", async () => {
    const amilSinarToken = await signIn(amilSinar, SINAR);
    const amilBaitulToken = await signIn(amilBaitul, BAITUL);
    const adminSinarToken = await signIn(adminSinar, SINAR);

    const progRes = await post("/programs", {
      name: "Program Sinar Rahasia",
      purpose: "Tujuan internal",
      fundType: "ZAKAT",
      scope: "Bogor",
      referenceCeiling: null,
    }, adminSinarToken);
    const { program } = await progRes.json();

    const dRes = await post("/proposals", {
      expectedVersion: 0,
      operationId: "op-sinar-draft",
      programId: program.id,
      originOfRequest: "Internal",
      purpose: "Penyaluran Sinar",
      aidPeriod: null,
      personInCharge: "Ahmad Amil",
      beneficiaries: [],
      aidLines: [],
    }, amilSinarToken);
    const { draft: sinarDraft } = await dRes.json();

    const uploadRes = await post(`/proposals/${sinarDraft.id}/documents`, {
      category: "PROPOSAL_LETTER",
      fileName: "dokumen_sinar.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("Dokumen Rahasia Sinar").toString("base64"),
    }, amilSinarToken);
    const { document: sinarDoc } = await uploadRes.json();

    // Baitul amil cannot view Sinar's proposal
    const viewRes = await get(`/proposals/${sinarDraft.id}`, amilBaitulToken);
    expect(viewRes.status).toBe(404);

    // Baitul amil cannot view Sinar's documents
    const docRes = await get(`/proposals/${sinarDraft.id}/documents`, amilBaitulToken);
    expect(docRes.status).toBe(404);

    // Baitul amil cannot download Sinar's file
    const fileRes = await get(`/proposals/${sinarDraft.id}/files/${sinarDoc.id}`, amilBaitulToken);
    expect(fileRes.status).toBe(404);

    // Baitul amil cannot delete Sinar's document
    const delRes = await del(`/proposals/${sinarDraft.id}/documents/${sinarDoc.id}`, amilBaitulToken);
    expect(delRes.status).toBe(404);

    // Baitul amil cannot submit Sinar's proposal
    const subRes = await post(`/proposals/${sinarDraft.id}/submit`, {
      expectedVersion: 1,
      operationId: "op-hack-sub",
    }, amilBaitulToken);
    expect(subRes.status).toBe(404);
  });
  it("refuses unavailable storage without creating document metadata", async () => {
    const { draft, amilToken } = await syntheticProposal();
    for (const storage of [undefined, { ...files, put: async () => { throw new Error("disk unavailable"); } }]) {
      configureWorkspace({ store, disbursement, files: storage, ethCall, now: () => clock,
        sessionTtlSeconds: 3600, challengeTtlSeconds: 300 });
      const response = await post(`/proposals/${draft.id}/documents`, documentInput(), amilToken);
      expect(response.status).toBe(503);
      expect((await response.json()).success).toBe(false);
      expect((await (await get(`/proposals/${draft.id}/documents`, amilToken)).json()).documents).toHaveLength(0);
    }
  });

  it("filters queues and authorizes document mutations by program and nominal mandate", async () => {
    const first = await syntheticProposal();
    const other = await syntheticProposal();
    const expensive = await syntheticProposal(first.programId, "500000");
    for (const fixture of [first, other, expensive]) await completeAndSubmit(fixture.draft, fixture.amilToken);
    const examinerToken = await signIn(examinerSinar, SINAR);
    for (const officerId of ["off-amil-sinar", "off-examiner-sinar"]) {
      const mandates = await store.activeMandatesForOfficer(SINAR, officerId, clock);
      for (const mandate of mandates) await store.updateMandate({
        id: mandate.id, expectedVersion: mandate.version, institutionId: SINAR, actor: adminSinar.address, now: clock,
        patch: { scopeType: "SPECIFIC_PROGRAM", programId: first.programId, nominalLimit: "200000" },
      });
    }
    const queue = await get("/proposals/queue/examiner", examinerToken);
    expect(queue.status).toBe(200);
    expect((await queue.json()).queue.map((item: any) => item.id)).toEqual([first.draft.id]);
    expect((await (await get(`/proposals/queue/examiner?programId=${other.programId}`, examinerToken)).json()).queue).toHaveLength(0);
    expect((await post(`/proposals/${first.draft.id}/return`, {
      expectedVersion: 1, operationId: "scoped-return", reason: "Perbaiki surat",
    }, examinerToken)).status).toBe(200);
    const revisions = await get("/proposals/queue/revision", first.amilToken);
    expect(revisions.status).toBe(200);
    expect((await revisions.json()).queue.map((item: any) => item.id)).toEqual([first.draft.id]);
    const upload = await post(`/proposals/${first.draft.id}/documents`, documentInput(), first.amilToken);
    expect(upload.status).toBe(201);
    const doc = (await upload.json()).document;
    expect((await get(`/proposals/${first.draft.id}/files/${doc.id}`, first.amilToken)).status).toBe(200);
    expect((await del(`/proposals/${first.draft.id}/documents/${doc.id}`, first.amilToken)).status).toBe(204);
    for (const fixture of [other, expensive]) {
      expect((await post(`/proposals/${fixture.draft.id}/documents`, documentInput(), first.amilToken)).status).toBe(403);
      const docs = (await (await get(`/proposals/${fixture.draft.id}/documents`, first.amilToken)).json()).documents;
      expect((await del(`/proposals/${fixture.draft.id}/documents/${docs[0].id}`, first.amilToken)).status).toBe(403);
    }
  });

  it("retains frozen documents and history after restart and rejects missing or corrupt bytes", async () => {
    const fixture = await syntheticProposal();
    await completeAndSubmit(fixture.draft, fixture.amilToken);
    await database.reopen();
    store = createWorkspaceStore(database.handle());
    disbursement = createDisbursementStore(database.handle());
    await store.ensureSchema();
    await disbursement.ensureSchema();
    configureWorkspace({ store, disbursement, files, ethCall, now: () => clock,
      sessionTtlSeconds: 3600, challengeTtlSeconds: 300 });
    const version = (await (await get(`/proposals/${fixture.draft.id}/versions/1`, fixture.amilToken)).json()).version;
    expect(version.documents).toHaveLength(2);
    const path = `/proposals/${fixture.draft.id}/files/${version.documents[0].id}?version=1`;
    expect((await get(path, fixture.amilToken)).status).toBe(200);
    expect((await (await get(`/proposals/${fixture.draft.id}/history`, fixture.amilToken)).json()).history).toHaveLength(1);
    const original = (await disbursement.listProposalDocuments(SINAR, fixture.draft.id))[0]!;
    const { writeFile, unlink } = await import("node:fs/promises");
    // Alter the actual encrypted file, not the integrity checker.
    await writeFile(original.storageRef!, new Uint8Array([1, 2, 3]));
    expect((await get(path, fixture.amilToken)).status).toBe(409);
    await unlink(original.storageRef!);
    expect((await get(path, fixture.amilToken)).status).toBe(404);
  });

  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("browser: private upload, two-role queues, recurring warnings, revision, download and keyboard", async () => {
    const prior = await syntheticProposal();
    await completeAndSubmit(prior.draft, prior.amilToken);
    const fixture = await syntheticProposal(prior.programId);
    const changed = await post("/proposals", { ...fixture.draft, purpose: "Pengajuan Browser Sintetis",
      expectedVersion: fixture.draft.version, operationId: "browser-title" }, fixture.amilToken);
    expect(changed.status).toBe(200);
    const built = await Bun.build({
      entrypoints: [new URL("../../frontend/test/officer-smoke.tsx", import.meta.url).pathname],
      target: "browser", define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "" }) },
    });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const bundle = await built.outputs[0]!.text();
    let wallet = amilSinar;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/") return new Response('<!doctype html><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
      if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
      if (path === "/switch-wallet") return Response.json([wallet.address]);
      if (path === "/wallet-rpc") {
        const { method, params } = await req.json();
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return Response.json([wallet.address]);
        if (method === "eth_chainId") return Response.json("0x7a69");
        if (method === "eth_signTypedData_v4") return Response.json(await wallet.signTypedData(JSON.parse(params[1])));
        return Response.json(null);
      }
      return app.fetch(req);
    } });
    const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
    const browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE,
      headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();
    try {
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      page.setDefaultTimeout(10000);
      await page.goto(server.url.toString());
      await page.getByRole("button", { name: /^0x/ }).waitFor();
      await page.getByLabel("Pengelola Zakat", { exact: true }).selectOption(SINAR);
      await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();
      await page.getByRole("button", { name: /Pengajuan Browser Sintetis/ }).click();
      await page.getByRole("button", { name: "Ajukan untuk Pemeriksaan", exact: true }).click();
      await page.getByRole("alert").getByText(/surat permohonan wajib/).waitFor();
      for (const [category, name] of [["PROPOSAL_LETTER", "surat-browser.txt"], ["BENEFICIARY_IDENTITY", "identitas-browser.txt"]]) {
        await page.getByLabel("Kategori Dokumen", { exact: true }).selectOption(category!);
        await page.getByLabel("Penerima Manfaat (Opsional)", { exact: true }).selectOption(category === "PROPOSAL_LETTER" ? "" : "ben-fixture");
        await page.getByLabel("Pilih Berkas (Maks. 10 MB)", { exact: true }).setInputFiles({ name: name!, mimeType: "text/plain", buffer: Buffer.from("Bukti sintetis é ✓") });
        await page.getByRole("button", { name: "Unggah Dokumen", exact: true }).focus();
        await page.keyboard.press("Enter");
        await page.getByText(name!, { exact: true }).waitFor();
      }
      await page.getByRole("button", { name: "Ajukan untuk Pemeriksaan", exact: true }).click();
      await page.getByText("Menunggu Pemeriksaan", { exact: true }).waitFor();
      const switchTo = async (account: typeof wallet) => {
        await page.getByRole("button", { name: "Keluar", exact: true }).click();
        wallet = account;
        await page.getByRole("button", { name: "Ganti akun sintetis", exact: true }).click();
        await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();
        await page.getByRole("button", { name: "Antrean Pemeriksa & Revisi", exact: true }).click();
      };
      const openExamination = async () => {
        const row = page.locator("div.flex.flex-wrap.items-center.justify-between").filter({ has: page.getByText("Pengajuan Browser Sintetis", { exact: true }) });
        await row.getByRole("button", { name: "Periksa Kelayakan", exact: true }).click();
        await page.getByRole("dialog").getByText(/tercatat menerima bantuan/).waitFor();
      };
      await switchTo(examinerSinar);
      await openExamination();
      let dialog = page.getByRole("dialog");
      expect(await dialog.getByText(/Rp\s?150\.000/).count()).toBe(1);
      const downloadEvent = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "Unduh", exact: true }).first().click();
      const download = await downloadEvent;
      expect(await Bun.file((await download.path())!).text()).toBe("Bukti sintetis é ✓");
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((node: HTMLElement) => node.contains(document.activeElement))).toBe(true);
      await dialog.getByRole("button", { name: "Kembalikan untuk Revisi", exact: true }).click();
      await dialog.getByLabel("Alasan pengembalian untuk revisi", { exact: true }).fill("Perjelas surat permohonan");
      await dialog.getByRole("button", { name: "Konfirmasi Kembalikan untuk Revisi", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await switchTo(amilSinar);
      await page.getByRole("button", { name: /Antrean Revisi Amil/ }).click();
      await page.getByRole("button", { name: "Buka Draf Revisi", exact: true }).click();
      await page.getByText(/Perjelas surat permohonan/).waitFor();
      await page.getByRole("button", { name: "Ajukan untuk Pemeriksaan", exact: true }).click();
      await page.getByText("Menunggu Pemeriksaan", { exact: true }).waitFor();
      await switchTo(examinerSinar);
      await openExamination();
      dialog = page.getByRole("dialog");
      expect(await dialog.getByLabel("Administrasi lengkap dan sesuai", { exact: true }).isChecked()).toBe(false);
      await dialog.getByLabel("Administrasi lengkap dan sesuai", { exact: true }).check();
      await dialog.getByLabel("Kelayakan asnaf dan kebutuhan memenuhi syarat", { exact: true }).check();
      await dialog.getByLabel("Hasil telaah dan alasan pengecualian bantuan berulang", { exact: true }).fill("Bantuan tambahan darurat sesuai survei.");
      await dialog.getByRole("button", { name: "Nyatakan Siap Diputus", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      expect((await (await get(`/proposals/${fixture.draft.id}`, fixture.amilToken)).json()).draft.status).toBe("READY_FOR_DECISION");
      expect(errors).toEqual([]);
    } catch (error) {
      await Bun.write("/tmp/zkt-examination-browser-failure.html", await page.content());
      throw error;
    } finally { await browser.close(); await server.stop(true); }
  }, 60_000);

});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { createEvidenceStore, type EvidenceStore } from "../src/evidence-store";
import { createEncryptedFileStore, type PrivateFileStore } from "../src/evidence-files";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import type { EthCall } from "../src/account-signature";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { createReportPackages } from "../src/report-package";

const WORKSPACE = "http://localhost:3001/api/workspace";
const EVIDENCE = "http://localhost:3001/api/evidence";

const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";

const auditor = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
const amil = privateKeyToAccount(`0x${"22".repeat(32)}` as Hex);
const amilTanpaMandat = privateKeyToAccount(`0x${"33".repeat(32)}` as Hex);
const reader = privateKeyToAccount(`0x${"44".repeat(32)}` as Hex);
const rivalAuditor = privateKeyToAccount(`0x${"55".repeat(32)}` as Hex);
const admin = privateKeyToAccount(`0x${"99".repeat(32)}` as Hex);

const NOW = 1_800_000_000;
const KEY = Buffer.alloc(32, 7);

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let evidence: EvidenceStore;
let fileDirectory: string;
let fileStore: PrivateFileStore;
let clock = NOW;

const ethCall: EthCall = async () => "0x";

const request = (url: string, init: RequestInit = {}) => app.fetch(new Request(url, init));

const post = (url: string, body: unknown, token?: string) =>
  request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const get = (url: string, token?: string) =>
  request(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

async function signIn(account: typeof auditor, institutionId: string): Promise<string> {
  const minted = await post(`${WORKSPACE}/challenge`, { institutionId, account: account.address });
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

describe("Issue #99: Auditor findings, amil responses, and examination follow-ups", () => {
  beforeAll(async () => {
    database = await createTestWorkspaceDatabase();
    store = createWorkspaceStore(database.handle());
    evidence = createEvidenceStore(database.handle());
    await store.ensureSchema();
    await evidence.ensureSchema();
    fileDirectory = await mkdtemp(join(tmpdir(), "audit-findings-test-"));
    fileStore = createEncryptedFileStore({ directory: fileDirectory, key: KEY });

    configureWorkspace({
      store,
      evidence,
      files: fileStore,
      registry: {
        chain: {
          auditorAuthority: async (_inst: string, acct: Hex) => ({
            active: acct.toLowerCase() === auditor.address.toLowerCase() || acct.toLowerCase() === rivalAuditor.address.toLowerCase(),
            epoch: "1",
            mandate: "Surat Penugasan Audit Independen 2026",
            accountKind: "EOA" as const,
          }),
        } as any,
        store: null as any,
      } as any,
      ethCall,
      now: () => clock,
      challengeTtlSeconds: 300,
      sessionTtlSeconds: 86400,
    });
  });

  afterAll(async () => {
    resetWorkspace();
    await database.close();
    await rm(fileDirectory, { recursive: true, force: true });
  });

  let auditorToken: string;
  let amilToken: string;
  let amilTanpaMandatToken: string;
  let readerToken: string;
  let rivalToken: string;

  let preparationId: string;
  let packageId: string;
  let packageDigest: string;

  beforeEach(async () => {
    await database.reset();
    clock = NOW;

    // 1. Setup institutions
    for (const institution of SYNTHETIC_INSTITUTIONS) {
      await store.upsertInstitution(institutionRecordOf(institution));
    }

    // 2. Memberships
    await store.upsertMembership({
      account: admin.address.toLowerCase(),
      institutionId: SINAR,
      role: "ADMIN",
    });
    await store.upsertMembership({
      account: auditor.address.toLowerCase(),
      institutionId: SINAR,
      role: "OFFICER",
    });
    await store.upsertMembership({
      account: amil.address.toLowerCase(),
      institutionId: SINAR,
      role: "OFFICER",
    });
    await store.upsertMembership({
      account: amilTanpaMandat.address.toLowerCase(),
      institutionId: SINAR,
      role: "OFFICER",
    });
    await store.upsertMembership({
      account: reader.address.toLowerCase(),
      institutionId: SINAR,
      role: "READER",
    });
    await store.upsertMembership({
      account: rivalAuditor.address.toLowerCase(),
      institutionId: BAITUL,
      role: "ADMIN",
    });

    // 3. Officers & Mandates
    const amilOfficer = await store.createOfficerProfile({
      institutionId: SINAR,
      displayName: "Ust. Fajar (Amil Penyaluran)",
      account: amil.address,
      role: "OFFICER",
      actor: admin.address,
      now: clock,
    });
    await store.grantMandate({
      institutionId: SINAR,
      actor: admin.address,
      now: clock,
      mandate: {
        officerId: amilOfficer.id,
        accountAddress: amil.address,
        function: "HANDLE_REPORT_EXAMINATION",
        scopeType: "ALL_PROGRAMS",
        validFrom: clock - 1000,
        validUntil: clock + 100000,
        assignmentRef: "SK-DIREKSI/2026/09",
      },
    });

    await store.createOfficerProfile({
      institutionId: SINAR,
      displayName: "Staf Magang (Tanpa Mandat)",
      account: amilTanpaMandat.address,
      role: "OFFICER",
      actor: admin.address,
      now: clock,
    });

    await store.createOfficerProfile({
      institutionId: SINAR,
      displayName: "Drs. H. Mulyadi (Auditor)",
      account: auditor.address,
      role: "OFFICER",
      actor: admin.address,
      now: clock,
    });

    await store.createOfficerProfile({
      institutionId: BAITUL,
      displayName: "Auditor Lembaga Lain",
      account: rivalAuditor.address,
      role: "ADMIN",
      actor: rivalAuditor.address,
      now: clock,
    });

    // 4. Create Preparation and Report Package
    preparationId = "prep-2026-audit";
    await evidence.savePreparation({
      id: preparationId,
      institutionId: SINAR,
      preparedBy: amil.address.toLowerCase(),
      label: "Laporan Semester I 2026",
      periodKind: "SEMESTER",
      periodYear: 2026,
      currencyUnit: "IDR",
      outcome: "RECONCILED",
      commitment: "0x" + "aa".repeat(32),
      commitmentScheme: "HMAC-SHA256",
      commitmentSalt: "0x" + "bb".repeat(32),
      canonicalSnapshot: JSON.stringify({ period: { kind: "SEMESTER", year: 2026 }, reportId: "LPZ-2026-S1", version: "1" }),
      resultJson: JSON.stringify({ discrepancies: [] }),
      publicSummary: { format: "tawf.report.public", version: 1 } as any,
      createdAt: clock,
      sides: [],
      findings: [],
      files: [],
    });

    packageId = "pkg-2026-v1";
    packageDigest = "0x" + "11".repeat(32);
    await evidence.saveReportPackage(
      SINAR,
      preparationId,
      packageId,
      JSON.stringify({ reportId: "LPZ-2026-S1", version: "1", period: { kind: "SEMESTER", year: 2026 } }),
      packageDigest,
    );

    // Sign in tokens
    auditorToken = await signIn(auditor, SINAR);
    amilToken = await signIn(amil, SINAR);
    amilTanpaMandatToken = await signIn(amilTanpaMandat, SINAR);
    readerToken = await signIn(reader, SINAR);
    rivalToken = await signIn(rivalAuditor, BAITUL);
  });

  it("rejects reader account attempting to record an auditor finding (AC11)", async () => {
    const res = await post(
      `${EVIDENCE}/${preparationId}/reports/${packageId}/findings`,
      {
        scope: "REALISASI",
        severity: "TEMUAN_RINGAN",
        title: "Pemeriksaan fiktif oleh reader",
        description: "Mencoba membuat temuan tanpa wewenang auditor",
      },
      readerToken,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Akun pembaca biasa tidak dapat menulis temuan sebagai auditor");
  });

  it("validates finding inputs and missing fields", async () => {
    // Missing title
    const resNoTitle = await post(
      `${EVIDENCE}/${preparationId}/reports/${packageId}/findings`,
      {
        scope: "REALISASI",
        severity: "TEMUAN_RINGAN",
        description: "Deskripsi saja",
      },
      auditorToken,
    );
    expect(resNoTitle.status).toBe(400);

    // Invalid scope
    const resInvalidScope = await post(
      `${EVIDENCE}/${preparationId}/reports/${packageId}/findings`,
      {
        scope: "BUKAN_SCOPE_SAH",
        severity: "TEMUAN_RINGAN",
        title: "Judul",
        description: "Deskripsi",
      },
      auditorToken,
    );
    expect(resInvalidScope.status).toBe(400);

    // Non-existent package
    const resNotFound = await post(
      `${EVIDENCE}/${preparationId}/reports/package-khayalan/findings`,
      {
        scope: "REALISASI",
        severity: "TEMUAN_RINGAN",
        title: "Judul",
        description: "Deskripsi",
      },
      auditorToken,
    );
    expect(resNotFound.status).toBe(404);
  });

  it("creates auditor finding bound to exact report version and package identity", async () => {
    const workingPaperContent = Buffer.from("Catatan rahasia kertas kerja auditor").toString("base64");

    const res = await post(
      `${EVIDENCE}/${preparationId}/reports/${packageId}/findings`,
      {
        scope: "REALISASI",
        severity: "TEMUAN_MATERIAL",
        title: "Kwitansi Penyerahan Beras Belum Melampirkan BAST Kelompok",
        description: "Pada tahap realisasi bantuan sembako kec. Tampan, 15 penerima belum memiliki tanda terima terverifikasi.",
        targetProposalId: "prop-sembako-01",
        targetProposalVersion: 1,
        targetRealizationId: "real-2026-088",
        workingPapers: [
          {
            fileName: "kertas_kerja_audit_sample.pdf",
            mimeType: "application/pdf",
            contentBase64: workingPaperContent,
          },
        ],
      },
      auditorToken,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.finding.institutionId).toBe(SINAR);
    expect(body.finding.preparationId).toBe(preparationId);
    expect(body.finding.packageId).toBe(packageId);
    expect(body.finding.packageDigest).toBe(packageDigest);
    expect(body.finding.status).toBe("OPEN");
    expect(body.finding.scope).toBe("REALISASI");
    expect(body.finding.severity).toBe("TEMUAN_MATERIAL");
    expect(body.finding.events).toHaveLength(1);
    expect(body.finding.events[0].eventType).toBe("FINDING_CREATED");
    expect(body.finding.events[0].actorRole).toBe("AUDITOR");
    expect(body.finding.events[0].attachments).toHaveLength(1);
    expect(body.finding.events[0].attachments[0].isOwnerOnly).toBe(true);
  });

  it("completes full lifecycle: finding -> amil response -> auditor follow-up -> closure (AC21, AC28)", async () => {
    // 1. Auditor creates finding
    const createRes = await post(
      `${EVIDENCE}/${preparationId}/reports/${packageId}/findings`,
      {
        scope: "DOKUMEN_BUKTI",
        severity: "CATATAN",
        title: "Perbedaan Tanggal BAST dan Bukti Transfer",
        description: "BAST bertanggal 10 Juni sedangkan transfer bank tercatat 12 Juni.",
      },
      auditorToken,
    );
    expect(createRes.status).toBe(201);
    const findingId = (await createRes.json()).finding.id;

    // 2. Queues check: should be in Amil action queue, not in Auditor queue
    const queueRes1 = await get(`${EVIDENCE}/audit-findings/queues`, amilToken);
    expect(queueRes1.status).toBe(200);
    const queues1 = (await queueRes1.json()).queues;
    expect(queues1.amilActionQueue.some((f: any) => f.id === findingId)).toBe(true);
    expect(queues1.auditorReviewQueue.some((f: any) => f.id === findingId)).toBe(false);

    // 3. Amil without HANDLE_REPORT_EXAMINATION mandate is rejected
    const unmandatedRes = await post(
      `${EVIDENCE}/audit-findings/${findingId}/responses`,
      { note: "Tanggapan tanpa mandat" },
      amilTanpaMandatToken,
    );
    expect(unmandatedRes.status).toBe(403);
    expect((await unmandatedRes.json()).error).toMatch(/pemeriksaan laporan|HANDLE_REPORT_EXAMINATION/i);

    // 4. Authorized Amil responds with explanation and attachment
    const amilDocContent = Buffer.from("Surat klarifikasi bank dan penyerahan bertahap").toString("base64");
    const amilResponseRes = await post(
      `${EVIDENCE}/audit-findings/${findingId}/responses`,
      {
        note: "Penyaluran dilakukan tunai di lapangan pada 10 Juni, penggantian kas operasional dicatat pada mutasi bank 12 Juni. Terlampir BAST asli dan memo kas.",
        attachments: [
          {
            fileName: "memo_kas_penyaluran.pdf",
            mimeType: "application/pdf",
            contentBase64: amilDocContent,
          },
        ],
      },
      amilToken,
    );
    expect(amilResponseRes.status).toBe(200);
    const bodyAfterAmil = await amilResponseRes.json();
    expect(bodyAfterAmil.finding.status).toBe("DITANGGAPI");
    expect(bodyAfterAmil.finding.events).toHaveLength(2);
    expect(bodyAfterAmil.finding.events[1].eventType).toBe("AMIL_RESPONSE");
    expect(bodyAfterAmil.finding.events[1].actorRole).toBe("AMIL");
    expect(bodyAfterAmil.finding.events[1].attachments).toHaveLength(1);
    expect(bodyAfterAmil.finding.events[1].attachments[0].isOwnerOnly).toBe(false);

    // 5. Queues check: moved to Auditor review queue
    const queueRes2 = await get(`${EVIDENCE}/audit-findings/queues`, auditorToken);
    const queues2 = (await queueRes2.json()).queues;
    expect(queues2.amilActionQueue.some((f: any) => f.id === findingId)).toBe(false);
    expect(queues2.auditorReviewQueue.some((f: any) => f.id === findingId)).toBe(true);

    // 6. Amil CANNOT close or set follow-up on the finding
    const amilIllegalFollowup = await post(
      `${EVIDENCE}/audit-findings/${findingId}/follow-ups`,
      { action: "SELESAI_DITUTUP", note: "Amil menutup sendiri" },
      amilToken,
    );
    expect(amilIllegalFollowup.status).toBe(403);

    // 7. Auditor requests further clarification -> DITINDAKLANJUTI
    const auditorClarifyRes = await post(
      `${EVIDENCE}/audit-findings/${findingId}/follow-ups`,
      {
        action: "MINTA_KLARIFIKASI_LANJUTAN",
        note: "Harap lampirkan tanda tangan penerima kuasa penerimaan kas.",
      },
      auditorToken,
    );
    expect(auditorClarifyRes.status).toBe(200);
    const bodyAfterClarify = await auditorClarifyRes.json();
    expect(bodyAfterClarify.finding.status).toBe("DITINDAKLANJUTI");
    expect(bodyAfterClarify.finding.events).toHaveLength(3);

    // 8. Amil provides second response
    const amilSecondRes = await post(
      `${EVIDENCE}/audit-findings/${findingId}/responses`,
      { note: "Surat kuasa bermaterai telah dilampirkan." },
      amilToken,
    );
    expect(amilSecondRes.status).toBe(200);
    expect((await amilSecondRes.json()).finding.status).toBe("DITANGGAPI");

    // 9. Auditor closes finding -> DITUTUP_AUDITOR
    const auditorCloseRes = await post(
      `${EVIDENCE}/audit-findings/${findingId}/follow-ups`,
      {
        action: "SELESAI_DITUTUP",
        note: "Klarifikasi dan dokumen bukti tambahan telah memadai. Temuan diselesaikan.",
      },
      auditorToken,
    );
    expect(auditorCloseRes.status).toBe(200);
    const bodyAfterClose = await auditorCloseRes.json();
    expect(bodyAfterClose.finding.status).toBe("DITUTUP_AUDITOR");
    expect(bodyAfterClose.finding.events).toHaveLength(5);
    expect(bodyAfterClose.finding.events[4].eventType).toBe("AUDITOR_CLOSED");

    // 10. Closed finding is no longer in action queues
    const queueRes3 = await get(`${EVIDENCE}/audit-findings/queues`, auditorToken);
    const queues3 = (await queueRes3.json()).queues;
    expect(queues3.amilActionQueue.some((f: any) => f.id === findingId)).toBe(false);
    expect(queues3.auditorReviewQueue.some((f: any) => f.id === findingId)).toBe(false);

    // 11. Responding to a closed finding is rejected with 409
    const lateResponse = await post(
      `${EVIDENCE}/audit-findings/${findingId}/responses`,
      { note: "Tanggapan terlambat pada temuan yang sudah ditutup" },
      amilToken,
    );
    expect(lateResponse.status).toBe(409);
  });

  it("enforces tenant isolation: Lembaga B cannot view or mutate findings of Lembaga A (AC11, AC29)", async () => {
    // 1. Create finding on SINAR
    const createRes = await post(
      `${EVIDENCE}/${preparationId}/reports/${packageId}/findings`,
      {
        scope: "SUMBER_DATA",
        severity: "INFO",
        title: "Pemeriksaan Sumber Sinar",
        description: "Data transaksi internal konsisten dengan cut-off.",
      },
      auditorToken,
    );
    const findingId = (await createRes.json()).finding.id;

    // 2. Rival auditor on BAITUL tries to get finding -> 404
    const getRes = await get(`${EVIDENCE}/audit-findings/${findingId}`, rivalToken);
    expect(getRes.status).toBe(404);

    // 3. Rival auditor on BAITUL tries to respond -> 404/403
    const respondRes = await post(
      `${EVIDENCE}/audit-findings/${findingId}/responses`,
      { note: "Interferensi asing" },
      rivalToken,
    );
    expect(respondRes.status).toBe(403); // Fails mandate check on session's institution
  });

  it("preserves owner-only working paper privacy while permitting examination downloads (AC23)", async () => {
    const wpContent = "Rahasia internal auditor catatan risiko";
    const amilDocContent = "Bukti publikasi pengumuman terbuka";

    // 1. Auditor creates finding with owner-only working paper
    const createRes = await post(
      `${EVIDENCE}/${preparationId}/reports/${packageId}/findings`,
      {
        scope: "KEPATUHAN_SYARIAH",
        severity: "CATATAN",
        title: "Kertas Kerja Kepatuhan Asnaf",
        description: "Catatan penelaahan kesesuaian kategori asnaf fakir miskin.",
        workingPapers: [
          {
            fileName: "kertas_kerja_auditor.txt",
            mimeType: "text/plain",
            contentBase64: Buffer.from(wpContent).toString("base64"),
          },
        ],
      },
      auditorToken,
    );
    const finding = (await createRes.json()).finding;
    const findingId = finding.id;
    const wpAttachmentId = finding.events[0].attachments[0].id;

    // 2. Amil responds with shared attachment
    const amilRes = await post(
      `${EVIDENCE}/audit-findings/${findingId}/responses`,
      {
        note: "Melampirkan BAST konfirmasi tim amil",
        attachments: [
          {
            fileName: "bast_amil_bersama.txt",
            mimeType: "text/plain",
            contentBase64: Buffer.from(amilDocContent).toString("base64"),
          },
        ],
      },
      amilToken,
    );
    const amilAttachmentId = (await amilRes.json()).finding.events[1].attachments[0].id;

    // 3. Auditor can download their own working paper
    const dlAuditorWp = await get(`${EVIDENCE}/audit-findings/${findingId}/attachments/${wpAttachmentId}`, auditorToken);
    expect(dlAuditorWp.status).toBe(200);
    expect(await dlAuditorWp.text()).toBe(wpContent);

    // 4. Amil CANNOT download the auditor's owner-only working paper -> 403 (AC23)
    const dlAmilWp = await get(`${EVIDENCE}/audit-findings/${findingId}/attachments/${wpAttachmentId}`, amilToken);
    expect(dlAmilWp.status).toBe(403);
    expect(await dlAmilWp.text()).toContain("Kertas kerja auditor privat");

    // 5. Both Amil and Auditor can download the shared Amil attachment
    const dlAmilDocByAmil = await get(`${EVIDENCE}/audit-findings/${findingId}/attachments/${amilAttachmentId}`, amilToken);
    expect(dlAmilDocByAmil.status).toBe(200);
    expect(await dlAmilDocByAmil.text()).toBe(amilDocContent);

    const dlAmilDocByAuditor = await get(`${EVIDENCE}/audit-findings/${findingId}/attachments/${amilAttachmentId}`, auditorToken);
    expect(dlAmilDocByAuditor.status).toBe(200);
    expect(await dlAmilDocByAuditor.text()).toBe(amilDocContent);
  });

  it("preserves public summary isolation: public endpoints never leak audit findings or private locators (AC30)", async () => {
    // 1. Create an audit finding with sensitive text
    const secretFindingTitle = "SELISIH_RAHASIA_INTERNAL_BANK";
    const secretFindingDesc = "Ditemukan transaksi rekening perantara yang belum diakui";
    const createRes = await post(
      `${EVIDENCE}/${preparationId}/reports/${packageId}/findings`,
      {
        scope: "SUMBER_DATA",
        severity: "TEMUAN_MATERIAL",
        title: secretFindingTitle,
        description: secretFindingDesc,
      },
      auditorToken,
    );
    expect(createRes.status).toBe(201);
    const findingId = (await createRes.json()).finding.id;

    // 2. Unauthenticated access to finding is rejected (401)
    const unauthFinding = await get(`${EVIDENCE}/audit-findings/${findingId}`);
    expect(unauthFinding.status).toBe(401);

    // 3. Unauthenticated access to queue is rejected (401)
    const unauthQueue = await get(`${EVIDENCE}/audit-findings/queues`);
    expect(unauthQueue.status).toBe(401);

    // 4. Public report summary never exposes audit findings or private attachments (AC30)
    await evidence.savePublicReport(packageId, {
      format: "tawf.report.public",
      version: 1,
      packageId,
      packageDigest,
      outcome: "RECONCILED",
    });

    const publicReport = await evidence.getPublicReport(packageId);
    expect(publicReport).toBeDefined();
    const publicReportJson = JSON.stringify(publicReport);
    expect(publicReportJson).not.toContain(secretFindingTitle);
    expect(publicReportJson).not.toContain(secretFindingDesc);
    expect(publicReportJson).not.toContain(findingId);
    expect(publicReportJson).not.toContain("afa_");
  });
});

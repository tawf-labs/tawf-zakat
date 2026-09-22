/**
 * Temuan pemeriksaan, tanggapan amil dan tindak lanjut (Issue #99).
 *
 * Auditor authority is read from a ReportEvidenceRegistry deployed on a local
 * Anvil node - granted, revoked and re-granted with real transactions - never
 * from a stubbed answer. Rows live in PGlite, files in the encrypted file store,
 * and durability is tested by closing and reopening the database. The only
 * fixture rows are operational records a finding can point at.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { foundry } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { startAnvil } from "./helpers/anvil-fixture";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { createEvidenceStore, type EvidenceStore } from "../src/evidence-store";
import { createDisbursementStore } from "../src/disbursement-store";
import { createAuditFindingStore } from "../src/audit-finding-store";
import { createContributionStore } from "../src/contribution-store";
import { createActivityStore } from "../src/activity-store";
import { createEncryptedFileStore } from "../src/evidence-files";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { commitmentFor, newCommitmentSalt } from "../src/evidence-snapshot";
import { createRegistryStore } from "../src/registry-store";
import { createRegistryChain } from "../src/registry-chain";
import { reportRegistryAbi } from "../../shared/report-registry-abi";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import type { EthCall } from "../src/account-signature";

const WORKSPACE = "http://localhost:3001/api/workspace";
const EVIDENCE = "http://localhost:3001/api/evidence";
const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";

// Published local Anvil keys. This suite never accepts a network URL from the environment.
const deployer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const relayerKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const rpcUrl = "http://127.0.0.1:18592";
const rpc = createPublicClient({ chain: foundry, transport: http(rpcUrl, { retryCount: 0, timeout: 500 }) });
const wallet = createWalletClient({ account: deployer, chain: foundry, transport: http(rpcUrl) });

const key = (n: string) => privateKeyToAccount(`0x${n.repeat(32)}` as Hex);
const auditor = key("11");      // READER membership + registry mandate: authority comes from the registry.
const auditorB = key("12");     // Second auditor of the same institution.
const amil = key("22");         // HANDLE_REPORT_EXAMINATION mandate.
const amilTanpaMandat = key("33");
const reader = key("44");
const rival = key("55");        // Auditor of another institution.
const admin = key("99");        // Workspace ADMIN without a registry mandate.

const NOW = 1_800_000_000;
const FILE_KEY = Buffer.alloc(32, 7);
const SALT = newCommitmentSalt();
const PREPARATION = "prep-2026-audit";

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let evidence: EvidenceStore;
let fileDirectory: string;
let clock = NOW;
let anvil: Awaited<ReturnType<typeof startAnvil>>;
let registryAddress: Hex;
let chain: ReturnType<typeof createRegistryChain>;
let withRegistry = true;

const ethCall: EthCall = async () => "0x";
const request = (url: string, init: RequestInit = {}) => app.fetch(new Request(url, init));
const post = (url: string, body: unknown, token?: string) => request(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const get = (url: string, token?: string) => request(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

const writeRegistry = async (functionName: string, args: readonly unknown[]) =>
  rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registryAddress, abi: reportRegistryAbi, functionName, args } as any) });
const setAuditor = (institution: string, account: Hex, active: boolean, mandate: string) =>
  writeRegistry("setAuditor", [institution, account, active, mandate]);

async function configure() {
  const handle = database.handle();
  store = createWorkspaceStore(handle);
  evidence = createEvidenceStore(handle);
  const registryStore = createRegistryStore(handle);
  await registryStore.ensureSchema();
  configureWorkspace({
    store,
    evidence,
    disbursement: createDisbursementStore(handle),
    contributions: createContributionStore(handle),
    activities: createActivityStore(handle),
    auditFindings: createAuditFindingStore(handle),
    files: createEncryptedFileStore({ directory: fileDirectory, key: FILE_KEY }),
    ...(withRegistry ? { registry: { store: registryStore, chain } as any } : {}),
    ethCall,
    now: () => clock,
    challengeTtlSeconds: 300,
    sessionTtlSeconds: 86400,
  });
}

async function signIn(account: typeof auditor, institutionId: string): Promise<string> {
  const minted = await post(`${WORKSPACE}/challenge`, { institutionId, account: account.address });
  const { challenge, typedData } = await minted.json();
  const signature = await account.signTypedData({
    ...typedData,
    message: { ...typedData.message, issuedAt: BigInt(typedData.message.issuedAt), expiresAt: BigInt(typedData.message.expiresAt) },
  });
  const session = await post(`${WORKSPACE}/session`, { nonce: challenge.nonce, signature });
  expect(session.status).toBe(201);
  return (await session.json()).token;
}

/** A report version stored the way the package service stores it: canonical bytes committed under the preparation salt. */
async function saveVersion(id: string, version: string, predecessor: string | null = null, status = "FROZEN") {
  const canonical = JSON.stringify({ id, status, reportId: "LPZ-2026-S1", version, predecessor, preparationId: PREPARATION });
  const digest = commitmentFor(new TextEncoder().encode(canonical), SALT);
  await evidence.saveReportPackage(SINAR, PREPARATION, id, canonical, digest);
  return digest;
}

const b64 = (value: string) => Buffer.from(value).toString("base64");
const findingsUrl = (packageId = "pkg-v1") => `${EVIDENCE}/${PREPARATION}/reports/${packageId}/findings`;
const findingUrl = (id: string, tail = "") => `${EVIDENCE}/audit-findings/${id}${tail}`;

let tokens: Record<"auditor" | "auditorB" | "amil" | "amilTanpaMandat" | "reader" | "rival" | "admin", string>;
let digestV1: string;
let op = 0;
const nextOp = () => `op-${++op}`;

async function createFinding(overrides: Record<string, unknown> = {}, token = tokens.auditor) {
  const res = await post(findingsUrl(), {
    operationId: nextOp(),
    packageDigest: digestV1,
    scope: "REALISASI",
    severity: "TEMUAN_MATERIAL",
    title: "BAST kelompok belum dilampirkan",
    description: "15 penerima di Kec. Tampan belum memiliki tanda terima terverifikasi.",
    ...overrides,
  }, token);
  return res;
}
async function created(overrides: Record<string, unknown> = {}) {
  const res = await createFinding(overrides);
  expect(res.status).toBe(201);
  return (await res.json()).finding;
}

beforeAll(async () => {
  anvil = await startAnvil(18592);
  const artifact = await Bun.file(new URL("../../sc/out/ReportEvidenceRegistry.sol/ReportEvidenceRegistry.json", import.meta.url)).json();
  const deployment = await wallet.deployContract({ abi: reportRegistryAbi, bytecode: artifact.bytecode.object, args: [deployer.address] });
  registryAddress = (await rpc.waitForTransactionReceipt({ hash: deployment })).contractAddress!;
  await writeRegistry("enrollInstitution", [SINAR, deployer.address]);
  await writeRegistry("enrollInstitution", [BAITUL, deployer.address]);
  chain = createRegistryChain({ rpcUrl, chainId: 31337, address: registryAddress, requiredConfirmations: 1, privateKey: relayerKey });

  database = await createTestWorkspaceDatabase();
  fileDirectory = await mkdtemp(join(tmpdir(), "audit-findings-test-"));
  const handle = database.handle();
  await createWorkspaceStore(handle).ensureSchema();
  await createEvidenceStore(handle).ensureSchema();
  await createDisbursementStore(handle).ensureSchema();
  await createContributionStore(handle).ensureSchema();
  await createActivityStore(handle).ensureSchema();
  await createAuditFindingStore(handle).ensureSchema();
  await configure();
}, 30000);

afterAll(async () => {
  resetWorkspace();
  await database.close();
  await rm(fileDirectory, { recursive: true, force: true });
  if (anvil) await anvil.stop();
});

beforeEach(async () => {
  await database.reset();
  withRegistry = true;
  await configure();
  clock = NOW;
  // The registry outlives each test; every test starts from the same mandates.
  await setAuditor(SINAR, auditor.address, true, "Surat penugasan audit 2026/01");
  await setAuditor(SINAR, auditorB.address, true, "Surat penugasan audit 2026/02");
  await setAuditor(BAITUL, rival.address, true, "Surat penugasan Baitul 2026");

  for (const institution of SYNTHETIC_INSTITUTIONS) await store.upsertInstitution(institutionRecordOf(institution));
  const member = (account: typeof auditor, institutionId: string, role: "ADMIN" | "OFFICER" | "READER") =>
    store.upsertMembership({ account: account.address.toLowerCase(), institutionId, role });
  await member(admin, SINAR, "ADMIN");
  await member(auditor, SINAR, "READER");
  await member(auditorB, SINAR, "OFFICER");
  await member(amil, SINAR, "OFFICER");
  await member(amilTanpaMandat, SINAR, "OFFICER");
  await member(reader, SINAR, "READER");
  await member(rival, BAITUL, "ADMIN");

  const amilOfficer = await store.createOfficerProfile({
    institutionId: SINAR, displayName: "Ust. Fajar (Amil Pemeriksaan)", account: amil.address, role: "OFFICER", actor: admin.address, now: clock,
  });
  await store.grantMandate({
    institutionId: SINAR, actor: admin.address, now: clock,
    mandate: {
      officerId: amilOfficer.id, accountAddress: amil.address, function: "HANDLE_REPORT_EXAMINATION",
      scopeType: "ALL_PROGRAMS", validFrom: clock - 1000, validUntil: clock + 100000, assignmentRef: "SK-DIREKSI/2026/09",
    },
  });
  await store.createOfficerProfile({
    institutionId: SINAR, displayName: "Staf Magang", account: amilTanpaMandat.address, role: "OFFICER", actor: admin.address, now: clock,
  });

  await evidence.savePreparation({
    id: PREPARATION, institutionId: SINAR, preparedBy: amil.address.toLowerCase(), label: "Laporan Semester I 2026",
    periodKind: "SEMESTER", periodYear: 2026, currencyUnit: "IDR", outcome: "RECONCILED",
    commitment: `0x${"aa".repeat(32)}`, commitmentScheme: "HMAC-SHA256", commitmentSalt: SALT,
    canonicalSnapshot: JSON.stringify({ period: { kind: "SEMESTER", year: 2026 } }), resultJson: JSON.stringify({ discrepancies: [] }),
    publicSummary: { format: "tawf.report.public", version: 1 } as any, createdAt: clock, sides: [], findings: [], files: [],
  });
  digestV1 = await saveVersion("pkg-v1", "1");

  tokens = {
    auditor: await signIn(auditor, SINAR),
    auditorB: await signIn(auditorB, SINAR),
    amil: await signIn(amil, SINAR),
    amilTanpaMandat: await signIn(amilTanpaMandat, SINAR),
    reader: await signIn(reader, SINAR),
    rival: await signIn(rival, BAITUL),
    admin: await signIn(admin, SINAR),
  };
});

describe("Issue #99: temuan auditor, tanggapan amil dan tindak lanjut", () => {
  it("writes as auditor only with a registry mandate; membership, ADMIN and a missing registry never stand in", async () => {
    for (const token of [tokens.reader, tokens.admin, tokens.amilTanpaMandat]) {
      const res = await createFinding({}, token);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain("mandat auditor aktif pada registry");
    }
    // The amil of this examination cannot become its auditor either.
    await setAuditor(SINAR, amil.address, true, "Penugasan keliru");
    expect((await createFinding({}, tokens.amil)).status).toBe(403);
    await setAuditor(SINAR, amil.address, false, "dicabut");

    // A READER membership with a registry mandate is an auditor: the registry decides.
    expect((await createFinding()).status).toBe(201);

    withRegistry = false;
    await configure();
    expect((await createFinding()).status).toBe(503);
  });

  it("binds the finding to the exact frozen version, digest and existing operational records", async () => {
    // A stale digest, a draft version and an unknown package are all refused.
    expect((await createFinding({ packageDigest: `0x${"00".repeat(32)}` })).status).toBe(409);
    await saveVersion("pkg-draft", "2", null, "DRAFT");
    const draftRes = await post(findingsUrl("pkg-draft"), { operationId: nextOp(), packageDigest: digestV1, scope: "LAINNYA", severity: "INFO", title: "x", description: "y" }, tokens.auditor);
    expect(draftRes.status).toBe(409);
    expect((await post(findingsUrl("pkg-missing"), { operationId: nextOp(), packageDigest: digestV1, scope: "LAINNYA", severity: "INFO", title: "x", description: "y" }, tokens.auditor)).status).toBe(404);
    // Free-text references are checked against this institution's records.
    const unknown = await createFinding({ targets: { realizationId: "real-khayalan" } });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error).toContain("realisasi");
    expect((await createFinding({ scope: "BUKAN_SCOPE" })).status).toBe(400);
    expect((await createFinding({ workingPapers: [{ fileName: "a.pdf", mimeType: "application/pdf", contentBase64: "bukan base64!!" }] })).status).toBe(400);

    const handle = database.handle();
    await handle.execute(sql`INSERT INTO programs (id, institution_id, name, purpose, fund_type, scope, created_by, created_at, updated_at)
      VALUES ('prog-1', ${SINAR}, 'Sembako', 'Bantuan pangan', 'ZAKAT', 'KECAMATAN', 'fixture', ${clock}, ${clock})`);
    await handle.execute(sql`INSERT INTO proposal_drafts (id, institution_id, program_id, created_by, created_at, updated_at)
      VALUES ('prop-1', ${SINAR}, 'prog-1', 'fixture', ${clock}, ${clock})`);
    await handle.execute(sql`INSERT INTO proposal_versions (proposal_id, version, institution_id, status, data_json, created_at)
      VALUES ('prop-1', 1, ${SINAR}, 'APPROVED', '{}', ${clock})`);
    const officer = await store.getOfficerForAccount(amil.address.toLowerCase(), SINAR);
    await handle.execute(sql`INSERT INTO disbursement_realizations (id, institution_id, proposal_id, proposal_version, aid_line_id, beneficiary_id,
        method, amount_idr, reported_at, recorded_at, operator_account, operator_officer_id, created_at, updated_at)
      VALUES ('real-1', ${SINAR}, 'prop-1', 1, 'line-1', 'benef-1', 'CASH', '150000', ${clock}, ${clock}, 'fixture', ${officer!.id}, ${clock}, ${clock})`);
    await handle.execute(sql`INSERT INTO disbursement_realization_disputes (id, institution_id, proposal_id, realization_id, aid_line_id,
        complainant_type, subject, reason, disputed_amount_idr, recorded_by_officer_id, created_at)
      VALUES ('dispute-1', ${SINAR}, 'prop-1', 'real-1', 'line-1', 'RECIPIENT', 'Jumlah', 'Penerima menyangkal jumlah', '50000', ${officer!.id}, ${clock})`);
    const realizationsBefore = await handle.execute(sql`SELECT * FROM disbursement_realizations`);

    const finding = await created({
      scope: "PENERIMA", title: "Penyangkalan jumlah penerima",
      targets: { proposalId: "prop-1", proposalVersion: 1, realizationId: "real-1", disputeId: "dispute-1" },
    });
    expect(finding).toMatchObject({
      institutionId: SINAR, preparationId: PREPARATION, packageId: "pkg-v1", packageDigest: digestV1,
      reportId: "LPZ-2026-S1", reportVersion: "1", status: "OPEN", revision: 1, assignedAuditor: auditor.address.toLowerCase(),
      targets: { proposalId: "prop-1", proposalVersion: 1, realizationId: "real-1", documentId: null, disputeId: "dispute-1" },
    });
    // Linking a finding changes nothing about the realization or its dispute.
    expect(await handle.execute(sql`SELECT * FROM disbursement_realizations`)).toEqual(realizationsBefore);
    expect((await createFinding({ targets: { proposalId: "prop-1", proposalVersion: 9 } })).status).toBe(404);
  });

  it("runs the cycle with a status projected from the log; the amil cannot close and a closed finding stays closed", async () => {
    const finding = await created();
    let queues = (await (await get(`${EVIDENCE}/audit-findings/queues`, tokens.amil)).json()).queues;
    expect(queues.viewer).toBe("AMIL");
    expect(queues.amilActionQueue.map((f: any) => f.id)).toContain(finding.id);

    expect((await post(findingUrl(finding.id, "/responses"), { operationId: nextOp(), expectedRevision: 1, note: "Tanpa mandat" }, tokens.amilTanpaMandat)).status).toBe(403);
    const responded = await post(findingUrl(finding.id, "/responses"), {
      operationId: nextOp(), expectedRevision: 1, note: "BAST asli terlampir.",
      attachments: [{ fileName: "bast.txt", mimeType: "text/plain", contentBase64: b64("BAST kelompok") }],
    }, tokens.amil);
    expect(responded.status).toBe(200);
    let body = (await responded.json()).finding;
    expect(body).toMatchObject({ status: "DITANGGAPI", revision: 2 });
    expect(body.events[1].attachments[0]).toMatchObject({ access: "EXAMINATION", uploaderRole: "AMIL" });

    queues = (await (await get(`${EVIDENCE}/audit-findings/queues`, tokens.auditor)).json()).queues;
    expect(queues.auditorReviewQueue.map((f: any) => f.id)).toContain(finding.id);
    // Another auditor's queue does not carry findings assigned to someone else.
    queues = (await (await get(`${EVIDENCE}/audit-findings/queues`, tokens.auditorB)).json()).queues;
    expect(queues.auditorReviewQueue.map((f: any) => f.id)).not.toContain(finding.id);

    // The amil cannot close, nor can an auditor who is not assigned.
    const amilClose = await post(findingUrl(finding.id, "/follow-ups"), { operationId: nextOp(), expectedRevision: 2, action: "SELESAI_DITUTUP", note: "Tutup sendiri" }, tokens.amil);
    expect(amilClose.status).toBe(403);
    expect((await post(findingUrl(finding.id, "/follow-ups"), { operationId: nextOp(), expectedRevision: 2, action: "SELESAI_DITUTUP", note: "Bukan saya" }, tokens.auditorB)).status).toBe(403);

    body = (await (await post(findingUrl(finding.id, "/follow-ups"), { operationId: nextOp(), expectedRevision: 2, action: "BUTUH_KOREKSI_LAPORAN", note: "Angka penerima harus dikoreksi." }, tokens.auditor)).json()).finding;
    expect(body).toMatchObject({ status: "MENUNGGU_KOREKSI_LAPORAN", revision: 3 });
    expect(body.corrections).toEqual([]);

    // A frozen correction version is found and offered; the old version keeps its own identity and findings.
    await saveVersion("pkg-v2", "2", "pkg-v1");
    body = (await (await get(findingUrl(finding.id), tokens.amil)).json()).finding;
    expect(body.corrections).toEqual([{ packageId: "pkg-v2", preparationId: PREPARATION, reportVersion: "2", status: "FROZEN" }]);
    expect(body.reportVersion).toBe("1");
    const v2 = (await (await get(findingsUrl("pkg-v2"), tokens.amil)).json()).findings;
    expect(v2).toEqual([]);

    await post(findingUrl(finding.id, "/responses"), { operationId: nextOp(), expectedRevision: 3, note: "Versi koreksi v2 telah dibekukan." }, tokens.amil);
    const closed = await post(findingUrl(finding.id, "/follow-ups"), { operationId: nextOp(), expectedRevision: 4, action: "SELESAI_DITUTUP", note: "Koreksi memadai." }, tokens.auditor);
    body = (await closed.json()).finding;
    expect(body).toMatchObject({ status: "DITUTUP_AUDITOR", revision: 5 });
    expect(body.events.map((e: any) => e.eventType)).toEqual(["FINDING_CREATED", "AMIL_RESPONSE", "AUDITOR_FOLLOWUP", "AMIL_RESPONSE", "AUDITOR_CLOSED"]);

    // Closed means closed: no response, no reopening follow-up, no handover.
    expect((await post(findingUrl(finding.id, "/responses"), { operationId: nextOp(), expectedRevision: 5, note: "Terlambat" }, tokens.amil)).status).toBe(409);
    expect((await post(findingUrl(finding.id, "/follow-ups"), { operationId: nextOp(), expectedRevision: 5, action: "MINTA_KLARIFIKASI_LANJUTAN", note: "Buka lagi" }, tokens.auditor)).status).toBe(409);
    expect((await post(findingUrl(finding.id, "/handover"), { operationId: nextOp(), expectedRevision: 5, note: "x", toAuditor: auditorB.address }, tokens.auditor)).status).toBe(409);
    // Nor is a note corrected once the finding is closed; the record is final.
    const lateCorrection = await post(findingUrl(finding.id, "/corrections"), { operationId: nextOp(), expectedRevision: 5, eventId: body.events[3].id, note: "Diubah setelah ditutup" }, tokens.amil);
    expect(lateCorrection.status).toBe(409);

    // The log is append-only in the database, not only in the API. The stored status only
    // records what the projection said; the projection reads the kinds of event.
    const rows: any = await database.handle().execute(sql`SELECT seq, resulting_status FROM audit_finding_events WHERE finding_id = ${finding.id} ORDER BY seq`);
    expect((rows.rows ?? rows).map((r: any) => r.resulting_status)).toEqual(["OPEN", "DITANGGAPI", "MENUNGGU_KOREKSI_LAPORAN", "DITANGGAPI", "DITUTUP_AUDITOR"]);
    expect(await database.columnsOf("audit_findings")).not.toContain("status");
  });

  it("replays a retried operation, refuses a reused id with a different body and a stale revision", async () => {
    const createBody = {
      operationId: "create-once", packageDigest: digestV1, scope: "DOKUMEN_BUKTI", severity: "CATATAN",
      title: "Tanggal BAST", description: "BAST 10 Juni, transfer 12 Juni.",
    };
    const first = await post(findingsUrl(), createBody, tokens.auditor);
    const second = await post(findingsUrl(), createBody, tokens.auditor);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const id = (await first.json()).finding.id;
    expect((await second.json()).finding.id).toBe(id);
    expect(await database.rowCount("audit_findings")).toBe(1);
    expect((await post(findingsUrl(), { ...createBody, title: "Lain" }, tokens.auditor)).status).toBe(409);

    const response = { operationId: "respond-once", expectedRevision: 1, note: "Kas dibayar tunai lebih dulu." };
    expect((await post(findingUrl(id, "/responses"), response, tokens.amil)).status).toBe(200);
    const retried = await post(findingUrl(id, "/responses"), response, tokens.amil);
    expect(retried.status).toBe(200);
    expect((await retried.json()).finding.revision).toBe(2);
    expect(await database.rowCount("audit_finding_events")).toBe(2);

    // Two people acting on the same revision: the second is told the finding moved.
    const stale = await post(findingUrl(id, "/responses"), { operationId: nextOp(), expectedRevision: 1, note: "Versi lama" }, tokens.amil);
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toContain("telah berubah");
  });

  it("replays a committed write after the writer's mandate lapsed, and leaves no file behind a refused write", async () => {
    const finding = await created();
    await post(findingUrl(finding.id, "/responses"), { operationId: nextOp(), expectedRevision: 1, note: "Tanggapan" }, tokens.amil);
    const followup = { operationId: "followup-once", expectedRevision: 2, action: "MINTA_KLARIFIKASI_LANJUTAN", note: "Lampirkan rekening koran." };
    expect((await post(findingUrl(finding.id, "/follow-ups"), followup, tokens.auditor)).status).toBe(200);

    // The response was lost and the mandate ended before the retry: the retry still learns what was recorded.
    await setAuditor(SINAR, auditor.address, false, "Penugasan berakhir");
    const retried = await post(findingUrl(finding.id, "/follow-ups"), followup, tokens.auditor);
    expect(retried.status).toBe(200);
    expect((await retried.json()).finding).toMatchObject({ revision: 3, detail: "STATUS_ONLY" });
    // A new write under the lapsed mandate is still refused.
    expect((await post(findingUrl(finding.id, "/follow-ups"), { ...followup, operationId: nextOp(), expectedRevision: 3 }, tokens.auditor)).status).toBe(403);

    const storedFiles = async () => (await readdir(fileDirectory, { recursive: true })).filter(name => String(name).endsWith(".bin")).length;
    const before = await storedFiles();
    const stale = await post(findingUrl(finding.id, "/responses"), {
      operationId: nextOp(), expectedRevision: 1, note: "Revisi usang",
      attachments: [{ fileName: "rekening.txt", mimeType: "text/plain", contentBase64: b64("rekening koran") }],
    }, tokens.amil);
    expect(stale.status).toBe(409);
    expect(await storedFiles()).toBe(before);
  });

  it("lists a version's findings only under the preparation that version belongs to", async () => {
    const finding = await created();
    expect((await (await get(findingsUrl(), tokens.amil)).json()).findings.map((f: any) => f.id)).toEqual([finding.id]);
    const elsewhere = await get(`${EVIDENCE}/prep-lain/reports/pkg-v1/findings`, tokens.amil);
    expect((await elsewhere.json()).findings ?? []).toEqual([]);
  });

  it("stops a revoked auditor and moves the finding only through a recorded handover", async () => {
    const finding = await created();
    await post(findingUrl(finding.id, "/responses"), { operationId: nextOp(), expectedRevision: 1, note: "Tanggapan" }, tokens.amil);

    // B cannot take over while A still holds a mandate.
    const early = await post(findingUrl(finding.id, "/handover"), { operationId: nextOp(), expectedRevision: 2, note: "Ambil alih" }, tokens.auditorB);
    expect(early.status).toBe(403);

    await setAuditor(SINAR, auditor.address, false, "Penugasan berakhir");
    const revoked = await post(findingUrl(finding.id, "/follow-ups"), { operationId: nextOp(), expectedRevision: 2, action: "SELESAI_DITUTUP", note: "Tutup" }, tokens.auditor);
    expect(revoked.status).toBe(403);
    // Without a mandate A reads only the status.
    expect((await (await get(findingUrl(finding.id), tokens.auditor)).json()).finding.detail).toBe("STATUS_ONLY");

    // The assignment basis is what the registry recorded, not a reference typed into the request.
    expect((await post(findingUrl(finding.id, "/handover"), { operationId: nextOp(), expectedRevision: 2, assignmentRef: "SP-karangan", note: "x" }, tokens.auditorB)).status).toBe(400);
    const taken = await post(findingUrl(finding.id, "/handover"), { operationId: nextOp(), expectedRevision: 2, note: "Melanjutkan pemeriksaan A." }, tokens.auditorB);
    expect(taken.status).toBe(200);
    let body = (await taken.json()).finding;
    expect(body).toMatchObject({ assignedAuditor: auditorB.address.toLowerCase(), status: "DITANGGAPI", revision: 3 });
    expect(body.events[2]).toMatchObject({ eventType: "AUDITOR_HANDOVER", mandateRef: "Surat penugasan audit 2026/02" });
    expect(body.events[2].assignmentRef).toMatch(/^Surat penugasan audit 2026\/02 \(epoch \d+\)$/);
    expect(body.permissions.followUp).toBe(true);

    // A regains a mandate but is no longer assigned; B hands it back explicitly.
    await setAuditor(SINAR, auditor.address, true, "Surat penugasan audit 2026/03");
    expect((await post(findingUrl(finding.id, "/follow-ups"), { operationId: nextOp(), expectedRevision: 3, action: "SELESAI_DITUTUP", note: "x" }, tokens.auditor)).status).toBe(403);
    body = (await (await post(findingUrl(finding.id, "/handover"), { operationId: nextOp(), expectedRevision: 3, note: "Dikembalikan", toAuditor: auditor.address }, tokens.auditorB)).json()).finding;
    expect(body.assignedAuditor).toBe(auditor.address.toLowerCase());
    // Handing to someone else records the recipient's mandate, not the giver's.
    expect(body.events[3].assignmentRef).toMatch(/^Surat penugasan audit 2026\/03 \(epoch \d+\)$/);
    expect((await post(findingUrl(finding.id, "/follow-ups"), { operationId: nextOp(), expectedRevision: 4, action: "SELESAI_DITUTUP", note: "Selesai" }, tokens.auditor)).status).toBe(200);
  });

  it("corrects a note by appending; only its author may, and the original stays readable", async () => {
    const finding = await created();
    const responded = (await (await post(findingUrl(finding.id, "/responses"), { operationId: nextOp(), expectedRevision: 1, note: "Tanggal 10 Juli" }, tokens.amil)).json()).finding;
    const responseEvent = responded.events[1].id;
    expect(responded.permissions.correctableEventIds).toEqual([responseEvent]);

    // The auditor cannot rewrite the amil's words, nor the amil the auditor's.
    expect((await post(findingUrl(finding.id, "/corrections"), { operationId: nextOp(), expectedRevision: 2, eventId: responseEvent, note: "Diubah auditor" }, tokens.auditor)).status).toBe(403);
    expect((await post(findingUrl(finding.id, "/corrections"), { operationId: nextOp(), expectedRevision: 2, eventId: finding.events[0].id, note: "Diubah amil" }, tokens.amil)).status).toBe(403);

    const corrected = (await (await post(findingUrl(finding.id, "/corrections"), { operationId: nextOp(), expectedRevision: 2, eventId: responseEvent, note: "Koreksi: tanggal 10 Juni" }, tokens.amil)).json()).finding;
    expect(corrected.status).toBe("DITANGGAPI");
    expect(corrected.events[1].note).toBe("Tanggal 10 Juli");
    expect(corrected.events[2]).toMatchObject({ eventType: "NOTE_CORRECTION", correctsEventId: responseEvent, note: "Koreksi: tanggal 10 Juni" });
  });

  it("keeps owner-only papers with their uploader, shares examination files with its parties only, and refuses a corrupt file", async () => {
    const finding = await created({
      workingPapers: [{ fileName: "kertas-kerja.txt", mimeType: "text/plain", contentBase64: b64("Rahasia auditor") }],
      sharedFiles: [{ fileName: "permintaan-dokumen.txt", mimeType: "text/plain", contentBase64: b64("Mohon BAST") }],
    });
    const byName = (name: string) => finding.events[0].attachments.find((a: any) => a.fileName === name);
    const ownerOnly = byName("kertas-kerja.txt");
    const shared = byName("permintaan-dokumen.txt");
    expect(ownerOnly.access).toBe("OWNER_ONLY");
    expect(shared.access).toBe("EXAMINATION");
    const url = (fileId: string) => findingUrl(finding.id, `/attachments/${fileId}`);

    expect(await (await get(url(ownerOnly.id), tokens.auditor)).text()).toBe("Rahasia auditor");
    expect((await get(url(ownerOnly.id), tokens.amil)).status).toBe(403);
    expect((await get(url(shared.id), tokens.amil)).status).toBe(200);
    expect((await get(url(shared.id), tokens.reader)).status).toBe(403);
    expect((await get(url(shared.id), tokens.admin)).status).toBe(403);

    // The amil sees that a private paper exists, never its name.
    const amilView = (await (await get(findingUrl(finding.id), tokens.amil)).json()).finding;
    expect(amilView.events[0].attachments.map((a: any) => a.fileName)).toEqual(["permintaan-dokumen.txt"]);
    expect(amilView.events[0].privateAttachmentCount).toBe(1);
    expect(JSON.stringify(amilView)).not.toContain("kertas-kerja.txt");
    expect(JSON.stringify(amilView)).not.toContain(fileDirectory);

    // After a handover the new auditor still cannot open the previous auditor's owner-only paper.
    await setAuditor(SINAR, auditor.address, false, "Selesai");
    await post(findingUrl(finding.id, "/handover"), { operationId: nextOp(), expectedRevision: 1, note: "Lanjut" }, tokens.auditorB);
    expect((await get(url(ownerOnly.id), tokens.auditorB)).status).toBe(403);
    expect((await get(url(shared.id), tokens.auditorB)).status).toBe(200);

    // A tampered file is refused rather than served.
    await writeFile(join(fileDirectory, SINAR, PREPARATION, `${shared.id}.bin`), Buffer.from("rusak"));
    const corrupt = await get(url(shared.id), tokens.amil);
    expect(corrupt.status).toBe(409);
    expect((await corrupt.json()).error).toContain("rusak");
  });

  it("gives other members status per version only, isolates institutions and keeps the public summary free of findings", async () => {
    const secret = "SELISIH_RAHASIA_REKENING_PERANTARA";
    const finding = await created({ title: secret, description: `${secret} pada mutasi bank` });

    for (const token of [tokens.reader, tokens.admin, tokens.amilTanpaMandat]) {
      const list = await (await get(findingsUrl(), token)).json();
      expect(list.viewer).toBe("STATUS_ONLY");
      expect(list.findings[0]).toMatchObject({ detail: "STATUS_ONLY", reportVersion: "1", status: "OPEN", packageDigest: digestV1 });
      expect(JSON.stringify(list)).not.toContain(secret);
      const queues = await (await get(`${EVIDENCE}/audit-findings/queues`, token)).json();
      expect(JSON.stringify(queues)).not.toContain(secret);
    }

    expect((await get(findingUrl(finding.id), tokens.rival)).status).toBe(404);
    expect((await post(findingUrl(finding.id, "/follow-ups"), { operationId: nextOp(), expectedRevision: 1, action: "SELESAI_DITUTUP", note: "x" }, tokens.rival)).status).toBe(404);
    expect((await createFinding({}, tokens.rival)).status).toBe(404);
    expect((await get(findingUrl(finding.id))).status).toBe(401);

    const publicSummary = await get(`${EVIDENCE}/${PREPARATION}/public`);
    expect(publicSummary.status).toBe(200);
    const text = await publicSummary.text();
    expect(text).not.toContain(secret);
    expect(text).not.toContain(finding.id);
  });

  it("keeps findings, history and files across a restart", async () => {
    const finding = await created({ sharedFiles: [{ fileName: "surat.txt", mimeType: "text/plain", contentBase64: b64("Surat") }] });
    await post(findingUrl(finding.id, "/responses"), { operationId: "before-restart", expectedRevision: 1, note: "Sebelum restart" }, tokens.amil);

    await database.reopen();
    await configure();

    const after = (await (await get(findingUrl(finding.id), tokens.amil)).json()).finding;
    expect(after).toMatchObject({ status: "DITANGGAPI", revision: 2 });
    expect(await (await get(findingUrl(finding.id, `/attachments/${finding.events[0].attachments[0].id}`), tokens.amil)).text()).toBe("Surat");
    // The operation recorded before the restart still replays instead of writing twice.
    const retried = await post(findingUrl(finding.id, "/responses"), { operationId: "before-restart", expectedRevision: 1, note: "Sebelum restart" }, tokens.amil);
    expect((await retried.json()).finding.revision).toBe(2);
  });

  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("browser: auditor records, amil answers after an unknown result, auditor closes, reader sees the status per version", async () => {
    const built = await Bun.build({
      entrypoints: [new URL("../../frontend/test/audit-finding-smoke.tsx", import.meta.url).pathname],
      target: "browser", define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "" }) },
    });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const bundle = await built.outputs[0]!.text();
    let wallet = auditor;
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
    let browser: any;
    try {
      const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
      browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.addInitScript((now: number) => { Date.now = () => now * 1000; }, NOW);
      page.setDefaultTimeout(10000);
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      const version = new URLSearchParams({ preparation: PREPARATION, package: "pkg-v1", digest: digestV1, report: "LPZ-2026-S1", version: "1" });
      await page.goto(`${server.url}?${version}`);
      await page.getByRole("button", { name: /^0x/ }).first().waitFor();
      await page.getByLabel("Pengelola Zakat", { exact: true }).selectOption(SINAR);
      await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();
      const section = page.getByRole("region", { name: "Temuan pemeriksaan versi 1" });
      const switchTo = async (account: typeof wallet) => {
        await page.getByRole("button", { name: "Keluar", exact: true }).click();
        wallet = account;
        await page.getByRole("button", { name: "Ganti akun sintetis", exact: true }).click();
        await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();
        await section.waitFor();
      };

      // Auditor (READER membership + registry mandate) records a finding with the keyboard.
      await section.getByRole("button", { name: "Catat temuan", exact: true }).focus();
      await page.keyboard.press("Enter");
      const create = page.getByRole("dialog", { name: "Catat temuan pemeriksaan" });
      await create.getByLabel("Judul temuan").fill("Smoke: BAST kelompok belum lengkap");
      await create.getByLabel("Uraian dan kriteria pemeriksaan").fill("Lima penerima tanpa tanda terima.");
      await create.getByLabel("Berkas untuk amil (dibagikan dalam pemeriksaan)").setInputFiles({ name: "permintaan.txt", mimeType: "text/plain", buffer: Buffer.from("Mohon BAST") });
      await create.getByText("permintaan.txt").waitFor();
      await create.getByRole("button", { name: "Catat temuan", exact: true }).focus();
      await page.keyboard.press("Enter");
      const detail = page.getByRole("dialog", { name: "Smoke: BAST kelompok belum lengkap" });
      await detail.getByText("Menunggu tanggapan amil").first().waitFor();
      await page.keyboard.press("Escape");
      await detail.waitFor({ state: "detached" });

      // Amil answers from the queue. The first answer is recorded but its response is lost.
      await switchTo(amil);
      const queue = page.getByRole("region", { name: "Temuan pemeriksaan & tindak lanjut" });
      await queue.getByRole("tab", { name: /Perlu tanggapan amil \(1\)/ }).waitFor();
      await queue.getByRole("button", { name: "Buka", exact: true }).click();
      await detail.getByLabel("Penjelasan").fill("BAST kelompok terlampir.");
      let dropped = false;
      await page.route("**/responses", async (route: any) => {
        if (dropped) return route.continue();
        dropped = true;
        await route.fetch();
        await route.abort("failed");
      });
      await detail.getByRole("button", { name: "Kirim tanggapan", exact: true }).focus();
      await page.keyboard.press("Enter");
      await detail.getByText(/Hasilnya belum diketahui/).waitFor();
      // Sending the same content again reuses the operation id, so the server replays rather than records twice.
      await detail.getByRole("button", { name: "Kirim tanggapan", exact: true }).focus();
      await page.keyboard.press("Enter");
      await detail.getByText("Tanggapan tercatat.").waitFor();
      expect(await database.rowCount("audit_finding_events")).toBe(2);
      await page.keyboard.press("Escape");

      // Auditor reviews and closes.
      await switchTo(auditor);
      await queue.getByRole("tab", { name: /Perlu ditelaah auditor \(1\)/ }).click();
      await queue.getByRole("button", { name: "Buka", exact: true }).click();
      await detail.getByText("BAST kelompok terlampir.").waitFor();
      await detail.getByLabel("Keputusan").selectOption("SELESAI_DITUTUP");
      await detail.getByLabel("Catatan", { exact: true }).fill("Bukti memadai.");
      await detail.getByRole("button", { name: "Simpan tindak lanjut", exact: true }).focus();
      await page.keyboard.press("Enter");
      await detail.getByText(/Temuan ditutup auditor/).waitFor();
      await page.keyboard.press("Escape");

      // A plain reader sees the version's finding status and nothing of the narrative.
      await switchTo(reader);
      await section.getByText(/Anda melihat status temuan per versi/).waitFor();
      await section.getByText("Ditutup auditor").waitFor();
      expect(await section.getByText("Smoke: BAST kelompok belum lengkap").count()).toBe(0);
      expect(await section.getByRole("button", { name: "Catat temuan" }).count()).toBe(0);

      expect(errors).toEqual([]);
      await page.screenshot({ path: "/tmp/issue99-browser.png", fullPage: true });
    } finally {
      await browser?.close();
      await server.stop(true);
    }
  }, 90000);
});

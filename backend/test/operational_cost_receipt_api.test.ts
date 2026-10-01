/**
 * Nota/kuitansi biaya operasional dengan foto/PDF terenkripsi dan sidik SHA-256
 * (ADR-0042, issue #126). Real HTTP routes over real SQL and a real encrypted file store.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";

const BASE = "http://localhost:3001/api/workspace";
const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";

const adminSinar = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
const amilSinar = privateKeyToAccount(`0x${"22".repeat(32)}` as Hex);
const readerSinar = privateKeyToAccount(`0x${"33".repeat(32)}` as Hex);
const amilBaitul = privateKeyToAccount(`0x${"55".repeat(32)}` as Hex);
const adminBaitul = privateKeyToAccount(`0x${"66".repeat(32)}` as Hex);

const NOW = 1_800_000_000;
let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let disbursement: DisbursementStore;
let activities: ActivityStore;
let files: PrivateFileStore;
let tempDir: string;

const request = (path: string, init: RequestInit = {}) => app.fetch(new Request(`${BASE}${path}`, init));
const post = (path: string, body: unknown, token: string) =>
  request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
const get = (path: string, token: string) => request(path, { headers: { Authorization: `Bearer ${token}` } });
const remove = (path: string, token: string) =>
  request(path, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });

async function signIn(account: typeof amilSinar, institutionId: string): Promise<string> {
  const minted = await request("/challenge", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ institutionId, account: account.address }),
  });
  const { challenge, typedData } = await minted.json();
  const signature = await account.signTypedData({
    ...typedData,
    message: { ...typedData.message, issuedAt: BigInt(typedData.message.issuedAt), expiresAt: BigInt(typedData.message.expiresAt) },
  });
  const session = await request("/session", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nonce: challenge.nonce, signature }),
  });
  expect(session.status).toBe(201);
  return (await session.json()).token;
}

/** A published (approved) proposal of one recipient, on the institution's internal decision. */
async function publishedProposal(amil: string, admin: string) {
  const program = await post("/programs", {
    name: "Jumat Berkah", purpose: "Santunan", fundType: "INFAK", scope: "Tangerang Selatan", referenceCeiling: "10000000",
  }, admin);
  expect(program.status).toBe(201);
  const programId = (await program.json()).program.id;
  const created = await post("/proposals", {
    expectedVersion: 0, operationId: crypto.randomUUID(), programId,
    originOfRequest: "Data RT", purpose: "Santunan Jumat", personInCharge: "Bendahara",
    aidPeriod: { start: "2026-09-01", end: "2026-09-30" },
    beneficiaries: [{ id: "ben-1", name: "Mustahik 1", asnaf: "Fakir", addressOrScope: "RT 03",
      identityBasis: { kind: "NIK", value: "3674010101010001" }, guardian: null, paymentRecipient: null }],
    aidLines: [{ id: "aid-1", beneficiaryId: "ben-1", aidType: "Uang tunai", period: "2026-09",
      value: { kind: "MONEY", amountRequestedIdr: "1000000" } }],
  }, amil);
  expect(created.status).toBe(201);
  const draft = (await created.json()).draft;
  expect((await post(`/proposals/${draft.id}/documents`, {
    category: "RECIPIENT_VERIFICATION", fileName: "ba.txt", mimeType: "text/plain", beneficiaryId: null,
    contentBase64: Buffer.from("Berita acara").toString("base64"),
  }, amil)).status).toBe(201);
  const published = await post(`/proposals/${draft.id}/publish`, {
    operationId: crypto.randomUUID(), expectedVersion: draft.version, decisionReference: "Rapat pengurus", decisionDate: "2026-09-27",
  }, amil);
  expect(published.status).toBe(200);
  return (await published.json()).draft as { id: string; version: number };
}

const costs = (proposalId: string) => `/proposals/${proposalId}/operational-costs`;
const talangan = (holderOfficerId: string) => ({ kind: "TALANGAN", holderOfficerId });
const line = (overrides: Record<string, unknown> = {}) => ({
  spentOn: "2026-09-28", purpose: "Bensin", quantity: "10", unit: "liter", unitPriceIdr: "10000", amountIdr: "100000",
  payee: "SPBU 34.153", fundingSource: talangan("off-ahmad"), ...overrides,
});
const recordItems = (proposalId: string, items: unknown[], token: string) =>
  post(`${costs(proposalId)}/items`, { operationId: crypto.randomUUID(), items }, token);
const overview = async (proposalId: string, token: string) =>
  (await (await get(costs(proposalId), token)).json()) as { items: any[]; receipts: any[] };

// Real leading bytes, so the server tells the type from content, not from the name.
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode("struk SPBU 34.153 bensin 10 liter")]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode("kuitansi rental")]);
const PDF = new TextEncoder().encode("%PDF-1.4\nKuitansi KW-012 sewa mobil pick-up Rp300.000\n%%EOF");
const sha256 = (bytes: Uint8Array) => `0x${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`;

const receipts = (proposalId: string) => `${costs(proposalId)}/receipts`;
const createReceipt = async (proposalId: string, token: string, overrides: Record<string, unknown> = {}) => {
  const res = await post(receipts(proposalId), {
    operationId: crypto.randomUUID(), kind: "NOTA", reference: "KW-012", issuedOn: "2026-09-28", issuer: "Rental Pak Udin", ...overrides,
  }, token);
  expect(res.status).toBe(201);
  return (await res.json()).receipt as { id: string };
};
const upload = (proposalId: string, receiptId: string, bytes: Uint8Array, token: string, fileName = "nota.jpg",
  operationId: string = crypto.randomUUID()) =>
  post(`${receipts(proposalId)}/${receiptId}/files`, {
    operationId, fileName, mimeType: "image/jpeg", contentBase64: Buffer.from(bytes).toString("base64"),
  }, token);
const fileUrl = (proposalId: string, receiptId: string, fileId: string) => `${receipts(proposalId)}/${receiptId}/files/${fileId}`;

describe("Nota/kuitansi biaya operasional (ADR-0042, #126)", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "operational-cost-receipt-test-"));
    files = createEncryptedFileStore({ directory: tempDir, key: Buffer.alloc(32, 42) });
    database = await createTestWorkspaceDatabase(process.env.OPERATIONAL_COST_TEST_DATABASE_URL);
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

  let amil: string;
  let admin: string;
  let proposal: { id: string; version: number };

  beforeEach(async () => {
    await database.reset();
    configureWorkspace({
      store, disbursement, activities, files, ethCall: async () => "0x", now: () => NOW,
      sessionTtlSeconds: 3600, challengeTtlSeconds: 300,
    });
    for (const inst of SYNTHETIC_INSTITUTIONS) await store.upsertInstitution(institutionRecordOf(inst));
    await store.upsertMembership({ institutionId: SINAR, account: adminSinar.address, role: "ADMIN" });
    await store.upsertMembership({ institutionId: SINAR, account: amilSinar.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: SINAR, account: readerSinar.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: BAITUL, account: amilBaitul.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: BAITUL, account: adminBaitul.address, role: "ADMIN" });
    const profiles: Array<[string, string, string, typeof amilSinar | null, string]> = [
      ["off-admin", "Admin Sinar", SINAR, adminSinar, "ADMIN"],
      ["off-amil", "Amil Sinar", SINAR, amilSinar, "OFFICER"],
      ["off-reader", "Petugas tanpa mandat", SINAR, readerSinar, "OFFICER"],
      // Field officers without a login: they pay and carry cash, an admin records it.
      ["off-ahmad", "Ahmad", SINAR, null, "OFFICER"],
      ["off-siti", "Siti", SINAR, null, "OFFICER"],
      ["off-baitul", "Amil Baitul", BAITUL, amilBaitul, "OFFICER"],
      ["off-admin-baitul", "Admin Baitul", BAITUL, adminBaitul, "ADMIN"],
    ];
    for (const [id, displayName, institutionId, account, role] of profiles) {
      await store.createOfficerProfile({
        id, institutionId, displayName, ...(account ? { account: account.address, role: role as "ADMIN" | "OFFICER" } : {}),
        actor: institutionId === SINAR ? adminSinar.address : adminBaitul.address, now: NOW,
      });
    }
    for (const [officerId, fn, institutionId] of [
      ["off-admin", "MANAGE_PROGRAMS", SINAR], ["off-amil", "PREPARE_PROPOSALS", SINAR],
      ["off-amil", "RECORD_REALIZATION", SINAR], ["off-baitul", "RECORD_REALIZATION", BAITUL],
      ["off-baitul", "PREPARE_PROPOSALS", BAITUL], ["off-admin-baitul", "MANAGE_PROGRAMS", BAITUL],
    ] as const) {
      await store.grantMandate({ institutionId, actor: institutionId === SINAR ? adminSinar.address : adminBaitul.address, now: NOW, mandate: {
        officerId, function: fn, scopeType: "ALL_PROGRAMS", assignmentRef: `SK/${fn}`, validFrom: NOW - 1000, validUntil: NOW + 86400 * 30,
      } });
    }
    amil = await signIn(amilSinar, SINAR);
    admin = await signIn(adminSinar, SINAR);
    proposal = await publishedProposal(amil, admin);
  });

  it("keeps several photos and a PDF on one nota, each with its SHA-256, and serves them back exactly", async () => {
    const receipt = await createReceipt(proposal.id, amil);
    const uploaded = [];
    for (const [bytes, name] of [[JPG, "struk-depan.jpg"], [PNG, "struk-belakang.png"], [PDF, "kuitansi.pdf"]] as const) {
      const res = await upload(proposal.id, receipt.id, bytes, amil, name);
      expect(res.status).toBe(201);
      uploaded.push((await res.json()).file);
    }
    expect(uploaded.map((f) => [f.fileName, f.mimeType, f.sizeBytes, f.contentSha256])).toEqual([
      ["struk-depan.jpg", "image/jpeg", JPG.byteLength, sha256(JPG)],
      ["struk-belakang.png", "image/png", PNG.byteLength, sha256(PNG)],
      ["kuitansi.pdf", "application/pdf", PDF.byteLength, sha256(PDF)],
    ]);

    const view = await overview(proposal.id, amil);
    expect(view.receipts).toHaveLength(1);
    expect(view.receipts[0]).toMatchObject({
      id: receipt.id, kind: "NOTA", reference: "KW-012", issuedOn: "2026-09-28", issuer: "Rental Pak Udin",
      recordedByOfficerId: "off-amil", evidencedAt: null,
    });
    expect(view.receipts[0].files.map((f: any) => f.id)).toEqual(uploaded.map((f) => f.id));
    expect(JSON.stringify(view)).not.toContain("storageRef");
    expect(JSON.stringify(view)).not.toContain(tempDir);

    const pdf = await get(fileUrl(proposal.id, receipt.id, uploaded[2].id), amil);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
    expect(new Uint8Array(await pdf.arrayBuffer())).toEqual(PDF);
  });

  it("stores only ciphertext and refuses a file that no longer matches its fingerprint", async () => {
    const receipt = await createReceipt(proposal.id, amil);
    const jpg = (await (await upload(proposal.id, receipt.id, JPG, amil)).json()).file;
    const pdf = (await (await upload(proposal.id, receipt.id, PDF, amil, "kuitansi.pdf")).json()).file;
    const stored = (await disbursement.getReceiptFile(SINAR, proposal.id, receipt.id, jpg.id))!;
    expect(Buffer.from(await Bun.file(stored.storageRef).arrayBuffer()).includes(Buffer.from("struk SPBU"))).toBe(false);

    // Validly encrypted, but not the bytes that were fingerprinted.
    await files.put({ institutionId: SINAR, preparationId: proposal.id, fileId: jpg.id, bytes: PNG });
    const swapped = await get(fileUrl(proposal.id, receipt.id, jpg.id), amil);
    expect(swapped.status).toBe(409);
    expect(await swapped.json()).toMatchObject({ success: false, reason: "CORRUPT" });

    // Ciphertext damaged on disk.
    const pdfRef = (await disbursement.getReceiptFile(SINAR, proposal.id, receipt.id, pdf.id))!.storageRef;
    await writeFile(pdfRef, Buffer.from("rusak"));
    expect((await get(fileUrl(proposal.id, receipt.id, pdf.id), amil)).status).toBe(409);

    await rm(pdfRef);
    expect((await get(fileUrl(proposal.id, receipt.id, pdf.id), amil)).status).toBe(404);
  });

  it("accepts only JPG, PNG or PDF within the proposal-document size limit, and a retry stores once", async () => {
    const receipt = await createReceipt(proposal.id, amil);
    expect((await upload(proposal.id, receipt.id, new TextEncoder().encode("<html><script>alert(1)</script>"), amil, "nota.jpg")).status).toBe(400);
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
    oversized.set([0xff, 0xd8, 0xff]);
    expect((await upload(proposal.id, receipt.id, oversized, amil)).status).toBe(400);
    expect((await upload(proposal.id, "nta-tidak-ada", JPG, amil)).status).toBe(404);

    const first = await upload(proposal.id, receipt.id, JPG, amil, "nota.jpg", "upload-once");
    const retry = await upload(proposal.id, receipt.id, JPG, amil, "nota.jpg", "upload-once");
    expect(retry.status).toBe(201);
    expect((await retry.json()).file.id).toBe((await first.json()).file.id);
    expect((await upload(proposal.id, receipt.id, PNG, amil, "nota.jpg", "upload-once")).status).toBe(409);
    expect((await overview(proposal.id, amil)).receipts[0].files).toHaveLength(1);
  });

  it("offers a surat pernyataan in place of a lost nota", async () => {
    const statement = await createReceipt(proposal.id, amil, {
      kind: "SURAT_PERNYATAAN", reference: "Struk bensin 28/09 hilang, pernyataan Ahmad", issuer: null,
    });
    expect((await upload(proposal.id, statement.id, PDF, amil, "surat-pernyataan.pdf")).status).toBe(201);
    const res = await recordItems(proposal.id, [line({ receiptId: statement.id })], amil);
    expect((await res.json()).results[0].item.receiptId).toBe(statement.id);
    expect((await overview(proposal.id, amil)).receipts[0]).toMatchObject({ kind: "SURAT_PERNYATAAN", issuer: null });

    const bad = await post(receipts(proposal.id), { operationId: crypto.randomUUID(), kind: "FAKTUR", reference: "", issuedOn: "x" }, amil);
    expect(bad.status).toBe(400);
    expect((await bad.json()).issues.map((i: any) => i.field).sort()).toEqual(["issuedOn", "kind", "reference"]);
  });

  it("links one nota to several rows when recorded and when corrected, only within the same proposal", async () => {
    const nota = await createReceipt(proposal.id, amil, { reference: "STR-0457", issuer: "SPBU 34.153" });
    const other = await publishedProposal(amil, admin);
    const foreign = await createReceipt(other.id, amil, { reference: "NT-31" });

    const results = (await (await recordItems(proposal.id, [
      line({ receiptId: nota.id }),
      line({ purpose: "Oli", quantity: null, unit: null, unitPriceIdr: null, amountIdr: "45000", receiptId: nota.id }),
      line({ receiptId: foreign.id }),
      line({ purpose: "Parkir", quantity: null, unit: null, unitPriceIdr: null, amountIdr: "5000" }),
    ], amil)).json()).results;
    expect(results.map((r: any) => (r.item ? r.item.receiptId : r.issues.map((i: any) => i.field).join(",")))).toEqual(
      [nota.id, nota.id, "receiptId", null]
    );

    const parkir = results[3].item;
    const correct = (receiptId: string) => post(`${costs(proposal.id)}/items/${parkir.id}/correct`, {
      operationId: crypto.randomUUID(), expectedVersion: 1, reason: "Karcis parkir ada di nota yang sama",
      item: line({ purpose: "Parkir", quantity: null, unit: null, unitPriceIdr: null, amountIdr: "5000", receiptId }),
    }, amil);
    expect((await correct(foreign.id)).status).toBe(400);
    const corrected = await correct(nota.id);
    expect(corrected.status).toBe(200);
    expect((await corrected.json()).item).toMatchObject({ version: 2, receiptId: nota.id });

    const { history } = await (await get(`${costs(proposal.id)}/items/${parkir.id}/history`, amil)).json();
    expect(history.map((h: any) => [h.version, h.item.receiptId])).toEqual([[1, null], [2, nota.id]]);
    expect((await overview(proposal.id, amil)).items.filter((i) => i.receiptId === nota.id)).toHaveLength(3);
  });

  it("lets a mistaken file go only until a recorded row cites the nota; afterwards files are only added", async () => {
    const receipt = await createReceipt(proposal.id, amil);
    const wrong = (await (await upload(proposal.id, receipt.id, PNG, amil, "salah-foto.png")).json()).file;
    const right = (await (await upload(proposal.id, receipt.id, JPG, amil)).json()).file;
    const wrongRef = (await disbursement.getReceiptFile(SINAR, proposal.id, receipt.id, wrong.id))!.storageRef;

    expect((await remove(fileUrl(proposal.id, receipt.id, wrong.id), amil)).status).toBe(204);
    expect(await Bun.file(wrongRef).exists()).toBe(false);
    expect((await get(fileUrl(proposal.id, receipt.id, wrong.id), amil)).status).toBe(404);

    await recordItems(proposal.id, [line({ receiptId: receipt.id })], amil);
    const evidenced = (await overview(proposal.id, amil)).receipts[0];
    expect(evidenced.evidencedAt).toBe(NOW);
    const refused = await remove(fileUrl(proposal.id, receipt.id, right.id), amil);
    expect(refused.status).toBe(409);
    expect((await get(fileUrl(proposal.id, receipt.id, right.id), amil)).status).toBe(200);

    expect((await upload(proposal.id, receipt.id, PDF, amil, "kuitansi-tambahan.pdf")).status).toBe(201);
    expect((await overview(proposal.id, amil)).receipts[0].files.map((f: any) => f.fileName)).toEqual(["nota.jpg", "kuitansi-tambahan.pdf"]);
  });

  it("keeps nota files restricted to the institution's own workspace", async () => {
    const receipt = await createReceipt(proposal.id, amil);
    const file = (await (await upload(proposal.id, receipt.id, JPG, amil)).json()).file;
    const url = fileUrl(proposal.id, receipt.id, file.id);

    expect((await request(url)).status).toBe(401);
    expect((await request(costs(proposal.id))).status).toBe(401);

    const baitul = await signIn(amilBaitul, BAITUL);
    expect((await get(url, baitul)).status).toBe(404);
    expect((await get(costs(proposal.id), baitul)).status).toBe(404);
    expect((await upload(proposal.id, receipt.id, PNG, baitul)).status).toBe(404);
    expect((await remove(url, baitul)).status).toBe(404);
    expect((await post(receipts(proposal.id), {
      operationId: crypto.randomUUID(), kind: "NOTA", reference: "X", issuedOn: "2026-09-28",
    }, baitul)).status).toBe(404);
    // Nor through its own proposal, naming this receipt's ids.
    const baitulProposal = await publishedProposal(baitul, await signIn(adminBaitul, BAITUL));
    expect((await get(fileUrl(baitulProposal.id, receipt.id, file.id), baitul)).status).toBe(404);
    expect((await upload(baitulProposal.id, receipt.id, PNG, baitul)).status).toBe(404);
    expect((await remove(fileUrl(baitulProposal.id, receipt.id, file.id), baitul)).status).toBe(404);
    const borrowed = await recordItems(baitulProposal.id, [line({ fundingSource: { kind: "KAS_LEMBAGA" }, receiptId: receipt.id })], baitul);
    expect((await borrowed.json()).results[0].issues[0].field).toBe("receiptId");

    // A member without the recording mandate may read the evidence but not change it.
    const member = await signIn(readerSinar, SINAR);
    expect((await get(url, member)).status).toBe(200);
    expect((await upload(proposal.id, receipt.id, PNG, member)).status).toBe(403);
    expect((await remove(url, member)).status).toBe(403);
    expect((await post(receipts(proposal.id), {
      operationId: crypto.randomUUID(), kind: "NOTA", reference: "X", issuedOn: "2026-09-28",
    }, member)).status).toBe(403);
  });
});

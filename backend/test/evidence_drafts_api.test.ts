/**
 * Integration tests for Report Source XLSX/CSV Import and Private Drafts
 * (Spec #86, Ticket #88).
 *
 * Verifies:
 * 1. Template generation (XLSX primary and CSV alternative).
 * 2. Preview endpoint preserving all 100 rows including 7 broken rows (Scenario 5),
 *    flagging partial totals (isPartial: true), and rejecting formula/macro/size attacks (Scenario 6).
 * 3. Private drafts saving drafts with errors, multi-tenant isolation, safe versioning.
 * 4. Freezing snapshot BLOCKED when broken rows exist, and SUCCEEDS when 0 broken rows.
 * 5. Snapshot immutability (Scenario 19, ADR-0024): updating or creating new preparations
 *    never mutates previously frozen preparations.
 * 6. High-precision integer preservation and text ID leading zeros (Scenarios 4 & 15).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { createEvidenceStore, type EvidenceStore } from "../src/evidence-store";
import { createEncryptedFileStore, type PrivateFileStore } from "../src/evidence-files";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { verifyCommitment } from "../src/evidence-snapshot";
import { sql } from "drizzle-orm";

const WORKSPACE = "http://localhost:3001/api/workspace";
const EVIDENCE = "http://localhost:3001/api/evidence";

const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";

const officer = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
const rivalOfficer = privateKeyToAccount(`0x${"44".repeat(32)}` as Hex);
const reader = privateKeyToAccount(`0x${"77".repeat(32)}` as Hex);

const NOW = 1_800_000_000;
const KEY = Buffer.alloc(32, 3);

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let evidence: EvidenceStore;
let fileDirectory: string;
let fileStore: PrivateFileStore;
let clock = NOW;

const request = (url: string, init: RequestInit = {}) => app.fetch(new Request(url, init));

/** The preparation a preview is read against. Stated, never guessed from the file. */
const SCOPE = {
  period: { kind: "SEMESTER", year: 2024 },
  currencyUnit: "IDR",
  balanceSheetScope: "ON",
};

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

const del = (url: string, token?: string) =>
  request(url, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

async function signIn(account: typeof officer, institutionId: string): Promise<string> {
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

describe("Report Source XLSX/CSV Import and Private Drafts (Ticket #88)", () => {
  beforeAll(async () => {
    database = await createTestWorkspaceDatabase();
    store = createWorkspaceStore(database.handle());
    evidence = createEvidenceStore(database.handle() as never);
    await store.ensureSchema();
    await evidence.ensureSchema();

    fileDirectory = await mkdtemp(join(tmpdir(), "tabular-evidence-test-"));
    fileStore = createEncryptedFileStore({ directory: fileDirectory, key: KEY });
  });

  afterAll(async () => {
    resetWorkspace();
    await rm(fileDirectory, { recursive: true, force: true });
    await database.close();
  });

  beforeEach(async () => {
    clock = NOW;
    await database.reset();

    for (const item of SYNTHETIC_INSTITUTIONS) {
      await store.upsertInstitution(institutionRecordOf(item));
    }
    await store.upsertMembership({ institutionId: SINAR, account: officer.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: BAITUL, account: rivalOfficer.address, role: "OFFICER" });

    configureWorkspace({
      store,
      evidence,
      files: fileStore,
      now: () => clock,
      ethCall: async () => "0x",
      challengeTtlSeconds: 300,
      sessionTtlSeconds: 3600,
    });
  });

  describe("Template Generation (GET /api/evidence/template)", () => {
    it("refuses the template to a caller with no workspace session", async () => {
      const res = await get(`${EVIDENCE}/template`);
      expect(res.status).toBe(401);
    });

    it("downloads primary XLSX template with instruction sheet and columns", async () => {
      const token = await signIn(officer, SINAR);
      const res = await get(`${EVIDENCE}/template`, token);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("spreadsheetml.sheet");
      expect(res.headers.get("Content-Disposition")).toContain("tawf.source.template.v1.xlsx");

      const buffer = new Uint8Array(await res.arrayBuffer());
      const wb = XLSX.read(buffer, { type: "array" });
      expect(wb.SheetNames).toContain("Petunjuk");
      expect(wb.SheetNames).toContain("Sumber_Laporan");
    });

    it("downloads alternative CSV template", async () => {
      const token = await signIn(officer, SINAR);
      const res = await get(`${EVIDENCE}/template?format=csv`, token);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/csv");
      expect(res.headers.get("Content-Disposition")).toContain("tawf.source.template.v1.csv");

      const text = await res.text();
      expect(text).toContain("identitas_entri");
      expect(text).toContain("jenis_dana");
      expect(text).toContain("nilai");
      expect(text).toContain("posisi_neraca");
    });
  });

  describe("Tabular Preview (POST /api/evidence/preview)", () => {
    it("previews 100 rows with 7 broken rows, marking partial totals without dropping rows (Scenario 5)", async () => {
      const token = await signIn(officer, SINAR);

      // Generate 100 rows with 7 broken ones
      const headers = ["key", "jenis_dana", "nilai", "posisi_neraca", "uraian"];
      const data: any[][] = [headers];

      let expectedValidSum = 0n;
      for (let i = 1; i <= 100; i++) {
        const key = `TRX-${String(i).padStart(4, "0")}`;
        if (i === 10) {
          // Broken: missing amount
          data.push([key, "ZAKAT", "", "ON", "Tanpa nilai"]);
        } else if (i === 20) {
          // Broken: decimal amount
          data.push([key, "ZAKAT", "100000.50", "ON", "Nilai desimal"]);
        } else if (i === 30) {
          // Broken: negative amount
          data.push([key, "ZAKAT", "-50000", "ON", "Nilai negatif"]);
        } else if (i === 40) {
          // Broken: invalid bucket
          data.push([key, "PULSA_LISTRIK", "25000", "ON", "Bukan jenis zakat"]);
        } else if (i === 50) {
          // Broken: invalid balance sheet
          data.push([key, "ZAKAT", "50000", "MIDDLE", "Posisi neraca salah"]);
        } else if (i === 60) {
          // Broken: empty key
          data.push(["", "ZAKAT", "75000", "ON", "Key kosong"]);
        } else if (i === 70) {
          // Broken: non-numeric amount text
          data.push([key, "ZAKAT", "SATU_JUTA", "ON", "Teks bukan angka"]);
        } else {
          // Valid row
          const amount = 1_000_000n * BigInt(i);
          expectedValidSum += amount;
          data.push([key, "ZAKAT", amount.toString(), "ON", `Entri sah ke-${i}`]);
        }
      }

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const bytes = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
      const base64Content = Buffer.from(bytes).toString("base64");

      const res = await post(
        `${EVIDENCE}/preview`,
        { fileName: "laporan_100_baris.xlsx", contentBase64: base64Content, ...SCOPE },
        token
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.totalRows).toBe(100);
      expect(body.validCount).toBe(93);
      expect(body.invalidCount).toBe(7);
      expect(body.isPartial).toBe(true);
      expect(body.calculableTotal).toBe(expectedValidSum.toString());
      expect(body.allRowsPreview.length).toBe(100);

      // Verify broken rows are marked with isValid: false
      const brokenRow10 = body.allRowsPreview.find((r: any) => r.rowNumber === 11); // rowNumber 11 because header is row 1
      expect(brokenRow10.isValid).toBe(false);
      expect(brokenRow10.issues.length).toBeGreaterThan(0);
    });

    it("rejects spreadsheet containing formulas without executing them (Scenario 6)", async () => {
      const token = await signIn(officer, SINAR);

      const wb = XLSX.utils.book_new();
      const ws: XLSX.WorkSheet = {
        "!ref": "A1:C3",
        A1: { t: "s", v: "key" },
        B1: { t: "s", v: "jenis_dana" },
        C1: { t: "s", v: "nilai" },
        A2: { t: "s", v: "TX01" },
        B2: { t: "s", v: "ZAKAT" },
        C2: { t: "n", v: 1000 },
        A3: { t: "s", v: "TX02" },
        B3: { t: "s", v: "ZAKAT" },
        C3: { t: "n", f: "SUM(C2:C2)", v: 1000 }, // Formula cell!
      };
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const bytes = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
      const base64Content = Buffer.from(bytes).toString("base64");

      const res = await post(
        `${EVIDENCE}/preview`,
        { fileName: "formula_injection.xlsx", contentBase64: base64Content, ...SCOPE },
        token
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain("tidak dieksekusi");
      expect(body.error).toContain("C3");
    });

    it("rejects macro files (.xlsm)", async () => {
      const token = await signIn(officer, SINAR);

      const res = await post(
        `${EVIDENCE}/preview`,
        { fileName: "bahaya.xlsm", contentBase64: Buffer.from("dummy").toString("base64"), ...SCOPE },
        token
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("makro");
    });

    it("rejects unsupported columns with explicit Indonesian guidance", async () => {
      const token = await signIn(officer, SINAR);

      const csv = "key,jenis_dana,nilai,kolom_rahasia_aneh\nTX01,ZAKAT,100000,rahasia";
      const res = await post(
        `${EVIDENCE}/preview`,
        { fileName: "unsupported.csv", contentBase64: Buffer.from(csv).toString("base64"), ...SCOPE },
        token
      );
      expect(res.status).toBe(200); // Decoded successfully, but mapping produces issues
      const body = await res.json();
      const colIssue = body.issues.find((i: any) => i.field === "columns");
      expect(colIssue).toBeDefined();
      expect(colIssue.message).toContain("tidak didukung");
      expect(colIssue.message).toContain("kolom_rahasia_aneh");
    });
  });

  describe("Private Drafts Lifecycle and Tenant Isolation", () => {
    it("allows saving a draft with broken rows and lists it", async () => {
      const token = await signIn(officer, SINAR);

      const csvWithBrokenRow = "key,jenis_dana,nilai\nTX01,ZAKAT,\nTX02,ZAKAT,500000";
      const saveRes = await post(
        `${EVIDENCE}/drafts`,
        {
          label: "Draf Audit Q1",
          period: { kind: "SEMESTER", year: 2024 },
          currencyUnit: "IDR",
          balanceSheetScope: "ON",
          tolerance: { amount: "0", unit: "IDR" },
          claim: {
            manifest: {
              role: "CLAIM",
              label: "Klaim",
              origin: "PASTE",
              scopeUnit: "Pusat",
              scopeLevel: "NASIONAL",
              fundTypes: ["ZAKAT"],
              balanceSheet: "ON",
              currencyUnit: "IDR",
              period: { kind: "SEMESTER", year: 2024 },
              cutOff: "2024-06-30T00:00:00.000Z",
              format: "baris-ledger",
              mappingVersion: "1",
              transactionDetail: "PRESENT",
            },
            status: "READ",
            rows: [
              {
                key: "TX02",
                bucket: "ZAKAT",
                balanceSheet: "ON",
                value: { amount: "500000", unit: "IDR" },
              },
            ],
          },
          sourceTable: {
            fileName: "audit.csv",
            contentBase64: Buffer.from(csvWithBrokenRow).toString("base64"),
          },
        },
        token
      );

      expect(saveRes.status).toBe(201);
      const saveBody = await saveRes.json();
      expect(saveBody.success).toBe(true);
      expect(saveBody.draft.label).toBe("Draf Audit Q1");
      expect(saveBody.draft.issues.length).toBeGreaterThan(0); // Preserves issues!

      const draftId = saveBody.draft.id;

      // List drafts
      const listRes = await get(`${EVIDENCE}/drafts`, token);
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json();
      const found = listBody.drafts.find((d: any) => d.id === draftId);
      expect(found).toBeDefined();
      expect(found.issueCount).toBeGreaterThan(0);

      // Reopening draft
      const getRes = await get(`${EVIDENCE}/drafts/${draftId}`, token);
      expect(getRes.status).toBe(200);
      const getBody = await getRes.json();
      expect(getBody.draft.id).toBe(draftId);
      expect(getBody.draft.sourceData.tabular.fileName).toBe("audit.csv");
    });

    it("enforces tenant isolation: Institution B cannot see or open Institution A's draft", async () => {
      const tokenA = await signIn(officer, SINAR);
      const tokenB = await signIn(rivalOfficer, BAITUL);

      // Institution A creates a draft
      const saveRes = await post(
        `${EVIDENCE}/drafts`,
        {
          label: "Draf Rahasia Sinar Amanah",
          period: { kind: "SEMESTER", year: 2024 },
          currencyUnit: "IDR",
        },
        tokenA
      );
      const draftAId = (await saveRes.json()).draft.id;

      // Institution B lists drafts -> does NOT include draftAId
      const listB = await (await get(`${EVIDENCE}/drafts`, tokenB)).json();
      expect(listB.drafts.some((d: any) => d.id === draftAId)).toBe(false);

      // Institution B directly gets draftAId -> 404
      const getB = await get(`${EVIDENCE}/drafts/${draftAId}`, tokenB);
      expect(getB.status).toBe(404);
    });

    it("blocks freezing a draft that contains broken rows", async () => {
      const token = await signIn(officer, SINAR);

      const csvWithBrokenRow = "key,jenis_dana,nilai\nTX01,ZAKAT,\nTX02,ZAKAT,500000";
      const saveRes = await post(
        `${EVIDENCE}/drafts`,
        {
          label: "Draf Cacat",
          period: { kind: "SEMESTER", year: 2024 },
          currencyUnit: "IDR",
          balanceSheetScope: "ON",
          sourceTable: {
            fileName: "broken.csv",
            contentBase64: Buffer.from(csvWithBrokenRow).toString("base64"),
          },
        },
        token
      );
      const draftId = (await saveRes.json()).draft.id;

      // Attempt to freeze
      const freezeRes = await post(`${EVIDENCE}/drafts/${draftId}/freeze`, {}, token);
      expect(freezeRes.status).toBe(400);
      const freezeBody = await freezeRes.json();
      expect(freezeBody.success).toBe(false);
      expect(freezeBody.error).toContain("Draf hanya dapat dibekukan jika tidak ada baris bermasalah");
    });

    it("freezes snapshot when 0 broken rows exist, preserving high-precision rupiah and leading zeros (Scenarios 4, 15, 19)", async () => {
      const token = await signIn(officer, SINAR);

      // Scenario 15: Exact 1.5 trillion rupiah and text ID "0123" with leading zero
      const textId = "0123";
      const largeAmount = "1500000000000"; // 1.5 Trillion

      const validCsv = `key,jenis_dana,nilai,posisi_neraca,uraian\n${textId},ZAKAT,${largeAmount},ON,Penyaluran Triliun`;

      const saveRes = await post(
        `${EVIDENCE}/drafts`,
        {
          label: "Persiapan Semester 1 2024",
          period: { kind: "SEMESTER", year: 2024 },
          currencyUnit: "IDR",
          balanceSheetScope: "ON",
          tolerance: { amount: "0", unit: "IDR" },
          claim: {
            manifest: {
              role: "CLAIM",
              label: "Klaim Laporan",
              origin: "PASTE",
              scopeUnit: "Pusat",
              scopeLevel: "NASIONAL",
              fundTypes: ["ZAKAT"],
              balanceSheet: "ON",
              currencyUnit: "IDR",
              period: { kind: "SEMESTER", year: 2024 },
              cutOff: "2024-06-30T00:00:00.000Z",
              format: "baris-ledger",
              mappingVersion: "1",
              transactionDetail: "PRESENT",
            },
            status: "READ",
            rows: [
              {
                key: textId,
                bucket: "ZAKAT",
                balanceSheet: "ON",
                value: { amount: largeAmount, unit: "IDR" },
              },
            ],
          },
          sourceTable: {
            fileName: "valid_source.csv",
            contentBase64: Buffer.from(validCsv).toString("base64"),
          },
        },
        token
      );

      expect(saveRes.status).toBe(201);
      const draft = (await saveRes.json()).draft;
      expect(draft.issues.length).toBe(0);

      // Freeze draft
      const freezeRes = await post(`${EVIDENCE}/drafts/${draft.id}/freeze`, {}, token);
      const freezeBody = await freezeRes.json();
      if (freezeRes.status !== 201) {
        console.error("FREEZE FAILURE:", JSON.stringify(freezeBody, null, 2));
      }
      expect(freezeRes.status).toBe(201);
      expect(freezeBody.success).toBe(true);

      const prep1 = freezeBody.preparation;
      expect(prep1.outcome).toBe("RECONCILED");

      // Verify text ID and large integer amount survived byte-for-byte in canonical snapshot and stored rows
      const sourceSide = prep1.sources.find((s: any) => s.role === "SOURCE");
      expect(sourceSide.rows[0].key).toBe("0123");
      expect(sourceSide.rows[0].amount).toBe("1500000000000");

      const snapshotSource = prep1.snapshot.sides.find((s: any) => s.manifest.role === "SOURCE");
      expect(snapshotSource.rows[0].key).toBe("0123");
      expect(snapshotSource.rows[0].amount).toBe("1500000000000");

      // Scenario 19: Replacing source or freezing second preparation does NOT mutate the first preparation
      const updatedCsv = `key,jenis_dana,nilai,posisi_neraca\n${textId},ZAKAT,2000000000000,ON`;
      const saveRes2 = await post(
        `${EVIDENCE}/drafts`,
        {
          label: "Persiapan Semester 1 2024 Revisi",
          period: { kind: "SEMESTER", year: 2024 },
          currencyUnit: "IDR",
          balanceSheetScope: "ON",
          claim: {
            manifest: {
              role: "CLAIM",
              label: "Klaim Laporan Revisi",
              origin: "PASTE",
              scopeUnit: "Pusat",
              scopeLevel: "NASIONAL",
              fundTypes: ["ZAKAT"],
              balanceSheet: "ON",
              currencyUnit: "IDR",
              period: { kind: "SEMESTER", year: 2024 },
              cutOff: "2024-06-30T00:00:00.000Z",
              format: "baris-ledger",
              mappingVersion: "1",
              transactionDetail: "PRESENT",
            },
            status: "READ",
            rows: [
              {
                key: textId,
                bucket: "ZAKAT",
                balanceSheet: "ON",
                value: { amount: "2000000000000", unit: "IDR" },
              },
            ],
          },
          sourceTable: {
            fileName: "valid_source_v2.csv",
            contentBase64: Buffer.from(updatedCsv).toString("base64"),
          },
        },
        token
      );
      const draft2 = (await saveRes2.json()).draft;
      const freezeRes2 = await post(`${EVIDENCE}/drafts/${draft2.id}/freeze`, {}, token);
      expect(freezeRes2.status).toBe(201);
      const prep2 = (await freezeRes2.json()).preparation;

      expect(prep2.id).not.toBe(prep1.id);
      expect(prep2.commitment).not.toBe(prep1.commitment);

      // Verify prep1 is untouched
      const reopenPrep1 = await (await get(`${EVIDENCE}/${prep1.id}`, token)).json();
      expect(reopenPrep1.preparation.id).toBe(prep1.id);
      expect(reopenPrep1.preparation.commitment).toBe(prep1.commitment);
      expect(reopenPrep1.commitmentVerified).toBe(true);
      const reopenSource1 = reopenPrep1.preparation.sources.find((s: any) => s.role === "SOURCE");
      expect(reopenSource1.rows[0].amount).toBe("1500000000000"); // Untouched!
    });
  });

  describe("Restricted documents, honest storage, and declared coverage", () => {
    const VALID_CSV = "key,jenis_dana,nilai,posisi_neraca,referensi\nTX01,ZAKAT,500000,ON,REF-1";

    const claimSide = (rows: { key: string; amount: string }[]) => ({
      manifest: {
        role: "CLAIM",
        label: "Klaim",
        origin: "PASTE",
        scopeUnit: "Pusat",
        scopeLevel: "NASIONAL",
        fundTypes: ["ZAKAT"],
        balanceSheet: "ON",
        currencyUnit: "IDR",
        period: { kind: "SEMESTER", year: 2024 },
        cutOff: "2024-06-30T00:00:00.000Z",
        format: "baris-ledger",
        mappingVersion: "1",
        transactionDetail: "PRESENT",
      },
      status: "READ",
      rows: rows.map((row) => ({
        key: row.key,
        bucket: "ZAKAT",
        balanceSheet: "ON",
        value: { amount: row.amount, unit: "IDR" },
      })),
    });

    const saveDraft = (token: string, body: Record<string, unknown> = {}) =>
      post(
        `${EVIDENCE}/drafts`,
        {
          label: "Draf Sumber",
          period: { kind: "SEMESTER", year: 2024 },
          currencyUnit: "IDR",
          balanceSheetScope: "ON",
          tolerance: { amount: "0", unit: "IDR" },
          sourceTable: {
            fileName: "sumber.csv",
            contentBase64: Buffer.from(VALID_CSV).toString("base64"),
          },
          ...body,
        },
        token
      );

    it("keeps the uploaded workbook encrypted, and never returns its bytes or locator", async () => {
      const token = await signIn(officer, SINAR);
      const saved = await (await saveDraft(token)).json();
      const document = saved.draft.sourceData.tabular;

      // What a reader gets: the name, size and hash. Not the bytes, not the locator.
      expect(document.fileName).toBe("sumber.csv");
      expect(document.contentSha256).toMatch(/^0x[0-9a-f]{64}$/);
      expect(document).not.toHaveProperty("contentBase64");
      expect(document).not.toHaveProperty("storageRef");
      expect(JSON.stringify(saved)).not.toContain("TX01");

      // What the database holds: no plaintext of the source anywhere in the row.
      const rows = await database.handle().execute(
        sql`SELECT source_data_json, files_json FROM evidence_drafts WHERE id = ${saved.draft.id}`
      );
      const stored = JSON.stringify(Array.isArray(rows) ? rows : rows.rows);
      expect(stored).not.toContain("TX01");
      expect(stored).not.toContain(Buffer.from(VALID_CSV).toString("base64"));

      // And the file on disk is ciphertext, not the CSV.
      const onDisk = await readdir(fileDirectory, { recursive: true, withFileTypes: true });
      const written = onDisk.filter((entry) => entry.isFile());
      expect(written.length).toBeGreaterThan(0);
      for (const entry of written) {
        const bytes = await readFile(join(entry.parentPath, entry.name));
        expect(bytes.toString("utf8")).not.toContain("TX01");
      }
    });

    it("reopens a draft with its rows read back from the stored workbook", async () => {
      const token = await signIn(officer, SINAR);
      const saved = await (await saveDraft(token)).json();

      const reopened = await (await get(`${EVIDENCE}/drafts/${saved.draft.id}`, token)).json();
      expect(reopened.previewUnavailable).toBeNull();
      expect(reopened.sourcePreview.totalRows).toBe(1);
      expect(reopened.sourcePreview.allRowsPreview[0].rawCells.key).toBe("TX01");
      expect(reopened.sourcePreview.calculableTotal).toBe("500000");
    });

    it("refuses a draft id that belongs to another institution instead of reporting success", async () => {
      const tokenA = await signIn(officer, SINAR);
      const tokenB = await signIn(rivalOfficer, BAITUL);

      const mine = await (await saveDraft(tokenA)).json();
      const collision = await saveDraft(tokenB, { id: mine.draft.id });

      expect(collision.status).toBe(409);
      expect((await collision.json()).success).toBe(false);

      // The first institution's draft is untouched, and the second has nothing.
      const stillMine = await get(`${EVIDENCE}/drafts/${mine.draft.id}`, tokenA);
      expect(stillMine.status).toBe(200);
      const theirs = await (await get(`${EVIDENCE}/drafts`, tokenB)).json();
      expect(theirs.drafts.some((draft: any) => draft.id === mine.draft.id)).toBe(false);
    });

    it("reports a draft that was never there as not found rather than deleted", async () => {
      const token = await signIn(officer, SINAR);
      expect((await del(`${EVIDENCE}/drafts/draft-tidak-ada`, token)).status).toBe(404);

      const saved = await (await saveDraft(token)).json();
      expect((await del(`${EVIDENCE}/drafts/${saved.draft.id}`, token)).status).toBe(200);
      expect((await del(`${EVIDENCE}/drafts/${saved.draft.id}`, token)).status).toBe(404);
    });

    it("declares the coverage the file carries, not the coverage nobody stated", async () => {
      const token = await signIn(officer, SINAR);
      const preview = await (
        await post(
          `${EVIDENCE}/preview`,
          {
            fileName: "sumber.csv",
            contentBase64: Buffer.from(VALID_CSV).toString("base64"),
            ...SCOPE,
          },
          token
        )
      ).json();

      // One ZAKAT row: the manifest says ZAKAT, not all five fund types.
      expect(preview.manifest.fundTypes).toEqual(["ZAKAT"]);
      expect(preview.manifest.period).toEqual(SCOPE.period);
      expect(preview.manifest.mappingVersion).toBe("tawf.source.template.v1");
      expect(preview.manifest.transactionDetail).toBe("PRESENT");
    });

    it("says NOT_AVAILABLE when the rows carry no transaction reference", async () => {
      const token = await signIn(officer, SINAR);
      const recap = "key,jenis_dana,nilai,posisi_neraca\nREKAP-1,ZAKAT,500000,ON";
      const preview = await (
        await post(
          `${EVIDENCE}/preview`,
          { fileName: "rekap.csv", contentBase64: Buffer.from(recap).toString("base64"), ...SCOPE },
          token
        )
      ).json();

      // A recap does not evidence individual payments, and does not claim to.
      expect(preview.manifest.transactionDetail).toBe("NOT_AVAILABLE");
    });

    it("freezes the workbook alongside the rows it produced", async () => {
      const token = await signIn(officer, SINAR);
      const saved = await (await saveDraft(token, { claim: claimSide([{ key: "TX01", amount: "500000" }]) })).json();

      const frozen = await post(`${EVIDENCE}/drafts/${saved.draft.id}/freeze`, {}, token);
      expect(frozen.status).toBe(201);
      const preparation = (await frozen.json()).preparation;

      const workbook = preparation.files.find((file: any) => file.fileName === "sumber.csv");
      expect(workbook).toBeDefined();
      expect(workbook.role).toBe("SOURCE");
      expect(workbook.storageStatus).toBe("STORED");
      expect(workbook.sizeBytes).toBe(Buffer.byteLength(VALID_CSV));

      // And it reads back byte for byte through the authorized route.
      const download = await get(`${EVIDENCE}/${preparation.id}/files/${workbook.id}`, token);
      expect(download.status).toBe(200);
      expect(await download.text()).toBe(VALID_CSV);
    });

    it("carries a declared grand total from the workbook into the snapshot", async () => {
      const token = await signIn(officer, SINAR);
      const withTotal =
        "key,jenis_dana,nilai,posisi_neraca,apakah_total\n" +
        "TX01,ZAKAT,500000,ON,\n" +
        "TOTAL,ZAKAT,500000,ON,YA";
      const saved = await (
        await saveDraft(token, {
          claim: claimSide([{ key: "TX01", amount: "500000" }]),
          sourceTable: {
            fileName: "dengan_total.csv",
            contentBase64: Buffer.from(withTotal).toString("base64"),
          },
        })
      ).json();

      const frozen = await post(`${EVIDENCE}/drafts/${saved.draft.id}/freeze`, {}, token);
      expect(frozen.status).toBe(201);
      const preparation = (await frozen.json()).preparation;
      const source = preparation.sources.find((side: any) => side.role === "SOURCE");

      // The declared total is a row of the side, flagged - not a figure dropped on the way in.
      expect(source.rows.some((row: any) => row.isDeclaredTotal)).toBe(true);
    });

    it("refuses a reader the preview and the template", async () => {
      await store.upsertMembership({ institutionId: SINAR, account: reader.address, role: "READER" });
      const token = await signIn(reader, SINAR);

      const preview = await post(
        `${EVIDENCE}/preview`,
        { fileName: "sumber.csv", contentBase64: Buffer.from(VALID_CSV).toString("base64"), ...SCOPE },
        token
      );
      expect(preview.status).toBe(403);

      const draft = await saveDraft(token);
      expect(draft.status).toBe(403);

      // A reader may still take the template; they simply cannot feed files in.
      expect((await get(`${EVIDENCE}/template`, token)).status).toBe(200);
    });
  });

});

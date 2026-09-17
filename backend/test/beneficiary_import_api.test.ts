/**
 * Beneficiary Tabular Import & Mass Validation API Tests (Spec #86, Ticket #92).
 *
 * Acceptance Scenarios covered:
 * 4. XLSX and CSV equivalent templates and decoding without losing leading zeros or precision.
 * 5. 100 rows with 7 errors: all rows remain visible, errors locate row and column coordinates,
 *    partial totals labeled as partial, invalid rows not turned into zero rupiah.
 * 6. Workbook formulas, macros, oversized files, and unsupported columns are rejected.
 * 8. Multiple aid lines for one recipient are allowed; exact duplicates blocked; aid already on another
 *    proposal flagged for review.
 * 15. IDR integer precision, text NIK with leading zeros, goods with different units not summed together.
 * 25. Browser smoke test for download, upload, preview, keyboard navigation, and draft saving.
 * Draft: stable IDs survive export -> re-import; version conflicts, reused operation IDs and
 *    cross-institution mutation are refused; the source roster is kept privately and re-previewable.
 * Pilot amendment: optional contacts for confirmation without creating fake NIK/identities.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { createDisbursementStore, type DisbursementStore } from "../src/disbursement-store";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { createEncryptedFileStore, type PrivateFileStore } from "../src/evidence-files";
import {
  BENEFICIARY_TEMPLATE_HEADERS,
  BENEFICIARY_TEMPLATE_VERSION,
} from "../src/beneficiary-template-generator";
import { decodeTabular } from "../src/tabular-reader";
import { mapBeneficiaryTabular, type BeneficiaryColumn } from "../src/beneficiary-tabular-schema";

const WORKSPACE = "http://localhost:3001/api/workspace";

const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";

const officer = privateKeyToAccount(`0x${"21".repeat(32)}` as Hex);
const rivalOfficer = privateKeyToAccount(`0x${"24".repeat(32)}` as Hex);
const reader = privateKeyToAccount(`0x${"27".repeat(32)}` as Hex);

const NOW = 1_800_000_000;

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let disbursement: DisbursementStore;
let clock = NOW;
let tempDir: string;
let files: PrivateFileStore;

const request = (url: string, init: RequestInit = {}) => app.fetch(new Request(url, init));

const post = (url: string, body: unknown, token?: string) =>
  request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

const get = (url: string, token?: string) =>
  request(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

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

type SheetRow = Partial<Record<BeneficiaryColumn, string>>;

const cellsOf = (row: SheetRow) => BENEFICIARY_TEMPLATE_HEADERS.map((column) => row[column] ?? "");

function buildXlsxBase64(rows: SheetRow[]): string {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([Array.from(BENEFICIARY_TEMPLATE_HEADERS), ...rows.map(cellsOf)]);
  XLSX.utils.book_append_sheet(wb, ws, "Daftar_Penerima");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(buf).toString("base64");
}

/** A valid money row; override any cell. */
const moneyRow = (overrides: SheetRow): SheetRow => ({
  nama: "Penerima Uji",
  dasar_identitas: "NIK",
  nik: "3201010101800001",
  alamat_cakupan: "Desa Uji",
  asnaf: "FAKIR",
  jenis_bantuan: "UANG",
  nama_bantuan: "Bantuan tunai",
  nilai_idr: "500000",
  periode_bantuan: "2026-03",
  ...overrides,
});

const preview = async (token: string, rows: SheetRow[], extra: Record<string, unknown> = {}) => {
  const res = await post(
    `${WORKSPACE}/proposals/import/preview`,
    { fileName: "daftar.xlsx", contentBase64: buildXlsxBase64(rows), ...extra },
    token
  );
  expect(res.status).toBe(200);
  return (await res.json()).preview;
};

const createProgram = async (token: string) => {
  const res = await post(
    `${WORKSPACE}/programs`,
    { name: "Program Bantuan Ramadhan", purpose: "Santunan asnaf", fundType: "ZAKAT", scope: "2026", referenceCeiling: "500000000" },
    token
  );
  expect(res.status).toBe(201);
  return (await res.json()).program;
};

const draftBody = (programId: string, roster: { beneficiaries: unknown[]; aidLines: unknown[] }, extra: Record<string, unknown> = {}) => ({
  programId,
  originOfRequest: "Permohonan DKM",
  purpose: "Santunan Ramadhan Tahap 1",
  aidPeriod: { start: "2026-03-01", end: "2026-03-31" },
  personInCharge: "Haji Sulaiman",
  beneficiaries: roster.beneficiaries,
  aidLines: roster.aidLines,
  operationId: crypto.randomUUID(),
  expectedVersion: 0,
  ...extra,
});

describe("Beneficiary Tabular Import & Mass Validation (Ticket #92)", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "beneficiary-import-files-"));
    files = createEncryptedFileStore({ directory: tempDir, key: Buffer.alloc(32, 7) });
    database = await createTestWorkspaceDatabase();
    store = createWorkspaceStore(database.handle());
    disbursement = createDisbursementStore(database.handle() as never);
    await store.ensureSchema();
    await disbursement.ensureSchema();
  });

  afterAll(async () => {
    resetWorkspace();
    await database.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    clock = NOW;
    await database.reset();

    for (const item of SYNTHETIC_INSTITUTIONS) {
      await store.upsertInstitution(institutionRecordOf(item));
    }
    const adminSinar = SYNTHETIC_INSTITUTIONS.find((i) => i.id === SINAR)!.members.find((m) => m.role === "ADMIN")!.account;
    const adminBaitul = SYNTHETIC_INSTITUTIONS.find((i) => i.id === BAITUL)!.members.find((m) => m.role === "ADMIN")!.account;
    await store.upsertMembership({ institutionId: SINAR, account: adminSinar, role: "ADMIN" });
    await store.upsertMembership({ institutionId: BAITUL, account: adminBaitul, role: "ADMIN" });

    await store.upsertMembership({ institutionId: SINAR, account: officer.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: BAITUL, account: rivalOfficer.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: SINAR, account: reader.address, role: "READER" });

    const off1 = await store.createOfficerProfile({
      id: "off-sinar-officer",
      institutionId: SINAR,
      displayName: "Petugas Sinar",
      account: officer.address,
      role: "OFFICER",
      actor: adminSinar,
      now: clock,
    });
    await store.grantMandate({
      institutionId: SINAR,
      actor: adminSinar,
      now: clock,
      mandate: {
        officerId: off1.id,
        function: "MANAGE_PROGRAMS",
        scopeType: "ALL_PROGRAMS",
        validFrom: clock - 3600,
        validUntil: clock + 86400 * 365,
        assignmentRef: "SK-PROGRAM-01",
      },
    });
    await store.grantMandate({
      institutionId: SINAR,
      actor: adminSinar,
      now: clock,
      mandate: {
        officerId: off1.id,
        function: "PREPARE_PROPOSALS",
        scopeType: "ALL_PROGRAMS",
        validFrom: clock - 3600,
        validUntil: clock + 86400 * 365,
        assignmentRef: "SK-PREPARE-01",
      },
    });

    const off2 = await store.createOfficerProfile({
      id: "off-baitul-officer",
      institutionId: BAITUL,
      displayName: "Petugas Baitul",
      account: rivalOfficer.address,
      role: "OFFICER",
      actor: adminBaitul,
      now: clock,
    });
    await store.grantMandate({
      institutionId: BAITUL,
      actor: adminBaitul,
      now: clock,
      mandate: {
        officerId: off2.id,
        function: "PREPARE_PROPOSALS",
        scopeType: "ALL_PROGRAMS",
        validFrom: clock - 3600,
        validUntil: clock + 86400 * 365,
        assignmentRef: "SK-PREPARE-02",
      },
    });

    configureWorkspace({
      store,
      disbursement,
      files,
      now: () => clock,
      ethCall: async () => "0x",
      challengeTtlSeconds: 300,
      sessionTtlSeconds: 3600,
    });
  });

  describe("Template Generation & Format Equivalence (Scenario 4)", () => {
    it("refuses template download without authentication or disbursement role", async () => {
      expect((await get(`${WORKSPACE}/proposals/template`)).status).toBe(401);
      const readerToken = await signIn(reader, SINAR);
      expect((await get(`${WORKSPACE}/proposals/template`, readerToken)).status).toBe(403);
    });

    it("serves versioned XLSX template with instruction and data sheets", async () => {
      const token = await signIn(officer, SINAR);
      const res = await get(`${WORKSPACE}/proposals/template?format=xlsx`, token);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain(`filename="${BENEFICIARY_TEMPLATE_VERSION}.xlsx"`);
      expect(res.headers.get("content-type")).toContain("spreadsheetml");

      const decoded = decodeTabular(new Uint8Array(await res.arrayBuffer()), "template.xlsx");
      expect(decoded.success).toBe(true);
      expect(decoded.table?.sheetName).toBe("Daftar_Penerima");
      expect(decoded.table?.headers).toEqual(Array.from(BENEFICIARY_TEMPLATE_HEADERS));
      expect(decoded.table?.rows.length).toBeGreaterThan(0);
    });

    it("serves versioned CSV template that maps identically to XLSX, with every sample row valid", async () => {
      const token = await signIn(officer, SINAR);
      const res = await get(`${WORKSPACE}/proposals/template?format=csv`, token);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain(`filename="${BENEFICIARY_TEMPLATE_VERSION}.csv"`);
      expect(res.headers.get("content-type")).toContain("text/csv");

      const decodedCsv = decodeTabular(await res.text(), "template.csv");
      expect(decodedCsv.success).toBe(true);
      expect(decodedCsv.table?.headers).toEqual(Array.from(BENEFICIARY_TEMPLATE_HEADERS));

      const xlsxRes = await get(`${WORKSPACE}/proposals/template?format=xlsx`, token);
      const decodedXlsx = decodeTabular(new Uint8Array(await xlsxRes.arrayBuffer()), "template.xlsx");

      let n = 0;
      const ids = () => `id-${++n}`;
      const mappedCsv = mapBeneficiaryTabular(decodedCsv.table!, { generateId: ids });
      n = 0;
      const mappedXlsx = mapBeneficiaryTabular(decodedXlsx.table!, { generateId: ids });

      expect(mappedXlsx.invalidRowsCount).toBe(0);
      expect(mappedCsv.beneficiaries).toEqual(mappedXlsx.beneficiaries);
      expect(mappedCsv.aidLines).toEqual(mappedXlsx.aidLines);
      expect(mappedCsv.totalsByUnit).toEqual(mappedXlsx.totalsByUnit);
      expect(mappedXlsx.aidLines.map((line) => line.evidenceReference)).toContain("SKTM-2026-001");
    });
  });

  describe("Security & Tabular Rules (Scenario 6)", () => {
    it("rejects workbook cells containing spreadsheet formulas", async () => {
      const token = await signIn(officer, SINAR);
      const csvWithFormula = `nama,asnaf,alamat_cakupan,dasar_identitas,nik,jenis_bantuan,nilai_idr\nBudi,FAKIR,Jakarta,NIK,3201010101800001,UANG,=SUM(A1:A10)`;
      const res = await post(
        `${WORKSPACE}/proposals/import/preview`,
        { fileName: "formula.csv", contentBase64: Buffer.from(csvWithFormula).toString("base64") },
        token
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.issues[0].code).toBe("FORMULA_FORBIDDEN");
      expect(body.error).toContain("Formula tidak dieksekusi");
    });

    it("names unsupported columns, still previews every row, and refuses to apply", async () => {
      const token = await signIn(officer, SINAR);
      const csvBadCol =
        "nama,dasar_identitas,nik,asnaf,alamat_cakupan,jenis_bantuan,nilai_idr,periode_bantuan,kolom_asing_tidak_dikenal\n" +
        "Budi,NIK,3201010101800001,FAKIR,Jakarta,UANG,100000,2026-03,123";
      const res = await post(
        `${WORKSPACE}/proposals/import/preview`,
        { fileName: "bad_cols.csv", contentBase64: Buffer.from(csvBadCol).toString("base64") },
        token
      );
      expect(res.status).toBe(200);
      const { preview: result } = await res.json();
      expect(result.issues[0].code).toBe("UNSUPPORTED_COLUMN");
      expect(result.issues[0].message).toContain('Kolom "kolom_asing_tidak_dikenal" tidak dikenali');
      expect(result.allRowsPreview.length).toBe(1);
      expect(result.allRowsPreview[0].isValid).toBe(true);
      expect(result.canApply).toBe(false);
      expect(result.isPartial).toBe(true);
    });

    it("refuses callers with only READER role", async () => {
      const token = await signIn(reader, SINAR);
      const res = await post(
        `${WORKSPACE}/proposals/import/preview`,
        { fileName: "preview.csv", contentBase64: Buffer.from("nama\nBudi").toString("base64") },
        token
      );
      expect(res.status).toBe(403);
    });
  });

  describe("100 Rows with 7 Errors (Scenario 5, US-24, US-25)", () => {
    it("displays all 100 rows, locates exact 7 errors with coordinates, and labels totals as partial", async () => {
      const token = await signIn(officer, SINAR);

      const rows: SheetRow[] = [];
      for (let i = 1; i <= 93; i++) {
        rows.push(moneyRow({
          id_baris: `LINE-${i}`,
          id_penerima: `BEN-${i}`,
          nama: `Penerima Valid ${i}`,
          nik: String(1000000000000000n + BigInt(i)),
          alamat_cakupan: `Desa Sukamaju RT ${i}`,
          asnaf: i % 2 === 0 ? "FAKIR" : "MISKIN",
          nilai_idr: "1000000",
          referensi_bukti: `BUKTI-${i}`,
          kontak_telepon: `0812000000${String(i).padStart(2, "0")}`,
        }));
      }
      const broken = (i: number, overrides: SheetRow) =>
        moneyRow({ id_baris: `LINE-${i}`, id_penerima: `BEN-${i}`, nik: `32010101018000${i}`, ...overrides });
      rows.push(broken(94, { nama: "" }));
      rows.push(broken(95, { nama: "Penerima NIK Pendek", nik: "320101010180009" }));
      rows.push(broken(96, { nama: "Penerima Tanpa Alasan", dasar_identitas: "ALTERNATIF", nik: "" }));
      rows.push(broken(97, { nama: "Penerima Asnaf Salah", asnaf: "KAYA" }));
      rows.push(broken(98, { nama: "Penerima Rupiah Desimal", nilai_idr: "500000.50" }));
      rows.push(broken(99, { nama: "Penerima Barang Tanpa Satuan", jenis_bantuan: "BARANG", nilai_idr: "", jumlah_barang: "10" }));
      rows.push(broken(100, { nama: "Penerima Wali Tanpa Hubungan", dasar_identitas: "ALTERNATIF", nik: "", keterangan_identitas: "Surat RT", nama_perwakilan: "Pak Budi" }));
      expect(rows.length).toBe(100);

      const result = await preview(token, rows);

      expect(result.allRowsPreview.length).toBe(100);
      expect(result.validRowsCount).toBe(93);
      expect(result.invalidRowsCount).toBe(7);
      expect(result.isPartial).toBe(true);
      expect(result.canApply).toBe(true);
      expect(result.totalsByUnit.IDR).toBe("93000000");
      expect(result.aidLines.length).toBe(93);

      // Row 1 is the header, so data row i sits on spreadsheet row i + 1.
      const firstIssue = (rowNumber: number) => {
        const row = result.allRowsPreview.find((r: any) => r.rowNumber === rowNumber);
        expect(row.isValid).toBe(false);
        return row.issues[0];
      };
      expect(firstIssue(95)).toMatchObject({ field: "nama", column: "nama", code: "REQUIRED_FIELD_MISSING" });
      expect(firstIssue(95).message).toContain('Baris 95 kolom "nama": Nama penerima tidak boleh kosong');
      expect(firstIssue(96)).toMatchObject({ field: "nik", code: "INVALID_NIK" });
      expect(firstIssue(96).message).toContain("NIK harus 16 digit");
      expect(firstIssue(97)).toMatchObject({ field: "keterangan_identitas", code: "INVALID_IDENTITY_BASIS" });
      expect(firstIssue(98)).toMatchObject({ field: "asnaf", code: "INVALID_ASNAF" });
      expect(firstIssue(99)).toMatchObject({ field: "nilai_idr", code: "INVALID_AMOUNT" });
      expect(firstIssue(99).message).toContain("bilangan bulat rupiah");
      expect(firstIssue(100)).toMatchObject({ field: "satuan_barang", code: "MISSING_UNIT" });
      expect(firstIssue(101)).toMatchObject({ field: "hubungan_perwakilan", code: "MISSING_GUARDIAN_RELATION" });
    });
  });

  describe("Grouping, Duplicates & Recurring Aid (Scenario 8, US-12, US-28)", () => {
    it("groups several distinct aid lines for one beneficiary without flagging them as recurring", async () => {
      const token = await signIn(officer, SINAR);
      const person = { nama: "Ahmad Sahal", nik: "3201010101801234", alamat_cakupan: "Jl. Mawar 1", kontak_telepon: "081234567890" };
      const result = await preview(token, [
        moneyRow({ ...person, nilai_idr: "1000000" }),
        moneyRow({ ...person, jenis_bantuan: "BARANG", nama_bantuan: "Paket sembako", nilai_idr: "", jumlah_barang: "2", satuan_barang: "Paket", nilai_idr_barang: "500000", dasar_valuasi_barang: "Estimasi berdasarkan penawaran pemasok sintetis REF-01" }),
      ]);

      expect(result.uniqueBeneficiaryCount).toBe(1);
      expect(result.aidLineCount).toBe(2);
      expect(result.beneficiaries[0].name).toBe("Ahmad Sahal");
      expect(result.aidLines.every((line: any) => line.beneficiaryId === result.beneficiaries[0].id)).toBe(true);
      expect(result.issues).toEqual([]);
    });

    it("keeps different goods with the same quantity and unit as separate aid lines", async () => {
      const token = await signIn(officer, SINAR);
      const goods = { jenis_bantuan: "BARANG", nilai_idr: "", jumlah_barang: "10", satuan_barang: "Kg" };
      const result = await preview(token, [
        moneyRow({ ...goods, nama_bantuan: "Beras" }),
        moneyRow({ ...goods, nama_bantuan: "Gula" }),
      ]);
      expect(result.invalidRowsCount).toBe(0);
      expect(result.aidLines.map((line: any) => line.aidType)).toEqual(["Beras", "Gula"]);
      expect(result.totalsByUnit).toEqual({ "Beras:Kg": "10", "Gula:Kg": "10" });
    });

    it("blocks exact duplicate aid lines on the same recipient with an error", async () => {
      const token = await signIn(officer, SINAR);
      const result = await preview(token, [moneyRow({}), moneyRow({})]);
      expect(result.invalidRowsCount).toBe(1);
      expect(result.allRowsPreview[1].issues[0].code).toBe("EXACT_DUPLICATE_AID");
      expect(result.aidLines.length).toBe(1);
    });

    it("refuses rows that contradict an earlier row for the same recipient or reuse a line id", async () => {
      const token = await signIn(officer, SINAR);
      const result = await preview(token, [
        moneyRow({ id_penerima: "BEN-1", id_baris: "LINE-1" }),
        moneyRow({ id_penerima: "BEN-1", id_baris: "LINE-2", nama: "Nama Lain", nilai_idr: "1" }),
        moneyRow({ id_penerima: "BEN-1", id_baris: "LINE-1", nilai_idr: "2" }),
        moneyRow({ id_penerima: "BEN-2", id_baris: "LINE-3", nilai_idr: "3" }),
      ]);
      const codes = result.allRowsPreview.map((row: any) => row.issues.map((issue: any) => issue.code));
      expect(codes).toEqual([[], ["CONFLICTING_RECIPIENT"], ["DUPLICATE_LINE_ID"], ["CONFLICTING_RECIPIENT"]]);
      expect(result.beneficiaries.map((b: any) => b.id)).toEqual(["BEN-1"]);
    });

    it("flags a recipient already on another submitted proposal for review without refusing the row", async () => {
      const token = await signIn(officer, SINAR);
      const program = await createProgram(token);
      const earlier = await preview(token, [moneyRow({ nik: "3201010101804444", nama: "Bu Warsih" })]);
      const saved = await post(`${WORKSPACE}/proposals`, draftBody(program.id, earlier), token);
      expect(saved.status).toBe(201);
      const { draft } = await saved.json();
      await database.handle().execute(sql`UPDATE proposal_drafts SET status = 'SUBMITTED' WHERE id = ${draft.id}`);

      const result = await preview(token, [moneyRow({ nik: "3201010101804444", nama: "Bu Warsih", periode_bantuan: "2026-04" })]);
      expect(result.validRowsCount).toBe(1);
      expect(result.canApply).toBe(true);
      const warning = result.allRowsPreview[0].issues[0];
      expect(warning).toMatchObject({ code: "RECURRING_AID_WARNING", isWarning: true });
      expect(warning.message).toContain("Program Bantuan Ramadhan");

      // The proposal being edited is not compared with itself.
      const own = await preview(token, [moneyRow({ nik: "3201010101804444", nama: "Bu Warsih" })], { proposalId: draft.id });
      expect(own.issues).toEqual([]);
    });
  });

  describe("Precision, Leading Zeros, Goods Units & Shared Form Data (Scenario 15)", () => {
    it("preserves leading zero in text NIK and high-precision IDR integers", async () => {
      const token = await signIn(officer, SINAR);
      const result = await preview(token, [moneyRow({ nik: "0123456789012345", nilai_idr: "500000000000" })]);
      expect(result.beneficiaries[0].identityBasis.value).toBe("0123456789012345");
      expect(result.aidLines[0].value.amountRequestedIdr).toBe("500000000000");
      expect(result.totalsByUnit.IDR).toBe("500000000000");
    });

    it("does not sum different goods units together and does not invent zero rupiah for unvalued goods", async () => {
      const token = await signIn(officer, SINAR);
      const goods = { jenis_bantuan: "BARANG", nilai_idr: "" };
      const result = await preview(token, [
        moneyRow({ ...goods, nik: "3201010101801111", nama_bantuan: "Sembako", jumlah_barang: "5", satuan_barang: "Paket" }),
        moneyRow({ ...goods, nik: "3201010101802222", nama_bantuan: "Beras", jumlah_barang: "25", satuan_barang: "Kg", nilai_idr_barang: "350000", dasar_valuasi_barang: "Estimasi berdasarkan penawaran pemasok sintetis REF-01" }),
      ]);
      expect(result.totalsByUnit).toEqual({ "Sembako:Paket": "5", "Beras:Kg": "25" });
      expect(result.isPartial).toBe(true);
    });

    it("sums fractional goods quantities exactly", async () => {
      const token = await signIn(officer, SINAR);
      const goods = { jenis_bantuan: "BARANG", nilai_idr: "", nama_bantuan: "Minyak", satuan_barang: "Liter", nilai_idr_barang: "10000", dasar_valuasi_barang: "Estimasi berdasarkan penawaran pemasok sintetis REF-01" };
      const result = await preview(token, [
        moneyRow({ ...goods, nik: "3201010101801111", jumlah_barang: "2.5" }),
        moneyRow({ ...goods, nik: "3201010101802222", jumlah_barang: "1" }),
        moneyRow({ ...goods, nik: "3201010101803333", jumlah_barang: "0.35" }),
        moneyRow({ ...goods, nik: "3201010101804444", jumlah_barang: "0.1" }),
      ]);
      expect(result.invalidRowsCount).toBe(0);
      expect(result.totalsByUnit["Minyak:Liter"]).toBe("3.95");
      expect(result.isPartial).toBe(false);
    });

    it("fills an empty row period from the proposal form and shows the shared program in the preview", async () => {
      const token = await signIn(officer, SINAR);
      const program = await createProgram(token);
      const result = await preview(
        token,
        [moneyRow({ periode_bantuan: "" }), moneyRow({ nik: "3201010101809999", periode_bantuan: "2026-Q2" })],
        { programId: program.id, sharedAidPeriod: "2026-03-01 s/d 2026-03-31" }
      );
      expect(result.sharedContext).toEqual({ programName: "Program Bantuan Ramadhan", aidPeriod: "2026-03-01 s/d 2026-03-31" });
      expect(result.aidLines.map((line: any) => line.period)).toEqual(["2026-03-01 s/d 2026-03-31", "2026-Q2"]);

      const withoutPeriod = await preview(token, [moneyRow({ periode_bantuan: "" })]);
      expect(withoutPeriod.allRowsPreview[0].issues[0]).toMatchObject({ field: "periode_bantuan", code: "REQUIRED_FIELD_MISSING" });
    });
  });

  describe("Proposal Draft with Imported Beneficiaries", () => {
    it("keeps stable IDs, aid names and evidence references through save, export and re-import", async () => {
      const token = await signIn(officer, SINAR);
      const program = await createProgram(token);
      const imported = await preview(token, [
        moneyRow({ nama: "Zaenal Arifin", nik: "3201010101809999", referensi_bukti: "SKTM-01", kontak_telepon: "081299998888", kontak_email: "zaenal@example.org" }),
        moneyRow({ nama: "Zaenal Arifin", nik: "3201010101809999", referensi_bukti: "SKTM-01", kontak_telepon: "081299998888", kontak_email: "zaenal@example.org",
          jenis_bantuan: "BARANG", nama_bantuan: "Beras", nilai_idr: "", jumlah_barang: "12.5", satuan_barang: "Kg" }),
      ]);

      const saveRes = await post(`${WORKSPACE}/proposals`, draftBody(program.id, imported), token);
      expect(saveRes.status).toBe(201);
      const { draft } = await saveRes.json();
      expect(draft.issues).toEqual([]);
      expect(draft.beneficiaries[0].contact?.phone).toBe("081299998888");
      expect(draft.aidLines[1].evidenceReference).toBe("SKTM-01");

      for (const format of ["xlsx", "csv"] as const) {
        const exported = await get(`${WORKSPACE}/proposals/${draft.id}/export?format=${format}`, token);
        expect(exported.status).toBe(200);
        expect(exported.headers.get("content-disposition")).toContain(`proposal-${draft.id}-beneficiaries.${format}`);
        const bytes = Buffer.from(await exported.arrayBuffer());

        const reimported = await post(
          `${WORKSPACE}/proposals/import/preview`,
          { fileName: `export.${format}`, contentBase64: bytes.toString("base64"), proposalId: draft.id },
          token
        );
        const { preview: again } = await reimported.json();
        expect(again.issues).toEqual([]);
        expect(again.beneficiaries).toEqual(draft.beneficiaries);
        expect(again.aidLines).toEqual(draft.aidLines);
      }

      const rivalToken = await signIn(rivalOfficer, BAITUL);
      expect((await get(`${WORKSPACE}/proposals/${draft.id}/export`, rivalToken)).status).toBe(404);
    });

    it("refuses stale versions, reused operation IDs with different content, and cross-institution saves", async () => {
      const token = await signIn(officer, SINAR);
      const program = await createProgram(token);
      const imported = await preview(token, [moneyRow({})]);
      const created = await (await post(`${WORKSPACE}/proposals`, draftBody(program.id, imported), token)).json();

      const operationId = crypto.randomUUID();
      const update = draftBody(program.id, imported, { id: created.draft.id, expectedVersion: 1, operationId, purpose: "Revisi impor" });
      expect((await post(`${WORKSPACE}/proposals`, update, token)).status).toBe(200);

      const stale = { ...update, operationId: crypto.randomUUID(), purpose: "Versi usang" };
      expect((await post(`${WORKSPACE}/proposals`, stale, token)).status).toBe(409);

      const reused = { ...update, expectedVersion: 2, purpose: "Isi berbeda" };
      expect((await post(`${WORKSPACE}/proposals`, reused, token)).status).toBe(409);

      const rivalToken = await signIn(rivalOfficer, BAITUL);
      const crossInstitution = { ...update, expectedVersion: 2, operationId: crypto.randomUUID(), programId: null, purpose: "Lintas lembaga" };
      expect((await post(`${WORKSPACE}/proposals`, crossInstitution, rivalToken)).status).toBeGreaterThanOrEqual(400);

      const kept = await disbursement.getProposalDraft(SINAR, created.draft.id);
      expect(kept?.purpose).toBe("Revisi impor");
      expect(kept?.version).toBe(2);
    });

    it("keeps the source roster privately so its invalid rows can be reviewed again", async () => {
      const token = await signIn(officer, SINAR);
      const program = await createProgram(token);
      const rows = [moneyRow({}), moneyRow({ nik: "3201010101802222", nama: "" })];
      const imported = await preview(token, rows);
      expect(imported.invalidRowsCount).toBe(1);
      const { draft } = await (await post(`${WORKSPACE}/proposals`, draftBody(program.id, imported), token)).json();

      const uploaded = await post(
        `${WORKSPACE}/proposals/${draft.id}/documents`,
        {
          category: "BENEFICIARY_ROSTER",
          fileName: "daftar.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          contentBase64: buildXlsxBase64(rows),
        },
        token
      );
      expect(uploaded.status).toBe(201);
      const { document } = await uploaded.json();

      const reopened = await get(`${WORKSPACE}/proposals/${draft.id}/documents/${document.id}/import-preview`, token);
      expect(reopened.status).toBe(200);
      const { preview: stored } = await reopened.json();
      expect(stored.documentId).toBe(document.id);
      expect(stored.allRowsPreview.length).toBe(2);
      expect(stored.invalidRowsCount).toBe(1);
      expect(stored.allRowsPreview[1].issues[0].field).toBe("nama");
      expect(stored.sharedContext.programName).toBe("Program Bantuan Ramadhan");

      const rivalToken = await signIn(rivalOfficer, BAITUL);
      expect((await get(`${WORKSPACE}/proposals/${draft.id}/documents/${document.id}/import-preview`, rivalToken)).status).toBe(404);
    });

    it("survives database restart keeping beneficiaries and contact details intact", async () => {
      const token = await signIn(officer, SINAR);
      const program = await createProgram(token);
      const imported = await preview(token, [
        moneyRow({ nama: "Keluarga Pak Somad", nik: "3201010101807777", jenis_bantuan: "BARANG", nama_bantuan: "Beras", nilai_idr: "",
          jumlah_barang: "50", satuan_barang: "Kg", nilai_idr_barang: "750000", dasar_valuasi_barang: "Estimasi berdasarkan penawaran pemasok sintetis REF-01", kontak_telepon: "081987654321", kontak_relasi: "Kepala Keluarga" }),
      ]);
      const saveRes = await post(`${WORKSPACE}/proposals`, draftBody(program.id, imported), token);
      expect(saveRes.status).toBe(201);
      const { draft } = await saveRes.json();

      await database.reopen();
      store = createWorkspaceStore(database.handle());
      disbursement = createDisbursementStore(database.handle() as never);
      const reloaded = await disbursement.getProposalDraft(SINAR, draft.id);

      expect(reloaded?.beneficiaries[0].name).toBe("Keluarga Pak Somad");
      expect(reloaded?.beneficiaries[0].contact?.phone).toBe("081987654321");
      expect(reloaded?.beneficiaries[0].contact?.relation).toBe("Kepala Keluarga");
      expect(reloaded?.aidLines[0].aidType).toBe("Beras");
      expect(reloaded?.aidLines[0].value.kind).toBe("GOODS");
      expect(reloaded?.aidLines[0].value).toMatchObject({ valuationBasis: "Estimasi berdasarkan penawaran pemasok sintetis REF-01" });
    });
  });

  // Opt-in browser smoke (Scenario 25): real app, API and database.
  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)(
    "browser: download template, upload roster, keyboard through problems, save draft, reopen stored import",
    async () => {
      const built = await Bun.build({
        entrypoints: [new URL("../../frontend/test/officer-smoke.tsx", import.meta.url).pathname],
        target: "browser",
        define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "" }) },
      });
      if (!built.success) throw new Error(built.logs.join("\n"));
      const bundle = await built.outputs[0]!.text();
      const wallet = officer;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(req) {
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
        },
      });
      const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
      try {
        browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
        const page = await browser.newPage({ acceptDownloads: true });
        page.on("pageerror", (error: Error) => console.error("Beneficiary import browser:", error.message));
        page.setDefaultTimeout(10000);
        await page.goto(server.url.toString());
        await page.getByRole("button", { name: /^0x/ }).waitFor();
        await page.getByLabel("Pengelola Zakat", { exact: true }).selectOption(SINAR);
        await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();
        await page.getByRole("heading", { name: "LPZ Sinar Amanah (sintetis)" }).waitFor();

        await page.getByRole("button", { name: "Program baru", exact: true }).click();
        await page.getByLabel("Nama program", { exact: true }).fill("Program Impor Sintetis");
        await page.getByLabel("Tujuan", { exact: true }).fill("Santunan bulanan");
        await page.getByLabel("Cakupan/periode", { exact: true }).fill("2026");
        await page.getByRole("button", { name: "Simpan program", exact: true }).click();
        await page.locator("p").filter({ hasText: /^Program Impor Sintetis$/ }).waitFor();

        await page.getByRole("button", { name: "Pengajuan baru", exact: true }).click();
        await page.getByLabel("Asal permohonan", { exact: true }).fill("Permohonan RT 04");
        await page.getByLabel("Penanggung jawab pengajuan", { exact: true }).fill("Amil Sintetis");
        await page.getByLabel("Tujuan pengajuan", { exact: true }).fill("Santunan impor");
        await page.getByLabel("Periode bantuan mulai", { exact: true }).fill("2026-03-01");
        await page.getByLabel("Periode bantuan selesai", { exact: true }).fill("2026-03-31");

        await page.getByRole("button", { name: "Impor XLSX / CSV", exact: true }).click();
        const dialog = page.getByRole("dialog");
        const download = page.waitForEvent("download");
        await dialog.getByRole("button", { name: "Template XLSX", exact: true }).click();
        expect((await download).suggestedFilename()).toBe(`${BENEFICIARY_TEMPLATE_VERSION}.xlsx`);

        const roster = [
          moneyRow({ nama: "Mustahik Satu", periode_bantuan: "" }),
          moneyRow({ nama: "", nik: "3201010101802222" }),
          moneyRow({ nama: "Mustahik Tiga", nik: "3201010101803333", nilai_idr: "12.5" }),
          moneyRow({ nama: "Mustahik Empat", nik: "3201010101804444", jenis_bantuan: "BARANG", nama_bantuan: "Beras", nilai_idr: "", jumlah_barang: "2.5", satuan_barang: "Kg" }),
        ];
        await dialog.getByLabel("Berkas daftar penerima", { exact: true }).setInputFiles({
          name: "daftar-sintetis.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: Buffer.from(buildXlsxBase64(roster), "base64"),
        });
        await dialog.getByText("2 baris perlu diperiksa", { exact: true }).waitFor();
        await dialog.getByText("2026-03-01 s/d 2026-03-31", { exact: true }).waitFor();

        // Keyboard only: reach the first problem, then arrow between problems.
        const focusedLabel = () => page.evaluate(() => (globalThis as any).document.activeElement?.getAttribute("aria-label") ?? "");
        await dialog.getByRole("button", { name: /Masalah berikutnya/ }).focus();
        await page.keyboard.press("Enter");
        expect(await focusedLabel()).toContain("Baris 3");
        await page.keyboard.press("ArrowDown");
        expect(await focusedLabel()).toContain("Baris 4");
        await page.keyboard.press("ArrowDown");
        expect(await focusedLabel()).toContain("Baris 3");
        await dialog.getByText("Masalah 1 dari 2", { exact: true }).waitFor();

        await dialog.getByRole("button", { name: /Terapkan ke Draf Pengajuan \(2 Penerima\)/ }).click();
        await dialog.waitFor({ state: "detached" });
        await page.getByText(/Berkas impor "daftar-sintetis.xlsx" akan disimpan privat/).waitFor();

        const saved = page.waitForResponse((r: any) => new URL(r.url()).pathname === "/api/workspace/proposals" && r.request().method() === "POST");
        await page.getByRole("button", { name: "Simpan draf", exact: true }).click();
        const { draft } = await (await saved).json();
        expect(draft.beneficiaries.map((b: any) => b.name)).toEqual(["Mustahik Satu", "Mustahik Empat"]);
        expect(draft.aidLines[0].period).toBe("2026-03-01 s/d 2026-03-31");
        expect(draft.issues).toEqual([]);

        await page.getByRole("button", { name: "Buka pratinjau & masalah impor", exact: true }).click();
        await page.getByRole("dialog").getByText("2 baris perlu diperiksa", { exact: true }).waitFor();
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "detached" });
        const documents = await disbursement.listProposalDocuments(SINAR, draft.id);
        expect(documents.map((doc) => doc.category)).toEqual(["BENEFICIARY_ROSTER"]);
      } finally {
        await browser?.close();
        await server.stop(true);
      }
    },
    60000
  );
});

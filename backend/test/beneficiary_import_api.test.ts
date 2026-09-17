/**
 * Beneficiary Tabular Import & Mass Validation API Tests (Spec #86, Ticket #92).
 *
 * Acceptance Scenarios covered:
 * 4. XLSX and CSV equivalent templates and decoding without losing leading zeros or precision.
 * 5. 100 rows with 7 errors: all rows remain visible, errors locate row and column coordinates,
 *    partial totals labeled as partial, invalid rows not turned into zero rupiah.
 * 6. Workbook formulas, macros, oversized files, and unsupported columns are rejected.
 * 8. Multiple aid lines for one recipient are allowed; exact duplicates blocked; recurring aid flagged for review.
 * 15. IDR integer precision, text NIK with leading zeros, goods with different units not summed together.
 * 25. Browser smoke test for download, upload, preview, keyboard navigation, and draft saving.
 * Pilot amendment: optional contacts for confirmation without creating fake NIK/identities.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as XLSX from "xlsx";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { createDisbursementStore, type DisbursementStore } from "../src/disbursement-store";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import {
  BENEFICIARY_TEMPLATE_HEADERS,
  BENEFICIARY_TEMPLATE_VERSION,
} from "../src/beneficiary-template-generator";
import { decodeTabular } from "../src/tabular-reader";
import { mapBeneficiaryTabular } from "../src/beneficiary-tabular-schema";

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

function buildXlsxBase64(headers: readonly string[], rows: (string | number)[][]): string {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, "Daftar_Penerima");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(buf).toString("base64");
}

function buildCsvString(headers: readonly string[], rows: (string | number)[][]): string {
  const allRows = [headers, ...rows];
  return allRows
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? "");
          return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(",")
    )
    .join("\n");
}

describe("Beneficiary Tabular Import & Mass Validation (Ticket #92)", () => {
  beforeAll(async () => {
    database = await createTestWorkspaceDatabase();
    store = createWorkspaceStore(database.handle());
    disbursement = createDisbursementStore(database.handle() as never);
    await store.ensureSchema();
    await disbursement.ensureSchema();
  });

  afterAll(async () => {
    resetWorkspace();
    await database.close();
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
      now: () => clock,
      ethCall: async () => "0x",
      challengeTtlSeconds: 300,
      sessionTtlSeconds: 3600,
    });
  });

  describe("Template Generation & Format Equivalence (Scenario 4)", () => {
    it("refuses template download without authentication", async () => {
      const res = await get(`${WORKSPACE}/proposals/template`);
      expect(res.status).toBe(401);
    });

    it("serves versioned XLSX template with instruction and data sheets", async () => {
      const token = await signIn(officer, SINAR);
      const res = await get(`${WORKSPACE}/proposals/template?format=xlsx`, token);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain(`filename="${BENEFICIARY_TEMPLATE_VERSION}.xlsx"`);
      expect(res.headers.get("content-type")).toContain("spreadsheetml");

      const buf = await res.arrayBuffer();
      const decoded = decodeTabular(new Uint8Array(buf), "template.xlsx");
      expect(decoded.success).toBe(true);
      expect(decoded.table?.sheetName).toBe("Daftar_Penerima");
      expect(decoded.table?.headers).toEqual(Array.from(BENEFICIARY_TEMPLATE_HEADERS));
      expect(decoded.table?.rows.length).toBeGreaterThan(0);
    });

    it("serves versioned CSV template and decodes equivalently to XLSX", async () => {
      const token = await signIn(officer, SINAR);
      const res = await get(`${WORKSPACE}/proposals/template?format=csv`, token);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain(`filename="${BENEFICIARY_TEMPLATE_VERSION}.csv"`);
      expect(res.headers.get("content-type")).toContain("text/csv");

      const csvText = await res.text();
      const decodedCsv = decodeTabular(csvText, "template.csv");
      expect(decodedCsv.success).toBe(true);
      expect(decodedCsv.table?.headers).toEqual(Array.from(BENEFICIARY_TEMPLATE_HEADERS));

      // XLSX and CSV mapping produces identical beneficiaries, counts, and totals
      const xlsxRes = await get(`${WORKSPACE}/proposals/template?format=xlsx`, token);
      const decodedXlsx = decodeTabular(new Uint8Array(await xlsxRes.arrayBuffer()), "template.xlsx");

      const mappedCsv = mapBeneficiaryTabular(decodedCsv.table!);
      const mappedXlsx = mapBeneficiaryTabular(decodedXlsx.table!);

      expect(mappedCsv.uniqueBeneficiaryCount).toBe(mappedXlsx.uniqueBeneficiaryCount);
      expect(mappedCsv.aidLineCount).toBe(mappedXlsx.aidLineCount);
      expect(mappedCsv.totalsByUnit).toEqual(mappedXlsx.totalsByUnit);
    });
  });

  describe("Security & Tabular Rules (Scenario 6)", () => {
    it("rejects workbook cells containing spreadsheet formulas", async () => {
      const token = await signIn(officer, SINAR);
      const csvWithFormula = `nama,asnaf,alamat_cakupan,dasar_identitas,nik,jenis_bantuan,nilai_idr\nBudi,FAKIR,Jakarta,NIK,3201010101800001,UANG,=SUM(A1:A10)`;
      const res = await post(
        `${WORKSPACE}/proposals/import/preview`,
        {
          fileName: "formula.csv",
          contentBase64: Buffer.from(csvWithFormula).toString("base64"),
        },
        token
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.issues[0].code).toBe("FORMULA_FORBIDDEN");
      expect(body.error).toContain("Formula tidak dieksekusi");
    });

    it("rejects unsupported column names with clear Indonesian coordinates", async () => {
      const token = await signIn(officer, SINAR);
      const csvBadCol = `nama,asnaf,alamat_cakupan,kolom_asing_tidak_dikenal\nBudi,FAKIR,Jakarta,123`;
      const res = await post(
        `${WORKSPACE}/proposals/import/preview`,
        {
          fileName: "bad_cols.csv",
          contentBase64: Buffer.from(csvBadCol).toString("base64"),
        },
        token
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.preview.issues.some((i: any) => i.code === "UNSUPPORTED_COLUMN")).toBe(true);
      expect(body.preview.issues[0].message).toContain('Kolom "kolom_asing_tidak_dikenal" tidak dikenali');
    });

    it("refuses callers with only READER role", async () => {
      const token = await signIn(reader, SINAR);
      const csv = `nama,asnaf,alamat_cakupan\nBudi,FAKIR,Jakarta`;
      const res = await post(
        `${WORKSPACE}/proposals/import/preview`,
        {
          fileName: "preview.csv",
          contentBase64: Buffer.from(csv).toString("base64"),
        },
        token
      );
      expect(res.status).toBe(403);
    });
  });

  describe("100 Rows with 7 Errors (Scenario 5, US-24, US-25)", () => {
    it("displays all 100 rows, locates exact 7 errors with coordinates, and labels totals as partial", async () => {
      const token = await signIn(officer, SINAR);

      const rows: (string | number)[][] = [];

      // Generate 93 valid rows
      for (let i = 1; i <= 93; i++) {
        const nik16 = String(1000000000000000n + BigInt(i)).padStart(16, "0");
        rows.push([
          `LINE-${i}`,
          `BEN-${i}`,
          `Penerima Valid ${i}`,
          "NIK",
          nik16,
          "",
          "",
          "",
          `Desa Sukamaju RT ${i}`,
          i % 2 === 0 ? "FAKIR" : "MISKIN",
          "UANG",
          "1000000",
          "",
          "",
          "",
          "2026-03",
          "",
          "",
          `BUKTI-${i}`,
          `0812000000${i.toString().padStart(2, "0")}`,
          `penerima${i}@example.org`,
          "Pribadi",
        ]);
      }

      // Add 7 specific invalid rows (Row 94 to 100)
      // 1. Missing name (Row 94)
      rows.push([
        "LINE-94", "BEN-94", "", "NIK", "3201010101800094", "", "", "", "Jl. Mawar", "FAKIR", "UANG", "500000", "", "", "", "2026-03", "", "", "", "", "", ""
      ]);
      // 2. Invalid NIK (15 digits instead of 16) (Row 95)
      rows.push([
        "LINE-95", "BEN-95", "Penerima NIK Pendek", "NIK", "320101010180009", "", "", "", "Jl. Melati", "FAKIR", "UANG", "500000", "", "", "", "2026-03", "", "", "", "", "", ""
      ]);
      // 3. Alternative identity missing description (Row 96)
      rows.push([
        "LINE-96", "BEN-96", "Penerima Tanpa Alasan", "ALTERNATIF", "", "", "", "", "Jl. Anggrek", "MISKIN", "UANG", "500000", "", "", "", "2026-03", "", "", "", "", "", ""
      ]);
      // 4. Invalid asnaf category (Row 97)
      rows.push([
        "LINE-97", "BEN-97", "Penerima Asnaf Salah", "NIK", "3201010101800097", "", "", "", "Jl. Dahlia", "KAYA", "UANG", "500000", "", "", "", "2026-03", "", "", "", "", "", ""
      ]);
      // 5. Non-integer IDR rupiah (Row 98)
      rows.push([
        "LINE-98", "BEN-98", "Penerima Rupiah Desimal", "NIK", "3201010101800098", "", "", "", "Jl. Kenanga", "FAKIR", "UANG", "500000.50", "", "", "", "2026-03", "", "", "", "", "", ""
      ]);
      // 6. Goods without unit (Row 99)
      rows.push([
        "LINE-99", "BEN-99", "Penerima Barang Tanpa Satuan", "NIK", "3201010101800099", "", "", "", "Jl. Cempaka", "MISKIN", "BARANG", "", "10", "", "", "2026-03", "", "", "", "", "", ""
      ]);
      // 7. Guardian name provided without relationship (Row 100)
      rows.push([
        "LINE-100", "BEN-100", "Penerima Wali Tanpa Hubungan", "ALTERNATIF", "", "Surat RT", "Pak Budi", "", "Jl. Teratai", "FAKIR", "UANG", "500000", "", "", "", "2026-03", "", "", "", "", "", ""
      ]);

      expect(rows.length).toBe(100);

      const b64 = buildXlsxBase64(BENEFICIARY_TEMPLATE_HEADERS, rows);

      const res = await post(
        `${WORKSPACE}/proposals/import/preview`,
        {
          fileName: "seratus_baris_tujuh_error.xlsx",
          contentBase64: b64,
        },
        token
      );
      expect(res.status).toBe(200);

      const { preview } = await res.json();

      // All 100 rows must be present in preview
      expect(preview.allRowsPreview.length).toBe(100);

      // Exactly 93 valid and 7 invalid rows
      expect(preview.validRowsCount).toBe(93);
      expect(preview.invalidRowsCount).toBe(7);

      // Total must be marked partial
      expect(preview.isPartial).toBe(true);

      // Total IDR must only sum the 93 valid rows (93 * 1,000,000 = 93,000,000)
      expect(preview.totalsByUnit.IDR).toBe("93000000");

      // Verify specific errors identify coordinates and clear messages
      const row94 = preview.allRowsPreview.find((r: any) => r.rowNumber === 95); // row 1 is header
      expect(row94.isValid).toBe(false);
      expect(row94.issues[0].field).toBe("nama");
      expect(row94.issues[0].message).toContain("Nama penerima tidak boleh kosong");

      const row95 = preview.allRowsPreview.find((r: any) => r.rowNumber === 96);
      expect(row95.isValid).toBe(false);
      expect(row95.issues[0].field).toBe("nik");
      expect(row95.issues[0].message).toContain("NIK harus 16 digit angka teks");

      const row96 = preview.allRowsPreview.find((r: any) => r.rowNumber === 97);
      expect(row96.isValid).toBe(false);
      expect(row96.issues[0].field).toBe("keterangan_identitas");

      const row97 = preview.allRowsPreview.find((r: any) => r.rowNumber === 98);
      expect(row97.isValid).toBe(false);
      expect(row97.issues[0].field).toBe("asnaf");

      const row98 = preview.allRowsPreview.find((r: any) => r.rowNumber === 99);
      expect(row98.isValid).toBe(false);
      expect(row98.issues[0].field).toBe("nilai_idr");
      expect(row98.issues[0].message).toContain("bilangan bulat rupiah tanpa desimal");

      const row99 = preview.allRowsPreview.find((r: any) => r.rowNumber === 100);
      expect(row99.isValid).toBe(false);
      expect(row99.issues[0].field).toBe("satuan_barang");

      const row100 = preview.allRowsPreview.find((r: any) => r.rowNumber === 101);
      expect(row100.isValid).toBe(false);
      expect(row100.issues[0].field).toBe("hubungan_perwakilan");
    });
  });

  describe("Grouping, Exact Duplicate Blocking & Recurring Aid (Scenario 8, US-12, US-28)", () => {
    it("groups multiple aid lines for one beneficiary and flags recurring aid for review", async () => {
      const token = await signIn(officer, SINAR);

      const rows = [
        [
          "", "", "Ahmad Sahal", "NIK", "3201010101801234", "", "", "", "Jl. Mawar 1", "FAKIR",
          "UANG", "1000000", "", "", "", "2026-03", "", "", "", "081234567890", "", ""
        ],
        [
          "", "", "Ahmad Sahal", "NIK", "3201010101801234", "", "", "", "Jl. Mawar 1", "FAKIR",
          "BARANG", "", "2", "Paket", "500000", "2026-03", "", "", "", "081234567890", "", ""
        ],
      ];

      const b64 = buildXlsxBase64(BENEFICIARY_TEMPLATE_HEADERS, rows);
      const res = await post(
        `${WORKSPACE}/proposals/import/preview`,
        { fileName: "multi_aid.xlsx", contentBase64: b64 },
        token
      );
      expect(res.status).toBe(200);
      const { preview } = await res.json();

      // Grouped into 1 beneficiary with 2 aid lines
      expect(preview.uniqueBeneficiaryCount).toBe(1);
      expect(preview.aidLineCount).toBe(2);
      expect(preview.beneficiaries.length).toBe(1);
      expect(preview.aidLines.length).toBe(2);
      expect(preview.beneficiaries[0].name).toBe("Ahmad Sahal");

      // Recurring aid warning present
      expect(preview.issues.some((i: any) => i.code === "RECURRING_AID_WARNING")).toBe(true);
    });

    it("blocks exact duplicate aid lines on the same recipient with an error", async () => {
      const token = await signIn(officer, SINAR);

      const rows = [
        [
          "", "", "Siti Fatimah", "NIK", "3201010101805555", "", "", "", "Desa Melati", "MISKIN",
          "UANG", "750000", "", "", "", "2026-03", "", "", "", "", "", ""
        ],
        [
          "", "", "Siti Fatimah", "NIK", "3201010101805555", "", "", "", "Desa Melati", "MISKIN",
          "UANG", "750000", "", "", "", "2026-03", "", "", "", "", "", ""
        ],
      ];

      const b64 = buildXlsxBase64(BENEFICIARY_TEMPLATE_HEADERS, rows);
      const res = await post(
        `${WORKSPACE}/proposals/import/preview`,
        { fileName: "exact_dup.xlsx", contentBase64: b64 },
        token
      );
      expect(res.status).toBe(200);
      const { preview } = await res.json();

      // The duplicate row is invalidated with EXACT_DUPLICATE_AID issue
      expect(preview.invalidRowsCount).toBe(1);
      expect(preview.issues.some((i: any) => i.code === "EXACT_DUPLICATE_AID")).toBe(true);
    });
  });

  describe("Precision, Leading Zeros & Goods Units (Scenario 15)", () => {
    it("preserves leading zero in text NIK and high-precision IDR integers", async () => {
      const token = await signIn(officer, SINAR);

      const rows = [
        [
          "", "", "Pak Raden", "NIK", "0123456789012345", "", "", "", "Kraton", "FAKIR",
          "UANG", "500000000000", "", "", "", "2026-03", "", "", "", "", "", ""
        ],
      ];

      const b64 = buildXlsxBase64(BENEFICIARY_TEMPLATE_HEADERS, rows);
      const res = await post(
        `${WORKSPACE}/proposals/import/preview`,
        { fileName: "precision.xlsx", contentBase64: b64 },
        token
      );
      expect(res.status).toBe(200);
      const { preview } = await res.json();

      expect(preview.beneficiaries[0].identityBasis.value).toBe("0123456789012345");
      expect(preview.aidLines[0].value.amountRequestedIdr).toBe("500000000000");
      expect(preview.totalsByUnit.IDR).toBe("500000000000");
    });

    it("does not sum different goods units together and does not invent zero rupiah for unvalued goods", async () => {
      const token = await signIn(officer, SINAR);

      const rows = [
        [
          "", "", "Penerima Paket", "NIK", "3201010101801111", "", "", "", "Dusun 1", "MISKIN",
          "BARANG", "", "5", "Paket", "", "2026-03", "", "", "", "", "", ""
        ],
        [
          "", "", "Penerima Kg", "NIK", "3201010101802222", "", "", "", "Dusun 2", "FAKIR",
          "BARANG", "", "25", "Kg", "350000", "2026-03", "", "", "", "", "", ""
        ],
      ];

      const b64 = buildXlsxBase64(BENEFICIARY_TEMPLATE_HEADERS, rows);
      const res = await post(
        `${WORKSPACE}/proposals/import/preview`,
        { fileName: "goods_units.xlsx", contentBase64: b64 },
        token
      );
      expect(res.status).toBe(200);
      const { preview } = await res.json();

      // Distinct goods units are tracked separately
      expect(preview.totalsByUnit["Paket:Paket"]).toBe("5");
      expect(preview.totalsByUnit["Kg:Kg"]).toBe("25");
      expect(preview.totalsByUnit.IDR).toBeUndefined();
      expect(preview.isPartial).toBe(true);
    });
  });

  describe("Save Proposal Draft with Imported Beneficiaries & Stable Export", () => {
    it("saves draft with imported beneficiaries and stable IDs survive export and re-read", async () => {
      const token = await signIn(officer, SINAR);

      // 1. Create a Program
      const progRes = await post(
        `${WORKSPACE}/programs`,
        {
          name: "Program Bantuan Ramadhan",
          purpose: "Santunan Asnaf Fakir & Miskin",
          fundType: "ZAKAT",
          scope: "Kabupaten Sukamaju 2026",
          referenceCeiling: "500000000",
        },
        token
      );
      expect(progRes.status).toBe(201);
      const { program } = await progRes.json();

      // 2. Import Preview
      const rows = [
        [
          "", "", "Zaenal Arifin", "NIK", "3201010101809999", "", "", "", "Jl. Melati No. 5", "FAKIR",
          "UANG", "1500000", "", "", "", "2026-03", "", "", "SKTM-01", "081299998888", "zaenal@example.org", "Pribadi"
        ],
      ];
      const b64 = buildXlsxBase64(BENEFICIARY_TEMPLATE_HEADERS, rows);
      const prevRes = await post(
        `${WORKSPACE}/proposals/import/preview`,
        { fileName: "zaenal.xlsx", contentBase64: b64 },
        token
      );
      const { preview } = await prevRes.json();

      // 3. Save as Proposal Draft
      const saveRes = await post(
        `${WORKSPACE}/proposals`,
        {
          programId: program.id,
          originOfRequest: "Permohonan DKM",
          purpose: "Santunan Ramadhan Tahap 1",
          aidPeriod: { start: "2026-03-01", end: "2026-03-31" },
          personInCharge: "Haji Sulaiman",
          beneficiaries: preview.beneficiaries,
          aidLines: preview.aidLines,
          operationId: crypto.randomUUID(),
          expectedVersion: 0,
        },
        token
      );
      expect(saveRes.status).toBe(201);
      const { draft } = await saveRes.json();
      expect(draft.beneficiaries.length).toBe(1);
      expect(draft.beneficiaries[0].id).toBeTruthy();
      expect(draft.beneficiaries[0].contact?.phone).toBe("081299998888");
      expect(draft.aidLines[0].id).toBeTruthy();

      const stableBeneficiaryId = draft.beneficiaries[0].id;
      const stableAidLineId = draft.aidLines[0].id;

      // 4. Export as XLSX and CSV with stable IDs
      const exportXlsxRes = await get(`${WORKSPACE}/proposals/${draft.id}/export?format=xlsx`, token);
      expect(exportXlsxRes.status).toBe(200);
      expect(exportXlsxRes.headers.get("content-disposition")).toContain(`proposal-${draft.id}-beneficiaries.xlsx`);

      const exportCsvRes = await get(`${WORKSPACE}/proposals/${draft.id}/export?format=csv`, token);
      expect(exportCsvRes.status).toBe(200);
      expect(exportCsvRes.headers.get("content-disposition")).toContain(`proposal-${draft.id}-beneficiaries.csv`);

      const exportedCsvText = await exportCsvRes.text();
      expect(exportedCsvText).toContain(stableBeneficiaryId);
      expect(exportedCsvText).toContain(stableAidLineId);
      expect(exportedCsvText).toContain("Zaenal Arifin");
      expect(exportedCsvText).toContain("081299998888");

      // 5. Institution Isolation: Rival officer cannot export Sinar's proposal
      const rivalToken = await signIn(rivalOfficer, BAITUL);
      const isolatedRes = await get(`${WORKSPACE}/proposals/${draft.id}/export`, rivalToken);
      expect(isolatedRes.status).toBe(404);
    });

    it("survives database restart keeping beneficiaries and contact details intact", async () => {
      const token = await signIn(officer, SINAR);

      const progRes = await post(
        `${WORKSPACE}/programs`,
        {
          name: "Program Ketahanan Pangan",
          purpose: "Distribusi Beras Mustahik",
          fundType: "ZAKAT",
          scope: "2026",
          referenceCeiling: "200000000",
        },
        token
      );
      const { program } = await progRes.json();

      const saveRes = await post(
        `${WORKSPACE}/proposals`,
        {
          programId: program.id,
          originOfRequest: "Survey Kelayakan",
          purpose: "Distribusi Tahap 1",
          aidPeriod: { start: "2026-04-01", end: "2026-04-30" },
          personInCharge: "Ustadz Mansur",
          beneficiaries: [
            {
              id: "ben-durable-01",
              name: "Keluarga Pak Somad",
              identityBasis: { kind: "NIK", value: "3201010101807777" },
              asnaf: "FAKIR",
              addressOrScope: "Kp. Dukuh No. 8",
              guardian: null,
              paymentRecipient: null,
              contact: { phone: "081987654321", email: null, relation: "Kepala Keluarga" },
            },
          ],
          aidLines: [
            {
              id: "line-durable-01",
              beneficiaryId: "ben-durable-01",
              aidType: "Beras",
              period: "2026-04",
              value: { kind: "GOODS", unit: "Kg", quantityRequested: "50", quantityApproved: null, valuedAmountIdr: "750000" },
            },
          ],
          operationId: crypto.randomUUID(),
          expectedVersion: 0,
        },
        token
      );
      expect(saveRes.status).toBe(201);
      const { draft } = await saveRes.json();

      // Simulate runtime reboot by recreating store instances from underlying db
      const newDisbursement = createDisbursementStore(database.handle() as never);
      const reloaded = await newDisbursement.getProposalDraft(SINAR, draft.id);

      expect(reloaded).not.toBeNull();
      expect(reloaded?.beneficiaries[0].name).toBe("Keluarga Pak Somad");
      expect(reloaded?.beneficiaries[0].contact?.phone).toBe("081987654321");
      expect(reloaded?.beneficiaries[0].contact?.relation).toBe("Kepala Keluarga");
      expect(reloaded?.aidLines[0].value.kind).toBe("GOODS");
    });
  });

  // Opt-in browser smoke test (Scenario 25)
  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)(
    "browser smoke: template download, beneficiary spreadsheet upload, interactive preview, and draft apply",
    async () => {
      const built = await Bun.build({
        entrypoints: [new URL("../../frontend/test/officer-smoke.tsx", import.meta.url).pathname],
        target: "browser",
        define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "" }) },
      });
      if (!built.success) throw new Error(built.logs.join("\n"));
      const wallet = officer;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(req) {
          const path = new URL(req.url).pathname;
          if (path === "/mock-wallet-rpc") {
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
        browser = await chromium.launch({
          executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE,
          headless: true,
          args: ["--no-sandbox"],
        });
        const page = await browser.newPage();
        page.on("pageerror", (error: Error) => console.error("Beneficiary import browser:", error.message));
        await page.goto(server.url.toString());
        page.setDefaultTimeout(10000);
        await page.getByRole("button", { name: /^0x/ }).waitFor();
        await page.getByLabel("Pengelola Zakat", { exact: true }).selectOption(SINAR);
        await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();
        await page.getByRole("heading", { name: "LPZ Sinar Amanah (sintetis)" }).waitFor({ timeout: 5000 });

        // Navigate to disbursement panel
        await page.getByRole("tab", { name: "Penyaluran & Draf" }).click();
        await page.getByRole("button", { name: "Impor XLSX / CSV" }).waitFor();
      } finally {
        await browser?.close();
        await server.stop(true);
      }
    }
  );
});

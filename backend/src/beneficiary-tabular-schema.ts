/**
 * Beneficiary Tabular Schema Mapper (Spec #86, Ticket #92).
 *
 * Maps a decoded TabularTable (from `tabular-reader`) into normalized
 * Beneficiary and AidLine structures for proposal drafts.
 *
 * Rules:
 * 1. Preserves every row including broken ones (US-24, Scenario 5). 7 errors out of 100
 *    remain visible in preview and draf storage.
 * 2. Does not turn missing/invalid rows into zeros.
 * 3. Marks calculated totals as partial when invalid rows or unvalued goods exist.
 * 4. Rejects unsupported columns with explicit Indonesian messages naming the column as written.
 * 5. Preserves text identifiers (NIK 16 digits text with leading zeros) and exact IDR integer strings.
 * 6. Groups rows belonging to the same beneficiary (by id_penerima, NIK, or alternative identity).
 * 7. Blocks exact duplicate aid lines on the same recipient with an error; flags distinct
 *    recurring aid as a review warning, not a lifetime rejection (US-28, Scenario 8).
 * 8. Accommodates optional recipient/representative contacts for confirmation without creating
 *    fictitious identity data (Pilot amendment).
 */

import type { TabularRow, TabularTable } from "./tabular-reader";
import {
  isExactNonNegativeInteger,
  type AidLine,
  type AidValue,
  type Beneficiary,
  type BeneficiaryContact,
  type IdentityBasis,
} from "./disbursement";

export type BeneficiaryTabularIssue = {
  scope: "file" | "row" | "cell";
  rowNumber: number | null;
  column: string | null;
  field?: string;
  message: string;
  code:
    | "UNSUPPORTED_COLUMN"
    | "REQUIRED_FIELD_MISSING"
    | "INVALID_NIK"
    | "INVALID_IDENTITY_BASIS"
    | "INVALID_AMOUNT"
    | "INVALID_QUANTITY"
    | "INVALID_ASNAF"
    | "INVALID_AID_TYPE"
    | "MISSING_UNIT"
    | "EXACT_DUPLICATE_AID"
    | "RECURRING_AID_WARNING"
    | "MISSING_GUARDIAN_RELATION"
    | "MISSING_PAYMENT_RECIPIENT_RELATION";
  isWarning?: boolean;
};

export const BENEFICIARY_COLUMN_ALIASES: Record<string, string> = {
  // Stable line ID
  id_baris: "id_baris",
  id_rincian: "id_baris",
  aid_line_id: "id_baris",
  line_id: "id_baris",

  // Stable beneficiary ID
  id_penerima: "id_penerima",
  id_mustahik: "id_penerima",
  beneficiary_id: "id_penerima",
  mustahik_id: "id_penerima",

  // Recipient Name
  nama: "nama",
  nama_penerima: "nama",
  nama_mustahik: "nama",
  name: "nama",
  penerima: "nama",

  // Identity Basis
  dasar_identitas: "dasar_identitas",
  jenis_identitas: "dasar_identitas",
  identity_basis: "dasar_identitas",
  dasar_id: "dasar_identitas",

  // NIK
  nik: "nik",
  nomor_induk_kependudukan: "nik",
  no_ktp: "nik",
  ktp: "nik",

  // Alternative Identity Description
  keterangan_identitas: "keterangan_identitas",
  keterangan_id: "keterangan_identitas",
  alasan_tanpa_nik: "keterangan_identitas",
  identitas_alternatif: "keterangan_identitas",
  dasar_alternatif: "keterangan_identitas",

  // Guardian / Representative
  nama_perwakilan: "nama_perwakilan",
  nama_wali: "nama_perwakilan",
  wali: "nama_perwakilan",
  perwakilan: "nama_perwakilan",
  guardian_name: "nama_perwakilan",

  hubungan_perwakilan: "hubungan_perwakilan",
  hubungan_wali: "hubungan_perwakilan",
  relasi_perwakilan: "hubungan_perwakilan",
  relasi_wali: "hubungan_perwakilan",
  guardian_relationship: "hubungan_perwakilan",

  // Address / Scope
  alamat_cakupan: "alamat_cakupan",
  alamat: "alamat_cakupan",
  cakupan: "alamat_cakupan",
  wilayah: "alamat_cakupan",
  domisili: "alamat_cakupan",
  address: "alamat_cakupan",

  // Asnaf
  asnaf: "asnaf",
  kategori_asnaf: "asnaf",
  golongan_asnaf: "asnaf",

  // Aid Type
  jenis_bantuan: "jenis_bantuan",
  bantuan: "jenis_bantuan",
  bentuk_bantuan: "jenis_bantuan",
  jenis: "jenis_bantuan",
  aid_type: "jenis_bantuan",

  // IDR Amount
  nilai_idr: "nilai_idr",
  nominal: "nilai_idr",
  jumlah_idr: "nilai_idr",
  rupiah: "nilai_idr",
  nilai: "nilai_idr",
  amount: "nilai_idr",
  jumlah_uang: "nilai_idr",

  // Goods Quantity
  jumlah_barang: "jumlah_barang",
  kuantitas: "jumlah_barang",
  qty: "jumlah_barang",
  volume: "jumlah_barang",
  quantity: "jumlah_barang",

  // Goods Unit
  satuan_barang: "satuan_barang",
  satuan: "satuan_barang",
  unit: "satuan_barang",

  // Goods Rupiah Valuation
  nilai_idr_barang: "nilai_idr_barang",
  taksiran_nilai: "nilai_idr_barang",
  taksiran_rupiah: "nilai_idr_barang",
  valuasi_idr: "nilai_idr_barang",
  nilai_taksiran: "nilai_idr_barang",
  goods_valuation: "nilai_idr_barang",

  // Aid Period
  periode_bantuan: "periode_bantuan",
  periode: "periode_bantuan",
  bulan_bantuan: "periode_bantuan",
  period: "periode_bantuan",

  // Payment Recipient
  nama_penerima_pembayaran: "nama_penerima_pembayaran",
  penerima_pembayaran: "nama_penerima_pembayaran",
  rekening_tujuan: "nama_penerima_pembayaran",
  tujuan_transfer: "nama_penerima_pembayaran",
  pihak_ketiga: "nama_penerima_pembayaran",
  payment_recipient_name: "nama_penerima_pembayaran",

  hubungan_penerima_pembayaran: "hubungan_penerima_pembayaran",
  hubungan_pembayaran: "hubungan_penerima_pembayaran",
  relasi_penerima_pembayaran: "hubungan_penerima_pembayaran",
  relasi_pembayaran: "hubungan_penerima_pembayaran",
  payment_recipient_relation: "hubungan_penerima_pembayaran",

  // Evidence Reference Note
  referensi_bukti: "referensi_bukti",
  referensi_dokumen: "referensi_dokumen",
  nomor_bukti: "referensi_bukti",
  rujukan_bukti: "referensi_bukti",
  nomor_surat: "referensi_bukti",
  reference: "referensi_bukti",

  // Contact (Pilot amendment)
  kontak_telepon: "kontak_telepon",
  telepon: "kontak_telepon",
  no_hp: "kontak_telepon",
  no_telp: "kontak_telepon",
  nohp: "kontak_telepon",
  phone: "kontak_telepon",
  whatsapp: "kontak_telepon",
  wa: "kontak_telepon",

  kontak_email: "kontak_email",
  email: "kontak_email",
  surel: "kontak_email",

  kontak_relasi: "kontak_relasi",
  relasi_kontak: "kontak_relasi",
  hubungan_kontak: "kontak_relasi",
};

export const VALID_ASNAF = new Set([
  "FAKIR",
  "MISKIN",
  "AMIL",
  "MUALAF",
  "MUALLAF",
  "RIQAB",
  "GHARIM",
  "GHARIMIN",
  "FISABILILLAH",
  "IBNU_SABIL",
]);

export type BeneficiaryRowPreview = {
  rowNumber: number;
  isValid: boolean;
  rawCells: Record<string, string>;
  issues: BeneficiaryTabularIssue[];
  beneficiary: Beneficiary | null;
  aidLine: AidLine | null;
  recipientKey: string | null;
};

export type BeneficiaryMappingResult = {
  uniqueBeneficiaryCount: number;
  aidLineCount: number;
  validRowsCount: number;
  invalidRowsCount: number;
  totalsByUnit: Record<string, string>;
  isPartial: boolean;
  beneficiaries: Beneficiary[];
  aidLines: AidLine[];
  allRowsPreview: BeneficiaryRowPreview[];
  issues: BeneficiaryTabularIssue[];
};

const addDecimalIntegers = (a: string, b: string): string =>
  (BigInt(a) + BigInt(b)).toString();

/**
 * Maps a decoded TabularTable into structured Beneficiary and AidLine data.
 */
export function mapBeneficiaryTabular(
  table: TabularTable,
  options?: { defaultAidPeriod?: string; generateId?: () => string }
): BeneficiaryMappingResult {
  const issues: BeneficiaryTabularIssue[] = [];
  const nextId = options?.generateId ?? (() => crypto.randomUUID());
  const defaultPeriod = options?.defaultAidPeriod ?? "Periode Pengajuan";

  // 1. Check headers and detect unsupported columns
  const headerMap: Record<string, { canon: string; raw: string }> = {};
  for (let i = 0; i < table.headers.length; i++) {
    const rawHeader = table.headers[i];
    const normHeader = table.normalizedHeaders[i];
    const canon = BENEFICIARY_COLUMN_ALIASES[normHeader];

    if (!canon) {
      issues.push({
        scope: "file",
        rowNumber: null,
        column: rawHeader,
        code: "UNSUPPORTED_COLUMN",
        message: `Kolom "${rawHeader}" tidak dikenali dalam template daftar penerima. Periksa template terversi resmi.`,
      });
    } else {
      headerMap[canon] = { canon, raw: rawHeader };
    }
  }

  // If there are unsupported columns at the file scope, return early
  if (issues.some((i) => i.code === "UNSUPPORTED_COLUMN")) {
    return {
      uniqueBeneficiaryCount: 0,
      aidLineCount: 0,
      validRowsCount: 0,
      invalidRowsCount: table.rows.length,
      totalsByUnit: {},
      isPartial: true,
      beneficiaries: [],
      aidLines: [],
      allRowsPreview: [],
      issues,
    };
  }

  const allRowsPreview: BeneficiaryRowPreview[] = [];
  const parsedValidLines: Array<{
    rowNumber: number;
    beneficiary: Beneficiary;
    aidLine: AidLine;
    recipientKey: string;
  }> = [];

  // Helper to read mapped cell by canonical name
  const cellOf = (row: TabularRow, canon: string): string => {
    // Find matching header normalized
    for (let i = 0; i < table.normalizedHeaders.length; i++) {
      const norm = table.normalizedHeaders[i];
      if (BENEFICIARY_COLUMN_ALIASES[norm] === canon) {
        return row.cells[norm] ?? "";
      }
    }
    return "";
  };

  const rawHeaderOf = (canon: string): string =>
    headerMap[canon]?.raw ?? canon;

  // 2. Validate every row
  for (const row of table.rows) {
    const rowNumber = row.rowNumber;
    const rowIssues: BeneficiaryTabularIssue[] = [];

    const rawIdBaris = cellOf(row, "id_baris").trim();
    const rawIdPenerima = cellOf(row, "id_penerima").trim();
    const nama = cellOf(row, "nama").trim();
    const dasarIdentitasRaw = cellOf(row, "dasar_identitas").trim().toUpperCase();
    const nik = cellOf(row, "nik").trim();
    const keteranganIdentitas = cellOf(row, "keterangan_identitas").trim();
    const namaPerwakilan = cellOf(row, "nama_perwakilan").trim();
    const hubunganPerwakilan = cellOf(row, "hubungan_perwakilan").trim();
    const alamatCakupan = cellOf(row, "alamat_cakupan").trim();
    const asnafRaw = cellOf(row, "asnaf").trim().toUpperCase();
    const jenisBantuanRaw = cellOf(row, "jenis_bantuan").trim().toUpperCase();
    const nilaiIdr = cellOf(row, "nilai_idr").trim();
    const jumlahBarang = cellOf(row, "jumlah_barang").trim();
    const satuanBarang = cellOf(row, "satuan_barang").trim();
    const nilaiIdrBarang = cellOf(row, "nilai_idr_barang").trim();
    const periodeBantuan = cellOf(row, "periode_bantuan").trim() || defaultPeriod;
    const namaPenerimaPembayaran = cellOf(row, "nama_penerima_pembayaran").trim();
    const hubunganPenerimaPembayaran = cellOf(row, "hubungan_penerima_pembayaran").trim();
    const kontakTelepon = cellOf(row, "kontak_telepon").trim();
    const kontakEmail = cellOf(row, "kontak_email").trim();
    const kontakRelasi = cellOf(row, "kontak_relasi").trim();

    // Required: nama
    if (!nama) {
      rowIssues.push({
        scope: "row",
        rowNumber,
        column: rawHeaderOf("nama"),
        field: "nama",
        code: "REQUIRED_FIELD_MISSING",
        message: `Nama penerima tidak boleh kosong pada baris ${rowNumber} kolom "${rawHeaderOf("nama")}".`,
      });
    }

    // Required: alamat_cakupan
    if (!alamatCakupan) {
      rowIssues.push({
        scope: "row",
        rowNumber,
        column: rawHeaderOf("alamat_cakupan"),
        field: "alamat_cakupan",
        code: "REQUIRED_FIELD_MISSING",
        message: `Alamat/cakupan penerima tidak boleh kosong pada baris ${rowNumber} kolom "${rawHeaderOf("alamat_cakupan")}".`,
      });
    }

    // Required: asnaf
    let normalizedAsnaf = asnafRaw;
    if (normalizedAsnaf === "MUALLAF") normalizedAsnaf = "MUALAF";
    if (normalizedAsnaf === "GHARIMIN") normalizedAsnaf = "GHARIM";

    if (!normalizedAsnaf || !VALID_ASNAF.has(normalizedAsnaf)) {
      rowIssues.push({
        scope: "row",
        rowNumber,
        column: rawHeaderOf("asnaf"),
        field: "asnaf",
        code: "INVALID_ASNAF",
        message: `Kategori asnaf "${asnafRaw || "(kosong)"}" tidak sah pada baris ${rowNumber} kolom "${rawHeaderOf("asnaf")}". Pilih salah satu: Fakir, Miskin, Amil, Mualaf, Riqab, Gharim, Fisabilillah, Ibnu Sabil.`,
      });
    }

    // Identity Basis
    let identityBasis: IdentityBasis | null = null;
    const isNikKind =
      dasarIdentitasRaw === "NIK" || (!dasarIdentitasRaw && nik.length > 0);
    const isAltKind =
      dasarIdentitasRaw === "ALTERNATIF" ||
      (!dasarIdentitasRaw && keteranganIdentitas.length > 0);

    if (isNikKind) {
      if (!/^\d{16}$/.test(nik)) {
        rowIssues.push({
          scope: "row",
          rowNumber,
          column: rawHeaderOf("nik"),
          field: "nik",
          code: "INVALID_NIK",
          message: `NIK harus 16 digit angka teks pada baris ${rowNumber} kolom "${rawHeaderOf("nik")}". Angka nol di depan harus dipertahankan.`,
        });
      } else {
        identityBasis = { kind: "NIK", value: nik };
      }
    } else if (isAltKind) {
      if (!keteranganIdentitas) {
        rowIssues.push({
          scope: "row",
          rowNumber,
          column: rawHeaderOf("keterangan_identitas"),
          field: "keterangan_identitas",
          code: "INVALID_IDENTITY_BASIS",
          message: `Dasar identitas alternatif harus dijelaskan (mis. anak tanpa KTP); tidak boleh mengarang NIK pada baris ${rowNumber} kolom "${rawHeaderOf("keterangan_identitas")}".`,
        });
      } else {
        identityBasis = { kind: "ALTERNATIVE", description: keteranganIdentitas };
      }
    } else {
      rowIssues.push({
        scope: "row",
        rowNumber,
        column: rawHeaderOf("dasar_identitas"),
        field: "dasar_identitas",
        code: "INVALID_IDENTITY_BASIS",
        message: `Dasar identitas harus 'NIK' atau 'ALTERNATIF' pada baris ${rowNumber} kolom "${rawHeaderOf("dasar_identitas")}".`,
      });
    }

    // Guardian
    let guardian: { name: string; relationship: string } | null = null;
    if (namaPerwakilan || hubunganPerwakilan) {
      if (!namaPerwakilan) {
        rowIssues.push({
          scope: "row",
          rowNumber,
          column: rawHeaderOf("nama_perwakilan"),
          field: "nama_perwakilan",
          code: "MISSING_GUARDIAN_RELATION",
          message: `Nama perwakilan/wali harus diisi bila hubungan perwakilan diisi pada baris ${rowNumber} kolom "${rawHeaderOf("nama_perwakilan")}".`,
        });
      } else if (!hubunganPerwakilan) {
        rowIssues.push({
          scope: "row",
          rowNumber,
          column: rawHeaderOf("hubungan_perwakilan"),
          field: "hubungan_perwakilan",
          code: "MISSING_GUARDIAN_RELATION",
          message: `Hubungan perwakilan/wali harus diisi bila nama perwakilan diisi pada baris ${rowNumber} kolom "${rawHeaderOf("hubungan_perwakilan")}".`,
        });
      } else {
        guardian = { name: namaPerwakilan, relationship: hubunganPerwakilan };
      }
    }

    // Payment Recipient
    let paymentRecipient: { name: string; relation: string } | null = null;
    if (namaPenerimaPembayaran || hubunganPenerimaPembayaran) {
      if (!namaPenerimaPembayaran) {
        rowIssues.push({
          scope: "row",
          rowNumber,
          column: rawHeaderOf("nama_penerima_pembayaran"),
          field: "nama_penerima_pembayaran",
          code: "MISSING_PAYMENT_RECIPIENT_RELATION",
          message: `Nama penerima pembayaran harus diisi pada baris ${rowNumber} kolom "${rawHeaderOf("nama_penerima_pembayaran")}".`,
        });
      } else if (!hubunganPenerimaPembayaran) {
        rowIssues.push({
          scope: "row",
          rowNumber,
          column: rawHeaderOf("hubungan_penerima_pembayaran"),
          field: "hubungan_penerima_pembayaran",
          code: "MISSING_PAYMENT_RECIPIENT_RELATION",
          message: `Hubungan penerima pembayaran harus diisi pada baris ${rowNumber} kolom "${rawHeaderOf("hubungan_penerima_pembayaran")}".`,
        });
      } else {
        paymentRecipient = {
          name: namaPenerimaPembayaran,
          relation: hubunganPenerimaPembayaran,
        };
      }
    }

    // Contact (Pilot amendment - optional)
    let contact: BeneficiaryContact | null = null;
    if (kontakTelepon || kontakEmail || kontakRelasi) {
      contact = {
        phone: kontakTelepon || null,
        email: kontakEmail || null,
        relation: kontakRelasi || null,
      };
    }

    // Aid Value
    let aidValue: AidValue | null = null;
    const isMoney =
      jenisBantuanRaw === "UANG" || (!jenisBantuanRaw && nilaiIdr.length > 0);
    const isGoods =
      jenisBantuanRaw === "BARANG" ||
      (!jenisBantuanRaw && (jumlahBarang.length > 0 || satuanBarang.length > 0));

    if (isMoney) {
      if (!nilaiIdr || !isExactNonNegativeInteger(nilaiIdr)) {
        rowIssues.push({
          scope: "row",
          rowNumber,
          column: rawHeaderOf("nilai_idr"),
          field: "nilai_idr",
          code: "INVALID_AMOUNT",
          message: `Jumlah IDR harus bilangan bulat rupiah tanpa desimal pada baris ${rowNumber} kolom "${rawHeaderOf("nilai_idr")}".`,
        });
      } else {
        aidValue = {
          kind: "MONEY",
          amountRequestedIdr: nilaiIdr,
          amountApprovedIdr: null,
        };
      }
    } else if (isGoods) {
      if (!satuanBarang) {
        rowIssues.push({
          scope: "row",
          rowNumber,
          column: rawHeaderOf("satuan_barang"),
          field: "satuan_barang",
          code: "MISSING_UNIT",
          message: `Satuan barang harus dinyatakan pada baris ${rowNumber} kolom "${rawHeaderOf("satuan_barang")}".`,
        });
      }
      if (!jumlahBarang || !/^\d+(\.\d+)?$/.test(jumlahBarang)) {
        rowIssues.push({
          scope: "row",
          rowNumber,
          column: rawHeaderOf("jumlah_barang"),
          field: "jumlah_barang",
          code: "INVALID_QUANTITY",
          message: `Jumlah barang harus angka eksak pada baris ${rowNumber} kolom "${rawHeaderOf("jumlah_barang")}".`,
        });
      }
      let valuedAmountIdr: string | null = null;
      if (nilaiIdrBarang) {
        if (!isExactNonNegativeInteger(nilaiIdrBarang)) {
          rowIssues.push({
            scope: "row",
            rowNumber,
            column: rawHeaderOf("nilai_idr_barang"),
            field: "nilai_idr_barang",
            code: "INVALID_AMOUNT",
            message: `Nilai taksiran IDR barang harus bilangan bulat rupiah pada baris ${rowNumber} kolom "${rawHeaderOf("nilai_idr_barang")}".`,
          });
        } else {
          valuedAmountIdr = nilaiIdrBarang;
        }
      }

      if (satuanBarang && jumlahBarang && /^\d+(\.\d+)?$/.test(jumlahBarang) && (nilaiIdrBarang === "" || isExactNonNegativeInteger(nilaiIdrBarang))) {
        aidValue = {
          kind: "GOODS",
          unit: satuanBarang,
          quantityRequested: jumlahBarang,
          quantityApproved: null,
          valuedAmountIdr,
        };
      }
    } else {
      rowIssues.push({
        scope: "row",
        rowNumber,
        column: rawHeaderOf("jenis_bantuan"),
        field: "jenis_bantuan",
        code: "INVALID_AID_TYPE",
        message: `Jenis bantuan harus 'UANG' atau 'BARANG' pada baris ${rowNumber} kolom "${rawHeaderOf("jenis_bantuan")}".`,
      });
    }

    // Determine recipient grouping key
    let recipientKey: string | null = null;
    if (rawIdPenerima) {
      recipientKey = `id:${rawIdPenerima}`;
    } else if (identityBasis?.kind === "NIK") {
      recipientKey = `nik:${identityBasis.value}`;
    } else if (nama) {
      recipientKey = `alt:${nama.toLowerCase()}:${(identityBasis?.kind === "ALTERNATIVE" ? identityBasis.description : "").toLowerCase()}`;
    }

    const isValid = rowIssues.length === 0 && identityBasis !== null && aidValue !== null;

    let beneficiary: Beneficiary | null = null;
    let aidLine: AidLine | null = null;

    if (isValid && recipientKey) {
      beneficiary = {
        id: rawIdPenerima || nextId(),
        name: nama,
        identityBasis: identityBasis!,
        asnaf: normalizedAsnaf,
        addressOrScope: alamatCakupan,
        guardian,
        paymentRecipient,
        contact,
      };

      aidLine = {
        id: rawIdBaris || nextId(),
        beneficiaryId: beneficiary.id,
        aidType: isMoney ? "UANG" : satuanBarang,
        period: periodeBantuan,
        value: aidValue!,
      };

      parsedValidLines.push({
        rowNumber,
        beneficiary,
        aidLine,
        recipientKey,
      });
    }

    allRowsPreview.push({
      rowNumber,
      isValid,
      rawCells: row.cells,
      issues: rowIssues,
      beneficiary,
      aidLine,
      recipientKey,
    });

    issues.push(...rowIssues);
  }

  // 3. Group valid lines by recipient and check for duplicate aid lines
  const beneficiaryMap = new Map<string, Beneficiary>();
  const recipientAidLines = new Map<string, AidLine[]>();
  const finalBeneficiaries: Beneficiary[] = [];
  const finalAidLines: AidLine[] = [];

  for (const item of parsedValidLines) {
    let b = beneficiaryMap.get(item.recipientKey);
    if (!b) {
      b = item.beneficiary;
      beneficiaryMap.set(item.recipientKey, b);
      recipientAidLines.set(item.recipientKey, []);
      finalBeneficiaries.push(b);
    }

    // Ensure aidLine points to the canonical beneficiary id
    const line: AidLine = {
      ...item.aidLine,
      beneficiaryId: b.id,
    };

    // Check for exact duplicate aid lines on the same recipient (Scenario 8)
    const existingLines = recipientAidLines.get(item.recipientKey)!;
    const fingerprint = JSON.stringify([line.aidType, line.period, line.value]);
    const isExactDuplicate = existingLines.some(
      (l) => JSON.stringify([l.aidType, l.period, l.value]) === fingerprint
    );

    if (isExactDuplicate) {
      const dupIssue: BeneficiaryTabularIssue = {
        scope: "row",
        rowNumber: item.rowNumber,
        column: null,
        code: "EXACT_DUPLICATE_AID",
        message: `Baris ${item.rowNumber} duplikat persis rincian bantuan lain untuk penerima "${b.name}" pada pengajuan ini. Duplikasi persis diblokir.`,
      };
      issues.push(dupIssue);

      // Invalidate the preview row
      const preview = allRowsPreview.find((p) => p.rowNumber === item.rowNumber);
      if (preview) {
        preview.isValid = false;
        preview.issues.push(dupIssue);
      }
    } else {
      // Check if recurring aid (different aidType or period for the same person)
      if (existingLines.length > 0) {
        const recWarning: BeneficiaryTabularIssue = {
          scope: "row",
          rowNumber: item.rowNumber,
          column: null,
          code: "RECURRING_AID_WARNING",
          isWarning: true,
          message: `Penerima "${b.name}" menerima beberapa rincian bantuan pada pengajuan ini. Ditandai untuk penelaahan kelayakan.`,
        };
        issues.push(recWarning);
        const preview = allRowsPreview.find((p) => p.rowNumber === item.rowNumber);
        if (preview) {
          preview.issues.push(recWarning);
        }
      }

      existingLines.push(line);
      finalAidLines.push(line);
    }
  }

  // 4. Calculate unit totals and partial status
  const totalsByUnit: Record<string, string> = {};
  let isPartial = false;

  // If any row is invalid, the overall imported total is partial
  const hasInvalidRows = allRowsPreview.some((r) => !r.isValid);
  if (hasInvalidRows) {
    isPartial = true;
  }

  for (const line of finalAidLines) {
    if (line.value.kind === "MONEY") {
      if (isExactNonNegativeInteger(line.value.amountRequestedIdr)) {
        totalsByUnit.IDR = addDecimalIntegers(
          totalsByUnit.IDR ?? "0",
          line.value.amountRequestedIdr
        );
      }
    } else {
      const key = `${line.aidType}:${line.value.unit}`;
      if (isExactNonNegativeInteger(line.value.quantityRequested)) {
        totalsByUnit[key] = addDecimalIntegers(
          totalsByUnit[key] ?? "0",
          line.value.quantityRequested
        );
      } else {
        // Fractional quantity or non-integer
        isPartial = true;
        const current = Number(totalsByUnit[key] ?? 0) + Number(line.value.quantityRequested);
        totalsByUnit[key] = current.toString();
      }
      if (line.value.valuedAmountIdr === null) {
        isPartial = true;
      }
    }
  }

  const validRowsCount = allRowsPreview.filter((r) => r.isValid).length;
  const invalidRowsCount = allRowsPreview.filter((r) => !r.isValid).length;

  return {
    uniqueBeneficiaryCount: finalBeneficiaries.length,
    aidLineCount: finalAidLines.length,
    validRowsCount,
    invalidRowsCount,
    totalsByUnit,
    isPartial,
    beneficiaries: finalBeneficiaries,
    aidLines: finalAidLines,
    allRowsPreview,
    issues,
  };
}

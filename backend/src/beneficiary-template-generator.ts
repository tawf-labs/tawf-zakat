/**
 * Beneficiary Template Generator (Spec #86, Ticket #92).
 *
 * Generates versioned templates for proposal beneficiaries in XLSX (primary)
 * and CSV UTF-8 (alternative). Includes comprehensive Indonesian instructions,
 * security rules, and synthetic demonstration data.
 *
 * Also exports an existing proposal roster in the same layout, carrying stable
 * beneficiary and aid line IDs so a re-upload maps back onto the same records.
 */

import * as XLSX from "xlsx";
import { sanitizeForExport, type TabularFormat } from "./tabular-reader";
import { BENEFICIARY_COLUMNS, type BeneficiaryCells } from "./beneficiary-tabular-schema";
import type { AidLine, Beneficiary } from "./disbursement";

export const BENEFICIARY_TEMPLATE_VERSION = "tawf.beneficiary.template.v1";

/** The name both the download header and the browser's save dialog use. */
export const beneficiaryTemplateFileName = (format: TabularFormat): string =>
  `${BENEFICIARY_TEMPLATE_VERSION}.${format}`;

export const beneficiaryExportFileName = (proposalId: string, format: TabularFormat): string =>
  `proposal-${proposalId}-beneficiaries.${format}`;

export const BENEFICIARY_TEMPLATE_HEADERS = BENEFICIARY_COLUMNS;

type SheetRow = Partial<BeneficiaryCells>;

export const SYNTHETIC_SAMPLE_BENEFICIARIES: SheetRow[] = [
  {
    nama: "Ahmad Dahlan",
    dasar_identitas: "NIK",
    nik: "3201010101800001",
    alamat_cakupan: "Jl. Merdeka No. 10, RT 01/RW 02, Sukajaya",
    asnaf: "FAKIR",
    jenis_bantuan: "UANG",
    nama_bantuan: "Bantuan tunai kebutuhan pokok",
    nilai_idr: "1500000",
    periode_bantuan: "2026-03",
    referensi_bukti: "SKTM-2026-001",
    kontak_telepon: "081234567890",
    kontak_email: "ahmad.d@example.org",
    kontak_relasi: "Penerima Langsung",
  },
  {
    nama: "Siti Aminah",
    dasar_identitas: "NIK",
    nik: "3201010202850002",
    alamat_cakupan: "Desa Karanganyar, Dusun 3",
    asnaf: "MISKIN",
    jenis_bantuan: "BARANG",
    nama_bantuan: "Paket sembako",
    jumlah_barang: "2",
    satuan_barang: "Paket",
    periode_bantuan: "2026-03",
    referensi_bukti: "BAST-BRG-2026-01",
    kontak_telepon: "081398765432",
    kontak_relasi: "Pribadi",
  },
  {
    nama: "Muhammad Farhan",
    dasar_identitas: "ALTERNATIF",
    keterangan_identitas: "Anak usia 9 tahun belum memiliki KTP/KIA",
    nama_perwakilan: "Hasan Basri",
    hubungan_perwakilan: "Paman/Wali",
    alamat_cakupan: "Kampung Melati RT 04/RW 01",
    asnaf: "IBNU_SABIL",
    jenis_bantuan: "UANG",
    nama_bantuan: "Bantuan SPP",
    nilai_idr: "750000",
    periode_bantuan: "2026-03",
    nama_penerima_pembayaran: "Madrasah Ibtidaiyah Al-Hidayah",
    hubungan_penerima_pembayaran: "Sekolah Penerima Bantuan SPP",
    referensi_bukti: "SURAT-WALI-009",
    kontak_telepon: "081512344321",
    kontak_email: "hasan.wali@example.org",
    kontak_relasi: "Wali",
  },
  {
    nama: "Rahmat Hidayat",
    dasar_identitas: "NIK",
    nik: "3201010303900003",
    alamat_cakupan: "Kompleks Pondok Pesantren Baitul Ulum",
    asnaf: "FISABILILLAH",
    jenis_bantuan: "BARANG",
    nama_bantuan: "Beras",
    jumlah_barang: "50",
    satuan_barang: "Kg",
    nilai_idr_barang: "750000",
    dasar_valuasi_barang: "Estimasi 50 kg × Rp15.000; penawaran pemasok NOTA-BERAS-44",
    periode_bantuan: "2026-03",
    referensi_bukti: "NOTA-BERAS-44",
    kontak_telepon: "081700112233",
    kontak_relasi: "Pribadi",
  },
];

export const BENEFICIARY_INSTRUCTION_ROWS = [
  ["PETUNJUK PENGISIAN TEMPLATE DAFTAR PENERIMA PENGAJUAN ZKT"],
  ["Versi Template", BENEFICIARY_TEMPLATE_VERSION],
  [""],
  ["KOLOM", "STATUS", "ATURAN PENGISIAN"],
  ["id_baris", "Opsional", "ID stabil rincian bantuan. Dikosongkan saat pembuatan awal, terisi otomatis saat mengekspor draf untuk diunggah ulang. Tidak boleh dipakai dua baris."],
  ["id_penerima", "Opsional", "ID stabil penerima. Baris dengan id_penerima yang sama dikelompokkan ke satu penerima dengan beberapa rincian bantuan; data penerimanya harus sama pada setiap baris."],
  ["nama", "Wajib", "Nama lengkap penerima manfaat (mustahik)."],
  ["dasar_identitas", "Wajib", "Pilihan: 'NIK' atau 'ALTERNATIF'."],
  ["nik", "Kondisional", "Wajib jika dasar_identitas 'NIK'. Berupa 16 digit angka teks (misal: 3201010101800001). Angka nol di depan dipertahankan."],
  ["keterangan_identitas", "Kondisional", "Wajib jika dasar_identitas 'ALTERNATIF'. Jelaskan alasan tanpa KTP (mis. anak belum cukup umur, surat keterangan RT/Desa). Dilarang mengarang NIK fiktif."],
  ["nama_perwakilan", "Opsional", "Nama wali atau pihak yang mewakili penerima jika bantuan diwakilkan."],
  ["hubungan_perwakilan", "Kondisional", "Hubungan perwakilan (mis. Orang Tua, Paman, Wali Asuh). Wajib diisi jika nama_perwakilan diisi."],
  ["alamat_cakupan", "Wajib", "Alamat domisili atau cakupan wilayah penerima."],
  ["asnaf", "Wajib", "Kategori asnaf syariah: FAKIR, MISKIN, AMIL, MUALAF, RIQAB, GHARIM, FISABILILLAH, atau IBNU_SABIL."],
  ["jenis_bantuan", "Wajib", "Pilihan bentuk bantuan: 'UANG' atau 'BARANG'."],
  ["nama_bantuan", "Disarankan", "Nama bantuan atau barang (mis. Bantuan SPP, Beras, Paket sembako). Membedakan beberapa rincian barang untuk penerima yang sama."],
  ["nilai_idr", "Kondisional", "Wajib jika jenis_bantuan 'UANG'. Nominal rupiah dalam bilangan bulat positif tanpa desimal atau koma (misal: 1500000)."],
  ["jumlah_barang", "Kondisional", "Wajib jika jenis_bantuan 'BARANG'. Kuantitas barang berupa angka desimal eksak (misal: 2 atau 2.5)."],
  ["satuan_barang", "Kondisional", "Wajib jika jenis_bantuan 'BARANG'. Satuan barang yang jelas (misal: Paket, Kg, Kotak, Unit)."],
  ["dasar_valuasi_barang", "Kondisional", "Wajib jika nilai_idr_barang diisi: sebutkan sumber/rujukan dan perhitungan estimasi pengajuan. Biaya aktual dicatat terpisah."],
  ["nilai_idr_barang", "Opsional", "Taksiran nilai rupiah bantuan barang bila dasar penilaian tersedia. Jika belum diketahui, kosongkan (tidak diubah menjadi nol rupiah)."],
  ["periode_bantuan", "Opsional", "Periode bantuan spesifik (misal: 2026-03 atau 2026-Q1). Jika kosong, mengikuti periode bantuan yang diisi pada form pengajuan."],
  ["nama_penerima_pembayaran", "Opsional", "Nama pihak yang menerima transfer bila disalurkan ke penyedia/sekolah (misal: Madrasah Ibtidaiyah Al-Hidayah)."],
  ["hubungan_penerima_pembayaran", "Kondisional", "Hubungan pihak penerima pembayaran dengan bantuan (mis. Penyedia Pendidikan). Wajib diisi jika nama_penerima_pembayaran diisi."],
  ["referensi_bukti", "Opsional", "Catatan referensi dokumen atau surat permohonan. Nama dokumen pada spreadsheet bukan bukti bahwa dokumen telah tersedia di sistem."],
  ["kontak_telepon", "Opsional", "Nomor telepon penerima/perwakilan untuk konfirmasi penyaluran (data terbatas). Kosong tidak membuat data fiktif."],
  ["kontak_email", "Opsional", "Alamat email penerima/perwakilan untuk konfirmasi."],
  ["kontak_relasi", "Opsional", "Relasi kontak (mis. Penerima Langsung, Wali, Orang Tua)."],
  [""],
  ["KETENTUAN PENTING KEAMANAN DAN INTEGRITAS:"],
  ["1. Jangan menggunakan formula spreadsheet (tanda '='). Formula tidak akan dieksekusi."],
  ["2. Jangan menyimpan berkas dengan makro (.xlsm). Berkas makro ditolak otomatis."],
  ["3. Jangan mengunci atau mengenkripsi berkas dengan kata sandi."],
  ["4. Seluruh baris termasuk yang salah akan ditampilkan pada pratinjau dan tidak akan diabaikan diam-diam."],
  ["5. Satu penerima dengan beberapa rincian bantuan diperbolehkan; rincian bantuan persis sama pada satu penerima diblokir."],
];

const toCells = (row: SheetRow): string[] => BENEFICIARY_COLUMNS.map((column) => row[column] ?? "");

function beneficiaryCellsOf(b: Beneficiary): SheetRow {
  return {
    id_penerima: b.id,
    nama: b.name,
    dasar_identitas: b.identityBasis.kind === "NIK" ? "NIK" : "ALTERNATIF",
    nik: b.identityBasis.kind === "NIK" ? b.identityBasis.value : "",
    keterangan_identitas: b.identityBasis.kind === "ALTERNATIVE" ? b.identityBasis.description : "",
    nama_perwakilan: b.guardian?.name,
    hubungan_perwakilan: b.guardian?.relationship,
    alamat_cakupan: b.addressOrScope,
    asnaf: b.asnaf,
    nama_penerima_pembayaran: b.paymentRecipient?.name,
    hubungan_penerima_pembayaran: b.paymentRecipient?.relation,
    kontak_telepon: b.contact?.phone ?? "",
    kontak_email: b.contact?.email ?? "",
    kontak_relasi: b.contact?.relation ?? "",
  };
}

function aidLineCellsOf(line: AidLine): SheetRow {
  const value = line.value;
  return {
    id_baris: line.id,
    jenis_bantuan: value.kind === "MONEY" ? "UANG" : "BARANG",
    nama_bantuan: line.aidType,
    nilai_idr: value.kind === "MONEY" ? value.amountRequestedIdr : "",
    jumlah_barang: value.kind === "GOODS" ? value.quantityRequested : "",
    satuan_barang: value.kind === "GOODS" ? value.unit : "",
    nilai_idr_barang: value.kind === "GOODS" ? (value.valuedAmountIdr ?? "") : "",
    dasar_valuasi_barang: value.kind === "GOODS" ? (value.valuationBasis ?? "") : "",
    periode_bantuan: line.period,
    referensi_bukti: line.evidenceReference ?? "",
  };
}

/** One row per aid line; a beneficiary without aid lines still gets an (incomplete) row. */
function rosterRows(beneficiaries: Beneficiary[], aidLines: AidLine[]): SheetRow[] {
  const byId = new Map(beneficiaries.map((b) => [b.id, b]));
  const withLines = new Set(aidLines.map((line) => line.beneficiaryId));
  return [
    ...aidLines.flatMap((line) => {
      const b = byId.get(line.beneficiaryId);
      return b ? [{ ...beneficiaryCellsOf(b), ...aidLineCellsOf(line) }] : [];
    }),
    ...beneficiaries.filter((b) => !withLines.has(b.id)).map(beneficiaryCellsOf),
  ];
}

function toCsv(rows: SheetRow[]): string {
  return [Array.from(BENEFICIARY_COLUMNS), ...rows.map(toCells)]
    .map((cells) =>
      cells
        .map((cell) => {
          const safe = sanitizeForExport(cell);
          return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
        })
        .join(",")
    )
    .join("\n");
}

function toWorkbook(rows: SheetRow[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(BENEFICIARY_INSTRUCTION_ROWS), "Petunjuk");
  const data = XLSX.utils.aoa_to_sheet([Array.from(BENEFICIARY_COLUMNS), ...rows.map(toCells)]);
  XLSX.utils.book_append_sheet(wb, data, "Daftar_Penerima");
  return new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

export type BeneficiarySheet = { format: "csv"; body: string } | { format: "xlsx"; body: Uint8Array };

const sheetOf = (rows: SheetRow[], format: TabularFormat): BeneficiarySheet =>
  format === "csv" ? { format, body: toCsv(rows) } : { format, body: toWorkbook(rows) };

export const generateBeneficiaryTemplate = (format: TabularFormat): BeneficiarySheet =>
  sheetOf(SYNTHETIC_SAMPLE_BENEFICIARIES, format);

export const generateBeneficiaryExport = (
  beneficiaries: Beneficiary[],
  aidLines: AidLine[],
  format: TabularFormat
): BeneficiarySheet => sheetOf(rosterRows(beneficiaries, aidLines), format);

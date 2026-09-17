/**
 * Beneficiary Template Generator (Spec #86, Ticket #92).
 *
 * Generates versioned templates for proposal beneficiaries in XLSX (primary)
 * and CSV UTF-8 (alternative). Includes comprehensive Indonesian instructions,
 * security rules, and synthetic demonstration data.
 *
 * Also provides export functionality for existing proposal rosters to preserve
 * stable beneficiary and aid line IDs across re-upload cycles.
 */

import * as XLSX from "xlsx";
import { sanitizeForExport } from "./tabular-reader";
import type { AidLine, Beneficiary } from "./disbursement";

export const BENEFICIARY_TEMPLATE_VERSION = "tawf.beneficiary.template.v1";

/** The name both the download header and the browser's save dialog use. */
export const beneficiaryTemplateFileName = (format: "xlsx" | "csv"): string =>
  `${BENEFICIARY_TEMPLATE_VERSION}.${format}`;

export const BENEFICIARY_TEMPLATE_HEADERS = [
  "id_baris",
  "id_penerima",
  "nama",
  "dasar_identitas",
  "nik",
  "keterangan_identitas",
  "nama_perwakilan",
  "hubungan_perwakilan",
  "alamat_cakupan",
  "asnaf",
  "jenis_bantuan",
  "nilai_idr",
  "jumlah_barang",
  "satuan_barang",
  "nilai_idr_barang",
  "periode_bantuan",
  "nama_penerima_pembayaran",
  "hubungan_penerima_pembayaran",
  "referensi_bukti",
  "kontak_telepon",
  "kontak_email",
  "kontak_relasi",
] as const;

export const SYNTHETIC_SAMPLE_BENEFICIARIES = [
  [
    "",
    "",
    "Ahmad Dahlan",
    "NIK",
    "3201010101800001",
    "",
    "",
    "",
    "Jl. Merdeka No. 10, RT 01/RW 02, Sukajaya",
    "FAKIR",
    "UANG",
    "1500000",
    "",
    "",
    "",
    "2026-03",
    "",
    "",
    "SKTM-2026-001",
    "081234567890",
    "ahmad.d@example.org",
    "Penerima Langsung",
  ],
  [
    "",
    "",
    "Siti Aminah",
    "NIK",
    "3201010202850002",
    "",
    "",
    "",
    "Desa Karanganyar, Dusun 3",
    "MISKIN",
    "BARANG",
    "",
    "2",
    "Paket",
    "",
    "2026-03",
    "",
    "",
    "BAST-BRG-2026-01",
    "081398765432",
    "",
    "Pribadi",
  ],
  [
    "",
    "",
    "Muhammad Farhan",
    "ALTERNATIF",
    "",
    "Anak usia 9 tahun belum memiliki KTP/KIA",
    "Hasan Basri",
    "Paman/Wali",
    "Kampung Melati RT 04/RW 01",
    "IBNU_SABIL",
    "UANG",
    "750000",
    "",
    "",
    "",
    "2026-03",
    "Madrasah Ibtidaiyah Al-Hidayah",
    "Sekolah Penerima Bantuan SPP",
    "SURAT-WALI-009",
    "081512344321",
    "hasan.wali@example.org",
    "Wali",
  ],
  [
    "",
    "",
    "Rahmat Hidayat",
    "NIK",
    "3201010303900003",
    "",
    "",
    "",
    "Kompleks Pondok Pesantren Baitul Ulum",
    "FISABILILLAH",
    "BARANG",
    "",
    "50",
    "Kg",
    "750000",
    "2026-03",
    "",
    "",
    "NOTA-BERAS-44",
    "081700112233",
    "",
    "Pribadi",
  ],
];

export const BENEFICIARY_INSTRUCTION_ROWS = [
  ["PETUNJUK PENGISIAN TEMPLATE DAFTAR PENERIMA PENGAJUAN ZKT"],
  ["Versi Template", BENEFICIARY_TEMPLATE_VERSION],
  [""],
  ["KOLOM", "STATUS", "ATURAN PENGISIAN"],
  [
    "id_baris",
    "Opsional",
    "ID stabil rincian bantuan. Dikosongkan saat pembuatan awal, terisi otomatis saat mengekspor draf untuk diunggah ulang.",
  ],
  [
    "id_penerima",
    "Opsional",
    "ID stabil penerima. Baris dengan id_penerima yang sama akan dikelompokkan ke satu penerima manfaat dengan beberapa rincian bantuan.",
  ],
  [
    "nama",
    "Wajib",
    "Nama lengkap penerima manfaat (mustahik).",
  ],
  [
    "dasar_identitas",
    "Wajib",
    "Pilihan: 'NIK' atau 'ALTERNATIF'.",
  ],
  [
    "nik",
    "Kondisional",
    "Wajib jika dasar_identitas 'NIK'. Berupa 16 digit angka teks (misal: 3201010101800001). Angka nol di depan dipertahankan.",
  ],
  [
    "keterangan_identitas",
    "Kondisional",
    "Wajib jika dasar_identitas 'ALTERNATIF'. Jelaskan alasan tanpa KTP (mis. anak belum cukup umur, surat keterangan RT/Desa). Dilarang mengarang NIK fiktif.",
  ],
  [
    "nama_perwakilan",
    "Opsional",
    "Nama wali atau pihak yang mewakili penerima jika bantuan diwakilkan.",
  ],
  [
    "hubungan_perwakilan",
    "Kondisional",
    "Hubungan perwakilan (mis. Orang Tua, Paman, Wali Asuh). Wajib diisi jika nama_perwakilan diisi.",
  ],
  [
    "alamat_cakupan",
    "Wajib",
    "Alamat domisili atau cakupan wilayah penerima.",
  ],
  [
    "asnaf",
    "Wajib",
    "Kategori asnaf syariah: FAKIR, MISKIN, AMIL, MUALAF, RIQAB, GHARIM, FISABILILLAH, atau IBNU_SABIL.",
  ],
  [
    "jenis_bantuan",
    "Wajib",
    "Pilihan jenis bantuan: 'UANG' atau 'BARANG'.",
  ],
  [
    "nilai_idr",
    "Kondisional",
    "Wajib jika jenis_bantuan 'UANG'. Nominal rupiah dalam bilangan bulat positif tanpa desimal atau koma (misal: 1500000).",
  ],
  [
    "jumlah_barang",
    "Kondisional",
    "Wajib jika jenis_bantuan 'BARANG'. Kuantitas barang berupa angka desimal eksak (misal: 2 atau 2.5).",
  ],
  [
    "satuan_barang",
    "Kondisional",
    "Wajib jika jenis_bantuan 'BARANG'. Satuan barang yang jelas (misal: Paket, Kg, Kotak, Unit).",
  ],
  [
    "nilai_idr_barang",
    "Opsional",
    "Taksiran nilai rupiah bantuan barang bila dasar penilaian tersedia. Jika belum diketahui, kosongkan (tidak diubah menjadi nol rupiah).",
  ],
  [
    "periode_bantuan",
    "Opsional",
    "Periode bantuan spesifik (misal: 2026-03 atau 2026-Q1). Jika kosong, mengikuti periode pengajuan.",
  ],
  [
    "nama_penerima_pembayaran",
    "Opsional",
    "Nama pihak yang menerima transfer bila disalurkan ke penyedia/sekolah (misal: Madrasah Ibtidaiyah Al-Hidayah).",
  ],
  [
    "hubungan_penerima_pembayaran",
    "Kondisional",
    "Hubungan pihak penerima pembayaran dengan bantuan (mis. Penyedia Pendidikan). Wajib diisi jika nama_penerima_pembayaran diisi.",
  ],
  [
    "referensi_bukti",
    "Opsional",
    "Catatan referensi dokumen atau surat permohonan. Nama dokumen pada spreadsheet bukan bukti bahwa dokumen telah tersedia di sistem.",
  ],
  [
    "kontak_telepon",
    "Opsional",
    "Nomor telepon penerima/perwakilan untuk konfirmasi penyaluran (data terbatas). Kosong tidak membuat data fiktif.",
  ],
  [
    "kontak_email",
    "Opsional",
    "Alamat email penerima/perwakilan untuk konfirmasi.",
  ],
  [
    "kontak_relasi",
    "Opsional",
    "Relasi kontak (mis. Penerima Langsung, Wali, Orang Tua).",
  ],
  [""],
  ["KETENTUAN PENTING KEAMANAN DAN INTEGRITAS:"],
  ["1. Jangan menggunakan formula spreadsheet (tanda '='). Formula tidak akan dieksekusi."],
  ["2. Jangan menyimpan berkas dengan makro (.xlsm). Berkas makro ditolak otomatis."],
  ["3. Jangan mengunci atau mengenkripsi berkas dengan kata sandi."],
  ["4. Seluruh baris termasuk yang salah akan ditampilkan pada pratinjau dan tidak akan diabaikan diam-diam."],
  ["5. Satu penerima dengan beberapa rincian bantuan diperbolehkan; rincian bantuan persis sama pada satu penerima diblokir."],
];

/** Generates binary XLSX template with Petunjuk and Daftar_Penerima sheets */
export function generateBeneficiaryXlsxTemplate(): Uint8Array {
  const wb = XLSX.utils.book_new();

  // 1. Instruction Sheet
  const wsInstructions = XLSX.utils.aoa_to_sheet(BENEFICIARY_INSTRUCTION_ROWS);
  XLSX.utils.book_append_sheet(wb, wsInstructions, "Petunjuk");

  // 2. Data Sheet
  const dataAoa = [BENEFICIARY_TEMPLATE_HEADERS, ...SYNTHETIC_SAMPLE_BENEFICIARIES];
  const wsData = XLSX.utils.aoa_to_sheet(dataAoa);
  XLSX.utils.book_append_sheet(wb, wsData, "Daftar_Penerima");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new Uint8Array(buf);
}

/** Generates the CSV template as UTF-8 text with formula sanitization */
export function generateBeneficiaryCsvTemplate(): string {
  const rows = [BENEFICIARY_TEMPLATE_HEADERS, ...SYNTHETIC_SAMPLE_BENEFICIARIES];
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const safe = sanitizeForExport(String(cell ?? ""));
          return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
        })
        .join(",")
    )
    .join("\n");
}

/**
 * Generates an XLSX or CSV export for an existing proposal draft roster,
 * preserving stable IDs for beneficiaries and aid lines.
 */
export function generateBeneficiaryExport(
  beneficiaries: Beneficiary[],
  aidLines: AidLine[],
  format: "xlsx" | "csv"
): Uint8Array | string {
  const bMap = new Map(beneficiaries.map((b) => [b.id, b]));

  // Build rows from aid lines linked to their beneficiary
  const dataRows: string[][] = [];

  for (const line of aidLines) {
    const b = bMap.get(line.beneficiaryId);
    if (!b) continue;

    const row: string[] = [
      line.id,
      b.id,
      b.name,
      b.identityBasis.kind,
      b.identityBasis.kind === "NIK" ? b.identityBasis.value : "",
      b.identityBasis.kind === "ALTERNATIVE" ? b.identityBasis.description : "",
      b.guardian?.name ?? "",
      b.guardian?.relationship ?? "",
      b.addressOrScope,
      b.asnaf,
      line.value.kind === "MONEY" ? "UANG" : "BARANG",
      line.value.kind === "MONEY" ? line.value.amountRequestedIdr : "",
      line.value.kind === "GOODS" ? line.value.quantityRequested : "",
      line.value.kind === "GOODS" ? line.value.unit : "",
      line.value.kind === "GOODS" ? (line.value.valuedAmountIdr ?? "") : "",
      line.period,
      b.paymentRecipient?.name ?? "",
      b.paymentRecipient?.relation ?? "",
      "", // Referensi bukti
      b.contact?.phone ?? "",
      b.contact?.email ?? "",
      b.contact?.relation ?? "",
    ];
    dataRows.push(row);
  }

  // Include any beneficiary without aid lines as an incomplete row
  for (const b of beneficiaries) {
    const hasLines = aidLines.some((l) => l.beneficiaryId === b.id);
    if (!hasLines) {
      dataRows.push([
        "",
        b.id,
        b.name,
        b.identityBasis.kind,
        b.identityBasis.kind === "NIK" ? b.identityBasis.value : "",
        b.identityBasis.kind === "ALTERNATIVE" ? b.identityBasis.description : "",
        b.guardian?.name ?? "",
        b.guardian?.relationship ?? "",
        b.addressOrScope,
        b.asnaf,
        "",
        "",
        "",
        "",
        "",
        "",
        b.paymentRecipient?.name ?? "",
        b.paymentRecipient?.relation ?? "",
        "",
        b.contact?.phone ?? "",
        b.contact?.email ?? "",
        b.contact?.relation ?? "",
      ]);
    }
  }

  if (format === "csv") {
    const rows = [BENEFICIARY_TEMPLATE_HEADERS, ...dataRows];
    return rows
      .map((row) =>
        row
          .map((cell) => {
            const safe = sanitizeForExport(String(cell ?? ""));
            return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
          })
          .join(",")
      )
      .join("\n");
  }

  const wb = XLSX.utils.book_new();
  const wsInstructions = XLSX.utils.aoa_to_sheet(BENEFICIARY_INSTRUCTION_ROWS);
  XLSX.utils.book_append_sheet(wb, wsInstructions, "Petunjuk");

  const dataAoa = [BENEFICIARY_TEMPLATE_HEADERS, ...dataRows];
  const wsData = XLSX.utils.aoa_to_sheet(dataAoa);
  XLSX.utils.book_append_sheet(wb, wsData, "Daftar_Penerima");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new Uint8Array(buf);
}

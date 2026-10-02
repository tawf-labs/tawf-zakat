/**
 * Source Template Generator (Spec #86, Ticket #88).
 *
 * Generates versioned templates for report sources in XLSX (primary) and CSV (alternative).
 * Includes user instructions and synthetic demonstration data.
 */

import * as XLSX from "xlsx";
import { sanitizeForExport } from "./tabular-reader";

export const SOURCE_TEMPLATE_VERSION = "tawf.source.template.v2";

/** The name both the download header and the browser's save dialog use. */
export const sourceTemplateFileName = (format: "xlsx" | "csv"): string =>
  `${SOURCE_TEMPLATE_VERSION}.${format}`;

const TEMPLATE_HEADERS = [
  "identitas_entri",
  "jenis_dana",
  "posisi_neraca",
  "nilai",
  "satuan",
  "hak_amil",
  "uraian",
  "referensi",
  "apakah_total",
  "arus",
];

const SYNTHETIC_SAMPLE_ROWS = [
  [
    "PZ-001",
    "ZAKAT",
    "ON",
    "1500000000",
    "IDR",
    "187500000",
    "Penyaluran Zakat Paket Pendidikan",
    "REF-2024-001",
    "",
  ],
  [
    "PZ-002",
    "INFAK_SEDEKAH",
    "ON",
    "750000000",
    "IDR",
    "",
    "Pemberdayaan Ekonomi Mustahik",
    "REF-2024-002",
    "",
  ],
  [
    "PZ-003",
    "INFAK_SEDEKAH",
    "OFF",
    "250000000",
    "IDR",
    "",
    "Bantuan Tanggap Darurat Bencana",
    "REF-2024-003",
    "",
  ],
  [
    "PZ-004",
    "ZAKAT",
    "ON",
    "500000000",
    "IDR",
    "62500000",
    "Bantuan Kesehatan Mustahik",
    "REF-2024-004",
    "",
  ],
];

const FLOW_SAMPLE_ROWS = [
  ...SYNTHETIC_SAMPLE_ROWS.map(row => [...row, "DISTRIBUTION"]),
  ["KONTRIBUSI-001", "ZAKAT", "ON", "2500000000", "IDR", "", "Penghimpunan setelah koreksi dan pengembalian dibayar", "BANK-001", "", "COLLECTION"],
];

const INSTRUCTION_ROWS = [
  ["arus", "Wajib untuk laporan dua arus", "COLLECTION (penghimpunan) atau DISTRIBUTION (penyaluran). Jumlah dan total diperiksa terpisah per arus; jangan menjumlahkan keduanya. Pada berkas lama tanpa kolom arus, entri tetap diperlakukan sebagai penyaluran."],
  ["PETUNJUK PENGISIAN TEMPLATE SUMBER LAPORAN ZKT"],
  ["Versi Template", SOURCE_TEMPLATE_VERSION],
  [""],
  ["KOLOM", "STATUS", "ATURAN PENGISIAN"],
  [
    "identitas_entri",
    "Wajib",
    "Kode unik entri/transaksi (misal: PZ-001, TRX-1029, atau 0123). Karakter teks dipertahankan tanpa hilang nol di depan.",
  ],
  [
    "jenis_dana",
    "Wajib",
    "Pilihan jenis dana: ZAKAT, FITRAH, INFAK_SEDEKAH, KURBAN, atau DSKL. Huruf besar.",
  ],
  [
    "posisi_neraca",
    "Wajib jika cakupan BOTH",
    "Pilihan posisi pencatatan neraca: ON (on balance sheet) atau OFF (off balance sheet).",
  ],
  [
    "nilai",
    "Wajib",
    "Jumlah nominal dalam bilangan bulat penuh (misal: 1500000 untuk Rp1.500.000). Tanpa koma desimal atau titik pecahan.",
  ],
  [
    "satuan",
    "Opsional",
    "Mata uang/unit: IDR atau USDC_6DP. Bawaan sesuai manifest persiapan bukti.",
  ],
  [
    "hak_amil",
    "Opsional",
    "Bagian hak amil dari pengumpulan (bila berlaku), ditulis sebagai bilangan bulat penuh.",
  ],
  [
    "uraian",
    "Opsional",
    "Keterangan ringkas mengenai transaksi atau kegiatan penyaluran.",
  ],
  [
    "referensi",
    "Opsional",
    "Nomor referensi bukti bank atau dokumen pembukuan internal.",
  ],
  [
    "apakah_total",
    "Opsional",
    'Isi "YA" bila baris merupakan rekap total yang dideklarasikan. Kosongkan untuk entri normal.',
  ],
  [""],
  ["KETENTUAN PENTING KEAMANAN DAN INTEGRITAS:"],
  ["1. Jangan menggunakan formula spreadsheet (tanda '='). Formula tidak akan dieksekusi."],
  ["2. Jangan menyimpan berkas dengan makro (.xlsm). Berkas makro ditolak otomatis."],
  ["3. Jangan mengunci atau mengenkripsi berkas dengan kata sandi."],
  ["4. Seluruh baris termasuk yang salah akan ditampilkan pada pratinjau dan tidak akan diubah menjadi nol."],
];

/** Generates binary XLSX template with Petunjuk and Sumber_Laporan sheets */
export function generateSourceXlsxTemplate(): Uint8Array {
  const wb = XLSX.utils.book_new();

  // 1. Instruction Sheet
  const wsInstructions = XLSX.utils.aoa_to_sheet(INSTRUCTION_ROWS);
  XLSX.utils.book_append_sheet(wb, wsInstructions, "Petunjuk");

  // 2. Data Sheet
  const dataAoa = [TEMPLATE_HEADERS, ...FLOW_SAMPLE_ROWS];
  const wsData = XLSX.utils.aoa_to_sheet(dataAoa);
  XLSX.utils.book_append_sheet(wb, wsData, "Sumber_Laporan");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new Uint8Array(buf);
}

/**
 * Generates the CSV template as UTF-8 text.
 *
 * Every cell passes through `sanitizeForExport` first (reader rule 6). The sample
 * rows are ours and carry no formula today, but a template is a file people open in
 * a spreadsheet, and an export path that only sanitizes when it remembers to is an
 * export path that eventually does not.
 */
export function generateSourceCsvTemplate(): string {
  const rows = [TEMPLATE_HEADERS, ...FLOW_SAMPLE_ROWS];
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const safe = sanitizeForExport(cell);
          return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
        })
        .join(",")
    )
    .join("\n");
}

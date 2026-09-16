import type { OperationalFunction, MandateScopeType } from "./workspaceClient";

export const OPERATIONAL_FUNCTION_LABELS: Record<OperationalFunction, { label: string; description: string }> = {
  MANAGE_PROGRAMS: {
    label: "Pengelolaan Program",
    description: "Membuat, mengonfigurasi, dan mengarsipkan program bantuan lembaga.",
  },
  PREPARE_PROPOSALS: {
    label: "Penyusunan Pengajuan",
    description: "Menyusun draf pengajuan penyaluran dan rincian penerima manfaat massal.",
  },
  EXAMINE_PROPOSALS: {
    label: "Pemeriksaan Usulan",
    description: "Memverifikasi kelayakan draf, dokumen pendukung, dan data asnaf.",
  },
  APPROVE_DECISIONS: {
    label: "Pengesahan Keputusan",
    description: "Mengesahkan alokasi dana dan keputusan persetujuan penyaluran lembaga.",
  },
  RECORD_REALIZATION: {
    label: "Pencatatan Realisasi",
    description: "Mencatat bukti transfer, distribusi barang, dan BAST penyaluran.",
  },
  HANDLE_REPORT_EXAMINATION: {
    label: "Pemeriksaan Laporan",
    description: "Memeriksa laporan pertanggungjawaban penyaluran sebelum finalisasi.",
  },
};

export const SCOPE_TYPE_LABELS: Record<MandateScopeType, string> = {
  ALL_PROGRAMS: "Semua Program Bantuan Lembaga",
  SPECIFIC_PROGRAM: "Program Bantuan Khusus",
};

export function formatIdrAmount(amount: string | null | undefined): string {
  if (!amount) return "Tanpa Batas Nominal";
  try {
    const num = BigInt(amount);
    return `Rp ${num.toLocaleString("id-ID")}`;
  } catch {
    return `Rp ${amount}`;
  }
}

export function formatTimestamp(seconds: number): string {
  if (!seconds || seconds <= 0) return "Tidak terbatas";
  if (seconds >= 2147483647) return "Permanen / Tak terbatas";
  return new Date(seconds * 1000).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

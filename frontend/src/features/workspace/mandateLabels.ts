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
  RECORD_CONTRIBUTIONS: {
    label: "Pencatatan Kontribusi",
    description: "Mencatat kontribusi donor dan menyusun batch kontribusi lembaga.",
  },
  ENDORSE_CONTRIBUTIONS: {
    label: "Pengesahan Kontribusi",
    description: "Mengesahkan batch kontribusi sebelum akar bukti dipublikasikan.",
  },
  ISSUE_CERTIFICATES: {
    label: "Penerbitan Sertifikat",
    description: "Mengesahkan dan menerbitkan sertifikat distribusi (NFT) atas penyaluran.",
  },
  RECOVER_CERTIFICATE_CUSTODY: {
    label: "Pemulihan Kustodian Sertifikat",
    description: "Menerbitkan sertifikat pengganti bila kustodian sertifikat hilang.",
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

import type { CertificateValidity, ReplacementState, ScopeSourceStatus } from "../../../../shared/certificate-nft";

/** Business status of one certificate version, worded so that a token existing never reads as "still valid". */
export const VALIDITY_LABELS: Record<CertificateValidity, { title: string; detail: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  CURRENT: { title: "Berlaku saat ini", detail: "Penerbitan terkonfirmasi, cakupan sumber tidak berubah dan tidak sedang diperselisihkan.", tone: "success" },
  PENDING_CONFIRMATION: { title: "Belum terkonfirmasi", detail: "Penerbitan sudah diajukan tetapi belum mencapai tingkat konfirmasi; belum dinyatakan berlaku.", tone: "warning" },
  DISPUTED: { title: "Diperselisihkan", detail: "Sebagian realisasi yang dicakup sedang disengketakan. Sertifikat ini tidak dinyatakan berlaku penuh.", tone: "danger" },
  SOURCE_CHANGED: { title: "Sumber berubah", detail: "Sumber realisasi kini berbeda dari isi sertifikat. Menunggu versi pengganti dari lembaga.", tone: "warning" },
  REPLACEMENT_PENDING: { title: "Menunggu versi pengganti", detail: "Versi pengganti sedang diproses. Versi ini tidak ditandai berlaku selama menunggu.", tone: "warning" },
  REPLACEMENT_FAILED: { title: "Versi pengganti gagal terbit", detail: "Publikasi pengganti gagal. Versi ini tetap tidak dinyatakan berlaku sampai ada pengganti terkonfirmasi.", tone: "danger" },
  SUPERSEDED: { title: "Telah digantikan", detail: "Isi versi ini tetap tercatat sebagai riwayat; versi yang berlaku adalah penggantinya.", tone: "neutral" },
};

export const REPLACEMENT_LABELS: Record<ReplacementState, string> = {
  NONE: "Belum ada versi pengganti",
  PREPARED: "Pengganti disiapkan; belum disahkan",
  ENDORSED_PENDING_MINT: "Pengganti disahkan; transaksi belum tercatat dalam blok",
  INCLUDED_PENDING_CONFIRMATION: "Pengganti tercatat dalam blok; konfirmasi belum cukup",
  NONCANONICAL_PENDING: "Blok pengganti berubah; menunggu pemeriksaan ulang",
  CONFIRMED: "Pengganti terbit dan terkonfirmasi",
  FAILED: "Publikasi pengganti gagal",
  UNVERIFIED_CHAIN_SUCCESSOR: "Chain memuat penerus yang tidak dapat diverifikasi oleh catatan lembaga",
};

export const SCOPE_LABELS: Record<ScopeSourceStatus, string> = {
  MATCHES: "Sumber realisasi sesuai isi sertifikat",
  CHANGED: "Sumber realisasi berbeda dari isi sertifikat",
  DISPUTED: "Ada realisasi yang dicakup sedang diperselisihkan",
};

export const CORRECTION_REASON_LABELS = {
  SOURCE_CORRECTION: "Koreksi sumber realisasi",
  DISPUTE_DISCLOSURE: "Mencantumkan sengketa pada cakupan",
} as const;

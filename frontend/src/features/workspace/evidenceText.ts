import { ATTESTATION_SCOPES as scopes, ATTESTATION_CONCLUSIONS as conclusions, type AttestationScope, type AttestationConclusion } from "../../../../shared/report-registry";

/**
 * Saying what a stored preparation actually is (Spec #68, ticket #70).
 *
 * Pure: no `fetch`, no React. What it decides is the wording, and the wording
 * is where this feature is most easily made to lie. Four separations it keeps:
 *
 * - **Read-and-empty is not unread.** A period with no rows was examined; a
 *   source that is missing or broken was not. They never share a phrase.
 * - **A discrepancy is a result, not a failure.** A package that found a gap
 *   is described as having found one, never as having gone wrong.
 * - **A file that did not store is not "pending".** It failed, the reason is
 *   shown as the server gave it, and no identifier is offered for it.
 * - **Reconciled is not endorsed.** Nothing here promises that a figure was
 *   approved, published or audited; those are other tickets' words entirely.
 */

export type ExaminationOutcome = "RECONCILED" | "INCOMPLETE";
export type SourceStatus = "READ" | "MISSING" | "FAILED";
export type FileStorageStatus = "STORED" | "FAILED";

export type Tone = "neutral" | "finding" | "unproven";

export type Described = { label: string; detail: string; tone: Tone };

/**
 * What the package as a whole says.
 *
 * `findingCount` separates the two shapes of a completed examination; nothing
 * here calls either one a pass, because passing is a validator's verdict and
 * this is only a reconciliation.
 */
export function describeOutcome(outcome: ExaminationOutcome, findingCount: number): Described {
  if (outcome === "INCOMPLETE") {
    return {
      label: "Belum dapat direkonsiliasi",
      detail:
        "Setidaknya satu sumber tidak terbaca, sehingga tidak ada hasil rekonsiliasi. " +
        "Sumber dan alasannya tetap disimpan sebagai bukti pemeriksaan.",
      tone: "unproven",
    };
  }
  if (findingCount > 0) {
    return {
      label: `Selisih ditemukan (${findingCount})`,
      detail:
        "Kedua sisi dibaca dan dibandingkan. Selisihnya tersimpan sebagai bukti pemeriksaan, " +
        "bukan sebagai kegagalan yang dibuang.",
      tone: "finding",
    };
  }
  return {
    label: "Kedua sisi cocok",
    detail:
      "Kedua sisi dibaca dan angkanya cocok pada cakupan yang dinyatakan. Ini bukan pengesahan " +
      "lembaga, vonis validator, maupun opini auditor.",
    tone: "neutral",
  };
}

/** What one source says about itself. */
export function describeSourceStatus(
  status: SourceStatus,
  rowCount: number | null,
  detail: string | null
): Described {
  if (status === "READ") {
    return {
      label: rowCount === 0 ? "Terbaca, tanpa baris" : `Terbaca (${rowCount} baris)`,
      detail:
        rowCount === 0
          ? "Sumber ini berhasil dibaca dan memang tidak memuat baris pada periode tersebut."
          : "Sumber ini berhasil dibaca seluruhnya.",
      tone: "neutral",
    };
  }
  return {
    label: status === "MISSING" ? "Belum tersedia" : "Gagal dibaca",
    detail:
      (detail ?? "Alasannya tidak dicatat.") +
      " Cakupan ini belum terperiksa; nol pada cakupan tersebut bukan hasil pembacaan.",
    tone: "unproven",
  };
}

/** What happened to one attached document. */
export function describeFileStatus(status: FileStorageStatus, failureReason: string | null): Described {
  if (status === "STORED") {
    return {
      label: "Tersimpan terbatas",
      detail:
        "Berkas tersimpan terenkripsi dan hanya dapat diunduh pembaca berwenang lembaga ini.",
      tone: "neutral",
    };
  }
  return {
    label: "Gagal disimpan",
    detail:
      (failureReason ?? "Alasannya tidak dicatat.") +
      " Tidak ada pengenal pengganti yang dibuat untuk berkas ini.",
    tone: "unproven",
  };
}

export const ORIGIN_LABELS: Record<string, string> = {
  UPLOAD: "Unggahan berkas",
  PASTE: "Tempel tabel",
  PARTNER_EXPORT: "Ekspor lembaga mitra",
  INTERNAL_LEDGER: "Ledger internal aplikasi",
};

export const originLabel = (origin: string): string => ORIGIN_LABELS[origin] ?? origin;

export const ROLE_LABELS: Record<string, string> = {
  CLAIM: "Sisi klaim",
  SOURCE: "Sisi sumber",
};

export const roleLabel = (role: string): string => ROLE_LABELS[role] ?? role;

export const POSITION_LABELS: Record<string, string> = {
  ON: "On balance sheet",
  OFF: "Off balance sheet",
  BOTH: "On dan off balance sheet",
};

export const positionLabel = (position: string): string => POSITION_LABELS[position] ?? position;

export const DETAIL_LABELS: Record<string, string> = {
  PRESENT: "Memuat rincian transaksi",
  NOT_AVAILABLE: "Rekap, tanpa rincian transaksi",
};

export const transactionDetailLabel = (detail: string): string => DETAIL_LABELS[detail] ?? detail;

/**
 * Which chain, contract and blocks a source was read against (ticket #79).
 *
 * The checkpoint is part of the sentence, not a footnote: "compared against the
 * chain" without it reads as complete, when what was actually examined stops at
 * whatever block the indexer had reached.
 */
export type ChainScopeView = {
  chainId: number;
  contract: string;
  indexerKey: string;
  fromBlock: number;
  toBlock: number;
  checkpoint: { lastIndexedBlock: number; status: string; lastSyncAt: string | null };
  observed: { firstBlock: number; lastBlock: number; eventCount: number } | null;
  blockHashes: "RETAINED" | "NOT_RETAINED";
};

export function describeChainScope(scope: ChainScopeView): Described {
  const observed = scope.observed
    ? `${scope.observed.eventCount} event pada blok ${scope.observed.firstBlock}-${scope.observed.lastBlock}`
    : "tidak ada event yang cocok pada rentang ini";
  return {
    label: `Cakupan blok ${scope.fromBlock}-${scope.toBlock}`,
    detail:
      `Kontrak ${scope.contract} di chain eip155:${scope.chainId}; ${observed}. ` +
      `Checkpoint indexer berada di blok ${scope.checkpoint.lastIndexedBlock} ` +
      `(status ${scope.checkpoint.status}); deposit setelah blok itu belum terperiksa.` +
      (scope.blockHashes === "NOT_RETAINED"
        ? " Cermin event menyimpan nomor blok tanpa block hash, sehingga kanonisitas blok tidak diklaim."
        : ""),
    tone: scope.observed ? "neutral" : "unproven",
  };
}

/** A record that exists and could not be proved. Never shown as a zero. */
export function describeUnverified(count: number): Described {
  return {
    label: `Belum terverifikasi (${count})`,
    detail:
      "Catatan ini ada pada sumbernya dan tidak dapat dipasangkan dengan jumlah on-chain yang " +
      "dapat dibuktikan, sehingga tidak masuk perbandingan. Jumlahnya tidak diperkirakan dari kurs, " +
      "estimasi rupiah, atau tanggal.",
    tone: "unproven",
  };
}

/**
 * A cut-off is an instant; showing it as one is what makes coverage checkable.
 *
 * Only an ISO 8601 instant is reformatted. `new Date` alone would not do: it
 * happily reads "11 Februari 2025" as the eleventh of February, which is a
 * guess dressed as a reading - and on a different string it would guess
 * differently. Anything that is not already an instant is shown verbatim.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

export function formatInstant(iso: string): string {
  if (!ISO_INSTANT.test(iso)) return iso;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

/**
 * Whether a reader is being shown a package whose commitment still matches.
 *
 * A package that no longer verifies is not hidden - it is named, because a
 * stored snapshot that has moved is exactly the thing an examiner needs to see.
 */
export function describeCommitment(verified: boolean): Described {
  return verified
    ? {
        label: "Commitment cocok",
        detail:
          "Snapshot yang tersimpan masih sama dengan yang dicatat saat pembekuan, diperiksa dengan " +
          "salt yang hanya tersedia bagi pembaca berwenang.",
        tone: "neutral",
      }
    : {
        label: "Commitment tidak cocok",
        detail:
          "Snapshot yang tersimpan berbeda dari yang dicatat saat pembekuan. Hasil di bawah tidak " +
          "boleh dipakai sebelum perbedaannya ditelusuri.",
        tone: "unproven",
      };
}

/** Version state as the registry resolves it; display numbering is never the authority. */
export const VERSION_STATE_LABELS: Record<string, string> = {
  VERSI_RESMI_TERKINI: "Versi resmi terkini",
  DIGANTIKAN_KOREKSI: "Digantikan oleh koreksi yang lebih baru",
  BUKAN_VERSI_RESMI: "Belum menjadi versi resmi",
};

/** A block timestamp is seconds, and absent until a receipt has actually been observed. */
export function formatBlockInstant(seconds: string | null | undefined): string {
  return seconds ? new Date(Number(seconds) * 1000).toLocaleString("id-ID") : "waktu blok belum tersedia";
}

/** The registry's fixed attestation vocabulary, and how a reader sees it. */
const scopeLabels: Record<AttestationScope, string> = {
  REKONSILIASI_PERIODE: "Rekonsiliasi periode",
  SUMBER_DAN_KOMITMEN: "Sumber dan commitment",
  TINDAK_LANJUT_TEMUAN: "Tindak lanjut temuan",
};
const conclusionLabels: Record<AttestationConclusion, string> = {
  WAJAR_TANPA_PENGECUALIAN: "Wajar tanpa pengecualian",
  WAJAR_DENGAN_PENGECUALIAN: "Wajar dengan pengecualian",
  TIDAK_WAJAR: "Tidak wajar",
  TIDAK_MENYATAKAN_PENDAPAT: "Tidak menyatakan pendapat",
};
export const ATTESTATION_SCOPES = scopes.map(value => ({ value, label: scopeLabels[value] }));
export const ATTESTATION_CONCLUSIONS = conclusions.map(value => ({ value, label: conclusionLabels[value] }));
/** The code travels with the label: it is what the registry holds and what an examiner will compare. */
export const conclusionLabel = (value: string) =>
  `${ATTESTATION_CONCLUSIONS.find(item => item.value === value)?.label ?? "Kesimpulan lain"} (${value})`;
export const scopeLabel = (value: string) =>
  `${ATTESTATION_SCOPES.find(item => item.value === value)?.label ?? "Lingkup lain"} (${value})`;

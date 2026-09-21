import type { PrivateRequests } from "../workspace/privateRequests";
import type {
  ActivityTrackView as ActivityTrack, AmilTrace, CertificateLineView, DeliveryHeadline,
  OpenItem, Unavailable,
} from "../../../../shared/activity-trace";
import { VALIDITY_LABELS } from "../certificates/certificateLabels";
import type { CertificateMintState } from "../../../../shared/certificate-nft";

// One HTTP contract for both readers; domain services stay on the server, labels stay here.
export type {
  ActivityTrackView as ActivityTrack, AmilTrace, CertificateLineView, ConfirmationCounts,
  DeliveryHeadline, DonorTrace, DonorTraceActivity, FrozenSource, OpenItem, Track,
  TraceClaimLimits as ClaimLimits, Unavailable,
} from "../../../../shared/activity-trace";

/** A donor-side activity is either its tracks or the reason they could not be read. */
export const isActivityTrack = (value: ActivityTrack | Unavailable): value is ActivityTrack => "identity" in value;

export async function getActivityTrace(requests: PrivateRequests, activityId: string): Promise<AmilTrace> {
  const res = await requests.json<{ trace: AmilTrace }>(`/api/workspace/activities/${encodeURIComponent(activityId)}/trace`);
  return res.trace;
}

export const HEADLINE_LABELS: Record<DeliveryHeadline, string> = {
  NOT_STARTED: "Penyaluran belum tercatat",
  IN_PROGRESS: "Penyaluran sedang berjalan",
  DELIVERED_WITH_OPEN_ITEMS: "Seluruh paket diserahkan, masih ada yang terbuka",
  DELIVERED_AND_SETTLED: "Seluruh paket diserahkan dan tidak ada yang terbuka",
};

export const OPEN_ITEM_LABELS: Record<OpenItem, string> = {
  COSTS_UNACCOUNTED: "Sisa biaya atau uang muka belum dipertanggungjawabkan",
  GOODS_UNVALUED: "Ada barang tanpa nilai rupiah",
  CONFIRMATION_PENDING: "Sebagian penyerahan belum dikonfirmasi penerima",
  DISPUTE_OPEN: "Ada sengketa penyerahan",
  CONTRIBUTION_SHORTFALL: "Alokasi melebihi nilai kontribusi setelah koreksi",
  OVER_COMMITMENT: "Kewajiban melampaui dana teralokasi",
  PUBLICATION_PENDING: "NFT distribusi belum terbit atau belum berlaku",
  SOURCE_UNAVAILABLE: "Ada sumber yang belum dapat dibaca",
};

export const DIFFERENCE_LABELS = {
  PROPOSAL_VERSION: "Versi pengajuan berubah",
  ALLOCATED_TOTAL: "Total alokasi berubah",
  REALIZATION_COUNT: "Jumlah realisasi berubah",
} as const;

const ISSUANCE_LABELS: Record<CertificateMintState, string> = {
  PREPARED: "Disiapkan; belum diterbitkan",
  SUBMITTED: "Penerbitan diajukan; menunggu konfirmasi",
  INCLUDED: "Masuk blok; menunggu konfirmasi",
  CONFIRMED: "Penerbitan terkonfirmasi; isi belum dapat diperiksa",
  REVERTED: "Penerbitan gagal",
  INVALID_EVENT: "Penerbitan tidak diakui; catatan transaksi tidak cocok",
  NONCANONICAL: "Blok penerbitan berubah; perlu pemeriksaan ulang",
};

/** Status of the published version is distinct from issuance progress. */
export function certificateLineLabel(line: CertificateLineView): string {
  if (!line.published) return ISSUANCE_LABELS[line.issuance.state];
  return line.published.validity ? VALIDITY_LABELS[line.published.validity].title : "Status keberlakuan belum diketahui";
}

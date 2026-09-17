import { Clock, CheckCircle2, Layers, type LucideIcon } from "lucide-react";
import type { ContributionStatus } from "./contributionApi";

interface StatusBadge {
  Icon: LucideIcon;
  label: string;
  tone: string;
  explanation: string;
}

export const STATUS_BADGES: Record<ContributionStatus, StatusBadge> = {
  PENDING: {
    Icon: Clock,
    label: "Menunggu Pembayaran",
    tone: "bg-amber-50 border-amber-200 text-amber-800",
    explanation: "Referensi ini tercatat, tetapi pembayarannya belum diterima. Catatan ini belum menjadi bukti penunaian.",
  },
  PAID: {
    Icon: CheckCircle2,
    label: "Pembayaran Tercatat",
    tone: "bg-blue-50 border-blue-200 text-blue-800",
    explanation: "Pembayaran untuk referensi ini sudah tercatat dan menunggu dimasukkan ke batch penerimaan.",
  },
  BATCHED: {
    Icon: Layers,
    label: "Masuk Batch Penerimaan",
    tone: "bg-emerald-50 border-emerald-200 text-emerald-800",
    explanation: "Pembayaran untuk referensi ini sudah tercatat dan dimasukkan ke batch penerimaan.",
  },
};
